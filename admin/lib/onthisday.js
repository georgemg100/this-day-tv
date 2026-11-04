// Wikipedia "On this day" -> free headline cards between programs.
// Uses events plus deaths: for a single broadcast year there are only a few
// events per date, and "died today" is news a broadcast would carry. (Births
// are skipped: nobody knew in 1967 who a newborn would become.)
import { fetchJson } from './http.js';
import { pad2 } from './dates.js';

const cache = new Map();

export async function onThisDay({ mm, dd, from, to }) {
  const key = `${pad2(mm)}-${pad2(dd)}`;
  let all = cache.get(key);
  if (!all) {
    const body = await fetchJson(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${pad2(mm)}/${pad2(dd)}`);
    const shape = (kind) => (e) => ({
      year: e.year,
      kind,
      text: e.text,
      link: e.pages?.[0]?.content_urls?.desktop?.page || null,
    });
    all = [...(body?.events || []).map(shape('event')), ...(body?.deaths || []).map(shape('death'))];
    cache.set(key, all);
  }
  return {
    results: all.filter((e) => e.year >= from && e.year <= to).sort((a, b) => a.year - b.year || (a.kind === 'event' ? -1 : 1)),
  };
}
