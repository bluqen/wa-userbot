import random
from typing import Callable, Dict, Hashable, TypeVar

# Shared cleanup for the handful of per-(session, contact) tracking dicts
# in this codebase (rate limiting, cooldowns) -- without this, each one
# grows by one entry for every distinct contact ever seen, kept for the
# entire lifetime of this long-running process. On a memory-constrained
# host that's a real, if slow, leak: a bot with steady message volume
# across many different contacts eventually exhausts available memory
# with nothing but stale bookkeeping for people who stopped messaging
# weeks ago.
#
# Swept probabilistically rather than on every call (which would mean
# scanning the whole dict per message) or on a background timer (there's
# no async event loop tick guaranteed to run independently of a plugin's
# own synchronous work here).
SWEEP_PROBABILITY = 0.01

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


def maybe_sweep(d: Dict[K, V], is_stale: Callable[[V], bool]) -> None:
    if random.random() > SWEEP_PROBABILITY:
        return
    stale_keys = [k for k, v in d.items() if is_stale(v)]
    for k in stale_keys:
        del d[k]
