// Pick tracker: logs the model's picks before games start, grades them from box
// scores afterwards, and summarizes how each grade has actually performed.
// Stored on this device (localStorage), one list per sport.
import { etDate } from './nba/api.js';
import { BREAKEVEN } from './propsModel.js';

const KEY = (sport) => `ge:track:v1:${sport}`;
const MAX = 4000;
const read = (sport) => { try { return JSON.parse(localStorage.getItem(KEY(sport))) || []; } catch { return []; } };
const write = (sport, list) => { try { localStorage.setItem(KEY(sport), JSON.stringify(list.slice(-MAX))); } catch { /* full or blocked */ } };

export const loadPicks = read;
export function clearPicks(sport) { write(sport, []); }

/** Which game a pick belongs to: NFL by week, NBA by (ET) date. */
export function periodOf(sport, { week, date }) {
  return sport === 'nba' ? (date ? etDate(date) : etDate()) : `W${week}`;
}

/**
 * Record open picks. `line` picks are real PrizePicks lines the model graded;
 * `safe` picks are the model's own highest-chance floor lines (75% target).
 * A pick keeps updating until its game starts, then it is frozen.
 */
export function logPicks(sport, { week, evaluated = [], safe = [], gameByTeam = {} }) {
  const list = read(sport);
  const byId = new Map(list.map((p, i) => [p.id, i]));
  const now = Date.now();
  let changed = false;
  const upsert = (rec) => {
    const i = byId.get(rec.id);
    if (i == null) { byId.set(rec.id, list.length); list.push(rec); changed = true; return; }
    const old = list[i];
    if (old.result || (old.gameTime && new Date(old.gameTime).getTime() <= now)) return;
    if (old.line !== rec.line || old.side !== rec.side || old.grade !== rec.grade || Math.abs(old.prob - rec.prob) > 0.005) {
      list[i] = { ...rec, loggedAt: old.loggedAt };
      changed = true;
    }
  };
  for (const e of evaluated) {
    if (e.started || e.unmatched || e.inactive || e.manual || !e.playerId || !e.grade || e.grade.key === 'pass') continue;
    const g = gameByTeam[e.team];
    const gameTime = e.commence || g?.date;
    if (!gameTime || new Date(gameTime).getTime() <= now) continue;
    const period = periodOf(sport, { week, date: gameTime });
    upsert({
      id: `${period}|line|${e.playerId}|${e.market}`, kind: 'line', sport, period, week: sport === 'nfl' ? week : undefined,
      playerId: e.playerId, player: e.player, team: e.team, opp: e.opp, market: e.market, stat: e.marketShort,
      line: e.line, side: e.side, prob: e.prob, grade: e.grade.key, gameId: g?.id, gameTime, loggedAt: now,
    });
  }
  for (const p of safe) {
    if (p.state !== 'pre' || !p.date || new Date(p.date).getTime() <= now) continue;
    const period = periodOf(sport, { week, date: p.date });
    upsert({
      id: `${period}|safe|${p.playerId}|${p.market}`, kind: 'safe', sport, period, week: sport === 'nfl' ? week : undefined,
      playerId: p.playerId, player: p.player, team: p.team, opp: p.opp, market: p.market, stat: p.stat,
      line: p.line, side: 'over', prob: p.prob, grade: 'safe', gameId: p.game?.split(':')[1], gameTime: p.date, loggedAt: now,
    });
  }
  if (changed) write(sport, list);
  return changed;
}

/**
 * Current status of one leg/pick from box scores.
 * -> { state: 'pending'|'live'|'final'|'void', actual, hit, push }
 */
export function legStatus(pick, { markets, season, liveById, gameByTeam }, now = Date.now()) {
  const M = markets[pick.market];
  if (!M) return { state: 'pending' };
  const p = season?.players?.get(pick.playerId);
  const log = p?.log?.find((l) => (pick.sport === 'nba' ? l.date === pick.period : `W${l.week}` === pick.period));
  const judge = (actual, final) => {
    const push = actual === pick.line;
    const over = actual > pick.line;
    const hit = pick.side === 'over' ? over : !over && !push;
    // An over that already cleared can't be undone; an under that's already been passed is lost.
    const locked = !final && ((pick.side === 'over' && over) || (pick.side === 'under' && over));
    return { state: final || locked ? 'final' : 'live', actual, hit: final || locked ? hit : null, push: final && push, onPace: hit };
  };
  if (log) return judge(M.get(log.s) ?? 0, true);
  const g = gameByTeam?.[pick.team];
  const sameGame = g && (!pick.gameId || String(g.id) === String(pick.gameId) || Math.abs(new Date(g.date) - new Date(pick.gameTime)) < 12 * 3600e3);
  const live = liveById?.get(pick.playerId);
  if (sameGame && g.state !== 'pre' && live) return judge(M.get(live.s) ?? 0, g.state === 'post');
  if (sameGame && g.state === 'in') return { state: 'live', actual: 0, hit: null, onPace: pick.side === 'under' };
  const t = new Date(pick.gameTime).getTime();
  if (now - t > 40 * 3600e3) return { state: 'void' }; // never showed up in a box score (did not play)
  return { state: now > t ? 'live' : 'pending' };
}

/** Grade any finished picks and store their results. */
export function gradePicks(sport, data) {
  const list = read(sport);
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.result) continue;
    if (new Date(p.gameTime).getTime() > Date.now()) continue;
    const s = legStatus(p, data);
    if (s.state === 'final') { list[i] = { ...p, result: s.push ? 'push' : s.hit ? 'hit' : 'miss', actual: s.actual }; changed = true; }
    else if (s.state === 'void') { list[i] = { ...p, result: 'void' }; changed = true; }
  }
  if (changed) write(sport, list);
  return list;
}

const tally = (rows) => {
  const hits = rows.filter((r) => r.result === 'hit').length;
  const misses = rows.filter((r) => r.result === 'miss').length;
  const n = hits + misses;
  const expected = rows.filter((r) => r.result === 'hit' || r.result === 'miss').reduce((a, r) => a + r.prob, 0);
  return { hits, misses, n, rate: n ? hits / n : null, expected: n ? expected / n : null };
};

/** Records by grade, stat and side, plus a calibration table (said vs. actually hit). */
export function summarize(list, { days = null } = {}) {
  const cutoff = days ? Date.now() - days * 864e5 : 0;
  const done = list.filter((p) => p.result && new Date(p.gameTime).getTime() >= cutoff);
  const lines = done.filter((p) => p.kind === 'line');
  const safe = done.filter((p) => p.kind === 'safe');
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].map(([k, rs]) => ({ key: k, ...tally(rs) })).filter((g) => g.n).sort((a, b) => b.n - a.n);
  };
  const buckets = [[0.5, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 0.8], [0.8, 1.01]];
  const calibration = buckets.map(([lo, hi]) => ({ lo, hi, ...tally(done.filter((r) => r.prob >= lo && r.prob < hi)) })).filter((b) => b.n);
  return {
    lines: tally(lines),
    safe: tally(safe),
    byGrade: ['strong', 'solid', 'lean'].map((g) => ({ key: g, ...tally(lines.filter((r) => r.grade === g)) })),
    byStat: group(done, (r) => r.stat),
    bySide: group(lines, (r) => r.side),
    calibration,
    breakeven: BREAKEVEN,
  };
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const stdev = (a) => { const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/**
 * Replay of the highest-chance method on past games, using only games played
 * before each one: form-based mean and spread, the same floor-line rule, the same
 * "cleared it in most recent games" and realistic-line filters, best stat per player.
 * Leaves out matchup, injury and game-script inputs, which aren't stored historically.
 */
export function backtestSafe(cfg, players, safeLine, target = 0.75, sdMult) {
  const byGame = new Map(); // `${player}|${game}` -> best candidate
  for (const p of players.values()) {
    const safe = cfg.safeMarkets[cfg.groupOf(p)];
    if (!safe || !p.log || p.log.length < 5) continue;
    for (const m of safe) {
      const M = cfg.markets[m];
      const vals = p.log.map((l) => M.get(l.s) ?? 0);
      for (let k = 4; k < vals.length; k++) {
        const prior = vals.slice(0, k);
        const mean = 0.5 * avg(prior) + 0.5 * avg(prior.slice(-5));
        if (!(mean > 0)) continue;
        const sd = Math.max(stdev(prior), (M.cv || 0.3) * mean);
        const line = safeLine(M, mean, sd, target, sdMult)?.line;
        if (line == null || line < (cfg.minLine[m] ?? 0.5) || line / mean < 0.6) continue;
        const recent = prior.slice(-10);
        const hitRate = recent.filter((v) => v > line).length / recent.length;
        if (hitRate < 0.6) continue;
        const score = 0.45 * hitRate + 0.35 * Math.min(1, line / mean) + 0.2 * target;
        const id = `${p.id}|${p.log[k].week ?? p.log[k].date}`;
        const cur = byGame.get(id);
        if (!cur || score > cur.score) byGame.set(id, { score, market: m, stat: M.short, line, actual: vals[k], hit: vals[k] > line });
      }
    }
  }
  const rows = [...byGame.values()];
  const hits = rows.filter((r) => r.hit).length;
  const byStat = new Map();
  for (const r of rows) {
    const s = byStat.get(r.stat) || { stat: r.stat, n: 0, hits: 0 };
    s.n += 1; s.hits += r.hit ? 1 : 0;
    byStat.set(r.stat, s);
  }
  return { n: rows.length, hits, rate: rows.length ? hits / rows.length : null, target, byStat: [...byStat.values()].sort((a, b) => b.n - a.n) };
}
