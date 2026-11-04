// archive.org search + metadata.
//
// archive.org has a reliable, keyless API (advancedsearch + metadata), but its
// `date` field is user-entered and noisy: copyrighted feature films are often
// tagged with release dates. So we query several ways, merge, and score:
//   1. exact `date` match on MM-DD for each year in range
//   2. identifiers that start with YYYY-MM-DD (Universal Newsreels etc.)
//   3. the date written out in the title/description ("November 3, 1965")
// and rank trusted public-domain collections up and obvious rips down.

import { HttpError } from './config.js';
import { fetchJson } from './http.js';
import { dateForms, pad2, validYears } from './dates.js';

const ADV = 'https://archive.org/advancedsearch.php';
const FIELDS = [
  'identifier', 'title', 'date', 'year', 'collection', 'licenseurl',
  'downloads', 'description', 'runtime', 'mediatype', 'subject',
];

// Positive = curated, mostly public domain or clearly era footage.
export const COLLECTION_WEIGHTS = {
  universal_newsreels: 35,
  prelinger: 30,
  nasa: 25,
  classic_tv_commercials: 25,
  tvcommercials: 20,
  newsandpublicaffairs: 15,
  classic_tv: 12,
  ephemera: 12,
  oldtimeradio: 15,
  otr_news: 15,
  television: 8,
  // Feature films are almost always copyrighted and mis-dated.
  feature_films: -40,
  moviesandfilms: -5,
};

const LIKELY_PD_COLLECTIONS = new Set(['universal_newsreels', 'prelinger', 'nasa']);
const RIP_RE = /\b(1080p|720p|2160p|4k|blu-?ray|bdrip|brrip|webrip|web-dl|dvdrip|x26[45]|hevc|yify|full movie)\b/i;

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const quote = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

function mediaClause(media) {
  if (media === 'audio') return 'mediatype:audio';
  if (media === 'both') return 'mediatype:(movies OR audio)';
  return 'mediatype:movies';
}

/** Build the Solr queries for a given MM-DD across a year range. Exported for tests. */
export function buildDateQueries(mm, dd, from, to, media = 'video') {
  const years = validYears(mm, dd, from, to);
  if (!years.length) return [];
  const MM = pad2(mm);
  const DD = pad2(dd);
  const mt = mediaClause(media);
  const queries = [
    {
      strategy: 'date',
      q: `${mt} AND (${years.map((y) => `date:[${y}-${MM}-${DD} TO ${y}-${MM}-${DD}]`).join(' OR ')})`,
    },
    {
      strategy: 'identifier',
      q: `${mt} AND (${years.map((y) => `identifier:${y}-${MM}-${DD}*`).join(' OR ')})`,
    },
  ];
  // Title/description phrases get long; one query per decade keeps URLs short.
  for (let start = from - (from % 10); start <= to; start += 10) {
    const decade = years.filter((y) => y >= start && y < start + 10);
    if (!decade.length) continue;
    const phrases = decade.flatMap((y) => dateForms(y, mm, dd)).map(quote).join(' OR ');
    queries.push({ strategy: 'title', q: `${mt} AND (title:(${phrases}) OR description:(${phrases}))` });
  }
  return queries;
}

async function advancedSearch(q, { rows = 60, sort } = {}) {
  const url = new URL(ADV);
  url.searchParams.set('q', q);
  for (const f of FIELDS) url.searchParams.append('fl[]', f);
  url.searchParams.set('rows', String(rows));
  url.searchParams.set('output', 'json');
  if (sort) url.searchParams.append('sort[]', sort);
  const body = await fetchJson(url);
  return body?.response?.docs ?? [];
}

export function classifyRights(doc) {
  const lic = String(doc.licenseurl || '').toLowerCase();
  const colls = asArray(doc.collection);
  const curated = colls.some((c) => LIKELY_PD_COLLECTIONS.has(c));
  // Licenses are set by whoever uploaded the item, and plenty of TV rips are
  // tagged "public domain". Only trust that inside curated PD collections.
  if (lic.includes('publicdomain')) {
    return curated
      ? { rights: 'public-domain', label: 'Public domain' }
      : { rights: 'claimed-public-domain', label: 'Uploader says PD — verify' };
  }
  if (curated) return { rights: 'likely-public-domain', label: 'Likely public domain' };
  if (lic.includes('creativecommons')) {
    const nc = /by-nc|\/nc/.test(lic);
    return { rights: 'creative-commons', label: nc ? 'Uploader says CC-NC — verify' : 'Uploader says CC — verify' };
  }
  return { rights: 'unknown', label: 'Rights unknown — verify' };
}

/** Find which year in range a doc matches for this MM-DD (or null). */
export function matchedYear(doc, mm, dd, from, to) {
  const md = `-${pad2(mm)}-${pad2(dd)}`;
  const date = String(doc.date || '');
  const fromDate = /^(\d{4})-\d{2}-\d{2}/.exec(date);
  if (fromDate && date.slice(4, 10) === md) return Number(fromDate[1]);
  const fromId = /^(\d{4})-(\d{2})-(\d{2})/.exec(doc.identifier || '');
  if (fromId && `-${fromId[2]}-${fromId[3]}` === md) return Number(fromId[1]);
  const text = `${doc.title || ''} ${asArray(doc.description).join(' ')}`;
  for (const y of validYears(mm, dd, from, to)) {
    if (dateForms(y, mm, dd).some((f) => text.includes(f))) return y;
  }
  return null;
}

export function scoreDoc(doc, strategies = []) {
  let score = 0;
  for (const c of asArray(doc.collection)) score += COLLECTION_WEIGHTS[c] || 0;
  const { rights } = classifyRights(doc);
  score += { 'public-domain': 25, 'likely-public-domain': 18, 'claimed-public-domain': 8, 'creative-commons': 6 }[rights] || 0;
  score += new Set(strategies).size * 8;
  if (strategies.includes('identifier') || strategies.includes('title')) score += 10;
  if (RIP_RE.test(doc.title || '') || RIP_RE.test(doc.identifier || '')) score -= 60;
  score += Math.log10((Number(doc.downloads) || 0) + 1) * 2;
  return Math.round(score);
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

export function shapeDoc(doc, extra = {}) {
  const { rights, label } = classifyRights(doc);
  return {
    identifier: doc.identifier,
    title: stripHtml(doc.title) || doc.identifier,
    date: doc.date ? String(doc.date).slice(0, 10) : null,
    year: doc.year ? Number(String(doc.year).slice(0, 4)) : null,
    mediatype: doc.mediatype,
    collections: asArray(doc.collection).filter((c) => !c.startsWith('fav-')).slice(0, 6),
    license: doc.licenseurl || null,
    rights,
    rightsLabel: label,
    downloads: Number(doc.downloads) || 0,
    runtime: doc.runtime || null,
    description: stripHtml(asArray(doc.description).join(' ')).slice(0, 400),
    url: `https://archive.org/details/${doc.identifier}`,
    thumb: `https://archive.org/services/img/${doc.identifier}`,
    ...extra,
  };
}

/** Programming that aired (or was filmed) on MM-DD in [from, to]. */
export async function searchByDate({ mm, dd, from, to, media = 'video', limit = 60 }) {
  const queries = buildDateQueries(mm, dd, from, to, media);
  const settled = await Promise.allSettled(
    queries.map(async ({ strategy, q }) => ({ strategy, docs: await advancedSearch(q, { rows: 80, sort: 'downloads desc' }) })),
  );
  const merged = new Map();
  const errors = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      errors.push(r.reason.message);
      continue;
    }
    for (const doc of r.value.docs) {
      const entry = merged.get(doc.identifier) || { doc, strategies: [] };
      entry.strategies.push(r.value.strategy);
      merged.set(doc.identifier, entry);
    }
  }
  if (!merged.size && errors.length === settled.length && errors.length) {
    throw new HttpError(502, `archive.org search failed: ${errors[0]}`);
  }
  const results = [...merged.values()]
    .map(({ doc, strategies }) => {
      const airYear = matchedYear(doc, mm, dd, from, to);
      return shapeDoc(doc, {
        airYear,
        airDate: airYear ? `${airYear}-${pad2(mm)}-${pad2(dd)}` : null,
        strategies: [...new Set(strategies)],
        score: scoreDoc(doc, strategies),
      });
    })
    .filter((r) => r.airYear !== null)
    .sort((a, b) => b.score - a.score || (a.airYear || 0) - (b.airYear || 0));
  return { results: results.slice(0, limit), errors };
}

/** YYYY-MM-DD for a UTC date. */
const isoDay = (d) => d.toISOString().slice(0, 10);

/** The doc's own calendar date if it has one (date field or YYYY-MM-DD identifier). */
export function docDate(doc) {
  const fromId = /^(\d{4}-\d{2}-\d{2})/.exec(doc.identifier || '');
  if (fromId) return fromId[1];
  const fromDate = /^(\d{4}-\d{2}-\d{2})/.exec(String(doc.date || ''));
  // archive.org stores year-only dates as YYYY-01-01; don't treat those as real days.
  if (fromDate && !fromDate[1].endsWith('-01-01')) return fromDate[1];
  return null;
}

/** Days from MM-DD of `year` to an ISO date (negative = before). */
function daysApart(year, mm, dd, iso) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(year, mm - 1, dd)) / 86400000);
}

/** Queries for one broadcast year: that exact date, the surrounding week, then the year at large. */
export function buildYearQueries(mm, dd, year, media = 'video', windowDays = 7) {
  const mt = mediaClause(media);
  const center = Date.UTC(year, mm - 1, dd);
  const from = isoDay(new Date(center - windowDays * 86400000));
  const to = isoDay(new Date(center + windowDays * 86400000));
  const days = [];
  for (let i = -windowDays; i <= windowDays; i++) days.push(isoDay(new Date(center + i * 86400000)));
  const curated = 'collection:(universal_newsreels OR prelinger OR classic_tv OR newsandpublicaffairs OR nasa OR ephemera OR tvnews OR television OR oldtimeradio)';
  return [
    ...buildDateQueries(mm, dd, year, year, media),
    { strategy: 'week', q: `${mt} AND (date:[${from} TO ${to}] OR ${days.map((d) => `identifier:${d}*`).join(' OR ')})` },
    { strategy: 'year', q: `${mt} AND year:${year} AND ${curated}` },
  ];
}

/**
 * Everything usable for a broadcast locked to one year. Each result has
 * `match`: 'date' (aired that day), 'week' (within a week of it), or 'year'.
 */
export async function searchYear({ mm, dd, year, media = 'video', windowDays = 7, limit = 80 }) {
  const queries = buildYearQueries(mm, dd, year, media, windowDays);
  const settled = await Promise.allSettled(
    queries.map(async ({ strategy, q }) => ({ strategy, docs: await advancedSearch(q, { rows: 80, sort: 'downloads desc' }) })),
  );
  const merged = new Map();
  const errors = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      errors.push(r.reason.message);
      continue;
    }
    for (const doc of r.value.docs) {
      const entry = merged.get(doc.identifier) || { doc, strategies: [] };
      entry.strategies.push(r.value.strategy);
      merged.set(doc.identifier, entry);
    }
  }
  if (!merged.size && errors.length && errors.length === settled.length) throw new HttpError(502, `archive.org search failed: ${errors[0]}`);
  const results = [];
  for (const { doc, strategies } of merged.values()) {
    const exact = matchedYear(doc, mm, dd, year, year) === year;
    const own = docDate(doc);
    const docYear = own ? Number(own.slice(0, 4)) : doc.year ? Number(String(doc.year).slice(0, 4)) : null;
    if (!exact && docYear !== year) continue; // keep the year consistent
    const offset = !exact && own ? daysApart(year, mm, dd, own) : null;
    const match = exact ? 'date' : offset !== null && Math.abs(offset) <= windowDays ? 'week' : 'year';
    results.push(shapeDoc(doc, {
      airYear: year,
      airDate: exact ? `${year}-${pad2(mm)}-${pad2(dd)}` : own,
      match,
      daysFrom: offset,
      // Dated after the broadcast day: news nobody had seen yet on that date.
      future: offset !== null && offset > 0,
      strategies: [...new Set(strategies)],
      score: scoreDoc(doc, strategies) + { date: 40, week: 20, year: 0 }[match],
    }));
  }
  results.sort((a, b) => b.score - a.score);
  return { results: results.slice(0, limit), errors };
}

/** Era commercials. Not date-specific: anything from that year fits the broadcast. */
export async function searchCommercials({ year, from, to, text = '', limit = 40 }) {
  const yearClause = year ? `(year:${Number(year)} OR title:${Number(year)})` : `year:[${Number(from)} TO ${Number(to)}]`;
  const topic = '(collection:classic_tv_commercials OR collection:tvcommercials OR subject:(commercial OR commercials OR "tv commercial" OR "television commercial"))';
  const extra = text ? ` AND (${sanitizeFreeText(text)})` : '';
  const docs = await advancedSearch(`mediatype:movies AND ${topic} AND ${yearClause}${extra}`, { rows: limit, sort: 'downloads desc' });
  return {
    results: docs
      .filter((d) => !RIP_RE.test(d.title || ''))
      .map((d) => shapeDoc(d, { airYear: d.year ? Number(String(d.year).slice(0, 4)) : Number(year) || null, score: scoreDoc(d) })),
  };
}

/** Free-text search limited to a year range. */
export async function searchText({ text, from, to, media = 'video', limit = 50 }) {
  if (!text || !text.trim()) throw new HttpError(400, 'q is required');
  const q = `${mediaClause(media)} AND (${sanitizeFreeText(text)}) AND year:[${Number(from)} TO ${Number(to)}]`;
  const docs = await advancedSearch(q, { rows: limit, sort: 'downloads desc' });
  return {
    results: docs
      .map((d) => shapeDoc(d, { airYear: d.year ? Number(String(d.year).slice(0, 4)) : null, score: scoreDoc(d) }))
      .sort((a, b) => b.score - a.score),
  };
}

/** Keep free text from breaking (or injecting into) the Solr query. */
export function sanitizeFreeText(text) {
  const cleaned = String(text).replace(/[^\p{L}\p{N}\s'"-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new HttpError(400, 'search text is empty');
  // Balance quotes so an odd one can't swallow the rest of the query.
  return (cleaned.match(/"/g) || []).length % 2 ? cleaned.replace(/"/g, '') : cleaned;
}

function parseLength(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (s.includes(':')) return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const VIDEO_FORMATS = ['h.264', 'MPEG4', '512Kb MPEG4', 'h.264 IA', 'h.264 HD', 'QuickTime', 'Ogg Video', 'Matroska', 'MPEG2', 'Cinepack', 'Windows Media'];
const AUDIO_FORMATS = ['VBR MP3', '128Kbps MP3', '64Kbps MP3', 'MP3', 'Flac', 'Ogg Vorbis', 'WAVE'];

/** Item metadata with playable files ranked best-first. */
export async function getItem(identifier) {
  if (!/^[A-Za-z0-9._-]+$/.test(identifier || '')) throw new HttpError(400, 'bad archive.org identifier');
  const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  if (!meta || !meta.metadata) throw new HttpError(404, `archive.org item ${identifier} not found`);
  const m = meta.metadata;
  const files = (meta.files || []).map((f) => ({
    name: f.name,
    format: f.format,
    size: Number(f.size) || null,
    length: parseLength(f.length),
    url: `https://archive.org/download/${encodeURIComponent(identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
  }));
  const rank = (list, f) => {
    const i = list.indexOf(f.format);
    return i === -1 ? Infinity : i;
  };
  const videoFiles = files
    .filter((f) => VIDEO_FORMATS.includes(f.format))
    .sort((a, b) => rank(VIDEO_FORMATS, a) - rank(VIDEO_FORMATS, b) || (a.size || 0) - (b.size || 0));
  const audioFiles = files
    .filter((f) => AUDIO_FORMATS.includes(f.format))
    .sort((a, b) => rank(AUDIO_FORMATS, a) - rank(AUDIO_FORMATS, b) || (a.size || 0) - (b.size || 0));
  return {
    ...shapeDoc({ ...m, identifier, downloads: meta.item?.downloads }),
    videoFiles,
    audioFiles,
  };
}
