import { createScheduledTask, saveNote } from './webClient.js';
import { generateQrCode } from './mediaConvert.js';

// The agent's capability registry -- the single source of truth for what
// "!ag" can actually do.
//
// Adding a capability means adding one entry here and nothing else: the
// catalog sent to the planner LLM is built from this object (see
// buildAgentCatalog), so the prompt can never drift out of sync with what
// the gateway can really execute, and the confirmation UI and validation
// both read from the same entry.
//
// Each entry declares:
//   summary        one line the planner sees, describing when to use it
//   params         the exact JSON shape the planner must emit
//   reachesOthers  true if running it puts something in front of another
//                  person. Any plan containing one of these needs the
//                  owner's explicit confirmation before it runs (see
//                  handleAgentCommand); plans that only affect the owner's
//                  own chat run straight away.
//   contactParam   name of the param holding a person's name, if any --
//                  what the gateway resolves against the real contact book
//   validate       returns null if the step is usable, else a reason string
//   describe       renders the step as a line of the plan the owner sees
//   execute        performs it

const MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_DELAY_MS = 10 * 1000;

// Reuses the "5m" / "1h30m" / "2h" grammar !timer already understands, so
// there's one way to write a duration across the whole bot rather than a
// second, subtly-different agent-only one.
export function parseAgentDelay(value, parseTimerArgs) {
  const parsed = parseTimerArgs(value);
  if (!parsed) return null;
  const { durationMs } = parsed;
  if (durationMs < MIN_DELAY_MS || durationMs > MAX_DELAY_MS) return null;
  return durationMs;
}

function requireString(step, field, max) {
  const value = step[field];
  if (typeof value !== 'string' || !value.trim()) return `missing "${field}"`;
  if (value.length > max) return `"${field}" is too long`;
  return null;
}

function quoted(text) {
  return `"${String(text).replace(/\s+/g, ' ').trim()}"`;
}

export const AGENT_ACTIONS = {
  message: {
    summary: 'Send a WhatsApp message to someone right now.',
    params: '{"action":"message","contact":"<name>","text":"<message to send>"}',
    reachesOthers: true,
    contactParam: 'contact',
    validate: (step) => requireString(step, 'text', 1000),
    describe: (step, resolvedLabel) => [`message ${resolvedLabel} ${quoted(step.text)}`],
    execute: async (step, ctx) => {
      const sent = await ctx.sock.sendMessage(step.resolvedJid, { text: step.text });
      ctx.markAiSent(sent?.key?.id);
    },
  },

  poll: {
    summary:
      'Send someone a native WhatsApp poll to collect an answer from them. Use when the user wants a yes/no or multiple-choice reply, not just to tell someone something.',
    params:
      '{"action":"poll","contact":"<name>","question":"<question>","options":["Yes","No"]}',
    reachesOthers: true,
    contactParam: 'contact',
    validate: (step) => {
      const bad = requireString(step, 'question', 300);
      if (bad) return bad;
      if (!Array.isArray(step.options) || step.options.length < 2) return 'needs at least 2 options';
      if (step.options.length > 12) return 'too many options';
      if (step.options.some((o) => typeof o !== 'string' || !o.trim())) return 'has a blank option';
      return null;
    },
    describe: (step, resolvedLabel) => [
      `poll ${resolvedLabel} ${quoted(step.question)} [${step.options.join(' | ')}]`,
    ],
    execute: async (step, ctx) => {
      const sent = await ctx.sock.sendMessage(step.resolvedJid, {
        poll: { name: step.question, values: step.options.slice(0, 12), selectableCount: 1 },
      });
      ctx.markAiSent(sent?.key?.id);
    },
  },

  remind: {
    summary:
      "Remind the user themselves later, in this chat. Use for anything they want to be reminded of -- nobody else sees it.",
    params: '{"action":"remind","delay":"<duration like 30m or 2h>","text":"<what to remind them>"}',
    reachesOthers: false,
    validate: (step) => requireString(step, 'delay', 40) || requireString(step, 'text', 500),
    describe: (step) => [`remind me in ${step.delay} ${quoted(step.text)}`],
    execute: async (step, ctx) => {
      // Reuses the persisted scheduler's existing timer_done handler --
      // survives reconnects and redeploys, unlike an in-memory timeout.
      await createScheduledTask({
        sessionId: ctx.userId,
        type: 'timer_done',
        payload: { jid: ctx.chatJid, label: step.text },
        runAt: new Date(Date.now() + step.resolvedDelayMs).toISOString(),
      });
    },
  },

  schedule_message: {
    summary:
      'Send someone a message later instead of right now. Use when the user says to tell someone something at a later time.',
    params:
      '{"action":"schedule_message","contact":"<name>","delay":"<duration like 30m or 2h>","text":"<message>"}',
    reachesOthers: true,
    contactParam: 'contact',
    validate: (step) => requireString(step, 'delay', 40) || requireString(step, 'text', 1000),
    describe: (step, resolvedLabel) => [
      `message ${resolvedLabel} in ${step.delay} ${quoted(step.text)}`,
    ],
    execute: async (step, ctx) => {
      await createScheduledTask({
        sessionId: ctx.userId,
        type: 'broadcast_message',
        payload: { jid: step.resolvedJid, message: step.text },
        runAt: new Date(Date.now() + step.resolvedDelayMs).toISOString(),
      });
    },
  },

  note: {
    summary:
      'Save something for the user to recall later by typing #name in any chat. Use when they ask to remember or note something down.',
    params: '{"action":"note","name":"<short-name>","text":"<what to remember>"}',
    reachesOthers: false,
    validate: (step) => {
      const bad = requireString(step, 'name', 40) || requireString(step, 'text', 2000);
      if (bad) return bad;
      if (!/^[a-z0-9_-]+$/i.test(step.name.trim())) return 'name must be a single plain word';
      return null;
    },
    describe: (step) => [`note ${step.name.trim().toLowerCase()} = ${quoted(step.text)}`],
    execute: async (step, ctx) => {
      await saveNote({
        sessionId: ctx.userId,
        name: step.name.trim().toLowerCase(),
        kind: 'text',
        text: step.text,
      });
    },
  },

  qr: {
    summary: 'Turn a link or piece of text into a scannable QR code image in this chat.',
    params: '{"action":"qr","text":"<link or text to encode>"}',
    reachesOthers: false,
    validate: (step) => requireString(step, 'text', 1000),
    describe: (step) => [`qr ${quoted(step.text)}`],
    execute: async (step, ctx) => {
      const png = await generateQrCode(step.text, []);
      const sent = await ctx.sock.sendMessage(ctx.chatJid, { image: png });
      ctx.markAiSent(sent?.key?.id);
    },
  },
};

// Not exported -- only buildAgentCatalog (below, same file) needs it.
const AGENT_ACTION_NAMES = Object.keys(AGENT_ACTIONS);

// What gets sent to the planner so it knows the exact menu of things it
// may emit. Derived, never hand-written -- see the note at the top.
export function buildAgentCatalog() {
  return AGENT_ACTION_NAMES.map((name) => ({
    name,
    summary: AGENT_ACTIONS[name].summary,
    params: AGENT_ACTIONS[name].params,
  }));
}
