const WEB_APP_URL = process.env.WEB_APP_URL || 'http://localhost:3000';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || '';

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
