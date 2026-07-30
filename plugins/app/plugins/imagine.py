import base64
import re
import urllib.parse
from typing import Optional

import httpx

from ..plugin_base import ImageAttachment, MessageContext, Plugin, Reply, resolve_settings

# Pollinations.ai serves free, keyless AI image generation over a plain GET
# request -- no signup, no API key, no credit card. Anonymous use is rate
# limited but comfortably covers a hobby bot's volume. See
# https://image.pollinations.ai -- the prompt is just URL-encoded straight
# into the path.
POLLINATIONS_URL = "https://image.pollinations.ai/prompt/{prompt}"

IMAGINE_COMMAND = re.compile(r"^/imagine(?:\s+(.+))?$", re.IGNORECASE | re.DOTALL)

MAX_PROMPT_LENGTH = 300
# Same reasoning as song.py/anti-delete's byte caps -- an uncapped image
# response fully buffers in memory (bytes + base64 + JSON), so bound it
# even though Pollinations' own output is normally well under this.
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ImaginePlugin(Plugin):
    """Generates an AI image from a text prompt via "/imagine <prompt>",
    using Pollinations.ai's free, keyless image generation endpoint.
    """

    name = "imagine"
    priority = 46

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return False

        return bool(IMAGINE_COMMAND.match(ctx.text.strip()))

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        match = IMAGINE_COMMAND.match(ctx.text.strip())
        if not match:
            return None

        prompt = (match.group(1) or "").strip()
        if not prompt:
            return Reply(text='Usage: /imagine <description>, e.g. "/imagine a cat astronaut riding a horse"')

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
    # Streamed and capped the same way song.py downloads a track -- image
    # generation can also legitimately take a while (the model runs on
    # request), so this gets a generous timeout on top of the byte cap.
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        with client.stream(
            "GET",
            url,
            params={"width": 768, "height": 768, "nologo": "true"},
        ) as res:
            res.raise_for_status()
            content_length = res.headers.get("content-length")
            if content_length and int(content_length) > MAX_IMAGE_BYTES:
                raise ValueError(f"image too large ({content_length} bytes, max {MAX_IMAGE_BYTES})")

            chunks = []
            total = 0
            for chunk in res.iter_bytes():
                total += len(chunk)
                if total > MAX_IMAGE_BYTES:
                    raise ValueError(f"image exceeded {MAX_IMAGE_BYTES} bytes while downloading")
                chunks.append(chunk)
            return b"".join(chunks)
