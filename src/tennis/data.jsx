import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataCtx, usePersistentState } from '../data.jsx';
import { ESPN_BASE } from '../espn.js';
import { ELO_START, eloExpect, matchOutlook, matchWinProb } from './model.js';
import { parseScoreboard } from './parse.js';

const LIVE = import.meta.env.DEV ? '/espn-api' : ESPN_BASE;
const POLL_MS = 30000;
export const TOURS = { atp: 'ATP', wta: 'WTA' };

async function loadSnapshot(tour) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/tennis/${tour}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Tennis data HTTP ${r.status}`);
  return r.json();
}
async function loadLive(tour) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${LIVE}/site/v2/sports/tennis/${tour}/scoreboard`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseScoreboard(await r.json(), tour);
  } finally { clearTimeout(t); }
}

/** Sets won so far and games in the open set, from A's side. */
export function scoreState(m) {
  let a = 0; let b = 0; let x = 0; let y = 0;
  for (const s of m.sets) {
    if (s.includes('open')) { x = s[0]; y = s[1]; continue; }
    if (s[0] > s[1]) a += 1; else if (s[1] > s[0]) b += 1;
  }
  return { a, b, x, y };
}

export function TennisDataProvider({ children }) {
  const [tour, setTour] = usePersistentState('tennisTour', 'atp');
  const [snap, setSnap] = useState({});
  const [live, setLive] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [atp, wta] = await Promise.all([loadSnapshot('atp'), loadSnapshot('wta')]);
      setSnap({ atp, wta });
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) { setError(e.message); }
    setLoading(false);
    for (const t of ['atp', 'wta']) loadLive(t).then((d) => setLive((p) => ({ ...p, [t]: { ...d, at: Date.now() } }))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live scores: newer than the snapshot, so they replace snapshot rows by id.
  const merged = useMemo(() => {
    const out = {};
    for (const t of ['atp', 'wta']) {
      const s = snap[t];
      if (!s) continue;
      const byId = new Map(s.matches.map((m) => [m.id, m]));
      for (const m of live[t]?.matches || []) byId.set(m.id, m);
      out[t] = { ...s, matches: [...byId.values()], liveAt: live[t]?.at || null };
    }
    return out;
  }, [snap, live]);

  const anyLive = Object.values(merged).some((d) => d.matches.some((m) => m.state === 'in'));
  useEffect(() => {
    if (!anyLive) return undefined;
    const id = setInterval(() => {
      for (const t of ['atp', 'wta']) loadLive(t).then((d) => { setLive((p) => ({ ...p, [t]: { ...d, at: Date.now() } })); setUpdatedAt(Date.now()); }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [anyLive]);

  const cur = merged[tour];
  const value = {
    sport: 'tennis',
    tour,
    setTour,
    tours: merged,
    data: cur || null,
    core: cur ? { sport: 'tennis', label: TOURS[tour] } : null,
    teams: {},
    board: { games: [], byes: [] },
    season: { players: new Map() },
    liveById: new Map(),
    gameByTeam: {},
    loading,
    error,
    updatedAt,
    reload: load,
    anyLive,
  };
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

const OUTLOOKS = new Map();

/** Model view of one match for the given tour's data. */
export function matchModel(m, d) {
  const pa = d?.players?.[m.a.id];
  const pb = d?.players?.[m.b.id];
  const ra = pa?.elo ?? ELO_START;
  const rb = pb?.elo ?? ELO_START;
  const raw = eloExpect(ra, rb);
  const shrink = d?.shrink ?? 1;
  const p = 0.5 + (raw - 0.5) * shrink;
  const bestOf = m.major && d?.tour === 'atp' ? 5 : 3;
  const key = `${Math.round(p * 1000)}|${bestOf}`;
  if (!OUTLOOKS.has(key)) OUTLOOKS.set(key, matchOutlook(Math.round(p * 1000) / 1000, bestOf));
  const outlook = OUTLOOKS.get(key);
  let liveP = null;
  if (m.state === 'in') {
    const s = scoreState(m);
    liveP = matchWinProb(outlook.q, bestOf, s.a, s.b, s.x, s.y);
  }
  const thin = (pa?.n ?? 0) < 10 || (pb?.n ?? 0) < 10;
  return { p, liveP, outlook, bestOf, pa, pb, thin };
}

export const headshot = (id) => `https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png`;
export const flagUrl = (code) => (code ? `https://a.espncdn.com/i/teamlogos/countries/500/${code}.png` : null);
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = (d) => etFmt.format(new Date(d));
