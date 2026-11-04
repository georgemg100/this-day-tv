// Download + transcode archival media into Roblox-ready segments.
//   video: 640x480 (4:3, letterboxed), H.264/AAC MP4, <= MAX_SEGMENT_SECONDS each,
//          bitrate chosen so every file fits under MAX_UPLOAD_MB
//   audio: MP3, <= 7 minutes each (Roblox audio limit)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, HttpError } from './config.js';

export function ffmpegAvailable() {
  const ok = (bin) => {
    try {
      return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  };
  return ok('ffmpeg') && ok('ffprobe');
}

function run(bin, args, { onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      onStdout?.(String(d));
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

export async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]);
  const info = JSON.parse(out);
  return {
    duration: Number(info.format?.duration) || 0,
    hasVideo: (info.streams || []).some((s) => s.codec_type === 'video'),
    hasAudio: (info.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

/** Stream a URL to disk, cached by URL hash so re-ingesting a clip is free. */
export async function download(url, onProgress) {
  const cacheDir = path.join(config.mediaDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const ext = (path.extname(new URL(url).pathname) || '.bin').slice(0, 6);
  const dest = path.join(cacheDir, crypto.createHash('sha1').update(url).digest('hex') + ext);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;

  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent }, redirect: 'follow' });
  if (!res.ok || !res.body) throw new HttpError(502, `download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  const tmp = `${dest}.part`;
  const counter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (total) onProgress?.(received / total);
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return dest;
}

/** Split [start, end) into n near-equal parts no longer than maxLen. Exported for tests. */
export function planSegments(start, end, maxLen) {
  const total = end - start;
  if (!(total > 0)) throw new HttpError(400, 'clip has no length (check start/end)');
  const n = Math.max(1, Math.ceil(total / maxLen - 1e-9));
  const len = total / n;
  return Array.from({ length: n }, (_, i) => ({ index: i, start: start + i * len, duration: len }));
}

/** Video kbps that keeps a segment under the upload cap (with 8% container headroom). */
export function videoBitrateKbps(durationSec, maxMB, audioKbps = 96) {
  const totalKbps = (maxMB * 8 * 1000 * 0.92) / durationSec; // MB -> kilobits
  return Math.round(Math.min(2000, Math.max(250, totalKbps - audioKbps)));
}

function progressParser(segDuration, onFraction) {
  return (chunk) => {
    const m = /out_time_us=(\d+)/.exec(chunk) || /out_time_ms=(\d+)/.exec(chunk);
    if (m) onFraction(Math.min(1, Number(m[1]) / 1e6 / segDuration));
  };
}

export async function transcode({ input, outDir, kind, start, end, onProgress }) {
  const info = await probe(input);
  if (kind === 'video' && !info.hasVideo) throw new HttpError(400, 'source has no video stream');
  if (kind === 'audio' && !info.hasAudio) throw new HttpError(400, 'source has no audio stream');
  const clipStart = Math.max(0, start || 0);
  const clipEnd = Math.min(info.duration, end || info.duration);
  const maxLen = kind === 'video' ? config.media.maxSegmentSeconds : config.media.maxAudioSegmentSeconds;
  const plan = planSegments(clipStart, clipEnd, maxLen);
  fs.mkdirSync(outDir, { recursive: true });

  const segments = [];
  for (const seg of plan) {
    const out = path.join(outDir, `seg_${String(seg.index).padStart(2, '0')}.${kind === 'video' ? 'mp4' : 'mp3'}`);
    const common = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
      '-ss', seg.start.toFixed(3), '-t', seg.duration.toFixed(3), '-i', input];
    let args;
    if (kind === 'video') {
      const { width: w, height: h } = config.media;
      const v = videoBitrateKbps(seg.duration, config.media.maxUploadMB);
      args = [...common,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
        '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-b:v', `${v}k`, '-maxrate', `${Math.round(v * 1.25)}k`, '-bufsize', `${v * 2}k`,
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100',
        '-movflags', '+faststart', out];
    } else {
      args = [...common, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', '-ar', '44100', out];
    }
    await run('ffmpeg', args, {
      onStdout: progressParser(seg.duration, (f) => onProgress?.((seg.index + f) / plan.length, seg.index, plan.length)),
    });
    const outInfo = await probe(out);
    const sizeBytes = fs.statSync(out).size;
    if (sizeBytes > config.media.maxUploadMB * 1e6 * 1.05) {
      throw new HttpError(500, `segment ${seg.index} is ${(sizeBytes / 1e6).toFixed(1)} MB, over MAX_UPLOAD_MB`);
    }
    segments.push({
      index: seg.index,
      file: path.relative(config.mediaDir, out),
      sourceStart: Number(seg.start.toFixed(3)),
      duration: Number(outInfo.duration.toFixed(3)),
      sizeBytes,
      assetId: null,
      upload: { status: 'none' },
    });
  }
  return { segments, sourceDuration: info.duration };
}

export function absoluteMediaPath(rel) {
  const abs = path.resolve(config.mediaDir, rel);
  if (!abs.startsWith(path.resolve(config.mediaDir) + path.sep)) throw new HttpError(400, 'bad media path');
  return abs;
}
