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

export async function gatewayPair(
  gatewayUrl: string,
  sessionId: string,
  phoneNumber: string,
): Promise<SessionStatus> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber }),
  });
  if (!res.ok) throw new Error(`gateway pair failed: ${res.status}`);
  return res.json();
}

export async function gatewayStatus(gatewayUrl: string, sessionId: string): Promise<SessionStatus> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/status`);
  if (!res.ok) throw new Error(`gateway status failed: ${res.status}`);
  return res.json();
}

export async function gatewayLogout(gatewayUrl: string, sessionId: string): Promise<void> {
  const res = await fetch(`${gatewayUrl}/session/${sessionId}/logout`, { method: 'POST' });
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
  });
  if (!res.ok) throw new Error(`gateway reconnect failed: ${res.status}`);
  return res.json();
}
