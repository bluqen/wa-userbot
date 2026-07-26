const WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3000';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

// Node's fetch throws a bare "TypeError: fetch failed" for anything that
// never got an HTTP response at all (DNS failure, connection refused/reset,
// timeout) -- the actually useful detail (e.g. ECONNREFUSED, ENOTFOUND)
// lives on err.cause, which callers logging just err.message miss entirely.
// Every caller of this module's functions should log through this instead
// of raw err.message so a misconfigured WEB_APP_URL is diagnosable from
// logs alone instead of everything just saying "fetch failed".
export function describeFetchError(err) {
  return err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message;
}

// Every session (id + phoneNumber) the web app has on record as assigned
// to this exact gateway instance and not explicitly disconnected -- used
// on startup to reconnect whatever was live before the process restarted.
export async function fetchSessionsForGateway(gatewayUrl) {
  const res = await fetch(
    `${WEB_APP_URL}/api/internal/gateway-sessions?gatewayUrl=${encodeURIComponent(gatewayUrl)}`,
    { headers: { 'x-internal-secret': INTERNAL_API_SECRET } },
  );
  if (!res.ok) throw new Error(`web app responded ${res.status}`);
  const data = await res.json();
  return data.sessions || [];
}

// Generic, reusable persisted scheduler -- see web/prisma/schema.prisma's
// ScheduledTask model and gateway/src/scheduler.js. `type` + `payload` are
// deliberately untyped here; each task type's shape is only meaningful to
// its own handler in scheduler.js.
export async function createScheduledTask({ sessionId, type, payload, runAt }) {
  const res = await fetch(`${WEB_APP_URL}/api/internal/scheduled-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_API_SECRET },
    body: JSON.stringify({ sessionId, type, payload, runAt }),
  });
  if (!res.ok) throw new Error(`web app responded ${res.status}`);
  return res.json();
}

// Every not-yet-completed task whose runAt has passed, for sessions
// assigned to this gateway instance.
export async function fetchDueTasks(gatewayUrl) {
  const res = await fetch(
    `${WEB_APP_URL}/api/internal/scheduled-tasks?gatewayUrl=${encodeURIComponent(gatewayUrl)}`,
    { headers: { 'x-internal-secret': INTERNAL_API_SECRET } },
  );
  if (!res.ok) throw new Error(`web app responded ${res.status}`);
  const data = await res.json();
  return data.tasks || [];
}

export async function completeScheduledTask(taskId) {
  const res = await fetch(`${WEB_APP_URL}/api/internal/scheduled-tasks/${taskId}/complete`, {
    method: 'POST',
    headers: { 'x-internal-secret': INTERNAL_API_SECRET },
  });
  if (!res.ok) throw new Error(`web app responded ${res.status}`);
}

// Teaches the bot a sticker via "/savesticker <tag>" (see whatsappManager.js's
// handleSaveStickerCommand) -- upserts by (sessionId, tag), so re-saving a
// tag overwrites it.
export async function saveSticker({ sessionId, tag, data, mimetype }) {
  // The only call in this module with a real body (a base64-encoded image,
  // sometimes a few hundred KB) instead of a small query -- large enough
  // that a slow upload could hang past whatever Node's own default is.
  // An explicit timeout turns that into a clear "timeout" error instead of
  // an indefinite wait that eventually surfaces as a bare "fetch failed".
  const res = await fetch(`${WEB_APP_URL}/api/internal/stickers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_API_SECRET },
    body: JSON.stringify({ sessionId, tag, data, mimetype }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`web app responded ${res.status}`);
  return res.json();
}

// Fetches one saved sticker's binary (as a Buffer) by session+tag, right
// before sending it. Returns null on a 404 -- the tag may have been
// deleted since the plugin engine last knew about it. Same reasoning as
// saveSticker's timeout below -- without one, a slow/hung request here
// fails silently from the WhatsApp side: the reply text still sends fine
// (a separate, independent call), so the only symptom is "sometimes the
// sticker just doesn't show up," with nothing pointing at why.
export async function fetchSticker(sessionId, tag) {
  const res = await fetch(
    `${WEB_APP_URL}/api/internal/stickers/${encodeURIComponent(sessionId)}/${encodeURIComponent(tag)}`,
    {
      headers: { 'x-internal-secret': INTERNAL_API_SECRET },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`web app responded ${res.status}`);
  const data = await res.json();
  return Buffer.from(data.data, 'base64');
}
