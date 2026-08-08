"""Shared streaming, size-capped HTTP download.

song.py (Jamendo track), pinterest.py (Pexels photo), games.py (meme
image), and imagine.py (Pollinations-generated image) each fetch a real
file from an external API and each used to carry their own copy of this
exact control flow -- stream rather than buffer-then-check so an oversized
response aborts partway through, reject by Content-Length up front when
the server sends one, then keep counting actual bytes received in case it
didn't. The four copies differed only in timeout/label/byte-cap values;
consolidated here so the one thing that actually matters -- nothing here
can exhaust this process's memory on an unbounded response -- can't drift
out of sync between them the way four independent copies of the same
`8 * 1024 * 1024` constant eventually would.
"""

from typing import Optional

import httpx

DEFAULT_MAX_BYTES = 8 * 1024 * 1024


def download_capped(
    url: str,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    timeout: float = 20.0,
    params: Optional[dict] = None,
    label: str = "file",
) -> bytes:
    """Streams `url` (GET), raising ValueError if it's larger than
    `max_bytes` -- checked against the Content-Length header up front when
    present, and against actual bytes received either way, since a server
    can omit or lie about Content-Length. `label` only affects the error
    message ("track"/"image"/etc.), so callers' existing error text stays
    the same as before this was a shared function. Any HTTP/network
    failure raises whatever httpx itself raises.
    """
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", url, params=params) as res:
            res.raise_for_status()
            content_length = res.headers.get("content-length")
            if content_length and int(content_length) > max_bytes:
                raise ValueError(f"{label} too large ({content_length} bytes, max {max_bytes})")

            chunks = []
            total = 0
            for chunk in res.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"{label} exceeded {max_bytes} bytes while downloading")
                chunks.append(chunk)
            return b"".join(chunks)
