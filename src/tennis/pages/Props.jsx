import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Card, Empty, Segmented, SkeletonRows, useUi } from '../../components/ui.jsx';
import { Face } from '../components.jsx';
import { TOURS, matchModel } from '../data.jsx';
import { jointProb, safeOverLine } from '../model.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const when = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const STATS = { won: 'Games Won', total: 'Total Games', sets: 'Sets Won' };

/** Upcoming matches (next ~36h) with each side's games distribution. */
function useMatches(which) {
  const { tours } = useData();
  return useMemo(() => {
    const now = Date.now();
    const out = [];
    for (const t of which === 'both' ? ['atp', 'wta'] : [which]) {
      const d = tours?.[t];
      for (const m of d?.matches || []) {
        const ts = new Date(m.date).getTime();
        if (m.state !== 'pre' || ts - now > 36 * 3600e3 || ts < now - 3600e3 || !m.a?.name || !m.b?.name || /TBD/i.test(m.a.name + m.b.name)) continue;
        const model = matchModel(m, d);
        out.push({ m, tour: t, model, o: model.outlook });
      }
    }
    return out;
  }, [tours, which]);
}

/** f(gamesA, gamesB) for a stat from one player's side. */
const statFn = (stat, isA) => (stat === 'total' ? (a, b) => a + b : isA ? (a) => a : (a, b) => b);

export default function TennisProps() {
  const { tour, tours } = useData();
  const { openPlayer } = useUi();
  const [which, setWhich] = useState(tour);
  const [target, setTarget] = useState(0.75);
  const [limit, setLimit] = useState(12);
  const [size, setSize] = useState(3);
  const matches = useMatches(which);

  const picks = useMemo(() => {
    const out = [];
    for (const x of matches) {
      if (x.model.thin) continue;
      for (const [isA, me, opp] of [[true, x.m.a, x.m.b], [false, x.m.b, x.m.a]]) {
        const f = statFn('won', isA);
        const safe = safeOverLine(x.o, f, target);
        const mean = jointProb(x.o, f, 0).mean;
        if (safe && safe.line / mean >= 0.75) {
          const winP = isA ? x.model.p : 1 - x.model.p;
          out.push({ key: `${x.m.id}|${me.id}|won`, x, me, opp, stat: 'won', line: safe.line, prob: safe.p, mean, winP, score: safe.p * 0.6 + Math.min(1, safe.line / mean) * 0.4 });
        }
      }
      const tf = statFn('total');
      const st = safeOverLine(x.o, tf, target);
      const tm = jointProb(x.o, tf, 0).mean;
      if (st && st.line / tm >= 0.75) out.push({ key: `${x.m.id}|total`, x, me: null, opp: null, stat: 'total', line: st.line, prob: st.p, mean: tm, score: st.p * 0.6 + Math.min(1, st.line / tm) * 0.4 });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [matches, target]);

  // Safest slip: one pick per match.
  const legs = [];
  const used = new Set();
  for (const p of picks) { if (legs.length >= size) break; if (used.has(p.x.m.id)) continue; used.add(p.x.m.id); legs.push(p); }
  const combined = legs.reduce((a, p) => a * p.prob, 1);

  if (!tours?.atp) return <div className="page"><Card><SkeletonRows n={6} h={64} /></Card></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Player props</p>
          <h1>Tennis Props</h1>
          <p className="hero-sub">The model’s highest-chance More lines for games won and total games in every match over the next day and a half, a safest-slip builder, and every player’s projection. Type the line from your app to get More or Less with a chance.</p>
        </div>
        <Segmented options={[{ value: 'atp', label: 'ATP' }, { value: 'wta', label: 'WTA' }, { value: 'both', label: 'Both' }]} value={which} onChange={setWhich} label="Tour" />
      </div>

      {matches.length === 0 ? <Card><Empty title="No upcoming matches">Check back when the next day’s order of play is out.</Empty></Card> : (
        <>
          <section className="hc">
            <div className="pboard-head">
              <div>
                <h2 className="qc-title">Highest-chance props</h2>
                <p className="muted small">For every player, the highest games-won line (and each match’s total games) that still has a {Math.round(target * 100)}%+ model chance to go <strong>More</strong>, kept only when the line sits near the projection. Players with thin records are left out. If PrizePicks shows a line <strong>at or below</strong> one of these, it’s a high-chance More.</p>
              </div>
              <span className="pboard-count">{picks.length} <small>picks</small></span>
            </div>
            <div className="toolbar">
              <Segmented options={[{ value: 0.7, label: '70%+' }, { value: 0.75, label: '75%+' }, { value: 0.8, label: '80%+' }]} value={target} onChange={setTarget} label="Minimum chance" />
            </div>
            {picks.length === 0 ? <Empty title="No picks clear this bar">Try 70%+ or another tour.</Empty> : (
              <>
                <div className="hc-grid">
                  {picks.slice(0, limit).map((p, i) => (
                    <article key={p.key} className="hc-card">
                      <button type="button" className="hc-top" onClick={() => p.me && openPlayer(p.me.id)}>
                        <span className="hc-rank">{i + 1}</span>
                        {p.me ? <Face p={p.me} size={40} /> : <span className="tb-faces"><Face p={p.x.m.a} size={32} /><Face p={p.x.m.b} size={32} /></span>}
                        <span className="hc-name">
                          <strong>{p.me ? p.me.name : `${p.x.m.a.name.split(' ').slice(-1)[0]} vs ${p.x.m.b.name.split(' ').slice(-1)[0]}`}</strong>
                          <small>{p.me ? `vs ${p.opp.name} · ` : ''}{TOURS[p.x.tour]} · {when(p.x.m.date)}</small>
                        </span>
                      </button>
                      <div className="hc-line">
                        <span className="hc-side">MORE</span>
                        <strong>{p.line}</strong>
                        <span className="hc-stat">{STATS[p.stat]}</span>
                      </div>
                      <div className="hc-meter" title={`${pct(p.prob)} model chance`}><span style={{ width: `${p.prob * 100}%` }} /></div>
                      <div className="hc-foot">
                        <span><strong>{pct(p.prob)}</strong> chance</span>
                        {p.winP != null ? <span>Win <strong>{pct(p.winP)}</strong></span> : <span>Best of <strong>{p.x.o.bestOf}</strong></span>}
                        <span>Model <strong>{p.mean.toFixed(1)}</strong></span>
                      </div>
                    </article>
                  ))}
                </div>
                {picks.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + 12)}>Show more · {picks.length - limit} remaining</button>}
                {picks.length >= 2 && (
                  <div className="slip">
                    <div className="slip-head">
                      <div>
                        <h3 className="slip-title">Safest slip builder</h3>
                        <p className="muted small">Stacks the highest-chance picks above, one per match, so a single match can’t sink the whole entry</p>
                      </div>
                      <Segmented size="sm" options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} picks` }))} value={size} onChange={setSize} label="Slip size" />
                    </div>
                    <ol className="slip-legs">
                      {legs.map((p) => (
                        <li key={p.key}>
                          <span className="slip-player"><strong>{p.me ? p.me.name : `${p.x.m.a.name} vs ${p.x.m.b.name}`}</strong><small>{p.me ? `vs ${p.opp.name}` : TOURS[p.x.tour]}</small></span>
                          <span className="slip-pick over">More {p.line} {STATS[p.stat]}</span>
                          <span className="slip-prob">{pct(p.prob)}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="slip-total"><span>All {legs.length} hit (model estimate)</span><strong>{pct(combined)}</strong></div>
                    {legs.length < size && <p className="muted small">Only {legs.length} matches have a qualifying pick right now.</p>}
                    <p className="muted small slip-note">Each leg is a separate estimate. Real results vary, so play only what you can afford to lose.</p>
                  </div>
                )}
              </>
            )}
          </section>
          <AllPlayers matches={matches} />
        </>
      )}
      <p className="disclaimer">Model estimates for research and entertainment only. Games come from a game-by-game simulation of each player’s rating; the match-winner chance is calibrated on past results, the games numbers are estimates. Gridiron Edge is not affiliated with PrizePicks. Play responsibly: 18+/21+ where legal. Help: 1-800-GAMBLER.</p>
    </div>
  );
}

/** Every player in an upcoming match: projected games, and More/Less for any line you type. */
function AllPlayers({ matches }) {
  const { openPlayer } = useUi();
  const [q, setQ] = useState('');
  const [lines, setLines] = useState({});
  const [stat, setStat] = useState({});
  const [limit, setLimit] = useState(20);
  const rows = useMemo(() => {
    const out = [];
    for (const x of matches) {
      for (const [isA, me, opp] of [[true, x.m.a, x.m.b], [false, x.m.b, x.m.a]]) {
        out.push({ key: `${x.m.id}|${me.id}`, x, isA, me, opp, won: jointProb(x.o, statFn('won', isA), 0).mean, total: jointProb(x.o, statFn('total'), 0).mean, winP: isA ? x.model.p : 1 - x.model.p });
      }
    }
    return out.sort((a, b) => new Date(a.x.m.date) - new Date(b.x.m.date) || b.winP - a.winP);
  }, [matches]);
  const n = q.trim().toLowerCase();
  const shown = n ? rows.filter((r) => r.me.name.toLowerCase().includes(n) || r.opp.name.toLowerCase().includes(n)) : rows;
  return (
    <section className="pboard">
      <div className="pboard-head">
        <div>
          <h2 className="qc-title">All player props</h2>
          <p className="muted small">Every player with a match in the next day and a half. Type a line to get More or Less with a chance.</p>
        </div>
        <span className="pboard-count">{rows.length} <small>players</small></span>
      </div>
      <div className="toolbar">
        <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player" aria-label="Search players" /></div>
      </div>
      <div className="tp-list">
        {shown.slice(0, limit).map((r) => {
          const s = stat[r.key] || 'won';
          const line = Number(lines[r.key]);
          const has = lines[r.key] !== undefined && lines[r.key] !== '' && Number.isFinite(line);
          const pOver = has ? jointProb(r.x.o, statFn(s, r.isA), line).p : null;
          const pEq = has && Number.isInteger(line) ? (() => { const lo = jointProb(r.x.o, statFn(s, r.isA), line - 0.5).p; return lo - pOver; })() : 0;
          const pUnder = has ? 1 - pOver - pEq : null;
          const side = has ? (pOver >= pUnder ? 'over' : 'under') : null;
          return (
            <article key={r.key} className="tp-row">
              <button type="button" className="tp-who" onClick={() => openPlayer(r.me.id)}>
                <Face p={r.me} size={40} />
                <span><b>{r.me.name}</b><small>vs {r.opp.name} · {TOURS[r.x.tour]} · {when(r.x.m.date)}</small></span>
              </button>
              <div className="tp-proj">
                <span><small>Games won</small><b>{r.won.toFixed(1)}</b></span>
                <span><small>Total games</small><b>{r.total.toFixed(1)}</b></span>
                <span><small>Win</small><b>{pct(r.winP)}</b></span>
              </div>
              <div className="tp-check">
                <select value={s} onChange={(e) => setStat((x) => ({ ...x, [r.key]: e.target.value }))} aria-label="Stat">
                  <option value="won">Games Won</option>
                  <option value="total">Total Games</option>
                </select>
                <input inputMode="decimal" placeholder="Line" value={lines[r.key] ?? ''} onChange={(e) => setLines((x) => ({ ...x, [r.key]: e.target.value }))} aria-label="Line" />
                {has ? <span className={`tp-res ${side}`}><b>{side === 'over' ? 'MORE' : 'LESS'}</b> {pct(Math.max(pOver, pUnder))}</span> : <span className="tp-res muted">Type a line</span>}
              </div>
            </article>
          );
        })}
      </div>
      {shown.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + 20)}>Show more · {shown.length - limit} remaining</button>}
    </section>
  );
}
