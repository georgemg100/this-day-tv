// Pure broadcast math (no DOM): station day, schedule validation, and
// "what's on channel N right now". Mirrors roblox/src/shared/Broadcast.luau.
//
// Each channel is a loop anchored to local midnight of the station day, so
// everyone who opens the page sees the same moment of the same broadcast.
// Times are unix seconds (floats).

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad2 = (n) => String(n).padStart(2, '0');
const formatters = new Map();

function zonedParts(tz, ms) {
  let dtf = formatters.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, dtf);
  }
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

/** Offset of `tz` from UTC at unix time `t`, in seconds (e.g. -18000 for EST). */
export function utcOffsetSeconds(tz, t) {
  const ms = Math.floor(t) * 1000;
  const p = zonedParts(tz, ms);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms) / 1000;
}

/** The station's calendar day at `t`, and the unix time of its local midnight. */
export function stationDay(t, tz) {
  const p = zonedParts(tz, t * 1000);
  const midnightAsUTC = Date.UTC(p.year, p.month - 1, p.day) / 1000;
  // Offset can differ between midnight and now on DST-change days: resolve twice.
  let anchor = midnightAsUTC - utcOffsetSeconds(tz, t);
  anchor = midnightAsUTC - utcOffsetSeconds(tz, anchor);
  return { key: `${pad2(p.month)}-${pad2(p.day)}`, month: p.month, day: p.day, year: p.year, anchor };
}

/** "8:05 PM" in the station's timezone. */
export function localClock(t, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(t * 1000));
}

const KINDS = new Set(['video', 'audio', 'card']);
const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : null);

/** Defensive copy of a schedule file. Drops bad items and recomputes totals. */
export function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.channels)) return null;
  const channels = [];
  for (const ch of raw.channels) {
    if (!ch || !Array.isArray(ch.items)) continue;
    const items = [];
    for (const it of ch.items) {
      if (!it || !KINDS.has(it.kind)) continue;
      const duration = num(it.duration);
      if (!(duration > 0)) continue;
      const src = typeof it.src === 'string' && /^https?:\/\//i.test(it.src) ? it.src : null;
      if (it.kind !== 'card' && !src) continue;
      items.push({
        kind: it.kind,
        duration,
        src,
        start: Math.max(0, num(it.start) || 0),
        title: str(it.title, 120),
        text: str(it.text, 400),
        style: str(it.style, 20),
        year: num(it.year),
        airDate: str(it.airDate, 10),
        category: str(it.category, 20),
        part: num(it.part),
        parts: num(it.parts),
        credit: str(it.credit, 120),
      });
    }
    if (!items.length) continue;
    channels.push({
      number: num(ch.number) ?? channels.length + 2,
      name: str(ch.name, 24) || 'TV',
      tagline: str(ch.tagline, 80),
      year: num(ch.year),
      totalDuration: items.reduce((s, i) => s + i.duration, 0),
      items,
    });
  }
  if (!channels.length) return null;
  channels.sort((a, b) => a.number - b.number);
  return { format: num(raw.format) || 1, date: str(raw.date, 5) || '', title: str(raw.title, 100), channels };
}

/** What's on `channel` at `t`: { index, offset (s into item), startedAt (unix s) }. */
export function locate(channel, t, anchor) {
  const total = channel.totalDuration;
  const elapsed = (((t - anchor) % total) + total) % total;
  const loopStart = t - elapsed;
  let acc = 0;
  for (let i = 0; i < channel.items.length; i++) {
    const d = channel.items[i].duration;
    if (elapsed < acc + d) return { index: i, offset: elapsed - acc, startedAt: loopStart + acc };
    acc += d;
  }
  const last = channel.items.length - 1;
  return { index: last, offset: 0, startedAt: loopStart + total - channel.items[last].duration };
}

/** The current item and the next `count - 1`, with start times. */
export function upcoming(channel, t, anchor, count) {
  let { index, startedAt } = locate(channel, t, anchor);
  const out = [];
  for (let n = 0; n < Math.min(count, channel.items.length); n++) {
    const item = channel.items[index];
    out.push({ item, startsAt: startedAt });
    startedAt += item.duration;
    index = (index + 1) % channel.items.length;
  }
  return out;
}

/**
 * Free fallback: Wikipedia "On this day" events and deaths as headline cards.
 * Each channel is one year (the years with the most to report), so nothing
 * on a channel mixes years.
 */
export function headlineSchedule(entries, day, { from = 1960, to = 1999, name = 'WTDI', maxChannels = 3 } = {}) {
  const byYear = new Map();
  for (const e of entries || []) {
    if (typeof e.year !== 'number' || e.year < from || e.year > to || typeof e.text !== 'string') continue;
    if (!byYear.has(e.year)) byYear.set(e.year, []);
    byYear.get(e.year).push(e);
  }
  const years = [...byYear.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).slice(0, maxChannels);
  if (!years.length) return null;
  const dateText = `${MONTHS[day.month - 1]} ${day.day}`;
  const numbers = [4, 7, 11, 2, 9, 13];
  const callsigns = [name, 'WKTV', 'WNTW', 'WABC', 'WOR', 'WPIX'];
  const channels = years.sort((a, b) => a[0] - b[0]).map(([year, list], n) => {
    const number = numbers[n % numbers.length];
    const callsign = callsigns[n % callsigns.length];
    const items = [{ kind: 'card', style: 'station-id', duration: 8, title: `${callsign} · CHANNEL ${number}`, text: `Good evening. It's ${dateText}, ${year}. Here is the news.`, year }];
    list.sort((a, b) => (a.kind === 'death') - (b.kind === 'death')).forEach((e, i) => {
      items.push({ kind: 'card', style: 'headline', duration: 12, title: `${dateText}, ${year}`, text: (e.kind === 'death' ? `Died today: ${e.text}` : e.text).slice(0, 400), year });
      if ((i + 1) % 4 === 0 && i < list.length - 1) items.push({ kind: 'card', style: 'break', duration: 4, title: "We'll be right back", text: 'Stay tuned!' });
    });
    items.push({ kind: 'card', style: 'sign-off', duration: 8, title: 'That concludes our news', text: `${callsign} thanks you for watching. Headlines courtesy of Wikipedia.`, year });
    return { number, name: callsign, tagline: `News of ${year}`, year, items };
  });
  return sanitize({ format: 1, date: day.key, title: `Headlines — ${dateText}`, channels });
}
