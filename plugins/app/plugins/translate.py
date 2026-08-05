import re
from typing import Optional

from .. import llm
from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings

# "!translate <language> <text>" / "!tl <language> <text>", or reply to a
# message with just "!tl <language>" to translate the quoted message
# instead of retyping it. The language is passed straight to the LLM as
# free text ("es", "spanish", "Spanish" all work) rather than validated
# against a fixed code list -- the model understands all of them fine.
TRANSLATE_COMMAND = re.compile(r"^!(?:translate|tl)\s+(\S+)(?:\s+([\s\S]+))?$", re.IGNORECASE)

MAX_LANGUAGE_LENGTH = 30
MAX_CONTENT_LENGTH = 2000


class TranslatePlugin(Plugin):
    """Translates text on demand -- either typed inline or, replying to a
    message, the quoted message's own text. Usable by anyone chatting with
    the bot, not owner-only, same as /song, /imagine etc.
    """

    name = "translate"
    priority = 46

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        # Group-gating and the provider check are deliberately *not* done
        # here -- see handle() below. Returning False from match() for
        # either makes the message silently fall through to whatever
        # plugin runs next (typically AI Reply), which then hallucinates
        # an unrelated chatty response to the literal text "!tl es ...".
        # Claiming the command syntax here and explaining why in handle()
        # instead avoids that (see games.py/song.py/imagine.py/
        # pinterest.py, which all had exactly this bug earlier).
        return bool(TRANSLATE_COMMAND.match(ctx.text.strip()))

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        match = TRANSLATE_COMMAND.match(ctx.text.strip())
        if not match:
            return None

        config = resolve_settings(self.config, ctx.from_jid)
        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return Reply(text="!translate isn't turned on for group chats -- ask the bot owner to enable it.")

        if not llm.has_provider():
            return Reply(text="!translate isn't ready yet -- try again later.")

        target_language = match.group(1)[:MAX_LANGUAGE_LENGTH]
        inline_text = (match.group(2) or "").strip()
        content = (inline_text or ctx.quoted_text.strip())[:MAX_CONTENT_LENGTH]

        if not content:
            return Reply(
                text='Usage: !translate <language> <text>, or reply to a message with '
                '!translate <language>. Alias: !tl'
            )

        translated = llm.generate(
            f"Translate the user's message to {target_language}. Reply with ONLY the "
            "translation itself -- no explanation, no quotation marks, no repeating the "
            "original text.",
            content,
            max_tokens=500,
            temperature=0.3,
        )
        if not translated:
            return Reply(text="Couldn't translate that right now -- try again?")

        return Reply(text=translated)
