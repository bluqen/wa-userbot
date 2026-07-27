const PLUGIN_ENGINE_URL = process.env.PLUGIN_ENGINE_URL || 'http://localhost:8000';

// Sends an incoming WhatsApp message to the Python plugin engine and
// returns whatever reply it picked, plus optional typing-simulation
// instructions (or null reply if no plugin matched). `audio`, when given
// (a voice note WhatsApp couldn't offer any text for), carries the raw
// bytes as base64 -- the plugin engine transcribes it and treats the
// result exactly like a typed message from then on.
export async function forwardMessage({ userId, from, text, audio }) {
  const res = await fetch(`${PLUGIN_ENGINE_URL}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, from, text, audio }),
    // A voice note means real transcription work, and a "/song" request
    // (see song.py) means fetching and downloading a multi-MB file from
    // Jamendo, both on top of the usual plugin dispatch -- either can
    // legitimately take longer than a plain text message. Bound it anyway
    // so one slow/hung request can't stall this session's entire message
    // loop indefinitely.
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) {
    throw new Error(`plugin engine responded ${res.status}`);
  }

  const data = await res.json();
  return {
    reply: data.reply || null,
    showTyping: Boolean(data.show_typing),
    typingDelayMs: Number(data.typing_delay_ms) || 0,
    startDelayMs: Number(data.start_delay_ms) || 0,
    block: Boolean(data.block),
    blockDurationHours: Number(data.block_duration_hours) || 0,
    quote: Boolean(data.quote),
    parts: Array.isArray(data.parts) ? data.parts : null,
    stickerTag: data.sticker_tag || null,
    audio: data.audio || null,
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
