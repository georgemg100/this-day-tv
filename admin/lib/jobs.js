// In-memory background jobs with a serial queue per lane (ffmpeg is CPU-heavy,
// and Roblox uploads cost Robux, so we never want accidental parallel bursts).
import { newId } from './store.js';

const jobs = new Map();
const lanes = new Map();
const MAX_KEEP = 200;

export function createJob(type, label, run, { lane = type } = {}) {
  const job = {
    id: newId('job'),
    type,
    label,
    status: 'queued',
    progress: 0,
    message: 'Waiting in queue',
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  trim();

  const update = (patch) => Object.assign(job, patch);
  const prev = lanes.get(lane) || Promise.resolve();
  const next = prev.then(async () => {
    update({ status: 'running', message: 'Starting' });
    try {
      const result = await run(update);
      update({ status: 'done', progress: 1, message: 'Done', result, finishedAt: new Date().toISOString() });
    } catch (err) {
      update({ status: 'error', error: err.message, message: err.message, finishedAt: new Date().toISOString() });
    }
  });
  lanes.set(lane, next);
  return job;
}

export const getJob = (id) => jobs.get(id) || null;
export const listJobs = () => [...jobs.values()].reverse();

function trim() {
  if (jobs.size <= MAX_KEEP) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_KEEP) break;
    if (job.status === 'done' || job.status === 'error') jobs.delete(id);
  }
}
