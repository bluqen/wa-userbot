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

BREVITY_INSTRUCTIONS = (
    "\n\nKeep this reply short and casual, like a real quick text message -- "
    "a sentence or two at most, never a long paragraph."
)

SPLIT_MARKER = "[[SPLIT]]"

SPLIT_INSTRUCTIONS = (
    "\n\nWrite this reply as two short separate text messages sent back to "
    "back, like a quick reply followed by a quick extra thought -- put the "
    "exact text " + SPLIT_MARKER + " between them, with nothing else on "
    "either side of it. Keep each part short."
)

STICKER_MARKER_RE = re.compile(r"\[\[STICKER:([a-z0-9_-]+)\]\]", re.IGNORECASE)


def _build_sticker_instructions(tags: List[str]) -> str:
    return (
        "\n\nYou may express yourself with a saved sticker if it genuinely fits, by "
        f"including the exact text [[STICKER:tag]] (one tag from exactly this list: "
        f"{', '.join(tags)}) anywhere in your reply -- it will be removed before "
        "anything is sent, and that sticker sent alongside your text. Only "
        "occasionally, only using one of the exact tags listed."
    )

# (session_id, contact_jid) -> unix timestamp of the last AI reply sent.
_last_replied: dict[Tuple[str, str], float] = {}


def _compute_start_delay_ms(humanlikeness: int) -> int:
    """How long to wait, doing nothing visible at all, before reacting to a
    message -- a person notices it and decides to reply before their thumbs
    ever move, regardless of whether a typing indicator is shown. Applies
    independently of `showTyping`/`typingDurationMs` below, which only
    control the *typing indicator itself* once a reply is already underway.
    At 0, returns 0 (today's instant-reply behavior, unchanged).
    """
    if humanlikeness <= 0:
        return 0
    jitter = humanlikeness / 100  # 0..1
    return int(random.uniform(300 * jitter, 300 + 4200 * jitter))


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


def _estimate_typing_ms(text: str) -> int:
    """Roughly how long a person would take to type this many characters,
    so the typing indicator's duration scales with what's actually being
    sent instead of being one fixed number regardless of whether the reply
    is two words or two sentences. ~40ms/char is a brisk, plausible phone-
    typing pace (~25 chars/sec); _compute_delay_ms above still layers
    humanlikeness-scaled variance on top of whatever this returns.
    """
    return len(text) * 40


def _max_reply_tokens(humanlikeness: int) -> int:
    """Higher humanlikeness leaves less room for the model to ramble -- a
    person texting doesn't send a whole paragraph in one message, which is
    exactly what the model's normal full-length budget can produce if
    nothing reins it in.
    """
    if humanlikeness >= 75:
        return 60
    if humanlikeness >= 50:
        return 110
    return 200


def _max_reply_chars(humanlikeness: int) -> Optional[int]:
    """Hard backstop for when the prompt instruction and token budget
    above weren't enough on their own -- a real texter essentially never
    sends a message this long, so trim it down rather than let it be the
    one obvious tell that gives the bot away. None below the threshold
    means no cap at all (today's unbounded behavior, unchanged).
    """
    if humanlikeness >= 75:
        return 160
    if humanlikeness >= 50:
        return 260
    return None


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _truncate_naturally(text: str, max_chars: int) -> str:
    """Cuts down to max_chars without stopping mid-word or mid-sentence
    when avoidable -- keeps whichever whole leading sentences fit, and
    only falls back to a bare word-boundary cut if even the first
    sentence alone is longer than the cap.
    """
    if len(text) <= max_chars:
        return text
    sentences = [s for s in _SENTENCE_SPLIT.split(text.strip()) if s]
    kept = ""
    for sentence in sentences:
        candidate = f"{kept} {sentence}".strip() if kept else sentence
        if len(candidate) > max_chars:
            break
        kept = candidate
    if kept:
        return kept
    truncated = text[:max_chars].rstrip()
    last_space = truncated.rfind(" ")
    return truncated[:last_space] if last_space > max_chars * 0.5 else truncated


def _pick_style(humanlikeness: int) -> str:
    """Returns 'plain', 'quote', or 'split' -- mutually exclusive per
    reply, weighted by humanlikeness. At 0, always 'plain' (today's
    behavior, unchanged).

    Decided *before* the LLM call, not inferred afterward from whatever
    text happens to come back -- 'split' needs to be requested as part of
    the prompt (see SPLIT_MARKER) so the model actually writes two short
    parts on purpose. Inferring it after the fact by checking whether the
    generated text happened to contain 2+ sentences doesn't reliably work
    once the prompt is also asking for brevity (a good short reply is
    often exactly one sentence), which is what made split rarely ever
    trigger in practice.
    """
    if humanlikeness <= 0:
        return "plain"
    weight = humanlikeness / 100
    split_p = 0.4 * weight
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
        humanlikeness = max(0, min(100, int(config.get("humanlikeness", 0))))

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

        if ctx.is_voice:
            system_prompt += (
                "\n\nThe message below was transcribed from a voice note, not typed -- the "
                "transcription is sometimes slightly wrong (a mis-heard word, missing "
                "punctuation). Respond naturally to the evident meaning rather than reacting "
                "to small transcription errors."
            )

        use_sticker = bool(config.get("useSticker", True))
        sticker_chance = max(0, min(100, int(config.get("stickerChance", 0))))
        offer_sticker = (
            use_sticker
            and sticker_chance > 0
            and bool(ctx.sticker_tags)
            and random.random() < (sticker_chance / 100)
        )
        if offer_sticker:
            system_prompt += _build_sticker_instructions(ctx.sticker_tags)

        # At higher humanlikeness, a normal full-length LLM response reads
        # as an obvious tell on its own -- real texting is rarely a whole
        # paragraph. Ask for brevity directly and shrink the token budget
        # so the model has less room to ramble in the first place; the
        # character cap further down is the backstop for whenever that
        # still isn't enough on its own.
        if humanlikeness >= 50:
            system_prompt += BREVITY_INSTRUCTIONS

        # Decided now, before generation, rather than inferred afterward --
        # 'split' needs the model to actually be asked for two short parts.
        style = _pick_style(humanlikeness)
        if style == "split":
            system_prompt += SPLIT_INSTRUCTIONS

        history_length = int(config.get("historyLength", 10))
        history = ctx.history[-history_length:] if history_length > 0 else []

        text = llm.generate(
            system_prompt, ctx.text, history=history, max_tokens=_max_reply_tokens(humanlikeness)
        )
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

        # Same "strip regardless, act only if actually offered and valid"
        # shape as the block marker -- guards against both leakage and a
        # hallucinated/copied tag that was never actually in the offered list.
        sticker_tag = None
        sticker_match = STICKER_MARKER_RE.search(text)
        if sticker_match:
            text = STICKER_MARKER_RE.sub("", text).strip()
            candidate = sticker_match.group(1).lower()
            if offer_sticker and candidate in ctx.sticker_tags:
                sticker_tag = candidate

        # Same shape again: strip the marker regardless (defense in depth
        # against it leaking even when a split wasn't requested), only
        # actually form two parts if a split was requested this turn *and*
        # the model cooperated with a marker splitting the text into two
        # genuinely non-empty pieces. If it didn't (ignored the
        # instruction, or split into empty halves), this just falls back
        # to sending `text` as a single plain message below -- same as
        # today's behavior when nothing splittable came back.
        parts = None
        if SPLIT_MARKER in text:
            raw_parts = [p.strip() for p in text.split(SPLIT_MARKER) if p.strip()]
            text = " ".join(raw_parts)
            if style == "split" and len(raw_parts) >= 2:
                parts = raw_parts[:2]

        # Backstop for whenever the brevity instruction and the tighter
        # token budget above still weren't enough on their own -- applied
        # after all marker stripping so the cap reflects the actual
        # visible message length(s), each part capped independently so a
        # split reply can't sneak a long paragraph into either half.
        max_chars = _max_reply_chars(humanlikeness)
        if max_chars:
            if parts:
                parts = [_truncate_naturally(p, max_chars) for p in parts]
                text = " ".join(parts)
            else:
                text = _truncate_naturally(text, max_chars)

        cooldown_minutes = config.get("cooldownMinutes", 0)
        if cooldown_minutes:
            _last_replied[(ctx.user_id, ctx.from_jid)] = time.time()

        # The typing indicator's duration scales with how long this reply
        # actually is instead of being one fixed number regardless of
        # message length -- typingDurationMs (the dashboard's configured
        # value) still acts as a floor, so a short reply never shows
        # "typing..." for less time than explicitly configured.
        configured_typing_ms = int(config.get("typingDurationMs", 0))
        base_typing_ms = max(configured_typing_ms, _estimate_typing_ms(text))
        delay_ms = _compute_delay_ms(base_typing_ms, humanlikeness)
        start_delay_ms = _compute_start_delay_ms(humanlikeness)

        quote = style == "quote"

        return Reply(
            text=text or None,
            show_typing=bool(config.get("showTyping", False)),
            typing_delay_ms=delay_ms,
            start_delay_ms=start_delay_ms,
            block=should_block,
            block_duration_hours=int(config.get("blockDurationHours", 0)) if should_block else 0,
            quote=quote,
            parts=parts,
            sticker_tag=sticker_tag,
        )
