import time
from typing import Optional, Tuple

from .. import llm
from ..personalities import get_personality_prompt
from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings

BASE_INSTRUCTIONS = (
    "You are chatting with someone over WhatsApp. Reply naturally and briefly "
    "(1-3 short sentences, no markdown formatting, no asterisks) to what they "
    "just said, fully in character as described below.\n\nPersonality: "
)

# (session_id, contact_jid) -> unix timestamp of the last AI reply sent.
_last_replied: dict[Tuple[str, str], float] = {}


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

        personality_id = config.get("personalityId", "friendly-helper")
        if personality_id == "custom":
            personality_text = config.get("customPrompt") or "Warm and helpful."
        else:
            personality_text = get_personality_prompt(personality_id) or get_personality_prompt(
                "friendly-helper"
            )

        system_prompt = BASE_INSTRUCTIONS + personality_text

        history_length = int(config.get("historyLength", 10))
        history = ctx.history[-history_length:] if history_length > 0 else []

        text = llm.generate(system_prompt, ctx.text, history=history)
        if not text:
            return None

        cooldown_minutes = config.get("cooldownMinutes", 0)
        if cooldown_minutes:
            _last_replied[(ctx.user_id, ctx.from_jid)] = time.time()

        return Reply(
            text=text,
            show_typing=bool(config.get("showTyping", False)),
            typing_delay_ms=int(config.get("typingDurationMs", 0)),
        )
