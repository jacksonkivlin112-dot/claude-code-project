import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataCtx } from '../data.jsx';
import { addDays, etDate, getSeasonTotals, getSlate, getSnapshot, getState, getWeekGames, getWeekProjections, weekOf } from './api.js';
import { backToBack, buildNbaSeason, rankNbaDvp } from './model.js';

const RECENT_WEEKS = 4;
const POLL_MS = 45 * 1000;

export function NbaDataProvider({ children }) {
  const [core, setCore] = useState(null);
  const [snap, setSnap] = useState(null);
  const [date, setDateState] = useState(null);
  const [board, setBoard] = useState({ games: [], byes: [] });
  const [totals, setTotals] = useState([]);
  const [weeks, setWeeks] = useState({}); // week -> rows
  const [proj, setProj] = useState({}); // week -> rows
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [state, snapshot] = await Promise.all([getState(), getSnapshot()]);
      const season = Number(state.season);
      const week = Math.max(1, Number(state.week) || 1);
      const seasonStart = state.season_start_date || `${season}-10-20`;
      setSnap(snapshot);

      // Default slate: today (ET). Once every game today is final, jump to the next night with games.
      let d = etDate();
      const onDay = (x) => snapshot.games.filter((g) => etDate(g.date) === x);
      const allDone = (x) => { const gs = onDay(x); return gs.length > 0 && gs.every((g) => g.state === 'post'); };
      if (allDone(d)) {
        // The snapshot can lag a few minutes; also treat games that tipped off 3.5h+ ago as done.
        d = addDays(d, 1);
      } else if (onDay(d).length && onDay(d).every((g) => g.state === 'post' || Date.now() - new Date(g.date).getTime() > 3.5 * 3600000)) {
        d = addDays(d, 1);
      }
      for (let i = 0; i < 10 && !onDay(d).length; i++) d = addDays(d, 1);
      const label = `${season}-${String(season + 1).slice(2)}`;
      setCore({ season, week, seasonStart, sport: 'nba', label });

      const recent = Array.from({ length: Math.min(RECENT_WEEKS, week) }, (_, i) => week - i);
      const total = 3 + recent.length;
      let done = 0;
      const tick = (p) => p.then((v) => { done += 1; setProgress({ done, total }); return v; });
      const projWeek = weekOf(d, seasonStart);
      const [tot, slate, pr, ...wk] = await Promise.all([
        tick(getSeasonTotals(season).catch(() => [])),
        tick(getSlate(d).catch(() => ({ games: [], byes: [], source: 'none' }))),
        tick(getWeekProjections(season, projWeek).catch(() => [])),
        ...recent.map((w) => tick(getWeekGames(season, w, { live: w === week }).catch(() => []))),
      ]);
      setTotals(tot);
      setBoard(slate);
      setProj((p) => ({ ...p, [projWeek]: pr }));
      setWeeks((prev) => ({ ...prev, ...Object.fromEntries(recent.map((w, i) => [w, wk[i]])) }));
      setDateState(d);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setDate = useCallback(async (d) => {
    if (!core) return;
    setDateState(d);
    const w = weekOf(d, core.seasonStart);
    const [slate] = await Promise.all([
      getSlate(d).catch(() => ({ games: [], byes: [] })),
      proj[w] ? null : getWeekProjections(core.season, w).then((rows) => setProj((p) => ({ ...p, [w]: rows }))).catch(() => setProj((p) => ({ ...p, [w]: [] }))),
      weeks[w] || w > core.week ? null : getWeekGames(core.season, w).then((rows) => setWeeks((p) => ({ ...p, [w]: rows }))).catch(() => {}),
    ]);
    setBoard(slate);
  }, [core, proj, weeks]);

  const isToday = date === etDate();
  const anyLive = isToday && board.games.some((g) => g.state === 'in');
  useEffect(() => {
    if (!core || !anyLive) return undefined;
    const id = setInterval(async () => {
      try {
        const [slate, rows] = await Promise.all([getSlate(date), getWeekGames(core.season, core.week, { live: true })]);
        setBoard(slate);
        setWeeks((p) => ({ ...p, [core.week]: rows }));
        setUpdatedAt(Date.now());
      } catch { /* keep last good */ }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [core, anyLive, date]);

  const recentRows = useMemo(() => {
    if (!core) return [];
    const ws = Object.keys(weeks).map(Number).filter((w) => w > core.week - RECENT_WEEKS && w <= core.week);
    return ws.flatMap((w) => weeks[w] || []);
  }, [weeks, core]);

  const season = useMemo(() => buildNbaSeason(totals, recentRows), [totals, recentRows]);
  const dvp = useMemo(() => rankNbaDvp(season.dvp), [season]);
  const allGames = snap?.games || [];
  const b2b = useMemo(() => (date ? backToBack(allGames, date, etDate, addDays) : new Set()), [allGames, date]);

  const dateWeek = core && date ? weekOf(date, core.seasonStart) : null;
  const projRows = useMemo(() => (dateWeek && proj[dateWeek] ? proj[dateWeek].filter((r) => r.date === date) : null), [proj, dateWeek, date]);
  const liveById = useMemo(() => {
    const rows = (dateWeek && weeks[dateWeek]) || [];
    return new Map(rows.filter((r) => r.date === date).map((r) => [r.id, r]));
  }, [weeks, dateWeek, date]);
  const gameByTeam = useMemo(() => {
    const m = {};
    for (const g of board.games) { m[g.home.abbr] = g; m[g.away.abbr] = g; }
    return m;
  }, [board]);

  const value = {
    sport: 'nba',
    core,
    teams: snap?.teams || null,
    standings: snap?.standings || [],
    allGames,
    board,
    date,
    setDate,
    isToday,
    projRows,
    season,
    dvp,
    ranks: dvp.ranks,
    b2b,
    liveById,
    gameByTeam,
    loading,
    progress,
    error,
    updatedAt,
    reload: load,
    anyLive,
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
