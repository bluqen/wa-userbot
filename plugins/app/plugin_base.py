from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class MessageContext:
    user_id: str  # the WhatsApp session id, not the WhatsApp end-user
    from_jid: str
    text: str
    # Prior turns with this contact, oldest first, as [{role, text}, ...]
    # (role is 'user' or 'assistant'). Populated for plugins that want
    # conversational memory (e.g. ai_reply); empty for ones that don't ask.
    history: List[dict] = field(default_factory=list)
    # Sticker tags this session has saved (see ai_reply.py's sticker
    # marker handling) -- fetched alongside plugin config/history in the
    # same round trip, not a separate call.
    sticker_tags: List[str] = field(default_factory=list)


@dataclass
class Reply:
    # None means "nothing worth sending" -- used for a block-only reply,
    # where the only thing that happened is `block` below.
    text: Optional[str] = None
    show_typing: bool = False
    typing_delay_ms: int = 0
    block: bool = False
    block_duration_hours: int = 0
    # Reply to the specific incoming message (WhatsApp's "swipe reply")
    # instead of sending a plain new message.
    quote: bool = False
    # If set, send these in sequence as separate messages instead of
    # `text` as one -- a short human-like pause between each is added by
    # the gateway. Mutually exclusive with `quote` in practice (see
    # ai_reply.py), but nothing here enforces that -- it's just how the
    # one plugin that uses this happens to decide.
    parts: Optional[List[str]] = None
    # Tag of a saved sticker to send alongside `text` -- see ai_reply.py.
    sticker_tag: Optional[str] = None


def resolve_settings(config: dict, from_jid: str) -> dict:
    """Merges a per-contact exception's overrides onto a plugin's base
    config, so plugins can treat the result as if it were the only config
    that ever existed for this contact. Matching is by phone number
    (digits only, extracted from the JID) against each exception entry's
    `phoneNumber`. An override of `{"enabled": false}` is how a contact
    gets excluded entirely, even while the plugin is on for everyone else.
    """
    exceptions = config.get("exceptions") or []
    if not exceptions:
        return config

    contact_number = "".join(ch for ch in from_jid.split("@")[0] if ch.isdigit())
    if not contact_number:
        return config

    for entry in exceptions:
        exception_number = "".join(ch for ch in str(entry.get("phoneNumber", "")) if ch.isdigit())
        if exception_number and exception_number == contact_number:
            return {**config, **(entry.get("overrides") or {})}

    return config


class Plugin(ABC):
    """Base class for every reply plugin.

    To add a new plugin:
      1. Create a file in app/plugins/, e.g. app/plugins/my_plugin.py
      2. Subclass Plugin, set a unique `name` and a `priority`
         (lower priority numbers run first; first match wins).
      3. Implement `match` (should this plugin handle this message?)
         and `handle` (return a Reply, or None to pass through).
      4. Give it a settings UI on the web dashboard so users can
         configure and enable it per WhatsApp session -- the plugin
         itself just receives whatever settings dict was saved.

    The loader auto-discovers any Plugin subclass under app/plugins/;
    no registration code needed elsewhere.
    """

    name: str = "unnamed"
    priority: int = 100

    def __init__(self, config: dict):
        self.config = config or {}

    @abstractmethod
    def match(self, ctx: MessageContext) -> bool:
        ...

    @abstractmethod
    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        ...
