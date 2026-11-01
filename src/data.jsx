import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getProjections, getScoreboard, getStandings, getState, getTeams, getWeekStats } from './api.js';
import { buildSeason, rankDvp } from './model.js';

export const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

const LIVE_POLL_MS = 60 * 1000;

function readPref(key, fallback) {
  try {
    return localStorage.getItem(`ge:pref:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, v) {
  try {
    localStorage.setItem(`ge:pref:${key}`, v);
  } catch { /* ignore */ }
}

export function DataProvider({ children }) {
  const [core, setCore] = useState(null); // { season, week, seasonType }
  const [teams, setTeams] = useState(null);
  const [standings, setStandings] = useState([]);
  const [board, setBoard] = useState({ games: [], byes: [] });
  const [finished, setFinished] = useState([]); // [{week, rows}]
  const [liveRows, setLiveRows] = useState([]);
  const [proj, setProj] = useState({}); // week -> rows
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [updatedAt, setUpdatedAt] = useState(null);
  const [fmt, setFmtState] = useState(() => readPref('fmt', 'ppr'));
  const setFmt = useCallback((f) => {
    setFmtState(f);
    writePref('fmt', f);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const state = await getState();
      const season = Number(state.season);
      const regular = state.season_type === 'regular';
      // Pre-season: show week 1. Post/off-season: show the final regular-season week.
      const week = regular ? Math.min(Math.max(Number(state.week) || 1, 1), 18) : state.season_type === 'pre' ? 1 : 18;
      const c = { season, week, seasonType: state.season_type };
      setCore(c);

      const priorWeeks = Array.from({ length: week - 1 }, (_, i) => i + 1);
      const total = 4 + priorWeeks.length;
      let done = 0;
      const tick = (p) => p.then((v) => { done += 1; setProgress({ done, total }); return v; });

      const [t, s, sb, pr, ...weeks] = await Promise.all([
        tick(getTeams().catch(() => ({}))),
        tick(getStandings().catch(() => [])),
        tick(getScoreboard(season, week).catch(() => ({ games: [], byes: [], source: 'none' }))),
        tick(getProjections(season, week)),
        ...priorWeeks.map((w) => tick(getWeekStats(season, w).then((rows) => ({ week: w, rows })).catch(() => ({ week: w, rows: [] })))),
      ]);
      const live = await getWeekStats(season, week, { live: true }).catch(() => []);

      setTeams(t);
      setStandings(s);
      setBoard(sb);
      setProj((p) => ({ ...p, [week]: pr }));
      setFinished(weeks);
      setLiveRows(live);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadProjections = useCallback(
    async (week) => {
      if (!core || proj[week]) return;
      try {
        const rows = await getProjections(core.season, week);
        setProj((p) => ({ ...p, [week]: rows }));
      } catch {
        setProj((p) => ({ ...p, [week]: [] }));
      }
    },
    [core, proj],
  );

  // Poll scores + live box scores while any game is in progress.
  const anyLive = board.games.some((g) => g.state === 'in');
  const pollRef = useRef();
  useEffect(() => {
    if (!core || !anyLive) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const [sb, live] = await Promise.all([
          getScoreboard(core.season, core.week),
          getWeekStats(core.season, core.week, { live: true }),
        ]);
        setBoard(sb);
        setLiveRows(live);
        setUpdatedAt(Date.now());
      } catch { /* keep last good data */ }
    }, LIVE_POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [core, anyLive]);

  const finalTeams = useMemo(() => {
    const set = new Set();
    for (const g of board.games) if (g.state === 'post') { set.add(g.home.abbr); set.add(g.away.abbr); }
    return set;
  }, [board]);

  const season = useMemo(
    () => buildSeason(finished, core ? { week: core.week, rows: liveRows, finalTeams } : null),
    [finished, liveRows, finalTeams, core],
  );
  const ranks = useMemo(() => rankDvp(season.dvp, fmt), [season, fmt]);
  const liveById = useMemo(() => new Map(liveRows.map((r) => [r.id, r])), [liveRows]);
  const gameByTeam = useMemo(() => {
    const m = {};
    for (const g of board.games) { m[g.home.abbr] = g; m[g.away.abbr] = g; }
    return m;
  }, [board]);

  const value = {
    core, teams, standings, board, proj, season, ranks, fmt, setFmt,
    liveById, gameByTeam, loading, progress, error, updatedAt, reload: load, loadProjections, anyLive,
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

// Simple hash router: #/projections?pos=WR (NFL) or #/nba/projections (NBA)
export function useRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#\/?/, '');
    const [rawPath, qs] = h.split('?');
    const parts = (rawPath || '').split('/').filter(Boolean);
    const sport = parts[0] === 'nba' ? 'nba' : 'nfl';
    if (sport === 'nba') parts.shift();
    return { sport, path: parts[0] || 'home', params: new URLSearchParams(qs || '') };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path, params, sport = 'nfl') {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  window.location.hash = `/${sport === 'nba' ? 'nba/' : ''}${path}${qs}`;
}

export function usePersistentState(key, initial) {
  const [v, setV] = useState(() => readPref(key, initial));
  const set = useCallback((x) => { setV(x); writePref(key, x); }, [key]);
  return [v, set];
}
