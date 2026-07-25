import asyncio
from pathlib import Path

from dotenv import load_dotenv

# Must run before any local import below -- plugin_loader imports every
# plugin module at discovery time, and several of them (e.g. ai_reply) read
# API keys from the environment at their own module-import time. If .env
# hasn't been loaded yet, those reads silently bake in empty strings.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI

from .models import IncomingMessage, ReplyResponse, RewriteResponse
from .plugin_base import MessageContext
from .plugin_loader import build_plugins
from .plugins.ai_write import AIWritePlugin
from .rate_limiter import is_rate_limited, record_reply
from .session_config import fetch_session_context, fetch_session_plugins, save_message

app = FastAPI(title="WhatsApp Plugin Engine")


# Uptime monitors commonly probe with HEAD instead of GET (e.g. UptimeRobot
# defaults to HEAD) -- FastAPI doesn't auto-accept HEAD on a GET-only route,
# so it 405s and the monitor reports a false "down". Accept both explicitly.
@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok"}


@app.get("/session/{session_id}/exception-numbers")
async def exception_numbers(session_id: str):
    """Every phone number referenced in this session's per-contact
    exceptions, across all plugins. The gateway calls this so it can
    proactively resolve each number's WhatsApp LID (via onWhatsApp) and
    match incoming messages addressed by LID back to the phone number an
    exception was actually configured for -- see whatsappManager.js.
    """
    try:
        configs = await fetch_session_plugins(session_id)
    except Exception as exc:
        print(f"[session:{session_id}] failed to fetch plugin config: {exc}")
        return {"phoneNumbers": []}

    numbers = set()
    for config in configs:
        settings = config.get("settings") or {}
        for exception in settings.get("exceptions", []):
            phone = exception.get("phoneNumber")
            if phone:
                numbers.add(phone)

    return {"phoneNumbers": sorted(numbers)}


@app.post("/message", response_model=ReplyResponse)
async def handle_message(msg: IncomingMessage):
    print(f"[debug] incoming message from_jid={msg.from_jid!r} text={msg.text!r}")

    try:
        configs, history, sticker_tags = await fetch_session_context(msg.user_id, msg.from_jid)
    except Exception as exc:
        print(f"[session:{msg.user_id}] failed to fetch plugin config: {exc}")
        return ReplyResponse(reply=None)

    ctx = MessageContext(
        user_id=msg.user_id,
        from_jid=msg.from_jid,
        text=msg.text,
        history=history,
        sticker_tags=sticker_tags,
    )

    # Record the incoming message regardless of whether anything replies to
    # it, so context is preserved for whenever AI Reply next needs it.
    # Fire-and-forget: reply generation below doesn't depend on this save
    # completing, so there's no reason to block the critical path on a
    # round trip to web's internal API for it -- save_message already
    # swallows its own errors, so a failed save here is silently logged,
    # same as before, just no longer serialized in front of the reply.
    asyncio.create_task(save_message(msg.user_id, msg.from_jid, "user", msg.text))

    # Independent of any plugin's own cooldown setting: if this contact has
    # been sent an unusual number of auto-replies in the last minute, stop.
    # A human never triggers this at normal typing speed -- it's what
    # happens when the other side is *also* an auto-reply bot and the two
    # end up machine-gunning each other.
    if is_rate_limited(msg.user_id, msg.from_jid):
        return ReplyResponse(reply=None)

    for plugin in build_plugins(configs):
        try:
            if plugin.match(ctx):
                reply = plugin.handle(ctx)
                if reply:
                    if reply.text:
                        # Same reasoning as above -- don't make the owner
                        # wait for a history-save round trip before they
                        # get their WhatsApp reply.
                        asyncio.create_task(
                            save_message(msg.user_id, msg.from_jid, "assistant", reply.text)
                        )
                    record_reply(msg.user_id, msg.from_jid)
                    return ReplyResponse(
                        reply=reply.text,
                        show_typing=reply.show_typing,
                        typing_delay_ms=reply.typing_delay_ms,
                        block=reply.block,
                        block_duration_hours=reply.block_duration_hours,
                        quote=reply.quote,
                        parts=reply.parts,
                        sticker_tag=reply.sticker_tag,
                    )
        except Exception as exc:  # a broken plugin shouldn't take the whole engine down
            print(f"[plugin:{plugin.name}] error: {exc}")

    return ReplyResponse(reply=None)


@app.post("/rewrite", response_model=RewriteResponse)
async def handle_rewrite(msg: IncomingMessage):
    """Called for the userbot owner's own outgoing messages -- instant
    edit/rewrite via the ai_write plugin, if enabled for this session.
    """
    try:
        configs = await fetch_session_plugins(msg.user_id)
    except Exception as exc:
        print(f"[session:{msg.user_id}] failed to fetch plugin config: {exc}")
        return RewriteResponse(rewritten=None)

    entry = next((c for c in configs if c.get("key") == "ai_write" and c.get("enabled")), None)
    if not entry:
        return RewriteResponse(rewritten=None)

    plugin = AIWritePlugin(entry.get("settings") or {})
    if not plugin.should_process(msg.user_id, msg.from_jid, msg.text):
        return RewriteResponse(rewritten=None)

    try:
        rewritten = plugin.rewrite(msg.user_id, msg.from_jid, msg.text)
    except Exception as exc:
        print(f"[ai_write] error: {exc}")
        return RewriteResponse(rewritten=None)

    return RewriteResponse(rewritten=rewritten)
