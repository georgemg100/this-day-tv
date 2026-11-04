process.env.NODE_ENV = 'test';
process.env.DATA_DIR = `/tmp/tdtv-test-${process.pid}`;

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMMDD, validYears, dateForms, utcOffsetMinutes, todayMMDD, parseClock } from '../lib/dates.js';
import { buildDateQueries, matchedYear, classifyRights, scoreDoc, sanitizeFreeText } from '../lib/archive.js';
import { archiveIdFromUrl, buildExaQueries } from '../lib/exa.js';
import { planSegments, videoBitrateKbps } from '../lib/media.js';
import { normalizeDraft, autoBuild, compile, uploadCost } from '../lib/schedule.js';

test('dates', () => {
  assert.deepEqual(parseMMDD('11-03'), { mm: 11, dd: 3, key: '11-03' });
  assert.throws(() => parseMMDD('13-01'));
  assert.throws(() => parseMMDD('02-30'));
  assert.equal(parseMMDD('02-29').key, '02-29');
  assert.deepEqual(validYears(2, 29, 1960, 1970), [1960, 1964, 1968]);
  assert.ok(dateForms(1967, 11, 3).includes('November 3, 1967'));
  assert.ok(dateForms(1967, 11, 3).includes('1967/11/03'));
  assert.equal(utcOffsetMinutes('America/New_York', new Date('2026-11-03T12:00:00Z')), -300);
  assert.equal(utcOffsetMinutes('America/New_York', new Date('2026-07-01T12:00:00Z')), -240);
  assert.equal(todayMMDD('America/New_York', new Date('2026-11-03T04:30:00Z')), '11-02');
  assert.equal(parseClock('4:55'), 295);
  assert.equal(parseClock('1:00:00'), 3600);
  assert.equal(parseClock(''), null);
});

test('archive query building', () => {
  const qs = buildDateQueries(11, 3, 1960, 1999);
  assert.equal(qs[0].strategy, 'date');
  assert.match(qs[0].q, /date:\[1960-11-03 TO 1960-11-03\]/);
  assert.match(qs[1].q, /identifier:1967-11-03\*/);
  assert.equal(qs.filter((q) => q.strategy === 'title').length, 4, 'one title query per decade');
  for (const q of qs) assert.ok(q.q.length < 6000, `query too long: ${q.q.length}`);
  // Feb 29 skips non-leap years entirely (Solr rejects invalid dates)
  assert.doesNotMatch(buildDateQueries(2, 29, 1960, 1970)[0].q, /1961-02-29/);
  assert.match(buildDateQueries(11, 3, 1960, 1969, 'audio')[0].q, /^mediatype:audio/);
});

test('archive matching, rights and scoring', () => {
  assert.equal(matchedYear({ identifier: '1967-11-03_England', date: '1967-01-01' }, 11, 3, 1960, 1999), 1967);
  assert.equal(matchedYear({ identifier: 'x', date: '1976-11-03T00:00:00Z' }, 11, 3, 1960, 1999), 1976);
  assert.equal(matchedYear({ identifier: 'casjhsj', title: 'KNTV News Reels November 3, 1965' }, 11, 3, 1960, 1999), 1965);
  assert.equal(matchedYear({ identifier: 'x', date: '1976-11-04' }, 11, 3, 1960, 1999), null);

  assert.equal(classifyRights({ licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' }).rights, 'claimed-public-domain', 'uploader PD claims are not trusted');
  assert.equal(classifyRights({ licenseurl: 'http://creativecommons.org/licenses/publicdomain/', collection: ['universal_newsreels'] }).rights, 'public-domain');
  assert.equal(classifyRights({ collection: ['universal_newsreels'] }).rights, 'likely-public-domain');
  assert.equal(classifyRights({}).rights, 'unknown');

  const newsreel = scoreDoc({ identifier: '1967-11-03_Inauguration', title: 'Inauguration', collection: ['universal_newsreels'] }, ['identifier']);
  const rip = scoreDoc({ identifier: 'carrie.-1976.1080p', title: 'Carrie 1080p', collection: ['feature_films'] }, ['date']);
  assert.ok(newsreel > rip + 50, `${newsreel} vs ${rip}`);
});

test('free-text sanitising', () => {
  assert.equal(sanitizeFreeText('moon landing'), 'moon landing');
  assert.equal(sanitizeFreeText('a) OR (collection:x'), 'a OR collection x');
  assert.equal(sanitizeFreeText('"unbalanced'), 'unbalanced');
  assert.throws(() => sanitizeFreeText('()'));
});

test('exa helpers', () => {
  assert.equal(archiveIdFromUrl('https://archive.org/details/casjhsj_000130?x=1'), 'casjhsj_000130');
  assert.equal(archiveIdFromUrl('https://youtube.com/watch?v=1'), null);
  assert.equal(buildExaQueries({ mm: 11, dd: 3, from: 1960, to: 1999 }).length, 4);
  assert.match(buildExaQueries({ mm: 11, dd: 3, year: 1967 })[0], /November 3, 1967/);
});

test('segment planning and bitrate', () => {
  assert.equal(planSegments(0, 120, 295).length, 1);
  const p = planSegments(0, 1800, 295); // 30-minute episode
  assert.equal(p.length, 7);
  assert.ok(p.every((s) => s.duration <= 295));
  assert.ok(Math.abs(p[6].start + p[6].duration - 1800) < 1e-6);
  assert.equal(planSegments(10, 305, 295).length, 1, 'exactly max length is one part');
  assert.throws(() => planSegments(10, 10, 295));
  // 295 s must fit in 19 MB: (kbps * 295 s / 8) KB < 19,000 KB
  const kbps = videoBitrateKbps(295, 19);
  assert.ok(((kbps + 96) * 295) / 8 < 19000, `${kbps} kbps too high`);
  assert.ok(videoBitrateKbps(20, 19) <= 2000, 'short clips are capped');
});

const library = [
  { id: 'p1', kind: 'video', category: 'program', title: 'Newsreel', year: 1967, airDate: '1967-11-03', credit: 'archive.org/details/a',
    segments: [{ index: 0, duration: 200, assetId: '111' }, { index: 1, duration: 150, assetId: null }] },
  { id: 'p0', kind: 'video', category: 'news', title: 'Evening News', year: 1965,
    segments: [{ index: 0, duration: 280, assetId: '222' }] },
  { id: 'c1', kind: 'video', category: 'commercial', title: 'Cereal ad', year: 1966, segments: [{ index: 0, duration: 30, assetId: '333' }] },
  { id: 'r1', kind: 'audio', category: 'news', title: 'Radio bulletin', year: 1969, segments: [{ index: 0, duration: 400, assetId: '444' }] },
];

test('normalizeDraft validates', () => {
  assert.throws(() => normalizeDraft('11-03', { channels: [{ number: 1 }] }), /2–83/);
  assert.throws(() => normalizeDraft('11-03', { channels: [{ number: 4 }, { number: 4 }] }), /twice/);
  assert.throws(() => normalizeDraft('11-03', { channels: [{ number: 4, entries: [{ type: 'x' }] }] }));
  const d = normalizeDraft('11-03', { channels: [{ number: 4, name: 'WTDI', entries: [{ type: 'card', title: 'Hi', duration: 999 }] }] });
  assert.equal(d.channels[0].entries[0].duration, 60, 'card duration clamped');
  assert.ok(d.channels[0].entries[0].id);
});

test('autoBuild lays out a broadcast day', () => {
  const entries = autoBuild({
    key: '11-03', channel: { name: 'WTDI', number: 4 }, library,
    programIds: ['p1', 'p0'], commercialIds: ['c1'],
    headlines: [{ year: 1967, text: 'Thieu sworn in' }, { year: 1980, text: 'Something else' }],
  });
  const kinds = entries.map((e) => (e.type === 'card' ? `card:${e.style}` : e.libraryId));
  assert.equal(kinds[0], 'card:station-id');
  assert.equal(kinds.at(-1), 'card:sign-off');
  assert.equal(kinds[1], 'p0', 'oldest program first (1965, no headline that year)');
  const p1first = kinds.indexOf('p1');
  assert.equal(kinds[p1first - 1], 'card:headline', '1967 headline introduces the 1967 program');
  assert.equal(kinds[p1first + 1], 'card:break', 'break between parts');
  assert.equal(kinds[p1first + 2], 'c1');
  assert.ok(kinds.includes('card:custom'), 'leftover headlines get a roundup');
});

test('compile skips unuploaded parts and totals durations', () => {
  const draft = normalizeDraft('11-03', {
    channels: [
      { number: 4, name: 'WTDI', entries: [
        { type: 'card', style: 'station-id', title: 'ID', duration: 8 },
        { type: 'segment', libraryId: 'p1', segment: 0 },
        { type: 'segment', libraryId: 'p1', segment: 1 },
        { type: 'segment', libraryId: 'gone', segment: 0 },
        { type: 'segment', libraryId: 'r1', segment: 0 },
      ] },
      { number: 7, name: 'EMPTY', entries: [{ type: 'segment', libraryId: 'p1', segment: 1 }] },
    ],
  });
  const { compiled, warnings } = compile(draft, library, { publishedAt: 'now' });
  assert.equal(compiled.channels.length, 1, 'empty channel left off air');
  const ch = compiled.channels[0];
  assert.deepEqual(ch.items.map((i) => i.kind), ['card', 'video', 'audio']);
  assert.equal(ch.totalDuration, 8 + 200 + 400);
  assert.equal(ch.items[1].assetId, '111');
  assert.equal(ch.items[1].part, 1);
  assert.equal(ch.items[1].parts, 2);
  assert.equal(warnings.length, 4);
  assert.ok(!ch.items.some((i) => '_lib' in i), 'internal marker stripped');
  assert.deepEqual(uploadCost(draft, library, 2000), { videosToUpload: 1, robux: 2000 }, 'same part on two channels counted once');
});

test('tidyBreaks removes orphaned breaks and repeated ads', async () => {
  const { tidyBreaks } = await import('../lib/schedule.js');
  const ad = (id) => ({ kind: 'video', category: 'commercial', assetId: id, duration: 30 });
  const prog = (lib, part) => ({ kind: 'video', category: 'program', assetId: `${lib}${part}`, _lib: lib, duration: 200 });
  const brk = () => ({ kind: 'card', style: 'break', duration: 4 });
  const items = [prog('A', 1), brk(), ad('x'), prog('A', 2), brk(), ad('x'), ad('x'), prog('B', 1), ad('y')];
  tidyBreaks(items);
  assert.deepEqual(items.map((i) => i.style || i.assetId), ['A1', 'break', 'x', 'A2', 'x', 'B1', 'y']);
});
