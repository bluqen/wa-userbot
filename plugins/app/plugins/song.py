import base64
import os
import random
import re
from typing import Optional

import httpx

from ..plugin_base import AudioAttachment, MessageContext, Plugin, Reply, resolve_settings

# Jamendo hosts independent music explicitly released under Creative
# Commons / royalty-free terms and runs a public API specifically meant
# for third parties to search and redistribute it (unlike, say, ripping
# audio off YouTube or Spotify, which is a ToS violation on top of the
# copyright problem) -- this plugin only ever fetches from that catalog,
# never mainstream commercial tracks. Get a free client id at
# https://developer.jamendo.com.
JAMENDO_CLIENT_ID = os.environ.get("JAMENDO_CLIENT_ID", "")
JAMENDO_SEARCH_URL = "https://api.jamendo.com/v3.0/tracks/"

SONG_COMMAND = re.compile(r"^/song(?:\s+(.+))?$", re.IGNORECASE)

# Same cap the gateway applies to WhatsApp media (see whatsappManager.js) --
# an uncapped download here would fully buffer in memory (original bytes +
# base64 + JSON serialization, roughly 3x the file size) with nothing
# stopping an unusually long/high-bitrate track from spiking well past
# this process's memory budget.
MAX_TRACK_BYTES = 8 * 1024 * 1024


class SongPlugin(Plugin):
    """Sends a Creative-Commons-licensed track from Jamendo's catalog when
    someone messages "/song <genre, mood, or artist>". Deliberately not a
    general "get me any song" tool -- Jamendo's catalog is independent/CC
    music, not mainstream commercial releases, so this only ever fetches
    and redistributes tracks that are actually licensed for it.
    """

    name = "song"
    priority = 45  # ahead of ai_reply -- a /song command shouldn't get a chatty AI reply instead

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        # Group-gating and the API-key check are deliberately *not* done
        # here -- see handle() below. Returning False from match() for
        # either makes the message silently fall through to whatever
        # plugin runs next (typically AI Reply), which then hallucinates
        # an unrelated chatty response to the literal text "/song ...".
        # That looks exactly like the command being broken, when it's
        # actually just blocked or unconfigured. Claiming the command
        # syntax here and explaining why in handle() instead avoids that.
        return bool(SONG_COMMAND.match(ctx.text.strip()))

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        match = SONG_COMMAND.match(ctx.text.strip())
        if not match:
            return None

        config = resolve_settings(self.config, ctx.from_jid)
        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return Reply(text="/song isn't turned on for group chats -- ask the bot owner to enable it.")

        if not JAMENDO_CLIENT_ID:
            return Reply(text="/song isn't set up yet -- the bot owner needs to add a Jamendo client ID.")

        query = (match.group(1) or "").strip()
        if not query:
            return Reply(
                text='Usage: /song <genre, mood, or artist>, e.g. "/song lofi chill" or '
                '"/song upbeat rock"'
            )

        track = _search_track(query)
        if not track:
            return Reply(
                text=(
                    f'Couldn\'t find a royalty-free track for "{query}". This only searches '
                    "independent/Creative-Commons music (not mainstream commercial songs) -- "
                    'try a genre or mood instead, like "lofi", "acoustic", or "upbeat rock".'
                )
            )

        try:
            audio_bytes = _download_track(track["url"])
        except Exception as exc:
            print(f"[song] failed to download track: {exc}")
            return Reply(
                text=f'Found "{track["name"]}" by {track["artist_name"]} but couldn\'t '
                "download it -- try again?"
            )

        caption = (
            f'\U0001F3B5 "{track["name"]}" by {track["artist_name"]}\n'
            f'Licensed under {track["license"]} (via Jamendo) -- credit the artist if you '
            "share this further."
        )
        return Reply(
            text=caption,
            audio=AudioAttachment(data=base64.b64encode(audio_bytes).decode(), mimetype="audio/mpeg"),
        )


def _search_track(query: str) -> Optional[dict]:
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                JAMENDO_SEARCH_URL,
                params={
                    "client_id": JAMENDO_CLIENT_ID,
                    "format": "json",
                    "limit": 10,
                    "audioformat": "mp32",
                    "search": query,
                    "order": "popularity_total",
                },
            )
            res.raise_for_status()
            results = res.json().get("results", [])
    except Exception as exc:
        print(f"[song] Jamendo search failed: {exc}")
        return None

    if not results:
        return None

    # Randomized among the top matches (rather than always the single
    # top hit) so repeating the same genre/mood search doesn't always
    # hand back the identical track.
    picked = random.choice(results)
    download_url = picked.get("audiodownload") or picked.get("audio")
    if not download_url:
        return None

    return {
        "name": picked.get("name") or "Untitled",
        "artist_name": picked.get("artist_name") or "Unknown artist",
        "url": download_url,
        "license": picked.get("license_ccurl") or "Creative Commons",
    }


def _download_track(url: str) -> bytes:
    # Streamed (rather than client.get(url).content) so an oversized file
    # aborts partway through instead of first buffering the whole thing
    # just to throw it away a moment later.
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        with client.stream("GET", url) as res:
            res.raise_for_status()
            content_length = res.headers.get("content-length")
            if content_length and int(content_length) > MAX_TRACK_BYTES:
                raise ValueError(f"track too large ({content_length} bytes, max {MAX_TRACK_BYTES})")

            chunks = []
            total = 0
            for chunk in res.iter_bytes():
                total += len(chunk)
                if total > MAX_TRACK_BYTES:
                    raise ValueError(f"track exceeded {MAX_TRACK_BYTES} bytes while downloading")
                chunks.append(chunk)
            return b"".join(chunks)
