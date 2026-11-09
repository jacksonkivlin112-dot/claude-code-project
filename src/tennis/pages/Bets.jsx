import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Card, Empty, Segmented, SkeletonRows } from '../../components/ui.jsx';
import { Face, matchHref } from '../components.jsx';
import { TOURS, matchModel } from '../data.jsx';
import { americanOdds, jointProb, safeOverLine } from '../model.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const last = (n) => n.split(' ').slice(-1)[0];
const when = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** Every bet the model can price for one match, from the favorite's point of view. */
function priceMatch(m, tour, d) {
  const model = matchModel(m, d);
  const o = model.outlook;
  const favA = model.p >= 0.5;
  const F = favA ? m.a : m.b;
  const D = favA ? m.b : m.a;
  const gF = favA ? (a) => a : (a, b) => b; // favorite's games
  const gD = favA ? (a, b) => b : (a) => a;
  const pF = favA ? model.p : 1 - model.p;
  const need = o.bestOf === 5 ? 3 : 2;
  const straightF = favA ? o.straightSetsA : o.straightSetsB;
  const top = o.setScores[0];
  const topTxt = top ? `${(favA ? top.a > top.b : top.b > top.a) ? last(F.name) : last(D.name)} ${Math.max(top.a, top.b)}-${Math.min(top.a, top.b)}` : '—';

  const total = jointProb(o, (a, b) => a + b, 0).mean;
  const totLine = Math.floor(total) + 0.5; // a typical book line sits near the projection
  const pOverTot = jointProb(o, (a, b) => a + b, totLine).p;
  const margin = jointProb(o, (a, b) => gF(a, b) - gD(a, b), 0).mean;
  const sprLine = Math.max(1.5, Math.round(margin - 0.5) + 0.5);
  const pSpr = jointProb(o, (a, b) => gF(a, b) - gD(a, b), sprLine).p;
  const pDogSpr = 1 - jointProb(o, (a, b) => gF(a, b) - gD(a, b), sprLine).p; // dog +line covers when margin < line
  const meanF = jointProb(o, gF, 0).mean;
  const meanD = jointProb(o, gD, 0).mean;
  const safeF = safeOverLine(o, gF, 0.75);
  const safeD = safeOverLine(o, gD, 0.75);
  const safeTot = safeOverLine(o, (a, b) => a + b, 0.75);

  const base = { m, tour, F, D, thin: model.thin, bestOf: o.bestOf };
  const bets = [
    { kind: 'ml', label: `${F.name} to win`, short: `${last(F.name)} ML`, p: pF, market: 'Moneyline' },
    { kind: 'sets', label: `${F.name} −1.5 sets`, short: `${last(F.name)} straight sets`, p: straightF, market: 'Set spread' },
    { kind: 'sets', label: `${D.name} +1.5 sets`, short: `${last(D.name)} wins a set`, p: 1 - straightF, market: 'Set spread' },
    { kind: 'spread', label: `${F.name} −${sprLine} games`, short: `${last(F.name)} −${sprLine} games`, p: pSpr, market: 'Game spread' },
    { kind: 'spread', label: `${D.name} +${sprLine} games`, short: `${last(D.name)} +${sprLine} games`, p: pDogSpr, market: 'Game spread' },
    { kind: 'total', label: `${pOverTot >= 0.5 ? 'Over' : 'Under'} ${totLine} total games`, short: `${pOverTot >= 0.5 ? 'O' : 'U'} ${totLine} games`, p: Math.max(pOverTot, 1 - pOverTot), market: 'Total games' },
    safeTot && { kind: 'prop', label: `More ${safeTot.line} total games`, short: `More ${safeTot.line} games`, p: safeTot.p, mean: total, line: safeTot.line, market: 'Total games (prop)' },
    safeF && { kind: 'prop', label: `${F.name} More ${safeF.line} games won`, short: `${last(F.name)} More ${safeF.line} games won`, p: safeF.p, mean: meanF, line: safeF.line, market: 'Games won (prop)' },
    safeD && { kind: 'prop', label: `${D.name} More ${safeD.line} games won`, short: `${last(D.name)} More ${safeD.line} games won`, p: safeD.p, mean: meanD, line: safeD.line, market: 'Games won (prop)' },
  ].filter(Boolean).map((b) => ({ ...base, ...b, key: `${m.id}|${b.label}` }));

  // A pick worth playing: likely, but not a -1000 price nobody would bet, and props near the projection.
  const playable = bets.filter((b) => b.p >= 0.6 && b.p <= 0.9 && (b.kind !== 'prop' || b.line / b.mean >= 0.75));
  const best = playable.sort((a, b) => score(b) - score(a))[0] || null;
  return {
    ...base, model, pF, straightF, topTxt, need, total, totLine, pOverTot, margin, sprLine, pSpr, meanF, meanD, safeF, safeD, safeTot, bets, best,
    goesDistance: o.goesDistance,
  };
}
// Chance first, then favor the markets people actually bet (sides over far-off props).
const score = (b) => b.p + (b.kind === 'ml' ? 0.04 : b.kind === 'prop' ? -0.1 : 0) - (b.thin ? 0.1 : 0);

function useBets(which) {
  const { tours } = useData();
  return useMemo(() => {
    const now = Date.now();
    const out = [];
    for (const t of which === 'both' ? ['atp', 'wta'] : [which]) {
      const d = tours?.[t];
      for (const m of d?.matches || []) {
        const ts = new Date(m.date).getTime();
        if (m.state !== 'pre' || ts - now > 36 * 3600e3 || ts < now - 3600e3 || !m.a?.name || !m.b?.name || /TBD/i.test(m.a.name + m.b.name)) continue;
        out.push(priceMatch(m, t, d));
      }
    }
    return out.sort((a, b) => new Date(a.m.date) - new Date(b.m.date));
  }, [tours, which]);
}

export default function TennisBets() {
  const { tour, tours } = useData();
  const [which, setWhich] = useState(tour);
  const [legs, setLegs] = useState(3);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(null);
  const matches = useBets(which);
  const best = matches.filter((x) => x.best && !x.thin).map((x) => x.best).sort((a, b) => score(b) - score(a));
  const parlay = best.slice(0, legs);
  const props = matches.filter((x) => !x.thin).flatMap((x) => x.bets.filter((b) => b.kind === 'prop' && b.line / b.mean >= 0.8)).sort((a, b) => b.p - a.p);
  const all = parlay.reduce((a, b) => a * b.p, 1);
  const copy = (list) => {
    const text = list.map((b) => `${b.label} (${pct(b.p)})`).join('\n') + (list.length > 1 ? `\nAll ${list.length} hit: ${pct(list.reduce((a, b) => a * b.p, 1))}` : '');
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  if (!tours?.atp) return <div className="page"><Card><SkeletonRows n={6} h={56} /></Card></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Tennis betting</p>
          <h1>Betting picks</h1>
          <p className="hero-sub">Moneylines, set and game spreads, total games and games-won props for every match in the next day and a half, priced by the same model as the match picks. Compare the fair odds with your book: a better price than fair is where the value is.</p>
        </div>
        <Segmented options={[{ value: 'atp', label: 'ATP' }, { value: 'wta', label: 'WTA' }, { value: 'both', label: 'Both' }]} value={which} onChange={setWhich} label="Tour" />
      </div>
      {matches.length === 0 ? <Card><Empty title="No upcoming matches">Check back when the next day’s order of play is out.</Empty></Card> : (
        <>
          {best.length > 0 && (
            <section className="tb-best">
              <div className="section-head"><h2>Best bets</h2><span className="muted small">top pick from each match</span></div>
              <div className="tb-best-list">
                {best.slice(0, 8).map((b) => (
                  <a key={b.key} className="tb-bet" href={matchHref(b.m, b.tour)}>
                    <Face p={b.kind === 'ml' || b.label.startsWith(b.F.name) ? b.F : b.label.startsWith(b.D.name) ? b.D : b.F} size={40} />
                    <span className="tb-bet-main">
                      <b>{b.label}</b>
                      <small>{b.market} · {last(b.F.name)} vs {last(b.D.name)} · {TOURS[b.tour]} · {when(b.m.date)}</small>
                    </span>
                    <span className="tb-bet-p"><b>{pct(b.p)}</b><small>fair {americanOdds(b.p)}</small></span>
                  </a>
                ))}
              </div>
            </section>
          )}
          {parlay.length >= 2 && (
            <div className="slip">
              <div className="slip-head">
                <div>
                  <h3 className="slip-title">Best-bets parlay</h3>
                  <p className="muted small">One bet per match, so the legs don’t depend on each other</p>
                </div>
                <Segmented size="sm" options={[2, 3, 4, 5].map((n) => ({ value: n, label: `${n} legs` }))} value={legs} onChange={setLegs} label="Legs" />
              </div>
              <ol className="slip-legs">
                {parlay.map((b) => (
                  <li key={b.key}>
                    <span className="slip-player"><strong>{b.label}</strong><small>{b.market} · {last(b.F.name)} vs {last(b.D.name)}</small></span>
                    <span className="slip-prob">{pct(b.p)}</span>
                  </li>
                ))}
              </ol>
              <div className="slip-total"><span>All {parlay.length} hit (model) · fair odds {americanOdds(all)}</span><strong>{pct(all)}</strong></div>
              <button type="button" className="btn-ghost" onClick={() => copy(parlay)}>{copied ? 'Copied ✓' : 'Copy picks'}</button>
            </div>
          )}
          {props.length > 0 && (
            <section className="tb-best">
              <div className="section-head"><h2>Props · More picks</h2><span className="muted small">PrizePicks-style, 75%+ lines near the projection</span></div>
              <div className="tb-best-list">
                {props.slice(0, 8).map((b) => {
                  const who = b.label.startsWith(b.F.name) ? b.F : b.label.startsWith(b.D.name) ? b.D : null;
                  return (
                    <a key={b.key} className="tb-bet" href={matchHref(b.m, b.tour)}>
                      {who ? <Face p={who} size={40} /> : <span className="tb-faces"><Face p={b.F} size={28} /></span>}
                      <span className="tb-bet-main">
                        <b>{who ? who.name : `${last(b.F.name)} vs ${last(b.D.name)}`}</b>
                        <small>↑ More {b.line} {b.market.startsWith('Games won') ? 'games won' : 'total games'} · proj {b.mean.toFixed(1)} · {when(b.m.date)}</small>
                      </span>
                      <span className="tb-bet-p"><b>{pct(b.p)}</b><small>{TOURS[b.tour]}</small></span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}
          <div className="section-head"><h2>Every match</h2><span className="muted small">{matches.length} matches · tap for all markets</span></div>
          <div className="tb-matches">
            {matches.map((x) => {
              const isOpen = open === x.m.id;
              return (
                <article key={x.m.id} className={`tb-match ${isOpen ? 'open' : ''}`}>
                  <button type="button" className="tb-match-head" onClick={() => setOpen(isOpen ? null : x.m.id)}>
                    <span className="tb-faces"><Face p={x.F} size={36} /><Face p={x.D} size={36} /></span>
                    <span className="tb-match-main">
                      <b>{last(x.F.name)} vs {last(x.D.name)}</b>
                      <small>{x.m.event} · {TOURS[x.tour]} · {when(x.m.date)}{x.thin ? ' · thin data' : ''}</small>
                    </span>
                    {x.best ? <span className="tb-chip">{x.best.short} · {pct(x.best.p)}</span> : <span className="tb-chip muted">No strong bet</span>}
                  </button>
                  {isOpen && (
                    <div className="tb-markets">
                      <Row k="Moneyline" v={`${x.F.name}`} p={x.pF} />
                      <Row k="Set betting" v={`Most likely: ${x.topTxt}`} sub={`Goes ${x.need === 3 ? '5' : '3'} sets: ${pct(x.goesDistance)}`} />
                      <Row k="Straight sets" v={`${last(x.F.name)} −1.5 sets`} p={x.straightF} />
                      <Row k="Wins a set" v={`${last(x.D.name)} +1.5 sets`} p={1 - x.straightF} />
                      <Row k="Game spread" v={`${last(x.F.name)} −${x.sprLine} games`} p={x.pSpr} sub={`Projected margin ${x.margin.toFixed(1)} games`} />
                      <Row k="Total games" v={`${x.pOverTot >= 0.5 ? 'Over' : 'Under'} ${x.totLine}`} p={Math.max(x.pOverTot, 1 - x.pOverTot)} sub={`Projected ${x.total.toFixed(1)} games`} />
                      {x.safeTot && <Row k="Total games prop" v={`More ${x.safeTot.line}`} p={x.safeTot.p} sub="Highest line that hits 75%+" />}
                      {x.safeF && <Row k={`${last(x.F.name)} games won`} v={`More ${x.safeF.line}`} p={x.safeF.p} sub={`Projected ${x.meanF.toFixed(1)}`} />}
                      {x.safeD && <Row k={`${last(x.D.name)} games won`} v={`More ${x.safeD.line}`} p={x.safeD.p} sub={`Projected ${x.meanD.toFixed(1)}`} />}
                      <div className="tb-actions">
                        <a className="btn-ghost" href={matchHref(x.m, x.tour)}>Match page →</a>
                        <button type="button" className="btn-ghost" onClick={() => copy(x.bets.filter((b) => b.p >= 0.6))}>{copied ? 'Copied ✓' : 'Copy bets'}</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
      <p className="disclaimer">Model estimates for research and entertainment only. Match-winner chances are calibrated on past results; set, game and total prices come from a game-by-game simulation of the same rating and are estimates. Fair odds have no bookmaker margin. Play responsibly: 18+/21+ where legal. Help: 1-800-GAMBLER.</p>
    </div>
  );
}

function Row({ k, v, p, sub }) {
  return (
    <div className="tb-row">
      <span className="tb-k">{k}</span>
      <span className="tb-v"><b>{v}</b>{sub && <small>{sub}</small>}</span>
      {p != null ? <span className={`tb-p ${p >= 0.65 ? 'good' : ''}`}><b>{pct(p)}</b><small>{americanOdds(p)}</small></span> : <span />}
    </div>
  );
}
