// College football (FBS) data source with the same functions and row shapes as src/api.js,
// so DataProvider and the NFL screens work unchanged. Built from scripts/fetch-espn-cfb.mjs.
import { HOUR, MIN, cached, fetchWithTimeout, readCache, writeCache } from '../api.js';
import { ESPN_BASE, parseScoreboard } from '../espn.js';

export const MAX_WEEK = 17;
const BASE = `${import.meta.env.BASE_URL}data/cfb/`;
const ESPN_LIVE = import.meta.env.DEV ? '/espn-api' : ESPN_BASE;
const id = (x) => x;
// A failed live request pauses live scores for 2 minutes (not the whole session), then retries.
let liveBlockedUntil = 0;
const liveBlocked = () => Date.now() < liveBlockedUntil;

const file = (name, ttl) => cached(`cfb:${name}`, ttl, async () => {
  const r = await fetch(BASE + name, { cache: 'no-cache' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`CFB data HTTP ${r.status}`);
  return r.json();
}, false);

export const getSnapshot = () => file('espn.json', 10 * MIN);

const norm = (r) => {
  const parts = r.name.split(' ');
  return { ...r, sport: 'cfb', first: parts[0], last: parts.slice(1).join(' '), injury: null, injuryPart: null };
};

export async function getState() {
  const s = await getSnapshot();
  return { season: String(s.season), week: s.week, season_type: s.seasonType === 2 ? 'regular' : 'post' };
}
export async function getTeams() { return (await getSnapshot()).teams; }
export async function getStandings() { return (await getSnapshot()).standings; }
export async function getWeekStats(season, week) {
  return ((await file(`week-${week}.json`, 30 * MIN)) || []).map(norm);
}
export async function getProjections(season, week) {
  return ((await file(`proj-${week}.json`, 30 * MIN)) || []).map(norm);
}

/** Week scoreboard; live from ESPN while games are on, snapshot otherwise. */
export async function getScoreboard(season, week, { force = false } = {}) {
  const snap = await getSnapshot();
  const games = snap.games.filter((g) => g.week === week);
  const fromSnap = { games, byes: [], source: 'snapshot', asOf: snap.generatedAt };
  const now = Date.now();
  const active = games.some((g) => g.state !== 'post' && now > new Date(g.date).getTime() - 15 * MIN && now < new Date(g.date).getTime() + 6 * HOUR);
  if (liveBlocked() || (!force && !import.meta.env.DEV && !active)) return fromSnap;
  const key = `cfb-sb-live:${season}:${week}`;
  const hit = readCache(key, 40 * 1000);
  if (hit) return hit;
  try {
    const raw = await fetchWithTimeout(`${ESPN_LIVE}/site/v2/sports/football/college-football/scoreboard?groups=80&limit=400&week=${week}&seasontype=2&dates=${season}`, 7000);
    const parsed = parseScoreboard(raw, id);
    // Keep the snapshot's lines for games the live board doesn't price.
    const lines = Object.fromEntries(games.map((g) => [g.id, g.line]));
    const live = { games: parsed.games.map((g) => ({ ...g, week, line: g.line || lines[g.id] || null })), byes: [], source: 'live', asOf: new Date().toISOString() };
    writeCache(key, live, false);
    return live;
  } catch {
    if (!import.meta.env.DEV) liveBlockedUntil = Date.now() + 2 * 60 * 1000;
    return fromSnap;
  }
}

export async function getTeamSchedule(abbr) {
  const snap = await getSnapshot();
  return snap.games
    .filter((g) => g.home.abbr === abbr || g.away.abbr === abbr)
    .sort((a, b) => a.week - b.week)
    .map((g) => {
      const home = g.home.abbr === abbr;
      const me = home ? g.home : g.away;
      const them = home ? g.away : g.home;
      return { week: g.week, date: g.date, home, opp: them.abbr, state: g.state, detail: g.detail, us: me.score, them: them.score, win: me.winner };
    });
}

export async function getGameSummary(eventId) {
  return fetchWithTimeout(`${ESPN_LIVE}/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(eventId)}&_=${Math.floor(Date.now() / 10000)}`, 9000);
}
