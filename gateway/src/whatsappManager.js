import pino from 'pino';
import { Boom } from '@hapi/boom';
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
import { usePostgresAuthState, hasStoredCreds, clearAuthState } from './postgresAuthState.js';
import { forwardMessage, forwardOwnMessage, fetchExceptionNumbers } from './pluginClient.js';
import { createScheduledTask } from './webClient.js';

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

// userId -> { sock, status, pairingCode }
const sessions = new Map();

// WhatsApp pairing codes are short-lived; once an in-flight attempt is older
// than this, treat it as expired and let a retry issue a fresh one instead
// of just handing back the same (likely-expired) code forever.
const PAIRING_ATTEMPT_TTL_MS = 60 * 1000;

// userIds the dashboard explicitly disconnected -- checked by scheduleReconnect
// so a retry that was already in flight when the user hit "Disconnect" doesn't
// turn around and open a fresh, unwanted pairing attempt behind their back.
const explicitlyStopped = new Set();

const RECONNECT_BASE_DELAY_MS = 5 * 1000;
const RECONNECT_MAX_DELAY_MS = 5 * 60 * 1000;

// Auto-reconnect (see the 'close' handler below) used to be a single
// best-effort attempt: if it failed -- e.g. a transient DNS/network blip
// reaching Postgres for stored creds -- the session just stayed dead until
// someone noticed and clicked "Reconnect" by hand. That's fine on a dev
// machine but not for an unattended deployment. Retry with capped
// exponential backoff instead, indefinitely, until it succeeds or the
// session is explicitly disconnected.
function scheduleReconnect(userId, phoneNumber, attempt) {
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS);
  setTimeout(async () => {
    if (sessions.has(userId) || explicitlyStopped.has(userId)) return;
    try {
      await startSession(userId, phoneNumber);
    } catch (err) {
      console.error(`[${userId}] reconnect attempt ${attempt} failed:`, err.message);
      scheduleReconnect(userId, phoneNumber, attempt + 1);
    }
  }, delay);
}

// Called from messages.upsert when a reply plugin (currently just AI Reply,
// gated by its own allowBlocking setting) signals that this contact should
// be blocked -- jid must be the real WhatsApp-addressing JID (msg.key.remoteJid),
// not the LID-resolved one used for plugin-engine lookups. A nonzero
// blockDurationHours also schedules an automatic unblock via the generic
// scheduled-task system (see scheduler.js) -- 0 means block permanently.
async function handleBlockContact(userId, sock, jid, blockDurationHours) {
  try {
    await sock.updateBlockStatus(jid, 'block');
  } catch (err) {
    console.error(`[${userId}] failed to block ${jid}:`, err.message);
    return;
  }
  if (blockDurationHours > 0) {
    try {
      await createScheduledTask({
        sessionId: userId,
        type: 'unblock_contact',
        payload: { jid },
        runAt: new Date(Date.now() + blockDurationHours * 60 * 60 * 1000).toISOString(),
      });
    } catch (err) {
      console.error(`[${userId}] failed to schedule unblock for ${jid}:`, err.message);
    }
  }
}

export async function startSession(userId, phoneNumber) {
  explicitlyStopped.delete(userId);
  const existing = sessions.get(userId);
  if (existing) {
    if (existing.status === 'connected') {
      return existing;
    }
    if (existing.status === 'connecting') {
      const isStale = Date.now() - existing.createdAt > PAIRING_ATTEMPT_TTL_MS;
      if (!isStale) {
        // A pairing attempt is already in flight and still fresh -- reuse
        // it instead of opening a second WebSocket connection in parallel,
        // which confuses WhatsApp into rejecting the link.
        return existing;
      }
      sessions.delete(userId);
      await existing.sock.end(new Error('superseded by a new pairing attempt')).catch(() => {});
    }
  }

  const { state, saveCreds } = await usePostgresAuthState(userId);
  const { version } = await fetchLatestBaileysVersion();

  // WhatsApp's E2E encryption sometimes has the recipient request a retry of
  // a message it failed to decrypt (normal Signal-protocol behavior). When
  // that happens, Baileys needs to look up and resend the original message
  // via getMessage -- without it, there's nothing to resend, and the
  // recipient is left showing "Waiting for this message" indefinitely
  // instead of it resolving itself within a few seconds. Cap the store so
  // it can't grow unbounded.
  const sentMessages = new Map(); // message id -> proto message content
  const MAX_SENT_MESSAGES = 200;

  // WhatsApp sometimes addresses a contact by an opaque "LID" (e.g.
  // `17206192644250@lid`) instead of their phone number in
  // `msg.key.remoteJid`. Per-contact plugin settings (exceptions) are keyed
  // by phone number, so those messages would silently never match. Baileys'
  // `contacts.upsert`/`contacts.update` events carry both `lid` and `jid`
  // for a contact when it knows the mapping -- record it here and resolve
  // incoming LIDs back to the real phone-number JID before handing the
  // message off to the plugin engine.
  const lidToPhoneJid = new Map();

  function recordContacts(contacts) {
    for (const c of contacts) {
      if (c.lid && c.jid) {
        lidToPhoneJid.set(jidNormalizedUser(c.lid), jidNormalizedUser(c.jid));
      }
    }
  }

  function resolveRemoteJid(remoteJid) {
    if (!remoteJid || !remoteJid.endsWith('@lid')) return remoteJid;
    return lidToPhoneJid.get(jidNormalizedUser(remoteJid)) || remoteJid;
  }

  // Contacts events rarely carry both `lid` and `jid` in practice (WhatsApp
  // mostly omits `jid` there even when it exists). The reliable source is
  // the reverse: ask WhatsApp directly (onWhatsApp) for the LID of each
  // phone number this session actually has an exception configured for,
  // and cache that mapping instead. Re-run periodically so a newly-added
  // exception gets picked up without requiring a reconnect.
  async function refreshLidMappings() {
    try {
      const numbers = await fetchExceptionNumbers(userId);
      if (numbers.length === 0) return;

      const results = await sock.onWhatsApp(...numbers.map((n) => `${n}@s.whatsapp.net`));
      for (const r of results || []) {
        if (r?.exists && r.lid && r.jid) {
          lidToPhoneJid.set(jidNormalizedUser(r.lid), jidNormalizedUser(r.jid));
        }
      }
    } catch (err) {
      console.error(`[${userId}] failed to refresh LID mappings:`, err.message);
    }
  }

  const LID_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  let lidRefreshInterval = null;

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    // Baileys' default fingerprint (Browsers.ubuntu) is so widely reused by
    // bots that WhatsApp's anti-automation system flags/rejects it outright
    // (a 401 "frc" failure right after login). Using a distinct one avoids
    // that specific rejection.
    browser: Browsers.windows('Chrome'),
    getMessage: async (key) => sentMessages.get(key.id),
  });

  const entry = { sock, status: 'connecting', pairingCode: null, createdAt: Date.now() };
  sessions.set(userId, entry);

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', recordContacts);
  sock.ev.on('contacts.update', recordContacts);

  // Resolves once we either have a pairing code to hand back, the socket
  // connected outright (already-registered session), or it closed before
  // either happened -- startSession() awaits this before returning.
  let resolvePairingSettled;
  const pairingSettled = new Promise((resolve) => {
    resolvePairingSettled = resolve;
  });
  let pairingRequested = false;

  sock.ev.on('connection.update', async (update) => {
    // This socket may have been superseded by a newer attempt (see the
    // staleness check above) -- if so, it's already been torn down and
    // shouldn't be allowed to reconnect itself back into the map.
    if (sessions.get(userId) !== entry) return;

    const { connection, lastDisconnect, qr } = update;

    // The pairing code must only be requested once the server has sent its
    // pair-device stanza (signalled here by the `qr` field) -- requesting
    // it immediately after socket creation races Baileys' handshake and
    // gets the whole link silently rejected by WhatsApp's server.
    if (qr && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;
      try {
        entry.pairingCode = await sock.requestPairingCode(phoneNumber);
      } catch (err) {
        console.error(`[${userId}] requestPairingCode failed:`, err);
      } finally {
        resolvePairingSettled();
      }
    }

    if (connection === 'open') {
      entry.status = 'connected';
      entry.pairingCode = null;
      resolvePairingSettled();
      refreshLidMappings();
      lidRefreshInterval = setInterval(refreshLidMappings, LID_REFRESH_INTERVAL_MS);
    } else if (connection === 'close') {
      clearInterval(lidRefreshInterval);
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : undefined;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.error(
        `[${userId}] connection closed - statusCode=${statusCode} data=${JSON.stringify(lastDisconnect?.error?.data)} message=${lastDisconnect?.error?.message}`,
      );

      sessions.delete(userId);
      resolvePairingSettled();

      if (!loggedOut) {
        startSession(userId, phoneNumber).catch((err) => {
          console.error(`[${userId}] reconnect failed:`, err.message);
          scheduleReconnect(userId, phoneNumber, 1);
        });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';
      if (!text) continue;

      // The plugin engine only ever needs this to key config/exceptions and
      // chat history -- actual sends below still target msg.key.remoteJid
      // as-is, since that's what WhatsApp expects for this chat.
      const resolvedFrom = resolveRemoteJid(msg.key.remoteJid);

      if (msg.key.fromMe) {
        // A message the userbot owner sent themself (from this device or
        // any other linked device) -- offer it to ai_write for an instant
        // edit. Everything else below is about replying to messages from
        // other people, which this isn't.
        try {
          const rewritten = await forwardOwnMessage({ userId, from: resolvedFrom, text });
          if (rewritten) {
            await sock.sendMessage(msg.key.remoteJid, { text: rewritten, edit: msg.key });
          }
        } catch (err) {
          console.error(`[${userId}] ai_write dispatch failed:`, err.message);
        }
        continue;
      }

      try {
        const { reply, showTyping, typingDelayMs, block, blockDurationHours, quote, parts } =
          await forwardMessage({ userId, from: resolvedFrom, text });

        if (reply) {
          // A split reply (humanlikeness "split" style) sends each part as
          // its own message with a brief gap, each preceded by its own
          // typing indicator if enabled -- a single-part reply is just the
          // len-1 case of the same loop. `quote` (swipe-reply to the
          // incoming message) only applies to the first part; it wouldn't
          // make sense repeated on a follow-up message.
          const messagesToSend = parts && parts.length > 0 ? parts : [reply];

          for (let i = 0; i < messagesToSend.length; i++) {
            if (showTyping) {
              await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
              await new Promise((resolve) => setTimeout(resolve, typingDelayMs || 1500));
            }

            const sendOptions = i === 0 && quote ? { quoted: msg } : undefined;
            const sent = await sock.sendMessage(
              msg.key.remoteJid,
              { text: messagesToSend[i] },
              sendOptions,
            );
            if (sent?.key?.id && sent.message) {
              sentMessages.set(sent.key.id, sent.message);
              if (sentMessages.size > MAX_SENT_MESSAGES) {
                sentMessages.delete(sentMessages.keys().next().value);
              }
            }

            if (showTyping) {
              await sock.sendPresenceUpdate('paused', msg.key.remoteJid);
            }

            if (i < messagesToSend.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 800));
            }
          }
        }

        if (block) {
          // Real WhatsApp addressing JID -- not resolvedFrom, which is
          // only the LID-resolved phone-number JID used for plugin-engine
          // config/exception lookups.
          await handleBlockContact(userId, sock, msg.key.remoteJid, blockDurationHours);
        }
      } catch (err) {
        console.error(`[${userId}] plugin dispatch failed:`, err.message);
      }
    }
  });

  if (state.creds.registered) {
    resolvePairingSettled();
  } else {
    await pairingSettled;
  }

  return entry;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Used by the dashboard's "Reconnect" button: tries to bring a session back
// up using its saved credentials (e.g. after the gateway process restarted
// and lost its in-memory connections), and only falls back to requesting a
// brand new pairing code if that doesn't work -- most likely because the
// device was unlinked from the phone in the meantime.
export async function reconnectSession(userId, phoneNumber) {
  const existing = sessions.get(userId);
  if (existing?.status === 'connected') {
    return sessionStatus(userId);
  }

  const hadSavedCreds = await hasStoredCreds(userId);

  await startSession(userId, phoneNumber);

  if (hadSavedCreds) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const current = sessions.get(userId);
      if (current?.status === 'connected') {
        return sessionStatus(userId);
      }
      if (!current) {
        // Already closed -- most likely rejected as logged-out. No point
        // waiting out the rest of the deadline.
        break;
      }
      await wait(500);
    }

    if (sessions.get(userId)?.status !== 'connected') {
      // Last resort: saved credentials didn't work (the device was likely
      // unlinked from the phone). Clear them and request a fresh code.
      sessions.delete(userId);
      await clearAuthState(userId);
      await startSession(userId, phoneNumber);
    }
  }

  return sessionStatus(userId);
}

// Used by scheduler.js to find a session's live socket (and confirm it's
// actually connected) before running a due scheduled task against it.
export function getSession(userId) {
  return sessions.get(userId);
}

export function sessionStatus(userId) {
  const entry = sessions.get(userId);
  if (!entry) return { status: 'none' };
  return { status: entry.status, pairingCode: entry.pairingCode };
}

export async function logoutSession(userId) {
  explicitlyStopped.add(userId);
  const entry = sessions.get(userId);
  if (entry) {
    await entry.sock.logout().catch(() => {});
    sessions.delete(userId);
  }
  // Wipe stored credentials even if there was no live in-memory socket (e.g.
  // after a gateway restart) -- otherwise "disconnect" silently does
  // nothing and stale/corrupted session state just sits there.
  await clearAuthState(userId);
}
