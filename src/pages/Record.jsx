import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { CFGS, OWN_HOOK, SPORT_LABEL } from '../dualSport.jsx';
import { backtestSafe, clearPicks, gradePicks, loadPicks, summarize } from '../tracker.js';
import { Card, Empty, Segmented, SkeletonRows, kickoff } from '../components/ui.jsx';
import { safeLine, usePickLogger, usePropLines } from './Props.jsx';

const pct = (p) => (p == null ? '—' : `${Math.round(p * 1000) / 10}%`);
const GRADE_LABEL = { strong: 'Strong', solid: 'Solid', lean: 'Lean' };

export default function Record() { return <RecordPage sport="nfl" />; }
export function NbaRecordRoute() { return <RecordPage sport="nba" />; }

function RecordPage({ sport }) {
  const cfg = CFGS[sport];
  const { ctx, rows } = OWN_HOOK[sport]();
  const P = usePropLines(sport);
  const { season, liveById, gameByTeam } = useData();
  const evaluated = useMemo(() => (ctx ? P.lines.map((l) => cfg.evaluate(l, ctx)).filter(Boolean) : null), [ctx, P.lines, cfg]);
  usePickLogger(cfg, ctx, rows, evaluated);

  const [range, setRange] = useState('all');
  const [ver, setVer] = useState(0);
  const list = useMemo(
    () => (season?.players?.size ? gradePicks(sport, { markets: cfg.markets, season, liveById, gameByTeam }) : loadPicks(sport)),
    [sport, season, liveById, gameByTeam, evaluated, ver], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sum = useMemo(() => summarize(list, { days: range === 'all' ? null : Number(range) }), [list, range]);
  const backtest = useMemo(() => (season?.players?.size ? [0.7, 0.75, 0.8].map((t) => backtestSafe(cfg, season.players, safeLine, t)) : null), [season, cfg]);
  const pending = list.filter((p) => !p.result);
  const recent = list.filter((p) => p.result && p.result !== 'void').sort((a, b) => new Date(b.gameTime) - new Date(a.gameTime)).slice(0, 40);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Accountability</p>
          <h1>{SPORT_LABEL[sport]} pick record</h1>
          <p className="hero-sub">
            Every pick the model makes is logged before the game starts and graded from the box score afterward, with no cherry-picking. Use this to see which grades and stats you can actually trust.
          </p>
        </div>
        <Segmented options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: 'all', label: 'All' }]} value={range} onChange={setRange} label="Time range" />
      </div>

      <div className="rec-tiles">
        <Tile title="PrizePicks line picks" sub="Strong, Solid & Lean picks on real lines" t={sum.lines} target={sum.breakeven} targetLabel={`${pct(sum.breakeven)} needed to profit`} />
        <Tile title="Highest-chance picks" sub="The model’s 75%+ floor lines" t={sum.safe} target={sum.safe.expected} targetLabel={sum.safe.expected != null ? `model expected ${pct(sum.safe.expected)}` : 'model expects 75%+'} />
        <div className="rec-tile">
          <span className="rec-tile-title">Waiting on games</span>
          <strong className="rec-big">{pending.length}</strong>
          <small className="muted">open picks logged · {list.length} logged in total</small>
        </div>
      </div>

      {sum.lines.n + sum.safe.n === 0 ? (
        <Card>
          <Empty title="No graded picks yet">
            The record fills in automatically. Picks are logged whenever you open Props or this page before games start, then graded once the box scores are in. {pending.length ? `${pending.length} picks are waiting on their games right now.` : 'Open Props before the next games to start logging.'}
          </Empty>
        </Card>
      ) : (
        <div className="rec-grid">
          <Card title="By confidence grade" subtitle="Does a higher grade really hit more often?">
            <table className="rec-table">
              <thead><tr><th>Grade</th><th>Record</th><th>Hit rate</th><th>Model said</th></tr></thead>
              <tbody>
                {sum.byGrade.map((g) => (
                  <tr key={g.key}><td><span className={`grade-chip ${g.key}`}>{GRADE_LABEL[g.key]}</span></td><td>{g.n ? `${g.hits}-${g.misses}` : '—'}</td><td className={g.rate == null ? '' : g.rate >= sum.breakeven ? 'pos-txt' : 'neg-txt'}>{pct(g.rate)}</td><td className="muted">{pct(g.expected)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Calibration" subtitle="When the model says X%, how often does it hit?">
            <div className="calib">
              {sum.calibration.map((b) => (
                <div key={b.lo} className="calib-row">
                  <span className="calib-lbl">{Math.round(b.lo * 100)}{b.hi > 1 ? '%+' : `–${Math.round(b.hi * 100)}%`}</span>
                  <span className="calib-bar"><span className="calib-exp" style={{ left: `${b.expected * 100}%` }} /><span className={`calib-fill ${b.rate >= b.expected - 0.03 ? 'ok' : 'low'}`} style={{ width: `${b.rate * 100}%` }} /></span>
                  <span className="calib-val">{pct(b.rate)} <small>({b.n})</small></span>
                </div>
              ))}
              <p className="muted small">Bar = actual hit rate · tick = what the model predicted. Bars at or past the tick mean the model is honest (or conservative) at that level.</p>
            </div>
          </Card>
          <Card title="By stat" subtitle="All logged picks">
            <table className="rec-table">
              <thead><tr><th>Stat</th><th>Record</th><th>Hit rate</th></tr></thead>
              <tbody>{sum.byStat.map((g) => <tr key={g.key}><td>{g.key}</td><td>{g.hits}-{g.misses}</td><td className={g.rate >= sum.breakeven ? 'pos-txt' : 'neg-txt'}>{pct(g.rate)}</td></tr>)}</tbody>
            </table>
            {sum.bySide.length > 0 && <p className="muted small rec-sides">{sum.bySide.map((g) => `${g.key === 'over' ? 'More' : 'Less'}: ${g.hits}-${g.misses} (${pct(g.rate)})`).join(' · ')}</p>}
          </Card>
        </div>
      )}

      <Card title="Backtest: highest-chance method on this season’s games" subtitle="A replay that uses only the games before each one. No future data leaks in.">
        {!backtest ? <SkeletonRows n={3} h={36} /> : backtest[0].n === 0 ? <p className="muted">Not enough game logs yet.</p> : (
          <>
            <div className="bt-row">
              {backtest.map((b) => (
                <div key={b.target} className="bt-cell">
                  <span className="rec-tile-title">{Math.round(b.target * 100)}% target</span>
                  <strong className={`rec-big ${b.rate >= b.target - 0.03 ? 'pos-txt' : 'neg-txt'}`}>{pct(b.rate)}</strong>
                  <small className="muted">{b.hits.toLocaleString()} of {b.n.toLocaleString()} hit</small>
                </div>
              ))}
            </div>
            <p className="muted small">
              Rebuilds each pick from form alone: recent and season averages, spread, the same floor-line rule and the same “cleared it in most recent games” filter, best stat per player. The live model adds matchup, injury and game-script inputs this replay can’t recreate, so treat this as a baseline. PrizePicks lines aren’t archived, so picks on real lines can only be judged by the live record above.
            </p>
            <div className="bt-stats">
              {backtest[1].byStat.map((s) => <span key={s.stat}>{s.stat} <b>{pct(s.hits / s.n)}</b> <small>({s.n})</small></span>)}
            </div>
          </>
        )}
      </Card>

      {recent.length > 0 && (
        <Card title="Latest graded picks" pad={false}>
          <ol className="rec-list">
            {recent.map((p) => (
              <li key={p.id} className={p.result}>
                <span className={`lf-oc ${p.result === 'hit' ? 'made' : p.result === 'push' ? 'to' : 'miss'}`}>{p.result === 'hit' ? '✓' : p.result === 'push' ? '–' : '✕'}</span>
                <span className="rec-main"><strong>{p.player}</strong><small>{p.side === 'over' ? 'More' : 'Less'} {p.line} {p.stat} · {p.kind === 'safe' ? 'Highest-chance' : GRADE_LABEL[p.grade]} · {Math.round(p.prob * 100)}%</small></span>
                <span className="rec-act"><b>{p.actual}</b><small>{kickoff(p.gameTime)}</small></span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <p className="disclaimer">
        The record is kept on this device, starting the first time you opened Props after this feature shipped. Picks that were never logged (because the app wasn’t opened before the game) aren’t counted.{' '}
        {confirm
          ? <><button type="button" className="link" onClick={() => { clearPicks(sport); setVer((x) => x + 1); setConfirm(false); }}>Yes, clear it</button> · <button type="button" className="link" onClick={() => setConfirm(false)}>Cancel</button></>
          : <button type="button" className="link" onClick={() => setConfirm(true)}>Reset record</button>}
      </p>
    </div>
  );
}

function Tile({ title, sub, t, target, targetLabel }) {
  const good = t.rate != null && target != null && t.rate >= target;
  return (
    <div className="rec-tile">
      <span className="rec-tile-title">{title}</span>
      <strong className={`rec-big ${t.rate == null ? '' : good ? 'pos-txt' : 'neg-txt'}`}>{t.n ? `${t.hits}-${t.misses}` : '0-0'}</strong>
      <small>{t.n ? `${pct(t.rate)} hit` : 'No results yet'} · <span className="muted">{targetLabel}</span></small>
      <small className="muted">{sub}</small>
    </div>
  );
}
