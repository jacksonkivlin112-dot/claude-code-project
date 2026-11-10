// App-wide slip tracking: keeps NFL/NBA data for open slips loaded on every tab,
// works out each leg's status, live chance to hit and injury news, and fires the
// hype toasts / notifications from anywhere in the app.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DataProvider, sportPath } from './data.jsx';
import { NbaDataProvider } from './nba/data.jsx';
import { CFGS, OWN_HOOK } from './dualSport.jsx';
import { loadSlips, onSlipsChange, settleBet, storeResults } from './slips.js';
import { legStatus } from './tracker.js';
import { notify } from './components/Tracking.jsx';
import { hypeLine, sendHype } from './ai/hype.js';
import { useNow } from './components/ui.jsx';

const HubCtx = createContext({ view: [], sports: { nfl: { ctx: null, rows: null }, nba: { ctx: null, rows: null } } });
export const useSlipsHub = () => useContext(HubCtx);

const PROVIDERS = { nfl: DataProvider, nba: NbaDataProvider };
const BAD_INJ = ['Out', 'Doubtful', 'Questionable', 'IR', 'Sus', 'PUP', 'NFI'];
export const fmtVal = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
export const money = (n, sign = false) => `${sign && n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function Bridge({ use, onChange }) {
  const v = use();
  useEffect(() => { onChange(v); }, [v.ctx, v.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A saved result is only trusted while the leg's game isn't still on (or not started) today. */
export function resultStale(leg, sports) {
  if (!leg.result) return false;
  const g = legGame(leg, sports);
  return !!g && g.state !== 'post';
}

export function statusOf(leg, sports) {
  if (leg.result && !resultStale(leg, sports)) return { state: 'final', ...leg.result };
  const ctx = sports[leg.sport]?.ctx;
  if (!ctx) return { state: 'loading' };
  return legStatus(leg, { markets: CFGS[leg.sport].markets, season: ctx.season, liveById: ctx.liveById, gameByTeam: ctx.gameByTeam });
}

export function slipState(sts) {
  const hit = sts.filter((s) => s.state === 'final' && s.hit).length;
  const miss = sts.filter((s) => s.state === 'final' && !s.hit && !s.push).length;
  const voids = sts.filter((s) => s.state === 'void' || s.push).length;
  const open = sts.length - hit - miss - voids;
  const live = sts.some((s) => s.state === 'live');
  if (miss) return { key: 'lost', label: open ? `Lost · ${miss} miss${miss > 1 ? 'es' : ''}` : `Lost · ${hit} of ${sts.length} hit`, hit, miss, open, voids };
  if (!open) return { key: 'won', label: voids ? `Won · ${hit} hit, ${voids} void` : `Won · all ${hit} hit`, hit, miss, open, voids };
  if (live || hit) return { key: 'live', label: `Live · ${hit} of ${sts.length} hit so far`, hit, miss, open, voids };
  return { key: 'pending', label: 'Upcoming', hit, miss, open, voids };
}

/** The game a leg belongs to (null when the loaded slate has a different game for that team). */
export function legGame(leg, sports) {
  const g = sports[leg.sport]?.ctx?.gameByTeam?.[leg.team];
  if (!g || (leg.gameTime && Math.abs(new Date(g.date) - new Date(leg.gameTime)) > 12 * 3600e3)) return null;
  return g;
}

/** Share of the game played, from ESPN's short detail ("8:42 - 3rd", "Halftime", "End of 2nd", "OT"). */
export function gameProgress(g, sport) {
  if (!g) return null;
  if (g.state === 'pre') return 0;
  if (g.state === 'post') return 1;
  const d = String(g.detail || '');
  if (/half/i.test(d)) return 0.5;
  if (/OT/i.test(d)) return 0.97;
  const per = /OT/i.test(d) ? 4 : Number(d.match(/(\d)(?:st|nd|rd|th)/)?.[1] || (d.match(/Q(\d)/)?.[1]) || 1);
  const len = sport === 'nba' ? 12 : 15;
  if (/end/i.test(d)) return Math.min(1, per / 4);
  const c = d.match(/(\d{1,2}):(\d{2})/);
  const left = c ? Number(c[1]) + Number(c[2]) / 60 : len / 2;
  return Math.max(0, Math.min(0.99, ((Math.min(per, 4) - 1) * len + (len - left)) / (4 * len)));
}

const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const cdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

function seasonAvg(leg, sports) {
  const S = sports[leg.sport];
  const M = CFGS[leg.sport]?.markets?.[leg.market];
  const p = S?.ctx?.season?.players?.get(leg.playerId);
  if (!M || !p) return null;
  const row = S.rows?.find?.((r) => r.id === leg.playerId);
  const projected = row?.projStats ? M.get(row.projStats) : null;
  if (projected) return projected;
  if (p.avg && Object.keys(p.avg).length) return M.get(p.avg) ?? null;
  const log = (p.log || []).slice(-8);
  if (!log.length) return null;
  return log.reduce((a, l) => a + (M.get(l.s) ?? 0), 0) / log.length;
}

/**
 * Live chance a leg hits: what they have + what they usually add over the time left.
 * @returns {{chance:number, pace:number|null, need:number}|null}
 */
export function liveChance(leg, st, sports) {
  if (st.state === 'final') return { chance: st.push ? 0.5 : st.hit ? 1 : 0, pace: st.actual, need: 0 };
  if (st.state !== 'live') return leg.prob != null ? { chance: leg.side === 'under' ? 1 - leg.prob : leg.prob, pace: null, need: leg.line - 0 } : null;
  const g = legGame(leg, sports);
  const frac = gameProgress(g, leg.sport);
  const avg = seasonAvg(leg, sports);
  const actual = st.actual ?? 0;
  if (frac == null || avg == null) return null;
  const M = CFGS[leg.sport].markets[leg.market];
  const rem = Math.max(0, avg * (1 - frac));
  const sd = M?.dist === 'poisson' || (M?.poissonBelow && avg < M.poissonBelow) ? Math.sqrt(Math.max(rem, 0.05)) : Math.max(0.35, (M?.cv || 0.35) * avg * Math.sqrt(1 - frac));
  const need = leg.line - actual; // more needed to go over
  const pOver = 1 - cdf((need - rem) / sd);
  const chance = leg.side === 'under' ? 1 - pOver : pOver;
  const pace = frac > 0.05 ? actual / frac : null;
  return { chance: Math.max(0.01, Math.min(0.99, chance)), pace, need: Math.max(0, need) };
}

/** Injury status for a player on an open leg (Sleeper status), or null. */
export function legInjury(leg, sports) {
  const S = sports[leg.sport];
  const p = S?.ctx?.season?.players?.get(leg.playerId);
  const row = S?.rows?.find?.((r) => r.id === leg.playerId);
  const inj = row?.injury || p?.injury || null;
  return inj && BAD_INJ.includes(inj) ? { status: inj, part: row?.injuryPart || p?.injuryPart || null } : null;
}

const HYPED = 'ge:slips:hyped';
const NOTIFIED = 'ge:slips:notified';
const readSet = (k) => { try { const v = localStorage.getItem(k); return v ? new Set(JSON.parse(v)) : null; } catch { return null; } };
const writeSet = (k, s) => { try { localStorage.setItem(k, JSON.stringify([...s].slice(-600))); } catch { /* ignore */ } };

/** Fires each event once: hype toast in the app + a push notification when allowed. */
function useResultEvents(events) {
  const seen = useRef(null);
  const sent = useRef(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = readSet(HYPED);
      if (!seen.current) { seen.current = new Set(events.map((e) => e.key)); writeSet(HYPED, seen.current); return; } // first run: don't replay history
    }
    if (!sent.current) sent.current = readSet(NOTIFIED) || new Set();
    const fresh = [];
    let changed = false;
    for (const ev of events) {
      if (seen.current.has(ev.key)) continue;
      seen.current.add(ev.key); changed = true;
      if (Date.now() - ev.when < 8 * 3600e3) fresh.push(ev);
    }
    if (!changed) return;
    writeSet(HYPED, seen.current);
    const big = (e) => e.hype.kind === 'won' || e.hype.kind === 'lost';
    fresh.sort((a, b) => big(b) - big(a)).slice(0, 4).forEach((ev, i) => {
      setTimeout(() => sendHype(ev.hype), i * 900);
      if (!sent.current.has(ev.key) && 'Notification' in window && Notification.permission === 'granted') {
        sent.current.add(ev.key);
        notify(ev.title, `${hypeLine(ev.hype)}\n${ev.body}`, ev.key);
      }
    });
    writeSet(NOTIFIED, sent.current);
  }, [events]);
}

/** Wrap the app shell: provides { view, sports } and renders the live entry bar. */
export function SlipsHub({ route, children }) {
  const [slips, setSlips] = useState(loadSlips);
  const [data, setData] = useState({ nfl: { ctx: null, rows: null }, nba: { ctx: null, rows: null } });
  useEffect(() => onSlipsChange(setSlips), []);
  useNow(30000);
  const onSlips = route.path === 'slips';
  const need = useMemo(() => {
    const s = new Set(onSlips ? ['nfl', 'nba'] : []);
    for (const sl of slips) for (const l of sl.legs) if (!l.result && PROVIDERS[l.sport] && Date.now() - new Date(l.gameTime || 0).getTime() < 48 * 3600e3) s.add(l.sport);
    return s;
  }, [slips, onSlips]);
  const setFor = (sp) => (v) => setData((d) => (d[sp].ctx === v.ctx && d[sp].rows === v.rows ? d : { ...d, [sp]: v }));
  const setters = useMemo(() => ({ nfl: setFor('nfl'), nba: setFor('nba') }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const own = PROVIDERS[route.sport] ? route.sport : null;
  const sports = data;

  const view = useMemo(() => slips.map((s) => {
    const sts = s.legs.map((l) => statusOf(l, sports));
    const st = slipState(sts);
    const settled = st.open === 0 ? settleBet(s.bet, s.legs.length, st.hit, st.miss, st.voids) : null;
    return { slip: s, sts, st, settled };
  }), [slips, sports]);

  useEffect(() => {
    const ups = [];
    for (const v of view) {
      v.sts.forEach((st, i) => {
        const leg = v.slip.legs[i];
        // Only save a result once the game is over; clear any that were saved too early.
        if (st.state === 'final' && !leg.result && !(legGame(leg, sports)?.state && legGame(leg, sports).state !== 'post')) ups.push({ id: v.slip.id, i, result: { actual: st.actual, hit: st.hit, push: !!st.push } });
        else if (resultStale(leg, sports)) ups.push({ id: v.slip.id, i, result: undefined });
      });
    }
    if (ups.length) storeResults(ups);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => {
    const out = [];
    for (const v of view) {
      v.slip.legs.forEach((l, i) => {
        const st = v.sts[i];
        const side = l.side === 'under' ? 'Less' : 'More';
        if (st.state === 'final') {
          out.push({
            key: `${v.slip.id}|${i}`, when: new Date(l.gameTime || v.slip.created).getTime(),
            title: `${st.hit ? '✅' : st.push ? '➖' : '❌'} ${l.player} ${st.hit ? 'hit' : st.push ? 'pushed' : 'missed'}`,
            body: `${side} ${l.line} ${l.stat}: ${fmtVal(st.actual)} · ${v.slip.title}`,
            hype: st.push ? { kind: 'push', player: l.player, side, line: l.line, stat: l.stat, actual: st.actual } : { kind: st.hit ? 'hit' : 'miss', player: l.player, side, line: l.line, stat: l.stat, actual: st.actual ?? 0 },
          });
        } else if (st.state === 'pending' || st.state === 'live') {
          const inj = legInjury(l, sports);
          if (inj && st.state === 'pending') {
            out.push({
              key: `${v.slip.id}|${i}|inj|${inj.status}`, when: Date.now(),
              title: `⚠️ ${l.player} is ${inj.status}`, body: `${side} ${l.line} ${l.stat} on ${v.slip.title}${inj.part ? ` · ${inj.part}` : ''}`,
              hype: { kind: 'injury', player: l.player, status: inj.status, part: inj.part, side, line: l.line, stat: l.stat },
            });
          }
        }
      });
      if (v.st.key === 'won' || v.st.key === 'lost') {
        out.push({
          key: `${v.slip.id}|done`, when: Math.max(...v.slip.legs.map((l) => new Date(l.gameTime || 0).getTime())),
          title: v.st.key === 'won' ? `🏆 ${v.slip.title} won!` : `${v.slip.title} lost`, body: v.st.label,
          hype: { kind: v.st.key, title: v.slip.title, legs: v.slip.legs.length, hits: v.st.hit, payout: v.st.key === 'won' && v.settled?.payout ? money(v.settled.payout) : null },
        });
      }
    }
    return out;
  }, [view, sports]);
  useResultEvents(events);

  const value = useMemo(() => ({ view, sports }), [view, sports]);
  if (typeof window !== 'undefined') window.__geHub = value; // for debugging from the console
  return (
    <HubCtx.Provider value={value}>
      {own && need.has(own) && <Bridge key={own} use={OWN_HOOK[own]} onChange={setters[own]} />}
      {[...need].filter((sp) => sp !== own).map((sp) => {
        const P = PROVIDERS[sp];
        return <P key={sp}><Bridge use={OWN_HOOK[sp]} onChange={setters[sp]} /></P>;
      })}
      {children}
    </HubCtx.Provider>
  );
}

/** Thin bar under the header with your most active open entry; tap to open it. */
export function LiveEntryBar({ route }) {
  const { view, sports } = useSlipsHub();
  if (route.path === 'slips' || route.path === 'game') return null;
  const live = view.filter((v) => v.st.open > 0 && (v.sts.some((s) => s.state === 'live') || v.st.hit || v.st.miss));
  if (!live.length) return null;
  const v = live[0];
  const sport = v.slip.legs[0].sport;
  // The leg that most needs it: live and furthest from hitting.
  let focus = null;
  v.slip.legs.forEach((l, i) => {
    const s = v.sts[i];
    if (s.state !== 'live') return;
    const c = liveChance(l, s, sports);
    if (!focus || (c?.chance ?? 1) < (focus.c?.chance ?? 1)) focus = { l, s, c };
  });
  const lost = v.st.miss > 0 && v.slip.bet?.mode !== 'flex';
  return (
    <a className={`livebar ${lost ? 'lost' : ''}`} href={`#/${sportPath(sport)}slips?entry=${encodeURIComponent(v.slip.id)}`}>
      <span className="livebar-dots">
        {v.sts.map((s, i) => <i key={i} className={s.state === 'final' ? (s.push ? 'push' : s.hit ? 'hit' : 'miss') : s.state} />)}
      </span>
      <span className="livebar-txt">
        <b>{v.st.hit}/{v.slip.legs.length} hit{live.length > 1 ? ` · +${live.length - 1} more live` : ''}</b>
        <small>
          {focus ? (focus.l.side === 'under'
            ? `${focus.l.player.split(' ').slice(-1)[0]} ${fmtVal(focus.s.actual ?? 0)} / under ${focus.l.line} ${focus.l.stat}`
            : `${focus.l.player.split(' ').slice(-1)[0]} needs ${fmtVal(Math.max(0, focus.l.line - (focus.s.actual ?? 0)) + (Number.isInteger(focus.l.line) ? 1 : 0.5))} more ${focus.l.stat}`)
            + (focus.c ? ` · ${Math.round(focus.c.chance * 100)}%` : '')
            : lost ? 'One leg missed' : 'Waiting on the next game'}
        </small>
      </span>
      <span className="livebar-go">{v.slip.bet ? 'Entry ›' : 'Slip ›'}</span>
    </a>
  );
}
