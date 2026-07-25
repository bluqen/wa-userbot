import time
from collections import defaultdict

# Nothing here stops a *human* conversation -- it stops the case where the
# other side is also an automated bot (e.g. their own AI auto-reply) and the
# two end up replying to each other back-to-back with no human involved,
# burning through the LLM provider's rate limit in seconds. Machine-speed
# ping-pong trips this within a few replies; a real conversation never gets
# close.
MAX_REPLIES_PER_WINDOW = 6
WINDOW_SECONDS = 60
COOLDOWN_SECONDS = 5 * 60

_reply_timestamps: dict[tuple[str, str], list[float]] = defaultdict(list)
_paused_until: dict[tuple[str, str], float] = {}


def is_rate_limited(session_id: str, from_jid: str) -> bool:
    key = (session_id, from_jid)
    now = time.monotonic()

    paused_until = _paused_until.get(key)
    if paused_until is not None:
        if now < paused_until:
            return True
        del _paused_until[key]

    timestamps = _reply_timestamps[key]
    cutoff = now - WINDOW_SECONDS
    while timestamps and timestamps[0] < cutoff:
        timestamps.pop(0)

    if len(timestamps) >= MAX_REPLIES_PER_WINDOW:
        _paused_until[key] = now + COOLDOWN_SECONDS
        print(
            f"[rate-limit] {session_id}/{from_jid} sent {len(timestamps)} replies in "
            f"{WINDOW_SECONDS}s -- pausing auto-replies to this contact for {COOLDOWN_SECONDS}s"
        )
        return True

    return False


def record_reply(session_id: str, from_jid: str) -> None:
    _reply_timestamps[(session_id, from_jid)].append(time.monotonic())
