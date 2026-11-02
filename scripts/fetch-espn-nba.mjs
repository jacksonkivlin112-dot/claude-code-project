#!/usr/bin/env node
// Builds public/data/nba/espn.json: teams, conference standings and every
// regular-season game (from the 30 team schedules, de-duplicated).
// Usage: node scripts/fetch-espn-nba.mjs [espnSeasonYear]   e.g. 2027 for 2026-27

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESPN_BASE, normFor, parseConferenceStandings, parseEvent, parseTeams } from '../src/espn.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'public/data/nba/espn.json');
const norm = normFor('nba');
const NBA = `${ESPN_BASE}/site/v2/sports/basketball/nba`;

async function getJSON(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

async function main() {
  const state = await getJSON('https://api.sleeper.app/v1/state/nba');
  // Sleeper labels 2026-27 as "2026"; ESPN labels it 2027.
  const espnSeason = Number(process.argv[2] || Number(state.season) + 1);

  const [teamsRaw, standingsRaw] = await Promise.all([
    getJSON(`${NBA}/teams`),
    getJSON(`${ESPN_BASE}/v2/sports/basketball/nba/standings?season=${espnSeason}`),
  ]);
  const teams = parseTeams(teamsRaw, norm);

  const games = new Map();
  const ids = Object.values(teams).map((t) => t.espnId);
  for (let i = 0; i < ids.length; i += 6) {
    const batch = await Promise.all(ids.slice(i, i + 6).map((id) => getJSON(`${NBA}/teams/${id}/schedule?season=${espnSeason}`)));
    for (const sched of batch) for (const e of sched.events || []) if (!games.has(e.id)) games.set(e.id, parseEvent(e, norm));
  }

  // Today's and tomorrow's scoreboards carry richer detail (records, TV, leaders).
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  for (const offset of [-1, 0, 1]) {
    const d = new Date(now.getTime() + offset * 86400000);
    const sb = await getJSON(`${NBA}/scoreboard?dates=${ymd(d)}`).catch(() => null);
    for (const e of sb?.events || []) games.set(e.id, parseEvent(e, norm));
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    season: Number(state.season),
    espnSeason,
    teams,
    standings: parseConferenceStandings(standingsRaw, norm),
    games: [...games.values()].sort((a, b) => new Date(a.date) - new Date(b.date)),
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot));
  const done = snapshot.games.filter((g) => g.state === 'post').length;
  console.log(`Wrote ${OUT}: ${Object.keys(teams).length} teams, ${snapshot.games.length} games (${done} final), ${snapshot.standings.length} standings rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
