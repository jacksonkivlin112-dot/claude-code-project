#!/usr/bin/env node
// Builds public/data/props.json with PrizePicks NFL player-prop lines via
// The Odds API (bookmaker "prizepicks"). Needs ODDS_API_KEY; exits quietly
// without one so the rest of the pipeline still runs.
//
// Credit usage: 1 credit per market per upcoming game. Limit with
//   PROPS_MARKETS=player_pass_yds,player_reception_yds  (comma-separated)
//   PROPS_WITHIN_HOURS=72                                (only games kicking off soon)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPORTS, fetchPrizePicksLines } from '../src/oddsapi.js';

// Usage: node scripts/fetch-props.mjs [nfl|nba]
const sport = process.argv[2] === 'nba' ? 'nba' : 'nfl';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, sport === 'nba' ? 'public/data/nba/props.json' : 'public/data/props.json');
// Skip if the file is fresher than this many minutes (saves Odds API credits).
const MIN_INTERVAL = Number(process.env.PROPS_MIN_INTERVAL_MIN || 0);

const key = process.env.ODDS_API_KEY;
if (!key) {
  console.log('ODDS_API_KEY not set; skipping PrizePicks lines.');
  process.exit(0);
}

const envMarkets = process.env[sport === 'nba' ? 'NBA_PROPS_MARKETS' : 'PROPS_MARKETS'] || '';
const markets = envMarkets.split(',').map((s) => s.trim()).filter((m) => SPORTS[sport].markets[m]);
const withinHours = Number(process.env[sport === 'nba' ? 'NBA_PROPS_WITHIN_HOURS' : 'PROPS_WITHIN_HOURS'] || (sport === 'nba' ? 36 : 8 * 24));

try {
  if (MIN_INTERVAL) {
    try {
      const old = JSON.parse(await readFile(OUT, 'utf8'));
      const age = (Date.now() - new Date(old.generatedAt).getTime()) / 60000;
      if (age < MIN_INTERVAL) {
        console.log(`${sport.toUpperCase()} lines are ${Math.round(age)} min old (< ${MIN_INTERVAL}); skipping to save credits.`);
        process.exit(0);
      }
    } catch { /* no previous file */ }
  }
  const res = await fetchPrizePicksLines(key, { sport, markets, withinHours });

  // Keep the previous line for each prop so the app can show line movement.
  let prev = {};
  try {
    const old = JSON.parse(await readFile(OUT, 'utf8'));
    prev = Object.fromEntries((old.props || []).map((p) => [p.id, p.line]));
  } catch { /* first run */ }
  const props = res.props.map((p) => (prev[p.id] != null && prev[p.id] !== p.line ? { ...p, prevLine: prev[p.id] } : p));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'prizepicks', sport, props }));
  console.log(`Wrote ${props.length} ${sport.toUpperCase()} PrizePicks lines across ${res.events} games. Credits remaining: ${res.remaining ?? 'n/a'}`);
} catch (e) {
  // Never fail the deploy because of props; keep the last good file.
  console.warn(`Could not refresh PrizePicks lines: ${e.message}`);
}
