const PLUGIN_ENGINE_URL = process.env.PLUGIN_ENGINE_URL || 'http://localhost:8000';

// Sends an incoming WhatsApp message to the Python plugin engine and
// returns whatever reply it picked, plus optional typing-simulation
// instructions (or null reply if no plugin matched).
export async function forwardMessage({ userId, from, text }) {
  const res = await fetch(`${PLUGIN_ENGINE_URL}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, from, text }),
  });

  if (!res.ok) {
    throw new Error(`plugin engine responded ${res.status}`);
  }

  const data = await res.json();
  return {
    reply: data.reply || null,
    showTyping: Boolean(data.show_typing),
    typingDelayMs: Number(data.typing_delay_ms) || 0,
    block: Boolean(data.block),
    blockDurationHours: Number(data.block_duration_hours) || 0,
    quote: Boolean(data.quote),
    parts: Array.isArray(data.parts) ? data.parts : null,
    stickerTag: data.sticker_tag || null,
  };
}

// Sends one of the userbot owner's own outgoing messages to the plugin
// engine and returns a rewritten version if ai_write decided one was
// needed, or null if the message should be left as-is.
export async function forwardOwnMessage({ userId, from, text }) {
  const res = await fetch(`${PLUGIN_ENGINE_URL}/rewrite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, from, text }),
  });

  if (!res.ok) {
    throw new Error(`plugin engine responded ${res.status}`);
  }

  const data = await res.json();
  return data.rewritten || null;
}

// Every phone number referenced in this session's per-contact exceptions
// (across all plugins) -- used to proactively resolve LIDs, see
// whatsappManager.js's lidToPhoneJid.
export async function fetchExceptionNumbers(userId) {
  const res = await fetch(`${PLUGIN_ENGINE_URL}/session/${userId}/exception-numbers`);
  if (!res.ok) {
    throw new Error(`plugin engine responded ${res.status}`);
  }
  const data = await res.json();
  return data.phoneNumbers || [];
}
