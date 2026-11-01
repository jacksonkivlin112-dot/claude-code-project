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
import { DEFAULT_MARKETS, fetchPrizePicksLines } from '../src/oddsapi.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'public/data/props.json');

const key = process.env.ODDS_API_KEY;
if (!key) {
  console.log('ODDS_API_KEY not set; skipping PrizePicks lines.');
  process.exit(0);
}

const markets = (process.env.PROPS_MARKETS || '').split(',').map((s) => s.trim()).filter(Boolean);
const withinHours = Number(process.env.PROPS_WITHIN_HOURS || 8 * 24);

try {
  const res = await fetchPrizePicksLines(key, { markets: markets.length ? markets : DEFAULT_MARKETS, withinHours });

  // Keep the previous line for each prop so the app can show line movement.
  let prev = {};
  try {
    const old = JSON.parse(await readFile(OUT, 'utf8'));
    prev = Object.fromEntries((old.props || []).map((p) => [p.id, p.line]));
  } catch { /* first run */ }
  const props = res.props.map((p) => (prev[p.id] != null && prev[p.id] !== p.line ? { ...p, prevLine: prev[p.id] } : p));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'prizepicks', props }));
  console.log(`Wrote ${props.length} PrizePicks lines across ${res.events} games. Credits remaining: ${res.remaining ?? 'n/a'}`);
} catch (e) {
  // Never fail the deploy because of props; keep the last good file.
  console.warn(`Could not refresh PrizePicks lines: ${e.message}`);
}
