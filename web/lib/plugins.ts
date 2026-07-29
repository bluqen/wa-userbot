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
  | 'broadcast';

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
];

export const PLUGIN_META: Record<PluginKey, { name: string; description: string; icon: string }> = {
  autoreply: {
    name: 'Auto Reply',
    description: 'Automatically reply to incoming messages with a fixed message.',
    icon: '💬',
  },
  ai_reply: {
    name: 'AI Reply',
    description: 'Generate AI-powered replies in a personality of your choosing.',
    icon: '🤖',
  },
  ai_write: {
    name: 'AI Write',
    description:
      'Instantly fix spelling/grammar or rewrite the tone of your own outgoing messages before anyone reads the typos.',
    icon: '✍️',
  },
  song: {
    name: 'Song Fetcher',
    description:
      'Sends a royalty-free (Creative Commons) track from Jamendo when someone messages "/song <genre/mood>". Requires JAMENDO_CLIENT_ID to be configured on the plugin engine.',
    icon: '🎵',
  },
  anti_delete: {
    name: 'Anti-Delete',
    description:
      'When someone deletes a message for everyone (text, image, video, voice note, sticker, or document), privately notifies you (in your own "Message Yourself" chat) with what it said -- never re-posted back into the original chat or group.',
    icon: '🗑️',
  },
  notes: {
    name: 'Notes',
    description:
      'Reply to any message -- text or media -- with "/savenote <name>" to save it, then drop it into any conversation later with "#name".',
    icon: '📝',
  },
  welcome: {
    name: 'Welcome/Goodbye',
    description: 'Automatically greets new group members and sends a farewell when someone leaves.',
    icon: '👋',
  },
  antilink: {
    name: 'Anti-Link',
    description:
      'Automatically deletes messages containing links from non-admins in groups, with an optional warn-then-remove threshold.',
    icon: '🔗',
  },
  games: {
    name: 'Games & Fun',
    description: 'Trivia, rock-paper-scissors, and magic 8-ball commands for anyone chatting with the bot.',
    icon: '🎮',
  },
  broadcast: {
    name: 'Broadcasts',
    description: 'Compose a message once and send it to a list of contacts, immediately or on a schedule.',
    icon: '📢',
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
};

export function isPluginKey(key: string): key is PluginKey {
  return (PLUGIN_KEYS as string[]).includes(key);
}
