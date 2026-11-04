import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

if (process.env.NODE_ENV !== 'test') loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(env.PORT, 4747),
  host: env.HOST || '127.0.0.1',
  adminToken: env.ADMIN_TOKEN || '',
  dataDir: path.resolve(ROOT, env.DATA_DIR || 'data'),
  mediaDir: path.resolve(ROOT, env.MEDIA_DIR || 'media'),
  // The static TV site. Publishing writes web/schedules/MM-DD.json here.
  webDir: path.resolve(ROOT, env.WEB_DIR || '../web'),
  exaApiKey: env.EXA_API_KEY || '',
  roblox: {
    apiKey: env.ROBLOX_API_KEY || '',
    universeId: env.ROBLOX_UNIVERSE_ID || '',
    creatorUserId: env.ROBLOX_CREATOR_USER_ID || '',
    creatorGroupId: env.ROBLOX_CREATOR_GROUP_ID || '',
    dataStore: env.ROBLOX_DATASTORE || 'ThisDayTV',
    topic: env.ROBLOX_TOPIC || 'ThisDayTV',
    videoPrice: num(env.ROBLOX_VIDEO_PRICE, 2000),
  },
  station: {
    timezone: env.STATION_TIMEZONE || 'America/New_York',
    yearFrom: num(env.YEAR_FROM, 1960),
    yearTo: num(env.YEAR_TO, 1999),
  },
  media: {
    maxSegmentSeconds: num(env.MAX_SEGMENT_SECONDS, 295),
    maxAudioSegmentSeconds: 415, // Roblox audio limit is 7 minutes
    maxUploadMB: num(env.MAX_UPLOAD_MB, 19),
    // Streamed (website) programs are split into acts this long so commercial
    // breaks can go between them. No upload limits apply.
    webActSeconds: num(env.WEB_ACT_SECONDS, 720),
    width: 640,
    height: 480,
  },
  userAgent: 'ThisDayTV-Admin/1.0 (archival TV station for Roblox)',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
