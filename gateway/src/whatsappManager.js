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
import {
  usePostgresAuthState,
  hasStoredCreds,
  clearAuthState,
  clearContactSessions,
} from './postgresAuthState.js';
import { forwardMessage, forwardOwnMessage, fetchExceptionNumbers, askAI } from './pluginClient.js';
import {
  createScheduledTask,
  cancelTimerTask,
  saveSticker,
  fetchSticker,
  fetchSessionPluginConfigs,
  fetchShardsSummary,
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
  applyVoiceEffect,
  generateQrCode,
  resolveQrColor,
  generateHelpBanner,
} from './mediaConvert.js';

// Every command uses the same "!" starter -- used to be a mix of "/" (the
// older commands) and "!" (everything built more recently), which meant
// remembering which prefix a given command needed. "#name" (note recall)
// is deliberately left alone -- it's a reference shorthand dropped inline
// into a sentence, not a command verb, so a "!" there would look wrong.
const SAVE_STICKER_COMMAND = /^!savesticker\s+(\S+)/i;
const SAVE_NOTE_COMMAND = /^!savenote\s+(\S+)/i;
const ADD_BROADCAST_COMMAND = /^!addbroadcast\s+(\S+)/i;
const TAG_ALL_COMMAND = /^!tagall(?:\s+([\s\S]+))?$/i;
const POLL_COMMAND = /^!poll\s+([\s\S]+)/i;
const AI_ASK_COMMAND = /^!ai(?:\s+([\s\S]+))?$/i;
const AI_ASK_EDIT_COMMAND = /^!aie(?:\s+([\s\S]+))?$/i;
const STICKER_CONVERT_COMMAND = /^!sticker\b/i;
const IMG_CONVERT_COMMAND = /^!img\b/i;
const GIF_CONVERT_COMMAND = /^!gif\b/i;
// Commands implemented as Python plugins rather than in this file (see
// plugins/app/plugins/*.py). Everything else the owner types is handled by
// the gateway-side handlers above, but these have to be forwarded to the
// plugin engine -- which the fromMe branch otherwise never does, since it
// only ever calls forwardOwnMessage (ai_write's rewrite). That meant the
// account owner could never use their own !imagine, !pinterest, !song or
// Fun commands: they only ever fired for messages from other people.
const PLUGIN_COMMAND_RE = /^!(?:song|imagine|pinterest|meme|8ball|rps|trivia|translate|tl)\b/i;

const VOICE_EFFECT_COMMAND = /^!(robot|deep|chipmunk|echo)\b/i;
const QR_COMMAND = /^!qr(?:\s+([\s\S]+))?$/i;
const TIMER_COMMAND = /^!timer(?:\s+([\s\S]+))?$/i;
const STATUS_COMMAND = /^!status(?:\s+(all))?$/i;
const HELP_COMMAND = /^!help$/i;
// Reply to a running timer's own message with "!stop" to cancel it.
const STOP_COMMAND = /^!stop$/i;

// "..happy" -- the owner types it, and their own message is edited in
// place through a run of frames so it plays as an animation. Deliberately
// NOT the "!" prefix every other command uses: this isn't a command that
// produces a reply, it's a shorthand that turns the message you just sent
// into something else, so it reads better as its own thing. Strict on
// purpose (letters only, 2-14 of them, nothing after) so ordinary
// messages that happen to start with a dot can never trigger it.
const ANIMATE_COMMAND = /^\.\.([a-z]{2,14})$/i;

// Each entry is the frames to step through, optionally repeated (`loops`)
// and optionally settling on a different `final` frame that stays as the
// message's permanent content once the animation finishes.
const EMOJI_ANIMATIONS = {
  happy: {
    frames: ['( -_- )', '( •_• )', '( ^_^ )', '( ^o^ )', '\\( ^o^ )/', '\\( ^o^ )/ ✨'],
    final: '😄 ✨🎉',
  },
  love: { frames: ['🤍', '💗', '💖', '💞', '💖', '💗'], loops: 2, final: '❤️ ✨' },
  fire: {
    frames: ['·', '.', '🔥', '🔥🔥', '🔥🔥🔥', '🔥🔥🔥🔥', '🔥🔥🔥🔥🔥'],
    final: '🔥 LIT 🔥',
  },
  party: { frames: ['🎉', '🎉🎊', '🎉🎊✨', '🥳 🎉🎊✨'], loops: 2, final: '🎊✨🎉 🥳 🎉✨🎊' },
  boom: {
    frames: ['·', '˙', '✦', '✧', '💥', '💥💥', '🔥💥🔥', '💨 💥 💨'],
    final: '💥 BOOM 💥',
  },
  cool: {
    frames: ['( •_• )', '( •_• )>', '( •_•)>⌐■-■', '(⌐■_■)'],
    final: '(⌐■_■) deal with it 😎',
  },
  sad: { frames: ['( •_• )', '( ._. )', '( ;_; )', '( ╥﹏╥ )', '😢'], final: '😭' },
  think: { frames: ['( •_• ) ?', '( ·_· ) ??', '( ¬_¬ ) ???', '🤔 💭'], final: '💡 !' },
  wave: {
    frames: [
      '👋 · · · ·',
      '· 👋 · · ·',
      '· · 👋 · ·',
      '· · · 👋 ·',
      '· · · · 👋',
      '· · · 👋 ·',
      '· · 👋 · ·',
      '· 👋 · · ·',
    ],
    final: '👋 hey!',
  },
  loading: {
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    loops: 3,
    final: '✅ done',
  },
};

const ANIMATION_NAMES = Object.keys(EMOJI_ANIMATIONS).sort();
// Every frame is one message edit, i.e. one round trip -- this caps how
// many any single animation can ever spend, however it's configured.
const MAX_ANIMATION_FRAMES = 40;
// A floor, not a fixed delay (see handleEmojiAnimation): frames are paced
// by how fast WhatsApp actually accepts each edit, and this only kicks in
// when a round trip comes back faster than this.
const MIN_ANIMATION_FRAME_MS = 60;

function buildAnimationFrames(animation) {
  const frames = [];
  for (let loop = 0; loop < (animation.loops || 1); loop += 1) frames.push(...animation.frames);
  if (animation.final) frames.push(animation.final);
  return frames.slice(0, MAX_ANIMATION_FRAMES);
}

// Plays an animation by editing the owner's own message repeatedly.
// Owner-only by necessity, not just by policy: WhatsApp only allows a
// message to be edited by the account that sent it, so this can only ever
// work on the owner's own outgoing messages (same constraint AI Write
// runs under).
//
// Speed: frames are sent sequentially and awaited rather than fired off in
// parallel. That's deliberate -- unawaited edits can land out of order,
// which shows up as a visibly scrambled animation that settles on the
// wrong frame. Since each edit is a real round trip, awaiting it *is* the
// pacing; the only added delay is a floor applied when a round trip
// returns faster than MIN_ANIMATION_FRAME_MS, so on a slow connection the
// animation runs flat out with no artificial delay stacked on top.
async function handleEmojiAnimation(userId, sock, msg, name) {
  const animation = EMOJI_ANIMATIONS[name.toLowerCase()];
  if (!animation) {
    await sock
      .sendMessage(msg.key.remoteJid, { text: `Animations: ${ANIMATION_NAMES.join(', ')}`, edit: msg.key })
      .catch((err) => console.error(`[${userId}] ..${name} list failed:`, err.message));
    return;
  }

  const frames = buildAnimationFrames(animation);
  for (const frame of frames) {
    const startedAt = Date.now();
    try {
      await sock.sendMessage(msg.key.remoteJid, { text: frame, edit: msg.key });
    } catch (err) {
      // Half a played animation is a fine place to stop -- the message is
      // left on whatever frame it reached rather than being retried.
      console.error(`[${userId}] ..${name} frame failed:`, err.message);
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_ANIMATION_FRAME_MS) await wait(MIN_ANIMATION_FRAME_MS - elapsed);
  }
}

// Grouped by category for "!help" (owner-only -- see the dispatch site).
// Every entry is always listed, on or off, each prefixed with 🟢/🔴 so the
// owner can see at a glance what's actually live without having to open
// the dashboard first. `key` is the SessionPlugin key that gates it (see
// refreshPluginConfigs); `key: null` means it's always on (no toggle
// exists for it).
const HELP_SECTIONS = [
  {
    title: 'AI',
    entries: [
      {
        key: 'ai_ask',
        name: 'AI Ask',
        lines: ['!ai <question> -- answers as its own reply', '!aie <question> -- same, but edits your message in place'],
      },
    ],
  },
  {
    title: 'FUN',
    entries: [
      {
        key: 'emoji_animate',
        name: 'Animations',
        lines: [`..${ANIMATION_NAMES.slice(0, 4).join(' / ..')} -- animates your own message in place`, `all: ..${ANIMATION_NAMES.join(', ..')}`],
      },
      {
        key: 'games',
        name: 'Fun',
        lines: [
          '!8ball <question>',
          '!rps rock|paper|scissors',
          '!trivia (answer with !trivia answer <letter>)',
          '!meme [subreddit]',
          '!robot / !deep / !chipmunk / !echo -- reply to a voice note',
        ],
      },
    ],
  },
  {
    title: 'MEDIA',
    entries: [
      { key: 'qr', name: 'QR Codes', lines: ['!qr <text or link> -- add a color, or two for a gradient'] },
      {
        key: 'media_convert',
        name: 'Sticker Maker',
        lines: ['!sticker -- reply to an image/video', '!img -- reply to a sticker', '!gif -- reply to an animated sticker'],
      },
      { key: 'song', name: 'Song Fetcher', lines: ['!song <genre, mood, or artist>'] },
      { key: 'imagine', name: 'Imagine', lines: ['!imagine <description>'] },
      { key: 'pinterest', name: 'Pinterest', lines: ['!pinterest <search term>'] },
    ],
  },
  {
    title: 'UTILITY',
    entries: [
      {
        key: 'translate',
        name: 'Translate',
        lines: ['!translate <language> <text>, or !tl es hello -- or reply to a message with !tl <language>'],
      },
      {
        key: 'timer',
        name: 'Timers',
        lines: [
          '!timer <duration> [message], e.g. !timer 10m tea is ready',
          'under 14m counts down live; longer ones ping you when up',
          'reply !stop to a timer to cancel it',
        ],
      },
      {
        key: 'session_status',
        name: 'Session Info',
        lines: ["!status -- this session's own connection info", '!status all -- every shard (admins only)'],
      },
    ],
  },
  {
    title: 'NOTES & GROUPS',
    entries: [
      { key: null, name: 'Save Sticker (always on)', lines: ['!savesticker <tag> -- reply to a sticker'] },
      { key: 'notes', name: 'Notes', lines: ['!savenote <name> -- reply to any message', '#name -- recall a saved note anywhere'] },
      { key: 'broadcast', name: 'Broadcasts', lines: ['!addbroadcast <name> -- tag a group for broadcasts'] },
      { key: 'tagall', name: 'Tag Everyone', lines: ['!tagall <message> -- mention everyone in a group'] },
      { key: 'polls', name: 'Polls', lines: ['!poll question | option1 | option2'] },
    ],
  },
];

function buildHelpCaption(plugins) {
  const enabledKeys = new Set(plugins.filter((p) => p.enabled).map((p) => p.key));
  const lines = ['┏━━━━━━━━━━━━━━━━━━┓', '┃  WHATSAFORGE MENU  ┃', '┗━━━━━━━━━━━━━━━━━━┛', ''];
  for (const section of HELP_SECTIONS) {
    lines.push(`★ ${section.title} ★`);
    for (const entry of section.entries) {
      const on = entry.key === null || enabledKeys.has(entry.key);
      lines.push(`${on ? '🟢' : '🔴'} ${entry.name}`, ...entry.lines, '');
    }
  }
  return lines.join('\n').trim();
}

// "!help" -- owner-only (see the dispatch site, inside the fromMe branch).
// Lists every command, live or not, rather than filtering to just what's
// on -- the point is the owner seeing the whole toggle board at a glance,
// not just the working subset. Sent as an image with the command list as
// its caption rather than a plain-text wall, matching the "here's what I
// can do" banner pattern most WhatsApp bots use.
async function handleHelpCommand(userId, sock, msg, plugins) {
  try {
    const banner = await generateHelpBanner();
    const caption = buildHelpCaption(plugins);
    await sock.sendMessage(msg.key.remoteJid, { image: banner, caption }, { quoted: msg });
  } catch (err) {
    console.error(`[${userId}] !help failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: "Couldn't build the help menu right now -- try again?" }, { quoted: msg });
  }
}

const MAX_TIMER_LABEL_LENGTH = 200;

// "!timer 5m", "!timer 90s", "!timer 1h30m", a bare number of minutes
// ("!timer 5"), and optionally a message to fire when it's up
// ("!timer 10m time's upppp"). Multiple units combine (h/m/s in any
// order), matching how people actually type durations rather than
// requiring one strict format. Returns { durationMs, label }.
function parseTimerArgs(input) {
  const cleaned = (input || '').trim();
  if (!cleaned) return null;

  // Anchored at the start and consumed token by token, rather than the
  // old global scan over the whole string: now that a trailing label is
  // allowed, a free-text label containing a number ("!timer 5m call mum
  // at 6") would otherwise have its digits silently absorbed into the
  // duration. Only a leading run of duration tokens counts; whatever is
  // left over is the label, verbatim.
  //
  // Alternatives listed longest-first within each unit, since regex
  // alternation takes the first one that matches rather than the longest
  // -- "min" before "m" would otherwise never get a chance to match, and
  // "5minutes" would silently parse as "5m" plus leftover garbage.
  //
  // `(?![a-z])` instead of `\b`: a trailing \b fails between a unit
  // letter and a following digit (both count as "word" characters to
  // regex), which broke a compound duration typed with no spaces --
  // "1h30m" matched only "30m" and silently dropped the "1h". The
  // lookahead only rejects being followed by another *letter* (so a
  // stray match inside an unrelated word like "milk" still can't
  // happen), which is the only thing that actually needed rejecting.
  const unitRe = /^\s*(\d+)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)(?![a-z])/i;
  let rest = cleaned;
  let totalMs = 0;
  let matchedAny = false;
  let m;
  while ((m = rest.match(unitRe))) {
    matchedAny = true;
    const value = Number(m[1]);
    const unit = m[2][0].toLowerCase();
    if (unit === 'h') totalMs += value * 3600000;
    else if (unit === 'm') totalMs += value * 60000;
    else totalMs += value * 1000;
    rest = rest.slice(m[0].length);
  }

  if (!matchedAny) {
    // Bare leading number = minutes ("!timer 5", "!timer 5 stretch").
    const bare = rest.match(/^\s*(\d+)(?![\w])/);
    if (!bare) return null;
    totalMs = Number(bare[1]) * 60000;
    rest = rest.slice(bare[0].length);
  }

  return { durationMs: totalMs, label: rest.trim().slice(0, MAX_TIMER_LABEL_LENGTH) };
}

function formatTimerRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Keycap-emoji digits, so a running countdown reads as a clock face
// ("[0️⃣0️⃣:0️⃣2️⃣:5️⃣9️⃣]") instead of plain text. Always padded to
// HH:MM:SS -- fixed width means the message doesn't reflow every tick.
const EMOJI_DIGITS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function toEmojiDigits(value) {
  return String(value)
    .padStart(2, '0')
    .split('')
    .map((d) => EMOJI_DIGITS[Number(d)])
    .join('');
}

function formatTimerEmoji(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `[${toEmojiDigits(h)}:${toEmojiDigits(m)}:${toEmojiDigits(s)}]`;
}

// "1h 30m" -- for the one-shot confirmation/ping of a long timer, where a
// ticking clock face isn't what's being shown.
function formatTimerWords(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

function buildTimerProgressBar(fraction) {
  const totalSegments = 10;
  const filled = Math.max(0, Math.min(totalSegments, Math.round(fraction * totalSegments)));
  return '▓'.repeat(filled) + '░'.repeat(totalSegments - filled);
}

// WhatsApp only accepts an edit to a message for ~15 minutes after it was
// sent. Past that the edit is rejected, so a countdown that keeps editing
// its own message just silently freezes on whatever it last managed to
// write -- which is exactly what the previous version of this did for
// anything over 15 minutes. So: only durations that fit inside that
// window count down in place; longer ones can't, and are handled as a
// persisted "ping me when it's up" task instead (see handleTimerCommand).
// 14, not 15, to leave headroom for the final tick.
const TIMER_EDIT_WINDOW_MS = 14 * 60 * 1000;
// A per-second countdown means one message edit per second -- fine for a
// genuinely short timer, but it's sustained protocol traffic against a
// single message, so only the shortest tier gets it. Anything above it
// (but still inside the edit window) ticks every 5s as before.
const LIVE_TIMER_MAX_MS = 5 * 60 * 1000;
const LIVE_TIMER_INTERVAL_MS = 1000;
const SPARSE_TIMER_INTERVAL_MS = 5000;
const MIN_TIMER_DURATION_MS = 10 * 1000;
const MAX_TIMER_DURATION_MS = 24 * 60 * 60 * 1000;
// A concurrency cap, not just a duration cap: without one, a burst of
// "!timer" commands spawns unbounded setIntervals for this session --
// exactly the class of unbounded per-session growth that has already
// caused a real OOM crash loop in this codebase (see lidToPhoneJid).
const MAX_CONCURRENT_TIMERS = 3;
// Consecutive failed edits before a countdown gives up (see the tick loop).
const MAX_TIMER_TICK_FAILURES = 3;
const NOTE_RECALL_RE = /#([a-z0-9_-]{2,})/i;

// Shared by anti-delete's eager media caching, "!savenote", and voice-note
// transcription -- one place that knows how to detect and download
// whatever media type a message contains, instead of each feature quietly
// re-downloading the same file (a voice note, in particular, would
// otherwise get downloaded twice: once for anti-delete, once to transcribe).
// Baileys 6 always downloaded media from mmg.whatsapp.net. Baileys 7
// changed this to "honour a non-default host carried by the proto"
// (downloadContentFromMessage: `opts.host ?? extractHost(url)`), so it now
// takes the host out of the message's own `url` field. Some messages carry
// hosts that don't resolve publicly at all -- a.whatsapp.net and
// media.whatsapp.net both fail DNS outright, verified directly, while
// mmg.whatsapp.net resolves fine -- which is why every download started
// dying with "fetch failed: getaddrinfo ENOTFOUND a.whatsapp.net" after
// the upgrade. `opts.host` takes precedence, so pinning it back to the
// real media host restores the v6 behaviour.
const MEDIA_DOWNLOAD_OPTS = { host: 'mmg.whatsapp.net' };

const MEDIA_MESSAGE_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
const MAX_MEDIA_DOWNLOAD_BYTES = 8 * 1024 * 1024; // covers virtually all images/voice notes/short videos/documents

function detectMediaType(messageContent) {
  return MEDIA_MESSAGE_TYPES.find((t) => messageContent[t]);
}

// The plain text of whatever message this one is quote-replying to, if
// any -- '' when it isn't a reply, or the quoted message wasn't text.
// Same extraction the gateway's own commands (!savenote, !ai) already do
// for themselves; forwarded to the plugin engine too so Python plugins
// can see it (e.g. !translate translating the quoted message rather than
// needing the text typed inline every time).
function extractQuotedText(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return '';
  return quoted.conversation || quoted.extendedTextMessage?.text || '';
}

// Returns null (rather than throwing) for "too large to bother with" so
// callers can treat that exactly like "nothing worth capturing" instead of
// needing their own size-check branch.
async function downloadAnyMedia(msg, mediaType, mediaObj) {
  const fileLength = Number(mediaObj.fileLength) || 0;
  if (fileLength > MAX_MEDIA_DOWNLOAD_BYTES) return null;

  const buffer = await downloadMediaMessage(msg, 'buffer', MEDIA_DOWNLOAD_OPTS);
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

function deriveStatusConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'session_status');
  return { enabled: !!(entry && entry.enabled) };
}

function deriveAnimateConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'emoji_animate');
  return { enabled: !!(entry && entry.enabled) };
}

// The Fun pack's own plugin key -- games.py (8ball/rps/trivia) already
// gates itself on this via the plugin engine, but !meme and the voice
// effects bypass the plugin engine entirely (they need real quoted media
// bytes the Python side never receives), so the same enabled+
// replyInGroups gating has to be replicated here.
function deriveGamesConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'games');
  if (!entry || !entry.enabled) return { enabled: false, replyInGroups: false };
  return { enabled: true, replyInGroups: !!entry.settings?.replyInGroups };
}

function deriveQrConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'qr');
  if (!entry || !entry.enabled) return { enabled: false, replyInGroups: false };
  return { enabled: true, replyInGroups: !!entry.settings?.replyInGroups };
}

function deriveTimerConfig(plugins) {
  const entry = plugins.find((p) => p.key === 'timer');
  if (!entry || !entry.enabled) return { enabled: false, replyInGroups: false };
  return { enabled: true, replyInGroups: !!entry.settings?.replyInGroups };
}

// Trusted numbers who can use !tagall and !poll without being the account
// owner. Deliberately scoped to just these two utility commands rather
// than every owner-only capability (savesticker!savenote!addbroadcast
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
// existing sticker message with "!savesticker <tag>" -- see
// gateway/README.md's "Sticker capture". Feedback is given by editing the
// command message itself in place (same idiom AI Write already uses for
// its own edits), not by sending a new visible message into whatever chat
// the command happened to be used in.
async function handleSaveStickerCommand(userId, sock, msg, rawTag) {
  const tag = rawTag.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quotedSticker = contextInfo?.quotedMessage?.stickerMessage;

  if (!tag) {
    await sendCommandFeedback(sock, userId, msg, 'Usage: !savesticker <tag> (reply to a sticker)', 'command');
    return;
  }
  if (!quotedSticker) {
    await sendCommandFeedback(sock, userId, msg, `Reply directly to a sticker message with !savesticker ${tag}`, 'command');
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
    const buffer = await downloadMediaMessage(synthetic, 'buffer', MEDIA_DOWNLOAD_OPTS);
    console.log(`[${userId}] downloaded sticker "${tag}": ${buffer.length} bytes`);
    await saveSticker({
      sessionId: userId,
      tag,
      data: buffer.toString('base64'),
      mimetype: quotedSticker.mimetype || 'image/webp',
    });
    await sendCommandFeedback(sock, userId, msg, `Saved sticker as "${tag}"`, 'command');
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save sticker "${tag}":`, detail);
    await sendCommandFeedback(sock, userId, msg, `Failed to save sticker: ${detail}`, 'command');
  }
}

// Lets the account owner save a quick-recall snippet by quote-replying to
// *any* message -- text or media, whatever it was -- with
// "!savenote <name>", then drop it into any conversation later with
// "#name" (see handleNoteRecall below). Same feedback idiom as
// !savesticker: edits the command message itself in place.
async function handleSaveNoteCommand(userId, sock, msg, rawName) {
  const name = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;

  if (!name) {
    await sendCommandFeedback(sock, userId, msg, 'Usage: !savenote <name> (reply to any message)', 'command');
    return;
  }
  if (!quoted) {
    await sendCommandFeedback(sock, userId, msg, `Reply directly to a message with !savenote ${name}`, 'command');
    return;
  }

  const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || '';
  const mediaType = detectMediaType(quoted);

  try {
    if (mediaType) {
      // Same synthetic-wrapper trick as !savesticker -- a quoted message
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
        await sendCommandFeedback(sock, userId, msg, 'That file is too large to save as a note (max 8MB).', 'command');
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
      await sendCommandFeedback(sock, userId, msg, 'Nothing to save from that message.', 'command');
      return;
    }
    await sendCommandFeedback(sock, userId, msg, `Saved note "${name}"`, 'savenote-confirm');
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save note "${name}":`, detail);
    // Reporting the failure must not itself throw -- this send is exactly
    // as likely to fail as the one that just did, and an uncaught error
    // here would escape the caller entirely.
    try {
      await sendCommandFeedback(sock, userId, msg, `Failed to save note: ${detail}`, 'savenote-error');
    } catch {
      // already logged by sendTracked
    }
  }
}

// Lets the owner tag a group for broadcast use with "!addbroadcast <name>"
// sent *inside* that group -- avoids ever needing to know/type the
// group's opaque JID by hand. Only valid inside a group; using it in a DM
// doesn't mean anything.
async function handleAddBroadcastCommand(userId, sock, msg, rawName) {
  const name = rawName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!name) {
    await sendCommandFeedback(sock, userId, msg, 'Usage: !addbroadcast <name> (send inside the group)', 'command');
    return;
  }
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sendCommandFeedback(sock, userId, msg, '!addbroadcast only works inside a group.', 'command');
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
    await sendCommandFeedback(sock, userId, msg, `This group is now tagged for broadcasts as "${name}"`, 'command');
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] failed to save broadcast group "${name}":`, detail);
    await sendCommandFeedback(sock, userId, msg, `Failed to tag group: ${detail}`, 'command');
  }
}

// "!tagall <message>" -- mentions every group member at once. Only
// meaningful inside a group; the mention list is silent (no visible @tag
// text per person) but still pings everyone, same as a real @all mention.
async function handleTagAllCommand(userId, sock, msg, rawMessage) {
  if (!msg.key.remoteJid.endsWith('@g.us')) {
    await sendCommandFeedback(sock, userId, msg, '!tagall only works inside a group.', 'command');
    return;
  }
  try {
    const metadata = await sock.groupMetadata(msg.key.remoteJid);
    const participantJids = metadata.participants.map((p) => p.id);
    const text = (rawMessage || 'Attention everyone!').trim();
    await sock.sendMessage(msg.key.remoteJid, { text, mentions: participantJids });
  } catch (err) {
    console.error(`[${userId}] !tagall failed:`, err.message);
    await sendCommandFeedback(sock, userId, msg, `Failed to tag everyone: ${err.message}`, 'command');
  }
}

// "!poll question | option1 | option2 | ..." -- sends a real native
// WhatsApp poll (not a text-based fake one).
async function handlePollCommand(userId, sock, msg, rawPoll) {
  const parts = rawPoll.split('|').map((p) => p.trim()).filter(Boolean);
  const [question, ...options] = parts;
  if (!question || options.length < 2) {
    await sendCommandFeedback(sock, userId, msg, 'Usage: !poll question | option1 | option2 | ...(up to 12 options)', 'command');
    return;
  }
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      poll: { name: question, values: options.slice(0, 12), selectableCount: 1 },
    });
  } catch (err) {
    console.error(`[${userId}] !poll failed:`, err.message);
    await sendCommandFeedback(sock, userId, msg, `Failed to create poll: ${err.message}`, 'command');
  }
}

// One-shot AI question, triggered by "!ai <question>" / "!aie <question>",
// or by replying to any message with just "!ai"/"!aie" (asks about the
// quoted message). Distinct from the ongoing AI Reply conversation flow --
// this is a single ask. Two entry points, same question-answering logic:
// "!ai" sends the answer as its own quoted reply (real conversational
// content worth keeping visible/quotable, not a brief status), while
// "!aie" edits the command in place instead, for whoever wants the
// tidier, no-extra-message version every other owner-only command uses.
async function handleAskCommand(userId, sock, msg, rawQuestion, { editInPlace }) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  const quotedText = quoted ? quoted.conversation || quoted.extendedTextMessage?.text || '' : '';

  const typed = (rawQuestion || '').trim();
  const question = quotedText && typed ? `Regarding this message: "${quotedText}"\n\n${typed}` : quotedText || typed;

  const deliver = (text, label) =>
    editInPlace
      ? sendTracked(sock, userId, msg.key.remoteJid, { text, edit: msg.key }, undefined, label)
      : sendTracked(sock, userId, msg.key.remoteJid, { text }, { quoted: msg }, label);

  if (!question) {
    const usageCommand = editInPlace ? '!aie' : '!ai';
    await deliver(
      `Usage: ${usageCommand} <question>, or reply to a message with ${usageCommand} to ask about it.`,
      'ai-ask-usage',
    );
    return;
  }

  try {
    const answer = await askAI({ userId, question });
    await deliver(answer || 'No AI provider configured, or that request failed -- try again?', 'ai-ask');
  } catch (err) {
    const detail = describeFetchError(err);
    console.error(`[${userId}] !ai request failed:`, detail);
    await deliver(`AI request failed: ${detail}`, 'ai-ask-error');
  }
}

// Converts whatever media the owner quote-replies to: an image or
// video/gif into a sticker ("!sticker"), a sticker back into a plain
// image ("!img"), or an animated sticker into a normal video ("!gif").
// Same synthetic-quoted-message-wrapper trick as !savesticker!savenote --
// downloadMediaMessage only needs something shaped like a real message.
async function handleMediaConvertCommand(userId, sock, msg, mode) {
  const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = contextInfo?.quotedMessage;
  const mediaType = quoted && detectMediaType(quoted);

  if (!quoted || !mediaType) {
    const usage = {
      sticker: 'Reply to an image or video/gif with !sticker to make a sticker.',
      img: 'Reply to a sticker with !img to convert it to an image.',
      gif: 'Reply to a sticker with !gif to convert it to a video.',
    }[mode];
    await sendCommandFeedback(sock, userId, msg, usage, 'command');
    return;
  }

  const synthetic = {
    key: { remoteJid: contextInfo.remoteJid || msg.key.remoteJid, id: contextInfo.stanzaId, fromMe: false },
    message: quoted,
  };

  try {
    const media = await downloadAnyMedia(synthetic, mediaType, quoted[mediaType]);
    if (!media) {
      await sendCommandFeedback(sock, userId, msg, 'That file is too large to convert (max 8MB).', 'command');
      return;
    }

    if (mode === 'sticker') {
      if (mediaType !== 'imageMessage' && mediaType !== 'videoMessage') {
        await sendCommandFeedback(sock, userId, msg, 'Reply to an image or video/gif with !sticker to make a sticker.', 'command');
        return;
      }
      const webp =
        mediaType === 'imageMessage'
          ? await imageToSticker(media.buffer)
          : await mediaToAnimatedSticker(media.buffer);
      await sock.sendMessage(msg.key.remoteJid, { sticker: webp });
    } else if (mode === 'img') {
      if (mediaType !== 'stickerMessage') {
        await sendCommandFeedback(sock, userId, msg, 'Reply to a sticker with !img.', 'command');
        return;
      }
      const png = await stickerToImage(media.buffer);
      await sock.sendMessage(msg.key.remoteJid, { image: png });
    } else if (mode === 'gif') {
      if (mediaType !== 'stickerMessage') {
        await sendCommandFeedback(sock, userId, msg, 'Reply to a sticker with !gif.', 'command');
        return;
      }
      const mp4 = await stickerToVideo(media.buffer);
      if (!mp4) {
        await sendCommandFeedback(sock, userId, msg, "That's a static sticker -- there's no motion to turn into a video.", 'command');
        return;
      }
      await sock.sendMessage(msg.key.remoteJid, { video: mp4, gifPlayback: true });
    }
    await sendCommandFeedback(sock, userId, msg, '✅', 'command');
  } catch (err) {
    console.error(`[${userId}] media conversion (${mode}) failed:`, describeFetchError(err));
    await sendCommandFeedback(sock, userId, msg, `Conversion failed: ${err.message}`, 'command');
  }
}

// "!robot", "!deep", "!chipmunk", "!echo" -- quote-reply to a voice note
// to get it back transformed. Same Fun-pack gating as !meme above.
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
    console.error(`[${userId}] /${effectName} failed:`, describeFetchError(err));
    await sock.sendMessage(msg.key.remoteJid, { text: `Couldn't apply that effect: ${err.message}` }, { quoted: msg });
  }
}

// "!qr <text or link>", "!qr <color> <text or link>", or
// "!qr <color1> <color2> <text or link>" for a gradient. Up to the first
// two whitespace-separated words are consumed as colors if (and only if)
// they resolve to a known one -- whatever's left, rejoined, is the actual
// QR content, so "!qr blue" alone (nothing left over) correctly encodes
// the literal text "blue" rather than erroring on "no content given".
async function handleQrCommand(userId, sock, msg, rawArgs) {
  const parts = (rawArgs || '').trim().split(/\s+/);
  const colors = [];
  while (parts.length > 1 && colors.length < 2) {
    const resolved = resolveQrColor(parts[0]);
    if (!resolved) break;
    colors.push(resolved);
    parts.shift();
  }
  const content = parts.join(' ').trim();

  if (!content) {
    await sock.sendMessage(
      msg.key.remoteJid,
      {
        text:
          'Usage: !qr <text or link>, !qr <color> <text or link>, or ' +
          '!qr <color> <color> <text or link> for a gradient.',
      },
      { quoted: msg },
    );
    return;
  }

  try {
    const png = await generateQrCode(content, colors);
    await sock.sendMessage(msg.key.remoteJid, { image: png }, { quoted: msg });
  } catch (err) {
    console.error(`[${userId}] !qr failed:`, err.message);
    await sock.sendMessage(msg.key.remoteJid, { text: `Couldn't generate that QR code: ${err.message}` }, { quoted: msg });
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
  if (!note) {
    console.log(`[${userId}] note recall: no note named "${name}" -- falling through to ai_write`);
    return false;
  }

  try {
    const targetJid = msg.key.remoteJid;
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
        const sent = await sendTracked(sock, userId, targetJid, content, undefined, 'note-recall-media');
        markAiSent(sent?.key?.id);
      }
    } else {
      const sent = await sendTracked(sock, userId, targetJid, { text: note.text }, undefined, 'note-recall');
      markAiSent(sent?.key?.id);
    }
  } catch (err) {
    console.error(`[${userId}] failed to send recalled note "${name}":`, err.message);
  }
  return true;
}

// Anti-delete's cache of recently-seen messages, deliberately at module
// scope rather than per-socket: a reconnect (which happens routinely)
// would otherwise wipe everything remembered, so any message received
// before it could no longer be recovered -- indistinguishable from the
// feature being broken. Message ids are globally unique, so sharing one
// store across sessions is safe. Bounded by both a count cap and a total-
// byte cap, since entries range from a few bytes of text to megabytes of
// media, unlike the fixed-size per-contact caches elsewhere in this file.
const recentMessagesStore = new Map(); // message id -> cache entry
const MAX_RECENT_COUNT = 2000;
const MAX_RECENT_BYTES = 50 * 1024 * 1024;
let recentMessagesBytes = 0;

function entrySize(entry) {
  return entry.buffer ? entry.buffer.length : entry.text ? entry.text.length : 0;
}

function rememberRecentMessage(id, entry) {
  if (!id) return;
  recentMessagesStore.set(id, entry);
  recentMessagesBytes += entrySize(entry);
  while (
    (recentMessagesStore.size > MAX_RECENT_COUNT || recentMessagesBytes > MAX_RECENT_BYTES) &&
    recentMessagesStore.size > 0
  ) {
    const oldestKey = recentMessagesStore.keys().next().value;
    recentMessagesBytes -= entrySize(recentMessagesStore.get(oldestKey));
    recentMessagesStore.delete(oldestKey);
  }
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

// Baileys' fetchLatestBaileysVersion() hits raw.githubusercontent.com with
// no timeout on the request at all -- it used to be called fresh inside
// startSession() on every single (re)connect, for every session. A slow or
// rate-limited response from GitHub could silently stall that call
// indefinitely, and since scheduleReconnect's backoff only kicks in once
// startSession() actually *fails*, a hang here doesn't fail fast -- it just
// sits there, looking exactly like "the bot stopped working" from the
// outside while never actually erroring or retrying.
//
// Baileys' own fallback (used internally if the fetch throws) is just a
// slightly-stale bundled version number -- entirely fine to connect with,
// not a real error condition. So this is fetched at most once per gateway
// process lifetime and reused for every reconnect after that, removing the
// network call from the hot reconnect path entirely. Raced against a
// timeout so even a dead GitHub on cold start can't hang every session's
// first connection attempt forever; FALLBACK_BAILEYS_VERSION mirrors
// Baileys' own internal bundled default (generics.js).
const FALLBACK_BAILEYS_VERSION = [2, 3000, 1043857760];
const BAILEYS_VERSION_FETCH_TIMEOUT_MS = 10 * 1000;
let cachedBaileysVersionPromise;
function getBaileysVersion() {
  if (!cachedBaileysVersionPromise) {
    cachedBaileysVersionPromise = Promise.race([
      fetchLatestBaileysVersion().then((r) => r.version),
      new Promise((resolve) =>
        setTimeout(() => resolve(FALLBACK_BAILEYS_VERSION), BAILEYS_VERSION_FETCH_TIMEOUT_MS),
      ),
    ]);
  }
  return cachedBaileysVersionPromise;
}

// Called from messages.upsert when a reply plugin (currently just AI Reply,
// gated by its own allowBlocking setting) signals that this contact should
// be blocked -- jid must be the real WhatsApp-addressing JID (msg.key.remoteJid),
// not the LID-resolved one used for plugin-engine lookups. A nonzero
// blockDurationHours also schedules an automatic unblock via the generic
// scheduled-task system (see scheduler.js) -- 0 means block permanently.
// Purely diagnostic: logs each send's start and outcome, changing nothing
// about how the send itself behaves. A "start" line with no matching
// "ok"/"failed" identifies a send that never settled at all (sock.
// sendMessage can hang rather than reject, e.g. if WhatsApp never answers
// an internal query) -- which is otherwise indistinguishable from the code
// never running.
//
// Deliberately no timeout here: Promise.race can't cancel the underlying
// send, so a slow-but-successful send would be reported as failed while
// still being delivered, and would skip the caller's markAiSent() -- the
// guard that stops AI Write from reprocessing the bot's own message. The
// logging alone answers the question without that risk.
async function sendTracked(sock, userId, jid, content, options, label) {
  console.log(`[${userId}] send:${label} start -> ${jid}`);
  try {
    const sent = await sock.sendMessage(jid, content, options);
    console.log(`[${userId}] send:${label} ok id=${sent?.key?.id || 'none'}`);
    return sent;
  } catch (err) {
    console.error(`[${userId}] send:${label} failed -> ${jid}:`, err.message);
    throw err;
  }
}

// WhatsApp has migrated some (not all) contacts to "@lid" addressing -- a
// privacy-preserving identifier used in place of the phone number. Baileys
// 7 keeps a LID<->phone-number mapping populated from the server, so ask it
// for the real phone JID before sending. Falls back to the original JID
// when no mapping exists, so this can only ever improve on the current
// behaviour, never regress a chat that already works.
async function resolveSendJid(sock, userId, jid) {
  if (!jid || !jid.endsWith('@lid')) return jid;
  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
    if (pn) return jidNormalizedUser(pn);
    console.warn(`[${userId}] no phone number mapped for ${jid} -- sending to the @lid JID as-is`);
  } catch (err) {
    console.error(`[${userId}] failed to resolve phone number for ${jid}:`, err.message);
  }
  return jid;
}

// Delivers a plugin-engine reply to a command the account owner typed
// themselves. Deliberately simpler than the incoming-message path: a
// command wants its answer promptly, so there's no typing simulation,
// humanlikeness pacing, quoting or blocking here -- just the text and any
// attachments the plugin produced. Returns false when the engine had
// nothing to say, so the caller can fall through to ai_write.
async function deliverPluginCommandReply(sock, userId, msg, result, markAiSent) {
  const { reply, audio: replyAudio, images: replyImages } = result || {};
  if (!reply && !replyAudio && !(replyImages && replyImages.length)) return false;

  const jid = msg.key.remoteJid;
  if (reply) {
    const sent = await sendTracked(sock, userId, jid, { text: reply }, undefined, 'own-command');
    markAiSent(sent?.key?.id);
  }
  if (replyAudio) {
    const sent = await sendTracked(
      sock,
      userId,
      jid,
      {
        audio: Buffer.from(replyAudio.data, 'base64'),
        mimetype: replyAudio.mimetype || 'audio/mpeg',
        ptt: false,
      },
      undefined,
      'own-command-audio',
    );
    markAiSent(sent?.key?.id);
  }
  for (const image of replyImages || []) {
    const sent = await sendTracked(
      sock,
      userId,
      jid,
      { image: Buffer.from(image.data, 'base64'), mimetype: image.mimetype || 'image/jpeg' },
      undefined,
      'own-command-image',
    );
    markAiSent(sent?.key?.id);
  }
  return true;
}

// Command feedback ("Saved note ...") is normally delivered by editing the
// command message in place, which keeps the chat clean. That edit
// references a message key in the original thread; in an @lid-addressed
// chat it can be silently dropped, leaving the user with no feedback at
// all. Send a normal quoted reply there instead -- slightly less tidy, but
// it actually arrives. Non-@lid chats keep the existing edit-in-place
// behaviour untouched.
async function sendCommandFeedback(sock, userId, msg, text, label) {
  if (!msg.key.remoteJid?.endsWith('@lid')) {
    return sendTracked(sock, userId, msg.key.remoteJid, { text, edit: msg.key }, undefined, label);
  }
  const targetJid = msg.key.remoteJid;
  return sendTracked(sock, userId, targetJid, { text }, { quoted: msg }, `${label}-lid`);
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
  const version = await getBaileysVersion();

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

  // Active "!timer" countdowns for this session -- capped (see
  // MAX_CONCURRENT_TIMERS) so a burst of commands can't spawn unbounded
  // setIntervals, and cleared entirely on disconnect (see the 'close'
  // handler below): a stale interval still firing against a dead/replaced
  // socket is wasted work and noisy errors, not something worth surviving
  // a reconnect for. In-memory only, not persisted -- these are all under
  // TIMER_EDIT_WINDOW_MS by construction, so the most a reconnect can
  // cost is a few minutes of countdown. Anything longer never lands here;
  // it goes through scheduleLongTimer's persisted task instead.
  // message id of the timer's own message -> { handle, key }. The key is
  // kept so "!stop" (which arrives as a reply quoting that message) can
  // edit the countdown in place to say it was stopped.
  const activeTimers = new Map();

  function clearAllTimers() {
    for (const timer of activeTimers.values()) clearInterval(timer.handle);
    activeTimers.clear();
  }

  async function handleTimerCommand(userId, sock, msg, rawArgs) {
    const parsed = parseTimerArgs(rawArgs);
    if (parsed === null) {
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
            'Usage: !timer <duration> [message], e.g. "!timer 5m", "!timer 90s", ' +
            '"!timer 1h30m", or "!timer 10m tea is ready".',
        },
        { quoted: msg },
      );
      return;
    }
    const { durationMs, label } = parsed;
    if (durationMs < MIN_TIMER_DURATION_MS) {
      await sock.sendMessage(msg.key.remoteJid, { text: 'Shortest timer is 10 seconds.' }, { quoted: msg });
      return;
    }
    if (durationMs > MAX_TIMER_DURATION_MS) {
      await sock.sendMessage(msg.key.remoteJid, { text: 'Longest timer is 24 hours.' }, { quoted: msg });
      return;
    }
    // Too long to keep one message ticking (see TIMER_EDIT_WINDOW_MS), so
    // don't pretend to: confirm now, and let the persisted scheduler
    // deliver a fresh message when it's actually up.
    if (durationMs > TIMER_EDIT_WINDOW_MS) {
      await scheduleLongTimer(userId, sock, msg, durationMs, label);
      return;
    }

    if (activeTimers.size >= MAX_CONCURRENT_TIMERS) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: `Only ${MAX_CONCURRENT_TIMERS} live countdowns can run at once -- wait for one to finish first.` },
        { quoted: msg },
      );
      return;
    }

    const tickMs = durationMs <= LIVE_TIMER_MAX_MS ? LIVE_TIMER_INTERVAL_MS : SPARSE_TIMER_INTERVAL_MS;
    const endsAt = Date.now() + durationMs;

    const labelLine = label ? `${label}\n` : '';
    const renderTimer = (remainingMs) =>
      `${labelLine}${formatTimerEmoji(remainingMs)}\n${buildTimerProgressBar(remainingMs / durationMs)}`;

    let sent;
    try {
      sent = await sock.sendMessage(msg.key.remoteJid, { text: renderTimer(durationMs) }, { quoted: msg });
    } catch (err) {
      console.error(`[${userId}] !timer failed to start:`, err.message);
      return;
    }
    const timerId = sent?.key?.id;
    if (!timerId) return; // nothing to edit going forward -- not worth starting a loop for

    function stopTimer() {
      const timer = activeTimers.get(timerId);
      if (timer) clearInterval(timer.handle);
      activeTimers.delete(timerId);
    }

    // Guards against overlapping ticks: an edit taking longer than tickMs
    // (much more likely now that the shortest tier ticks every second)
    // would otherwise let setInterval fire the next tick before the
    // current one's await resolves.
    let ticking = false;
    // One failed edit shouldn't kill the whole countdown -- a single
    // dropped tick is invisible (the next one shows the right time
    // anyway), whereas giving up on the first error leaves a frozen
    // clock. Only a sustained run of failures means it's really broken.
    let consecutiveFailures = 0;
    const handle = setInterval(async () => {
      if (ticking) return;
      ticking = true;
      try {
        const remaining = endsAt - Date.now();
        if (remaining <= 0) {
          stopTimer();
          const done = label ? `⏰ ${label}` : "⏰ Time's up!";
          await sock.sendMessage(msg.key.remoteJid, { text: `${formatTimerEmoji(0)}\n${done}`, edit: sent.key });
          return;
        }
        await sock.sendMessage(msg.key.remoteJid, { text: renderTimer(remaining), edit: sent.key });
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures += 1;
        console.error(
          `[${userId}] !timer tick failed (${consecutiveFailures}/${MAX_TIMER_TICK_FAILURES}):`,
          err.message,
        );
        if (consecutiveFailures >= MAX_TIMER_TICK_FAILURES) stopTimer();
      } finally {
        ticking = false;
      }
    }, tickMs);
    activeTimers.set(timerId, { handle, key: sent.key });
  }

  // Anything past WhatsApp's edit window. Persisted as a ScheduledTask
  // (see scheduler.js's timer_done handler) rather than an in-memory
  // setTimeout, because this session's socket reconnects routinely and
  // clearAllTimers() on 'close' would silently eat every pending long
  // timer each time it did.
  async function scheduleLongTimer(userId, sock, msg, durationMs, label) {
    const spelled = formatTimerWords(durationMs);
    const labelLine = label ? `\n_When it's up: ${label}_` : '';

    // Confirmation is sent *before* the task is created so its message id
    // can go into the payload -- that's what lets "!stop" (a reply
    // quoting this message) find and cancel the right pending task later.
    // If task creation then fails, the confirmation is edited into an
    // error rather than leaving a message promising a timer that isn't
    // actually scheduled.
    let sent;
    try {
      sent = await sock.sendMessage(
        msg.key.remoteJid,
        {
          text:
            `⏳ Timer set for ${spelled} -- I'll message you here when it's up.${labelLine}\n\n` +
            "_No live countdown on this one: WhatsApp only lets a message be edited for 15 minutes after it's sent. Reply !stop to cancel._",
        },
        { quoted: msg },
      );
    } catch (err) {
      console.error(`[${userId}] !timer failed to confirm:`, err.message);
      return;
    }

    try {
      await createScheduledTask({
        sessionId: userId,
        type: 'timer_done',
        payload: { jid: msg.key.remoteJid, duration: spelled, label, messageId: sent?.key?.id || null },
        runAt: new Date(Date.now() + durationMs).toISOString(),
      });
    } catch (err) {
      console.error(`[${userId}] !timer failed to schedule:`, describeFetchError(err));
      const failure = { text: "Couldn't set that timer right now -- try again?" };
      if (sent?.key) failure.edit = sent.key;
      await sock.sendMessage(msg.key.remoteJid, failure).catch(() => {});
    }
  }

  // "!stop", sent as a reply quoting a timer's own message. Handles both
  // kinds: a live countdown (in activeTimers, stopped instantly) and a
  // scheduled long timer (a pending ScheduledTask, cancelled via the web
  // app by the confirmation message's id -- see cancelTimerTask).
  async function handleStopCommand(userId, sock, msg) {
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (!quotedId) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: 'Reply to a timer message with !stop to cancel it.' },
        { quoted: msg },
      );
      return;
    }

    const live = activeTimers.get(quotedId);
    if (live) {
      clearInterval(live.handle);
      activeTimers.delete(quotedId);
      await sock.sendMessage(msg.key.remoteJid, { text: '🛑 Timer stopped.', edit: live.key }).catch((err) =>
        console.error(`[${userId}] !stop failed to edit the timer message:`, err.message),
      );
      return;
    }

    let cancelled = false;
    try {
      cancelled = await cancelTimerTask({ sessionId: userId, messageId: quotedId });
    } catch (err) {
      console.error(`[${userId}] !stop failed to cancel a scheduled timer:`, describeFetchError(err));
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: "Couldn't stop that timer right now -- try again?" },
        { quoted: msg },
      );
      return;
    }

    if (!cancelled) {
      await sock.sendMessage(
        msg.key.remoteJid,
        { text: "That timer isn't running any more." },
        { quoted: msg },
      );
      return;
    }
    await sock.sendMessage(msg.key.remoteJid, { text: '🛑 Timer cancelled.' }, { quoted: msg });
  }

  // "!status" -- owner-only readout of this session's own state: which
  // gateway/plugin-engine pair it's running against, how long the socket
  // has been up, and how many plugins are currently enabled.
  //
  // "!status all" is the cross-shard variant -- every registered shard's
  // session count and plugin-engine pairing, for admins only. "Admin" here
  // means the web account this session belongs to has an email in
  // ADMIN_EMAILS (see web/lib/admin.ts's isAdminEmail, piggybacked onto
  // refreshPluginConfigs' response -- see isSessionAdmin above), same
  // definition the website's own /dashboard/admin already uses. A
  // non-admin typing "!status all" gets told it's admin-only rather than
  // silently falling back to their own status, so it's obvious the extra
  // word did nothing rather than looking like a typo that got ignored.
  async function handleStatusCommand(userId, sock, msg, scope) {
    if (scope === 'all') {
      if (!(await isSessionAdmin())) {
        await sendCommandFeedback(sock, userId, msg, '!status all is admin-only.', 'status');
        return;
      }
      let shards;
      try {
        shards = await fetchShardsSummary();
      } catch (err) {
        console.error(`[${userId}] !status all failed:`, describeFetchError(err));
        await sendCommandFeedback(sock, userId, msg, `Couldn't reach the web app for shard status.`, 'status');
        return;
      }
      const lines =
        shards.length === 0
          ? ['No shards registered -- every session runs on the single GATEWAY_URL fallback.']
          : shards.map((s) => {
              const label = s.label || s.url;
              const paired = s.pluginEngineUrl ? 'paired' : 'sharing the default plugin engine';
              const active = s.active ? '' : ' (inactive)';
              return `${label}${active}: ${s.connectedCount}/${s.sessionCount} sessions connected -- ${paired}`;
            });
      await sendCommandFeedback(sock, userId, msg, `🛡️ Shards\n${lines.join('\n')}`, 'status-all');
      return;
    }

    const plugins = await refreshPluginConfigs();
    const enabledCount = plugins.filter((p) => p.enabled).length;
    const uptime = formatTimerRemaining(Date.now() - entry.createdAt);
    // Read straight from this process's own env, same as index.js and
    // pluginClient.js each already do independently -- the gateway never
    // looks up its own GatewayShard row, it's just told which plugin
    // engine to use via PLUGIN_ENGINE_URL at deploy time.
    const gatewayUrl = process.env.PUBLIC_URL || '(PUBLIC_URL not set)';
    const pluginEngineUrl = process.env.PLUGIN_ENGINE_URL || 'http://localhost:8000 (default, unpaired)';

    const lines = [
      `🟢 Connected -- up ${uptime}`,
      `🧩 ${enabledCount}/${plugins.length} plugins enabled`,
      `🌐 Gateway: ${gatewayUrl}`,
      `🔌 Plugin engine: ${pluginEngineUrl}`,
    ];
    await sendCommandFeedback(sock, userId, msg, lines.join('\n'), 'status');
  }

  // Both anti-delete and notes need to know their own settings, but
  // neither is worth a fresh network round trip on every single message --
  // anti-delete's check only matters at the (rare) moment of a deletion,
  // and notes' "#name" recall is one substring check away regardless.
  // TTL-cached instead: at most one fetch per session per minute, covering
  // both features' settings from the one shared plugins-list route.
  let cachedPluginConfigs = [];
  let cachedIsAdmin = false;
  let cachedPluginConfigsFetchedAt = 0;
  const PLUGIN_CONFIG_TTL_MS = 60 * 1000;

  async function refreshPluginConfigs() {
    if (Date.now() - cachedPluginConfigsFetchedAt < PLUGIN_CONFIG_TTL_MS) {
      return cachedPluginConfigs;
    }
    try {
      const data = await fetchSessionPluginConfigs(userId);
      cachedPluginConfigs = data.plugins;
      cachedIsAdmin = data.isAdmin;
      cachedPluginConfigsFetchedAt = Date.now();
    } catch (err) {
      if (err.code === 'SESSION_UNKNOWN') {
        // This session was deleted (or re-paired under a new id) while this
        // process kept its socket alive. It stays linked to the phone and
        // keeps handling the account's messages, but every config lookup
        // now comes back empty -- so it silently ignores every command,
        // while toggling plugins on the *real* session appears to do
        // nothing. Shut it down so the live session is the only one acting.
        console.error(
          `[${userId}] session no longer exists in the web app -- shutting down this orphaned ` +
            'socket so it stops shadowing the real one. Credentials are left intact.',
        );
        stopOrphanedSession(userId);
        return [];
      }
      console.error(`[${userId}] plugin config refresh failed:`, describeFetchError(err));
      // Keep whatever was last known (or the empty default) rather than
      // treating a transient network blip as "everything just turned off".
    }
    return cachedPluginConfigs;
  }

  // Whether this session's owning web account's email is in ADMIN_EMAILS
  // (see web/lib/admin.ts) -- rides along on the same cached fetch as
  // refreshPluginConfigs rather than its own round trip. Gates "!status
  // all" (see handleStatusCommand).
  async function isSessionAdmin() {
    await refreshPluginConfigs();
    return cachedIsAdmin;
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
  // Deliberately reaches for the module-level store rather than declaring
  // its own: this used to be a per-socket Map, so every reconnect silently
  // threw away everything remembered. Anti-delete then had nothing to
  // recover for any message received before the last reconnect, which
  // looked exactly like the feature not working. Message ids are globally
  // unique, so one shared store is safe.
  const recentMessages = recentMessagesStore;

  // Anti-link's warning counter: group JID -> Map(participant JID -> count).
  // Only grows if kickAfterWarnings is actually configured; capped at the
  // outer (group) level since a session realistically has far fewer groups
  // than contacts.
  const antiLinkViolations = new Map();

  const rememberMessage = rememberRecentMessage;

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
  //
  // Bounded: a full contacts sync (recordContacts, on every reconnect) and
  // the per-message senderPn/participantPn learning below both add an
  // entry per *distinct* LID this session has ever seen, with nothing that
  // ever removes one -- unlike every other per-contact cache in this file,
  // which sweeps or caps. Over weeks of a session sitting in active groups,
  // that grows without limit and was the actual cause of a real OOM crash
  // loop on Render's 512MB tier. A dropped mapping just means one send
  // falls back to the unresolved @lid form until it's relearned -- cheap
  // degradation, not data loss.
  const MAX_LID_MAP_SIZE = 5000;
  const lidToPhoneJid = new Map();

  function rememberLidMapping(lid, phoneJid) {
    lidToPhoneJid.set(lid, phoneJid);
    while (lidToPhoneJid.size > MAX_LID_MAP_SIZE) {
      lidToPhoneJid.delete(lidToPhoneJid.keys().next().value);
    }
  }

  function recordContacts(contacts) {
    for (const c of contacts) {
      if (c.lid && c.jid) {
        rememberLidMapping(jidNormalizedUser(c.lid), jidNormalizedUser(c.jid));
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
          rememberLidMapping(jidNormalizedUser(r.lid), jidNormalizedUser(r.jid));
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

      // A contact this account has blocked still accepts outgoing messages
      // at the protocol level -- the server acks them and hands back a real
      // message id -- but never delivers them. That is indistinguishable
      // from "the bot is ignoring this chat" from the outside, and it
      // persists until explicitly unblocked, which is exactly the shape of
      // the "works for some contacts, never for others" problem. AI Reply's
      // auto-block ran for a while, so log the blocklist on connect to make
      // it visible instead of invisible.
      sock
        .fetchBlocklist()
        .then((blocked) => {
          if (blocked?.length) {
            console.log(`[${userId}] BLOCKLIST (${blocked.length}): ${blocked.join(', ')}`);
          } else {
            console.log(`[${userId}] BLOCKLIST: empty`);
          }
        })
        .catch((err) => console.error(`[${userId}] failed to fetch blocklist:`, err.message));
    } else if (connection === 'close') {
      clearInterval(lidRefreshInterval);
      clearAllTimers();
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
        rememberLidMapping(jidNormalizedUser(msg.key.remoteJid), jidNormalizedUser(msg.key.senderPn));
      }
      if (msg.key.participantPn && msg.key.participant?.endsWith('@lid')) {
        rememberLidMapping(jidNormalizedUser(msg.key.participant), jidNormalizedUser(msg.key.participantPn));
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
              console.error(`[${userId}] anti-delete media capture failed:`, describeFetchError(err));
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
      // sticker sends, which are handled separately by !savesticker.
      const isIncomingSticker = !!msg.message.stickerMessage && !msg.key.fromMe;
      if (!text && !(isVoiceNote && !msg.key.fromMe) && !isIncomingSticker) continue;

      // Sudo: a trusted number who isn't the account owner can still use
      // !tagall and !poll (only those two -- not savesticker!savenote/
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

      // Voice changer -- gated by the "games" plugin toggle and its
      // replyInGroups setting, same as the Python-side Fun pack (!meme now
      // lives there too, see games.py -- this one stays gateway-side since
      // it needs the actual quoted voice-note bytes, which the Python side
      // never receives), so the group-gating games.py would normally do
      // itself is replicated here.
      //
      // Runs for the account owner's own messages too, not just other
      // people's: this used to be gated on !fromMe, which meant the owner
      // could never use their own voice effects -- they only ever worked
      // when someone else sent them. Sitting before the fromMe/non-fromMe
      // split below means one check covers both.
      // Skips anything this bot sent itself. That guard normally lives in
      // the fromMe branch below, which no longer runs first for this
      // command -- so without it a reply the bot produced could in
      // principle re-trigger it.
      if (!aiSentMessageIds.has(msg.key.id)) {
        const voiceEffectMatch = text.match(VOICE_EFFECT_COMMAND);
        if (voiceEffectMatch) {
          const games = deriveGamesConfig(await refreshPluginConfigs());
          if (games.enabled && (!isGroupChat || games.replyInGroups)) {
            await handleVoiceEffectCommand(userId, sock, msg, voiceEffectMatch[1].toLowerCase());
            continue;
          }
        }
      }

      // "!qr" -- own toggle, same shape as the meme/voice-effect block
      // above (usable by anyone, owner included, gated by its own
      // enabled+replyInGroups).
      if (!aiSentMessageIds.has(msg.key.id)) {
        const qrMatch = text.match(QR_COMMAND);
        if (qrMatch) {
          const qr = deriveQrConfig(await refreshPluginConfigs());
          if (qr.enabled && (!isGroupChat || qr.replyInGroups)) {
            await handleQrCommand(userId, sock, msg, qrMatch[1]);
            continue;
          }
        }
      }

      // "!timer" -- same shape again. "!stop" rides along with it: it only
      // ever means "cancel the timer I'm replying to", so it's gated by
      // the same toggle rather than getting one of its own.
      if (!aiSentMessageIds.has(msg.key.id)) {
        const timerMatch = text.match(TIMER_COMMAND);
        const isStop = STOP_COMMAND.test(text);
        if (timerMatch || isStop) {
          const timer = deriveTimerConfig(await refreshPluginConfigs());
          if (timer.enabled && (!isGroupChat || timer.replyInGroups)) {
            if (isStop) await handleStopCommand(userId, sock, msg);
            else await handleTimerCommand(userId, sock, msg, timerMatch[1]);
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

        const statusMatch = text.match(STATUS_COMMAND);
        if (statusMatch) {
          const status = deriveStatusConfig(await refreshPluginConfigs());
          if (status.enabled) {
            await handleStatusCommand(userId, sock, msg, (statusMatch[1] || '').toLowerCase());
            continue;
          }
        }

        // "!help" -- owner-only, no toggle: it's the one command that
        // needs to work regardless of what else is configured, since it's
        // how the owner checks what else is configured.
        if (HELP_COMMAND.test(text)) {
          await handleHelpCommand(userId, sock, msg, await refreshPluginConfigs());
          continue;
        }

        // "..happy" and friends -- animates this message in place. Sits
        // before ai_write below so a shorthand never gets treated as
        // prose to rewrite.
        const animateMatch = text.match(ANIMATE_COMMAND);
        if (animateMatch) {
          const animate = deriveAnimateConfig(await refreshPluginConfigs());
          if (animate.enabled) {
            await handleEmojiAnimation(userId, sock, msg, animateMatch[1]);
            continue;
          }
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

        // "!aie" (edit-in-place) checked first: it's the more specific
        // pattern, and AI_ASK_COMMAND's own regex never matches it anyway
        // (the trailing "e" isn't a word boundary "!ai" can absorb), but
        // keeping the specific one first avoids relying on that.
        const aiAskEditMatch = text.match(AI_ASK_EDIT_COMMAND);
        if (aiAskEditMatch) {
          const aiAsk = deriveAiAskConfig(await refreshPluginConfigs());
          if (aiAsk.enabled) {
            await handleAskCommand(userId, sock, msg, aiAskEditMatch[1], { editInPlace: true });
            continue;
          }
        }

        const aiAskMatch = text.match(AI_ASK_COMMAND);
        if (aiAskMatch) {
          const aiAsk = deriveAiAskConfig(await refreshPluginConfigs());
          if (aiAsk.enabled) {
            await handleAskCommand(userId, sock, msg, aiAskMatch[1], { editInPlace: false });
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
          const plugins = await refreshPluginConfigs();
          const notes = deriveNotesConfig(plugins);
          // Without this, a "#name" that does nothing is completely silent:
          // the notes plugin being off, the config fetch having failed (so
          // every plugin looks off), and the note simply not existing all
          // look identical from the outside.
          console.log(
            `[${userId}] note recall "#${noteRecallMatch[1]}" in ${msg.key.remoteJid}: ` +
              `notesEnabled=${notes.enabled} pluginsKnown=${plugins.length}`,
          );
          if (notes.enabled) {
            const handled = await handleNoteRecall(userId, sock, msg, noteRecallMatch[1], markAiSent);
            if (handled) continue;
          }
        }

        // Commands that live in the Python plugin engine (see
        // PLUGIN_COMMAND_RE). Everything above is handled gateway-side, but
        // these need forwarding -- and this branch otherwise never talks to
        // the plugin engine at all, so the account owner could never run
        // their own !imagine, !pinterest, !song or Fun commands. Deliberately
        // placed after the note recall so "#name" still wins, and before
        // ai_write so a command is never treated as prose to rewrite.
        if (PLUGIN_COMMAND_RE.test(text)) {
          try {
            const result = await forwardMessage({
              userId,
              from: resolvedFrom,
              text,
              fromMe: true,
              quotedText: extractQuotedText(msg),
            });
            const handled = await deliverPluginCommandReply(sock, userId, msg, result, markAiSent);
            if (handled) continue;
          } catch (err) {
            console.error(`[${userId}] own-command dispatch failed:`, describeFetchError(err));
            continue;
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
        // Always the chat's own JID, in whatever form WhatsApp addresses
        // it (@lid or @s.whatsapp.net). Rewriting an @lid chat's sends to
        // the mapped phone JID was tried and reverted: the sends reported
        // success with real message ids, but landed in a different
        // addressing thread from the conversation on screen, so nothing
        // showed up -- and it broke contacts that had been working. Only
        // blocking needs the phone JID (see handleBlockContact).
        const sendJid = msg.key.remoteJid;

        let audio;
        if (isVoiceNote) {
          try {
            // Reuse the buffer anti-delete may have already downloaded
            // above for this exact message instead of downloading it a
            // second time.
            const buffer =
              cachedMedia?.mediaType === 'audioMessage'
                ? cachedMedia.buffer
                : await downloadMediaMessage(msg, 'buffer', MEDIA_DOWNLOAD_OPTS);
            audio = {
              data: buffer.toString('base64'),
              mimetype: msg.message.audioMessage.mimetype || 'audio/ogg',
            };
          } catch (err) {
            console.error(`[${userId}] failed to download voice note:`, describeFetchError(err));
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
                : await downloadMediaMessage(msg, 'buffer', MEDIA_DOWNLOAD_OPTS);
            sticker = {
              data: buffer.toString('base64'),
              mimetype: msg.message.stickerMessage.mimetype || 'image/webp',
            };
          } catch (err) {
            console.error(`[${userId}] failed to download incoming sticker:`, describeFetchError(err));
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
        } = await forwardMessage({
          userId,
          from: resolvedFrom,
          text,
          audio,
          sticker,
          quotedText: extractQuotedText(msg),
        });

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
              await sock.sendPresenceUpdate('composing', sendJid);
              await new Promise((resolve) => setTimeout(resolve, typingDelayMs || 1500));
            }

            const sendOptions = i === 0 && quote ? { quoted: msg } : undefined;
            const sent = await sendTracked(
              sock,
              userId,
              sendJid,
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
              await sock.sendPresenceUpdate('paused', sendJid);
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
              const sentSticker = await sendTracked(sock, userId, sendJid, { sticker: buffer }, undefined, 'ai-sticker');
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
            await sendTracked(
              sock,
              userId,
              sendJid,
              {
                audio: Buffer.from(replyAudio.data, 'base64'),
                mimetype: replyAudio.mimetype || 'audio/mpeg',
                ptt: false,
              },
              undefined,
              'ai-audio',
            );
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
              const sentImage = await sendTracked(
                sock,
                userId,
                sendJid,
                {
                  image: Buffer.from(replyImages[i].data, 'base64'),
                  mimetype: replyImages[i].mimetype || 'image/jpeg',
                },
                undefined,
                'ai-image',
              );
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
          // as-is with no LID resolution of its own. Ask Baileys' own
          // LID<->phone mapping first (more reliable than the
          // senderPn/participantPn learning above, which only sees what
          // individual messages happen to carry), falling back to
          // resolvedFrom. Unlike a send, redirecting here is correct:
          // there is no "wrong thread" to land in, only a JID form the
          // blocklist accepts or rejects.
          const blockJid = await resolveSendJid(sock, userId, msg.key.remoteJid);
          await handleBlockContact(
            userId,
            sock,
            blockJid.endsWith('@lid') ? resolvedFrom : blockJid,
            blockDurationHours,
          );
        }
      } catch (err) {
        console.error(`[${userId}] plugin dispatch failed:`, err.message);
      }
    }
  });

  // Delivery status for messages this session sent. sendMessage returning
  // an id only means the *server* accepted it -- it says nothing about
  // whether the recipient's device ever received it. Two identical sends
  // can both report "ok" while only one actually arrives, which is exactly
  // the failure being chased, and nothing else distinguishes them.
  //
  // SERVER_ACK(2) = WhatsApp took it. DELIVERY_ACK(3) = it reached the
  // recipient's device. A send that stalls at 2 forever was never
  // delivered, regardless of how healthy the send itself looked.
  const MESSAGE_STATUS_NAMES = ['ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'];
  sock.ev.on('messages.update', (updates) => {
    for (const update of updates || []) {
      const status = update?.update?.status;
      if (status === undefined || status === null) continue;
      if (!update.key?.fromMe) continue; // only our own sends are informative here
      console.log(
        `[${userId}] delivery: id=${update.key.id} -> ` +
          `${MESSAGE_STATUS_NAMES[status] || status} (${status}) in ${update.key.remoteJid}`,
      );
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

// Stops a session whose WaSession row no longer exists. Deliberately does
// NOT clear auth state: the row may have been deleted by mistake, and
// wiping credentials would force a re-pair rather than just stopping a
// socket that shouldn't be running. Marked explicitlyStopped so neither
// the close handler's auto-reconnect nor the watchdog revives it.
function stopOrphanedSession(userId) {
  explicitlyStopped.add(userId);
  const entry = sessions.get(userId);
  sessions.delete(userId);
  try {
    entry?.sock?.end(new Error('session no longer exists in the web app'));
  } catch (err) {
    console.error(`[${userId}] failed to close orphaned socket:`, err.message);
  }
}

function requireConnectedSocket(userId) {
  const entry = sessions.get(userId);
  if (!entry || entry.status !== 'connected') {
    throw new Error('session is not connected');
  }
  return entry.sock;
}

// Blocking a contact makes every outgoing message to them silently
// undeliverable -- the server still acks it and returns a message id, so
// nothing in the logs looks wrong -- and it survives restarts and
// re-pairing, since it lives on the WhatsApp account itself. AI Reply's
// auto-block could put contacts here without the account owner ever
// realising, so expose reading and undoing it.
export async function listBlockedContacts(userId) {
  const sock = requireConnectedSocket(userId);
  return (await sock.fetchBlocklist()) || [];
}

export async function unblockContact(userId, jid) {
  const sock = requireConnectedSocket(userId);
  await sock.updateBlockStatus(jid, 'unblock');
}

// Forces the encryption session with one contact to be renegotiated. Fixes
// the case where sends to a specific contact are rejected outright
// (delivery status ERROR) while other messages in the same chat deliver
// fine, because the stored device list for them has gone stale -- a
// message must be encrypted for every device the recipient currently has,
// and nothing refreshes that set on its own.
//
// Safe by construction: it only deletes derived key material for that one
// contact. Signal re-establishes it on the next send; this session's own
// credentials and every other contact are untouched.
export async function resetContactEncryption(userId, jid) {
  const contactUser = String(jid).split('@')[0].split(':')[0];
  if (!contactUser) throw new Error('could not read a contact id out of that jid');

  const removed = await clearContactSessions(userId, contactUser);
  console.log(
    `[${userId}] reset encryption for ${jid}: cleared ${removed} stored session(s) -- ` +
      'they will be renegotiated on the next message',
  );
  return removed;
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
