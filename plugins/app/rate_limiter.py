import time

from .stale_cache import maybe_sweep

# Nothing here stops a *human* conversation -- it stops the case where the
# other side is also an automated bot (e.g. their own AI auto-reply) and the
# two end up replying to each other back-to-back with no human involved,
# burning through the LLM provider's rate limit in seconds. Machine-speed
# ping-pong trips this within a few replies; a real conversation never gets
# close.
MAX_REPLIES_PER_WINDOW = 6
WINDOW_SECONDS = 60
COOLDOWN_SECONDS = 5 * 60

# This is called for *every* incoming message across every session, so it's
# the fastest-growing of this codebase's per-contact tracking dicts --
# empty/expired entries are dropped outright (not just left as an empty
# list) so a contact who goes quiet stops costing memory at all, instead of
# lingering here forever. See stale_cache.py for the additional periodic
# sweep that catches a contact's last few timestamps that never quite aged
# out because they simply never messaged again.
_reply_timestamps: dict[tuple[str, str], list[float]] = {}
_paused_until: dict[tuple[str, str], float] = {}


def is_rate_limited(session_id: str, from_jid: str) -> bool:
    key = (session_id, from_jid)
    now = time.monotonic()

    paused_until = _paused_until.get(key)
    if paused_until is not None:
        if now < paused_until:
            return True
        del _paused_until[key]

    timestamps = _reply_timestamps.get(key)
    if timestamps is not None:
        cutoff = now - WINDOW_SECONDS
        while timestamps and timestamps[0] < cutoff:
            timestamps.pop(0)
        if not timestamps:
            del _reply_timestamps[key]
            timestamps = None

    maybe_sweep(_reply_timestamps, lambda ts: not ts or ts[-1] < now - WINDOW_SECONDS)
    maybe_sweep(_paused_until, lambda until: until < now)

    if timestamps is not None and len(timestamps) >= MAX_REPLIES_PER_WINDOW:
        _paused_until[key] = now + COOLDOWN_SECONDS
        print(
            f"[rate-limit] {session_id}/{from_jid} sent {len(timestamps)} replies in "
            f"{WINDOW_SECONDS}s -- pausing auto-replies to this contact for {COOLDOWN_SECONDS}s"
        )
        return True

    return False


def record_reply(session_id: str, from_jid: str) -> None:
    _reply_timestamps.setdefault((session_id, from_jid), []).append(time.monotonic())
