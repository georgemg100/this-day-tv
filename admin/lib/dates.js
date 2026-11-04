import { HttpError } from './config.js';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const pad2 = (n) => String(n).padStart(2, '0');

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Parse "MM-DD" (the station's year-agnostic day key). */
export function parseMMDD(s) {
  const m = /^(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new HttpError(400, 'date must look like MM-DD');
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > DAYS_IN_MONTH[mm - 1]) {
    throw new HttpError(400, `invalid date ${s}`);
  }
  return { mm, dd, key: `${pad2(mm)}-${pad2(dd)}` };
}

/** Years in [from, to] on which MM-DD exists (drops Feb 29 in non-leap years). */
export function validYears(mm, dd, from, to) {
  const years = [];
  for (let y = from; y <= to; y++) {
    if (mm === 2 && dd === 29 && !isLeap(y)) continue;
    years.push(y);
  }
  return years;
}

/** Ways a date is commonly written in archive.org titles/descriptions. */
export function dateForms(y, mm, dd) {
  const month = MONTHS[mm - 1];
  return [
    `${month} ${dd}, ${y}`,
    `${MONTH_ABBR[mm - 1]} ${dd}, ${y}`,
    `${dd} ${month} ${y}`,
    `${y}/${pad2(mm)}/${pad2(dd)}`,
  ];
}

export function prettyDate(mm, dd) {
  return `${MONTHS[mm - 1]} ${dd}`;
}

function zonedParts(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
}

export function todayMMDD(tz, date = new Date()) {
  const p = zonedParts(tz, date);
  return `${p.month}-${p.day}`;
}

/** UTC offset of `tz` at `date`, in minutes (e.g. -300 for EST). */
export function utcOffsetMinutes(tz, date = new Date()) {
  const p = zonedParts(tz, date);
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "mm:ss" / "h:mm:ss" / plain seconds -> seconds. Returns null for blank. */
export function parseClock(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n)) || parts.length > 3) {
    throw new HttpError(400, `bad time "${value}" (use mm:ss)`);
  }
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatClock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
