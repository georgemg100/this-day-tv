#!/usr/bin/env node
// This Day TV autopilot: pick and publish a day's programming with no admin.
//
//   node autopilot.js                    today (station timezone)
//   node autopilot.js --days 7           today and the next 6 days
//   node autopilot.js --date 12-25       a specific day
//   node autopilot.js --channels 10      more channels (one year each)
//   node autopilot.js --rights any       allow programs whose rights are unknown (more 80s/90s)
//   node autopilot.js --ad-rights pd     only public-domain commercials
//   node autopilot.js --force            replace a day you published by hand
//   node autopilot.js --dry-run          print the plan, write nothing
//
// Writes web/schedules/MM-DD.json. Days you published from the console are
// left alone unless you pass --force.
import { programDay, DEFAULTS } from './lib/autopilot.js';
import { publishWeb, getWebPublished } from './lib/web.js';
import { config } from './lib/config.js';
import { todayMMDD, parseMMDD } from './lib/dates.js';
import fs from 'node:fs';

function parseArgs(argv) {
  const args = { days: 1, date: null, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--days') args.days = Math.max(1, Math.min(31, Number(val()) || 1));
    else if (a === '--date') args.date = parseMMDD(val()).key;
    else if (a === '--channels') args.channels = Math.max(1, Math.min(12, Number(val()) || DEFAULTS.channels));
    else if (a === '--rights') args.rights = val() === 'any' ? 'any' : 'pd';
    else if (a === '--ad-rights') args.adRights = val() === 'pd' ? 'pd' : 'any';
    else if (a === '--target-minutes') args.targetMinutes = Number(val()) || DEFAULTS.targetMinutes;
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).join('\n').replace(/^\/\/ ?/gm, ''));
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  return args;
}

function dayKeys(start, days) {
  const [mm, dd] = start.split('-').map(Number);
  const keys = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2024, mm - 1, dd + i)); // leap year so 02-29 exists
    keys.push(`${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return keys;
}

const args = parseArgs(process.argv.slice(2));
const start = args.date || todayMMDD(config.station.timezone);
let failures = 0;
for (const key of dayKeys(start, args.days)) {
  const existing = getWebPublished(key);
  if (existing && existing.generatedBy !== 'autopilot' && !args.force) {
    console.log(`${key}: published by hand, leaving it alone (use --force to replace)`);
    continue;
  }
  const t0 = Date.now();
  try {
    const { compiled, warnings, report } = await programDay(key, {
      channels: args.channels, rights: args.rights, adRights: args.adRights, targetMinutes: args.targetMinutes,
      log: (m) => console.log(`  ${m}`),
    });
    if (!compiled) {
      console.log(`${key}: nothing to publish (${warnings.join(' ')})`);
      failures++;
      continue;
    }
    console.log(`${key}: ${report.length} channels in ${Math.round((Date.now() - t0) / 1000)}s`);
    for (const r of report) {
      console.log(`  CH ${String(r.channel).padStart(2)} ${r.name} ${r.year}: ${r.programs} programs (${r.minutes} min), ${r.ads} ads, ${r.headlines} headlines`);
      r.titles.slice(0, 4).forEach((t) => console.log(`        · ${t}`));
      if (r.titles.length > 4) console.log(`        · …and ${r.titles.length - 4} more`);
    }
    if (!args.dryRun) console.log(`  → ${publishWeb(key, compiled)}`);
  } catch (err) {
    failures++;
    console.error(`${key}: failed: ${err.message}`);
  }
}
process.exit(failures && failures === args.days ? 1 : 0);
