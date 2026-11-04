// Publishing target: the static TV site in web/.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function webStatus() {
  return { dir: config.webDir, exists: fs.existsSync(path.join(config.webDir, 'index.html')) };
}

/** Write the day's schedule plus station settings the player needs. */
export function publishWeb(key, compiled) {
  const schedulePath = path.join(config.webDir, 'schedules', `${key}.json`);
  writeJson(schedulePath, compiled);
  const stationPath = path.join(config.webDir, 'station.json');
  let station = {};
  try {
    station = JSON.parse(fs.readFileSync(stationPath, 'utf8'));
  } catch { /* first publish */ }
  writeJson(stationPath, {
    name: 'This Day TV',
    channelName: 'WTDI',
    ...station,
    timezone: config.station.timezone,
    yearFrom: config.station.yearFrom,
    yearTo: config.station.yearTo,
  });
  return path.relative(path.dirname(config.webDir), schedulePath);
}

export function getWebPublished(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.webDir, 'schedules', `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
}
