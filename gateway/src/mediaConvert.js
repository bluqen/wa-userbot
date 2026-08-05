import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import QRCode from 'qrcode';
import sharp from 'sharp';

ffmpeg.setFfmpegPath(ffmpegPath);

const STICKER_SIZE = 512;
// WhatsApp stickers are meant to be brief -- capping the source clip keeps
// both the ffmpeg encode itself and the resulting sticker file small,
// instead of someone quote-replying a 3-minute video and the process
// spending a long time (and a lot of memory) encoding all of it.
const MAX_ANIMATED_SECONDS = 6;
const FFMPEG_TIMEOUT_MS = 30000;

async function withTempFiles(inputBuffer, inputExt, outputExt, run) {
  const dir = os.tmpdir();
  const id = randomUUID();
  const inputPath = path.join(dir, `wa-convert-${id}.${inputExt}`);
  const outputPath = path.join(dir, `wa-convert-${id}-out.${outputExt}`);
  await fs.writeFile(inputPath, inputBuffer);
  try {
    await run(inputPath, outputPath);
    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// Kills the ffmpeg child process if it hasn't finished in time, rather than
// letting a stuck/unusually heavy encode run indefinitely and pile up
// memory on this process (the exact failure mode a real OOM crash traced
// back to earlier -- see stale_cache.py's history on the plugin engine
// side of this same codebase).
function runFfmpeg(command, outputPath) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      command.kill('SIGKILL');
      reject(new Error('conversion timed out'));
    }, FFMPEG_TIMEOUT_MS);
    command
      .on('end', () => {
        clearTimeout(timer);
        resolve();
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .save(outputPath);
  });
}

// Static image -> static webp sticker.
export async function imageToSticker(buffer) {
  return sharp(buffer)
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 80 })
    .toBuffer();
}

// A short video or "GIF" (WhatsApp sends these as a video with
// gifPlayback:true, not a real .gif file) -> an animated webp sticker.
export async function mediaToAnimatedSticker(buffer) {
  return withTempFiles(buffer, 'mp4', 'webp', (input, output) => {
    const command = ffmpeg(input).outputOptions([
      '-vcodec',
      'libwebp',
      '-vf',
      `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,format=rgba,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15`,
      '-loop',
      '0',
      '-an',
      '-t',
      String(MAX_ANIMATED_SECONDS),
    ]);
    return runFfmpeg(command, output);
  });
}

// Sticker (static or animated) -> a plain image. For an animated sticker
// this is just its first frame -- sharp only decodes page 0 of a
// multi-frame source unless explicitly told to treat it as animated.
export async function stickerToImage(buffer) {
  return sharp(buffer).png().toBuffer();
}

// Caps how many frames of an animated sticker get extracted below -- an
// animated sticker this codebase creates is at most MAX_ANIMATED_SECONDS
// long at 15fps (well under this), so this only ever bites on an
// unusually long sticker someone saved from elsewhere.
const MAX_FRAMES_TO_EXTRACT = 150;

// Animated sticker -> a normal looping video (sent with gifPlayback:true,
// WhatsApp's actual representation of a "GIF"). Returns null for a static
// sticker -- there's no motion to extract, and that's a normal, expected
// case the caller should show a friendly message for, not an error.
//
// ffmpeg's own webp decoder doesn't support animated webp (it silently
// drops the ANIM/ANMF chunks and fails to find any image data) -- verified
// directly against the ffmpeg-static binary this project bundles, not
// assumed. sharp decodes animated webp fine, though, so each frame is
// extracted via sharp's per-page reader and handed to ffmpeg as a plain
// image sequence instead of asking it to demux the webp itself.
export async function stickerToVideo(buffer) {
  const metadata = await sharp(buffer, { animated: true }).metadata();
  if (!metadata.pages || metadata.pages <= 1) {
    return null;
  }

  const frameCount = Math.min(metadata.pages, MAX_FRAMES_TO_EXTRACT);
  const avgDelayMs =
    metadata.delay && metadata.delay.length
      ? metadata.delay.reduce((a, b) => a + b, 0) / metadata.delay.length
      : 67; // ~15fps, matches mediaToAnimatedSticker's own output rate
  const fps = Math.max(1, Math.round(1000 / avgDelayMs));

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-frames-'));
  try {
    for (let i = 0; i < frameCount; i++) {
      const frame = await sharp(buffer, { page: i }).png().toBuffer();
      await fs.writeFile(path.join(dir, `frame_${String(i).padStart(4, '0')}.png`), frame);
    }

    const outputPath = path.join(dir, 'out.mp4');
    const command = ffmpeg()
      .input(path.join(dir, 'frame_%04d.png'))
      .inputFPS(fps)
      .outputOptions(['-vf', `scale=${STICKER_SIZE}:-2,format=yuv420p`, '-movflags', '+faststart', '-an']);
    await runFfmpeg(command, outputPath);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}


// Named ffmpeg audio-filter chains for "/robot", "/deep", "/chipmunk",
// "/echo" (see whatsappManager.js) -- asetrate changes both pitch and
// speed together; the matching atempo compensates speed back to the
// original duration while keeping the pitch shift.
const VOICE_EFFECTS = {
  robot: 'acrusher=bits=8:mode=log:aa=1,aecho=0.8:0.7:40:0.25',
  deep: 'asetrate=48000*0.8,aresample=48000,atempo=1.25',
  chipmunk: 'asetrate=48000*1.6,aresample=48000,atempo=0.625',
  echo: 'aecho=0.8:0.9:800:0.4',
};

export const VOICE_EFFECT_NAMES = Object.keys(VOICE_EFFECTS);

// Applies a named voice effect to a voice note, returning it re-encoded as
// Opus/ogg (WhatsApp's own voice-note format) ready to send straight back
// with ptt:true. Returns null for an unrecognized effect name.
export async function applyVoiceEffect(buffer, effectName) {
  const filter = VOICE_EFFECTS[effectName];
  if (!filter) return null;

  return withTempFiles(buffer, 'ogg', 'ogg', (input, output) => {
    const command = ffmpeg(input).audioFilters(filter).outputOptions(['-c:a', 'libopus', '-b:a', '32k']);
    return runFfmpeg(command, output);
  });
}

// Named colors accepted by "/!qr <color> ..." -- deliberately a small fixed
// allowlist rather than passing the user's word straight into the SVG's
// fill attribute: an SVG string is XML, and an unvalidated attribute value
// is an injection risk (e.g. a color argument like `red"/><script>...`
// breaking out of the attribute). Plain #rrggbb hex is accepted too, also
// validated by strict regex for the same reason.
const QR_NAMED_COLORS = {
  black: '#000000',
  white: '#ffffff',
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  violet: '#8b5cf6',
  pink: '#ec4899',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  gray: '#6b7280',
  grey: '#6b7280',
  brown: '#92400e',
  gold: '#f59e0b',
  lime: '#84cc16',
  indigo: '#6366f1',
  navy: '#1e3a8a',
  maroon: '#7f1d1d',
  silver: '#94a3b8',
};

export function resolveQrColor(word) {
  const lower = (word || '').toLowerCase();
  if (QR_NAMED_COLORS[lower]) return QR_NAMED_COLORS[lower];
  if (/^#[0-9a-f]{6}$/i.test(word || '')) return word;
  return null;
}

const QR_MODULE_PX = 10;
// Standard QR "quiet zone" -- the blank margin scanners rely on to find the
// code's edges. Skipping it is a common reason a generated QR fails to
// scan even though the pattern itself is correct.
const QR_QUIET_ZONE_MODULES = 4;
const MAX_QR_TEXT_LENGTH = 1000;

// Generates a QR code as a PNG, optionally recolored (one color) or with a
// gradient fill (two colors) instead of the default plain black. Renders
// the raw module matrix as an SVG grid rather than relying on the
// `qrcode` package's own PNG renderer, since that only supports a single
// flat color -- the same "build the SVG by hand, rasterize with sharp"
// approach already used for meme captions above.
export async function generateQrCode(text, colors) {
  const content = (text || '').slice(0, MAX_QR_TEXT_LENGTH);
  const qr = QRCode.create(content, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  const totalModules = size + QR_QUIET_ZONE_MODULES * 2;
  const px = totalModules * QR_MODULE_PX;

  let fill = '#000000';
  let defs = '';
  if (colors?.length === 1) {
    fill = colors[0];
  } else if (colors?.length >= 2) {
    fill = 'url(#qr-fill)';
    defs = `<defs><linearGradient id="qr-fill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors[0]}" />
      <stop offset="100%" stop-color="${colors[1]}" />
    </linearGradient></defs>`;
  }

  const rects = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) {
        const x = (col + QR_QUIET_ZONE_MODULES) * QR_MODULE_PX;
        const y = (row + QR_QUIET_ZONE_MODULES) * QR_MODULE_PX;
        rects.push(`<rect x="${x}" y="${y}" width="${QR_MODULE_PX}" height="${QR_MODULE_PX}" fill="${fill}" />`);
      }
    }
  }

  const svg = `<svg width="${px}" height="${px}" xmlns="http://www.w3.org/2000/svg">
    ${defs}
    <rect width="${px}" height="${px}" fill="white" />
    ${rects.join('')}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
