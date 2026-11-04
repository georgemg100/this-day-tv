// Tiny JSON-file persistence. One admin, low write volume: files are fine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const dir = (...p) => path.join(config.dataDir, ...p);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

// ---- library -------------------------------------------------------------
export function listLibrary() {
  return readJson(dir('library.json'), { items: [] }).items;
}

export function saveLibrary(items) {
  writeJson(dir('library.json'), { items });
}

export function getLibraryItem(id) {
  return listLibrary().find((i) => i.id === id) || null;
}

/** Read-modify-write a single item. `fn` mutates the item (or returns a new one). */
export function updateLibraryItem(id, fn) {
  const items = listLibrary();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = fn(items[idx]) || items[idx];
  saveLibrary(items);
  return items[idx];
}

export function addLibraryItem(item) {
  const items = listLibrary();
  items.push(item);
  saveLibrary(items);
  return item;
}

export function removeLibraryItem(id) {
  const items = listLibrary();
  const next = items.filter((i) => i.id !== id);
  saveLibrary(next);
  return next.length !== items.length;
}

// ---- schedules (drafts) --------------------------------------------------
export function getSchedule(key) {
  return readJson(dir('schedules', `${key}.json`), null);
}

export function saveSchedule(key, draft) {
  writeJson(dir('schedules', `${key}.json`), draft);
  return draft;
}

export function listSchedules() {
  const d = dir('schedules');
  if (!fs.existsSync(d)) return [];
  return fs
    .readdirSync(d)
    .filter((f) => /^\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      const key = f.slice(0, 5);
      const draft = getSchedule(key);
      const published = getPublished(key);
      return {
        date: key,
        channels: draft?.channels?.length || 0,
        updatedAt: draft?.updatedAt || null,
        publishedAt: published?.publishedAt || null,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---- published (compiled) schedules --------------------------------------
export function getPublished(key) {
  return readJson(dir('published', `${key}.json`), null);
}

export function savePublished(key, compiled) {
  writeJson(dir('published', `${key}.json`), compiled);
}
