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
import { forwardMessage, forwardOwnMessage, fetchExceptionNumbers, askAI } from './pluginClient.js';
import {
  createScheduledTask,
  saveSticker,
  fetchSticker,
  fetchSessionPluginConfigs,
  saveNote,
  fetchNote,
  saveBroadcastGroup,
  markSessionLoggedOut,
  describeFetchError,
} from './webClient.js';
import {
  imageToSticker,
  mediaToAnimatedSticker,
  stickerToImage,
  stickerToVideo,
  addMemeText,
  applyVoiceEffect,
} from './mediaConvert.js';

const SAVE_STICKER_COMMAND = /^\/savesticker\s+(\S+)/i;
const SAVE_NOTE_COMMAND = /^\/savenote\s+(\S+)/i;
const ADD_BROADCAST_COMMAND = /^\/addbroadcast\s+(\S+)/i;
const TAG_ALL_COMMAND = /^\/tagall(?:\s+([\s\S]+))?$/i;
const POLL_COMMAND = /^\/poll\s+([\s\S]+)/i;
const AI_ASK_COMMAND = /^!ai(?:\s+([\s\S]+))?$/i;
const STICKER_CONVERT_COMMAND = /^\/sticker\b/i;
const IMG_CONVERT_COMMAND = /^\/img\b/i;
const GIF_CONVERT_COMMAND = /^\/gif\b/i;
const MEME_COMMAND = /^\/meme(?:\s+([\s\S]+))?$/i;
const VOICE_EFFECT_COMMAND = /^\/(robot|deep|chipmunk|echo)\b/i;
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

function deriveBroadcastConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'broadcast');
  return { enabled: !!(entry && entry.enabled) };
}

function deriveTagAllConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'tagall');
  return { enabled: !!(entry && entry.enabled) };
}

function derivePollsConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'polls');
  return { enabled: !!(entry && entry.enabled) };
}

function deriveStatusViewConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'statusview');
  return { enabled: !!(entry && entry.enabled) };
}

function deriveAiAskConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'ai_ask');
  return { enabled: !!(entry && entry.enabled) };
}

function deriveMediaConvertConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'media_convert');
  return { enabled: !!(entry && entry.enabled) };
}

// The Fun pack's own plugin key -- games.py (8ball/rps/trivia) already
// gates itself on this via the plugin engine, but /meme and the voice
// effects bypass the plugin engine entirely (they need real quoted media
// bytes the Python side never receives), so the same enabled+
// replyInGroups gating has to be replicated here.
function deriveGamesConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'games');
  if (!entry || !entry.enabled) return { enabled: false, replyInGroups: false };
  return { enabled: true, replyInGroups: !!entry.settings?.replyInGroups };
}

// Trusted numbers who can use /tagall and /poll without being the account
// owner. Deliberately scoped to just these two utility commands rather
// than every owner-only capability (savesticker/savenote/addbroadcast
// stay owner-only) to avoid widening what a designated number can do
// beyond what's actually needed.
function deriveSudoConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'sudo');
  if (!entry || !entry.enabled) return { enabled: false, numbers: [] };
  const numbers = Array.isArray(entry.settings?.numbers) ? entry.settings.numbers : [];
  return { enabled: true, numbers: numbers.map((n) => String(n).replace(/\D/g, '')) };
}

const DEFAULT_WELCOME_MESSAGE = 'Welcome to {group}, {user}! 👋';
const DEFAULT_GOODBYE_MESSAGE = '{user} left {group}. 👋';

function deriveWelcomeConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'welcome');
  if (!entry || !entry.enabled) {
    return { enabled: false, welcomeEnabled: false, goodbyeEnabled: false };
  }
  const settings = entry.settings || {};
  return {
    enabled: true,
    welcomeEnabled: settings.welcomeEnabled !== false,
    goodbyeEnabled: settings.goodbyeEnabled !== false,
    welcomeMessage: settings.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
    goodbyeMessage: settings.goodbyeMessage || DEFAULT_GOODBYE_MESSAGE,
  };
}

function deriveAntiLinkConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'antilink');
  if (!entry || !entry.enabled) return { enabled: false, kickAfterWarnings: 0 };
  const settings = entry.settings || {};
  return { enabled: true, kickAfterWarnings: Number(settings.kickAfterWarnings) || 0 };
}

// Fills {user}/{group} placeholders in a welcome/goodbye template. `user`
// is passed as a plain @mention string (not a real mention/ping) to keep
// this simple -- WhatsApp mention pings require passing JIDs through
// sendMessage's own `mentions` array, which the caller still does
// separately for the actual ping; this is just the visible text.
function fillTemplate(template, { user, group }) {
  return template.replace(/\{user\}/g, user).replace(/\{group\}/g, group);
}

const URL_RE = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i;
const MAX_ANTILINK_GROUPS_TRACKED = 200;

// Deletes a link posted by a non-admin in a group, and -- if the plugin's
// kickAfterWarnings is set -- removes them once they've hit that many
// violations. Both actions require the bot's own account to actually be a
// group admin; if it isn't, Baileys/WhatsApp will reject the call, which is
// caught and logged rather than crashing the whole message loop.
async function handleAntiLinkViolation(userId, sock, msg, groupJid, participantJid, kickAfterWarnings, antiLinkViolations) {
  try {
    await sock.sendMessage(groupJid, { delete: msg.key });
  } catch (err) {
    console.error(
      `[${userId}] anti-link: failed to delete message in ${groupJid} (is the bot a group admin?):`,
      err.message,
    );
    return;
  }

  if (kickAfterWarnings <= 0) return;

  let groupViolations = antiLinkViolations.get(groupJid);
  if (!groupViolations) {
    groupViolations = new Map();
    antiLinkViolations.set(groupJid, groupViolations);
    if (antiLinkViolations.size > MAX_ANTILINK_GROUPS_TRACKED) {
      antiLinkViolations.delete(antiLinkViolations.keys().next().value);
    }
  }
  const count = (groupViolations.get(participantJid) || 0) + 1;
  groupViolations.set(participantJid, count);

  const mentionText = `@${participantJid.split('@')[0]}`;
  if (count >= kickAfterWarnings) {
    groupViolations.delete(participantJid);
    try {
      await sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
    } catch (err) {
      console.error(
        `[${userId}] anti-link: failed to remove ${participantJid} from ${groupJid} (is the bot a group admin?):`,
        err.message,
      );
    }
  } else {
    try {
      await sock.sendMessage(groupJid, {
        text: `${mentionText} link removed -- warning ${count}/${kickAfterWarnings}.`,
        mentions: [participantJid],
      });
    } catch (err) {
      console.error(`[${userId}] anti-link: failed to send warning in ${groupJid}:`, err.message);
    }
  }
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
    await sendTracked(
      sock,
      userId,
      msg.key.remoteJid,
      { text: `Saved note "${name}"`, edit: msg.key },
      undefined,
      'savenote-confirm',
    );
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save note "${name}":`, detail);
    // Reporting the failure must not itself throw -- this send is exactly
    // as likely to fail as the one that just did, and an uncaught error
    // here would escape the caller entirely.
    try {
      await sendTracked(
        sock,
        userId,
        msg.key.remoteJid,
        { text: `Failed to save note: ${detail}`, edit: msg.key },
        undefined,
        'savenote-error',
      );
    } catch {
      // already logged by sendTracked
    }
  }
}

// Lets the owner tag a group for broadcast use with "/addbroadcast <name>"
// sent *inside* that group -- avoids ever needing to know/type the
// group's opaque JID by hand. Only valid inside a group; using it in a DM
// doesn't mean anything.
async function handleAddBroadcastCommand(userId, sock, msg, rawName) {
  const name = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!name) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: 'Usage: /addbroadcast <name> (send inside the group)', edit: msg.key },
    );
    return;
  }
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: '/addbroadcast only works inside a group.', edit: msg.key },
    );
    return;
  }

  try {
    let groupName = '';
    try {
      const metadata = await sock.groupMetadata(msg.key.remoteJid);
      groupName = metadata.subject || '';
    } catch {
      // Non-fatal -- the group still gets tagged, just without a friendly
      // display name for the dashboard's group picker.
    }
    await saveBroadcastGroup({ sessionId: userId, name, jid: msg.key.remoteJid, groupName });
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `This group is now tagged for broadcasts as "${name}"`, edit: msg.key },
    );
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save broadcast group "${name}":`, detail);
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `Failed to tag group: ${detail}`, edit: msg.key },
    );
  }
}

// "/tagall <message>" -- mentions every group member at once. Only
// meaningful inside a group; the mention list is silent (no visible @tag
// text per person) but still pings everyone, same as a real @all mention.
async function handleTagAllCommand(userId, sock, msg, rawMessage) {
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sock.sendMessage(msg.key.remoteJid, { text: '/tagall only works inside a group.', edit: msg.key });
    return;
  }
  try {
    const metadata = await sock.groupMetadata(msg.key.remoteJid);
    const participantJids = metadata.participants.map((p) => p.id);
    const text = (rawMessage || 'Attention everyone!').trim();
    await sock.sendMessage(msg.key.remoteJid, { text, mentions: participantJids });
  } catch (err) {
    console.error(`[${userId}] /tagall failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: `Failed to tag everyone: ${err.message}`, edit: msg.key });
  }
}

// "/poll question | option1 | option2 | ..." -- sends a real native
// WhatsApp poll (not a text-based fake one).
async function handlePollCommand(userId, sock, msg, rawPoll) {
  const parts = rawPoll.split('|').map((p) => p.trim()).filter(Boolean);
  const [question, ...options] = parts;
  if (!question || options.length < 2) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: 'Usage: /poll question | option1 | option2 | ...(up to 12 options)', edit: msg.key },
    );
    return;
  }
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      poll: { name: question, values: options.slice(0, 12), selectableCount: 1 },
    });
  } catch (err) {
    console.error(`[${userId}] /poll failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: `Failed to create poll: ${err.message}`, edit: msg.key });
  }
}

// One-shot AI question, triggered by "!ai <question>" or by replying to
// any message with just "!ai" (asks about the quoted message). Distinct
// from the ongoing AI Reply conversation flow -- this is a single ask,
// answered by editing the command message itself in place, same idiom as
// every other owner-only command.
async function handleAskCommand(userId, sock, msg, rawQuestion) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  const quotedText = quoted ? quoted.conversation || quoted.extendedTextMessage?.text || '' : '';

  const typed = (rawQuestion || '').trim();
  const question = quotedText && typed ? `Regarding this message: "${quotedText}"\n\n${typed}` : quotedText || typed;

  if (!question) {
    await sock.sendMessage(msg.key.remoteJid, {
      text: 'Usage: !ai <question>, or reply to a message with !ai to ask about it.',
      edit: msg.key,
    });
    return;
  }

  try {
    const answer = await askAI({ userId, question });
    await sock.sendMessage(msg.key.remoteJid, {
      text: answer || 'No AI provider configured, or that request failed -- try again?',
      edit: msg.key,
    });
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] !ai request failed:`, detail);
    await sock.sendMessage(msg.key.remoteJid, { text: `AI request failed: ${detail}`, edit: msg.key });
  }
}

// Converts whatever media the owner quote-replies to: an image or
// video/gif into a sticker ("/sticker"), a sticker back into a plain
// image ("/img"), or an animated sticker into a normal video ("/gif").
// Same synthetic-quoted-message-wrapper trick as /savesticker/savenote --
// downloadMediaMessage only needs something shaped like a real message.
async function handleMediaConvertCommand(userId, sock, msg, mode) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  const mediaType = quoted && detectMediaType(quoted);

  if (!quoted || !mediaType) {
    const usage = {
      sticker: 'Reply to an image or video/gif with /sticker to make a sticker.',
      img: 'Reply to a sticker with /img to convert it to an image.',
      gif: 'Reply to a sticker with /gif to convert it to a video.',
    }[mode];
    await sock.sendMessage(msg.key.remoteJid, { text: usage, edit: msg.key });
    return;
  }

  const synthetic = {
    key: { remoteJid: contextInfo.remoteJid || msg.key.remoteJid, id: contextInfo.stanzaId, fromMe: false },
    message: quoted,
  };

  try {
    const media = await downloadAnyMedia(synthetic, mediaType, quoted[mediaType]);
    if (!media) {
      await sock.sendMessage(msg.key.remoteJid, {
        text: 'That file is too large to convert (max 8MB).',
        edit: msg.key,
      });
      return;
    }

    if (mode === 'sticker') {
      if (mediaType !== 'imageMessage' && mediaType !== 'videoMessage') {
        await sock.sendMessage(msg.key.remoteJid, {
          text: 'Reply to an image or video/gif with /sticker to make a sticker.',
          edit: msg.key,
        });
        return;
      }
      const webp =
        mediaType === 'imageMessage'
          ? await imageToSticker(media.buffer)
          : await mediaToAnimatedSticker(media.buffer);
      await sock.sendMessage(msg.key.remoteJid, { sticker: webp });
    } else if (mode === 'img') {
      if (mediaType !== 'stickerMessage') {
        await sock.sendMessage(msg.key.remoteJid, { text: 'Reply to a sticker with /img.', edit: msg.key });
        return;
      }
      const png = await stickerToImage(media.buffer);
      await sock.sendMessage(msg.key.remoteJid, { image: png });
    } else if (mode === 'gif') {
      if (mediaType !== 'stickerMessage') {
        await sock.sendMessage(msg.key.remoteJid, { text: 'Reply to a sticker with /gif.', edit: msg.key });
        return;
      }
      const mp4 = await stickerToVideo(media.buffer);
      if (!mp4) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: "That's a static sticker -- there's no motion to turn into a video.",
          edit: msg.key,
        });
        return;
      }
      await sock.sendMessage(msg.key.remoteJid, { video: mp4, gifPlayback: true });
    }
    await sock.sendMessage(msg.key.remoteJid, { text: '✅', edit: msg.key });
  } catch (err) {
    console.error(`[${userId}] media conversion (${mode}) failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: `Conversion failed: ${err.message}`, edit: msg.key });
  }
}

// "/meme top text | bottom text", quote-replying to an image -- part of
// the Fun pack, usable by anyone messaging the bot (see deriveGamesConfig
// gating at the call site), unlike the owner-only commands above.
async function handleMemeCommand(userId, sock, msg, rawArgs) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  const quotedImage = quoted?.imageMessage;

  if (!quotedImage) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: 'Reply to an image with "/meme top text | bottom text" to make a meme.' },
      { quoted: msg },
    );
    return;
  }

  const [topText, bottomText] = (rawArgs || '').split('|').map((s) => s.trim());

  const synthetic = {
    key: { remoteJid: contextInfo.remoteJid || msg.key.remoteJid, id: contextInfo.stanzaId, fromMe: false },
    message: quoted,
  };

  try {
    const media = await downloadAnyMedia(synthetic, 'imageMessage', quotedImage);
    if (!media) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: 'That image is too large to meme-ify (max 8MB).' },
        { quoted: msg },
      );
      return;
    }
    const memed = await addMemeText(media.buffer, topText || '', bottomText || '');
    await sock.sendMessage(msg.key.remoteJid, { image: memed }, { quoted: msg });
  } catch (err) {
    console.error(`[${userId}] /meme failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: `Couldn't make that meme: ${err.message}` }, { quoted: msg });
  }
}

// "/robot", "/deep", "/chipmunk", "/echo" -- quote-reply to a voice note
// to get it back transformed. Same Fun-pack gating as /meme above.
async function handleVoiceEffectCommand(userId, sock, msg, effectName) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  const quotedAudio = quoted?.audioMessage;

  if (!quotedAudio) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `Reply to a voice note with /${effectName} to apply the effect.` },
      { quoted: msg },
    );
    return;
  }

  const synthetic = {
    key: { remoteJid: contextInfo.remoteJid || msg.key.remoteJid, id: contextInfo.stanzaId, fromMe: false },
    message: quoted,
  };

  try {
    const media = await downloadAnyMedia(synthetic, 'audioMessage', quotedAudio);
    if (!media) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: 'That voice note is too large to process (max 8MB).' },
        { quoted: msg },
      );
      return;
    }
    const transformed = await applyVoiceEffect(media.buffer, effectName);
    if (!transformed) {
      await sock.sendMessage(msg.key.remoteJid, { text: `Unknown voice effect "${effectName}".` }, { quoted: msg });
      return;
    }
    await sock.sendMessage(
      msg.key.remoteJid,
      { audio: transformed, mimetype: 'audio/ogg; codecs=opus', ptt: true },
      { quoted: msg },
    );
  } catch (err) {
    console.error(`[${userId}] /${effectName} failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: `Couldn't apply that effect: ${err.message}` }, { quoted: msg });
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
// sock.sendMessage can hang indefinitely rather than rejecting -- if
// WhatsApp never answers an internal query (e.g. fetching a contact's
// pre-keys to establish a Signal session), the returned promise simply
// never settles. That produces exactly the worst failure mode: nothing
// sent, nothing thrown, nothing logged, and the per-message loop stuck
// forever on the await. Racing a timeout turns that into a visible,
// recoverable error, and logging both sides makes a hang distinguishable
// from a rejection (a "start" with no matching "ok"/"failed" IS the hang).
const SEND_TIMEOUT_MS = 20000;

async function sendTracked(sock, userId, jid, content, options, label) {
  console.log(`[${userId}] send:${label} start -> ${jid}`);
  let timer;
  try {
    const sent = await Promise.race([
      sock.sendMessage(jid, content, options),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`sendMessage did not settle within ${SEND_TIMEOUT_MS}ms`)),
          SEND_TIMEOUT_MS,
        );
      }),
    ]);
    console.log(`[${userId}] send:${label} ok id=${sent?.key?.id || 'none'}`);
    return sent;
  } catch (err) {
    console.error(`[${userId}] send:${label} failed -> ${jid}:`, err.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function handleBlockContact(userId, sock, jid, blockDurationHours) {
  try {
    await sock.updateBlockStatus(jid, 'block');
  } catch (err) {
    if (jid.endsWith('@lid')) {
      console.error(
        `[${userId}] failed to block ${jid}: still a @lid JID (no phone number resolved for this ` +
          `contact yet) -- WhatsApp's blocklist only accepts real phone-number JIDs:`,
        err.message,
      );
    } else {
      console.error(`[${userId}] failed to block ${jid}:`, err.message);
    }
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
      // sock.end() is synchronous and returns nothing (not a promise) --
      // it just tears down the websocket and fires its own 'close' event.
      // Awaiting/`.catch()`-ing it here was throwing "Cannot read properties
      // of undefined (reading 'catch')" on every stale-pairing-attempt
      // replacement, which crashed this whole startSession() call.
      existing.sock.end(new Error('superseded by a new pairing attempt'));
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

  // Anti-link's warning counter: group JID -> Map(participant JID -> count).
  // Only grows if kickAfterWarnings is actually configured; capped at the
  // outer (group) level since a session realistically has far fewer groups
  // than contacts.
  const antiLinkViolations = new Map();

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
        console.error(`[${userId}] requestPairingCode failed:`, err.message);
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

      if (loggedOut) {
        // WhatsApp itself removed this device (unlinked from the phone's
        // Linked Devices list) -- this is permanent, not a transient drop.
        // Tell the web app so this session stops being "known" to the
        // reconnect watchdog; otherwise it gets retried every 2 minutes
        // forever, hitting WhatsApp's login endpoint with automated
        // connection attempts nobody asked for.
        markSessionLoggedOut(userId).catch((err) =>
          console.error(`[${userId}] failed to record logout:`, describeFetchError(err)),
        );
      } else {
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

      // WhatsApp attaches the real phone-number JID directly on a @lid-
      // addressed message's own key (sender_pn/participant_pn in the raw
      // stanza) whenever it has one to give -- a per-message resolution
      // that costs nothing, unlike lidToPhoneJid's other source
      // (refreshLidMappings' onWhatsApp lookups), which only ever covers
      // phone numbers someone bothered to configure an exception for.
      // Learning it here means resolveRemoteJid (used for exceptions,
      // history, and blocking) works for *any* @lid contact, not just
      // pre-configured ones.
      if (msg.key.senderPn && msg.key.remoteJid?.endsWith('@lid')) {
        lidToPhoneJid.set(jidNormalizedUser(msg.key.remoteJid), jidNormalizedUser(msg.key.senderPn));
      }
      if (msg.key.participantPn && msg.key.participant?.endsWith('@lid')) {
        lidToPhoneJid.set(jidNormalizedUser(msg.key.participant), jidNormalizedUser(msg.key.participantPn));
      }

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

      // WhatsApp Status updates arrive as ordinary messages addressed to
      // this special broadcast JID -- marking them read is what makes
      // them show as "viewed" to whoever posted it.
      if (msg.key.remoteJid === 'status@broadcast' && !msg.key.fromMe) {
        const statusView = deriveStatusViewConfig(await refreshPluginConfigs());
        if (statusView.enabled) {
          try {
            await sock.readMessages([msg.key]);
          } catch (err) {
            console.error(`[${userId}] failed to auto-view status:`, err.message);
          }
        }
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

      // Anti-link: only groups, only messages from someone else (the
      // owner's own links are never touched), only if it actually
      // contains something link-shaped.
      if (isGroupChat && !msg.key.fromMe && text && URL_RE.test(text)) {
        const antiLink = deriveAntiLinkConfig(await refreshPluginConfigs());
        if (antiLink.enabled) {
          const participantJid = msg.key.participant || msg.key.remoteJid;
          try {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const participant = metadata.participants.find((p) => p.id === participantJid);
            const isSenderAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            if (!isSenderAdmin) {
              await handleAntiLinkViolation(
                userId,
                sock,
                msg,
                msg.key.remoteJid,
                participantJid,
                antiLink.kickAfterWarnings,
                antiLinkViolations,
              );
              continue;
            }
          } catch (err) {
            console.error(`[${userId}] anti-link: failed to check group admin status:`, err.message);
          }
        }
      }

      // A voice note (as opposed to a shared audio file, e.g. a song --
      // WhatsApp tells the two apart via `ptt`, push-to-talk) has no text
      // at all, but is still something worth answering. Only the incoming
      // (non-fromMe) case matters here -- there's nothing sensible for
      // ai_write to "fix" about a voice note the owner sent themself.
      const isVoiceNote = msg.message.audioMessage?.ptt === true;
      // A sticker someone else sent has no text either, but AI Reply can
      // react to it directly (see ai_reply.py's incoming_sticker_bytes) --
      // only ever for stickers from someone else, not the owner's own
      // sticker sends, which are handled separately by /savesticker.
      const isIncomingSticker = !!msg.message.stickerMessage && !msg.key.fromMe;
      if (!text && !(isVoiceNote && !msg.key.fromMe) && !isIncomingSticker) continue;

      // Sudo: a trusted number who isn't the account owner can still use
      // /tagall and /poll (only those two -- not savesticker/savenote/
      // addbroadcast, which stay owner-only). Checked here, before the
      // normal fromMe/non-fromMe branches below, so it doesn't disturb
      // either of them; anything that isn't one of these two commands
      // falls straight through to normal non-owner processing exactly as
      // if the sender had no sudo status at all.
      if (!msg.key.fromMe) {
        const senderPhone = (msg.key.participant || msg.key.remoteJid).split('@')[0];
        const sudo = deriveSudoConfig(await refreshPluginConfigs());
        if (sudo.enabled && sudo.numbers.includes(senderPhone)) {
          const sudoTagAllMatch = text.match(TAG_ALL_COMMAND);
          if (sudoTagAllMatch && deriveTagAllConfig(await refreshPluginConfigs()).enabled) {
            await handleTagAllCommand(userId, sock, msg, sudoTagAllMatch[1]);
            continue;
          }
          const sudoPollMatch = text.match(POLL_COMMAND);
          if (sudoPollMatch && derivePollsConfig(await refreshPluginConfigs()).enabled) {
            await handlePollCommand(userId, sock, msg, sudoPollMatch[1]);
            continue;
          }
        }
      }

      // Meme generator and voice changer -- usable by anyone messaging the
      // bot, same as the Python-side Fun pack (8ball/rps/trivia), and
      // gated by that same "games" plugin toggle + its replyInGroups
      // setting. These bypass the plugin engine entirely (they need the
      // actual quoted media bytes, which the Python side never receives)
      // so the group-gating that games.py would normally do itself has to
      // be replicated here instead.
      if (!msg.key.fromMe) {
        const memeMatch = text.match(MEME_COMMAND);
        const voiceEffectMatch = text.match(VOICE_EFFECT_COMMAND);
        if (memeMatch || voiceEffectMatch) {
          const games = deriveGamesConfig(await refreshPluginConfigs());
          if (games.enabled && (!isGroupChat || games.replyInGroups)) {
            if (memeMatch) {
              await handleMemeCommand(userId, sock, msg, memeMatch[1]);
              continue;
            }
            await handleVoiceEffectCommand(userId, sock, msg, voiceEffectMatch[1].toLowerCase());
            continue;
          }
        }
      }

      // The plugin engine only ever needs this to key config/exceptions and
      // chat history -- actual sends below still target msg.key.remoteJid
      // as-is, since that's what WhatsApp expects for this chat.
      const resolvedFrom = resolveRemoteJid(msg.key.remoteJid);

      if (msg.key.fromMe) {
        if (aiSentMessageIds.has(msg.key.id)) {
          aiSentMessageIds.delete(msg.key.id);
          continue;
        }

        // Unlike the non-fromMe path below (which has always been wrapped
        // in its own try/catch, logging "plugin dispatch failed" on any
        // error), this whole block had no enclosing try/catch at all --
        // an uncaught exception from any command handler here (e.g. an
        // edit that fails for a JID form the edit protocol doesn't like)
        // silently killed the entire messages.upsert callback for that
        // message, with nothing logged anywhere. Wrapping it guarantees
        // an error surfaces instead of vanishing.
        try {
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

        const addBroadcastMatch = text.match(ADD_BROADCAST_COMMAND);
        if (addBroadcastMatch) {
          const broadcast = deriveBroadcastConfig(await refreshPluginConfigs());
          if (broadcast.enabled) {
            await handleAddBroadcastCommand(userId, sock, msg, addBroadcastMatch[1]);
            continue;
          }
        }

        const tagAllMatch = text.match(TAG_ALL_COMMAND);
        if (tagAllMatch) {
          const tagall = deriveTagAllConfig(await refreshPluginConfigs());
          if (tagall.enabled) {
            await handleTagAllCommand(userId, sock, msg, tagAllMatch[1]);
            continue;
          }
        }

        const pollMatch = text.match(POLL_COMMAND);
        if (pollMatch) {
          const polls = derivePollsConfig(await refreshPluginConfigs());
          if (polls.enabled) {
            await handlePollCommand(userId, sock, msg, pollMatch[1]);
            continue;
          }
        }

        const aiAskMatch = text.match(AI_ASK_COMMAND);
        if (aiAskMatch) {
          const aiAsk = deriveAiAskConfig(await refreshPluginConfigs());
          if (aiAsk.enabled) {
            await handleAskCommand(userId, sock, msg, aiAskMatch[1]);
            continue;
          }
        }

        if (STICKER_CONVERT_COMMAND.test(text) || IMG_CONVERT_COMMAND.test(text) || GIF_CONVERT_COMMAND.test(text)) {
          const mediaConvert = deriveMediaConvertConfig(await refreshPluginConfigs());
          if (mediaConvert.enabled) {
            const mode = STICKER_CONVERT_COMMAND.test(text) ? 'sticker' : IMG_CONVERT_COMMAND.test(text) ? 'img' : 'gif';
            await handleMediaConvertCommand(userId, sock, msg, mode);
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
        } catch (err) {
          // Temporary: full stack, not just err.message -- this is exactly
          // the catch that was missing, so pinpointing the precise failing
          // line matters more here than usual.
          console.error(`[${userId}] fromMe command dispatch failed:`, err.stack || err.message);
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

        let sticker;
        if (isIncomingSticker) {
          try {
            const buffer =
              cachedMedia?.mediaType === 'stickerMessage'
                ? cachedMedia.buffer
                : await downloadMediaMessage(msg, 'buffer', {});
            sticker = {
              data: buffer.toString('base64'),
              mimetype: msg.message.stickerMessage.mimetype || 'image/webp',
            };
          } catch (err) {
            console.error(`[${userId}] failed to download incoming sticker:`, err.message);
          }
        }

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
          images: replyImages,
        } = await forwardMessage({ userId, from: resolvedFrom, text, audio, sticker });

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
            const sent = await sendTracked(
              sock,
              userId,
              msg.key.remoteJid,
              { text: messagesToSend[i] },
              sendOptions,
              'ai-reply',
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

        if (Array.isArray(replyImages) && replyImages.length > 0) {
          // A handful of image results (see pinterest.py, imagine.py) --
          // sent as separate messages in sequence, with a brief human-like
          // gap so they don't all land in the same instant.
          for (let i = 0; i < replyImages.length; i++) {
            try {
              const sentImage = await sock.sendMessage(msg.key.remoteJid, {
                image: Buffer.from(replyImages[i].data, 'base64'),
                mimetype: replyImages[i].mimetype || 'image/jpeg',
              });
              markAiSent(sentImage?.key?.id);
            } catch (err) {
              console.error(`[${userId}] failed to send image reply:`, err.message);
            }
            if (i < replyImages.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 600));
            }
          }
        }

        if (block) {
          // Unlike sending (which addresses whatever JID form the chat
          // actually uses), WhatsApp's blocklist protocol only accepts a
          // real phone-number JID -- passing a @lid JID gets rejected
          // outright ("bad-request"), confirmed against Baileys' own
          // updateBlockStatus, which forwards whatever jid it's given
          // as-is with no LID resolution of its own. resolvedFrom is the
          // best phone-JID guess available (see the senderPn/participantPn
          // learning above); if this contact was never resolved, it falls
          // back to the raw JID and the block attempt still fails the
          // same way as before, just with a clearer log below.
          await handleBlockContact(userId, sock, resolvedFrom, blockDurationHours);
        }
      } catch (err) {
        console.error(`[${userId}] plugin dispatch failed:`, err.message);
      }
    }
  });

  sock.ev.on('group-participants.update', async ({ id: groupJid, participants, action }) => {
    if (action !== 'add' && action !== 'remove') return; // ignore promote/demote

    const welcome = deriveWelcomeConfig(await refreshPluginConfigs());
    if (!welcome.enabled) return;
    if (action === 'add' && !welcome.welcomeEnabled) return;
    if (action === 'remove' && !welcome.goodbyeEnabled) return;

    let groupName = groupJid.split('@')[0];
    try {
      const metadata = await sock.groupMetadata(groupJid);
      groupName = metadata.subject || groupName;
    } catch (err) {
      console.error(`[${userId}] failed to fetch group metadata for ${groupJid}:`, err.message);
    }

    const template = action === 'add' ? welcome.welcomeMessage : welcome.goodbyeMessage;
    for (const participantJid of participants) {
      const user = `@${participantJid.split('@')[0]}`;
      try {
        await sock.sendMessage(groupJid, {
          text: fillTemplate(template, { user, group: groupName }),
          mentions: [participantJid],
        });
      } catch (err) {
        console.error(`[${userId}] failed to send welcome/goodbye in ${groupJid}:`, err.message);
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
