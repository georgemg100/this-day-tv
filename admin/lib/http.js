import { config, HttpError } from './config.js';

/** fetch() with a timeout, a polite User-Agent and JSON decoding. */
export async function fetchJson(url, { timeoutMs = 20000, headers = {}, ...init } = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300);
    throw new HttpError(502, `${new URL(url).host} responded ${res.status}: ${detail}`);
  }
  return body;
}
