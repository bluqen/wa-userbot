import time
from typing import Optional, Tuple

from .. import llm
from ..personalities import get_personality_prompt

BASE_INSTRUCTIONS = (
    "You are an instant writing assistant for WhatsApp. The user is about to send the "
    "message below and wants it transformed before anyone reads it, following the rules "
    "below.\n\n"
    "CRITICAL RULE: Never change the facts, claims, opinions, or meaning of what the user "
    "wrote -- even if something stated seems factually wrong to you. You are not a "
    "fact-checker and the user did not ask you to correct their claims, only their "
    "writing. If they say the sky is green, the transformed message should still say the "
    "sky is green. Only adjust spelling, grammar, phrasing, tone, or language, exactly as "
    "instructed below.\n\n"
    "{style_instruction}\n\n"
    "Reply with ONLY the transformed message text -- no quotes, no explanation, no "
    "preamble. If no changes are needed under the rules above, reply with EXACTLY the "
    "original text, unchanged."
)

FIX_ERRORS_INSTRUCTION = (
    "Keep the original tone, wording, length, and meaning as close as possible -- only fix "
    "clear mistakes, don't rephrase things that are already fine."
)

# (session_id, chat_jid) -> unix timestamp of the last rewrite attempt.
# Off by default (cooldownMinutes: 0) -- this exists so a burst of the
# owner's own messages in one chat can be throttled to reduce LLM call
# volume (helps avoid the free-tier-provider 429s this project has hit in
# practice), without changing behavior for anyone who hasn't opted in.
_last_rewritten: dict[Tuple[str, str], float] = {}


class AIWritePlugin:
    """Instantly edits the userbot owner's own outgoing messages -- fixing
    typos/grammar by default, or rewriting the tone entirely if a style is
    configured. Unlike the reply plugins, this doesn't respond to incoming
    messages from others; it acts on the owner's own sent text via
    WhatsApp's message-edit feature.
    """

    def __init__(self, config: dict):
        self.config = config or {}

    def should_process(self, session_id: str, chat_jid: str, text: str) -> bool:
        is_group = chat_jid.endswith("@g.us")
        if is_group and not self.config.get("applyInGroups", False):
            return False

        min_length = int(self.config.get("minLength", 4))
        if len(text.strip()) < min_length:
            return False

        cooldown_minutes = int(self.config.get("cooldownMinutes", 0))
        if cooldown_minutes:
            last = _last_rewritten.get((session_id, chat_jid))
            if last and (time.time() - last) < cooldown_minutes * 60:
                return False

        return llm.has_provider()

    def rewrite(self, session_id: str, chat_jid: str, text: str) -> Optional[str]:
        # Recorded on every attempt, not just successful edits -- an LLM
        # call was made either way, and cutting call volume is the point.
        cooldown_minutes = int(self.config.get("cooldownMinutes", 0))
        if cooldown_minutes:
            _last_rewritten[(session_id, chat_jid)] = time.time()

        style_id = self.config.get("styleId", "fix-errors")

        if style_id == "custom":
            style_instruction = self.config.get("customStylePrompt") or FIX_ERRORS_INSTRUCTION
        elif style_id and style_id != "fix-errors":
            personality_prompt = get_personality_prompt(style_id)
            style_instruction = (
                f"Beyond fixing mistakes, rewrite it in this style: {personality_prompt}"
                if personality_prompt
                else FIX_ERRORS_INSTRUCTION
            )
        else:
            style_instruction = FIX_ERRORS_INSTRUCTION

        extra = (self.config.get("extraInstructions") or "").strip()
        if extra:
            style_instruction += f" Additional instructions: {extra}"

        system_prompt = BASE_INSTRUCTIONS.format(style_instruction=style_instruction)
        result = llm.generate(system_prompt, text, max_tokens=400)

        if not result or result.strip() == text.strip():
            return None
        return result.strip()
