import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

from .. import llm
from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings
from ..stale_cache import maybe_sweep

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

WEB_APP_URL = os.environ.get("WEB_APP_URL", "http://localhost:3000")
INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")

LEAD_EXTRACTION_PROMPT = (
    "You quietly extract sales-lead signals from one customer message, for a "
    "business owner's own private reference -- this is never shown to the "
    "customer. Reply with EXACTLY one line and nothing else: "
    '[[LEAD:none]] if this message has no name/need/budget/timeline signal '
    "worth noting, otherwise [[LEAD:<short summary, under 25 words>]]."
)

LEAD_MARKER_RE = re.compile(r"\[\[LEAD:(.+?)\]\]", re.DOTALL)

# (session_id, contact_jid) -> unix timestamp of the last extraction
# attempt -- bounds how often this makes an LLM call per contact. Swept
# like every other per-contact dict in this codebase (see stale_cache.py)
# so it doesn't grow forever.
_last_extracted: dict = {}
_STALE_AFTER_SECONDS = 24 * 60 * 60


class LeadCapturePlugin(Plugin):
    """Quietly extracts sales-lead signals (name/need/budget/timeline) from
    incoming conversations and logs them for the account owner to review
    on the dashboard. Never replies to the customer -- always returns None
    so ai_reply/autoreply still handle the message normally; this only
    ever runs a side-effect (saving a lead), nothing user-visible.
    """

    name = "leads"
    priority = 20  # runs early, but never "handles" a message either way

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False
        if ctx.from_jid.endswith("@g.us"):
            return False

        cooldown_minutes = int(config.get("cooldownMinutes", 30))
        last = _last_extracted.get((ctx.user_id, ctx.from_jid))
        if last and time.time() - last < cooldown_minutes * 60:
            return False

        return llm.has_provider()

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        key = (ctx.user_id, ctx.from_jid)
        _last_extracted[key] = time.time()
        maybe_sweep(_last_extracted, lambda ts: time.time() - ts > _STALE_AFTER_SECONDS)

        text = llm.generate(LEAD_EXTRACTION_PROMPT, ctx.text, max_tokens=60, temperature=0.2)
        if not text:
            return None

        match = LEAD_MARKER_RE.search(text)
        if not match:
            return None
        summary = match.group(1).strip()
        if not summary or summary.lower() == "none":
            return None

        try:
            with httpx.Client(timeout=8.0) as client:
                client.post(
                    f"{WEB_APP_URL}/api/internal/leads",
                    headers={"x-internal-secret": INTERNAL_API_SECRET},
                    json={"sessionId": ctx.user_id, "contactJid": ctx.from_jid, "summary": summary},
                )
        except Exception as exc:
            print(f"[leads] failed to save lead for {ctx.from_jid}: {exc}")

        return None
