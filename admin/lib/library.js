// Library = media that has been ingested (downloaded + cut into Roblox-sized
// segments) and, segment by segment, uploaded to Roblox.
import fs from 'node:fs';
import path from 'node:path';
import { config, HttpError } from './config.js';
import { getItem } from './archive.js';
import { parseClock } from './dates.js';
import { download, transcode, absoluteMediaPath, probe, planSegments } from './media.js';
import { createAsset, waitForAsset, getOperation } from './roblox.js';
import { createJob } from './jobs.js';
import { CATEGORIES } from './schedule.js';
import * as store from './store.js';

function cleanMeta(p) {
  const year = p.year ? Math.round(Number(p.year)) : null;
  if (year !== null && !(year >= 1900 && year <= 2100)) throw new HttpError(400, 'year looks wrong');
  if (p.airDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.airDate)) throw new HttpError(400, 'airDate must be YYYY-MM-DD');
  return {
    kind: p.kind === 'audio' ? 'audio' : 'video',
    category: CATEGORIES.includes(p.category) ? p.category : 'program',
    title: String(p.title || '').trim().slice(0, 120) || 'Untitled',
    year,
    airDate: p.airDate || null,
  };
}

/** Queue a download + transcode. Returns the job. */
export function ingest(params) {
  const meta = cleanMeta(params);
  const start = parseClock(params.start);
  const end = parseClock(params.end);
  if (start !== null && end !== null && end <= start) throw new HttpError(400, 'end must be after start');
  if (params.source === 'url' && !/^https?:\/\//i.test(params.url || '')) throw new HttpError(400, 'url must be http(s)');
  if (params.source === 'local' && !fs.existsSync(params.localPath || '')) throw new HttpError(400, 'local file not found');
  if (!['archive', 'url', 'local'].includes(params.source)) throw new HttpError(400, 'source must be archive, url or local');

  return createJob('ingest', `Ingest: ${meta.title}`, async (update) => {
    let input;
    let source;
    if (params.source === 'archive') {
      update({ message: 'Reading archive.org metadata' });
      const item = await getItem(params.identifier);
      const pool = meta.kind === 'video' ? item.videoFiles : [...item.audioFiles, ...item.videoFiles];
      const file = params.file ? pool.find((f) => f.name === params.file) : pool[0];
      if (!file) throw new HttpError(400, `no usable ${meta.kind} file in ${params.identifier}`);
      update({ message: `Downloading ${file.name}` });
      input = await download(file.url, (f) => update({ progress: f * 0.4, message: `Downloading ${Math.round(f * 100)}%` }));
      source = { type: 'archive', identifier: params.identifier, file: file.name, url: item.url, license: item.license, rights: item.rights };
    } else if (params.source === 'url') {
      update({ message: 'Downloading' });
      input = await download(params.url, (f) => update({ progress: f * 0.4, message: `Downloading ${Math.round(f * 100)}%` }));
      source = { type: 'url', url: params.url, rights: 'unknown' };
    } else {
      input = params.localPath;
      source = { type: 'local', path: params.localPath, rights: 'unknown' };
    }

    const id = store.newId('lib');
    const outDir = path.join(config.mediaDir, 'library', id);
    update({ progress: 0.4, message: 'Transcoding' });
    const { segments, sourceDuration } = await transcode({
      input, outDir, kind: meta.kind, start, end,
      onProgress: (f, i, n) => update({ progress: 0.4 + f * 0.6, message: `Transcoding part ${i + 1}/${n}` }),
    });
    const item = {
      id,
      ...meta,
      source,
      credit: source.type === 'archive' ? `archive.org/details/${source.identifier}` : null,
      clip: { start, end, sourceDuration },
      segments,
      createdAt: new Date().toISOString(),
    };
    store.addLibraryItem(item);
    return { libraryId: id, segments: segments.length };
  });
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Add a clip that the website streams straight from its source: nothing is
 * downloaded or uploaded. Long programs are split into acts (WEB_ACT_SECONDS)
 * so auto-build can put commercial breaks between them.
 */
export async function addStream(params) {
  const meta = cleanMeta(params);
  const start = parseClock(params.start) ?? 0;
  let end = parseClock(params.end);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new HttpError(400, 'use mm:ss for clip times');
  let src;
  let source;
  let length = null;
  if (params.source === 'archive') {
    const item = await getItem(params.identifier);
    const pool = meta.kind === 'video' ? item.videoFiles : [...item.audioFiles, ...item.videoFiles];
    const file = params.file ? pool.find((f) => f.name === params.file) : pool[0];
    if (!file) throw new HttpError(400, `no usable ${meta.kind} file in ${params.identifier}`);
    src = file.url;
    length = file.length;
    source = { type: 'archive', identifier: params.identifier, file: file.name, url: item.url, license: item.license, rights: item.rights };
  } else if (params.source === 'url') {
    if (!/^https?:\/\//i.test(params.url || '')) throw new HttpError(400, 'url must be http(s)');
    src = params.url;
    source = { type: 'url', url: params.url, rights: 'unknown' };
  } else {
    throw new HttpError(400, 'streaming needs an archive.org item or a direct URL');
  }
  if (!length) {
    try {
      length = (await probe(src)).duration || null;
    } catch { /* fall back to the given end time */ }
  }
  if (!length && end === null) throw new HttpError(400, 'could not read the length of this file; enter a clip end time');
  end = Math.min(end ?? length, length ?? Infinity);
  if (!(end > start)) throw new HttpError(400, 'clip end must be after its start (and within the file)');

  const acts = meta.category === 'commercial'
    ? [{ index: 0, start, duration: end - start }]
    : planSegments(start, end, config.media.webActSeconds);
  return store.addLibraryItem({
    id: store.newId('lib'),
    ...meta,
    delivery: 'stream',
    source,
    credit: source.type === 'archive' ? `archive.org/details/${source.identifier}` : null,
    clip: { start, end, sourceDuration: length },
    segments: acts.map((a) => ({
      index: a.index, file: null, src, start: round3(a.start), duration: round3(a.duration),
      sizeBytes: null, assetId: null, upload: { status: 'none' },
    })),
    createdAt: new Date().toISOString(),
  });
}

/** Register something already uploaded to Roblox by hand (Creator Hub). */
export function addManual(params) {
  const meta = cleanMeta(params);
  const assetId = String(params.assetId || '').replace(/\D/g, '');
  const duration = parseClock(params.duration);
  if (!assetId) throw new HttpError(400, 'assetId is required');
  if (!(duration > 0)) throw new HttpError(400, 'duration is required (mm:ss)');
  return store.addLibraryItem({
    id: store.newId('lib'),
    ...meta,
    source: { type: 'manual', rights: 'unknown' },
    credit: params.credit ? String(params.credit).slice(0, 120) : null,
    clip: null,
    segments: [{ index: 0, file: null, duration, sizeBytes: null, assetId, upload: { status: 'done', manual: true } }],
    createdAt: new Date().toISOString(),
  });
}

export function updateMeta(id, patch) {
  const item = store.getLibraryItem(id);
  if (!item) throw new HttpError(404, 'library item not found');
  const meta = cleanMeta({ ...item, ...patch, kind: item.kind });
  return store.updateLibraryItem(id, (it) => ({ ...it, ...meta, credit: patch.credit !== undefined ? String(patch.credit).slice(0, 120) || null : it.credit }));
}

export function setSegmentAsset(id, index, assetIdRaw) {
  const assetId = String(assetIdRaw || '').replace(/\D/g, '') || null;
  const updated = store.updateLibraryItem(id, (it) => {
    const seg = it.segments[index];
    if (!seg) throw new HttpError(404, 'segment not found');
    seg.assetId = assetId;
    seg.upload = assetId ? { status: 'done', manual: true } : { status: 'none' };
  });
  if (!updated) throw new HttpError(404, 'library item not found');
  return updated;
}

export function deleteItem(id) {
  if (!store.removeLibraryItem(id)) throw new HttpError(404, 'library item not found');
  fs.rmSync(path.join(config.mediaDir, 'library', id), { recursive: true, force: true });
}

function patchSegment(id, index, patch) {
  store.updateLibraryItem(id, (it) => {
    Object.assign(it.segments[index], patch);
  });
}

/**
 * Upload segments to Roblox. Videos cost Robux, so the caller must pass
 * explicit confirmations, and the job stops at the first failure.
 */
export function upload(id, { segments: which = 'all', confirmCost, confirmRights }) {
  const item = store.getLibraryItem(id);
  if (!item) throw new HttpError(404, 'library item not found');
  if (!confirmRights) throw new HttpError(400, 'confirm you hold the rights (public domain or licensed) before uploading');
  const indexes = (which === 'all' ? item.segments.map((s) => s.index) : [].concat(which).map(Number))
    .filter((i) => item.segments[i] && !item.segments[i].assetId && item.segments[i].file);
  if (!indexes.length) throw new HttpError(400, 'nothing to upload (already uploaded or no local file)');
  if (item.kind === 'video' && !confirmCost) {
    throw new HttpError(400, `confirm the cost: ${indexes.length} video upload(s) × R$${config.roblox.videoPrice}`);
  }

  return createJob('upload', `Upload: ${item.title}`, async (update) => {
    const done = [];
    for (const [n, index] of indexes.entries()) {
      // Re-read: another queued job may have uploaded this part meanwhile.
      const seg = store.getLibraryItem(id)?.segments[index];
      if (!seg) throw new HttpError(404, 'library item was deleted');
      if (seg.assetId) continue;
      const partLabel = item.segments.length > 1 ? ` pt${index + 1}` : '';
      update({ progress: n / indexes.length, message: `Uploading part ${index + 1} (${n + 1}/${indexes.length})` });
      patchSegment(id, index, { upload: { status: 'uploading' } });
      try {
        const op = await createAsset({
          filePath: absoluteMediaPath(seg.file),
          assetType: item.kind === 'audio' ? 'Audio' : 'Video',
          displayName: `${item.title.slice(0, 38)}${item.year ? ` ${item.year}` : ''}${partLabel}`,
          description: `Archival ${item.category} for This Day TV.${item.credit ? ` Source: ${item.credit}` : ''}`,
        });
        patchSegment(id, index, { upload: { status: 'processing', operation: op.path || null } });
        update({ message: `Roblox is processing part ${index + 1}` });
        const { assetId, moderation } = await waitForAsset(op);
        patchSegment(id, index, { assetId, upload: { status: 'done', operation: op.path || null, moderation } });
        done.push({ index, assetId });
      } catch (err) {
        const cur = store.getLibraryItem(id)?.segments[index]?.upload || {};
        patchSegment(id, index, { upload: { ...cur, status: 'error', error: err.message } });
        throw err;
      }
    }
    return { uploaded: done };
  }, { lane: 'upload' });
}

/** Re-check a segment whose upload operation was still processing (e.g. after a restart). */
export async function checkOperation(id, index) {
  const item = store.getLibraryItem(id);
  const seg = item?.segments[index];
  if (!seg) throw new HttpError(404, 'segment not found');
  if (!seg.upload?.operation) throw new HttpError(400, 'segment has no pending Roblox operation');
  const op = await getOperation(seg.upload.operation);
  if (op.done && op.response?.assetId) {
    patchSegment(id, index, { assetId: String(op.response.assetId), upload: { ...seg.upload, status: 'done', error: null } });
  }
  return { done: Boolean(op.done), operation: op };
}
