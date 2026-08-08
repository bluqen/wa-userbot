import base64
import re
import urllib.parse
from typing import Optional

from ..media_fetch import download_capped
from ..plugin_base import ImageAttachment, MessageContext, Plugin, Reply, is_disabled, is_group_blocked, resolve_settings

# Pollinations.ai serves free, keyless AI image generation over a plain GET
# request -- no signup, no API key, no credit card. Anonymous use is rate
# limited but comfortably covers a hobby bot's volume. See
# https://image.pollinations.ai -- the prompt is just URL-encoded straight
# into the path.
POLLINATIONS_URL = "https://image.pollinations.ai/prompt/{prompt}"

IMAGINE_COMMAND = re.compile(r"^!imagine(?:\s+(.+))?$", re.IGNORECASE | re.DOTALL)

MAX_PROMPT_LENGTH = 300
# Same reasoning as song.py/anti-delete's byte caps -- an uncapped image
# response fully buffers in memory (bytes + base64 + JSON), so bound it
# even though Pollinations' own output is normally well under this.
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ImaginePlugin(Plugin):
    """Generates an AI image from a text prompt via "!imagine <prompt>",
    using Pollinations.ai's free, keyless image generation endpoint.
    """

    name = "imagine"
    priority = 46

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if is_disabled(config):
            return False

        # Group-gating is deliberately *not* checked here -- see handle()
        # below. If it were, a blocked "!imagine" in a group would return
        # False from match() and silently fall through to whatever plugin
        # runs next (typically AI Reply), which would then hallucinate an
        # unrelated chatty response to the literal text "!imagine ...".
        # That looked exactly like the command being broken, when it was
        # actually just off for groups. Claiming the command syntax here
        # and explaining why in handle() instead avoids that.
        return bool(IMAGINE_COMMAND.match(ctx.text.strip()))

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        match = IMAGINE_COMMAND.match(ctx.text.strip())
        if not match:
            return None

        config = resolve_settings(self.config, ctx.from_jid)
        if is_group_blocked(config, ctx.from_jid):
            return Reply(text="!imagine isn't turned on for group chats -- ask the bot owner to enable it.")

        prompt = (match.group(1) or "").strip()
        if not prompt:
            return Reply(text='Usage: !imagine <description>, e.g. "!imagine a cat astronaut riding a horse"')

        prompt = prompt[:MAX_PROMPT_LENGTH]

        try:
            image_bytes = _generate_image(prompt)
        except Exception as exc:
            print(f"[imagine] generation failed: {exc}")
            return Reply(text="Couldn't generate that image right now -- try again in a moment?")

        return Reply(
            text=f'\U0001F3A8 "{prompt}"',
            images=[ImageAttachment(data=base64.b64encode(image_bytes).decode(), mimetype="image/jpeg")],
        )


def _generate_image(prompt: str) -> bytes:
    url = POLLINATIONS_URL.format(prompt=urllib.parse.quote(prompt))
    # Generous timeout on top of the usual byte cap -- image generation can
    # legitimately take a while since the model runs on request.
    return download_capped(
        url,
        max_bytes=MAX_IMAGE_BYTES,
        timeout=60.0,
        params={"width": 768, "height": 768, "nologo": "true"},
        label="image",
    )
