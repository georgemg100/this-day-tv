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
const NEWS_COLLECTIONS = new Set(['universal_newsreels', 'tvnews']);
const CHANNEL_NUMBERS = [2, 4, 5, 7, 9, 11, 13, 3, 6, 8, 10, 12];
const CALLSIGNS = ['WTDI', 'WKTV', 'WNTW', 'WYRS', 'WHEN', 'WOLD', 'WPST', 'WDAY', 'WNOW', 'WTHN', 'WAGO', 'WERA'];
const TAGLINES = ['Your window to yesterday', 'Seven on your dial', 'The way it was', 'Tonight, back then', 'Stay tuned', 'Your evening companion'];

export const DEFAULTS = {
  // 'exact': only programs that aired on this exact date (any rights status).
  // 'pd':    public-domain programs, filled from the same week / year.
  mode: 'exact',
  channels: 12,
  rights: 'pd', // mode 'pd' only: 'pd' = public domain only, 'any' = also unknown/claimed
  adRights: 'any', // commercials: most period ads carry no rights tag at all
  targetMinutes: 60, // fill each channel to about this much before looping
  maxProgramMinutes: 40, // mode 'pd': skip single items longer than this
  maxExactMinutes: 150, // mode 'exact': whole evenings of coverage are fine (split into acts)
  maxPrograms: 12,
  minMinutes: 5, // a year needs at least this much programming to get a channel
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
  const dated = /[,\s]*\(?\b(19|20)\d{2}[/-]\d{2}[/-]\d{2}\)?\s*$/;
  // A bare identifier for a title ("e_history_StreamRoot_DH_0287_19601103_01"): describe it instead.
  if (/^[\w.-]+$/.test(String(title || '')) && /\d{5,}/.test(title) && description) {
    let d = String(description).replace(/\s*\(.*?\)\s*/g, ' ').split(/(?<=[a-z])\.\s|;\s/)[0].trim().replace(/[\s.]+$/, '');
    if (d.length > 72) d = `${d.slice(0, 72).replace(/\s+\S*$/, '')}…`;
    if (d.length >= 12) return d;
  }
  let t = String(title || '').replace(/_/g, ' ');
  t = t.replace(/\.(wmv|mp4|mov|avi|mpe?g|m4v|ogv|flv|mkv)$/i, ''); // file names
  t = t.replace(/^\[(.*)\]$/, '$1'); // "[Bradley: Second to None]"
  // Bare place names ("England, 1967/11/03"): the description says what happened.
  const bare = t.replace(dated, '').trim();
  if (dated.test(t) && bare.split(/\s+/).length <= 2 && description) {
    let d = String(description).replace(/\s*\(.*?\)\s*/g, ' ').replace(/^\(\d+\)\s*/, '').split(/(?<=[a-z])\.\s|;\s/)[0].trim();
    if (d.length > 72) d = `${d.slice(0, 72).replace(/\s+\S*$/, '')}…`;
    d = d.replace(/[\s.]+$/, '');
    if (d.length >= 12) return d;
  }
  const newsreelStyle = dated.test(t);
  t = t.replace(dated, ''); // trailing date
  t = t.replace(/\s*\((19|20)\d{2}\)\s*$/, ''); // trailing (1967)
  const parts = t.split(/\.\s+/);
  // Universal Newsreel style "Place. Headline, 1967/11/03": keep the headline.
  if (newsreelStyle && parts.length === 2 && parts[0].split(' ').length <= 3 && parts[1].length > 8) t = parts[1];
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
  t = t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '); // "(1980, better quality)" vs "(1980)"
  return { base: t.replace(/[^a-z0-9]+/g, ' ').trim(), part };
}

// Collections whose uploaders record original air dates (in the date field or
// description), as opposed to upload or release dates.
const AIRDATE_COLLECTIONS = /^(universal_newsreels|prelinger|nasa|tvnews|classic_tv(_\d{4}s)?|classic_tv_commercials|gameshows?(_.*)?|ublangsdale)$/;
const SKIP_COLLECTIONS = new Set(['fringe', 'deemphasize', 'altcensored', 'feature_films']);
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Does the item's own title or identifier carry its air date? */
export function datedInTitle(r) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.airDate || '');
  if (!m) return false;
  const [, y, MM, DD] = m;
  const mon = +MM - 1;
  const d = String(+DD);
  const title = String(r.title || '');
  const id = String(r.identifier || '');
  const forms = [
    `${MONTHS_LONG[mon]} ${d}, ${y}`, `${MONTHS_ABBR[mon]} ${d}, ${y}`, `${MONTHS_ABBR[mon]}. ${d}, ${y}`, `${d} ${MONTHS_LONG[mon]} ${y}`,
    `${y}/${MM}/${DD}`, `${y}-${MM}-${DD}`, `${y} ${MM} ${DD}`, `${y}.${MM}.${DD}`, `${+MM}/${d}/${y.slice(2)}`, `${+MM}/${d}/${y}`,
  ];
  return forms.some((f) => title.includes(f)) || id.includes(`${y}-${MM}-${DD}`) || id.includes(`${y}${MM}${DD}`) || id.includes(`${y.slice(2)}${MM}${DD}`);
}

/** Is there real evidence this item aired on that day in that year? */
export function airedThatDay(r) {
  if (!r.airYear) return false;
  const colls = r.collections || [];
  if (colls.some((c) => SKIP_COLLECTIONS.has(c))) return false;
  // A title naming some other year ("…1970 : CSPAN2 : 2021") is a later upload or re-air.
  const otherYears = (String(r.title).match(/\b(19[0-9]{2}|20[0-3][0-9])\b/g) || []).map(Number).filter((y) => y !== r.airYear);
  if (otherYears.length) return false;
  // …or some other day ("GOP Women November 11, 1993" filed under November 3).
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(r.airDate || '');
  if (m) {
    const re = new RegExp(`\\b(${MONTHS_LONG.join('|')}|${MONTHS_ABBR.join('|')})\\.? (\\d{1,2})\\b`, 'gi');
    for (const [, mon, day] of String(r.title).matchAll(re)) {
      const idx = MONTHS_LONG.findIndex((x) => x.toLowerCase() === mon.toLowerCase()) + 1 || MONTHS_ABBR.findIndex((x) => x.toLowerCase() === mon.toLowerCase()) + 1;
      if (idx !== +m[1] || +day !== +m[2]) return false;
    }
  }
  if (datedInTitle(r)) return true;
  return colls.some((c) => AIRDATE_COLLECTIONS.test(c));
}

// ---------------------------------------------------------------- historical relevance
const STOPWORDS = new Set('the and for with from that this into over under after before about their there which while where when what were was are has have had his her its they them then than been being also more most other some such only very will would could should shall upon onto within without against during between among through across around until since part show episode series live news video film reel reels tape recording broadcast television station channel complete partial most united states american national first second third years year day days november october september december january february march april june july august'.split(' '));
const NEWS_WORDS = /\b(news(reel|cast|film|room)?|bulletin|special report|report|press conference|briefing|speech|address(es)?|election|campaign|debate|inaugurat\w*|summit|launch|mission|apollo|gemini|shuttle|war|vietnam|president\w*|senate|congress|governor|mayor|funeral|assassinat\w*|protest|riot|strike|crisis|treaty|coverage|documentary|interview)\b/i;
const ENTERTAINMENT_WORDS = /\b(price is right|game show|wheel of fortune|jeopardy|general hospital|soap|sitcom|cartoon|bodies in motion|aerobic|exercise|workout|talk show|regis|sally jessy|donahue|oprah|music video|concert)\b/i;
const SPORTS_WORDS = /\b(football|soccer|baseball|basketball|hockey|volleyball|varsity|bowling|wrestling|game of the week|district final|sectional|semi ?final|playoffs?|vs\.?)\b/i;
const HISTORY_COLLECTIONS = /^(universal_newsreels|tvnews|ublangsdale|nasa|gov\.archives.*|.*presidential.*|cspan.*)$/;

const tokens = (text) => new Set((String(text || '').toLowerCase().match(/[a-z][a-z'.-]{3,}/g) || [])
  .map((w) => w.replace(/['.-]+$/, '').replace(/'s$/, '')).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));

/** Which of the day's headlines (same year) this item is about, if any. */
export function headlineMatch(r, headlines) {
  const mine = tokens(`${r.title} ${r.description || ''}`);
  let best = null;
  for (const h of headlines) {
    const shared = [...tokens(h.text)].filter((w) => mine.has(w));
    if (shared.length >= 2 && (!best || shared.length > best.shared.length)) best = { headline: h.text, shared };
  }
  return best;
}

/** How historically important an item looks: news and the day's big stories first. */
export function historyScore(r, headlines = []) {
  let score = 0;
  const text = `${r.title} ${r.description || ''}`;
  const match = headlineMatch(r, headlines);
  if (match) score += 40 + Math.min(20, (match.shared.length - 2) * 5);
  const colls = r.collections || [];
  if (colls.some((c) => HISTORY_COLLECTIONS.test(c))) score += 25;
  else if (colls.includes('newsandpublicaffairs')) score += 8; // broad: lots of community uploads
  if (SPORTS_WORDS.test(r.title)) return score - 25; // a game is not the news, whatever it's filed under
  if (NEWS_WORDS.test(r.title)) score += 20;
  else if (NEWS_WORDS.test(r.description || '')) score += 8;
  if (ENTERTAINMENT_WORDS.test(text)) score -= 15;
  // Foreign-language programming still airs, but English-language news leads.
  if (/tagesschau|\bin korean\b|[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/i.test(text)) score -= 12;
  return score;
}

/** Box sets and season dumps aren't one day's broadcast. */
export function looksLikeMeeting(title) {
  return /\b(board|council|committee|commission|selectmen|trustees|planning)\b.*\bmeeting\b|\bmeeting\b.*\b(board|council|committee)\b/i.test(String(title || ''));
}

export function looksLikeCompilation(title) {
  return /\b(complete (series|season)|season \d+|seasons?\s*\d+\s*[-–]|series \d+\s*[-–]\s*\d+|collection|compilation|vol(ume)?\.?\s*\d+|box set|\d{4}\s*[-–]\s*\d{2,4}\)|laserdisc|vhs tape|dvd transfer|tv season)\b/i.test(String(title || ''));
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

  if (o.mode === 'exact') return programExactDay(key, mm, dd, o, rand, limit, log);

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
  return finish(key, mm, dd, o, channels, library);
}

function finish(key, mm, dd, o, channels, library) {
  const report = [];
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
      titles: c.programs.map((p) => `${p.history >= 40 ? '★ ' : p.category === 'news' ? '• ' : '  '}${p.title}${p.airDate ? ` (${p.airDate})` : ''}`) });
    return { number, name, tagline: TAGLINES[i % TAGLINES.length], year: c.year, entries };
  });

  if (!draftChannels.length) return { compiled: null, warnings: ['No year had playable programming for this date.'], report };
  const draft = normalizeDraft(key, { title: `This Day in History — ${prettyDate(mm, dd)}`, channels: draftChannels });
  const { compiled, warnings } = compile(draft, library, { target: 'web' });
  compiled.generatedBy = 'autopilot';
  compiled.options = { mode: o.mode, rights: o.mode === 'exact' ? 'any' : o.rights, adRights: o.adRights };
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

// ---------------------------------------------------------------- exact-date mode
// Everything on air aired on this exact date. One range search finds every
// candidate across all years; years are ranked by how much they have.
async function programExactDay(key, mm, dd, o, rand, limit, log) {
  log(`${key}: finding everything that aired on ${prettyDate(mm, dd)}, ${o.from}–${o.to}`);
  const [range, news] = await Promise.all([
    limit(() => searchByDate({ mm, dd, from: o.from, to: o.to, limit: 1000, rows: 400 })),
    onThisDay({ mm, dd, from: o.from, to: o.to }).catch(() => ({ results: [] })),
  ]);
  const candidates = range.results.filter((r) =>
    r.score > 0 // drops mis-dated feature films and rips
    && !r.collections?.includes('feature_films')
    && airedThatDay(r)
    && !looksLikeJunk(r.title)
    && !looksLikeMeeting(r.title)
    && !looksLikeCompilation(r.title));
  // Date in the title or identifier is strong evidence; a bare `date` field is
  // sometimes just when it was uploaded.
  const evidence = (r) => (r.strategies.includes('identifier') || r.strategies.includes('title') ? 2 : 1);
  const byYear = new Map();
  for (const r of candidates) {
    if (!byYear.has(r.airYear)) byYear.set(r.airYear, []);
    byYear.get(r.airYear).push(r);
  }
  const years = [...byYear.entries()]
    .map(([year, list]) => {
      const headlines = news.results.filter((e) => e.year === year);
      list.forEach((r) => { r.history = historyScore(r, headlines); });
      // Most historically relevant first, then strongest date evidence.
      list.sort((a, b) => b.history - a.history || evidence(b) - evidence(a) || b.score - a.score);
      const topHistory = list.slice(0, 3).reduce((s, r) => s + Math.max(0, r.history), 0);
      return { year, list, headlines, weight: topHistory + headlines.length * 5 + list.reduce((s, r) => s + evidence(r), 0) };
    })
    .sort((a, b) => b.weight - a.weight || a.year - b.year);
  log(`${key}: ${candidates.length} exact-date items across ${years.length} years`);

  // Most important years first, at most 3 per decade so the dial still spans eras.
  // Years whose best item is entertainment or sports go to the back of the line.
  const perDecade = Math.max(3, Math.ceil(o.channels / 4));
  const used = new Map();
  const ordered = [];
  const rest = [];
  for (const y of [...years].sort((a, b) => (b.list[0].history > 0) - (a.list[0].history > 0) || b.weight - a.weight)) {
    const d = Math.floor(y.year / 10) * 10;
    if ((used.get(d) || 0) < perDecade) {
      used.set(d, (used.get(d) || 0) + 1);
      ordered.push(y);
    } else rest.push(y);
  }
  ordered.push(...rest); // only reached if the capped picks run out

  const channels = [];
  const library = [];
  for (const y of ordered) {
    if (channels.length >= o.channels) break;
    const programs = await fillExact(y, o, limit);
    const minutes = programs.reduce((s, p) => s + p.segments.reduce((t, g) => t + g.duration, 0), 0) / 60;
    if (minutes < o.minMinutes) {
      log(`${key}: ${y.year} skipped (${programs.length ? `only ${minutes.toFixed(1)} min` : 'no playable video'})`);
      continue;
    }
    const ads = await fillAds(y.year, o, limit, rand);
    library.push(...programs, ...ads);
    channels.push({ year: y.year, programs, ads, headlines: y.headlines });
  }
  return finish(key, mm, dd, o, channels, library);
}

async function fillExact(y, o, limit) {
  const picked = [];
  const seen = new Set();
  let seconds = 0;
  const full = () => seconds >= o.targetMinutes * 60 || picked.length >= o.maxPrograms;
  for (let i = 0; i < y.list.length && !full(); i += o.concurrency) {
    const batch = y.list.slice(i, i + o.concurrency);
    const metas = await Promise.all(batch.map((r) => limit(() => getItem(r.identifier)).catch(() => null)));
    batch.forEach((r, j) => {
      const file = metas[j] && bestFile(metas[j]);
      if (!file || file.length < 20 || file.length > o.maxExactMinutes * 60 || full()) return;
      // Same show twice on one day is almost always two uploads of one episode.
      const { base, part } = titleKey(r.title);
      const show = base.split(' ').slice(0, 4).join(' ');
      if (seen.has(`${base}|${part}`) || seen.has(`show:${show}`)) return;
      seen.add(`${base}|${part}`);
      seen.add(`show:${show}`);
      const category = categoryFor(r) === 'program' && r.history >= 20 ? 'news' : categoryFor(r);
      const item = toLibraryItem(r, metas[j], file, { category, year: y.year });
      item.history = r.history;
      picked.push(item);
      seconds += file.length;
    });
  }
  return picked;
}
