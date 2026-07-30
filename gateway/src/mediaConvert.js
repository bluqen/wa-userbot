import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
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

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Greedy word-wrap by character count -- good enough for meme-style text,
// which is always short and never needs real typographic measurement.
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4); // a meme caption is never more than a few lines
}

// Renders one caption block (top or bottom) as its own full-canvas SVG,
// composited over the source image -- simplest way to let each block
// position itself independently without doing overlap math by hand.
function buildCaptionSvg(width, height, text, fontSize, strokeWidth, atTop) {
  const maxCharsPerLine = Math.max(6, Math.floor(width / (fontSize * 0.55)));
  const lines = wrapText(text.toUpperCase(), maxCharsPerLine);
  const lineHeight = fontSize * 1.15;
  const tspans = lines
    .map((line, i) => `<tspan x="${width / 2}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  const y = atTop ? fontSize * 1.1 : height - lineHeight * (lines.length - 1) - fontSize * 0.5;
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="${width / 2}" y="${y}" text-anchor="middle" font-family="Impact, Anton, Arial, sans-serif"
      font-weight="900" font-size="${fontSize}" fill="white" stroke="black" stroke-width="${strokeWidth}"
      paint-order="stroke" style="letter-spacing:1px">${tspans}</text>
  </svg>`;
}

// Classic top/bottom meme caption, composited onto whatever image was
// quote-replied to (see "/meme top | bottom" in whatsappManager.js).
export async function addMemeText(buffer, topText, bottomText) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const width = metadata.width || 512;
  const height = metadata.height || 512;
  const fontSize = Math.round(width / 12);
  const strokeWidth = Math.max(2, Math.round(fontSize / 12));

  const overlays = [];
  if (topText) {
    overlays.push({ input: Buffer.from(buildCaptionSvg(width, height, topText, fontSize, strokeWidth, true)) });
  }
  if (bottomText) {
    overlays.push({ input: Buffer.from(buildCaptionSvg(width, height, bottomText, fontSize, strokeWidth, false)) });
  }
  if (overlays.length === 0) {
    return image.jpeg({ quality: 90 }).toBuffer();
  }
  return image.composite(overlays).jpeg({ quality: 90 }).toBuffer();
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
