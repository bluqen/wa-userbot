import { fetchDueTasks, completeScheduledTask } from './webClient.js';
import { getSession } from './whatsappManager.js';

// One minute is plenty -- every task type so far (block durations) operates
// on hour-granularity, so up to ~60s of lateness is a non-issue. Keep this
// a single constant rather than making it configurable per task type.
const POLL_INTERVAL_MS = 60 * 1000;

// type -> async ({sessionId, payload}, sessionEntry) => boolean (true =
// done, mark complete; false/throws = not ready yet, retried next tick).
// Add a new entry here for every future reusable-scheduler feature -- no
// schema or route change needed, just a new `type` string end to end.
const handlers = {
  unblock_contact: async ({ payload }, entry) => {
    await entry.sock.updateBlockStatus(payload.jid, 'unblock');
    return true;
  },
};

async function runDueTasks(gatewayUrl) {
  let tasks;
  try {
    tasks = await fetchDueTasks(gatewayUrl);
  } catch (err) {
    console.error('Scheduler: failed to fetch due tasks:', err.message);
    return;
  }

  for (const task of tasks) {
    const handler = handlers[task.type];
    if (!handler) {
      console.error(`Scheduler: no handler for task type "${task.type}" (task ${task.id})`);
      continue;
    }

    // Not connected on this process right now (e.g. mid-reconnect after a
    // restart) -- leave incomplete, it'll be picked up again next tick
    // once reconnectKnownSessions() brings the socket back.
    const entry = getSession(task.sessionId);
    if (!entry || entry.status !== 'connected') continue;

    try {
      const payload = JSON.parse(task.payload || '{}');
      const done = await handler({ sessionId: task.sessionId, payload }, entry);
      if (done) await completeScheduledTask(task.id);
    } catch (err) {
      console.error(`Scheduler: handler for task ${task.id} (${task.type}) failed:`, err.message);
    }
  }
}

let running = false;
async function tick(gatewayUrl) {
  if (running) return; // don't let a slow web round trip cause overlapping ticks
  running = true;
  try {
    await runDueTasks(gatewayUrl);
  } finally {
    running = false;
  }
}

export function startScheduler(gatewayUrl) {
  tick(gatewayUrl);
  setInterval(() => tick(gatewayUrl), POLL_INTERVAL_MS);
}
