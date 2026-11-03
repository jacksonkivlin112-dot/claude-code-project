#!/usr/bin/env node
// Real sportsbook player-prop lines (DraftKings, as published on ESPN) for every
// upcoming game. Free and keyless. Writes public/data/lines.json or public/data/nba/lines.json.
// Usage: node scripts/fetch-espn-lines.mjs [nfl|nba]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normName } from '../src/oddsapi.js';

const sport = process.argv[2] === 'nba' ? 'nba' : 'nfl';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, sport === 'nba' ? 'public/data/nba/lines.json' : 'public/data/lines.json');
const PATH = sport === 'nba' ? 'basketball/nba' : 'football/nfl';
const SITE = `https://site.api.espn.com/apis/site/v2/sports/${PATH}`;
const CORE = `https://sports.core.api.espn.com/v2/sports/${PATH.replace('/', '/leagues/')}`;
const PROVIDER = { id: '100', name: 'DraftKings' };

// ESPN prop type name -> app market key (full-game totals only).
const MARKET = sport === 'nba' ? {
  'Total Points': 'player_points',
  'Total Rebounds': 'player_rebounds',
  'Total Assists': 'player_assists',
  'Total 3-Point Field Goals': 'player_threes',
  'Total Steals': 'player_steals',
  'Total Blocks': 'player_blocks',
  'Total Turnovers': 'player_turnovers',
  'Total Points and Rebounds': 'player_points_rebounds',
  'Total Points and Assists': 'player_points_assists',
  'Total Assists and Rebounds': 'player_rebounds_assists',
  'Total Points, Rebounds, and Assists': 'player_points_rebounds_assists',
  'Total Steals and Blocks': 'player_blocks_steals',
} : {
  'Total Passing Yards (incl. overtime)': 'player_pass_yds',
  'Total Passing Touchdowns (incl. overtime)': 'player_pass_tds',
  'Total Pass Completions (incl. overtime)': 'player_pass_completions',
  'Total Passing Attempts (incl. overtime)': 'player_pass_attempts',
  'Total Passing Interceptions (incl. overtime)': 'player_pass_interceptions',
  'Total Passing Plus Rushing Yards (incl. overtime)': 'player_pass_rush_yds',
  'Total Rushing Yards (incl. overtime)': 'player_rush_yds',
  'Total Carries (incl. overtime)': 'player_rush_attempts',
  'Total Receptions (incl. overtime)': 'player_receptions',
  'Total Receiving Yards (incl. overtime)': 'player_reception_yds',
  'Total Rushing Plus Receiving Yards (incl. overtime)': 'player_rush_reception_yds',
};

async function json(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.status === 404) return null; // e.g. no props posted for this game yet
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
}

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '');

async function games() {
  const boards = sport === 'nba'
    ? await Promise.all([0, 1].map((k) => json(`${SITE}/scoreboard?dates=${ymd(new Date(Date.now() + k * 864e5))}`)))
    : await (async () => {
      // The default NFL board can still show last week; look one week ahead too.
      const cur = await json(`${SITE}/scoreboard`);
      const wk = cur?.week?.number;
      const type = cur?.season?.type ?? 2;
      const next = wk ? await json(`${SITE}/scoreboard?week=${wk + 1}&seasontype=${type}`).catch(() => null) : null;
      if (next && wk) next.__week = wk + 1;
      if (cur && wk) cur.__week = wk;
      return [cur, next].filter(Boolean);
    })();
  const seen = new Set();
  const weekOf = new Map();
  for (const b of boards) for (const e of b?.events || []) if (b.__week) weekOf.set(e.id, b.__week);
  return boards.flatMap((b) => b?.events || []).filter((e) => !seen.has(e.id) && seen.add(e.id)).map((e) => {
    const c = e.competitions[0];
    const side = (h) => c.competitors.find((x) => x.homeAway === h).team;
    return { id: e.id, date: e.date, state: e.status.type.state, home: side('home'), away: side('away'), week: e.week?.number ?? weekOf.get(e.id) ?? null };
  });
}

const rosterCache = new Map();
async function roster(teamId) {
  if (!rosterCache.has(teamId)) {
    rosterCache.set(teamId, json(`${SITE}/teams/${teamId}/roster`).then((d) => {
      const list = (d?.athletes || []).flatMap((a) => (a.items ? a.items : [a]));
      return new Map(list.map((a) => [String(a.id), a.fullName || a.displayName]));
    }).catch(() => new Map()));
  }
  return rosterCache.get(teamId);
}

async function propsFor(g) {
  const names = new Map([...(await roster(g.home.id)), ...(await roster(g.away.id))]);
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const d = await json(`${CORE}/events/${g.id}/competitions/${g.id}/odds/${PROVIDER.id}/propBets?lang=en&region=us&limit=1000&page=${page}`);
    if (!d) break;
    items.push(...(d.items || []));
    if (page >= (d.pageCount || 1)) break;
  }
  const out = new Map();
  for (const it of items) {
    const market = MARKET[it.type?.name];
    const athleteId = it.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
    const line = it.current?.target?.value;
    if (!market || !athleteId || line == null) continue;
    const player = names.get(athleteId);
    if (!player) continue;
    const id = `${normName(player)}|${market}`;
    const open = it.open?.target?.value;
    out.set(id, {
      id, player, market, line, eventId: g.id, home: g.home.displayName, away: g.away.displayName, commence: g.date,
      updated: it.lastUpdated || null, book: PROVIDER.name, espnId: athleteId, ...(g.week ? { week: g.week } : {}),
      ...(open != null && open !== line ? { openLine: open } : {}),
    });
  }
  return [...out.values()];
}

let old = { props: [] };
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

try {
  const list = await games();
  const pre = list.filter((g) => g.state === 'pre');
  const fresh = [];
  const failed = [];
  for (let i = 0; i < pre.length; i += 4) {
    const chunk = await Promise.allSettled(pre.slice(i, i + 4).map(propsFor));
    chunk.forEach((r, k) => (r.status === 'fulfilled' ? fresh.push(...r.value) : failed.push(pre[i + k].id)));
  }
  // Freeze pregame lines for games that have started (until 12h after start), and keep
  // the last lines for any game whose fetch failed this run.
  const now = Date.now();
  const refreshed = new Set(pre.filter((g) => !failed.includes(g.id)).map((g) => g.id));
  const kept = (old.props || []).filter((p) => !refreshed.has(p.eventId) && now - new Date(p.commence).getTime() < 12 * 3600e3);
  const prev = Object.fromEntries((old.props || []).map((p) => [p.id, p.line]));
  const props = [...kept, ...fresh.map((p) => (prev[p.id] != null && prev[p.id] !== p.line ? { ...p, prevLine: prev[p.id] } : p))];
  // Only keep the old file if every game failed to load (a network problem), never just
  // because no lines are posted yet: stale lines would be matched to the next slate.
  if (pre.length && failed.length === pre.length && !fresh.length) { console.log('Every game failed to load; keeping the previous file.'); process.exit(0); }
  await mkdir(dirname(OUT), { recursive: true });
  // Archive: the latest pre-game line for every player/stat, graded later by calibrate-lines.mjs.
  const HIST = OUT.replace('lines.json', 'lines-history.json');
  let hist = { entries: {} };
  try { hist = JSON.parse(await readFile(HIST, 'utf8')); } catch { /* first run */ }
  for (const p of fresh) hist.entries[`${p.eventId}|${p.id}`] = { id: p.id, player: p.player, market: p.market, line: p.line, eventId: p.eventId, commence: p.commence, ...(p.week ? { week: p.week } : {}) };
  for (const [k, v] of Object.entries(hist.entries)) if (now - new Date(v.commence).getTime() > 5 * 864e5) delete hist.entries[k];
  await writeFile(HIST, JSON.stringify(hist));
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'espn', book: PROVIDER.name, sport, props }));
  const byMarket = {};
  for (const p of fresh) byMarket[p.market] = (byMarket[p.market] || 0) + 1;
  console.log(`Wrote ${props.length} ${sport.toUpperCase()} ${PROVIDER.name} lines (${fresh.length} fresh from ${pre.length} upcoming games, ${kept.length} kept${failed.length ? `, ${failed.length} games failed` : ''}).`, byMarket);
} catch (e) {
  console.warn(`Could not refresh sportsbook lines: ${e.message}`);
}
