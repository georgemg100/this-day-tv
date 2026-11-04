// Autopilot: program a whole day with no human in the loop.
//
// For a date (MM-DD) it:
//   1. scores every year in range by how much dated programming + news it has,
//   2. checks the most promising years in depth (that exact date, the same
//      week, then the rest of that year), keeping only clips whose rights pass,
//   3. picks N years spread across the decades, one channel per year,
//   4. fills each channel with that year's programs, commercials and headlines
//      (via the same autoBuild/compile the console uses), and
//   5. returns the compiled website schedule.
//
// Deterministic per date: re-running the same day gives the same lineup.

import { searchByDate, searchYear, searchCommercials, getItem } from './archive.js';
import { onThisDay } from './onthisday.js';
import { planSegments } from './media.js';
import { autoBuild, normalizeDraft, compile } from './schedule.js';
import { parseMMDD, prettyDate } from './dates.js';
import { config } from './config.js';

const SAFE_RIGHTS = new Set(['public-domain', 'likely-public-domain']);
const PLAYABLE_FORMATS = new Set(['h.264', 'MPEG4', '512Kb MPEG4', 'h.264 IA', 'h.264 HD']);
const NEWS_COLLECTIONS = new Set(['universal_newsreels', 'newsandpublicaffairs', 'tvnews']);
const CHANNEL_NUMBERS = [2, 4, 5, 7, 9, 11, 13, 3, 6, 8, 10, 12];
const CALLSIGNS = ['WTDI', 'WKTV', 'WNTW', 'WYRS', 'WHEN', 'WOLD', 'WPST', 'WDAY', 'WNOW', 'WTHN', 'WAGO', 'WERA'];
const TAGLINES = ['Your window to yesterday', 'Seven on your dial', 'The way it was', 'Tonight, back then', 'Stay tuned', 'Your evening companion'];

export const DEFAULTS = {
  channels: 8,
  rights: 'pd', // programs: 'pd' = public domain only, 'any' = also unknown/claimed
  adRights: 'any', // commercials: most period ads carry no rights tag at all
  targetMinutes: 45, // fill each channel to about this much before looping
  maxProgramMinutes: 40, // skip single items longer than this
  maxPrograms: 12,
  minMinutes: 8, // a year needs at least this much programming to get a channel
  maxAds: 6,
  adsPerBreak: 2,
  concurrency: 4, // simultaneous archive.org requests (be polite)
};

// ---------------------------------------------------------------- helpers
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

/** "Inauguration. Thieu Sworn In, Stresses Peace, 1967/11/03" -> "Thieu Sworn In, Stresses Peace" */
export function cleanTitle(title, description = '') {
  let t = String(title || '').replace(/_/g, ' ');
  t = t.replace(/\.(wmv|mp4|mov|avi|mpe?g|m4v|ogv|flv|mkv)$/i, ''); // file names
  t = t.replace(/^\[(.*)\]$/, '$1'); // "[Bradley: Second to None]"
  // Bare place names ("England, 1967/11/03"): the description says what happened.
  const dated = /[,\s]*\(?\b(19|20)\d{2}[/-]\d{2}[/-]\d{2}\)?\s*$/;
  const bare = t.replace(dated, '').trim();
  if (dated.test(t) && bare.split(/\s+/).length <= 2 && description) {
    let d = String(description).replace(/\s*\(.*?\)\s*/g, ' ').replace(/^\(\d+\)\s*/, '').split(/(?<=[a-z])\.\s|;\s/)[0].trim();
    if (d.length > 72) d = `${d.slice(0, 72).replace(/\s+\S*$/, '')}…`;
    d = d.replace(/[\s.]+$/, '');
    if (d.length >= 12) return d;
  }
  t = t.replace(/[,\s]*\(?\b(19|20)\d{2}[/-]\d{2}[/-]\d{2}\)?\s*$/, ''); // trailing date
  t = t.replace(/\s*\((19|20)\d{2}\)\s*$/, ''); // trailing (1967)
  const parts = t.split(/\.\s+/);
  // Universal Newsreel style "Place. Headline": keep the headline.
  if (parts.length === 2 && parts[0].split(' ').length <= 3 && parts[1].length > 8) t = parts[1];
  return t.replace(/\s+/g, ' ').trim().slice(0, 120) || String(title).slice(0, 120);
}

// 'any' still drops obvious movie rips: they score below zero and are filtered out below.
const rightsOk = (r, mode) => (mode === 'any' ? true : SAFE_RIGHTS.has(r.rights));
const categoryFor = (r) => {
  if (/\bcommercials?\b/i.test(r.title)) return 'commercial';
  return r.collections?.some((c) => NEWS_COLLECTIONS.has(c)) || /\bnews(reel|cast)?\b/i.test(r.title) ? 'news' : 'program';
};

/** Scrambled or machine-generated titles ("#Bfl O {ggGX = STwWcfl"). */
export function looksLikeJunk(title) {
  const t = String(title || '');
  if ((t.match(/[#{}=<>|~^\\]/g) || []).length >= 2) return true;
  if (/[a-z][A-Z][a-z]*[A-Z]|[A-Z]{2}[a-z][A-Z]/.test(t)) return true; // random casing inside words
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return t.length > 0 && letters / t.length < 0.5;
}

/** Normalised title + part designation, for spotting duplicate uploads. */
export function titleKey(title) {
  let t = cleanTitle(title).toLowerCase();
  const m = /\(?\bpart\s+([ivx\d]+)\)?/i.exec(t);
  const part = m ? m[1] : 'whole';
  if (m) t = t.replace(m[0], '');
  return { base: t.replace(/[^a-z0-9]+/g, ' ').trim(), part };
}

function bestFile(item) {
  return item.videoFiles.find((f) => PLAYABLE_FORMATS.has(f.format) && f.length > 0) || null;
}

/** A search result + its metadata -> an in-memory streamed library item. */
function toLibraryItem(r, item, file, { category, year }) {
  const acts = category === 'commercial'
    ? [{ index: 0, start: 0, duration: file.length }]
    : planSegments(0, file.length, config.media.webActSeconds);
  return {
    id: `ap_${r.identifier}`,
    kind: 'video',
    category,
    title: cleanTitle(r.title, r.description),
    year,
    airDate: r.airDate || null,
    delivery: 'stream',
    source: { type: 'archive', identifier: r.identifier, file: file.name, url: r.url, license: r.license, rights: r.rights },
    credit: `archive.org/details/${r.identifier}`,
    segments: acts.map((a) => ({ index: a.index, src: file.url, start: Math.round(a.start * 1000) / 1000, duration: Math.round(a.duration * 1000) / 1000 })),
  };
}

// ---------------------------------------------------------------- main
export async function programDay(key, options = {}) {
  const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const o = { ...DEFAULTS, from: config.station.yearFrom, to: config.station.yearTo, log: () => {}, ...given };
  const { mm, dd } = parseMMDD(key);
  const rand = seeded(`${key}:${o.from}-${o.to}`);
  const limit = limiter(o.concurrency);
  const log = o.log;

  // 1. Quick pass over the whole range: dated clips + Wikipedia items per year.
  log(`${key}: scanning ${o.from}–${o.to}`);
  const [range, news] = await Promise.all([
    limit(() => searchByDate({ mm, dd, from: o.from, to: o.to })).catch(() => ({ results: [] })),
    onThisDay({ mm, dd, from: o.from, to: o.to }).catch(() => ({ results: [] })),
  ]);
  const pre = new Map();
  const bump = (y, n) => y && pre.set(y, (pre.get(y) || 0) + n);
  range.results.filter((r) => rightsOk(r, o.rights)).forEach((r) => bump(r.airYear, 3));
  news.results.forEach((e) => bump(e.year, 1));

  // Candidates: the strongest years, plus a couple per decade so later decades get a look.
  const candidates = new Set([...pre.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([y]) => y));
  for (let d = o.from - (o.from % 10); d <= o.to; d += 10) {
    const years = shuffle(Array.from({ length: 10 }, (_, i) => d + i).filter((y) => y >= o.from && y <= o.to), rand);
    years.slice(0, 2).forEach((y) => candidates.add(y));
  }

  // 2. In-depth look at each candidate year.
  log(`${key}: checking ${candidates.size} candidate years`);
  const evaluated = await Promise.all([...candidates].map(async (year) => {
    const res = await limit(() => searchYear({ mm, dd, year })).catch(() => ({ results: [] }));
    const usable = res.results.filter((r) => rightsOk(r, o.rights) && r.score > 0 && !r.future && !looksLikeJunk(r.title));
    const weight = { date: 5, week: 3, year: 1 };
    const headlines = news.results.filter((e) => e.year === year);
    return { year, usable, headlines, score: usable.reduce((s, r) => s + weight[r.match], 0) + headlines.length };
  }));

  // 3. Pick years round-robin across decades (best first in each), so channels span eras.
  const byDecade = new Map();
  evaluated.filter((e) => e.usable.length).sort((a, b) => b.score - a.score).forEach((e) => {
    const d = Math.floor(e.year / 10) * 10;
    if (!byDecade.has(d)) byDecade.set(d, []);
    byDecade.get(d).push(e);
  });
  const ordered = [];
  while ([...byDecade.values()].some((l) => l.length)) {
    for (const d of [...byDecade.keys()].sort((a, b) => (byDecade.get(b)[0]?.score || 0) - (byDecade.get(a)[0]?.score || 0))) {
      const next = byDecade.get(d).shift();
      if (next) ordered.push(next);
    }
  }

  // 4. Build channels until we have enough (years whose clips don't pan out are skipped).
  const channels = [];
  const library = [];
  const report = [];
  for (const cand of ordered) {
    if (channels.length >= o.channels) break;
    const programs = await fillPrograms(cand, o, limit);
    const minutes = programs.reduce((s, p) => s + p.segments.reduce((t, g) => t + g.duration, 0), 0) / 60;
    if (minutes < o.minMinutes) {
      log(`${key}: ${cand.year} skipped (${programs.length ? `only ${minutes.toFixed(1)} min` : 'no playable clips'})`);
      continue;
    }
    const ads = await fillAds(cand.year, o, limit, rand);
    library.push(...programs, ...ads);
    channels.push({ year: cand.year, programs, ads, headlines: cand.headlines });
  }
  channels.sort((a, b) => a.year - b.year);
  const numbers = CHANNEL_NUMBERS.slice(0, channels.length).sort((a, b) => a - b);

  const draftChannels = channels.map((c, i) => {
    const number = numbers[i];
    const name = CALLSIGNS[i % CALLSIGNS.length];
    const entries = autoBuild({
      key,
      channel: { name, number },
      library,
      year: c.year,
      programIds: c.programs.map((p) => p.id),
      commercialIds: c.ads.map((a) => a.id),
      headlines: c.headlines,
      adsPerBreak: o.adsPerBreak,
    });
    const minutes = c.programs.reduce((s, p) => s + p.segments.reduce((t, g) => t + g.duration, 0), 0) / 60;
    report.push({ channel: number, name, year: c.year, programs: c.programs.length, minutes: Math.round(minutes), ads: c.ads.length, headlines: c.headlines.length,
      titles: c.programs.map((p) => `${p.title}${p.airDate ? ` (${p.airDate})` : ''}`) });
    return { number, name, tagline: TAGLINES[i % TAGLINES.length], year: c.year, entries };
  });

  if (!draftChannels.length) return { compiled: null, warnings: ['No year had playable programming for this date.'], report };
  const draft = normalizeDraft(key, { title: `This Day in History — ${prettyDate(mm, dd)}`, channels: draftChannels });
  const { compiled, warnings } = compile(draft, library, { target: 'web' });
  compiled.generatedBy = 'autopilot';
  compiled.options = { rights: o.rights, adRights: o.adRights };
  return { compiled, warnings, report };
}

async function fillPrograms(cand, o, limit) {
  const order = { date: 0, week: 1, year: 2 };
  const ranked = [...cand.usable].sort((a, b) => order[a.match] - order[b.match] || b.score - a.score);
  const picked = [];
  const seen = new Set();
  let seconds = 0;
  // Fetch metadata in small batches until the channel is full.
  for (let i = 0; i < ranked.length && seconds < o.targetMinutes * 60 && picked.length < o.maxPrograms; i += o.concurrency) {
    const batch = ranked.slice(i, i + o.concurrency);
    const metas = await Promise.all(batch.map((r) => limit(() => getItem(r.identifier)).catch(() => null)));
    batch.forEach((r, j) => {
      const file = metas[j] && bestFile(metas[j]);
      if (!file || file.length < 20 || file.length > o.maxProgramMinutes * 60) return;
      if (seconds >= o.targetMinutes * 60 || picked.length >= o.maxPrograms) return;
      // The same film is often uploaded more than once (whole, or in parts).
      const { base, part } = titleKey(r.title);
      if (seen.has(`${base}|${part}`) || seen.has(`${base}|whole`) || (part === 'whole' && [...seen].some((k) => k.startsWith(`${base}|`)))) return;
      seen.add(`${base}|${part}`);
      picked.push(toLibraryItem(r, metas[j], file, { category: categoryFor(r), year: cand.year }));
      seconds += file.length;
    });
  }
  return picked;
}

async function fillAds(year, o, limit, rand) {
  const res = await limit(() => searchCommercials({ year, limit: 40 })).catch(() => ({ results: [] }));
  const pool = shuffle(res.results.filter((r) => (r.airYear === year) && (o.adRights === 'any' || SAFE_RIGHTS.has(r.rights))), rand);
  const ads = [];
  for (let i = 0; i < pool.length && ads.length < o.maxAds; i += o.concurrency) {
    const batch = pool.slice(i, i + o.concurrency);
    const metas = await Promise.all(batch.map((r) => limit(() => getItem(r.identifier)).catch(() => null)));
    batch.forEach((r, j) => {
      const file = metas[j] && bestFile(metas[j]);
      if (!file || file.length < 10 || file.length > 180 || ads.length >= o.maxAds) return;
      ads.push(toLibraryItem({ ...r, airDate: null }, metas[j], file, { category: 'commercial', year }));
    });
  }
  return ads;
}
