// Exa.ai neural search. Good at finding pages that *describe* a broadcast
// ("CBS Evening News, November 3, 1966") that keyword search on archive.org
// misses. Results restricted to archive.org can be ingested directly; other
// results are shown as research leads only.

import { config, HttpError } from './config.js';
import { fetchJson } from './http.js';
import { MONTHS } from './dates.js';

export function archiveIdFromUrl(url) {
  const m = /archive\.org\/(?:details|download|embed)\/([^/?#]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export function buildExaQueries({ mm, dd, year, from, to, text }) {
  const day = `${MONTHS[mm - 1]} ${dd}`;
  const topic = text ? ` ${text}` : '';
  if (year) return [`${day}, ${year} television broadcast or newsreel footage${topic}`];
  const queries = [];
  for (let start = from - (from % 10); start <= to; start += 10) {
    queries.push(`${day} ${start}s television broadcast, newscast or newsreel footage${topic}`);
  }
  return queries;
}

export async function exaSearch({ mm, dd, year, from, to, text = '', archiveOnly = true, perQuery = 10 }) {
  if (!config.exaApiKey) throw new HttpError(400, 'EXA_API_KEY is not set in admin/.env');
  const queries = buildExaQueries({ mm, dd, year, from, to, text });
  const settled = await Promise.allSettled(
    queries.map((query) =>
      fetchJson('https://api.exa.ai/search', {
        method: 'POST',
        timeoutMs: 30000,
        headers: { 'x-api-key': config.exaApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          type: 'auto',
          numResults: perQuery,
          ...(archiveOnly ? { includeDomains: ['archive.org'] } : {}),
          contents: { highlights: true },
        }),
      }).then((body) => ({ query, body })),
    ),
  );
  const seen = new Set();
  const results = [];
  const errors = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      errors.push(r.reason.message);
      continue;
    }
    for (const hit of r.value.body?.results || []) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      const archiveId = archiveIdFromUrl(hit.url);
      results.push({
        title: hit.title || hit.url,
        url: hit.url,
        publishedDate: hit.publishedDate || null,
        highlights: (hit.highlights || []).slice(0, 2),
        archiveId,
        thumb: archiveId ? `https://archive.org/services/img/${archiveId}` : hit.image || null,
        query: r.value.query,
      });
    }
  }
  if (!results.length && errors.length) throw new HttpError(502, `Exa search failed: ${errors[0]}`);
  return { results, errors };
}
