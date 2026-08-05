from typing import List, Optional

from pydantic import BaseModel, Field


class AudioPayload(BaseModel):
    data: str  # base64-encoded raw bytes, straight off WhatsApp's media CDN
    mimetype: str = "audio/ogg"


class ImagePayload(BaseModel):
    data: str  # base64-encoded raw bytes
    mimetype: str = "image/jpeg"


class IncomingMessage(BaseModel):
    user_id: str
    from_jid: str = Field(alias="from")
    text: str = ""
    # Present only for a voice note WhatsApp gave no text for -- see
    # main.py's /message handler, which transcribes it via Groq Whisper
    # and treats the result exactly like typed text from then on.
    audio: Optional[AudioPayload] = None
    # Present only for an incoming sticker with no caption -- see main.py,
    # which lets ai_reply.py react to it via Gemini's vision input instead
    # of requiring text.
    sticker: Optional[ImagePayload] = None
    # True when this is a command the account owner typed themselves (see
    # whatsappManager.js's PLUGIN_COMMAND_RE) rather than a message from
    # someone else. Such a command is a deliberate human action, so it must
    # not count toward the anti-bot-loop rate limiter, and it isn't
    # conversation worth saving as chat history.
    from_me: bool = False
    # The text of whatever message this one is quote-replying to, if any --
    # empty otherwise. Lets a plugin act on a reply ("reply with !tl es")
    # without the content being retyped inline every time. See translate.py.
    quoted_text: str = ""

    model_config = {"populate_by_name": True}


class ReplyResponse(BaseModel):
    reply: Optional[str] = None
    show_typing: bool = False
    typing_delay_ms: int = 0
    start_delay_ms: int = 0
    block: bool = False
    block_duration_hours: int = 0
    quote: bool = False
    parts: Optional[List[str]] = None
    sticker_tag: Optional[str] = None
    # A real audio/music file to send alongside `reply` -- see song.py.
    # Reuses AudioPayload (same {data, mimetype} shape as the incoming
    # voice-note case above) since the wire format is identical either way.
    audio: Optional[AudioPayload] = None
    # Real image file(s) to send alongside `reply` -- see pinterest.py and
    # imagine.py. A list (not a single image) since /pinterest sends a
    # small handful of results at once.
    images: Optional[List[ImagePayload]] = None


class RewriteResponse(BaseModel):
    rewritten: Optional[str] = None


class AskRequest(BaseModel):
    user_id: str
    question: str


class AskResponse(BaseModel):
    answer: Optional[str] = None
