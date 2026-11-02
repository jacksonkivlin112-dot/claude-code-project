// Saved slips: legs from the slip builders, Parlay Builder or Slip Scan, tracked live.
import { periodOf } from './tracker.js';

const KEY = 'ge:slips:v1';
const subs = new Set();
export const loadSlips = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = (list) => {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  subs.forEach((f) => f(list));
};
export const onSlipsChange = (f) => { subs.add(f); return () => subs.delete(f); };

/**
 * legs: [{ sport, playerId, player, team, opp, market, stat, line, side, prob, gameTime, gameId, week }]
 * Returns the new slip's id.
 */
export function saveSlip({ title, source, legs }) {
  const clean = legs.filter((l) => l.playerId && l.market && l.line != null).map((l) => ({
    sport: l.sport, playerId: l.playerId, player: l.player, team: l.team, opp: l.opp, market: l.market, stat: l.stat,
    line: Number(l.line), side: l.side || 'over', prob: l.prob ?? null, gameTime: l.gameTime || null, gameId: l.gameId || null,
    week: l.week ?? null, period: periodOf(l.sport, { week: l.week, date: l.gameTime }),
  }));
  if (!clean.length) return null;
  const slip = { id: `s${Date.now().toString(36)}`, created: Date.now(), title: title || `${clean.length}-pick slip`, source, legs: clean };
  write([slip, ...loadSlips()]);
  return slip.id;
}
export function deleteSlip(id) { write(loadSlips().filter((s) => s.id !== id)); }
export function renameSlip(id, title) { write(loadSlips().map((s) => (s.id === id ? { ...s, title } : s))); }
/** Store final leg results so they survive after box scores roll out of the data window. */
export function storeResults(updates) {
  if (!updates.length) return;
  const list = loadSlips();
  for (const { id, i, result } of updates) {
    const s = list.find((x) => x.id === id);
    if (s?.legs[i]) s.legs[i] = { ...s.legs[i], result };
  }
  write(list);
}
