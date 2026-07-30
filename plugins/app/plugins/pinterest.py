import base64
import os
import random
import re
from typing import List, Optional

import httpx

from ..plugin_base import ImageAttachment, MessageContext, Plugin, Reply, resolve_settings

# Pinterest's own API is OAuth/business-app-only and has no public keyword
# image search -- there's no legitimate free/keyless way to "search
# Pinterest" directly. Pexels is a free, instant-signup stock-photo API
# with a real keyword search endpoint, which is what this actually queries;
# get a free key at https://www.pexels.com/api.
PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "")
PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"

PINTEREST_COMMAND = re.compile(r"^/pinterest(?:\s+(.+))?$", re.IGNORECASE | re.DOTALL)

MAX_QUERY_LENGTH = 100
RESULTS_TO_SEND = 3
# Same reasoning as song.py/imagine.py's byte caps.
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class PinterestPlugin(Plugin):
    """Sends a few images matching "/pinterest <query>". Backed by Pexels'
    stock-photo search (see note above on why not Pinterest itself).
    """

    name = "pinterest"
    priority = 46

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        # Group-gating and the API-key check are deliberately *not* done
        # here -- see handle() below. Returning False from match() for
        # either makes the message silently fall through to whatever
        # plugin runs next (typically AI Reply), which then hallucinates
        # an unrelated chatty response to the literal text "/pinterest
        # ...". That looks exactly like the command being broken, when
        # it's actually just blocked or unconfigured. Claiming the command
        # syntax here and explaining why in handle() instead avoids that.
        return bool(PINTEREST_COMMAND.match(ctx.text.strip()))

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        match = PINTEREST_COMMAND.match(ctx.text.strip())
        if not match:
            return None

        config = resolve_settings(self.config, ctx.from_jid)
        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return Reply(text="/pinterest isn't turned on for group chats -- ask the bot owner to enable it.")

        if not PEXELS_API_KEY:
            return Reply(text="/pinterest isn't set up yet -- the bot owner needs to add a Pexels API key.")

        query = (match.group(1) or "").strip()[:MAX_QUERY_LENGTH]
        if not query:
            return Reply(text='Usage: /pinterest <search term>, e.g. "/pinterest cottagecore aesthetic"')

        urls = _search_images(query)
        if not urls:
            return Reply(text=f'Couldn\'t find any images for "{query}" -- try a different search term.')

        images = []
        for url in urls:
            try:
                images.append(_download_image(url))
            except Exception as exc:
                print(f"[pinterest] failed to download an image: {exc}")
        if not images:
            return Reply(text=f'Found matches for "{query}" but couldn\'t download them -- try again?')

        return Reply(
            text=f'\U0001F4CC "{query}"',
            images=[ImageAttachment(data=base64.b64encode(b).decode(), mimetype="image/jpeg") for b in images],
        )


def _search_images(query: str) -> List[str]:
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                PEXELS_SEARCH_URL,
                headers={"Authorization": PEXELS_API_KEY},
                params={"query": query, "per_page": 15},
            )
            res.raise_for_status()
            photos = res.json().get("photos", [])
    except Exception as exc:
        print(f"[pinterest] Pexels search failed: {exc}")
        return []

    if not photos:
        return []

    # Randomized among the top matches (rather than always the same top N)
    # so repeating a search doesn't always hand back identical images.
    random.shuffle(photos)
    urls = []
    for photo in photos[: RESULTS_TO_SEND * 2]:
        src = (photo.get("src") or {}).get("large")
        if src:
            urls.append(src)
        if len(urls) >= RESULTS_TO_SEND:
            break
    return urls


def _download_image(url: str) -> bytes:
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        with client.stream("GET", url) as res:
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
