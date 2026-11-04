// This Day TV — Control Room (vanilla JS, no build step).
// All untrusted text (archive titles etc.) goes through textContent via h().

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const CATEGORIES = [['program', 'Program'], ['news', 'News'], ['commercial', 'Commercial'], ['psa', 'PSA'], ['station-id', 'Station ID']];
const CARD_STYLES = [['headline', 'Headline'], ['station-id', 'Station ID'], ['break', "We'll be right back"], ['sign-off', 'Sign-off'], ['custom', 'Custom']];

const $ = (sel) => document.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, '0');

const state = {
  status: null,
  date: null,
  from: 1960,
  to: 1999,
  library: [],
  draft: null,
  published: null,
  cost: null,
  dirty: false,
  channelIdx: 0,
  findSource: 'archive',
  headlines: [],
  selectedHeadlines: new Set(),
  libFilter: 'all',
  jobs: [],
  yearCounts: null, // { key, counts: Map(year -> {clips, news}) }
};
// The channel being programmed (shared by the top bar, Find and Lineup tabs).
const bcYear = () => state.draft?.channels[state.channelIdx]?.year || null;
const chLabel = (c) => `CH ${c.number} · ${c.name}`;

// ------------------------------------------------------------------ utils
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// replaceChildren() would print null/false as text; skip them instead.
const present = (list) => list.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '');
function fill(el, ...children) {
  el.replaceChildren(...present(children));
  return el;
}

function clock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return hh ? `${hh}:${pad2(mm)}:${pad2(ss)}` : `${mm}:${pad2(ss)}`;
}
function parseClock(v) {
  if (v === '' || v === null || v === undefined) return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
const mb = (b) => (b ? `${(b / 1e6).toFixed(1)} MB` : '');
const robux = (n) => `R$${Number(n).toLocaleString()}`;
const prettyDate = (key) => {
  const [m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function toast(msg, kind = 'info', ms = 4500) {
  const el = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

async function api(method, url, body, retried = false) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = storage.get('tdtv-token');
  if (token) headers['x-admin-token'] = token;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    const t = window.prompt('Admin token (ADMIN_TOKEN in admin/.env):');
    if (t) {
      storage.set('tdtv-token', t);
      return api(method, url, body, true);
    }
  }
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const guard = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    toast(err.message, 'error', 8000);
    return undefined;
  }
};

// ------------------------------------------------------------------ modal
const modal = {
  open(...content) {
    const body = $('#modalBody');
    fill(body, ...content);
    if (!$('#modal').open) $('#modal').showModal();
  },
  close() {
    $('#modal').close();
    fill($('#modalBody'));
  },
};
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') modal.close(); });
$('#modal').addEventListener('close', () => fill($('#modalBody')));

function confirmDialog({ title, body, confirmLabel = 'Confirm', checks = [], danger = false }) {
  return new Promise((resolve) => {
    const boxes = checks.map((label) => h('input', { type: 'checkbox' }));
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, disabled: checks.length > 0 }, confirmLabel);
    const update = () => { ok.disabled = !boxes.every((b) => b.checked); };
    boxes.forEach((b) => b.addEventListener('change', update));
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } modal.close(); };
    ok.addEventListener('click', () => done(true));
    $('#modal').addEventListener('close', () => done(false), { once: true });
    modal.open(
      h('h2', {}, title),
      body,
      checks.length ? h('div', { class: 'form', style: { marginTop: '12px' } }, checks.map((label, i) => h('label', { class: 'check' }, boxes[i], label))) : null,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), ok),
    );
  });
}

// ------------------------------------------------------------------ header
function initDateControls() {
  const month = $('#month');
  const day = $('#day');
  MONTHS.forEach((m, i) => month.append(h('option', { value: pad2(i + 1) }, m)));
  const fillDays = () => {
    const keep = day.value;
    fill(day);
    for (let d = 1; d <= DAYS_IN_MONTH[Number(month.value) - 1]; d++) day.append(h('option', { value: pad2(d) }, d));
    if (keep && Number(keep) <= day.options.length) day.value = keep;
  };
  month.addEventListener('change', () => { fillDays(); setDate(`${month.value}-${day.value}`); });
  day.addEventListener('change', () => setDate(`${month.value}-${day.value}`));
  $('#yearFrom').addEventListener('change', (e) => { state.from = Number(e.target.value) || 1960; storage.set('tdtv-from', state.from); });
  $('#yearTo').addEventListener('change', (e) => { state.to = Number(e.target.value) || 1999; storage.set('tdtv-to', state.to); });
  $('#todayBtn').addEventListener('click', () => setDate(state.status.today));
  $('#bcYear').addEventListener('change', (e) => setYear(Number(e.target.value) || null));
  $('#bcChannel').addEventListener('change', (e) => selectChannel(Number(e.target.value)));
  initDateControls.fillDays = fillDays;
}

async function setDate(key) {
  if (state.dirty && !(await confirmDialog({ title: 'Discard unsaved lineup?', body: h('p', {}, `You have unsaved changes to ${prettyDate(state.date)}.`), confirmLabel: 'Discard', danger: true }))) {
    $('#month').value = state.date.slice(0, 2);
    initDateControls.fillDays();
    $('#day').value = state.date.slice(3);
    return;
  }
  state.date = key;
  state.dirty = false;
  $('#month').value = key.slice(0, 2);
  initDateControls.fillDays();
  $('#day').value = key.slice(3);
  state.headlines = [];
  state.selectedHeadlines = new Set();
  fill($('#findResults'));
  $('#findHint').textContent = `Search for programming from ${prettyDate(key)}, ${state.from}–${state.to}.`;
  await Promise.all([loadDraft(), loadHeadlines()]);
  loadYearFinder();
  if (state.booted) setFindSource(state.findSource, true);
}

/** Lock the current channel to one year (saved with the lineup). */
const setYear = guard(async (year) => {
  const ch = state.draft?.channels[state.channelIdx];
  if (!ch) return;
  ch.year = year;
  await saveDraft();
  syncChannelPicker();
  renderYearFinder();
  setFindSource(state.findSource, true);
  toast(year ? `${chLabel(ch)} now broadcasts ${prettyDate(state.date)}, ${year}. Search, headlines and auto-build stick to that year.` : `${chLabel(ch)} has no year set.`);
});

/** Switch which channel the top bar, Find and Lineup are working on. */
function selectChannel(idx) {
  if (!state.draft?.channels[idx]) return;
  state.channelIdx = idx;
  syncChannelPicker();
  renderYearFinder();
  renderLineup();
  if (!$('#tab-find').hidden) setFindSource(state.findSource, true);
}

function syncChannelPicker() {
  const chs = state.draft?.channels || [];
  fill($('#bcChannel'), ...chs.map((c, i) => h('option', { value: i }, `${chLabel(c)}${c.year ? ` · ${c.year}` : ''}`)));
  $('#bcChannel').value = String(state.channelIdx);
  $('#bcYear').value = bcYear() || '';
}

/** Best year not already used by another channel (for new channels). */
function suggestYear() {
  const used = new Set((state.draft?.channels || []).map((c) => c.year));
  const ranked = [...(state.yearCounts?.counts || new Map()).entries()].sort((a, b) => (b[1].clips * 3 + b[1].news) - (a[1].clips * 3 + a[1].news));
  return ranked.find(([y]) => !used.has(y))?.[0] || null;
}

async function loadYearFinder() {
  const key = `${state.date}|${state.from}|${state.to}`;
  if (state.yearCounts?.key === key) return renderYearFinder();
  fill($('#yearFinder'), h('span', { class: 'lbl' }, 'Finding which years have programming…'));
  let results = [];
  try {
    results = (await api('GET', `/api/search/archive?${new URLSearchParams({ date: state.date, from: state.from, to: state.to })}`)).results;
  } catch { /* chips just show headlines */ }
  if (`${state.date}|${state.from}|${state.to}` !== key) return; // date changed meanwhile
  const counts = new Map();
  const bump = (y, k) => {
    if (!y) return;
    const c = counts.get(y) || { clips: 0, news: 0 };
    c[k]++;
    counts.set(y, c);
  };
  results.forEach((r) => bump(r.airYear, 'clips'));
  state.headlines.forEach((e) => bump(e.year, 'news'));
  state.yearCounts = { key, counts };
  renderYearFinder();
}

function renderYearFinder() {
  const counts = state.yearCounts?.counts || new Map();
  const year = bcYear();
  const ch = state.draft?.channels[state.channelIdx];
  const usedBy = new Map((state.draft?.channels || []).filter((c) => c !== ch && c.year).map((c) => [c.year, c]));
  const ranked = [...counts.entries()].sort((a, b) => (b[1].clips * 3 + b[1].news) - (a[1].clips * 3 + a[1].news) || a[0] - b[0]).slice(0, 12);
  if (year && !ranked.some(([y]) => y === year)) ranked.unshift([year, counts.get(year) || { clips: 0, news: 0 }]);
  const chip = ([y, c]) => h('button', {
    class: 'year-chip',
    'aria-pressed': String(y === year),
    title: y === year ? `${ch ? chLabel(ch) : 'This channel'}'s year` : usedBy.has(y) ? `Already used by ${chLabel(usedBy.get(y))}` : `Set ${ch ? chLabel(ch) : 'this channel'} to ${y}`,
    onclick: () => (y === year ? null : setYear(y)),
  }, h('b', {}, y), ' ', h('span', {}, [c.clips ? `${c.clips} clip${c.clips > 1 ? 's' : ''}` : null, c.news ? `${c.news} news` : null, usedBy.has(y) ? `CH ${usedBy.get(y).number}` : null].filter(Boolean).join(' · ') || 'nothing dated'));
  const who = ch ? chLabel(ch) : 'This channel';
  fill($('#yearFinder'),
    h('span', { class: 'lbl' }, year ? `${who} broadcasts ${prettyDate(state.date)}, ${year}. Switch:` : `Pick a year for ${who}. These have the most programming dated ${prettyDate(state.date)}:`),
    ...ranked.map(chip));
}

function renderChips() {
  const s = state.status;
  const chip = (ok, label, title) => h('span', { class: `chip ${ok ? 'ok' : 'bad'}`, title }, label);
  fill($('#statusChips'), 
    chip(s.ffmpeg, 'ffmpeg', s.ffmpeg ? 'ffmpeg found' : 'Install ffmpeg to ingest media'),
    chip(s.exa, 'Exa', s.exa ? 'Exa key set' : 'EXA_API_KEY not set'),
    chip(s.roblox.canUpload, 'Roblox upload', s.roblox.canUpload ? `Uploading as ${s.roblox.creator}` : 'Roblox API key / creator not set'),
    chip(s.roblox.canPublish, 'Roblox publish', s.roblox.canPublish ? `Universe ${s.roblox.universeId}` : 'Roblox API key / universe not set'),
  );
}

// ------------------------------------------------------------------ tabs
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  storage.set('tdtv-tab', name);
  history.replaceState(null, '', `#${name}`);
  if (name === 'library') renderLibrary();
  if (name === 'lineup') renderLineup();
  if (name === 'setup') renderSetup();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ------------------------------------------------------------------ find
function setFindSource(src, search = false) {
  state.findSource = src;
  const year = bcYear();
  $('#findYear').placeholder = year ? String(year) : 'Year (opt.)';
  document.querySelectorAll('#findSource button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.src === src)));
  $('#findMedia').hidden = !(src === 'archive');
  $('#findYear').hidden = src === 'archive' || src === 'headlines';
  $('#findText').hidden = src === 'headlines';
  const hints = {
    archive: year
      ? `Programming from ${year}: what aired ${prettyDate(state.date)} first, then the same week, then the rest of ${year}. Keywords search all of ${year}.`
      : `Items dated ${prettyDate(state.date)} in ${state.from}–${state.to}, ranked by how trustworthy the date and rights look. Pick a broadcast year above to keep everything consistent.`,
    commercials: year ? `Commercials from ${year}. They don't need to match the date.` : 'Era commercials. These aren\'t tied to the date, so anything from the right year works.',
    exa: state.status.exa ? 'Exa semantic search, limited to archive.org so results can be ingested. Add a year to focus it.' : 'Set EXA_API_KEY in admin/.env to enable Exa search.',
    headlines: `Wikipedia "On this day" events and deaths${year ? ` from ${year}` : ''} become free headline cards. Tick the ones you want and auto-build will use them.`,
  };
  $('#findHint').textContent = hints[src];
  if (src === 'headlines') renderHeadlines();
  else if (search) $('#findForm').requestSubmit();
  else fill($('#findResults'));
}
document.querySelectorAll('#findSource button').forEach((b) => b.addEventListener('click', () => setFindSource(b.dataset.src)));

$('#findForm').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const src = state.findSource;
  if (src === 'headlines') return renderHeadlines();
  const p = new URLSearchParams({ date: state.date, from: state.from, to: state.to });
  const text = $('#findText').value.trim();
  const year = (src === 'archive' ? '' : $('#findYear').value.trim()) || bcYear();
  if (text) p.set('q', text);
  if (year) p.set('year', year);
  if (src === 'archive') p.set('media', $('#findMedia').value);
  const url = { archive: '/api/search/archive', commercials: '/api/search/commercials', exa: '/api/search/exa' }[src];
  fill($('#findResults'), h('div', { class: 'empty' }, 'Searching…'));
  const data = await api('GET', `${url}?${p}`).catch((err) => {
    fill($('#findResults'), h('div', { class: 'empty' }, err.message));
    throw err;
  });
  renderResults(data.results, src);
  if (data.errors?.length) toast(`Some queries failed: ${data.errors[0]}`, 'error');
}));

function rightsBadge(r) {
  if (!r.rights) return null;
  const cls = r.rights === 'public-domain' || r.rights === 'likely-public-domain' ? 'pd' : 'unknown';
  return h('span', { class: `badge ${cls}`, title: r.license || '' }, r.rightsLabel);
}

function renderResults(results, src) {
  const box = $('#findResults');
  if (!results.length) {
    fill(box, h('div', { class: 'empty' }, src === 'archive'
      ? `Nothing dated ${prettyDate(state.date)} turned up. Try Exa, keywords like "newsreel" or "newscast", or widen the year range.`
      : 'No results.'));
    return;
  }
  fill(box, ...results.map((r) => {
    const id = r.identifier || r.archiveId;
    const year = r.airYear || r.year || (r.publishedDate ? r.publishedDate.slice(0, 4) : '');
    return h('article', { class: 'result' },
      h('div', { class: 'thumb', style: r.thumb ? { backgroundImage: `url("${encodeURI(r.thumb)}")` } : {} },
        year ? h('span', { class: 'year' }, r.airDate || year) : null),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, r.title),
        h('div', { class: 'badges' },
          rightsBadge(r),
          r.mediatype === 'audio' ? h('span', { class: 'badge' }, 'audio') : null,
          ...(r.collections || []).slice(0, 3).map((c) => h('span', { class: 'badge' }, c)),
          r.match === 'date' ? h('span', { class: 'badge match-date' }, 'aired this day') : null,
          r.match === 'week' && !r.future ? h('span', { class: 'badge match-week' }, `same week · ${r.airDate}`) : null,
          r.future ? h('span', { class: 'badge unknown', title: 'Dated after the broadcast day: news nobody had seen yet' }, `after this date · ${r.airDate}`) : null,
          r.match === 'year' ? h('span', { class: 'badge' }, `${r.airYear}${r.airDate ? ` · ${r.airDate}` : ''}`) : null,
          src === 'archive' && r.strategies && !r.match ? h('span', { class: 'badge', title: 'How the date matched' }, `matched: ${r.strategies.join(', ')}`) : null),
        r.description ? h('div', { class: 'desc' }, r.description) : null,
        r.highlights?.length ? h('div', { class: 'desc' }, r.highlights.join(' … ')) : null,
        h('div', { class: 'actions' },
          id ? h('button', { class: 'btn small', onclick: () => previewArchive(id, r.title) }, 'Preview') : null,
          h('a', { class: 'btn small ghost', href: r.url, target: '_blank', rel: 'noopener' }, 'Open ↗'),
          id ? h('button', {
            class: 'btn small primary',
            onclick: () => openIngest({
              identifier: id,
              title: r.title,
              year: year ? Number(String(year).slice(0, 4)) : null,
              airDate: r.airDate || null,
              category: src === 'commercials' ? 'commercial' : (/news/i.test(r.title) ? 'news' : 'program'),
              kind: r.mediatype === 'audio' ? 'audio' : 'video',
              rights: r.rights,
            }),
          }, 'Add to library…') : h('span', { class: 'muted' }, 'Reference only (not on archive.org)'),
        ),
      ));
  }));
}

function previewArchive(id, title) {
  modal.open(
    h('h2', {}, title),
    h('iframe', { class: 'embed', src: `https://archive.org/embed/${encodeURIComponent(id)}`, allow: 'fullscreen', allowfullscreen: true, title }),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => modal.close() }, 'Close')),
  );
}

async function loadHeadlines() {
  try {
    const data = await api('GET', `/api/onthisday?${new URLSearchParams({ date: state.date, from: state.from, to: state.to })}`);
    state.headlines = data.results;
  } catch (err) {
    state.headlines = [];
    console.warn(err);
  }
  if (state.findSource === 'headlines') renderHeadlines();
}

function renderHeadlines() {
  const box = $('#findResults');
  if (!state.headlines.length) {
    fill(box, h('div', { class: 'empty' }, 'No Wikipedia events in this range.'));
    return;
  }
  const year = bcYear();
  const shown = state.headlines.map((ev, i) => [ev, i]).filter(([ev]) => !year || ev.year === year);
  if (!shown.length) {
    fill(box, h('div', { class: 'empty' }, `Wikipedia has no events or deaths for ${prettyDate(state.date)}, ${year}. Try another year with the chips above.`));
    return;
  }
  fill(box, h('div', { class: 'headlines' }, shown.map(([ev, i]) => {
    const cb = h('input', { type: 'checkbox', checked: state.selectedHeadlines.has(i), 'aria-label': `Use ${ev.year} headline` });
    cb.addEventListener('change', () => (cb.checked ? state.selectedHeadlines.add(i) : state.selectedHeadlines.delete(i)));
    const text = ev.kind === 'death' ? `Died today: ${ev.text}` : ev.text;
    return h('div', { class: 'headline' },
      cb,
      h('span', { class: 'y' }, ev.year),
      h('span', {}, ev.kind === 'death' ? h('span', { class: 'badge died' }, 'died') : null, ' ', ev.text, ' ', ev.link ? h('a', { href: ev.link, target: '_blank', rel: 'noopener' }, '↗') : null),
      h('button', { class: 'btn small', onclick: () => addCard({ style: 'headline', title: `${prettyDate(state.date)}, ${ev.year}`, text, year: ev.year, duration: 10 }) }, 'Add card'));
  })));
}

// ------------------------------------------------------------------ ingest
function estimate(kind, lengthSec) {
  const s = state.status.media;
  const max = kind === 'audio' ? s.maxAudioSegmentSeconds : s.maxSegmentSeconds;
  if (!(lengthSec > 0)) return null;
  const parts = Math.ceil(lengthSec / max - 1e-9);
  return { parts, robux: kind === 'video' ? parts * state.status.roblox.videoPrice : 0 };
}

async function openIngest(pre) {
  modal.open(h('p', {}, 'Loading item files…'));
  let item;
  try {
    item = await api('GET', `/api/archive/item/${encodeURIComponent(pre.identifier)}`);
  } catch (err) {
    modal.open(h('h2', {}, 'Could not load item'), h('p', {}, err.message), h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => modal.close() }, 'Close')));
    return;
  }
  const f = {};
  const field = (label, el) => h('label', { class: 'field' }, label, el);
  f.delivery = h('select', {},
    h('option', { value: 'stream' }, 'Stream on the website (free, nothing downloaded)'),
    h('option', { value: 'roblox' }, 'Download & cut for Roblox (upload costs Robux)'));
  f.delivery.value = storage.get('tdtv-delivery') || 'stream';
  f.kind = h('select', {}, h('option', { value: 'video' }, 'Video'), h('option', { value: 'audio' }, 'Radio / audio'));
  f.kind.value = item.videoFiles.length ? pre.kind : 'audio';
  f.file = h('select', {});
  f.category = h('select', {}, CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  f.category.value = pre.category;
  f.title = h('input', { value: pre.title || item.title, maxlength: 120 });
  f.year = h('input', { type: 'number', value: pre.year || item.year || bcYear() || '' });
  f.airDate = h('input', { placeholder: 'YYYY-MM-DD', value: pre.airDate || '' });
  f.start = h('input', { placeholder: '0:00' });
  f.end = h('input', { placeholder: 'end' });
  const cost = h('div', { class: 'cost' });
  const intro = h('p', { class: 'muted' });
  const trusted = ['public-domain', 'likely-public-domain'].includes(item.rights);
  const rightsNote = h('p', { class: trusted ? 'muted' : 'warnings' });
  const submit = h('button', { class: 'btn primary' });

  const pool = () => (f.kind.value === 'video' ? item.videoFiles : [...item.audioFiles, ...item.videoFiles]);
  const fillFiles = () => {
    fill(f.file, ...pool().map((file) => h('option', { value: file.name }, `${file.name} · ${file.format}${file.length ? ` · ${clock(file.length)}` : ''}${file.size ? ` · ${mb(file.size)}` : ''}`)));
    updateCost();
  };
  const updateCost = () => {
    const stream = f.delivery.value === 'stream';
    const file = pool().find((x) => x.name === f.file.value);
    const start = parseClock(f.start.value) || 0;
    const end = parseClock(f.end.value) ?? file?.length;
    const len = end ? end - start : null;
    fill(intro, stream
      ? 'Saves a link to the archive.org file plus your clip times. The website plays it straight from archive.org, so there is nothing to download, upload or pay for.'
      : 'Downloads the file, letterboxes it to 4:3, and cuts it into parts short enough for Roblox. Uploading is a separate step.');
    fill(rightsNote, trusted
      ? `Rights: ${item.rightsLabel}${item.license ? ` (${item.license})` : ''}`
      : `${item.rightsLabel}. Whoever shows a broadcast is responsible for having the rights to it${stream ? '' : ', and Roblox may moderate or remove the asset. Check before you spend Robux'}.`);
    submit.textContent = stream ? 'Add to library' : 'Download & prepare';
    if (!pool().length) return fill(cost, h('strong', {}, `No ${f.kind.value} file in this item.`));
    if (!(len > 0)) return fill(cost, stream ? 'Length unknown. It will be read from the file.' : 'Length unknown. It will be measured after download.');
    if (stream) {
      const acts = f.category.value === 'commercial' ? 1 : Math.ceil(len / state.status.media.webActSeconds - 1e-9);
      return fill(cost, `Clip length ${clock(len)}`, acts > 1 ? ` → ${acts} acts, with commercial breaks between them.` : '.', ' ', h('strong', {}, 'Free.'));
    }
    const est = estimate(f.kind.value, len);
    fill(cost,
      `Clip length ${clock(len)} → ${est.parts} part${est.parts > 1 ? 's' : ''}. `,
      f.kind.value === 'video' ? h('strong', {}, `Uploading will cost ${robux(est.robux)}.`) : 'Audio uploads cost no Robux.',
      est.parts > 1 ? ' Parts are split evenly, and commercials fit between them.' : '');
  };
  f.kind.addEventListener('change', fillFiles);
  f.delivery.addEventListener('change', () => { storage.set('tdtv-delivery', f.delivery.value); updateCost(); });
  [f.file, f.start, f.end, f.category].forEach((el) => el.addEventListener('input', updateCost));
  fillFiles();

  submit.addEventListener('click', guard(async () => {
    const start = parseClock(f.start.value);
    const end = parseClock(f.end.value);
    if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('Use mm:ss for clip times');
    const body = {
      source: 'archive', identifier: pre.identifier, file: f.file.value, kind: f.kind.value,
      category: f.category.value, title: f.title.value, year: f.year.value || null,
      airDate: f.airDate.value.trim() || null, start, end,
    };
    if (f.delivery.value === 'stream') {
      submit.disabled = true;
      try {
        await api('POST', '/api/library/stream', body);
      } finally {
        submit.disabled = false;
      }
      modal.close();
      toast(`Added "${body.title}". It's ready for the website lineup.`);
      await loadLibrary();
      return;
    }
    const { job } = await api('POST', '/api/library/ingest', body);
    modal.close();
    toast('Ingest queued. Progress shows bottom-right. Nothing is uploaded to Roblox yet.');
    trackJob(job);
  }));

  modal.open(
    h('h2', {}, 'Add to library'),
    intro,
    rightsNote,
    h('div', { class: 'form' },
      field('Destination', f.delivery),
      h('div', { class: 'row' }, field('Type', f.kind), field('Category', f.category)),
      field('Source file', f.file),
      field('Title (shown on screen)', f.title),
      h('div', { class: 'row' }, field('Year', f.year), field('Air date', f.airDate)),
      h('div', { class: 'row' }, field('Clip start (mm:ss)', f.start), field('Clip end (mm:ss)', f.end)),
      cost),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'), submit),
  );
}

// ------------------------------------------------------------------ jobs
const tracked = new Set();
function trackJob(job) {
  tracked.add(job.id);
  state.jobs = [job, ...state.jobs.filter((j) => j.id !== job.id)];
  renderJobs();
  pollJobs();
}
let polling = false;
async function pollJobs() {
  if (polling) return;
  polling = true;
  try {
    while ([...tracked].length) {
      await new Promise((r) => setTimeout(r, 1200));
      const { jobs } = await api('GET', '/api/jobs');
      state.jobs = jobs;
      for (const id of [...tracked]) {
        const j = jobs.find((x) => x.id === id);
        if (!j || j.status === 'done' || j.status === 'error') {
          tracked.delete(id);
          if (j?.status === 'done') toast(`${j.label}: done`);
          if (j?.status === 'error') toast(`${j.label}: ${j.error}`, 'error', 10000);
          await loadLibrary();
        }
      }
      renderJobs();
    }
  } catch (err) {
    console.warn(err);
  } finally {
    polling = false;
  }
}
function renderJobs() {
  const recent = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued' || (j.finishedAt && Date.now() - Date.parse(j.finishedAt) < 15000));
  fill($('#jobs'), ...recent.slice(0, 5).map((j) => h('div', { class: `job ${j.status}` },
    h('div', { class: 'job-head' }, h('strong', {}, j.label), h('span', { class: 'muted' }, j.status)),
    h('div', { class: 'msg muted' }, j.message),
    j.status !== 'error' ? h('div', { class: 'bar' }, h('span', { style: { width: `${Math.round((j.progress || 0) * 100)}%` } })) : null)));
  if (recent.length) setTimeout(renderJobs, 5000);
}

// ------------------------------------------------------------------ library
async function loadLibrary() {
  const { items } = await api('GET', '/api/library');
  state.library = items;
  if (!$('#tab-library').hidden) renderLibrary();
  if (!$('#tab-lineup').hidden) renderLineup();
}

document.querySelectorAll('#libFilter button').forEach((b) => b.addEventListener('click', () => {
  state.libFilter = b.dataset.f;
  document.querySelectorAll('#libFilter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderLibrary();
}));

function segStatus(seg) {
  const st = seg.assetId ? 'done' : seg.upload?.status || 'none';
  const text = {
    done: `On Roblox · ${seg.assetId}`,
    uploading: 'Uploading…',
    processing: 'Roblox processing…',
    error: `Failed: ${seg.upload?.error || ''}`,
    none: 'Not uploaded',
  }[st];
  return h('span', { class: `st ${st}`, title: text }, text.length > 90 ? `${text.slice(0, 90)}…` : text);
}

function renderLibrary() {
  const box = $('#libraryList');
  const items = state.library.filter((i) => state.libFilter === 'all' || i.category === state.libFilter)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!items.length) {
    fill(box, h('div', { class: 'empty' }, 'Nothing here yet. Go to Find programming and use "Add to library…".'));
    return;
  }
  fill(box, ...items.map((item) => {
    const pending = item.segments.filter((s) => !s.assetId && s.file);
    const uploadBtn = pending.length ? h('button', { class: 'btn small primary', onclick: () => uploadItem(item, pending.map((s) => s.index)) },
      item.kind === 'video' ? `Upload ${pending.length} part${pending.length > 1 ? 's' : ''} · ${robux(pending.length * state.status.roblox.videoPrice)}` : `Upload ${pending.length} audio part${pending.length > 1 ? 's' : ''}`) : null;
    return h('article', { class: 'lib-item' },
      h('div', { class: 'lib-head' },
        h('div', {},
          h('div', { class: 'lib-title' }, h('span', { class: `cat ${item.category}` }, item.category), item.title, item.year ? h('span', { class: 'muted' }, item.year) : null,
            item.delivery === 'stream' ? h('span', { class: 'badge pd', title: 'Plays straight from archive.org on the website' }, 'streams · website') : h('span', { class: 'badge' }, 'website + Roblox')),
          h('div', { class: 'muted' },
            item.kind === 'audio' ? 'Audio · ' : 'Video · ',
            `${item.segments.length} ${item.delivery === 'stream' ? 'act' : 'part'}${item.segments.length > 1 ? 's' : ''} · ${clock(item.segments.reduce((s, x) => s + (x.duration || 0), 0))}`,
            item.airDate ? ` · aired ${item.airDate}` : '',
            item.source?.type === 'archive' ? [' · ', h('a', { href: item.source.url, target: '_blank', rel: 'noopener' }, item.source.identifier)] : '',
            item.source?.rights ? ` · rights: ${item.source.rights}` : '')),
        h('div', { class: 'toolbar-actions' },
          uploadBtn,
          h('button', { class: 'btn small', onclick: () => editItem(item) }, 'Edit'),
          h('button', { class: 'btn small danger', onclick: () => deleteItem(item) }, 'Delete'))),
      h('ul', { class: 'segments' }, item.segments.map((seg) => segmentRow(item, seg))));
  }));
}

function streamRow(item, seg) {
  const li = h('li', { class: 'segment' });
  const end = seg.start + seg.duration;
  li.append(...present([
    h('strong', {}, item.segments.length > 1 ? `Act ${seg.index + 1}` : 'Clip'),
    h('span', { class: 'muted' }, `${clock(seg.duration)} · ${clock(seg.start)}–${clock(end)} of the source`),
    h('span', { class: 'st done' }, 'Streams from archive.org'),
    h('button', {
      class: 'btn small',
      onclick: () => {
        const existing = li.querySelector('video,audio');
        if (existing) return existing.remove();
        // Media fragment: play just this act's range.
        li.append(h(item.kind === 'audio' ? 'audio' : 'video', { src: `${seg.src}#t=${seg.start.toFixed(1)},${end.toFixed(1)}`, controls: true, preload: 'metadata' }));
      },
    }, 'Preview'),
  ]));
  return li;
}

function segmentRow(item, seg) {
  if (item.delivery === 'stream') return streamRow(item, seg);
  const li = h('li', { class: 'segment' });
  const assetInput = h('input', { class: 'asset', placeholder: 'Asset ID', value: seg.assetId || '', 'aria-label': 'Roblox asset ID' });
  const preview = seg.file ? h('button', {
    class: 'btn small',
    onclick: () => {
      const existing = li.querySelector('video,audio');
      if (existing) return existing.remove();
      li.append(h(item.kind === 'audio' ? 'audio' : 'video', { src: `/media/${item.id}/${seg.index}`, controls: true, preload: 'metadata' }));
    },
  }, 'Preview') : null;
  li.append(...present([
    h('strong', {}, `Part ${seg.index + 1}`),
    h('span', { class: 'muted' }, clock(seg.duration), seg.sizeBytes ? ` · ${mb(seg.sizeBytes)}` : ''),
    segStatus(seg),
    preview,
    seg.upload?.status === 'processing' && !seg.assetId ? h('button', {
      class: 'btn small',
      onclick: guard(async () => {
        const r = await api('POST', `/api/library/${item.id}/segments/${seg.index}/check`);
        toast(r.done ? 'Upload finished.' : 'Roblox is still processing it.');
        await loadLibrary();
      }),
    }, 'Check status') : null,
    assetInput,
    h('button', {
      class: 'btn small',
      title: 'Use this if you uploaded the file yourself in Creator Hub',
      onclick: guard(async () => {
        await api('PUT', `/api/library/${item.id}/segments/${seg.index}/asset`, { assetId: assetInput.value });
        toast(assetInput.value ? 'Asset ID saved.' : 'Asset ID cleared.');
        await loadLibrary();
      }),
    }, 'Set ID'),
  ]));
  return li;
}

const uploadItem = guard(async (item, indexes) => {
  const price = state.status.roblox.videoPrice;
  if (!state.status.roblox.canUpload) throw new Error('Set ROBLOX_API_KEY and a creator ID in admin/.env first (see Setup).');
  const isVideo = item.kind === 'video';
  const checks = ['I confirm this is public domain, or that I hold the rights to upload it to Roblox.'];
  if (isVideo) checks.push(`I understand Roblox will charge ${robux(indexes.length * price)} (${indexes.length} × ${robux(price)}), and the charge stays even if moderation later rejects the video.`);
  const ok = await confirmDialog({
    title: `Upload "${item.title}"`,
    body: h('div', {},
      h('p', {}, `${indexes.length} ${isVideo ? 'video' : 'audio'} part${indexes.length > 1 ? 's' : ''} will go to Roblox, one at a time. The job stops at the first failure.`),
      isVideo ? h('p', { class: 'muted' }, 'Video uploads need an ID-verified account aged 13 or over, and are capped at 20 a day.') : null),
    confirmLabel: isVideo ? `Upload · ${robux(indexes.length * price)}` : 'Upload',
    checks,
  });
  if (!ok) return;
  const { job } = await api('POST', `/api/library/${item.id}/upload`, { segments: indexes, confirmCost: isVideo, confirmRights: true });
  trackJob(job);
});

function editItem(item) {
  const title = h('input', { value: item.title, maxlength: 120 });
  const year = h('input', { type: 'number', value: item.year || '' });
  const airDate = h('input', { value: item.airDate || '', placeholder: 'YYYY-MM-DD' });
  const credit = h('input', { value: item.credit || '', placeholder: 'e.g. archive.org/details/…' });
  const category = h('select', {}, CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  category.value = item.category;
  const field = (l, el) => h('label', { class: 'field' }, l, el);
  modal.open(
    h('h2', {}, 'Edit library item'),
    h('div', { class: 'form' }, field('Title', title), h('div', { class: 'row' }, field('Year', year), field('Air date', airDate), field('Category', category)), field('On-screen credit', credit)),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: guard(async () => {
          await api('PATCH', `/api/library/${item.id}`, { title: title.value, year: year.value || null, airDate: airDate.value || null, category: category.value, credit: credit.value });
          modal.close();
          await loadLibrary();
        }),
      }, 'Save')),
  );
}

const deleteItem = guard(async (item) => {
  const used = state.draft?.channels.some((c) => c.entries.some((e) => e.libraryId === item.id));
  const ok = await confirmDialog({
    title: `Delete "${item.title}"?`,
    body: h('p', {}, 'This removes the local files and the library entry. Assets already on Roblox stay there.', used ? ' It is also used in the current lineup.' : ''),
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await api('DELETE', `/api/library/${item.id}`);
  await loadLibrary();
});

$('#addUrlBtn').addEventListener('click', () => {
  const src = h('select', {}, h('option', { value: 'url' }, 'Direct media URL'), h('option', { value: 'local' }, 'File on this computer (path)'));
  const loc = h('input', { placeholder: 'https://… .mp4  or  /Users/me/clip.mp4' });
  const kind = h('select', {}, h('option', { value: 'video' }, 'Video'), h('option', { value: 'audio' }, 'Audio'));
  const category = h('select', {}, CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  const title = h('input', { maxlength: 120 });
  const year = h('input', { type: 'number' });
  const start = h('input', { placeholder: '0:00' });
  const end = h('input', { placeholder: 'end' });
  const field = (l, el) => h('label', { class: 'field' }, l, el);
  modal.open(
    h('h2', {}, 'Add from URL or file'),
    h('p', { class: 'muted' }, 'Only add material you have the rights to.'),
    h('div', { class: 'form' },
      h('div', { class: 'row' }, field('Source', src), field('Type', kind), field('Category', category)),
      field('URL or path', loc), field('Title', title),
      h('div', { class: 'row' }, field('Year', year), field('Clip start', start), field('Clip end', end))),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: guard(async () => {
          const body = { source: src.value, kind: kind.value, category: category.value, title: title.value, year: year.value || null, start: parseClock(start.value), end: parseClock(end.value) };
          if (src.value === 'url') body.url = loc.value.trim(); else body.localPath = loc.value.trim();
          const { job } = await api('POST', '/api/library/ingest', body);
          modal.close();
          trackJob(job);
        }),
      }, 'Download & prepare')),
  );
});

$('#addManualBtn').addEventListener('click', () => {
  const assetId = h('input', { placeholder: 'e.g. 1234567890' });
  const kind = h('select', {}, h('option', { value: 'video' }, 'Video'), h('option', { value: 'audio' }, 'Audio'));
  const category = h('select', {}, CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  const title = h('input', { maxlength: 120 });
  const year = h('input', { type: 'number' });
  const duration = h('input', { placeholder: 'mm:ss' });
  const credit = h('input', { placeholder: 'Source credit (optional)' });
  const field = (l, el) => h('label', { class: 'field' }, l, el);
  modal.open(
    h('h2', {}, 'Add an existing Roblox asset'),
    h('p', { class: 'muted' }, 'For videos or audio you uploaded yourself in Creator Hub. Enter the exact duration so channels stay in sync.'),
    h('div', { class: 'form' },
      h('div', { class: 'row' }, field('Asset ID', assetId), field('Type', kind), field('Category', category)),
      field('Title', title), h('div', { class: 'row' }, field('Year', year), field('Duration', duration)), field('Credit', credit)),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: guard(async () => {
          await api('POST', '/api/library/manual', { assetId: assetId.value, kind: kind.value, category: category.value, title: title.value, year: year.value || null, duration: duration.value, credit: credit.value });
          modal.close();
          await loadLibrary();
        }),
      }, 'Add')),
  );
});

// ------------------------------------------------------------------ lineup
async function loadDraft() {
  const data = await api('GET', `/api/schedules/${state.date}`);
  state.draft = data.draft;
  state.published = data.published;
  state.webPublished = data.webPublished;
  state.cost = data.cost;
  state.channelIdx = 0;
  state.dirty = false;
  syncChannelPicker();
  renderYearFinder();
  renderLineup();
}

const libById = () => new Map(state.library.map((i) => [i.id, i]));
const channel = () => state.draft?.channels[state.channelIdx];
const markDirty = () => {
  state.dirty = true;
  syncChannelPicker();
  renderLineup();
};

function entryInfo(e, lib) {
  if (e.type === 'card') return { cls: 'card', label: e.title || '(card)', sub: `${CARD_STYLES.find(([v]) => v === e.style)?.[1] || 'Card'}${e.year ? ` · ${e.year}` : ''}`, dur: e.duration, ok: true };
  const item = lib.get(e.libraryId);
  const seg = item?.segments[e.segment];
  if (!item || !seg) return { cls: 'missing', label: '(deleted library item)', sub: '', dur: 0, ok: false };
  const web = webPlayable(item, seg);
  const onRoblox = Boolean(seg.assetId);
  const unit = item.delivery === 'stream' ? 'act' : 'part';
  const chYear = bcYear();
  const offYear = Boolean(chYear && item.year && item.year !== chYear);
  return {
    cls: `${item.category}${web ? '' : ' missing'}${offYear ? ' offyear' : ''}`,
    label: item.title,
    sub: [`${item.category}${item.segments.length > 1 ? ` · ${unit} ${e.segment + 1}/${item.segments.length}` : ''}${item.year && !offYear ? ` · ${item.year}` : ''}`,
      offYear ? h('span', { class: 'offyear-tag' }, ` · from ${item.year}, not ${chYear}`) : null,
      web ? '' : ' · Roblox only (skipped on the website)'],
    dur: seg.duration,
    ok: web,
    onRoblox,
    offYear,
  };
}

// Mirrors webSource() in admin/lib/schedule.js.
function webPlayable(item, seg) {
  return Boolean(seg.src || (item.source?.type === 'archive' && item.source.file) || (item.source?.type === 'url' && item.source.url));
}

function renderLineup() {
  if (!state.draft || $('#tab-lineup').hidden) return;
  const lib = libById();
  const d = state.draft;
  $('#lineupTitle').textContent = d.title;
  $('#dirtyFlag').hidden = !state.dirty;
  const when = (iso) => new Date(iso).toLocaleString();
  $('#lineupMeta').textContent = [
    state.webPublished ? `Website: published ${when(state.webPublished)}` : 'Website: not published yet',
    state.published ? `Roblox: published ${when(state.published.publishedAt)}` : null,
  ].filter(Boolean).join(' · ');

  // channels
  fill($('#channelBar'), 
    ...d.channels.map((c, i) => h('button', { 'aria-pressed': String(i === state.channelIdx), onclick: () => selectChannel(i) }, `${chLabel(c)}${c.year ? ` · ${c.year}` : ''}`)),
    h('button', {
      onclick: () => {
        const used = new Set(d.channels.map((c) => c.number));
        let n = 2;
        while (used.has(n)) n++;
        d.channels.push({ number: n, name: `W${'ABCDEFGHJKLMNOPRSTUVWXYZ'[n % 24]}TV`, tagline: '', year: suggestYear(), entries: [] });
        state.channelIdx = d.channels.length - 1;
        markDirty();
        renderYearFinder();
      },
    }, '+ Channel'),
  );

  const ch = channel();
  if (!ch) return;
  const num = h('input', { name: 'number', type: 'number', min: 2, max: 83, value: ch.number, 'aria-label': 'Channel number' });
  const name = h('input', { name: 'name', value: ch.name, maxlength: 24, 'aria-label': 'Call sign' });
  const tagline = h('input', { name: 'tagline', value: ch.tagline || '', maxlength: 80, placeholder: 'Tagline', 'aria-label': 'Tagline' });
  const yearIn = h('input', { name: 'year', type: 'number', min: 1890, max: 2100, value: ch.year || '', placeholder: 'year', 'aria-label': 'Channel year', title: 'Everything on this channel comes from this year' });
  yearIn.addEventListener('change', () => { ch.year = Number(yearIn.value) || null; markDirty(); renderYearFinder(); });
  num.addEventListener('change', () => { ch.number = Number(num.value); markDirty(); });
  name.addEventListener('change', () => { ch.name = name.value; markDirty(); });
  tagline.addEventListener('change', () => { ch.tagline = tagline.value; markDirty(); });
  fill($('#channelSettings'), 
    h('label', { class: 'muted' }, 'CH ', num), name, h('label', { class: 'muted' }, 'Year ', yearIn), tagline,
    d.channels.length > 1 ? h('button', {
      class: 'btn small danger',
      onclick: async () => {
        if (await confirmDialog({ title: `Remove channel ${ch.number}?`, body: h('p', {}, 'Its lineup will be removed from this day.'), confirmLabel: 'Remove', danger: true })) {
          d.channels.splice(state.channelIdx, 1);
          state.channelIdx = 0;
          markDirty();
        }
      },
    }, 'Remove channel') : null,
  );

  // entries + timeline
  const infos = ch.entries.map((e) => entryInfo(e, lib));
  const onAir = infos.filter((i) => i.ok);
  const total = onAir.reduce((s, i) => s + i.dur, 0);
  fill($('#timeline'), ...infos.map((info) => (info.ok ? h('span', {
    title: `${info.label} (${clock(info.dur)})`,
    style: { flexGrow: String(info.dur), background: `var(--${info.cls.split(' ')[0] === 'station-id' ? 'card' : info.cls.split(' ')[0]})` },
  }) : null)));

  let at = 0;
  const list = $('#entries');
  if (!ch.entries.length) {
    fill(list, h('li', { class: 'empty' }, 'This channel is empty. Use Auto-build, or add clips and cards from the panel.'));
  } else {
    fill(list, ...ch.entries.map((e, i) => {
      const info = infos[i];
      const start = at;
      if (info.ok) at += info.dur;
      const move = (delta) => {
        const j = i + delta;
        if (j < 0 || j >= ch.entries.length) return;
        [ch.entries[i], ch.entries[j]] = [ch.entries[j], ch.entries[i]];
        markDirty();
      };
      return h('li', { class: `entry ${info.cls}` },
        h('span', { class: 'at' }, info.ok ? clock(start) : '—'),
        e.type === 'card' ? h('span', { class: 'cat card' }, 'card') : h('span', { class: `cat ${lib.get(e.libraryId)?.category || 'card'}` }, lib.get(e.libraryId)?.kind === 'audio' ? 'audio' : 'video'),
        h('span', { class: 'label' }, info.label, h('small', {}, info.sub)),
        h('span', { class: 'dur' }, clock(info.dur)),
        h('span', { class: 'ctl' },
          e.type === 'card' ? h('button', { class: 'icon-btn', title: 'Edit card', onclick: () => editCard(e) }, '✎') : null,
          h('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', onclick: () => move(-1) }, '↑'),
          h('button', { class: 'icon-btn', title: 'Move down', 'aria-label': 'Move down', onclick: () => move(1) }, '↓'),
          h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove', onclick: () => { ch.entries.splice(i, 1); markDirty(); } }, '✕')));
    }));
  }

  // warnings
  const missing = infos.filter((i) => !i.ok).length;
  const offYear = infos.filter((i) => i.offYear).length;
  const warn = [];
  if (!ch.year) warn.push(`${chLabel(ch)} has no year. Set one (top bar or below) so everything on it matches.`);
  if (offYear) warn.push(`${offYear} clip${offYear === 1 ? " isn't" : "s aren't"} from ${ch.year}. They're marked below.`);
  if (missing) warn.push(`${missing} entr${missing === 1 ? 'y exists' : 'ies exist'} only as Roblox assets, so the website will skip ${missing === 1 ? 'it' : 'them'}.`);
  // Roblox notes only matter once someone is using Roblox.
  const usingRoblox = state.status.roblox.canPublish || infos.some((i) => i.onRoblox);
  if (usingRoblox) {
    const pendingVideos = new Set();
    d.channels.forEach((c) => c.entries.forEach((e) => {
      const it = lib.get(e.libraryId);
      if (e.type === 'segment' && it?.kind === 'video' && it.delivery !== 'stream' && it.segments[e.segment] && !it.segments[e.segment].assetId) pendingVideos.add(`${it.id}:${e.segment}`);
    }));
    const notOnRoblox = ch.entries.filter((e, i) => e.type === 'segment' && !infos[i].onRoblox).length;
    if (notOnRoblox) warn.push(`Roblox: ${notOnRoblox} clip${notOnRoblox === 1 ? ' is' : 's are'} streamed or not uploaded yet, and Roblox will skip ${notOnRoblox === 1 ? 'it' : 'them'}.`);
    if (pendingVideos.size) warn.push(`Roblox: uploading the remaining videos costs ${robux(pendingVideos.size * state.status.roblox.videoPrice)} (${pendingVideos.size} uploads).`);
  }
  fill($('#lineupWarnings'), warn.length ? h('div', { class: 'warnings' }, h('strong', {}, 'Heads up'), h('ul', {}, warn.map((w) => h('li', {}, w)))) : '');
  $('#lineupMeta').append(` · CH ${ch.number}${ch.year ? ` (${ch.year})` : ''} loops every ${clock(total)}`);

  renderPalette();
}

function renderPalette() {
  const ch = channel();
  // A channel with a year only offers that year's clips and headlines.
  const fits = (y) => !ch.year || y === ch.year;
  const programs = state.library.filter((i) => i.category !== 'commercial' && fits(i.year));
  const ads = state.library.filter((i) => i.category === 'commercial' && fits(i.year));
  const yearHeadlines = state.headlines.map((ev, i) => [ev, i]).filter(([ev]) => fits(ev.year));
  const selectedHere = yearHeadlines.filter(([, i]) => state.selectedHeadlines.has(i));
  const status = (i) => {
    if (i.delivery === 'stream') return 'stream';
    const up = i.segments.filter((s) => s.assetId).length;
    return up === i.segments.length ? 'on Roblox' : `${up}/${i.segments.length} on Roblox`;
  };
  const checklist = (items, checkedFn) => (items.length
    ? h('div', { class: 'checklist' }, items.map((i) => h('label', {}, h('input', { type: 'checkbox', value: i.id, checked: checkedFn(i) }), `${i.year || '—'} · ${i.title} `, h('span', { class: 'muted' }, status(i)))))
    : h('div', { class: 'muted' }, ch.year ? `Nothing from ${ch.year} in the library yet. Use Find programming.` : 'None in the library yet.'));
  const inLineup = new Set(ch.entries.filter((e) => e.type === 'segment').map((e) => e.libraryId));
  const progList = checklist(programs, (i) => inLineup.has(i.id) || !ch.entries.length);
  const adList = checklist(ads, (i) => inLineup.has(i.id) || !ch.entries.length);
  const perBreak = h('input', { type: 'number', min: 0, max: 4, value: 2, style: { width: '4em' } });
  const useHeadlines = h('input', { type: 'checkbox', checked: true });
  const selectedCount = selectedHere.length;
  fill($('#autoBuild'), h('div', { class: 'form' },
    ch.year ? h('div', { class: 'muted' }, `Only ${ch.year} material is listed, because CH ${ch.number} is locked to ${ch.year}.`) : h('div', { class: 'muted' }, 'Tip: give this channel a year so everything on it matches.'),
    h('div', { class: 'muted' }, 'Programs and news'), progList,
    h('div', { class: 'muted' }, 'Commercials (rotated through the breaks)'), adList,
    h('label', { class: 'check' }, useHeadlines, `Headline cards (${selectedCount ? `${selectedCount} selected` : `all ${yearHeadlines.length}`} from Wikipedia)`),
    h('label', { class: 'check' }, 'Commercials per break ', perBreak),
    h('button', {
      class: 'btn primary',
      onclick: guard(async () => {
        if (ch.entries.length && !(await confirmDialog({ title: 'Replace this channel\'s lineup?', body: h('p', {}, `CH ${ch.number} already has ${ch.entries.length} entries.`), confirmLabel: 'Replace' }))) return;
        const ids = (box) => [...box.querySelectorAll?.('input:checked') || []].map((x) => x.value);
        const headlines = !useHeadlines.checked ? [] : (selectedCount ? selectedHere : yearHeadlines).map(([ev]) => ev);
        const { entries } = await api('POST', `/api/schedules/${state.date}/autobuild`, {
          channelName: ch.name, channelNumber: ch.number, programIds: ids(progList), commercialIds: ids(adList),
          headlines, adsPerBreak: Number(perBreak.value), year: ch.year,
        });
        ch.entries = entries;
        markDirty();
        toast('Lineup built. Review it, then Save and Publish.');
      }),
    }, 'Build lineup')));

  // add segment
  const itemSel = h('select', {}, h('option', { value: '' }, 'Choose a clip…'),
    [...state.library].sort((a, b) => Number(!fits(a.year)) - Number(!fits(b.year))).map((i) => h('option', { value: i.id }, `[${i.category}] ${i.year || ''} ${i.title}${fits(i.year) ? '' : ` (not ${ch.year})`}`)));
  const segSel = h('select', {});
  const fillSegs = () => {
    const it = state.library.find((i) => i.id === itemSel.value);
    fill(segSel, h('option', { value: 'all' }, 'All parts'), ...(it?.segments || []).map((s) => h('option', { value: s.index }, `Part ${s.index + 1} · ${clock(s.duration)}${s.assetId ? '' : ' (not uploaded)'}`)));
  };
  itemSel.addEventListener('change', fillSegs);
  fillSegs();
  fill($('#addSegment'), h('div', { class: 'form' }, itemSel, segSel, h('button', {
    class: 'btn',
    onclick: () => {
      const it = state.library.find((i) => i.id === itemSel.value);
      if (!it) return toast('Pick a clip first', 'error');
      const segs = segSel.value === 'all' ? it.segments.map((s) => s.index) : [Number(segSel.value)];
      segs.forEach((s) => ch.entries.push({ type: 'segment', libraryId: it.id, segment: s }));
      markDirty();
    },
  }, 'Add to end')));

  // add card
  const style = h('select', {}, CARD_STYLES.map(([v, l]) => h('option', { value: v }, l)));
  const title = h('input', { placeholder: 'Title', maxlength: 80 });
  const text = h('textarea', { placeholder: 'Text', maxlength: 400 });
  const year = h('input', { type: 'number', placeholder: 'Year' });
  const dur = h('input', { type: 'number', min: 3, max: 60, value: 8 });
  const field = (l, el) => h('label', { class: 'field' }, l, el);
  fill($('#addCard'), h('div', { class: 'form' },
    h('p', { class: 'muted' }, 'Cards are text slides drawn in-game. They need no upload, so they cost nothing.'),
    field('Style', style), title, text, h('div', { class: 'row' }, field('Year', year), field('Seconds', dur)),
    h('button', { class: 'btn', onclick: () => addCard({ style: style.value, title: title.value, text: text.value, year: Number(year.value) || null, duration: Number(dur.value) || 8 }) }, 'Add to end')));
}

function addCard(card) {
  const ch = channel();
  if (!ch) return;
  ch.entries.push({ type: 'card', ...card });
  markDirty();
  toast(`Card added to CH ${ch.number}`);
}

function editCard(e) {
  const style = h('select', {}, CARD_STYLES.map(([v, l]) => h('option', { value: v }, l)));
  style.value = e.style;
  const title = h('input', { value: e.title || '', maxlength: 80 });
  const text = h('textarea', { maxlength: 400 }, e.text || '');
  const year = h('input', { type: 'number', value: e.year || '' });
  const dur = h('input', { type: 'number', min: 3, max: 60, value: e.duration });
  const field = (l, el) => h('label', { class: 'field' }, l, el);
  modal.open(h('h2', {}, 'Edit card'),
    h('div', { class: 'form' }, field('Style', style), field('Title', title), field('Text', text), h('div', { class: 'row' }, field('Year', year), field('Seconds', dur))),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', onclick: () => modal.close() }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          Object.assign(e, { style: style.value, title: title.value, text: text.value, year: Number(year.value) || null, duration: Number(dur.value) || 8 });
          modal.close();
          markDirty();
        },
      }, 'Apply')));
}

async function saveDraft() {
  const data = await api('PUT', `/api/schedules/${state.date}`, state.draft);
  state.draft = data.draft;
  state.cost = data.cost;
  state.dirty = false;
  renderLineup();
}

$('#saveBtn').addEventListener('click', guard(async () => {
  await saveDraft();
  toast('Lineup saved.');
}));

$('#previewBtn').addEventListener('click', guard(async () => {
  if (state.dirty) await saveDraft();
  const show = async (target) => {
    const { compiled, warnings } = await api('GET', `/api/schedules/${state.date}/compiled?target=${target}`);
    const tab = (t, label) => h('button', { 'aria-pressed': String(t === target), onclick: guard(() => show(t)) }, label);
    modal.open(h('h2', {}, 'What the player will receive'),
      h('div', { class: 'seg', style: { marginBottom: '10px' } }, tab('web', 'Website'), tab('roblox', 'Roblox')),
      warnings.length ? h('div', { class: 'warnings' }, h('ul', {}, warnings.map((w) => h('li', {}, w)))) : null,
      h('pre', { class: 'json' }, JSON.stringify(compiled, null, 2)),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => modal.close() }, 'Close')));
  };
  await show('web');
}));

function summarize(compiled) {
  if (!compiled.channels.length) return 'nothing playable';
  return compiled.channels.map((c) => `CH ${c.number}: ${c.items.length} items, ${clock(c.totalDuration)} loop`).join(' · ');
}

$('#publishBtn').addEventListener('click', guard(async () => {
  if (state.dirty) await saveDraft();
  const [web, rbx] = await Promise.all([
    api('GET', `/api/schedules/${state.date}/compiled?target=web`),
    api('GET', `/api/schedules/${state.date}/compiled?target=roblox`),
  ]);
  const webBox = h('input', { type: 'checkbox', checked: web.compiled.channels.length > 0, disabled: !web.compiled.channels.length });
  const rbxReady = state.status.roblox.canPublish && rbx.compiled.channels.length > 0;
  const rbxBox = h('input', { type: 'checkbox', checked: rbxReady, disabled: !rbxReady });
  const target = (box, title, detail, warnings) => h('div', { class: 'cost', style: { marginTop: '10px' } },
    h('label', { class: 'check' }, box, h('strong', {}, title)),
    h('div', { class: 'muted' }, detail),
    warnings.length ? h('ul', { class: 'muted', style: { margin: '6px 0 0', paddingLeft: '18px' } }, warnings.slice(0, 6).map((w) => h('li', {}, w)), warnings.length > 6 ? h('li', {}, `…and ${warnings.length - 6} more`) : null) : null);
  const go = h('button', { class: 'btn primary' }, 'Publish');
  const done = (v) => { modal.close(); resolve(v); };
  let resolve;
  const chosen = new Promise((r) => { resolve = r; });
  go.addEventListener('click', () => done([webBox.checked && 'web', rbxBox.checked && 'roblox'].filter(Boolean)));
  modal.open(
    h('h2', {}, `Publish ${prettyDate(state.date)}`),
    h('p', { class: 'muted' }, `The lineup replays on ${prettyDate(state.date)} every year until you change it.`),
    target(webBox, 'Website', `${summarize(web.compiled)}. Written to web/schedules/${state.date}.json; deploy the web/ folder to put it online.`, web.warnings),
    target(rbxBox, 'Roblox', state.status.roblox.canPublish ? `${summarize(rbx.compiled)}. Live servers switch within seconds.` : 'Not configured. Add a Roblox API key and universe ID in admin/.env to enable this.', state.status.roblox.canPublish ? rbx.warnings : []),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'), go),
  );
  $('#modal').addEventListener('close', () => resolve(null), { once: true });
  const targets = await chosen;
  if (!targets?.length) return;
  const res = await api('POST', `/api/schedules/${state.date}/publish`, { targets });
  if (res.results.web?.ok) state.webPublished = res.publishedAt;
  if (res.results.roblox?.ok) state.published = { publishedAt: res.publishedAt };
  renderLineup();
  const msgs = [];
  if (res.results.web?.ok) msgs.push(`Website updated (${res.results.web.file})`);
  if (res.results.roblox?.ok) msgs.push(`Roblox DataStore ${res.results.roblox.datastore}${res.results.roblox.notified ? ', live servers notified' : ''}`);
  toast(`Published: ${msgs.join(' · ')}`, 'info', 7000);
  Object.entries(res.results).filter(([, r]) => !r.ok).forEach(([t, r]) => toast(`${t}: ${r.warnings.at(-1)}`, 'error', 9000));
}));

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ------------------------------------------------------------------ setup
function renderSetup() {
  const s = state.status;
  const check = (ok, label, detail) => h('div', { class: `check ${ok ? 'ok' : ''}` }, h('span', { class: 'dot' }), h('div', {}, h('strong', {}, label), detail ? h('div', { class: 'muted' }, detail) : null));
  fill($('#setup'), h('div', { class: 'setup-grid' },
    h('div', { class: 'setup-card' },
      h('h3', {}, 'Website'),
      check(s.web.exists, 'TV site', s.web.exists ? s.web.dir : `No web/index.html at ${s.web.dir} (WEB_DIR)`),
      h('p', {}, 'Preview it locally at ', h('a', { href: '/tv/', target: '_blank', rel: 'noopener' }, '/tv/'), '. Publishing writes ', h('code', {}, 'web/schedules/MM-DD.json'), '.'),
      h('p', {}, 'To put it online, deploy the ', h('code', {}, 'web/'), ' folder to any static host, such as GitHub Pages, Netlify or Cloudflare Pages, and redeploy after each publish. Video streams straight from archive.org, so hosting stays free.'),
      h('p', { class: 'muted' }, `Long programs are split into ${clock(s.media.webActSeconds)} acts (WEB_ACT_SECONDS) so commercials can go between them.`)),
    h('div', { class: 'setup-card' },
      h('h3', {}, 'Configuration'),
      check(s.ffmpeg, 'ffmpeg + ffprobe', s.ffmpeg ? 'Ready to download and transcode.' : 'Install with: brew install ffmpeg'),
      check(true, 'archive.org search', 'No key needed.'),
      check(s.exa, 'Exa.ai search', s.exa ? 'EXA_API_KEY set.' : 'Optional. Add EXA_API_KEY to admin/.env.'),
      check(s.roblox.apiKey, 'Roblox Open Cloud API key', 'ROBLOX_API_KEY'),
      check(Boolean(s.roblox.creator), 'Asset creator', s.roblox.creator || 'ROBLOX_CREATOR_USER_ID or ROBLOX_CREATOR_GROUP_ID'),
      check(Boolean(s.roblox.universeId), 'Experience (universe)', s.roblox.universeId || 'ROBLOX_UNIVERSE_ID'),
      h('p', { class: 'muted' }, `Station timezone ${s.timezone}. DataStore "${s.roblox.dataStore}" · topic "${s.roblox.topic}". These must match roblox/src/shared/Config.luau.`)),
    h('div', { class: 'setup-card' },
      h('h3', {}, 'Daily workflow'),
      h('ol', {},
        h('li', {}, 'Pick the day at the top. Lineups are stored by month and day, so each one replays every year.'),
        h('li', {}, 'Find programming: start with archive.org for this date, add era commercials, and tick some headlines.'),
        h('li', {}, 'Add to library. Choose "Stream on the website" (free) or "Download & cut for Roblox".'),
        h('li', {}, 'Lineup tab: Auto-build, adjust, Save, then Publish to the website and/or Roblox.'),
        h('li', {}, 'Website: redeploy the web/ folder. Roblox: live servers switch over within seconds.'))),
    h('div', { class: 'setup-card' },
      h('h3', {}, 'Costs & limits (Roblox only — the website is free)'),
      h('ul', {},
        h('li', {}, `Video: ${robux(s.roblox.videoPrice)} per upload, 5 minutes or less, 20 a day, ID-verified account aged 13 or over.`),
        h('li', {}, 'Audio: 7 minutes or less, no Robux, monthly cap (100 if ID-verified).'),
        h('li', {}, 'Cards (headlines, station IDs) are drawn in-game and cost nothing.'),
        h('li', {}, 'Each player plays one video at a time. Roblox allows 2 at once.')),
      h('p', { class: 'muted' }, 'To keep costs down, use short clips (one part each), real commercials (30–60 seconds), audio newscasts, and headline cards.')),
  ));
}

// ------------------------------------------------------------------ boot
(async function boot() {
  initDateControls();
  try {
    state.status = await api('GET', '/api/status');
  } catch (err) {
    document.body.prepend(h('div', { class: 'warnings' }, `Cannot reach the admin server: ${err.message}`));
    return;
  }
  state.from = Number(storage.get('tdtv-from')) || state.status.yearFrom;
  state.to = Number(storage.get('tdtv-to')) || state.status.yearTo;
  $('#yearFrom').value = state.from;
  $('#yearTo').value = state.to;
  renderChips();
  await loadLibrary().catch((err) => toast(err.message, 'error'));
  await setDate(state.status.today);
  setFindSource('archive');
  state.booted = true;
  const fromHash = location.hash.slice(1);
  showTab(['find', 'library', 'lineup', 'setup'].includes(fromHash) ? fromHash : storage.get('tdtv-tab') || 'find');
  $('#findForm').requestSubmit();
  const { jobs } = await api('GET', '/api/jobs').catch(() => ({ jobs: [] }));
  jobs.filter((j) => j.status === 'running' || j.status === 'queued').forEach(trackJob);
})();
