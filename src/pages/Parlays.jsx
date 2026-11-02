import { useMemo, useState } from 'react';
import { CFGS, OWN_HOOK, SPORT_LABEL, useDualSports } from '../dualSport.jsx';
import { americanOdds, hitDistribution } from '../slipMath.js';
import { Avatar, Card, Empty, Segmented, SkeletonRows, f1, kickoff } from '../components/ui.jsx';
import { buildSafePicks } from './Props.jsx';

const pct = (p, d = 1) => (p == null || Number.isNaN(p) ? '—' : `${(p * 100).toFixed(d)}%`);
const signed = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
const PROFILES = [
  { key: 'safest', label: 'Safest', note: 'Highest combined chance' },
  { key: 'balanced', label: 'Balanced', note: 'Consistency plus realistic lines' },
];

export default function Parlays() {
  const own = OWN_HOOK.nfl();
  return <ParlayPage home="nfl" own={own} />;
}

export function NbaParlays() {
  const own = OWN_HOOK.nba();
  return <ParlayPage home="nba" own={own} />;
}

/**
 * Greedy builder: best legs by the chosen metric, one per game, no player reused
 * across parlays. Mixed mode seeds one leg from each sport first.
 */
function buildParlays(pool, { legs, count, mixed, metric }) {
  const rank = (a, b) => (metric === 'safest' ? b.prob - a.prob || b.score - a.score : b.score - a.score || b.prob - a.prob);
  const sorted = [...pool].sort(rank);
  const usedPlayers = new Set();
  const parlays = [];
  for (let k = 0; k < count; k++) {
    const games = new Set();
    const chosen = [];
    const take = (p) => { chosen.push(p); games.add(p.game); usedPlayers.add(p.key); };
    const ok = (p) => !usedPlayers.has(p.key) && !games.has(p.game);
    if (mixed && legs >= 2) {
      for (const sport of ['nfl', 'nba']) {
        const p = sorted.find((x) => x.sport === sport && ok(x));
        if (p) take(p);
      }
    }
    for (const p of sorted) {
      if (chosen.length >= legs) break;
      if (ok(p)) take(p);
    }
    if (chosen.length < legs) break;
    const probs = chosen.map((p) => p.prob);
    parlays.push({ legs: chosen.sort(rank), probs, pAll: probs.reduce((a, b) => a * b, 1), dist: hitDistribution(probs) });
  }
  return parlays.sort((a, b) => b.pAll - a.pAll);
}

function ParlayPage({ home, own }) {
  const [sports, bridge] = useDualSports(home, own);
  const [mode, setMode] = useState('mixed');
  const [legs, setLegs] = useState(3);
  const [target, setTarget] = useState(0.75);
  const [metric, setMetric] = useState('safest');
  const [upcoming, setUpcoming] = useState(true);
  const [excluded, setExcluded] = useState(() => new Set());
  const [copied, setCopied] = useState(null);

  const picks = useMemo(() => {
    const out = {};
    for (const s of ['nfl', 'nba']) {
      const { ctx, rows } = sports[s];
      out[s] = ctx ? buildSafePicks(CFGS[s], ctx, rows, target, ctx.gameByTeam || {}) : null;
    }
    return out;
  }, [sports.nfl.ctx, sports.nba.ctx, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = { nfl: !!picks.nfl, nba: !!picks.nba };
  const usable = (s) => (picks[s] || []).filter((p) => (!upcoming || p.state === 'pre') && !excluded.has(p.key));
  const counts = { nfl: usable('nfl').length, nba: usable('nba').length };
  const pool = mode === 'mixed' ? [...usable('nfl'), ...usable('nba')] : usable(mode);
  const parlays = useMemo(
    () => buildParlays(pool, { legs, count: 5, mixed: mode === 'mixed' && counts.nfl > 0 && counts.nba > 0, metric }),
    [pool.length, legs, mode, metric, excluded, target, upcoming, picks], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const loading = mode === 'mixed' ? !ready.nfl || !ready.nba : !ready[mode];

  const swap = (p) => setExcluded((x) => new Set([...x, p.key]));
  const copy = async (pl, i) => {
    const text = pl.legs.map((p) => `${SPORT_LABEL[p.sport]} · ${p.player} · More ${p.line} ${p.statLabel} (${pct(p.prob, 0)})`).join('\n') + `\nAll hit: ${pct(pl.pAll)}`;
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1800); } catch { setCopied(-1); }
  };
  const analyze = (pl) => {
    try { localStorage.setItem('ge:scan:prefill', JSON.stringify(pl.legs.map((p) => ({ sport: p.sport, player: p.player, market: p.market, line: p.line, side: 'over' })))); } catch { /* ignore */ }
    window.location.hash = `/${home === 'nba' ? 'nba/' : ''}scan`;
  };

  return (
    <div className="page">
      {bridge}
      <div className="page-head">
        <div>
          <p className="eyebrow">Parlay builder</p>
          <h1>Highest-Chance Parlays</h1>
          <p className="hero-sub">
            Builds parlays from the most consistent picks in the NFL, NBA, or both. Each leg is a realistic line the player has cleared in most recent games with a {Math.round(target * 100)}%+ model chance, and every parlay uses one leg per game so one blowout can’t sink it.
          </p>
        </div>
        <span className="scan-ready">
          {['nfl', 'nba'].map((k) => <span key={k} className={ready[k] ? 'on' : ''}>{ready[k] ? `✓ ${SPORT_LABEL[k]} · ${counts[k]} picks` : `… ${SPORT_LABEL[k]} loading`}</span>)}
        </span>
      </div>

      <div className="pb-controls">
        <label><span>Sports</span><Segmented options={[{ value: 'mixed', label: 'NFL + NBA' }, { value: 'nfl', label: 'NFL' }, { value: 'nba', label: 'NBA' }]} value={mode} onChange={setMode} label="Sports" /></label>
        <label><span>Legs</span><Segmented options={[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} value={legs} onChange={setLegs} label="Number of legs" /></label>
        <label><span>Each leg</span><Segmented options={[{ value: 0.7, label: '70%+' }, { value: 0.75, label: '75%+' }, { value: 0.8, label: '80%+' }]} value={target} onChange={(v) => { setTarget(v); setExcluded(new Set()); }} label="Minimum chance per leg" /></label>
        <label><span>Build for</span><Segmented options={PROFILES.map((p) => ({ value: p.key, label: p.label }))} value={metric} onChange={setMetric} label="Build style" /></label>
        <label className="check"><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} /> Upcoming games only</label>
        {excluded.size > 0 && <button type="button" className="btn-ghost" onClick={() => setExcluded(new Set())}>Restore {excluded.size} swapped leg{excluded.size === 1 ? '' : 's'}</button>}
      </div>

      {loading ? (
        <Card><SkeletonRows n={5} h={70} /></Card>
      ) : parlays.length === 0 ? (
        <Card>
          <Empty title={`Not enough picks for a ${legs}-leg parlay`}>
            {mode !== 'nba' && counts.nfl === 0 && upcoming ? 'No NFL games left this week; next week’s picks appear once projections post. ' : ''}
            Try fewer legs, 70%+, a different sport, or untick “Upcoming games only”.
          </Empty>
        </Card>
      ) : (
        <div className="parlays">
          {parlays.map((pl, i) => (
            <article key={i} className={`parlay ${i === 0 ? 'top' : ''}`}>
              <header className="pl-head">
                <span className="pl-rank">#{i + 1}{i === 0 && <small>Best build</small>}</span>
                <div className="pl-odds">
                  <strong>{pct(pl.pAll)}</strong>
                  <small>all {pl.legs.length} hit · fair {americanOdds(pl.pAll)}</small>
                </div>
                <div className="pl-pay">
                  <span title="Below this multiplier the entry loses money on average">Profitable if it pays more than <b>{(1 / pl.pAll).toFixed(2)}x</b></span>
                  <span>{pl.legs.length}-leg chance: all {pct(pl.pAll, 0)} · {pl.legs.length - 1}+ of {pl.legs.length} {pct(pl.pAll + (pl.dist[pl.legs.length - 1] || 0), 0)}</span>
                </div>
              </header>
              <div className="pl-meter" title="Chance of each number of hits">
                {pl.dist.map((p, k) => <span key={k} style={{ flex: Math.max(p, 0.02) }} className={k === pl.legs.length ? 'all' : k === pl.legs.length - 1 ? 'one' : ''} title={`${k}/${pl.legs.length}: ${pct(p)}`} />)}
              </div>
              <ol className="pl-legs">
                {pl.legs.map((p) => (
                  <li key={p.key}>
                    <Avatar player={{ id: p.playerId, sport: p.sport, pos: p.pos, team: p.team, first: p.first, last: p.last }} size={38} />
                    <span className="pl-who">
                      <strong>{p.player}<span className={`sport-tag ${p.sport}`}>{SPORT_LABEL[p.sport]}</span></strong>
                      <small>{p.pos} · {p.team} vs {p.opp}{p.date && p.state === 'pre' ? ` · ${kickoff(p.date)}` : p.state === 'in' ? ' · Live' : p.state === 'post' ? ' · Final' : ''}</small>
                    </span>
                    <span className="pl-pick">More {p.line} <small>{p.statLabel}</small></span>
                    <span className="pl-stats">
                      <strong>{pct(p.prob, 0)}</strong>
                      <small>hit {p.hits}/{p.n} · proj {f1(p.mean)}</small>
                    </span>
                    <button type="button" className="pl-swap" onClick={() => swap(p)} title="Swap this leg for the next-best pick">⇄</button>
                  </li>
                ))}
              </ol>
              <footer className="pl-foot">
                <button type="button" className="btn" onClick={() => analyze(pl)}>Full analysis in Slip Scan →</button>
                <button type="button" className="btn-ghost" onClick={() => copy(pl, i)}>{copied === i ? 'Copied ✓' : 'Copy picks'}</button>
              </footer>
            </article>
          ))}
        </div>
      )}

      <p className="disclaimer">
        Legs use the model’s highest-chance line for each player. On PrizePicks, pick a line at or below each number. Lower “Goblin” lines often qualify but pay less than standard Power multipliers, so compare the PrizePicks payout to each parlay’s “profitable if it pays more than” number. Chances are model estimates and legs are treated as independent. Play responsibly: 18+/21+ where legal. Help: 1-800-GAMBLER.
      </p>
    </div>
  );
}
