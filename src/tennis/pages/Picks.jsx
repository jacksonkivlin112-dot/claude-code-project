import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Card, Empty, Segmented, SkeletonRows } from '../../components/ui.jsx';
import { Face, matchHref } from '../components.jsx';
import { TOURS, etDay, matchModel } from '../data.jsx';
import { americanOdds } from '../model.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const last = (n) => n.split(' ').slice(-1)[0];

/** Upcoming matches in the next ~36h for the chosen tours, as model picks. */
function usePicks(which) {
  const { tours } = useData();
  return useMemo(() => {
    const now = Date.now();
    const out = [];
    for (const t of which === 'both' ? ['atp', 'wta'] : [which]) {
      const d = tours?.[t];
      for (const m of d?.matches || []) {
        if (m.state !== 'pre' || new Date(m.date).getTime() - now > 36 * 3600e3 || new Date(m.date).getTime() < now - 3600e3) continue;
        const model = matchModel(m, d);
        const favA = model.p >= 0.5;
        out.push({ m, tour: t, model, pick: favA ? m.a : m.b, opp: favA ? m.b : m.a, prob: favA ? model.p : 1 - model.p, thin: model.thin });
      }
    }
    return out.sort((a, b) => b.prob - a.prob);
  }, [tours, which]);
}

export default function TennisPicks() {
  const { tour, tours } = useData();
  const [which, setWhich] = useState(tour);
  const [legs, setLegs] = useState(3);
  const [copied, setCopied] = useState(false);
  const picks = usePicks(which);
  const solid = picks.filter((p) => !p.thin);
  const parlay = solid.slice(0, legs);
  const all = parlay.reduce((a, p) => a * p.prob, 1);
  const copy = () => {
    const text = parlay.map((p) => `${p.pick.name} to beat ${p.opp.name} (${pct(p.prob)})`).join('\n') + `\nAll ${parlay.length} win: ${pct(all)}`;
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  if (!tours?.atp) return <div className="page"><Card><SkeletonRows n={6} h={56} /></Card></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Tennis picks</p>
          <h1>Match winner picks</h1>
          <p className="hero-sub">Every match starting in the next day and a half, ranked by how likely the model’s pick is to win. Chances are calibrated on past results the model never saw, so a 75% pick has won about 3 in 4 times.</p>
        </div>
        <Segmented options={[{ value: 'atp', label: 'ATP' }, { value: 'wta', label: 'WTA' }, { value: 'both', label: 'Both' }]} value={which} onChange={setWhich} label="Tour" />
      </div>
      {picks.length === 0 ? <Card><Empty title="No upcoming matches">Check back when the next day’s order of play is out.</Empty></Card> : (
        <>
          {parlay.length >= 2 && (
            <div className="slip">
              <div className="slip-head">
                <div>
                  <h3 className="slip-title">Safest parlay</h3>
                  <p className="muted small">The most likely winners{which === 'both' ? ' across both tours' : ''}, skipping players with thin records</p>
                </div>
                <Segmented size="sm" options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} legs` }))} value={legs} onChange={setLegs} label="Legs" />
              </div>
              <ol className="slip-legs">
                {parlay.map((p) => (
                  <li key={p.m.id}>
                    <span className="slip-player"><strong>{p.pick.name}</strong><small>vs {p.opp.name} · {TOURS[p.tour]}</small></span>
                    <span className="slip-pick over">To win</span>
                    <span className="slip-prob">{pct(p.prob)}</span>
                  </li>
                ))}
              </ol>
              <div className="slip-total"><span>All {parlay.length} win (model) · fair odds {americanOdds(all)}</span><strong>{pct(all)}</strong></div>
              <button type="button" className="btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy picks'}</button>
            </div>
          )}
          <div className="section-head"><h2>All picks</h2><span className="muted small">{picks.length} matches</span></div>
          <div className="t-picks">
            {picks.map((p) => (
              <a key={p.m.id} className="t-pick" href={matchHref(p.m, p.tour)}>
                <Face p={p.pick} size={44} />
                <span className="t-pick-main">
                  <b>{p.pick.name}</b>
                  <small>over {p.opp.name} · {p.m.event} · {new Date(p.m.date).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>
                  <span className="t-pick-bar"><span style={{ width: `${p.prob * 100}%` }} /></span>
                </span>
                <span className="t-pick-prob"><b>{pct(p.prob)}</b><small>{americanOdds(p.prob)}{p.thin ? ' · thin data' : ''}</small></span>
              </a>
            ))}
          </div>
        </>
      )}
      <p className="disclaimer">Model estimates for research and entertainment only. Fair odds have no bookmaker margin, so a sportsbook price better than the fair price is where any value would be. Play responsibly: 18+/21+ where legal. Help: 1-800-GAMBLER.</p>
    </div>
  );
}
