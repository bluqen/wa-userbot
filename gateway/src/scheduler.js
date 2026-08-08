import { fetchDueTasks, completeScheduledTask, describeFetchError } from './webClient.js';
import { getSession, buildOutgoingMediaContent } from './whatsappManager.js';

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
  broadcast_message: async ({ payload }, entry) => {
    await entry.sock.sendMessage(payload.jid, { text: payload.message });
    return true;
  },
  // "!timer" for anything longer than WhatsApp's ~15 minute message-edit
  // window (see whatsappManager.js's scheduleLongTimer) -- a live
  // countdown is impossible past that, so the timer is just a persisted
  // "ping this chat at runAt" instead. Persisted rather than an in-memory
  // setTimeout so it survives the routine socket reconnects that would
  // otherwise wipe it.
  // "!sm" -- replays whatever the owner replied to (text, photo with its
  // caption, document, voice note) to the chosen chat at the chosen time.
  // The bytes were captured when the command ran, so this doesn't depend
  // on the original message still existing.
  scheduled_send: async ({ payload }, entry) => {
    if (payload.kind === 'media' && payload.data) {
      const content = buildOutgoingMediaContent({
        mediaType: payload.mediaType,
        buffer: Buffer.from(payload.data, 'base64'),
        mimetype: payload.mimetype,
        caption: payload.caption,
        fileName: payload.fileName,
        ptt: payload.ptt,
      });
      if (content) {
        await entry.sock.sendMessage(payload.jid, content);
        return true;
      }
    }
    if (payload.text) {
      await entry.sock.sendMessage(payload.jid, { text: payload.text });
      return true;
    }
    // Nothing usable stored -- returning true rather than throwing so a
    // malformed task can't be retried forever on every poll.
    console.error(`Scheduler: scheduled_send task had nothing to send (jid ${payload.jid})`);
    return true;
  },

  timer_done: async ({ payload }, entry) => {
    // A custom message ("!timer 2h take the bread out") wins outright --
    // it's what the user actually wanted said. Otherwise fall back to the
    // generic ping, tagged with how long the timer ran for.
    const text = payload.label
      ? `⏰ ${payload.label}`
      : `⏰ Time's up!${payload.duration ? ` (${payload.duration} timer)` : ''}`;
    await entry.sock.sendMessage(payload.jid, { text });
    return true;
  },
};

async function runDueTasks(gatewayUrl) {
  let tasks;
  try {
    tasks = await fetchDueTasks(gatewayUrl);
  } catch (err) {
    console.error('Scheduler: failed to fetch due tasks:', describeFetchError(err));
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
