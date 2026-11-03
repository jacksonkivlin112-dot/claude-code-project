import { useData } from '../../data.jsx';
import { Card, SkeletonRows } from '../../components/ui.jsx';
import { TOURS } from '../data.jsx';

const pct = (p, d = 1) => (p == null ? '—' : `${(p * 100).toFixed(d)}%`);

export default function TennisRecord() {
  const { tours } = useData();
  if (!tours?.atp) return <div className="page"><Card><SkeletonRows n={6} h={44} /></Card></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Accountability</p>
          <h1>Tennis model record</h1>
          <p className="hero-sub">Every match this season was predicted using only results from before it. The correction that keeps the percentages honest was fit on the first two-thirds of the season, and everything below is from the last third, which the model never saw.</p>
        </div>
      </div>
      {['atp', 'wta'].map((t) => {
        const b = tours[t]?.backtest;
        if (!b) return null;
        return (
          <Card key={t} title={`${TOURS[t]} · ${b.n.toLocaleString()} matches`} subtitle={`Favorite won ${pct(b.accuracy)} · total games off by ${b.gamesMae?.toFixed(1)} on average`}>
            <div className="calib">
              {b.calibration.map((c) => (
                <div key={c.lo} className="calib-row">
                  <span className="calib-lbl">{Math.round(c.lo * 100)}{c.lo >= 0.9 ? '%+' : `–${Math.round(c.lo * 100) + 10}%`}</span>
                  <span className="calib-bar"><span className="calib-exp" style={{ left: `${c.expected * 100}%` }} /><span className={`calib-fill ${c.rate >= c.expected - 0.03 ? 'ok' : 'low'}`} style={{ width: `${c.rate * 100}%` }} /></span>
                  <span className="calib-val">{pct(c.rate, 0)} <small>({c.n})</small></span>
                </div>
              ))}
              <p className="muted small">Bar = how often the favorite actually won · tick = what the model said. Raw ratings were overconfident, so chances are pulled {Math.round((1 - b.shrink) * 100)}% toward 50/50; that cut prediction error (log loss) from {b.raw.logloss.toFixed(3)} to {b.logloss.toFixed(3)}.</p>
            </div>
          </Card>
        );
      })}
      <p className="disclaimer">Results include walkovers and retirements in the data but not in the ratings. Betting-market favorites win roughly 70% of tour matches, so treat this model as a solid baseline, not a guaranteed edge over the books.</p>
    </div>
  );
}
