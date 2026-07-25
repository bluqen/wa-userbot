import os
from pathlib import Path
from typing import List, Optional, Tuple

import httpx
from dotenv import load_dotenv

# Don't rely on load_dotenv()'s cwd-based auto-discovery -- uvicorn is often
# launched with a working directory that isn't this package's own folder
# (e.g. via --app-dir from elsewhere), which would silently skip loading
# .env and leave secrets empty instead of erroring.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

WEB_APP_URL = os.environ.get("WEB_APP_URL", "http://localhost:3000")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")

# Upper bound on how much history we ever pull in one call, regardless of
# any individual plugin's configured historyLength -- plugins slice this
# down to whatever window they actually want, so this stays a single round
# trip no matter what that setting is.
MAX_HISTORY_FETCH = 50


async def fetch_session_plugins(session_id: str) -> List[dict]:
    """Asks the web app (source of truth for per-session plugin config,
    edited via the dashboard) which plugins are enabled for this session
    and with what settings. Use fetch_session_context instead when you also
    need chat history for a specific contact.
    """
    plugins, _, _ = await fetch_session_context(session_id, contact_jid=None)
    return plugins


async def fetch_session_context(
    session_id: str, contact_jid: Optional[str]
) -> Tuple[List[dict], List[dict], List[str]]:
    """Fetches plugin config, sticker tags this session has saved, and --
    when a contact is given -- recent chat history with that contact, all
    in a single request. Returns (plugins, history, sticker_tags); history
    is [] when no contact_jid is given.
    """
    params = {}
    if contact_jid:
        params = {"contact": contact_jid, "limit": MAX_HISTORY_FETCH}

    async with httpx.AsyncClient(timeout=5.0) as client:
        res = await client.get(
            f"{WEB_APP_URL}/api/internal/sessions/{session_id}/plugins",
            headers={"x-internal-secret": INTERNAL_API_SECRET},
            params=params,
        )
        res.raise_for_status()
        data = res.json()
        return data.get("plugins", []), data.get("history", []), data.get("stickerTags", [])


async def save_message(session_id: str, contact_jid: str, role: str, text: str) -> None:
    """Appends one turn (role is 'user' or 'assistant') to a session's chat
    history. Best-effort -- a failure here shouldn't break message
    delivery, just means this turn won't be in future AI Reply context.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(
                f"{WEB_APP_URL}/api/internal/sessions/{session_id}/messages",
                headers={"x-internal-secret": INTERNAL_API_SECRET},
                json={"contact": contact_jid, "role": role, "text": text},
            )
            res.raise_for_status()
    except Exception as exc:
        print(f"[session:{session_id}] failed to save chat history: {exc}")
