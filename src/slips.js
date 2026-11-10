// Saved slips: legs from the slip builders, Parlay Builder or Slip Scan, tracked live.
import { periodOf } from './tracker.js';
import { PAYOUTS } from './slipMath.js';

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
export function saveSlip({ title, source, legs, bet = null }) {
  const clean = legs.filter((l) => l.playerId && l.market && l.line != null).map((l) => ({
    sport: l.sport, playerId: l.playerId, player: l.player, team: l.team, opp: l.opp, market: l.market, stat: l.stat,
    line: Number(l.line), side: l.side || 'over', prob: l.prob ?? null, gameTime: l.gameTime || null, gameId: l.gameId || null,
    week: l.week ?? null, period: periodOf(l.sport, { week: l.week, date: l.gameTime }),
  }));
  if (!clean.length) return null;
  const slip = { id: `s${Date.now().toString(36)}`, created: Date.now(), title: title || `${clean.length}-pick slip`, source, legs: clean, bet: cleanBet(bet) };
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
    if (s?.legs[i]) { s.legs[i] = { ...s.legs[i], result }; if (result === undefined) delete s.legs[i].result; }
  }
  write(list);
}

// ---- Bets: amount, Power/Flex and payout, settled into profit -------------------

const cleanBet = (b) => (b && Number(b.stake) > 0 ? { stake: Math.round(Number(b.stake) * 100) / 100, mode: b.mode === 'flex' ? 'flex' : 'power', mult: b.mult ? Number(b.mult) : null } : null);
export function setBet(id, bet) { write(loadSlips().map((s) => (s.id === id ? { ...s, bet: cleanBet(bet) } : s))); }

/** Default multiplier text for a slip size. */
export const defaultMult = (n, mode = 'power') => (mode === 'flex' ? null : PAYOUTS.power[n] ?? null);

/**
 * Settle a finished slip. Voided/pushed legs shrink the slip (PrizePicks rules); fewer than
 * two live legs refunds the stake. -> { payout, profit, refunded }
 */
export function settleBet(bet, legsTotal, hits, misses, voids) {
  if (!bet) return null;
  const n = legsTotal - voids;
  if (n < 2) return { payout: bet.stake, profit: 0, refunded: true };
  let mult = 0;
  if (bet.mode === 'flex') mult = PAYOUTS.flex[n]?.[hits] ?? 0;
  else mult = misses ? 0 : (voids === 0 && bet.mult ? bet.mult : PAYOUTS.power[n] ?? 0);
  const payout = Math.round(bet.stake * mult * 100) / 100;
  return { payout, profit: Math.round((payout - bet.stake) * 100) / 100, refunded: false };
}
