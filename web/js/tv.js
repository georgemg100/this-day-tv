// This Day TV — web player. Streams archive.org media straight into the page,
// tuned to a shared clock so every viewer sees the same moment of the same day.
import * as B from './broadcast.js';
import { mountSupport } from './support.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_STATION = { name: 'This Day TV', timezone: 'America/New_York', yearFrom: 1960, yearTo: 1999, channelName: 'WTDI' };
const LOAD_TIMEOUT_MS = 15000;
const RESYNC_SECONDS = 2.5;
const PRELOAD_SECONDS = 12;
const LOWER_THIRD_MS = 7000;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* storage unavailable */ } },
};

const state = {
  station: DEFAULT_STATION,
  clockOffset: 0, // seconds to add to Date.now() (from the host's Date header)
  day: null,
  schedule: null,
  source: 'none', // 'published' | 'headlines' | 'none'
  channelIdx: 0,
  current: null, // identity of what's on screen
  item: null,
  startedAt: 0,
  token: 0,
  on: false,
  muted: store.get('tdtv-muted') === '1',
  loading: false,
};
const headlineCache = new Map();
const params = new URLSearchParams(location.search);
const linkedChannel = Number(params.get('ch')) || null; // ?ch=9 tunes straight to channel 9

// Viewer support: entry points, the pledge card, and a weekly reminder that
// only ever appears over a commercial break.
const support = mountSupport({
  store,
  canNudge: () => state.on && $('guide').hidden && $('lower').hidden && !!state.item
    && (state.item.category === 'commercial' || (state.item.kind === 'card' && state.item.style === 'break')),
});

const now = () => Date.now() / 1000 + state.clockOffset;
const tz = () => state.station.timezone;
const channels = () => state.schedule?.channels || [];
const channel = () => channels()[state.channelIdx] || null;

// ------------------------------------------------------------------ video pair
// Two <video> elements: one on air, one preloading the next item, so cuts
// between programs and commercials don't sit on a black screen.
const videos = [$('vA'), $('vB')];
let liveIdx = 0;
const liveVideo = () => videos[liveIdx];
const spareVideo = () => videos[1 - liveIdx];

function setSrc(v, src) {
  if (v.dataset.src === src) return;
  v.dataset.src = src;
  v.src = src;
}
function clearSrc(v) {
  v.pause();
  if (!v.dataset.src) return;
  delete v.dataset.src;
  v.removeAttribute('src');
  v.load();
}
function showLive(v) {
  liveIdx = videos.indexOf(v);
  videos.forEach((x) => x.classList.toggle('live', x === v));
}
function stopMedia() {
  videos.forEach((v) => { v.pause(); v.classList.remove('live'); });
}

/** Resolve once the element knows its duration/seekable range. */
function whenReady(v, token) {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 1) return resolve();
    const timer = setTimeout(() => done(new Error('timeout')), LOAD_TIMEOUT_MS);
    const poll = setInterval(() => { if (token !== state.token) done(new Error('superseded')); }, 250);
    function done(err) {
      clearTimeout(timer);
      clearInterval(poll);
      v.removeEventListener('loadedmetadata', ok);
      v.removeEventListener('error', fail);
      err ? reject(err) : resolve();
    }
    const ok = () => done();
    const fail = () => done(new Error('media error'));
    v.addEventListener('loadedmetadata', ok);
    v.addEventListener('error', fail);
  });
}

// ------------------------------------------------------------------ layers
const layers = ['radio', 'card', 'pattern'].map($);
function hideLayers() {
  layers.forEach((l) => { l.hidden = true; });
  $('lower').hidden = true;
  $('credit').textContent = '';
}

function showCard(style, kicker, title, body) {
  hideLayers();
  const card = $('card');
  card.dataset.style = style || 'custom';
  $('cardKicker').textContent = kicker || '';
  $('cardTitle').textContent = title || '';
  $('cardBody').textContent = body || '';
  $('cardFoot').textContent = support.cardFoot(style);
  card.hidden = false;
}

function showPattern(sub) {
  hideLayers();
  $('patternSub').textContent = sub;
  $('pattern').hidden = false;
}

function setBug(text) {
  $('bug').hidden = !text;
  $('bug').textContent = text || '';
}

let lowerTimer = 0;
function lowerThird(item) {
  if (item.category === 'commercial') return;
  const sub = [];
  const when = longDate(item);
  if (when) sub.push(item.airDate ? `Originally broadcast ${when}` : when);
  if (item.parts > 1) sub.push(`Part ${item.part} of ${item.parts}`);
  $('lowerTitle').textContent = item.title || '';
  $('lowerSub').textContent = sub.join('  ·  ');
  $('lower').hidden = false;
  clearTimeout(lowerTimer);
  lowerTimer = setTimeout(() => { $('lower').hidden = true; }, LOWER_THIRD_MS);
}

function longDate(item) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.airDate || '');
  if (m) return `${B.MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  return item.year ? String(item.year) : '';
}

function dayLabel(year) {
  if (!state.day) return '';
  const base = `${B.MONTHS_SHORT[state.day.month - 1]} ${state.day.day}`;
  return year ? `${base}, ${year}` : base;
}

// ------------------------------------------------------------------ snow
const snowCanvas = $('static');
const snowCtx = snowCanvas.getContext('2d');
let audioCtx = null;
function snow(ms) {
  snowCanvas.hidden = false;
  const until = performance.now() + ms;
  const img = snowCtx.createImageData(snowCanvas.width, snowCanvas.height);
  const frame = () => {
    if (performance.now() >= until) {
      snowCanvas.hidden = true;
      return;
    }
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    snowCtx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  };
  frame();
  hiss(ms);
}
function hiss(ms) {
  if (state.muted || !audioCtx) return;
  try {
    const len = Math.floor(audioCtx.sampleRate * (ms / 1000));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.06;
    src.buffer = buf;
    src.connect(gain).connect(audioCtx.destination);
    src.start();
  } catch { /* audio is a nicety */ }
}

// ------------------------------------------------------------------ tuning
function cardKicker(ch, item) {
  if (item.style === 'station-id') return `Channel ${ch.number}`;
  if (item.style === 'headline') return 'The news of the day';
  return ch.name;
}

function technicalDifficulties(ch) {
  stopMedia();
  showCard('trouble', ch.name, 'Technical difficulties', 'Please stand by. Normal programming will resume shortly.');
}

function tune(ch, item, startedAt) {
  const token = ++state.token;
  state.item = item;
  state.startedAt = startedAt;
  hideLayers();
  if (item.category !== 'commercial' && item.style !== 'break') support.hideNudge();
  updateDial();
  if (!$('guide').hidden) renderGuide();

  if (item.kind === 'card') {
    stopMedia();
    setBug(null);
    showCard(item.style, cardKicker(ch, item), item.title, item.text);
    return;
  }

  setBug(`CH ${ch.number}  ·  ${dayLabel(ch.year || item.year)}`);
  let v;
  if (liveVideo().dataset.src === item.src) v = liveVideo(); // next act of the same file
  else if (spareVideo().dataset.src === item.src) v = spareVideo(); // preloaded
  else {
    v = liveVideo();
    setSrc(v, item.src);
  }
  const other = videos[1 - videos.indexOf(v)];
  other.pause();
  showLive(v);
  if (item.kind === 'audio') {
    $('radioTitle').textContent = item.title || '';
    $('radioSub').textContent = longDate(item);
    $('radio').hidden = false;
  }
  play(v, ch, item, token);
}

async function play(v, ch, item, token) {
  try {
    await whenReady(v, token);
  } catch {
    if (token === state.token) technicalDifficulties(ch);
    return;
  }
  if (token !== state.token) return;
  const into = now() - state.startedAt;
  if (into >= item.duration - 0.3) return;
  const target = item.start + into;
  if (Math.abs(v.currentTime - target) > 0.75) v.currentTime = target;
  v.muted = state.muted;
  try {
    await v.play();
  } catch (err) {
    if (token !== state.token) return;
    if (err.name === 'NotAllowedError') powerOff('Tap to turn the TV back on');
    else if (err.name !== 'AbortError') technicalDifficulties(ch);
    return;
  }
  if (token !== state.token) return;
  if (item.credit) $('credit').textContent = item.credit;
  lowerThird(item);
}

videos.forEach((v) => v.addEventListener('error', () => {
  const item = state.item;
  if (v === liveVideo() && item && item.kind !== 'card' && v.dataset.src === item.src && channel()) technicalDifficulties(channel());
}));

function refresh(force = false) {
  if (!state.on) return;
  const ch = channel();
  if (!ch) {
    if (state.current !== 'off-air') {
      state.current = 'off-air';
      state.item = null;
      state.token++;
      stopMedia();
      setBug(null);
      const when = state.day ? `${B.MONTHS[state.day.month - 1]} ${state.day.day}` : 'today';
      showPattern(`Programming for ${when} has not been scheduled yet.`);
      updateDial();
    }
    return;
  }
  const { index, startedAt } = B.locate(ch, now(), state.day.anchor);
  const item = ch.items[index];
  const key = `${ch.number}|${index}|${Math.round(startedAt)}|${item.src || item.title || ''}`;
  if (force || key !== state.current) {
    state.current = key;
    tune(ch, item, startedAt);
  }
}

/** Keep the picture on the shared clock, and warm up the next item. */
function maintain() {
  const item = state.item;
  const ch = channel();
  if (!item || !ch) return;
  const into = now() - state.startedAt;
  if (item.kind !== 'card') {
    const v = liveVideo();
    if (!v.paused && v.readyState >= 2 && into < item.duration - 1) {
      const expected = item.start + into;
      if (Math.abs(v.currentTime - expected) > RESYNC_SECONDS) v.currentTime = expected;
    }
  }
  if (item.duration - into < PRELOAD_SECONDS) {
    const { index } = B.locate(ch, now(), state.day.anchor);
    const next = ch.items[(index + 1) % ch.items.length];
    if (next.kind !== 'card' && next.src !== liveVideo().dataset.src) {
      const spare = spareVideo();
      if (spare.dataset.src !== next.src) {
        setSrc(spare, next.src);
        spare.addEventListener('loadedmetadata', () => { if (spare.dataset.src === next.src) spare.currentTime = next.start; }, { once: true });
      }
    }
  }
}

// ------------------------------------------------------------------ channels
function updateDial() {
  const ch = channel();
  const item = state.item;
  $('dialChannel').textContent = ch ? `${ch.name} · CH ${ch.number}${ch.year ? ` · ${ch.year}` : ''}` : state.station.name;
  let nowText = 'Off the air';
  if (ch && item) {
    if (item.kind === 'card') nowText = item.title || '';
    else if (item.category === 'commercial') nowText = 'A word from our sponsors';
    else nowText = `${item.title || 'Untitled'}${item.year && item.year !== ch.year ? ` · ${item.year}` : ''}`;
  }
  $('dialNow').textContent = nowText;
  const when = state.day ? `${B.MONTHS[state.day.month - 1]} ${state.day.day}${ch?.year ? `, ${ch.year}` : ''}` : '';
  document.title = when ? `This Day TV — ${when}` : 'This Day TV';
}

function changeChannel(delta) {
  if (!state.on) return;
  const n = channels().length;
  snow(450);
  if (!n) return;
  state.channelIdx = (state.channelIdx + delta + n) % n;
  store.set('tdtv-channel', channel().number);
  refresh(true);
}

function tuneNumber(number) {
  const idx = channels().findIndex((c) => c.number === number);
  if (idx === -1 || !state.on) return snow(300);
  state.channelIdx = idx;
  store.set('tdtv-channel', number);
  snow(450);
  refresh(true);
}

// ------------------------------------------------------------------ schedule loading
async function fetchHeadlines(day) {
  if (headlineCache.has(day.key)) return headlineCache.get(day.key);
  const [mm, dd] = day.key.split('-');
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`);
    const body = res.ok ? await res.json() : null;
    const entries = [...(body?.events || []).map((e) => ({ ...e, kind: 'event' })), ...(body?.deaths || []).map((e) => ({ ...e, kind: 'death' }))];
    const schedule = B.headlineSchedule(entries, day, { from: state.station.yearFrom, to: state.station.yearTo, name: state.station.channelName });
    headlineCache.set(day.key, schedule);
    return schedule;
  } catch {
    return null;
  }
}

async function loadDay() {
  if (state.loading) return;
  state.loading = true;
  try {
    const day = B.stationDay(now(), tz());
    let schedule = null;
    let source = 'none';
    try {
      const res = await fetch(`schedules/${day.key}.json?v=${Math.floor(now() / 60)}`, { cache: 'no-cache' });
      if (res.ok) schedule = B.sanitize(await res.json());
      if (schedule) source = 'published';
    } catch { /* fall through */ }
    if (!schedule) {
      schedule = await fetchHeadlines(day);
      if (schedule) source = 'headlines';
    }
    const keepNumber = channel()?.number ?? linkedChannel ?? Number(store.get('tdtv-channel'));
    state.day = day;
    state.schedule = schedule;
    state.source = source;
    const idx = channels().findIndex((c) => c.number === keepNumber);
    state.channelIdx = idx === -1 ? 0 : idx;
    const years = [...new Set(channels().map((c) => c.year).filter(Boolean))].sort();
    const md = `${B.MONTHS[day.month - 1]} ${day.day}`;
    $('offDate').textContent = years.length > 3
      ? `${md} · ${years.length} channels, ${years[0]} to ${years.at(-1)}`
      : years.length
      ? `${md}, ${years.length === 1 ? years[0] : `${years.slice(0, -1).join(', ')} & ${years.at(-1)}`}`
      : `${B.MONTHS[day.month - 1]} ${day.day} · as it aired, ${state.station.yearFrom}–${state.station.yearTo}`;
    updateDial();
    refresh(); // unchanged items keep playing; changed lineups retune
  } finally {
    state.loading = false;
  }
}

async function syncClock() {
  // Most static hosts send a Date header; trust it only if the device clock is clearly off.
  try {
    const t0 = Date.now();
    const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
    const t1 = Date.now();
    const date = Date.parse(res.headers.get('date') || '');
    if (!Number.isNaN(date)) {
      const offset = (date + 500 - (t0 + t1) / 2) / 1000;
      if (Math.abs(offset) > 2) state.clockOffset = offset;
    }
  } catch { /* keep device clock */ }
}

async function loadStation() {
  try {
    const res = await fetch('station.json', { cache: 'no-cache' });
    if (res.ok) state.station = { ...DEFAULT_STATION, ...(await res.json()) };
  } catch { /* defaults */ }
}

// ------------------------------------------------------------------ power
function powerOn() {
  // Called from a click/tap: unlock media playback with sound for this page.
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
  } catch { /* no web audio */ }
  videos.forEach((v) => { if (!v.dataset.src) v.load(); });
  state.on = true;
  $('off').hidden = true;
  const tube = $('tube');
  tube.classList.remove('on');
  void tube.offsetWidth; // restart the power-on animation
  tube.classList.add('on');
  state.current = null;
  refresh(true);
  $('btnPower').setAttribute('aria-pressed', 'true');
}

function powerOff(hint) {
  state.on = false;
  state.token++;
  state.current = null;
  state.item = null;
  stopMedia();
  videos.forEach(clearSrc);
  hideLayers();
  support.hideNudge();
  setBug(null);
  $('tube').classList.remove('on');
  $('off').hidden = false;
  $('offHint').textContent = hint || 'Turn on the TV (sound on)';
  $('btnPower').setAttribute('aria-pressed', 'false');
  updateDial();
}

function setMuted(m) {
  state.muted = m;
  store.set('tdtv-muted', m ? '1' : '0');
  videos.forEach((v) => { v.muted = m; });
  $('btnMute').textContent = m ? '🔇' : '🔊';
  $('btnMute').setAttribute('aria-pressed', String(m));
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
}

// ------------------------------------------------------------------ guide
function renderGuide() {
  const ch = channel();
  const t = now();
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone: tz(), timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || tz();
  $('guideTz').textContent = `${tzName} (station time)`;
  $('guideKicker').textContent = state.day ? `${B.MONTHS[state.day.month - 1]} ${state.day.day}${state.source === 'headlines' ? ' · headlines only' : ''}` : 'Listings';
  $('guideTitle').textContent = ch ? `On CH ${ch.number} · ${ch.name}${ch.year ? ` · ${ch.year}` : ''}` : 'Nothing scheduled';

  const chBox = $('guideChannels');
  chBox.replaceChildren(...channels().map((c, i) => {
    const { index } = B.locate(c, t, state.day.anchor);
    const it = c.items[index];
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(i === state.channelIdx));
    const num = document.createElement('b');
    num.textContent = c.year ? `CH ${c.number} · ${c.year}` : `CH ${c.number}`;
    const what = document.createElement('span');
    what.textContent = it.category === 'commercial' ? 'Commercial break' : `${it.title || c.name}${it.year ? ` (${it.year})` : ''}`;
    b.append(num, what);
    b.addEventListener('click', () => tuneNumber(c.number));
    return b;
  }));

  const list = $('guideList');
  if (!ch) {
    list.replaceChildren();
    return;
  }
  const rows = [];
  let last = null;
  for (const { item, startsAt } of B.upcoming(ch, t, state.day.anchor, ch.items.length)) {
    if (item.kind === 'card' && item.style === 'break') continue;
    const title = item.category === 'commercial' ? 'Commercials' : item.title || 'Untitled';
    if (title === last) continue;
    last = title;
    rows.push({ title, item, startsAt });
    if (rows.length >= 14) break;
  }
  list.replaceChildren(...rows.map((r, i) => {
    const li = document.createElement('li');
    if (i === 0) li.className = 'now';
    const time = document.createElement('time');
    time.textContent = i === 0 ? 'Now' : B.localClock(r.startsAt, tz());
    const body = document.createElement('div');
    const tt = document.createElement('div');
    tt.className = 't';
    tt.textContent = r.title;
    const sub = document.createElement('div');
    sub.className = 's';
    sub.textContent = [r.item.year, r.item.kind === 'audio' ? 'radio' : r.item.kind === 'card' ? null : r.item.category].filter(Boolean).join(' · ');
    body.append(tt, sub);
    li.append(time, body);
    return li;
  }));
}

function toggleGuide(open = $('guide').hidden) {
  $('guide').hidden = !open;
  if (open) renderGuide();
}

// ------------------------------------------------------------------ input
$('powerOn').addEventListener('click', powerOn);
$('btnPower').addEventListener('click', () => (state.on ? powerOff() : powerOn()));
$('btnUp').addEventListener('click', () => changeChannel(1));
$('btnDown').addEventListener('click', () => changeChannel(-1));
$('btnMute').addEventListener('click', () => setMuted(!state.muted));
$('btnFull').addEventListener('click', toggleFullscreen);
$('btnGuide').addEventListener('click', () => toggleGuide());
$('guideClose').addEventListener('click', () => toggleGuide(false));
$('tube').addEventListener('dblclick', toggleFullscreen);

let digits = '';
let digitTimer = 0;
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || support.isOpen()) return;
  const k = e.key;
  if ((k === 's' || k === 'S') && !$('btnSupport').hidden) support.open();
  else if (k === 'ArrowUp' || k === 'PageUp') changeChannel(1);
  else if (k === 'ArrowDown' || k === 'PageDown') changeChannel(-1);
  else if (k === 'm' || k === 'M') setMuted(!state.muted);
  else if (k === 'f' || k === 'F') toggleFullscreen();
  else if (k === 'g' || k === 'G') toggleGuide();
  else if (k === 'p' || k === 'P') (state.on ? powerOff() : powerOn());
  else if (k === 'Escape') toggleGuide(false);
  else if (/^\d$/.test(k)) {
    digits = (digits + k).slice(-2);
    clearTimeout(digitTimer);
    digitTimer = setTimeout(() => { tuneNumber(Number(digits)); digits = ''; }, 1100);
  } else return;
  e.preventDefault();
  wake();
});

// Auto-hide controls and cursor while watching.
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (state.on && $('guide').hidden && !support.isOpen() && !document.querySelector('.controls:hover, .controls :focus-visible')) document.body.classList.add('idle');
  }, 3200);
}
['pointermove', 'pointerdown', 'touchstart'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));

// ------------------------------------------------------------------ boot
(async function boot() {
  setMuted(state.muted);
  await loadStation();
  support.configure(state.station.support, { previewMode: params.has('pledge') });
  await Promise.all([syncClock(), loadDay()]);
  wake();
  // Back from checkout (?member) or a direct link to the pledge card (?pledge).
  support.handleLocation(params);
  if (params.has('member') || params.has('pledge') || params.has('support')) {
    const clean = new URLSearchParams(params);
    ['member', 'pledge', 'support'].forEach((k) => clean.delete(k));
    history.replaceState(null, '', `${location.pathname}${clean.size ? `?${clean}` : ''}${location.hash}`);
  }
  // ?on — for kiosks / smart-TV browsers that allow autoplay. If the browser
  // blocks it, play() fails and the power button comes back.
  if (params.has('on')) powerOn();
  let lastMaintain = 0;
  let lastReload = performance.now();
  let lastTick = performance.now();
  setInterval(() => {
    const t = performance.now();
    if (state.on && document.visibilityState === 'visible') support.tick((t - lastTick) / 1000);
    lastTick = t;
    if (state.day && B.stationDay(now(), tz()).key !== state.day.key) loadDay();
    else if (t - lastReload > 5 * 60 * 1000) { lastReload = t; loadDay(); } // pick up new publishes
    refresh();
    if (state.on && t - lastMaintain > 2000) { lastMaintain = t; maintain(); }
  }, 250);
  setInterval(() => { if (!$('guide').hidden) renderGuide(); }, 30000);
})();
