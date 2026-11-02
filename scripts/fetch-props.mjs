#!/usr/bin/env node
// Builds public/data/props.json (or public/data/nba/props.json) with real
// PrizePicks player-prop lines from The Odds API (bookmaker "prizepicks").
// Needs ODDS_API_KEY; exits quietly without one so the deploy still runs.
//
// Credit budgeting (The Odds API charges 1 credit per market returned per game):
//   - Spreads the account's remaining monthly credits evenly over the days left
//     in the month, split between sports (PROPS_SHARE, default 0.5 each).
//   - Each run spends only what's left of today's allowance: soonest games first,
//     most important stats first, and skips games refreshed recently.
//   - Lines for games not refreshed this run are kept from the previous file.
// Optional env: PROPS_MARKETS / NBA_PROPS_MARKETS (comma list), PROPS_WITHIN_HOURS,
//   PROPS_SHARE (0-1), PROPS_RESERVE (credits never spent, default 25).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPORTS, fetchPrizePicksLines, listEventsWithQuota } from '../src/oddsapi.js';

const sport = process.argv[2] === 'nba' ? 'nba' : 'nfl';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, sport === 'nba' ? 'public/data/nba/props.json' : 'public/data/props.json');
const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);

// Most-played stats first: these get refreshed even on a tight budget.
const PRIORITY = {
  nfl: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions', 'player_rush_reception_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts', 'player_rush_attempts', 'player_pass_rush_yds', 'player_pass_interceptions'],
  nba: ['player_points', 'player_rebounds', 'player_assists', 'player_points_rebounds_assists', 'player_threes', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists', 'player_blocks_steals', 'player_steals', 'player_blocks', 'player_turnovers'],
};

const key = process.env.ODDS_API_KEY;
if (!key) {
  console.log('ODDS_API_KEY not set; skipping PrizePicks lines.');
  process.exit(0);
}

const all = Object.keys(SPORTS[sport].markets);
const wanted = env(sport === 'nba' ? 'NBA_PROPS_MARKETS' : 'PROPS_MARKETS', '').split(',').map((s) => s.trim()).filter((m) => SPORTS[sport].markets[m]);
const markets = PRIORITY[sport].filter((m) => all.includes(m) && (!wanted.length || wanted.includes(m)));
const withinHours = Number(env(sport === 'nba' ? 'NBA_PROPS_WITHIN_HOURS' : 'PROPS_WITHIN_HOURS', sport === 'nba' ? 30 : 7 * 24));
const share = Math.min(1, Math.max(0, Number(env('PROPS_SHARE', 0.5))));
const reserve = Number(env('PROPS_RESERVE', 25));
const MIN_MARKETS = 3;

// NBA plays nightly, so it gets a daily allowance; NFL games bunch up on Sundays,
// so it gets a weekly one (weeks run Tuesday to Monday).
const nowD = new Date();
const weekStart = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), nowD.getUTCDate() - ((nowD.getUTCDay() + 5) % 7)));
const today = sport === 'nfl' ? `wk-${weekStart.toISOString().slice(0, 10)}` : nowD.toISOString().slice(0, 10);
let old = { props: [], events: {}, spend: {} };
try { old = { events: {}, spend: {}, ...JSON.parse(await readFile(OUT, 'utf8')) }; } catch { /* first run */ }

try {
  const { events, remaining, used } = await listEventsWithQuota(key, fetch, sport);
  const now = Date.now();
  const upcoming = events
    .filter((e) => { const t = new Date(e.commence_time).getTime(); return t > now && t - now < withinHours * 3600e3; })
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  // Today's allowance for this sport.
  const d = new Date();
  const daysLeft = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.max(1, Math.round(daysLeft / 864e5));
  const periods = sport === 'nfl' ? Math.max(1, Math.ceil(days / 7)) : days;
  const spentToday = old.spend?.date === today ? old.spend.credits : 0;
  const daily = remaining == null ? Infinity : Math.max(0, (remaining - reserve) / periods) * share;
  let budget = Math.floor(Math.min(daily - spentToday, remaining == null ? Infinity : remaining - reserve));

  // Refresh a game again only when its lines are stale: hourly close to start, otherwise every 8h.
  const stale = (e) => {
    const last = old.events?.[e.id]?.fetchedAt ? new Date(old.events[e.id].fetchedAt).getTime() : 0;
    const hoursToStart = (new Date(e.commence_time).getTime() - now) / 3600e3;
    return now - last > (hoursToStart < 6 ? 1 : 8) * 3600e3;
  };
  // Tight budget: save credits for game day (lines move most in the last day).
  const roomy = budget >= upcoming.length * markets.length;
  const due = upcoming.filter((e) => stale(e) && (roomy || new Date(e.commence_time).getTime() - now < 30 * 3600e3));
  const k = Math.min(markets.length, due.length ? Math.floor(budget / due.length) : markets.length);
  const perGame = Math.max(MIN_MARKETS, roomy ? k : Math.min(k, 5)); // tight budget: top 5 stats, leaving credits for later refreshes
  const pick = [];
  for (const e of due) {
    if (budget < Math.min(MIN_MARKETS, markets.length)) break;
    const n = Math.min(perGame, markets.length, budget);
    pick.push({ e, markets: markets.slice(0, n) });
    budget -= n;
  }

  console.log(`${sport.toUpperCase()}: ${upcoming.length} games in window, ${due.length} need refresh, credits left ${remaining ?? 'n/a'}, ${sport === 'nfl' ? 'this week' : 'today'}'s allowance ${Number.isFinite(daily) ? Math.floor(daily) : '∞'} (spent ${spentToday}). Refreshing ${pick.length} games.`);

  const fresh = [];
  const evMeta = { ...old.events };
  let lastUsed = used;
  for (const { e, markets: ms } of pick) {
    const res = await fetchPrizePicksLines(key, { sport, events: [e], markets: ms, withinHours });
    fresh.push(...res.props);
    evMeta[e.id] = { fetchedAt: new Date().toISOString(), markets: ms.length, lines: res.props.length };
    if (res.used != null) lastUsed = res.used;
  }
  const spent = used != null && lastUsed != null ? lastUsed - used : pick.reduce((a, x) => a + x.markets.length, 0);

  // Keep earlier lines for games still upcoming that weren't refreshed this run.
  const refreshed = new Set(pick.map((x) => x.e.id));
  const upcomingIds = new Set(upcoming.map((e) => e.id));
  const kept = (old.props || []).filter((p) => !refreshed.has(p.eventId) && upcomingIds.has(p.eventId));
  const prev = Object.fromEntries((old.props || []).map((p) => [p.id, p.line]));
  const props = [...kept, ...fresh.map((p) => (prev[p.id] != null && prev[p.id] !== p.line ? { ...p, prevLine: prev[p.id] } : p))];
  for (const id of Object.keys(evMeta)) if (!upcomingIds.has(id)) delete evMeta[id];

  if (!pick.length && kept.length === (old.props || []).length) {
    console.log('Nothing to refresh this run.');
    process.exit(0);
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: pick.length ? new Date().toISOString() : old.generatedAt || new Date().toISOString(),
    source: 'prizepicks', sport, props, events: evMeta,
    spend: { date: today, credits: spentToday + spent },
    quota: { remaining: remaining != null ? remaining - spent : null },
  }));
  console.log(`Wrote ${props.length} ${sport.toUpperCase()} PrizePicks lines (${fresh.length} refreshed, ${kept.length} kept). Spent ${spent} credits.`);
} catch (e) {
  // Never fail the deploy because of props; keep the last good file.
  console.warn(`Could not refresh PrizePicks lines: ${e.message}`);
}
