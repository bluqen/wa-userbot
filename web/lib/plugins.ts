export type PluginKey = 'autoreply' | 'ai_reply' | 'ai_write';

export const PLUGIN_KEYS: PluginKey[] = ['autoreply', 'ai_reply', 'ai_write'];

export const PLUGIN_META: Record<PluginKey, { name: string; description: string }> = {
  autoreply: {
    name: 'Auto Reply',
    description: 'Automatically reply to incoming messages with a fixed message.',
  },
  ai_reply: {
    name: 'AI Reply',
    description: 'Generate AI-powered replies in a personality of your choosing.',
  },
  ai_write: {
    name: 'AI Write',
    description:
      'Instantly fix spelling/grammar or rewrite the tone of your own outgoing messages before anyone reads the typos.',
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
    exceptions: [],
  },
  ai_write: {
    styleId: 'fix-errors',
    customStylePrompt: '',
    extraInstructions: '',
    applyInGroups: false,
    minLength: 4,
  },
};

export function isPluginKey(key: string): key is PluginKey {
  return (PLUGIN_KEYS as string[]).includes(key);
}
