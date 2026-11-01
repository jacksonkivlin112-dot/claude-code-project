#!/usr/bin/env node
// Builds public/data/espn.json: teams, standings and every regular-season game
// (scores, status, venue, TV). ESPN blocks most browser (CORS) requests, so the
// app reads this snapshot. A scheduled GitHub Action reruns it during the season.
//
// Usage: node scripts/fetch-espn.mjs [season]

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESPN_BASE, parseScoreboard, parseStandings, parseTeams } from '../src/espn.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'public/data/espn.json');

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
  const state = await getJSON('https://api.sleeper.app/v1/state/nfl');
  const season = Number(process.argv[2] || state.season);

  const [teamsRaw, standingsRaw] = await Promise.all([
    getJSON(`${ESPN_BASE}/site/v2/sports/football/nfl/teams`),
    getJSON(`${ESPN_BASE}/v2/sports/football/nfl/standings?season=${season}&level=3`),
  ]);

  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const boards = [];
  // Small batches keep us polite to the API.
  for (let i = 0; i < weeks.length; i += 6) {
    const batch = weeks.slice(i, i + 6);
    boards.push(
      ...(await Promise.all(
        batch.map((w) => getJSON(`${ESPN_BASE}/site/v2/sports/football/nfl/scoreboard?week=${w}&seasontype=2&dates=${season}`).then(parseScoreboard)),
      )),
    );
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    season,
    teams: parseTeams(teamsRaw),
    standings: parseStandings(standingsRaw),
    games: boards.flatMap((b, i) => b.games.map((g) => ({ ...g, week: weeks[i] }))),
    byes: Object.fromEntries(boards.map((b, i) => [weeks[i], b.byes])),
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot));
  const done = snapshot.games.filter((g) => g.state === 'post').length;
  console.log(`Wrote ${OUT}: ${Object.keys(snapshot.teams).length} teams, ${snapshot.games.length} games (${done} final), ${snapshot.standings.length} standings rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
