export type PluginKey =
  | 'autoreply'
  | 'ai_reply'
  | 'ai_write'
  | 'song'
  | 'anti_delete'
  | 'notes'
  | 'welcome'
  | 'antilink'
  | 'games'
  | 'broadcast'
  | 'tagall'
  | 'polls'
  | 'statusview'
  | 'sudo'
  | 'leads'
  | 'imagine'
  | 'pinterest'
  | 'ai_ask'
  | 'media_convert'
  | 'qr'
  | 'translate'
  | 'timer'
  | 'session_status'
  | 'emoji_animate'
  | 'agent'
  | 'scheduled_send';

export const PLUGIN_KEYS: PluginKey[] = [
  'autoreply',
  'ai_reply',
  'ai_write',
  'song',
  'anti_delete',
  'notes',
  'welcome',
  'antilink',
  'games',
  'broadcast',
  'tagall',
  'polls',
  'statusview',
  'sudo',
  'leads',
  'imagine',
  'pinterest',
  'ai_ask',
  'media_convert',
  'qr',
  'translate',
  'timer',
  'session_status',
  'emoji_animate',
  'agent',
  'scheduled_send',
];

export const PLUGIN_META: Record<PluginKey, { name: string; description: string; icon: string }> = {
  autoreply: {
    name: 'Auto Reply',
    description: 'Reply automatically with a fixed message.',
    icon: '💬',
  },
  ai_reply: {
    name: 'AI Reply',
    description: 'AI-powered replies in a personality of your choosing.',
    icon: '🤖',
  },
  ai_write: {
    name: 'AI Write',
    description: 'Fix typos or rewrite your own messages before sending.',
    icon: '✍️',
  },
  song: {
    name: 'Song Fetcher',
    description: 'Sends a royalty-free track via "!song <genre>".',
    icon: '🎵',
  },
  anti_delete: {
    name: 'Anti-Delete',
    description: 'Privately notifies you when a message gets deleted.',
    icon: '🗑️',
  },
  notes: {
    name: 'Notes',
    description: 'Save and recall snippets with "!savenote" and "#name".',
    icon: '📝',
  },
  welcome: {
    name: 'Greetings',
    description: 'Greets new members and says goodbye when they leave.',
    icon: '👋',
  },
  antilink: {
    name: 'Anti-Link',
    description: 'Deletes links from non-admins in groups.',
    icon: '🔗',
  },
  games: {
    name: 'Fun',
    description: 'Trivia, rps, 8-ball, memes, and voice effects.',
    icon: '🎮',
  },
  broadcast: {
    name: 'Broadcasts',
    description: 'Send a message to a list of contacts, now or later.',
    icon: '📢',
  },
  tagall: {
    name: 'Tag Everyone',
    description: 'Mention every group member with "!tagall <message>".',
    icon: '📣',
  },
  polls: {
    name: 'Polls',
    description: 'Create a poll with "!poll question | option1 | option2".',
    icon: '📊',
  },
  statusview: {
    name: 'Auto Status View',
    description: 'Automatically views everyone\'s WhatsApp Status updates.',
    icon: '👁️',
  },
  sudo: {
    name: 'Helpers',
    description: 'Let trusted numbers tag everyone and make polls for you.',
    icon: '🛡️',
  },
  leads: {
    name: 'Lead Capture',
    description: 'Quietly logs names, needs, and budgets from your chats.',
    icon: '📇',
  },
  imagine: {
    name: 'Imagine',
    description: 'Generates an AI image from a prompt via "!imagine".',
    icon: '🪄',
  },
  pinterest: {
    name: 'Pinterest',
    description: 'Fetches a few images for a search term via "!pinterest".',
    icon: '📌',
  },
  ai_ask: {
    name: 'AI Ask',
    description: 'Quick AI answers on demand with "!ai", anywhere.',
    icon: '💡',
  },
  media_convert: {
    name: 'Sticker Maker',
    description: 'Converts between images, gifs, and stickers.',
    icon: '🔄',
  },
  qr: {
    name: 'QR Codes',
    description: 'Turns any link or text into a scannable QR code.',
    icon: '🔳',
  },
  translate: {
    name: 'Translate',
    description: 'Instant translation with "!tl es" or "!translate spanish".',
    icon: '🌐',
  },
  timer: {
    name: 'Timers',
    description: 'A live countdown with "!timer 5m" -- or "!timer 1h30m".',
    icon: '⏳',
  },
  emoji_animate: {
    name: 'Animations',
    description: 'Type "..happy" and watch your own message animate.',
    icon: '✨',
  },
  agent: {
    name: 'Agent',
    description: 'Just say what you want done -- "!ag tell mum I am running late".',
    icon: '🛎️',
  },
  scheduled_send: {
    name: 'Scheduled Messages',
    description: 'Reply to anything with "!sm mum 5pm" to send it later.',
    icon: '📅',
  },
  session_status: {
    name: 'Session Info',
    description: 'Quick health check with "!status" -- what\'s connected, what\'s on.',
    icon: '📶',
  },
};

export const PLUGIN_DEFAULTS: Record<PluginKey, Record<string, unknown>> = {
  autoreply: {
    message: "Thanks for your message! I'll get back to you soon.",
    replyInGroups: false,
    showTyping: true,
    typingDurationMs: 2500,
    cooldownMinutes: 10,
    exceptions: [],
  },
  ai_reply: {
    personalityId: 'friendly-helper',
    customPrompt: '',
    knowledgeBase: '',
    replyInGroups: false,
    showTyping: true,
    typingDurationMs: 2000,
    cooldownMinutes: 0,
    historyLength: 10,
    allowBlocking: false,
    blockDurationHours: 0,
    humanlikeness: 0,
    useSticker: true,
    stickerChance: 0,
    replyToStickers: true,
    exceptions: [],
  },
  ai_write: {
    styleId: 'fix-errors',
    customStylePrompt: '',
    extraInstructions: '',
    applyInGroups: false,
    minLength: 4,
    cooldownMinutes: 0,
  },
  song: {
    replyInGroups: false,
  },
  anti_delete: {
    includeGroups: true,
  },
  notes: {},
  welcome: {
    welcomeEnabled: true,
    goodbyeEnabled: true,
    welcomeMessage: 'Welcome to {group}, {user}! 👋',
    goodbyeMessage: '{user} left {group}. 👋',
  },
  antilink: {
    kickAfterWarnings: 0,
  },
  games: {
    replyInGroups: false,
  },
  broadcast: {},
  tagall: {},
  polls: {},
  statusview: {},
  sudo: {
    numbers: [],
  },
  leads: {
    cooldownMinutes: 30,
  },
  imagine: {
    replyInGroups: false,
  },
  pinterest: {
    replyInGroups: false,
  },
  ai_ask: {},
  media_convert: {},
  qr: {
    replyInGroups: false,
  },
  translate: {
    replyInGroups: false,
  },
  timer: {
    replyInGroups: false,
  },
  session_status: {},
  emoji_animate: {},
  agent: {},
  scheduled_send: {
    timezone: 'UTC',
  },
};

export function isPluginKey(key: string): key is PluginKey {
  return (PLUGIN_KEYS as string[]).includes(key);
}

// Plugins a brand-new session starts with switched on, rather than every
// plugin defaulting off and needing a deliberate first visit to the
// dashboard. Deliberately narrow: only plugins that either (a) only ever
// act on an explicit command someone typed, with no effect on anyone but
// that person, or (b) are notification-only and never post back into a
// chat (anti_delete). Left off: autoreply/ai_reply/ai_write (need real
// configuration -- a message, a personality -- before they're worth
// running, and ai_write rewrites the owner's own outgoing messages
// automatically, which would be a surprising default), welcome/antilink
// (post into or moderate groups the owner might not actually run),
// statusview (ambiently views everyone's WhatsApp Status -- a visible
// side effect other people see), sudo/leads (inert until deliberately
// configured, or continuously scanning conversations via an LLM call),
// and agent (acts on other people's chats off an LLM's reading of a
// free-text instruction -- it asks before anything reaches someone else,
// but that's a capability to opt into deliberately, not to inherit).
const DEFAULT_ENABLED_PLUGINS: ReadonlySet<PluginKey> = new Set([
  'song',
  'anti_delete',
  'notes',
  'games',
  'broadcast',
  'tagall',
  'polls',
  'imagine',
  'pinterest',
  'ai_ask',
  'media_convert',
  'qr',
  'translate',
  'timer',
  'session_status',
  'emoji_animate',
]);

export function isDefaultEnabled(key: PluginKey): boolean {
  return DEFAULT_ENABLED_PLUGINS.has(key);
}
