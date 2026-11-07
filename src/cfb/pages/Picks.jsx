import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Card, Empty, Segmented, SkeletonRows, TeamLogo, kickoff } from '../../components/ui.jsx';

const pct = (p, d = 0) => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);
const american = (p) => (p <= 0 || p >= 1 ? '—' : p >= 0.5 ? `-${Math.round((p / (1 - p)) * 100)}` : `+${Math.round(((1 - p) / p) * 100)}`);
const r1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1));

export default function CfbPicks() {
  const { api, board } = useData();
  const [snap, setSnap] = useState(null);
  const [legs, setLegs] = useState(3);
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.getSnapshot().then(setSnap).catch(() => setSnap(false)); }, [api]);

  const live = useMemo(() => Object.fromEntries((board.games || []).map((g) => [g.id, g])), [board]);
  const picks = useMemo(() => (snap?.picks || []).map((p) => {
    const g = live[p.id];
    const homeFav = p.homeWin >= 0.5;
    return { ...p, g, state: g?.state || 'pre', pick: homeFav ? p.home : p.away, opp: homeFav ? p.away : p.home, prob: homeFav ? p.homeWin : 1 - p.homeWin };
  }), [snap, live]);
  if (snap === null) return <div className="page"><Card><SkeletonRows n={8} h={48} /></Card></div>;
  if (!snap) return <div className="page"><Card><Empty title="College data unavailable">Try again in a minute.</Empty></Card></div>;

  const open = picks.filter((p) => p.state === 'pre' && !p.thin).sort((a, b) => b.prob - a.prob);
  const parlay = open.slice(0, legs);
  const all = parlay.reduce((a, p) => a * p.prob, 1);
  const bt = snap.backtest;
  const teams = snap.teams;
  const name = (a) => teams[a]?.short || a;
  const copy = () => {
    const text = parlay.map((p) => `${name(p.pick)} to beat ${name(p.opp)} (${pct(p.prob)})`).join('\n') + `\nAll ${parlay.length} win: ${pct(all)}`;
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Week {snap.week} · College football</p>
          <h1>Game Picks</h1>
          <p className="hero-sub">Team ratings built from every FBS score this season, warmed up with last season and tested only on games they hadn’t seen. They give each team’s win chance and a projected score, compared with the DraftKings spread and total.</p>
        </div>
      </div>

      <div className="rec-tiles">
        <div className="rec-tile"><span className="rec-tile-title">Picking winners</span><strong className="rec-big pos-txt">{pct(bt.accuracy, 1)}</strong><small className="muted">of {bt.n} games this season (Vegas favorites win about 75%)</small></div>
        <div className="rec-tile"><span className="rec-tile-title">Against the spread</span><strong className={`rec-big ${bt.ats.rate >= 0.5238 ? 'pos-txt' : 'neg-txt'}`}>{pct(bt.ats.rate, 1)}</strong><small className="muted">of {bt.ats.n} games with a 3+ point disagreement. Below the 52.4% needed, so no spread picks</small></div>
        <div className="rec-tile"><span className="rec-tile-title">Totals</span><strong className={`rec-big ${bt.ou.rate >= 0.5238 ? 'pos-txt' : 'neg-txt'}`}>{pct(bt.ou.rate, 1)}</strong><small className="muted">of {bt.ou.n} games. No proven edge on overs/unders either</small></div>
      </div>

      {parlay.length >= 2 && (
        <div className="slip">
          <div className="slip-head">
            <div>
              <h3 className="slip-title">Safest winners parlay</h3>
              <p className="muted small">The most likely winners this week, one per game. Win chances are calibrated, so 80% picks have won about 4 in 5</p>
            </div>
            <Segmented size="sm" options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: `${n} legs` }))} value={legs} onChange={setLegs} label="Legs" />
          </div>
          <ol className="slip-legs">
            {parlay.map((p) => (
              <li key={p.id}>
                <span className="slip-player"><strong><TeamLogo abbr={p.pick} size={18} /> {teams[p.pick]?.name || p.pick}</strong><small>vs {name(p.opp)} · {kickoff(p.date)}</small></span>
                <span className="slip-pick over">To win</span>
                <span className="slip-prob">{pct(p.prob)}</span>
              </li>
            ))}
          </ol>
          <div className="slip-total"><span>All {parlay.length} win (model) · fair odds {american(all)}</span><strong>{pct(all)}</strong></div>
          <button type="button" className="btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy picks'}</button>
        </div>
      )}

      <div className="section-head"><h2>Every game</h2><span className="muted small">{picks.length} games · week {snap.week}</span></div>
      {picks.length === 0 ? <Card><Empty title="No games left this week">Picks for next week appear once the schedule posts.</Empty></Card> : (
        <div className="cfbp-list">
          {[...picks].sort((a, b) => (a.state === 'post') - (b.state === 'post') || new Date(a.date) - new Date(b.date)).map((p) => {
            const homeLine = p.line?.spread != null ? -p.line.spread : null;
            const lean = homeLine != null ? p.predMargin - homeLine : null;
            const rk = (side) => { const r = p.g?.rank?.[side]; return r && r <= 25 ? <small className="cfbp-rank">{r}</small> : null; };
            return (
              <a key={p.id} className={`cfbp-row ${p.state}`} href={`#/cfb/game?id=${p.id}`}>
                <span className="cfbp-teams">
                  {[['away', p.away, 1 - p.homeWin, p.predAway], ['home', p.home, p.homeWin, p.predHome]].map(([side, a, w, pts]) => (
                    <span key={side} className={`cfbp-team ${w >= 0.5 ? 'fav' : ''}`}>
                      <TeamLogo abbr={a} size={26} />
                      <b>{rk(side)}{name(a)}</b>
                      {p.state === 'pre' ? <span className="cfbp-proj">{r1(pts)}</span> : <span className="cfbp-proj">{p.g?.[side]?.score ?? ''}</span>}
                      <span className="cfbp-win">{pct(w)}</span>
                    </span>
                  ))}
                </span>
                <span className="cfbp-meta">
                  <span>{p.state === 'in' ? <b className="t-live"><span className="live-dot" /> {p.g.detail}</b> : p.state === 'post' ? <b>Final</b> : kickoff(p.date)}</span>
                  {p.line?.details && <span>DK {p.line.details}{p.line.overUnder ? ` · O/U ${p.line.overUnder}` : ''}</span>}
                  {lean != null && Math.abs(lean) >= 3 && p.state === 'pre' && <span className="muted">Model {p.predMargin >= 0 ? name(p.home) : name(p.away)} by {r1(Math.abs(p.predMargin))} (info only)</span>}
                  {p.thin && <span className="muted">thin data</span>}
                </span>
              </a>
            );
          })}
        </div>
      )}
      <p className="disclaimer">Model estimates for research and entertainment only. Spread and total leans are shown for information: they haven’t beaten the line this season. Play responsibly: 18+/21+ where legal. Help: 1-800-GAMBLER.</p>
    </div>
  );
}
