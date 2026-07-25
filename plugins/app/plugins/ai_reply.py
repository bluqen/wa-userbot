import random
import re
import time
from typing import List, Optional, Tuple

from .. import llm
from ..personalities import get_personality_prompt
from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings

BASE_INSTRUCTIONS = (
    "You are chatting with someone over WhatsApp. Reply naturally and briefly "
    "(1-3 short sentences, no markdown formatting, no asterisks) to what they "
    "just said, fully in character as described below.\n\nPersonality: "
)

BLOCK_MARKER = "[[BLOCK]]"

BLOCK_INSTRUCTIONS = (
    "\n\nIf, and only if, the other person is being abusive, threatening, or "
    "repeatedly harassing you and the conversation cannot continue productively, "
    "you may end it by including the exact literal text " + BLOCK_MARKER + " "
    "anywhere in your reply -- it will be removed before anything is sent, and "
    "this contact will then be blocked. Use this rarely, only for genuinely "
    "hostile behavior, never for ordinary rudeness or disagreement. Still write "
    "a short, natural final reply alongside it if appropriate."
)

# (session_id, contact_jid) -> unix timestamp of the last AI reply sent.
_last_replied: dict[Tuple[str, str], float] = {}


def _compute_delay_ms(base_ms: int, humanlikeness: int) -> int:
    """At 0, returns base_ms unchanged -- today's behavior. Above that,
    widens the range randomly sampled around base_ms; higher humanlikeness
    means more variance (a real person's response time swings a lot more
    than a fixed number ever would).
    """
    if humanlikeness <= 0:
        return base_ms
    jitter = humanlikeness / 100  # 0..1
    low = base_ms * (1 - 0.5 * jitter)
    high = base_ms * (1 + 2 * jitter)
    return int(random.uniform(max(low, 300), max(high, low + 300)))


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _split_into_parts(text: str) -> Optional[List[str]]:
    """Splits a reply into two messages at a sentence boundary, the way a
    person often sends a quick follow-up instead of one longer message.
    Only returns a split for text that actually has 2+ sentences -- a
    short one-liner has nothing sensible to split, so this returns None
    and the caller falls back to a single plain message.
    """
    sentences = [s for s in _SENTENCE_SPLIT.split(text.strip()) if s]
    if len(sentences) < 2:
        return None
    midpoint = len(sentences) // 2
    part1 = " ".join(sentences[:midpoint]).strip()
    part2 = " ".join(sentences[midpoint:]).strip()
    if not part1 or not part2:
        return None
    return [part1, part2]


def _pick_style(humanlikeness: int, text: str) -> str:
    """Returns 'plain', 'quote', or 'split' -- mutually exclusive per
    reply, weighted by humanlikeness. At 0, always 'plain' (today's
    behavior, unchanged). 'split' only gets picked if the text actually
    has something splittable.
    """
    if humanlikeness <= 0:
        return "plain"
    weight = humanlikeness / 100
    can_split = _split_into_parts(text) is not None
    split_p = 0.4 * weight if can_split else 0
    quote_p = 0.35 * weight
    roll = random.random()
    if roll < split_p:
        return "split"
    if roll < split_p + quote_p:
        return "quote"
    return "plain"


class AIReplyPlugin(Plugin):
    """Generates a reply with an LLM, styled by a chosen personality (or a
    fully custom one) configured per session via the dashboard. Individual
    contacts can get their own personality/overrides (or be excluded
    entirely) via `exceptions`.
    """

    name = "ai_reply"
    priority = 50  # runs before the plain autoreply plugin if both are enabled

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return False

        cooldown_minutes = config.get("cooldownMinutes", 0)
        if cooldown_minutes:
            last = _last_replied.get((ctx.user_id, ctx.from_jid))
            if last and (time.time() - last) < cooldown_minutes * 60:
                return False

        return llm.has_provider()

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        config = resolve_settings(self.config, ctx.from_jid)
        allow_blocking = bool(config.get("allowBlocking", False))

        personality_id = config.get("personalityId", "friendly-helper")
        if personality_id == "custom":
            personality_text = config.get("customPrompt") or "Warm and helpful."
        else:
            personality_text = get_personality_prompt(personality_id) or get_personality_prompt(
                "friendly-helper"
            )

        system_prompt = BASE_INSTRUCTIONS + personality_text

        knowledge_base = (config.get("knowledgeBase") or "").strip()
        if knowledge_base:
            system_prompt += (
                "\n\nYou also have the following reference information about the "
                "business/person you're replying on behalf of -- use it to answer "
                "questions accurately when it's relevant, and fall back to the "
                "personality above for anything it doesn't cover:\n\n" + knowledge_base
            )

        if allow_blocking:
            system_prompt += BLOCK_INSTRUCTIONS

        history_length = int(config.get("historyLength", 10))
        history = ctx.history[-history_length:] if history_length > 0 else []

        text = llm.generate(system_prompt, ctx.text, history=history)
        if not text:
            return None

        # Strip the marker unconditionally, whether or not we act on it --
        # it should never leak into a real message either way. Whether it
        # actually triggers a block is gated on allowBlocking again here
        # (not just at prompt-injection time, as defense in depth against
        # a hallucinated/copied marker when the capability was never
        # actually granted for this session) and never for a group chat,
        # since the marker means "block this WhatsApp contact," which
        # isn't meaningful against a group JID.
        is_group = ctx.from_jid.endswith("@g.us")
        marker_present = BLOCK_MARKER in text
        if marker_present:
            text = text.replace(BLOCK_MARKER, "").strip()
        should_block = marker_present and allow_blocking and not is_group

        cooldown_minutes = config.get("cooldownMinutes", 0)
        if cooldown_minutes:
            _last_replied[(ctx.user_id, ctx.from_jid)] = time.time()

        humanlikeness = max(0, min(100, int(config.get("humanlikeness", 0))))
        delay_ms = _compute_delay_ms(int(config.get("typingDurationMs", 0)), humanlikeness)

        style = _pick_style(humanlikeness, text) if text else "plain"
        parts = _split_into_parts(text) if style == "split" else None
        quote = style == "quote"

        return Reply(
            text=text or None,
            show_typing=bool(config.get("showTyping", False)),
            typing_delay_ms=delay_ms,
            block=should_block,
            block_duration_hours=int(config.get("blockDurationHours", 0)) if should_block else 0,
            quote=quote,
            parts=parts,
        )
