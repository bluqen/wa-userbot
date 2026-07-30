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
