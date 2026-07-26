// Server-side only helper for talking to a WhatsApp gateway instance. Never
// import this from client components -- the gateway has no auth of its own
// and trusts whatever session id it's given, so all access must be
// arbitrated through our own API routes after checking the caller owns
// that session.
//
// Every call takes the target gateway's base URL explicitly (from
// session.gatewayUrl, assigned at creation by lib/shards.ts) rather than
// assuming a single gateway -- a session's data always lives on whichever
// instance it was paired through.

export type SessionStatus = {
  status: 'none' | 'connecting' | 'connected' | 'disconnected' | 'logged_out';
  pairingCode: string | null;
};

// A gateway instance that's crash-looping, mid-restart, or otherwise stuck
// can leave a request pending indefinitely -- plain fetch() has no timeout
// of its own. Without one, a single unresponsive shard can hang every route
// that calls it, and since the owner's sessions page polls GET /api/sessions
// (which calls gatewayStatus for every live session) every 5s and only
// clears its initial loading state once that resolves, that shows up as the
// whole page spinning on "Loading..." forever instead of just that one
// session failing to refresh.
const GATEWAY_TIMEOUT_MS = 10000;

export async function gatewayPair(
  gatewayUrl: string,
  sessionId: string,
  phoneNumber: string,
): Promise<SessionStatus> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gateway pair failed: ${res.status}`);
  return res.json();
}

export async function gatewayStatus(gatewayUrl: string, sessionId: string): Promise<SessionStatus> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/status`, {
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gateway status failed: ${res.status}`);
  return res.json();
}

export async function gatewayLogout(gatewayUrl: string, sessionId: string): Promise<void> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/logout`, {
    method: 'POST',
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gateway logout failed: ${res.status}`);
}

export async function gatewayReconnect(
  gatewayUrl: string,
  sessionId: string,
  phoneNumber: string,
): Promise<SessionStatus> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/reconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
    // reconnectSession() on the gateway already bounds itself to ~8s of
    // waiting on saved creds before falling back to a fresh pairing code --
    // give it a bit of headroom beyond that rather than matching exactly.
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`gateway reconnect failed: ${res.status}`);
  return res.json();
}
