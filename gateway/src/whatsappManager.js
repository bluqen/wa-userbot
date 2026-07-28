import pino from 'pino';
import { Boom } from '@hapi/boom';
import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  jidNormalizedUser,
  downloadMediaMessage,
  proto,
} from '@whiskeysockets/baileys';
import { usePostgresAuthState, hasStoredCreds, clearAuthState } from './postgresAuthState.js';
import { forwardMessage, forwardOwnMessage, fetchExceptionNumbers } from './pluginClient.js';
import {
  createScheduledTask,
  saveSticker,
  fetchSticker,
  fetchSessionPluginConfigs,
  saveNote,
  fetchNote,
  describeFetchError,
} from './webClient.js';

const SAVE_STICKER_COMMAND = /^\/savesticker\s+(\S+)/i;
const SAVE_NOTE_COMMAND = /^\/savenote\s+(\S+)/i;
const NOTE_RECALL_RE = /#([a-z0-9_-]{2,})/i;

// Shared by anti-delete's eager media caching, "/savenote", and voice-note
// transcription -- one place that knows how to detect and download
// whatever media type a message contains, instead of each feature quietly
// re-downloading the same file (a voice note, in particular, would
// otherwise get downloaded twice: once for anti-delete, once to transcribe).
const MEDIA_MESSAGE_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
const MAX_MEDIA_DOWNLOAD_BYTES = 8 * 1024 * 1024; // covers virtually all images/voice notes/short videos/documents

function detectMediaType(messageContent) {
  return MEDIA_MESSAGE_TYPES.find((t) => messageContent[t]);
}

// Returns null (rather than throwing) for "too large to bother with" so
// callers can treat that exactly like "nothing worth capturing" instead of
// needing their own size-check branch.
async function downloadAnyMedia(msg, mediaType, mediaObj) {
  const fileLength = Number(mediaObj.fileLength) || 0;
  if (fileLength > MAX_MEDIA_DOWNLOAD_BYTES) return null;

  const buffer = await downloadMediaMessage(msg, 'buffer', {});
  return {
    mediaType,
    buffer,
    mimetype: mediaObj.mimetype || undefined,
    caption: mediaObj.caption || '',
    fileName: mediaObj.fileName || undefined,
    ptt: mediaType === 'audioMessage' ? !!mediaObj.ptt : undefined,
  };
}

// Maps a cached/saved media entry back into the Baileys sendMessage content
// shape needed to actually resend it (anti-delete recovery, note recall).
function buildOutgoingMediaContent({ mediaType, buffer, mimetype, caption, fileName, ptt }) {
  switch (mediaType) {
    case 'imageMessage':
      return { image: buffer, mimetype, caption: caption || undefined };
    case 'videoMessage':
      return { video: buffer, mimetype, caption: caption || undefined };
    case 'audioMessage':
      return { audio: buffer, mimetype, ptt: !!ptt };
    case 'stickerMessage':
      return { sticker: buffer };
    case 'documentMessage':
      return { document: buffer, mimetype, fileName: fileName || 'file' };
    default:
      return null;
  }
}

// Both anti-delete and notes are gateway-only features -- no Python
// plugin-engine involvement at all -- so nothing else ever fetches their
// settings. Derived from the same shared, TTL-cached plugins list (see
// refreshPluginConfigs inside startSession) rather than each doing its own
// network round trip.
function deriveAntiDeleteConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'anti_delete');
  if (!entry || !entry.enabled) return { enabled: false, includeGroups: false };
  return { enabled: true, includeGroups: entry.settings?.includeGroups !== false };
}

function deriveNotesConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'notes');
  return { enabled: !!(entry && entry.enabled) };
}

// Lets the account owner teach the bot a sticker by quote-replying to an
// existing sticker message with "/savesticker <tag>" -- see
// gateway/README.md's "Sticker capture". Feedback is given by editing the
// command message itself in place (same idiom AI Write already uses for
// its own edits), not by sending a new visible message into whatever chat
// the command happened to be used in.
async function handleSaveStickerCommand(userId, sock, msg, rawTag) {
  const tag = rawTag.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quotedSticker = contextInfo?.quotedMessage?.stickerMessage;

  if (!tag) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: 'Usage: /savesticker <tag> (reply to a sticker)', edit: msg.key },
    );
    return;
  }
  if (!quotedSticker) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `Reply directly to a sticker message with /savesticker ${tag}`, edit: msg.key },
    );
    return;
  }

  try {
    // downloadMediaMessage auto-detects the media type from a WAMessage-
    // shaped object; a quoted message isn't a real top-level message in
    // this payload, so build a synthetic one around it. `.key` here is
    // only used for logging/reupload-retry inside downloadMediaMessage,
    // not the actual download.
    const synthetic = {
      key: {
        remoteJid: contextInfo.remoteJid || msg.key.remoteJid,
        id: contextInfo.stanzaId,
        fromMe: false,
      },
      message: contextInfo.quotedMessage,
    };
    const buffer = await downloadMediaMessage(synthetic, 'buffer', {});
    console.log(`[${userId}] downloaded sticker "${tag}": ${buffer.length} bytes`);
    await saveSticker({
      sessionId: userId,
      tag,
      data: buffer.toString('base64'),
      mimetype: quotedSticker.mimetype || 'image/webp',
    });
    await sock.sendMessage(msg.key.remoteJid, { text: `Saved sticker as "${tag}"`, edit: msg.key });
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save sticker "${tag}":`, detail);
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `Failed to save sticker: ${detail}`, edit: msg.key },
    );
  }
}

// Lets the account owner save a quick-recall snippet by quote-replying to
// *any* message -- text or media, whatever it was -- with
// "/savenote <name>", then drop it into any conversation later with
// "#name" (see handleNoteRecall below). Same feedback idiom as
// /savesticker: edits the command message itself in place.
async function handleSaveNoteCommand(userId, sock, msg, rawName) {
  const name = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;

  if (!name) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: 'Usage: /savenote <name> (reply to any message)', edit: msg.key },
    );
    return;
  }
  if (!quoted) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `Reply directly to a message with /savenote ${name}`, edit: msg.key },
    );
    return;
  }

  const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || '';
  const mediaType = detectMediaType(quoted);

  try {
    if (mediaType) {
      // Same synthetic-wrapper trick as /savesticker -- a quoted message
      // isn't a real top-level message in this payload, but
      // downloadMediaMessage only needs something shaped like one.
      const synthetic = {
        key: {
          remoteJid: contextInfo.remoteJid || msg.key.remoteJid,
          id: contextInfo.stanzaId,
          fromMe: false,
        },
        message: quoted,
      };
      const media = await downloadAnyMedia(synthetic, mediaType, quoted[mediaType]);
      if (!media) {
        await sock.sendMessage(
          msg.key.remoteJid,
          { text: 'That file is too large to save as a note (max 8MB).', edit: msg.key },
        );
        return;
      }
      await saveNote({
        sessionId: userId,
        name,
        kind: 'media',
        text: media.caption || '',
        data: media.buffer.toString('base64'),
        mimetype: media.mimetype,
        mediaType: media.mediaType,
        fileName: media.fileName,
      });
    } else if (quotedText) {
      await saveNote({ sessionId: userId, name, kind: 'text', text: quotedText });
    } else {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: 'Nothing to save from that message.', edit: msg.key },
      );
      return;
    }
    await sock.sendMessage(msg.key.remoteJid, { text: `Saved note "${name}"`, edit: msg.key });
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save note "${name}":`, detail);
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `Failed to save note: ${detail}`, edit: msg.key },
    );
  }
}

// Recalls a saved note by "#name" into whichever chat it was typed in.
// Returns true if a note was found and sent (caller treats the message as
// fully handled), false if nothing matched (caller falls through to
// normal processing, e.g. ai_write -- not every "#word" someone types is
// meant as a note reference). `markAiSent` is passed in rather than
// closed over since it's a per-session function (see startSession) and
// this helper, like the others above, is defined once at module scope.
async function handleNoteRecall(userId, sock, msg, name, markAiSent) {
  let note;
  try {
    note = await fetchNote(userId, name.toLowerCase());
  } catch (err) {
    console.error(`[${userId}] note recall lookup failed for "${name}":`, describeFetchError(err));
    return false;
  }
  if (!note) return false;

  try {
    if (note.kind === 'media' && note.data) {
      const content = buildOutgoingMediaContent({
        mediaType: note.mediaType,
        buffer: Buffer.from(note.data, 'base64'),
        mimetype: note.mimetype,
        caption: note.text,
        fileName: note.fileName,
        ptt: false,
      });
      if (content) {
        const sent = await sock.sendMessage(msg.key.remoteJid, content);
        markAiSent(sent?.key?.id);
      }
    } else {
      const sent = await sock.sendMessage(msg.key.remoteJid, { text: note.text });
      markAiSent(sent?.key?.id);
    }
  } catch (err) {
    console.error(`[${userId}] failed to send recalled note "${name}":`, err.message);
  }
  return true;
}

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

  // Baileys reports every message this account sends -- including ones the
  // bot itself just generated (AI Reply text, split parts, stickers) -- back
  // through messages.upsert as a fromMe:true event, same as anything the
  // owner types by hand. Without this, those bot-sent messages would loop
  // straight into ai_write's rewrite path, burning an extra LLM call per
  // auto-reply for nothing and helping exhaust the free-tier rate limit.
  // IDs are added right after sending and removed once seen once here.
  const aiSentMessageIds = new Set();
  const MAX_AI_SENT_IDS = 50;

  function markAiSent(id) {
    if (!id) return;
    aiSentMessageIds.add(id);
    if (aiSentMessageIds.size > MAX_AI_SENT_IDS) {
      aiSentMessageIds.delete(aiSentMessageIds.values().next().value);
    }
  }

  // Both anti-delete and notes need to know their own settings, but
  // neither is worth a fresh network round trip on every single message --
  // anti-delete's check only matters at the (rare) moment of a deletion,
  // and notes' "#name" recall is one substring check away regardless.
  // TTL-cached instead: at most one fetch per session per minute, covering
  // both features' settings from the one shared plugins-list route.
  let cachedPluginConfigs = [];
  let cachedPluginConfigsFetchedAt = 0;
  const PLUGIN_CONFIG_TTL_MS = 60 * 1000;

  async function refreshPluginConfigs() {
    if (Date.now() - cachedPluginConfigsFetchedAt < PLUGIN_CONFIG_TTL_MS) {
      return cachedPluginConfigs;
    }
    try {
      cachedPluginConfigs = await fetchSessionPluginConfigs(userId);
      cachedPluginConfigsFetchedAt = Date.now();
    } catch (err) {
      console.error(`[${userId}] plugin config refresh failed:`, describeFetchError(err));
      // Keep whatever was last known (or the empty default) rather than
      // treating a transient network blip as "everything just turned off".
    }
    return cachedPluginConfigs;
  }

  // Anti-delete: WhatsApp's "delete for everyone" doesn't actually
  // un-deliver anything -- it arrives as a normal protocol message telling
  // this client to stop showing an earlier message it already received.
  // Briefly remembering recent messages (text AND media -- an image,
  // video, voice note, sticker, or document, whatever it was) lets the
  // account owner still be told what it was. Bounded by both a count cap
  // and a total-byte-size cap, since media entries vary from a few bytes
  // of text up to megabytes, unlike every other per-session cache in this
  // file which only ever holds small fixed-size entries.
  const recentMessages = new Map(); // message id -> cache entry (see below)
  const MAX_RECENT_COUNT = 2000;
  const MAX_RECENT_BYTES = 50 * 1024 * 1024;
  let recentMessagesBytes = 0;

  function entrySize(entry) {
    return entry.buffer ? entry.buffer.length : entry.text ? entry.text.length : 0;
  }

  function rememberMessage(id, entry) {
    if (!id) return;
    recentMessages.set(id, entry);
    recentMessagesBytes += entrySize(entry);
    while (
      (recentMessages.size > MAX_RECENT_COUNT || recentMessagesBytes > MAX_RECENT_BYTES) &&
      recentMessages.size > 0
    ) {
      const oldestKey = recentMessages.keys().next().value;
      recentMessagesBytes -= entrySize(recentMessages.get(oldestKey));
      recentMessages.delete(oldestKey);
    }
  }

  // Sent privately to the account's own "Message Yourself" chat rather
  // than back into the chat/group where the deletion happened -- gives the
  // owner full visibility into what was deleted from their own
  // conversations without the bot re-broadcasting someone else's retracted
  // message to a group where it could cause real conflict.
  async function handleMessageRevoke(userId, sock, msg, protocolMessage) {
    const originalId = protocolMessage.key?.id;
    if (!originalId) return;

    const cached = recentMessages.get(originalId);
    if (!cached) return; // never captured (e.g. too large, or already evicted)

    const config = deriveAntiDeleteConfig(await refreshPluginConfigs());
    if (!config.enabled) return;
    if (cached.isGroup && !config.includeGroups) return;

    recentMessagesBytes -= entrySize(cached);
    recentMessages.delete(originalId);

    const deletedBy = msg.key.fromMe ? 'You' : (msg.key.participant || msg.key.remoteJid).split('@')[0];
    // DM: deleter and chat are the same person, so naming both would just
    // repeat the same number twice -- only groups need the extra line.
    const contextLine = cached.isGroup ? `\nIn group: ${cached.chatJid.split('@')[0]}` : '';
    const header = `\u{1F5D1}️ Deleted message recovered\nDeleted by: ${deletedBy}${contextLine}`;

    try {
      if (cached.kind === 'media') {
        const captionLine = cached.caption ? `\n\nCaption: "${cached.caption}"` : '';
        const sentHeader = await sock.sendMessage(sock.user.id, { text: `${header}${captionLine}` });
        markAiSent(sentHeader?.key?.id);
        const content = buildOutgoingMediaContent(cached);
        if (content) {
          const sentMedia = await sock.sendMessage(sock.user.id, content);
          markAiSent(sentMedia?.key?.id);
        }
      } else {
        const sent = await sock.sendMessage(sock.user.id, { text: `${header}\n\n"${cached.text}"` });
        markAiSent(sent?.key?.id);
      }
    } catch (err) {
      console.error(`[${userId}] failed to send anti-delete notice:`, err.message);
    }
  }

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

      // "Delete for everyone" arrives as a normal message: a protocolMessage
      // telling this client to stop showing an earlier message by id, not
      // an actual un-delivery of anything -- the content already arrived
      // and (if it had text) is sitting in recentMessages below. Handled
      // before the text-extraction/filtering logic further down since a
      // protocolMessage carries no text of its own and would otherwise
      // just get silently skipped by it.
      const protocolMessage = msg.message.protocolMessage;
      if (protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
        await handleMessageRevoke(userId, sock, msg, protocolMessage);
        continue;
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      const isGroupChat = msg.key.remoteJid.endsWith('@g.us');

      // Anti-delete caching -- text is essentially free to remember, but
      // media costs a real download, so only bother when the feature is
      // actually on for this session (and, for a group chat, only when
      // group coverage is too). `cachedMedia` is reused just below for
      // voice-note transcription so a ptt voice note doesn't get
      // downloaded twice over -- once here, once for transcription.
      let cachedMedia = null;
      const antiDelete = deriveAntiDeleteConfig(await refreshPluginConfigs());
      const antiDeleteApplies = antiDelete.enabled && (!isGroupChat || antiDelete.includeGroups);

      if (antiDeleteApplies) {
        if (text) {
          rememberMessage(msg.key.id, { kind: 'text', text, chatJid: msg.key.remoteJid, isGroup: isGroupChat });
        } else {
          const mediaType = detectMediaType(msg.message);
          if (mediaType) {
            try {
              cachedMedia = await downloadAnyMedia(msg, mediaType, msg.message[mediaType]);
              if (cachedMedia) {
                rememberMessage(msg.key.id, {
                  kind: 'media',
                  ...cachedMedia,
                  chatJid: msg.key.remoteJid,
                  isGroup: isGroupChat,
                });
              }
            } catch (err) {
              console.error(`[${userId}] anti-delete media capture failed:`, err.message);
            }
          }
        }
      }

      // A voice note (as opposed to a shared audio file, e.g. a song --
      // WhatsApp tells the two apart via `ptt`, push-to-talk) has no text
      // at all, but is still something worth answering. Only the incoming
      // (non-fromMe) case matters here -- there's nothing sensible for
      // ai_write to "fix" about a voice note the owner sent themself.
      const isVoiceNote = msg.message.audioMessage?.ptt === true;
      if (!text && !(isVoiceNote && !msg.key.fromMe)) continue;

      // The plugin engine only ever needs this to key config/exceptions and
      // chat history -- actual sends below still target msg.key.remoteJid
      // as-is, since that's what WhatsApp expects for this chat.
      const resolvedFrom = resolveRemoteJid(msg.key.remoteJid);

      if (msg.key.fromMe) {
        if (aiSentMessageIds.has(msg.key.id)) {
          aiSentMessageIds.delete(msg.key.id);
          continue;
        }

        const saveStickerMatch = text.match(SAVE_STICKER_COMMAND);
        if (saveStickerMatch) {
          await handleSaveStickerCommand(userId, sock, msg, saveStickerMatch[1]);
          continue;
        }

        const saveNoteMatch = text.match(SAVE_NOTE_COMMAND);
        if (saveNoteMatch) {
          const notes = deriveNotesConfig(await refreshPluginConfigs());
          if (notes.enabled) {
            await handleSaveNoteCommand(userId, sock, msg, saveNoteMatch[1]);
            continue;
          }
        }

        // A bare "#name" anywhere in an owner-sent message recalls a saved
        // note into this same chat -- but only if it actually matches one;
        // otherwise this falls through to ai_write below like normal, since
        // not every "#word" someone types is meant as a note reference.
        const noteRecallMatch = text.match(NOTE_RECALL_RE);
        if (noteRecallMatch) {
          const notes = deriveNotesConfig(await refreshPluginConfigs());
          if (notes.enabled) {
            const handled = await handleNoteRecall(userId, sock, msg, noteRecallMatch[1], markAiSent);
            if (handled) continue;
          }
        }

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
        let audio;
        if (isVoiceNote) {
          try {
            // Reuse the buffer anti-delete may have already downloaded
            // above for this exact message instead of downloading it a
            // second time.
            const buffer =
              cachedMedia?.mediaType === 'audioMessage'
                ? cachedMedia.buffer
                : await downloadMediaMessage(msg, 'buffer', {});
            audio = {
              data: buffer.toString('base64'),
              mimetype: msg.message.audioMessage.mimetype || 'audio/ogg',
            };
          } catch (err) {
            console.error(`[${userId}] failed to download voice note:`, err.message);
          }
        }
        // A voice note whose download failed above still has empty text --
        // forwardMessage/the plugin engine already treat that as nothing to
        // reply to, same as any other message with nothing usable in it.

        const {
          reply,
          showTyping,
          typingDelayMs,
          startDelayMs,
          block,
          blockDurationHours,
          quote,
          parts,
          stickerTag,
          audio: replyAudio,
        } = await forwardMessage({ userId, from: resolvedFrom, text, audio });

        if (reply) {
          // Waited once, before anything visible happens (typing indicator
          // or the message itself) -- a person notices a message and
          // decides to reply before their thumbs move at all, regardless of
          // whether a typing indicator is even shown. Without this, higher
          // humanlikeness only ever affected the *typing indicator's*
          // timing, so a reply with showTyping off still fired the instant
          // the message arrived.
          if (startDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, startDelayMs));
          }

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
            markAiSent(sent?.key?.id);

            if (showTyping) {
              await sock.sendPresenceUpdate('paused', msg.key.remoteJid);
            }

            if (i < messagesToSend.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 800));
            }
          }
        }

        if (stickerTag) {
          try {
            const buffer = await fetchSticker(userId, stickerTag);
            if (buffer) {
              const sentSticker = await sock.sendMessage(msg.key.remoteJid, { sticker: buffer });
              markAiSent(sentSticker?.key?.id);
            } else {
              console.error(`[${userId}] sticker "${stickerTag}" not found (deleted since?)`);
            }
          } catch (err) {
            console.error(`[${userId}] failed to send sticker "${stickerTag}":`, describeFetchError(err));
          }
        }

        if (replyAudio) {
          // A real audio/music file (see song.py) -- ptt:false so it
          // renders as a normal playable attachment, not the voice-message
          // bubble a ptt:true voice note gets.
          try {
            await sock.sendMessage(msg.key.remoteJid, {
              audio: Buffer.from(replyAudio.data, 'base64'),
              mimetype: replyAudio.mimetype || 'audio/mpeg',
              ptt: false,
            });
          } catch (err) {
            console.error(`[${userId}] failed to send audio reply:`, err.message);
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
