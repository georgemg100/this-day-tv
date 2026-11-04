// Roblox Open Cloud: asset upload, DataStore publish, live-server notify.
import fs from 'node:fs';
import path from 'node:path';
import { config, HttpError } from './config.js';

const BASE = 'https://apis.roblox.com';

export function robloxStatus() {
  const r = config.roblox;
  return {
    apiKey: Boolean(r.apiKey),
    universeId: r.universeId || null,
    creator: r.creatorGroupId ? `group ${r.creatorGroupId}` : r.creatorUserId ? `user ${r.creatorUserId}` : null,
    dataStore: r.dataStore,
    topic: r.topic,
    videoPrice: r.videoPrice,
    canUpload: Boolean(r.apiKey && (r.creatorGroupId || r.creatorUserId)),
    canPublish: Boolean(r.apiKey && r.universeId),
  };
}

async function call(pathname, init = {}) {
  if (!config.roblox.apiKey) throw new HttpError(400, 'ROBLOX_API_KEY is not set in admin/.env');
  const res = await fetch(BASE + pathname, {
    ...init,
    headers: { 'x-api-key': config.roblox.apiKey, ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeoutMs || 120000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, `Roblox ${res.status} on ${pathname}: ${String(detail).slice(0, 400)}`);
  }
  return body;
}

const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

/** Start an asset upload. Returns the long-running operation. */
export async function createAsset({ filePath, assetType, displayName, description }) {
  const r = config.roblox;
  const creator = r.creatorGroupId ? { groupId: String(r.creatorGroupId) } : r.creatorUserId ? { userId: String(r.creatorUserId) } : null;
  if (!creator) throw new HttpError(400, 'Set ROBLOX_CREATOR_USER_ID or ROBLOX_CREATOR_GROUP_ID in admin/.env');
  const request = {
    assetType,
    displayName: String(displayName).slice(0, 50),
    description: String(description || '').slice(0, 1000),
    creationContext: { creator },
  };
  if (assetType === 'Video' && r.videoPrice) request.creationContext.expectedPrice = r.videoPrice;

  const ext = path.extname(filePath).toLowerCase();
  const blob = await fs.openAsBlob(filePath, { type: MIME[ext] || 'application/octet-stream' });
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  form.append('fileContent', blob, path.basename(filePath));
  return call('/assets/v1/assets', { method: 'POST', body: form, timeoutMs: 15 * 60 * 1000 });
}

export async function getOperation(operationPath) {
  const id = String(operationPath).split('/').pop();
  return call(`/assets/v1/operations/${encodeURIComponent(id)}`);
}

/** Poll an operation until done. Returns the created asset id. */
export async function waitForAsset(op, { timeoutMs = 15 * 60 * 1000, onPoll } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current = op;
  let delay = 2000;
  while (!current?.done) {
    if (Date.now() > deadline) throw new HttpError(504, `timed out waiting for ${op.path}; check it later from the Library tab`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 15000);
    current = await getOperation(op.path || op.operationId);
    onPoll?.(current);
  }
  if (current.error) throw new HttpError(502, `Roblox rejected the asset: ${JSON.stringify(current.error)}`);
  const assetId = current.response?.assetId;
  if (!assetId) throw new HttpError(502, `operation finished without an assetId: ${JSON.stringify(current).slice(0, 300)}`);
  return { assetId: String(assetId), moderation: current.response?.moderationResult || null };
}

function requireUniverse() {
  if (!config.roblox.universeId) throw new HttpError(400, 'ROBLOX_UNIVERSE_ID is not set in admin/.env');
  return encodeURIComponent(config.roblox.universeId);
}

/** Write the compiled day schedule to the experience's DataStore. */
export async function writeScheduleEntry(key, value) {
  const u = requireUniverse();
  const ds = encodeURIComponent(config.roblox.dataStore);
  return call(`/cloud/v2/universes/${u}/data-stores/${ds}/entries/${encodeURIComponent(key)}?allowMissing=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

export async function readScheduleEntry(key) {
  const u = requireUniverse();
  const ds = encodeURIComponent(config.roblox.dataStore);
  return call(`/cloud/v2/universes/${u}/data-stores/${ds}/entries/${encodeURIComponent(key)}`);
}

/** Tell running servers to reload. Fails harmlessly when no servers are up. */
export async function notifyServers(message) {
  const u = requireUniverse();
  return call(`/cloud/v2/universes/${u}:publishMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: config.roblox.topic, message: String(message) }),
  });
}
