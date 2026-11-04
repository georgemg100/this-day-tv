// Lineup drafts -> the compiled broadcast the Roblox game reads.
//
// Draft (editable, saved per MM-DD):
//   { date, title, channels: [{ id, number, name, tagline, year, entries: [Entry] }] }
//   `year` locks a channel to one year: auto-build only uses that year's
//   clips and headlines, and players show that year on screen.
//   Entry = { id, type: 'segment', libraryId, segment }
//         | { id, type: 'card', style, title, text, year, duration }
//
// Compiled (target 'roblox' → DataStore, see roblox/src/shared/Broadcast.luau;
//           target 'web' → web/schedules/MM-DD.json, see web/js/broadcast.js):
//   { format: 1, date, title, publishedAt,
//     channels: [{ number, name, tagline, year, totalDuration, items: [Item] }] }
//   Item = { kind: 'video'|'audio', assetId (roblox) | src + start (web), duration, title, year, airDate, category, part, parts, credit }
//        | { kind: 'card', style, duration, title, text, year }

import { HttpError } from './config.js';
import { newId } from './store.js';
import { prettyDate, parseMMDD } from './dates.js';

export const CARD_STYLES = ['station-id', 'headline', 'break', 'sign-off', 'custom'];
export const CATEGORIES = ['program', 'news', 'commercial', 'psa', 'station-id'];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const str = (v, max) => String(v ?? '').slice(0, max);

export function emptyDraft(key) {
  const { mm, dd } = parseMMDD(key);
  return {
    date: key,
    title: `This Day in History — ${prettyDate(mm, dd)}`,
    // Each channel has its own broadcast year: everything on it comes from that year.
    channels: [{ id: newId('ch'), number: 4, name: 'WTDI', tagline: 'Your window to yesterday', year: null, entries: [] }],
    updatedAt: null,
  };
}

/** Validate + clean a draft coming from the browser. */
export function normalizeDraft(key, input) {
  if (!input || !Array.isArray(input.channels)) throw new HttpError(400, 'draft.channels must be an array');
  const seen = new Set();
  const channels = input.channels.map((ch, i) => {
    const number = Math.round(Number(ch.number));
    if (!(number >= 2 && number <= 83)) throw new HttpError(400, `channel ${i + 1}: number must be 2–83`);
    if (seen.has(number)) throw new HttpError(400, `channel number ${number} is used twice`);
    seen.add(number);
    const entries = (Array.isArray(ch.entries) ? ch.entries : []).map((e) => {
      if (e.type === 'segment') {
        if (!e.libraryId) throw new HttpError(400, 'segment entry is missing libraryId');
        return { id: e.id || newId('e'), type: 'segment', libraryId: String(e.libraryId), segment: Math.max(0, Math.round(Number(e.segment) || 0)) };
      }
      if (e.type === 'card') {
        return {
          id: e.id || newId('e'),
          type: 'card',
          style: CARD_STYLES.includes(e.style) ? e.style : 'custom',
          title: str(e.title, 80),
          text: str(e.text, 400),
          year: e.year ? Math.round(Number(e.year)) || null : null,
          duration: clamp(Number(e.duration) || 8, 3, 60),
        };
      }
      throw new HttpError(400, `unknown entry type ${e.type}`);
    });
    let year = null;
    if (ch.year !== null && ch.year !== undefined && ch.year !== '') {
      year = Math.round(Number(ch.year));
      if (!(year >= 1890 && year <= 2100)) throw new HttpError(400, `channel ${number}: year looks wrong`);
    }
    return {
      id: ch.id || newId('ch'),
      number,
      year,
      name: str(ch.name || `CH ${number}`, 24),
      tagline: str(ch.tagline, 80),
      entries,
    };
  });
  return { date: key, title: str(input.title, 100) || emptyDraft(key).title, channels, updatedAt: new Date().toISOString() };
}

const card = (style, title, text, duration, year = null) => ({ id: newId('e'), type: 'card', style, title, text, duration, year });

/**
 * Lay out a channel like a real broadcast day: station ID, then each program
 * (oldest first) introduced by a headline from its year, its parts separated
 * by commercial breaks, and a sign-off before the loop restarts.
 */
export function autoBuild({ key, channel, library, programIds = [], commercialIds = [], headlines = [], adsPerBreak = 2, year = null }) {
  const { mm, dd } = parseMMDD(key);
  const byId = new Map(library.map((i) => [i.id, i]));
  // With a broadcast year, everything must come from that year.
  const inYear = (y) => !year || y === year;
  // Evening order: news before programs; within each, what aired on this very
  // date first, then the nearest dates.
  const CATEGORY_ORDER = { news: 0, 'station-id': 0, program: 1, psa: 2 };
  const daysOff = (i) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(i.airDate || '');
    return m ? Math.abs(Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+m[1], mm - 1, dd)) / 86400000 : 9999;
  };
  const programs = programIds.map((id) => byId.get(id)).filter((i) => i && i.segments?.length && inYear(i.year))
    .sort((a, b) => (a.year || 0) - (b.year || 0)
      || (CATEGORY_ORDER[a.category] ?? 1) - (CATEGORY_ORDER[b.category] ?? 1)
      || daysOff(a) - daysOff(b));
  const ads = commercialIds.map((id) => byId.get(id)).filter((i) => i && i.segments?.length && inYear(i.year));
  headlines = headlines.filter((h) => inYear(h.year));
  const day = year ? `${prettyDate(mm, dd)}, ${year}` : prettyDate(mm, dd);
  let adCursor = 0;
  const pushBreak = (entries) => {
    if (!ads.length) return;
    for (let n = 0; n < adsPerBreak; n++) {
      const ad = ads[adCursor++ % ads.length];
      ad.segments.forEach((_, s) => entries.push({ id: newId('e'), type: 'segment', libraryId: ad.id, segment: s }));
    }
  };

  const pending = new Map();
  for (const h of headlines) {
    if (!pending.has(h.year)) pending.set(h.year, []);
    pending.get(h.year).push(h);
  }
  const headlineCard = (h) => card('headline', `${prettyDate(mm, dd)}, ${h.year}`,
    str(h.kind === 'death' ? `Died today: ${h.text}` : h.text, 400), 10, h.year);

  const entries = [card('station-id', `${channel.name} · CHANNEL ${channel.number}`,
    year ? `Good evening. It's ${day}. Stay tuned.` : `Now presenting ${day}, as it was seen on television. Stay tuned.`, 8, year)];

  programs.forEach((p) => {
    const h = pending.get(p.year)?.shift();
    if (h) entries.push(headlineCard(h));
    p.segments.forEach((_, s) => {
      entries.push({ id: newId('e'), type: 'segment', libraryId: p.id, segment: s });
      if (s < p.segments.length - 1 && ads.length) {
        entries.push(card('break', "We'll be right back", 'Stay tuned!', 4));
        pushBreak(entries);
      }
    });
    pushBreak(entries);
  });

  const leftovers = [...pending.values()].flat().sort((a, b) => a.year - b.year).slice(0, 8);
  if (leftovers.length) {
    entries.push(card('custom', 'News Roundup', year ? `More of the news on ${day}…` : `Elsewhere on ${day}…`, 5, year));
    leftovers.forEach((h) => entries.push(headlineCard(h)));
  }
  if (!programs.length && ads.length) pushBreak(entries);

  entries.push(card('sign-off', 'That concludes our broadcast day',
    `${channel.name} thanks you for watching. Our programming will now repeat.`, 8, year));
  return entries;
}

const isAd = (i) => i.kind !== 'card' && i.category === 'commercial';

/**
 * Skipped (not yet uploaded) parts leave orphaned "We'll be right back" cards
 * and doubled-up ads behind. Keep a break card only when it really sits
 * between two parts of the same program, and collapse back-to-back repeats of
 * the same commercial. Mutates and strips the internal `_lib` marker.
 */
export function tidyBreaks(items) {
  const content = (from, step) => {
    for (let j = from; j >= 0 && j < items.length; j += step) {
      const it = items[j];
      if (isAd(it) || (it.kind === 'card' && it.style === 'break')) continue;
      return it;
    }
    return null;
  };
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'card' && it.style === 'break') {
      const prev = content(i - 1, -1);
      const next = content(i + 1, 1);
      if (!(prev?._lib && prev._lib === next?._lib)) items.splice(i, 1);
    }
  }
  // Same clip = same library item and part (falls back to asset id / stream position).
  const clipKey = (it) => (it._lib ? `${it._lib}:${it.part}` : it.assetId ?? `${it.src}@${it.start}`);
  for (let i = items.length - 1; i > 0; i--) {
    if (isAd(items[i]) && isAd(items[i - 1]) && clipKey(items[i]) === clipKey(items[i - 1])) items.splice(i, 1);
  }
  for (const it of items) delete it._lib;
  return items;
}

/** Turn a draft into the broadcast the game plays. Unuploaded segments are skipped with a warning. */
const archiveDownloadUrl = (identifier, file) =>
  `https://archive.org/download/${encodeURIComponent(identifier)}/${String(file).split('/').map(encodeURIComponent).join('/')}`;

/**
 * Where the website can stream a segment from. Streamed items carry src/start;
 * downloaded archive.org items can also stream from the original file, at the
 * same position in the source.
 */
export function webSource(lib, seg) {
  if (seg.src) return { src: seg.src, start: seg.start ?? 0 };
  if (lib.source?.type === 'archive' && lib.source.identifier && lib.source.file) {
    return { src: archiveDownloadUrl(lib.source.identifier, lib.source.file), start: seg.sourceStart ?? 0 };
  }
  if (lib.source?.type === 'url' && lib.source.url) return { src: lib.source.url, start: seg.sourceStart ?? 0 };
  return null;
}

export const TARGETS = ['web', 'roblox'];

/**
 * Turn a draft into the broadcast a player reads. target 'web' streams from
 * archive.org (src/start); target 'roblox' needs uploaded asset IDs. Entries
 * the target can't play are skipped with a warning.
 */
export function compile(draft, library, { publishedAt = new Date().toISOString(), target = 'roblox' } = {}) {
  const byId = new Map(library.map((i) => [i.id, i]));
  const warnings = [];
  const channels = [];
  for (const ch of draft.channels) {
    const items = [];
    for (const e of ch.entries) {
      if (e.type === 'card') {
        items.push({ kind: 'card', style: e.style, duration: e.duration, title: e.title, text: e.text, year: e.year || null });
        continue;
      }
      const lib = byId.get(e.libraryId);
      const seg = lib?.segments?.[e.segment];
      if (!lib || !seg) {
        warnings.push(`CH ${ch.number}: an entry points at a deleted library item — removed`);
        continue;
      }
      const label = `${lib.title}${lib.segments.length > 1 ? ` (part ${e.segment + 1}/${lib.segments.length})` : ''}`;
      if (!(seg.duration > 0)) {
        warnings.push(`CH ${ch.number}: "${label}" has no duration — skipped`);
        continue;
      }
      if (ch.year && lib.year && lib.year !== ch.year) {
        warnings.push(`CH ${ch.number}: "${label}" is from ${lib.year}, not ${ch.year}`);
      }
      let playable;
      if (target === 'web') {
        const ws = webSource(lib, seg);
        if (!ws) {
          warnings.push(`CH ${ch.number}: "${label}" exists only as a Roblox asset, so the website can't stream it — skipped`);
          continue;
        }
        playable = { src: ws.src, start: Math.round(ws.start * 1000) / 1000 };
      } else {
        if (!seg.assetId) {
          warnings.push(lib.delivery === 'stream'
            ? `CH ${ch.number}: "${label}" is streamed (website only) — skipped on Roblox`
            : `CH ${ch.number}: "${label}" is not uploaded to Roblox yet — skipped`);
          continue;
        }
        playable = { assetId: String(seg.assetId) };
      }
      items.push({
        _lib: lib.id,
        kind: lib.kind === 'audio' ? 'audio' : 'video',
        ...playable,
        duration: Number(seg.duration),
        title: lib.title,
        year: lib.year || null,
        airDate: lib.airDate || null,
        category: lib.category || 'program',
        part: e.segment + 1,
        parts: lib.segments.length,
        credit: lib.credit || null,
      });
    }
    tidyBreaks(items);
    if (!items.length) {
      warnings.push(`CH ${ch.number} has nothing playable and was left off the air`);
      continue;
    }
    const totalDuration = Number(items.reduce((s, i) => s + i.duration, 0).toFixed(3));
    channels.push({ number: ch.number, name: ch.name, tagline: ch.tagline, year: ch.year || null, totalDuration, items });
  }
  return {
    compiled: { format: 1, target, date: draft.date, title: draft.title, publishedAt, channels },
    warnings,
  };
}

/** Robux still needed to get every video in the draft on the air. */
export function uploadCost(draft, library, price) {
  const byId = new Map(library.map((i) => [i.id, i]));
  const pending = new Set();
  for (const ch of draft.channels) {
    for (const e of ch.entries) {
      if (e.type !== 'segment') continue;
      const lib = byId.get(e.libraryId);
      const seg = lib?.segments?.[e.segment];
      if (lib?.kind === 'video' && lib.delivery !== 'stream' && seg && !seg.assetId) pending.add(`${lib.id}:${e.segment}`);
    }
  }
  return { videosToUpload: pending.size, robux: pending.size * price };
}
