from typing import List, Optional

from pydantic import BaseModel, Field


class IncomingMessage(BaseModel):
    user_id: str
    from_jid: str = Field(alias="from")
    text: str

    model_config = {"populate_by_name": True}


class ReplyResponse(BaseModel):
    reply: Optional[str] = None
    show_typing: bool = False
    typing_delay_ms: int = 0
    block: bool = False
    block_duration_hours: int = 0
    quote: bool = False
    parts: Optional[List[str]] = None
    sticker_tag: Optional[str] = None


class RewriteResponse(BaseModel):
    rewritten: Optional[str] = None
