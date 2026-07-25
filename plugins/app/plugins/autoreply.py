import time
from typing import Optional, Tuple

from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings

# (session_id, contact_jid) -> unix timestamp of the last auto-reply sent.
# In-memory and per-process -- resets on restart, fine for a single engine
# instance. Move to Redis/DB if this ever runs as multiple replicas.
_last_replied: dict[Tuple[str, str], float] = {}


class AutoReplyPlugin(Plugin):
    """Replies with a fixed message. Configurable per session via the
    dashboard: the reply text, whether to reply in group chats, whether to
    simulate typing before sending, and a cooldown so the same contact
    doesn't get auto-replied to repeatedly. Individual contacts can get
    their own overrides (or be excluded entirely) via `exceptions`.
    """

    name = "autoreply"
    priority = 100

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return False

        cooldown_minutes = config.get("cooldownMinutes", 0)
        if cooldown_minutes:
            last = _last_replied.get((ctx.user_id, ctx.from_jid))
            if last and (time.time() - last) < cooldown_minutes * 60:
                return False

        return True

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        config = resolve_settings(self.config, ctx.from_jid)

        cooldown_minutes = config.get("cooldownMinutes", 0)
        if cooldown_minutes:
            _last_replied[(ctx.user_id, ctx.from_jid)] = time.time()

        return Reply(
            text=config.get("message", "Thanks for your message! I'll get back to you soon."),
            show_typing=bool(config.get("showTyping", False)),
            typing_delay_ms=int(config.get("typingDurationMs", 0)),
        )
