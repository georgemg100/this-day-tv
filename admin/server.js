// This Day TV — admin console server. Zero dependencies (Node >= 20).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT, HttpError } from './lib/config.js';
import { parseMMDD, todayMMDD, utcOffsetMinutes } from './lib/dates.js';
import * as archive from './lib/archive.js';
import { exaSearch } from './lib/exa.js';
import { onThisDay } from './lib/onthisday.js';
import { ffmpegAvailable, absoluteMediaPath } from './lib/media.js';
import * as roblox from './lib/roblox.js';
import * as library from './lib/library.js';
import * as store from './lib/store.js';
import { getJob, listJobs } from './lib/jobs.js';
import { emptyDraft, normalizeDraft, autoBuild, compile, uploadCost, TARGETS } from './lib/schedule.js';
import { publishWeb, getWebPublished, webStatus } from './lib/web.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const HAS_FFMPEG = ffmpegAvailable();

// ---------------------------------------------------------------- helpers
const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, re, keys, handler, open });
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5e6) throw new HttpError(413, 'request body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

function yearRange(q) {
  const from = Number(q.get('from')) || config.station.yearFrom;
  const to = Number(q.get('to')) || config.station.yearTo;
  if (from > to || from < 1890 || to > 2100) throw new HttpError(400, 'bad year range');
  return { from, to };
}

function tokenOk(req) {
  if (!config.adminToken) return true;
  const given = String(req.headers['x-admin-token'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(config.adminToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(res, pathname, baseDir = PUBLIC_DIR) {
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\//, '');
  const file = path.resolve(baseDir, rel);
  if (!file.startsWith(baseDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Stream a media file with Range support so the browser preview can seek. */
function streamFile(req, res, file, type) {
  const { size } = fs.statSync(file);
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- status
route('GET', '/api/status', () => ({
  today: todayMMDD(config.station.timezone),
  timezone: config.station.timezone,
  yearFrom: config.station.yearFrom,
  yearTo: config.station.yearTo,
  ffmpeg: HAS_FFMPEG,
  exa: Boolean(config.exaApiKey),
  roblox: roblox.robloxStatus(),
  media: { maxSegmentSeconds: config.media.maxSegmentSeconds, maxAudioSegmentSeconds: config.media.maxAudioSegmentSeconds, maxUploadMB: config.media.maxUploadMB, webActSeconds: config.media.webActSeconds },
  web: webStatus(),
  authRequired: Boolean(config.adminToken),
}), { open: true });

// ---------------------------------------------------------------- search
route('GET', '/api/search/archive', async ({ q }) => {
  const { mm, dd } = parseMMDD(q.get('date'));
  const { from, to } = yearRange(q);
  const media = ['video', 'audio', 'both'].includes(q.get('media')) ? q.get('media') : 'video';
  const text = (q.get('q') || '').trim();
  const year = Number(q.get('year')) || null;
  if (text) return archive.searchText({ text, from: year || from, to: year || to, media });
  if (year) return archive.searchYear({ mm, dd, year, media });
  return archive.searchByDate({ mm, dd, from, to, media });
});

route('GET', '/api/search/commercials', async ({ q }) => {
  const { from, to } = yearRange(q);
  return archive.searchCommercials({ year: q.get('year') || null, from, to, text: (q.get('q') || '').trim() });
});

route('GET', '/api/search/exa', async ({ q }) => {
  const { mm, dd } = parseMMDD(q.get('date'));
  const { from, to } = yearRange(q);
  const year = Number(q.get('year')) || null;
  return exaSearch({ mm, dd, year, from, to, text: (q.get('q') || '').trim(), archiveOnly: q.get('archiveOnly') !== 'false' });
});

route('GET', '/api/onthisday', async ({ q }) => {
  const { mm, dd } = parseMMDD(q.get('date'));
  return onThisDay({ mm, dd, ...yearRange(q) });
});

route('GET', '/api/archive/item/:id', ({ params }) => archive.getItem(params.id));

// ---------------------------------------------------------------- library
route('GET', '/api/library', () => ({ items: store.listLibrary() }));
route('POST', '/api/library/ingest', async ({ req }) => {
  if (!HAS_FFMPEG) throw new HttpError(400, 'ffmpeg/ffprobe not found on PATH');
  return { job: library.ingest(await readBody(req)) };
});
route('POST', '/api/library/stream', async ({ req }) => ({ item: await library.addStream(await readBody(req)) }));
route('POST', '/api/library/manual', async ({ req }) => ({ item: library.addManual(await readBody(req)) }));
route('PATCH', '/api/library/:id', async ({ req, params }) => ({ item: library.updateMeta(params.id, await readBody(req)) }));
route('DELETE', '/api/library/:id', ({ params }) => (library.deleteItem(params.id), { ok: true }));
route('POST', '/api/library/:id/upload', async ({ req, params }) => ({ job: library.upload(params.id, await readBody(req)) }));
route('PUT', '/api/library/:id/segments/:idx/asset', async ({ req, params }) => ({
  item: library.setSegmentAsset(params.id, Number(params.idx), (await readBody(req)).assetId),
}));
route('POST', '/api/library/:id/segments/:idx/check', ({ params }) => library.checkOperation(params.id, Number(params.idx)));
route('GET', '/media/:id/:idx', ({ req, res, params }) => {
  const seg = store.getLibraryItem(params.id)?.segments[Number(params.idx)];
  if (!seg?.file) throw new HttpError(404, 'no local file');
  const file = absoluteMediaPath(seg.file);
  streamFile(req, res, file, file.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4');
  return undefined;
});

// ---------------------------------------------------------------- jobs
route('GET', '/api/jobs', () => ({ jobs: listJobs() }));
route('GET', '/api/jobs/:id', ({ params }) => {
  const job = getJob(params.id);
  if (!job) throw new HttpError(404, 'job not found');
  return { job };
});

// ---------------------------------------------------------------- schedules
route('GET', '/api/schedules', () => ({ schedules: store.listSchedules() }));
route('GET', '/api/schedules/:date', ({ params }) => {
  const { key } = parseMMDD(params.date);
  const draft = store.getSchedule(key) || emptyDraft(key);
  return {
    draft,
    published: store.getPublished(key),
    webPublished: getWebPublished(key)?.publishedAt || null,
    cost: uploadCost(draft, store.listLibrary(), config.roblox.videoPrice),
  };
});
route('PUT', '/api/schedules/:date', async ({ req, params }) => {
  const { key } = parseMMDD(params.date);
  const draft = store.saveSchedule(key, normalizeDraft(key, await readBody(req)));
  return { draft, cost: uploadCost(draft, store.listLibrary(), config.roblox.videoPrice) };
});
route('POST', '/api/schedules/:date/autobuild', async ({ req, params }) => {
  const { key } = parseMMDD(params.date);
  const body = await readBody(req);
  const channel = { name: String(body.channelName || 'WTDI'), number: Number(body.channelNumber) || 4 };
  return {
    entries: autoBuild({
      key, channel, library: store.listLibrary(),
      programIds: body.programIds || [], commercialIds: body.commercialIds || [],
      headlines: Array.isArray(body.headlines) ? body.headlines.slice(0, 40) : [],
      adsPerBreak: Math.min(4, Math.max(0, Number(body.adsPerBreak ?? 2))),
      year: Number(body.year) || store.getSchedule(key)?.channels.find((c) => c.number === channel.number)?.year || null,
    }),
  };
});
route('GET', '/api/schedules/:date/compiled', ({ params, q }) => {
  const { key } = parseMMDD(params.date);
  const draft = store.getSchedule(key);
  if (!draft) throw new HttpError(404, 'no saved lineup for this date');
  const target = TARGETS.includes(q.get('target')) ? q.get('target') : 'web';
  return compile(draft, store.listLibrary(), { target });
});
route('POST', '/api/schedules/:date/publish', async ({ req, params }) => {
  const { key } = parseMMDD(params.date);
  const draft = store.getSchedule(key);
  if (!draft) throw new HttpError(404, 'save the lineup before publishing');
  const body = await readBody(req);
  const targets = (Array.isArray(body.targets) ? body.targets : ['web']).filter((t) => TARGETS.includes(t));
  if (!targets.length) throw new HttpError(400, 'choose at least one target (web, roblox)');
  const library = store.listLibrary();
  const publishedAt = new Date().toISOString();
  const results = {};

  if (targets.includes('web')) {
    const { compiled, warnings } = compile(draft, library, { target: 'web', publishedAt });
    if (!compiled.channels.length) {
      results.web = { ok: false, warnings: [...warnings, 'Nothing on this lineup can stream on the website.'] };
    } else {
      results.web = { ok: true, file: publishWeb(key, compiled), channels: compiled.channels.length, warnings };
    }
  }

  if (targets.includes('roblox')) {
    const { compiled, warnings } = compile(draft, library, { target: 'roblox', publishedAt });
    const status = roblox.robloxStatus();
    if (!compiled.channels.length) {
      results.roblox = { ok: false, warnings: [...warnings, 'Nothing on this lineup is uploaded to Roblox.'] };
    } else if (!status.canPublish) {
      results.roblox = { ok: false, warnings: [...warnings, 'Roblox API key / universe not configured (admin/.env).'] };
    } else {
      store.savePublished(key, compiled);
      await roblox.writeScheduleEntry(key, compiled);
      const r = { ok: true, datastore: `${config.roblox.dataStore}/${key}`, channels: compiled.channels.length, warnings, notified: false };
      try {
        await roblox.notifyServers(key);
        r.notified = true;
      } catch (err) {
        warnings.push(`Saved, but live servers were not notified (${err.message}). They pick it up within 5 minutes.`);
      }
      results.roblox = r;
    }
  }

  if (!Object.values(results).some((r) => r.ok)) {
    throw new HttpError(400, Object.values(results).flatMap((r) => r.warnings).slice(-3).join(' '));
  }
  return { results, publishedAt };
});

// Optional HttpService source for the game (Config.ScheduleUrl). Read-only, no auth.
route('GET', '/public/schedule/:date', ({ params }) => {
  const { key } = parseMMDD(params.date);
  const published = store.getPublished(key);
  if (!published) throw new HttpError(404, 'not published');
  return published;
}, { open: true });

route('GET', '/api/station/offset', () => ({
  timezone: config.station.timezone,
  utcOffsetMinutes: utcOffsetMinutes(config.station.timezone),
}));

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      if (!r.open && !tokenOk(req)) throw new HttpError(401, 'admin token required');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const out = await r.handler({ req, res, params, q: url.searchParams });
      if (out !== undefined && !res.headersSent) send(res, 200, out);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/tv') {
      res.writeHead(302, { Location: '/tv/' });
      return res.end();
    }
    // Local preview of the TV site (deploy the web/ folder anywhere static).
    if (req.method === 'GET' && url.pathname.startsWith('/tv/') && serveStatic(res, url.pathname.slice(4), config.webDir)) return;
    if (req.method === 'GET' && serveStatic(res, url.pathname)) return;
    throw new HttpError(404, 'not found');
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, err);
    if (!res.headersSent) send(res, status, { error: err.message });
    else res.destroy();
  }
});

server.listen(config.port, config.host, () => {
  const r = roblox.robloxStatus();
  console.log(`This Day TV admin → http://${config.host}:${config.port}   ·   TV preview → http://${config.host}:${config.port}/tv/`);
  console.log(`  ffmpeg: ${HAS_FFMPEG ? 'ok' : 'MISSING'} · exa: ${config.exaApiKey ? 'ok' : 'not set'} · roblox upload: ${r.canUpload ? 'ok' : 'not set'} · publish: ${r.canPublish ? 'ok' : 'not set'}`);
});
