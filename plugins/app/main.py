import asyncio
import base64
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Must run before any local import below -- plugin_loader imports every
# plugin module at discovery time, and several of them (e.g. ai_reply) read
# API keys from the environment at their own module-import time. If .env
# hasn't been loaded yet, those reads silently bake in empty strings.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI

from . import agent, llm
from .models import (
    AgentPlanRequest,
    AgentPlanResponse,
    AskRequest,
    AskResponse,
    AudioPayload,
    ImagePayload,
    IncomingMessage,
    ReplyResponse,
    RewriteResponse,
)
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
    try:
        configs, history, sticker_tags = await fetch_session_context(msg.user_id, msg.from_jid)
    except Exception as exc:
        print(f"[session:{msg.user_id}] failed to fetch plugin config: {exc}")
        return ReplyResponse(reply=None)

    text = msg.text
    is_voice = False
    # A voice note arrives with no text at all -- transcribe it via Groq
    # Whisper and treat the result exactly like a typed message from here
    # on, so every existing plugin (keyword autoreply, AI Reply, etc.)
    # just works without knowing voice notes exist. Only bother if
    # something is actually enabled to consume it -- transcription is a
    # real API call, not worth making for a session with nothing that
    # would ever act on the result.
    if not text and msg.audio and llm.has_provider() and any(c.get("enabled") for c in configs):
        try:
            audio_bytes = base64.b64decode(msg.audio.data)
            text = llm.transcribe_audio(audio_bytes, msg.audio.mimetype) or ""
            is_voice = bool(text)
        except Exception as exc:
            print(f"[session:{msg.user_id}] voice note transcription failed: {exc}")

    # A sticker with no caption also arrives with no text at all -- unlike
    # a voice note, there's nothing to transcribe into text, so this stays
    # empty and ai_reply.py reacts to the raw image itself (see its use of
    # incoming_sticker_bytes) rather than every plugin treating it as a
    # typed message.
    incoming_sticker_bytes: Optional[bytes] = None
    incoming_sticker_mimetype = "image/webp"
    is_sticker = False
    if not text and msg.sticker:
        try:
            incoming_sticker_bytes = base64.b64decode(msg.sticker.data)
            incoming_sticker_mimetype = msg.sticker.mimetype
            is_sticker = True
        except Exception as exc:
            print(f"[session:{msg.user_id}] failed to decode incoming sticker: {exc}")

    if not text and not is_sticker:
        return ReplyResponse(reply=None)

    ctx = MessageContext(
        user_id=msg.user_id,
        from_jid=msg.from_jid,
        text=text,
        history=history,
        sticker_tags=sticker_tags,
        is_voice=is_voice,
        incoming_sticker_bytes=incoming_sticker_bytes,
        incoming_sticker_mimetype=incoming_sticker_mimetype,
        from_me=msg.from_me,
        quoted_text=msg.quoted_text,
    )

    # Record the incoming message regardless of whether anything replies to
    # it, so context is preserved for whenever AI Reply next needs it.
    # Fire-and-forget: reply generation below doesn't depend on this save
    # completing, so there's no reason to block the critical path on a
    # round trip to web's internal API for it -- save_message already
    # swallows its own errors, so a failed save here is silently logged,
    # same as before, just no longer serialized in front of the reply.
    # Uses the resolved `text` (the transcript, for a voice note) so future
    # AI Reply context actually has something to work with instead of an
    # empty turn. A sticker has no text to save at all, so this is skipped
    # entirely rather than saving an empty turn.
    # A command the owner typed themselves isn't conversation -- saving
    # "!imagine a cat" as a user turn would just pollute the context AI
    # Reply builds for that contact.
    if text and not msg.from_me:
        asyncio.create_task(save_message(msg.user_id, msg.from_jid, "user", text))

    # Independent of any plugin's own cooldown setting: if this contact has
    # been sent an unusual number of auto-replies in the last minute, stop.
    # A human never triggers this at normal typing speed -- it's what
    # happens when the other side is *also* an auto-reply bot and the two
    # end up machine-gunning each other.
    #
    # Explicitly skipped for the owner's own commands: those are deliberate
    # human actions, not an auto-reply loop. Without this, running a handful
    # of commands in one chat (exactly what testing looks like) trips the
    # limiter and silences that one chat for five minutes, while every other
    # chat keeps working -- indistinguishable from "it works in some chats
    # and not others".
    if not msg.from_me and is_rate_limited(msg.user_id, msg.from_jid):
        return ReplyResponse(reply=None)

    for plugin in build_plugins(configs):
        try:
            if plugin.match(ctx):
                reply = plugin.handle(ctx)
                if reply:
                    if reply.text and not msg.from_me:
                        # Same reasoning as above -- don't make the owner
                        # wait for a history-save round trip before they
                        # get their WhatsApp reply.
                        asyncio.create_task(
                            save_message(msg.user_id, msg.from_jid, "assistant", reply.text)
                        )
                    # Answering the owner's own command must not count
                    # toward that contact's auto-reply budget either.
                    if not msg.from_me:
                        record_reply(msg.user_id, msg.from_jid)
                    return ReplyResponse(
                        reply=reply.text,
                        show_typing=reply.show_typing,
                        typing_delay_ms=reply.typing_delay_ms,
                        start_delay_ms=reply.start_delay_ms,
                        block=reply.block,
                        block_duration_hours=reply.block_duration_hours,
                        quote=reply.quote,
                        parts=reply.parts,
                        sticker_tag=reply.sticker_tag,
                        audio=AudioPayload(data=reply.audio.data, mimetype=reply.audio.mimetype)
                        if reply.audio
                        else None,
                        images=[ImagePayload(data=i.data, mimetype=i.mimetype) for i in reply.images]
                        if reply.images
                        else None,
                    )
        except Exception as exc:  # a broken plugin shouldn't take the whole engine down
            print(f"[plugin:{plugin.name}] error: {exc}")

    return ReplyResponse(reply=None)


@app.post("/ask", response_model=AskResponse)
async def handle_ask(req: AskRequest):
    """Backs the owner-only "!ai" command (see whatsappManager.js) -- a
    one-shot question-and-answer, not the ongoing conversational AI Reply
    flow. No per-session settings to fetch: the gateway already checked
    the ai_ask plugin is enabled for this session before ever calling
    this, same as it does for !tagall and !poll.
    """
    if not llm.has_provider():
        return AskResponse(answer=None)

    answer = llm.generate(
        "You are a helpful, direct assistant answering a one-off question inside a WhatsApp "
        "chat. Keep the answer concise -- a few sentences at most unless the question genuinely "
        "requires more -- and skip preamble like \"Sure, here's...\".",
        req.question,
        max_tokens=400,
        temperature=0.5,
    )
    return AskResponse(answer=answer)


@app.post("/agent/plan", response_model=AgentPlanResponse)
async def handle_agent_plan(req: AgentPlanRequest):
    """Backs the owner-only "!ag" command -- turns a plain-language
    instruction into a plan of WhatsApp actions. Planning only: nothing is
    sent from here, and no contact list is ever passed in (see agent.py for
    why). The gateway resolves the names, shows the plan to the owner, and
    only acts once they confirm.
    """
    if not llm.has_provider():
        return AgentPlanResponse(error="not_ready")

    result = agent.plan(req.instruction, [a.model_dump() for a in req.actions])
    return AgentPlanResponse(steps=result["steps"], note=result["note"])


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
