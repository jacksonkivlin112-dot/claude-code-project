#!/usr/bin/env node
// Grades archived sportsbook lines against real box scores and measures how much the
// model's lean (projection vs line) can be trusted. Writes lines-calibration.json, which
// the app uses to pull its chances on real lines toward 50/50 by the measured amount.
//   p_shown = 0.5 + s * (p_model - 0.5) + b          (fit by log loss on every graded line)
// Until there are enough graded lines, a cautious default is used.
// Usage: node scripts/calibrate-lines.mjs [nfl|nba]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKETS, MARKETS_NBA, normName } from '../src/oddsapi.js';
import { probabilities } from '../src/propsModel.js';

const sport = process.argv[2] === 'nba' ? 'nba' : 'nfl';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, sport === 'nba' ? 'public/data/nba' : 'public/data');
const MK = sport === 'nba' ? MARKETS_NBA : MARKETS;
const SLEEPER = 'https://api.sleeper.com';
const DEFAULT = { s: 0.08, b: 0 }; // max shown ~54%: below break-even, so no edge is claimed without evidence
const MIN_N = 300;

const read = async (f, fb) => { try { return JSON.parse(await readFile(resolve(dir, f), 'utf8')); } catch { return fb; } };
const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r.json(); };
const etDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const nameOf = (r) => normName(`${r.player?.first_name || ''} ${r.player?.last_name || ''}`);

const hist = await read('lines-history.json', { entries: {} });
const graded = await read('lines-graded.json', { rows: [] });
const done = new Set(graded.rows.map((r) => r.key));
const now = Date.now();
const due = Object.entries(hist.entries).filter(([k, e]) => !done.has(k) && now - new Date(e.commence).getTime() > 8 * 3600e3);

if (due.length) {
  const state = await getJSON(`https://api.sleeper.app/v1/state/${sport}`);
  const season = state.season;
  // Which Sleeper weeks to load.
  const weeks = sport === 'nba'
    ? [state.week - 2, state.week - 1, state.week].filter((w) => w >= 1)
    : [...new Set(due.map(([, e]) => e.week).filter(Boolean))];
  const proj = new Map();
  const stats = new Map();
  for (const w of weeks) {
    const [pr, st] = await Promise.all([
      getJSON(`${SLEEPER}/projections/${sport}/${season}/${w}?season_type=regular`).catch(() => []),
      getJSON(`${SLEEPER}/stats/${sport}/${season}/${w}?season_type=regular`).catch(() => []),
    ]);
    const key = (r) => (sport === 'nba' ? `${nameOf(r)}|${r.date}` : `${nameOf(r)}|${w}`);
    for (const r of pr) proj.set(key(r), r.stats || {});
    for (const r of st) if (sport === 'nfl' || (r.stats?.min || 0) > 0) stats.set(key(r), r.stats || {});
  }
  let added = 0;
  for (const [k, e] of due) {
    const M = MK[e.market];
    if (!M) continue;
    const key = sport === 'nba' ? `${e.id.split('|')[0]}|${etDate(e.commence)}` : `${e.id.split('|')[0]}|${e.week}`;
    const pr = proj.get(key);
    const st = stats.get(key);
    if (!st) continue; // didn't play (or stats not in yet)
    const mean = pr ? M.get(pr) : null;
    const actual = M.get(st);
    if (mean == null || actual == null || !(mean > 0)) continue;
    graded.rows.push({ key: k, market: e.market, line: e.line, mean: Math.round(mean * 100) / 100, actual, date: etDate(e.commence) });
    added += 1;
  }
  // Drop archived lines we'll never be able to grade (no stats a few days later).
  for (const [k, e] of due) if (!graded.rows.some((r) => r.key === k) && now - new Date(e.commence).getTime() > 4 * 864e5) delete hist.entries[k];
  for (const r of graded.rows) delete hist.entries[r.key];
  graded.rows = graded.rows.filter((r) => now - new Date(`${r.date}T12:00:00Z`).getTime() < 120 * 864e5);
  await writeFile(resolve(dir, 'lines-graded.json'), JSON.stringify(graded));
  await writeFile(resolve(dir, 'lines-history.json'), JSON.stringify(hist));
  console.log(`${sport.toUpperCase()}: graded ${added} new lines (${graded.rows.length} total).`);
}

// The model's raw chance for each graded line, using the same distributions as the app.
const rawOver = (r) => {
  const M = MK[r.market];
  const count = M.dist === 'poisson' || (M.poissonBelow && r.mean < M.poissonBelow);
  const sd = count ? 0 : Math.max((M.cv || 0.3) * r.mean, 0.15 * r.mean, 1);
  return probabilities(count ? 'poisson' : 'normal', r.mean, sd, r.line).over;
};
const rows = graded.rows.filter((r) => r.actual !== r.line).map((r) => ({ p: rawOver(r), y: r.actual > r.line ? 1 : 0, date: r.date }));
const ll = (s, b) => rows.reduce((a, { p, y }) => { const q = Math.min(0.999, Math.max(0.001, 0.5 + s * (p - 0.5) + b)); return a - Math.log(y ? q : 1 - q); }, 0) / rows.length;
const nights = new Set(rows.map((r) => r.date)).size;
let s = DEFAULT.s;
let b = DEFAULT.b;
if (rows.length >= MIN_N) {
  let best = [Infinity, 0, 0];
  const useB = rows.length >= 1500 && nights >= 5; // side bias only once there's lots of data
  for (let si = 0; si <= 100; si += 2) for (let bi = useB ? -8 : 0; bi <= (useB ? 8 : 0); bi += 1) {
    const v = ll(si / 100, bi / 100);
    if (v < best[0]) best = [v, si / 100, bi / 100];
  }
  [, s, b] = best;
}
const strong = rows.filter((r) => Math.abs(r.p - 0.5) >= 0.2);
const out = {
  generatedAt: new Date().toISOString(), sport, n: rows.length, nights, s, b,
  usingDefault: rows.length < MIN_N,
  modelSide70: strong.length ? { n: strong.length, hit: strong.filter((r) => (r.p > 0.5) === (r.y === 1)).length / strong.length } : null,
  overRate: rows.length ? rows.filter((r) => r.y).length / rows.length : null,
  logloss: rows.length ? { coinFlip: Math.log(2), raw: ll(1, 0), calibrated: ll(s, b) } : null,
};
await writeFile(resolve(dir, 'lines-calibration.json'), JSON.stringify(out));
console.log(`${sport.toUpperCase()} calibration: ${rows.length} graded lines over ${nights} nights -> trust ${Math.round(s * 100)}% of the model's lean${b ? `, side bias ${b > 0 ? '+' : ''}${b}` : ''}${out.usingDefault ? ' (cautious default until 300 lines)' : ''}. Model side when 70%+ sure: ${out.modelSide70 ? `${Math.round(out.modelSide70.hit * 100)}% of ${out.modelSide70.n}` : 'n/a'}.`);
