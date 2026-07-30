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
  | 'media_convert';

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
    description: 'Sends a royalty-free track via "/song <genre>".',
    icon: '🎵',
  },
  anti_delete: {
    name: 'Anti-Delete',
    description: 'Privately notifies you when a message gets deleted.',
    icon: '🗑️',
  },
  notes: {
    name: 'Notes',
    description: 'Save and recall snippets with "/savenote" and "#name".',
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
    description: 'Trivia, rock-paper-scissors, and 8-ball.',
    icon: '🎮',
  },
  broadcast: {
    name: 'Broadcasts',
    description: 'Send a message to a list of contacts, now or later.',
    icon: '📢',
  },
  tagall: {
    name: 'Tag Everyone',
    description: 'Mention every group member with "/tagall <message>".',
    icon: '📣',
  },
  polls: {
    name: 'Polls',
    description: 'Create a poll with "/poll question | option1 | option2".',
    icon: '📊',
  },
  statusview: {
    name: 'Auto Status View',
    description: 'Automatically views everyone\'s WhatsApp Status updates.',
    icon: '👁️',
  },
  sudo: {
    name: 'Sudo Numbers',
    description: 'Let trusted numbers use Tag Everyone and Polls for you.',
    icon: '🛡️',
  },
  leads: {
    name: 'Lead Capture',
    description: 'Quietly logs names, needs, and budgets from your chats.',
    icon: '📇',
  },
  imagine: {
    name: 'Imagine',
    description: 'Generates an AI image from a prompt via "/imagine".',
    icon: '🪄',
  },
  pinterest: {
    name: 'Pinterest',
    description: 'Fetches a few images for a search term via "/pinterest".',
    icon: '📌',
  },
  ai_ask: {
    name: 'AI Ask',
    description: 'One-off AI answer by replying "!ai" to any message.',
    icon: '💡',
  },
  media_convert: {
    name: 'Sticker Maker',
    description: 'Converts between images, gifs, and stickers.',
    icon: '🔄',
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
};

export function isPluginKey(key: string): key is PluginKey {
  return (PLUGIN_KEYS as string[]).includes(key);
}
