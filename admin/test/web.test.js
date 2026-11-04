process.env.NODE_ENV = 'test';
process.env.DATA_DIR = `/tmp/tdtv-test-web-${process.pid}`;

import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../web/js/broadcast.js';
import { compile, normalizeDraft, uploadCost, webSource } from '../lib/schedule.js';

const TZ = 'America/New_York';
const ts = (iso) => Date.parse(iso) / 1000;

test('web: station day and DST', () => {
  assert.equal(B.utcOffsetSeconds(TZ, ts('2026-11-03T12:00:00Z')), -18000);
  assert.equal(B.utcOffsetSeconds(TZ, ts('2026-07-01T12:00:00Z')), -14400);
  assert.equal(B.stationDay(ts('2026-11-03T04:30:00Z'), TZ).key, '11-02');
  const d = B.stationDay(ts('2026-11-03T05:30:00Z'), TZ);
  assert.equal(d.key, '11-03');
  assert.equal(d.anchor, ts('2026-11-03T05:00:00Z'));
  // DST-change day: midnight is still EDT (UTC-4) even though "now" is EST.
  assert.equal(B.stationDay(ts('2026-11-01T20:00:00Z'), TZ).anchor, ts('2026-11-01T04:00:00Z'));
  assert.equal(B.localClock(ts('2026-11-04T01:05:00Z'), TZ), '8:05 PM');
});

test('web: sanitize + locate + upcoming', () => {
  const s = B.sanitize({ channels: [{ number: 4, name: 'WTDI', items: [
    { kind: 'card', duration: 10, title: 'ID' },
    { kind: 'video', duration: 100, src: 'https://archive.org/download/x/x.mp4', start: 30 },
    { kind: 'video', duration: 50, src: 'javascript:alert(1)' },
    { kind: 'audio', duration: 40, src: 'https://archive.org/download/y/y.mp3' },
    { kind: 'video', duration: 0, src: 'https://a.org/z.mp4' },
  ] }, { number: 2, items: [] }] });
  assert.equal(s.channels.length, 1);
  const ch = s.channels[0];
  assert.equal(ch.items.length, 3, 'non-http src and zero durations dropped');
  assert.equal(ch.totalDuration, 150);
  assert.equal(ch.items[1].start, 30);

  const anchor = 1000;
  assert.deepEqual(B.locate(ch, anchor + 115, anchor), { index: 2, offset: 5, startedAt: anchor + 110 });
  assert.deepEqual(B.locate(ch, anchor + 150 * 3 + 12, anchor), { index: 1, offset: 2, startedAt: anchor + 460 });
  assert.equal(B.locate(ch, anchor - 1, anchor).index, 2, 'before the anchor still lands in the loop');
  const up = B.upcoming(ch, anchor + 115, anchor, 3);
  assert.deepEqual(up.map((u) => u.startsAt), [anchor + 110, anchor + 150, anchor + 160]);
});

test('web: headline fallback is one year per channel', () => {
  const day = { key: '11-03', month: 11, day: 3 };
  const s = B.headlineSchedule([
    { year: 1955, text: 'too early', kind: 'event' },
    { year: 1967, text: 'Thieu sworn in', kind: 'event' },
    { year: 1967, text: 'Someone', kind: 'death' },
    { year: 1969, text: 'Nixon speech', kind: 'event' },
  ], day);
  assert.deepEqual(s.channels.map((c) => c.year), [1967, 1969]);
  for (const ch of s.channels) {
    assert.ok(ch.items.filter((i) => i.year).every((i) => i.year === ch.year), 'no mixed years on a channel');
  }
  const c67 = s.channels[0].items;
  assert.equal(c67[0].style, 'station-id');
  assert.match(c67[0].text, /November 3, 1967/);
  assert.ok(c67.some((i) => /^Died today: Someone/.test(i.text || '')));
  assert.equal(B.headlineSchedule([], day), null);
});

const library = [
  { id: 's1', kind: 'video', category: 'program', delivery: 'stream', title: 'Coffee House', year: 1969,
    source: { type: 'archive', identifier: 'coffee', file: 'coffee.mp4' },
    segments: [{ index: 0, src: 'https://archive.org/download/coffee/coffee.mp4', start: 0, duration: 720 }, { index: 1, src: 'https://archive.org/download/coffee/coffee.mp4', start: 720, duration: 700 }] },
  { id: 'd1', kind: 'video', category: 'news', title: 'Thieu Sworn In', year: 1967,
    source: { type: 'archive', identifier: '1967-11-03_Inauguration', file: 'dir/Inauguration clip.mp4' },
    segments: [{ index: 0, file: 'library/d1/seg_00.mp4', sourceStart: 12.5, duration: 30, assetId: '999' }] },
  { id: 'm1', kind: 'video', category: 'commercial', title: 'Manual ad', source: { type: 'manual' },
    segments: [{ index: 0, duration: 30, assetId: '555' }] },
];

test('webSource resolves streams and downloaded archive items', () => {
  assert.deepEqual(webSource(library[0], library[0].segments[1]), { src: 'https://archive.org/download/coffee/coffee.mp4', start: 720 });
  assert.deepEqual(webSource(library[1], library[1].segments[0]), { src: 'https://archive.org/download/1967-11-03_Inauguration/dir/Inauguration%20clip.mp4', start: 12.5 });
  assert.equal(webSource(library[2], library[2].segments[0]), null);
});

test('compile per target', () => {
  const draft = normalizeDraft('11-03', { channels: [{ number: 4, name: 'WTDI', entries: [
    { type: 'segment', libraryId: 's1', segment: 0 },
    { type: 'segment', libraryId: 'm1', segment: 0 },
    { type: 'segment', libraryId: 's1', segment: 1 },
    { type: 'segment', libraryId: 'd1', segment: 0 },
  ] }] });
  const web = compile(draft, library, { target: 'web' });
  assert.equal(web.compiled.target, 'web');
  assert.deepEqual(web.compiled.channels[0].items.map((i) => i.start), [0, 720, 12.5]);
  assert.ok(web.compiled.channels[0].items.every((i) => i.src && !i.assetId));
  assert.match(web.warnings[0], /only as a Roblox asset/);

  const rbx = compile(draft, library, { target: 'roblox' });
  assert.deepEqual(rbx.compiled.channels[0].items.map((i) => i.assetId), ['555', '999']);
  assert.ok(rbx.warnings.some((w) => /streamed \(website only\)/.test(w)));
  assert.deepEqual(uploadCost(draft, library, 2000), { videosToUpload: 0, robux: 0 }, 'streamed items never cost Robux');

  // What the web player would accept
  assert.equal(B.sanitize(web.compiled).channels[0].items.length, 3);
});

test('streamed commercials are not mistaken for repeats', async () => {
  const { tidyBreaks } = await import('../lib/schedule.js');
  const ad = (lib) => ({ kind: 'video', category: 'commercial', src: `https://a.org/${lib}.mp4`, start: 0, _lib: lib, part: 1, duration: 30 });
  const items = [ad('life'), ad('puss'), ad('puss'), ad('raid')];
  tidyBreaks(items);
  assert.deepEqual(items.map((i) => i.src.slice(14, -4)), ['life', 'puss', 'raid']);
});

test('channel years: draft, auto-build, compile', async () => {
  const { autoBuild } = await import('../lib/schedule.js');
  const lib = [
    { id: 'n67', kind: 'video', category: 'news', title: 'Newsreel', year: 1967, segments: [{ index: 0, src: 'https://a.org/n.mp4', start: 0, duration: 40 }] },
    { id: 'p69', kind: 'video', category: 'program', title: 'Show', year: 1969, segments: [{ index: 0, src: 'https://a.org/p.mp4', start: 0, duration: 600 }] },
    { id: 'a67', kind: 'video', category: 'commercial', title: 'Ad 67', year: 1967, segments: [{ index: 0, src: 'https://a.org/a.mp4', start: 0, duration: 30 }] },
    { id: 'a69', kind: 'video', category: 'commercial', title: 'Ad 69', year: 1969, segments: [{ index: 0, src: 'https://a.org/b.mp4', start: 0, duration: 30 }] },
  ];
  assert.throws(() => normalizeDraft('11-03', { channels: [{ number: 4, year: 1066 }] }), /year/);
  const entries = autoBuild({
    key: '11-03', channel: { name: 'WTDI', number: 4 }, library: lib, year: 1967,
    programIds: ['n67', 'p69'], commercialIds: ['a67', 'a69'],
    headlines: [{ year: 1967, text: 'Thieu', kind: 'event' }, { year: 1975, text: 'Off year' }, { year: 1967, text: 'Someone', kind: 'death' }],
  });
  const ids = entries.filter((e) => e.type === 'segment').map((e) => e.libraryId);
  assert.ok(!ids.includes('p69') && !ids.includes('a69'), 'other years left out');
  assert.ok(ids.includes('n67') && ids.includes('a67'));
  const cards = entries.filter((e) => e.type === 'card');
  assert.match(cards[0].text, /November 3, 1967/);
  assert.ok(!cards.some((c) => /Off year/.test(c.text)));
  assert.ok(cards.some((c) => /^Died today: Someone/.test(c.text)));

  const draft = normalizeDraft('11-03', { channels: [
    { number: 4, name: 'WTDI', year: 1967, entries: [{ type: 'segment', libraryId: 'n67', segment: 0 }, { type: 'segment', libraryId: 'p69', segment: 0 }] },
    { number: 7, name: 'WKTV', year: 1969, entries: [{ type: 'segment', libraryId: 'p69', segment: 0 }] },
  ] });
  const { compiled, warnings } = compile(draft, lib, { target: 'web' });
  assert.deepEqual(compiled.channels.map((c) => c.year), [1967, 1969]);
  assert.deepEqual(warnings, ['CH 4: "Show" is from 1969, not 1967']);
  assert.deepEqual(B.sanitize(compiled).channels.map((c) => c.year), [1967, 1969], 'player keeps channel years');
});

test('single-year archive queries', async () => {
  const { buildYearQueries, docDate } = await import('../lib/archive.js');
  const qs = buildYearQueries(11, 3, 1967);
  assert.deepEqual(qs.map((q) => q.strategy), ['date', 'identifier', 'title', 'week', 'year']);
  assert.match(qs[3].q, /date:\[1967-10-27 TO 1967-11-10\]/);
  assert.match(qs[3].q, /identifier:1967-11-06\*/);
  assert.match(qs[4].q, /year:1967/);
  assert.equal(docDate({ identifier: '1967-11-06_Parade' }), '1967-11-06');
  assert.equal(docDate({ identifier: 'x', date: '1967-11-05T00:00:00Z' }), '1967-11-05');
  assert.equal(docDate({ identifier: 'x', date: '1967-01-01T00:00:00Z' }), null, 'year-only dates are not real days');
});

test('auto-build orders news first, then nearest air dates', async () => {
  const { autoBuild } = await import('../lib/schedule.js');
  const seg = [{ index: 0, src: 'https://a.org/x.mp4', start: 0, duration: 60 }];
  const lib = [
    { id: 'prog', kind: 'video', category: 'program', title: 'Show', year: 1969, airDate: '1969-11-03', segments: seg },
    { id: 'oldnews', kind: 'video', category: 'news', title: 'Old news', year: 1969, airDate: '1969-08-01', segments: seg },
    { id: 'news', kind: 'video', category: 'news', title: 'Speech', year: 1969, airDate: '1969-11-03', segments: seg },
  ];
  const ids = autoBuild({ key: '11-03', channel: { name: 'W', number: 7 }, library: lib, year: 1969, programIds: ['prog', 'oldnews', 'news'] })
    .filter((e) => e.type === 'segment').map((e) => e.libraryId);
  assert.deepEqual(ids, ['news', 'oldnews', 'prog']);
});

test('autopilot helpers', async () => {
  const { cleanTitle, titleKey, looksLikeJunk } = await import('../lib/autopilot.js');
  assert.equal(cleanTitle('Inauguration. Thieu Sworn In, Stresses Peace, 1967/11/03'), 'Thieu Sworn In, Stresses Peace');
  assert.equal(cleanTitle('England, 1967/11/03', 'SS Queen Mary on final journey (partial newsreel).'), 'SS Queen Mary on final journey');
  assert.equal(cleanTitle('Pollution Below', 'Presents stories of three people.'), 'Pollution Below', 'real short titles are kept');
  assert.equal(cleanTitle('JSC 818 Space Shuttle Columbia Second Flight.wmv'), 'JSC 818 Space Shuttle Columbia Second Flight');
  assert.equal(cleanTitle('[Bradley: Second to None]'), 'Bradley: Second to None');
  assert.deepEqual(titleKey('Coffee House Rendezvous (Part I)'), { base: 'coffee house rendezvous', part: 'i' });
  assert.equal(titleKey('Coffee House Rendezvous').part, 'whole');
  assert.ok(looksLikeJunk('#Bfl O {ggGX = STwWcfl x 2s4'));
  assert.ok(!looksLikeJunk("McDonald's Commercials"));
  assert.ok(!looksLikeJunk("Invasion Scare. Castro Masses Troops, Claims U.S. 'Aggression'"));
});

test('exact-date evidence filters', async () => {
  const { airedThatDay, looksLikeCompilation, looksLikeMeeting, cleanTitle } = await import('../lib/autopilot.js');
  const r = (title, strategies, collections, airYear = 1969) => ({ title, strategies, collections, airYear, airDate: `${airYear}-11-03`, identifier: 'x' });
  assert.ok(airedThatDay(r('Richard Nixon Nov. 3, 1969 Speech Excerpt', ['title'], [])));
  assert.ok(airedThatDay(r('1993 11 03 The Late Show With David Letterman', ['date'], ['opensource_movies'], 1993)));
  assert.ok(airedThatDay(r('The New Price is Right (November 3, 1972)', ['title'], ['gameshow_tpir'], 1972)));
  assert.ok(!airedThatDay(r('Prescription Thugs', ['title'], ['opensource_movies', 'community'], 1972)), 'date only in description, untrusted collection');
  assert.ok(!airedThatDay(r('How U.S. Air Cavalry Evolved', ['title'], ['altcensored', 'fringe'], 1965)));
  assert.ok(airedThatDay(r('Wally, the Author (Ozzie & Harriet)', ['date'], ['classic_tv_1960s'], 1965)), 'classic TV date field = air date');
  assert.ok(!airedThatDay(r('Carrie (50th Anniversary)', ['date', 'title'], ['opensource_movies'], 1976)), 'release date in description is not an air date');
  assert.ok(!airedThatDay(r('The Who Live At The Isle of Wight Festival 1970', ['date'], ['classic_tv'], 1998)), 'title names another year');
  assert.ok(!airedThatDay(r('Reel America 1970 : CSPAN2 : August 21, 2021', ['title'], [], 1969)));
  assert.ok(!airedThatDay(r('0236 NM International GOP Women November 11, 1993', ['date'], ['classic_tv'], 1993)), 'title names a different day');
  assert.ok(airedThatDay(r('WDBJ-7 (CBS) Full Newscast: November 3, 1989', ['title'], [], 1989)));
  assert.ok(looksLikeCompilation('Pingu: The Complete Series 2 (1991-94)'));
  assert.ok(!looksLikeCompilation('General Hospital- November 3, 1989 (most)'));
  assert.ok(looksLikeMeeting('Amherst Select Board Meeting - November 3, 1997'));
  assert.ok(!looksLikeMeeting('Live With Regis And Kathie Lee'));
  assert.equal(cleanTitle('Richard Nixon Nov. 3, 1969 Speech Excerpt'), 'Richard Nixon Nov. 3, 1969 Speech Excerpt');
});

test('historical relevance ranks news and the day\'s stories first', async () => {
  const { historyScore, headlineMatch } = await import('../lib/autopilot.js');
  const heads = [{ year: 1969, text: 'Vietnam War: U.S. President Richard Nixon addresses the nation on television and radio, asking the silent majority to join him.' }];
  const nixon = { title: 'Richard Nixon Nov. 3, 1969 Speech Excerpt', description: 'United for Peace', collections: [] };
  const game = { title: 'The New Price is Right (November 3, 1972)', description: '', collections: ['gameshow_tpir'] };
  const reel = { title: 'KNTV Channel 11 News Reels November 3, 1965', description: '', collections: [] };
  assert.deepEqual(headlineMatch(nixon, heads).shared.sort(), ['nixon', 'richard']);
  assert.ok(historyScore(nixon, heads) >= 60, 'speech matching the headline scores highest');
  assert.ok(historyScore(reel, []) > historyScore(game, []), 'news beats game shows');
  assert.ok(historyScore(game, []) < 0);
});
