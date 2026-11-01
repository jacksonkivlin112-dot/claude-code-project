// NBA data: Sleeper (season totals, per-game box scores, per-game projections)
// and an ESPN snapshot (teams, standings, schedule) with best-effort live scores.

import { HOUR, MIN, cached, fetchWithTimeout, getJSON, readCache, writeCache } from '../api.js';
import { ESPN_BASE, normFor, parseScoreboard } from '../espn.js';

const SLEEPER = 'https://api.sleeper.com';
const norm = normFor('nba');
const ESPN_LIVE = import.meta.env.DEV ? '/espn-api' : ESPN_BASE;
let liveBlocked = false;

const KEEP = ['pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm', 'tpa', 'fgm', 'fga', 'ftm', 'fta', 'oreb', 'dreb', 'min', 'sp', 'pf', 'plus_minus', 'gp', 'gs', 'dd', 'td'];

export const GROUP = { PG: 'G', SG: 'G', G: 'G', SF: 'F', PF: 'F', F: 'F', C: 'C' };

function pick(stats = {}) {
  const out = {};
  for (const k of KEEP) if (stats[k] != null) out[k] = stats[k];
  if (out.min == null && out.sp != null) out.min = out.sp / 60;
  return out;
}

function normRow(r) {
  const p = r.player || {};
  if (!r.player_id || String(r.player_id).startsWith('TEAM_') || !p.position) return null;
  const team = r.team || p.team;
  if (!team) return null;
  return {
    id: r.player_id,
    sport: 'nba',
    first: p.first_name || '',
    last: p.last_name || '',
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    pos: p.position,
    group: GROUP[p.position] || 'F',
    team,
    opp: r.opponent || null,
    injury: p.injury_status || null,
    injuryPart: p.injury_body_part || null,
    exp: p.years_exp,
    date: r.date,
    gameId: r.game_id,
    s: pick(r.stats),
  };
}

export function getState() {
  return cached('nba:state', 15 * MIN, () => getJSON('https://api.sleeper.app/v1/state/nba'));
}

/** Season totals per player (one request). */
export function getSeasonTotals(season) {
  return cached(`nba:season:${season}`, 30 * MIN, async () => {
    const rows = await getJSON(`${SLEEPER}/stats/nba/${season}?season_type=regular`);
    return rows.map(normRow).filter((r) => r && (r.s.gp || 0) > 0);
  });
}

/** One row per player-game for a Sleeper week (Mon–Sun). */
export function getWeekGames(season, week, { live = false } = {}) {
  return cached(
    `nba:wk:${season}:${week}`,
    live ? 3 * MIN : 48 * HOUR,
    async () => {
      const rows = await getJSON(`${SLEEPER}/stats/nba/${season}/${week}?season_type=regular`);
      return rows.map(normRow).filter((r) => r && (r.s.min || 0) > 0);
    },
    !live,
  );
}

export function getWeekProjections(season, week) {
  return cached(
    `nba:proj:${season}:${week}`,
    30 * MIN,
    async () => {
      const rows = await getJSON(`${SLEEPER}/projections/nba/${season}/${week}?season_type=regular`);
      return rows.map(normRow).filter((r) => r && r.opp && (r.s.pts || 0) >= 1);
    },
    false,
  );
}

export function getSnapshot() {
  return cached(
    'nba:snapshot',
    10 * MIN,
    async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}data/nba/espn.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`NBA snapshot HTTP ${res.status}`);
      return res.json();
    },
    false,
  );
}

// ---- dates --------------------------------------------------------------------
// NBA slates are grouped by US Eastern calendar date (how Sleeper dates games).

const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDate = (d = new Date()) => etFmt.format(typeof d === 'string' ? new Date(d) : d);
export const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Sleeper NBA week for a date: week 1 starts on season_start_date, later weeks Mon–Sun. */
export function weekOf(ymd, seasonStart) {
  const start = new Date(`${seasonStart}T12:00:00Z`);
  const monday = new Date(start);
  monday.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const d = new Date(`${ymd}T12:00:00Z`);
  return Math.max(1, Math.floor((d - monday) / (7 * 86400000)) + 1);
}

function needsLive(games, generatedAt) {
  const now = Date.now();
  const stale = now - new Date(generatedAt).getTime() > 2 * HOUR;
  return games.some((g) => {
    const k = new Date(g.date).getTime();
    return g.state !== 'post' && now > k - 15 * MIN && (stale || now < k + 4 * HOUR);
  });
}

/** Games on an ET date: { games, source, asOf }. */
export async function getSlate(ymd) {
  const snap = await getSnapshot();
  const fromSnap = { games: snap.games.filter((g) => etDate(g.date) === ymd), byes: [], source: 'snapshot', asOf: snap.generatedAt };
  const isToday = ymd === etDate();
  if (liveBlocked || (!import.meta.env.DEV && !(isToday && needsLive(fromSnap.games, snap.generatedAt)))) return fromSnap;
  const key = `nba:sb-live:${ymd}`;
  const hit = readCache(key, 30 * 1000);
  if (hit) return hit;
  try {
    const raw = await fetchWithTimeout(`${ESPN_LIVE}/site/v2/sports/basketball/nba/scoreboard?dates=${ymd.replace(/-/g, '')}`, 6000);
    const parsed = parseScoreboard(raw, norm);
    const live = { games: parsed.games, byes: [], source: 'live', asOf: new Date().toISOString() };
    writeCache(key, live, false);
    return live;
  } catch {
    if (!import.meta.env.DEV) liveBlocked = true;
    return fromSnap;
  }
}
