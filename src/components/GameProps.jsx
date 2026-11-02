import { useMemo } from 'react';
import { CFGS, OWN_HOOK } from '../dualSport.jsx';
import { useData } from '../data.jsx';
import { buildSafePicks, usePickLogger, usePropLines } from '../pages/Props.jsx';
import { loadSlips } from '../slips.js';
import { legStatus } from '../tracker.js';
import { LegBar, SaveSlipButton } from './Tracking.jsx';
import { Avatar, Empty, SkeletonRows, useUi } from './ui.jsx';

const QLEN = { nfl: 15, nba: 12 };
const fmt = (v) => (v == null ? '–' : Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Share of regulation played, from the latest play's period and clock. */
function progress(game, sport) {
  if (game.state === 'post') return 1;
  if (game.state !== 'in') return 0;
  const last = game.feed?.items?.[0];
  if (!last?.period) return 0;
  const [m, s] = String(last.clock || '0:00').split(':').map(Number);
  const q = QLEN[sport];
  const left = (m || 0) + (s || 0) / 60;
  return Math.min(1, Math.max(0.02, ((Math.min(last.period, 4) - 1) * q + (q - left)) / (4 * q)));
}

/** Status of one pick from the live box score, with a simple pace projection. */
function liveSt(actual, line, side, game, frac) {
  if (game.state === 'pre' || actual == null) return { state: 'pending' };
  const over = actual > line;
  if (game.state === 'post') return { state: 'final', actual, hit: side === 'over' ? over : actual < line, push: actual === line };
  if (over) return { state: 'final', actual, hit: side === 'over' }; // already decided
  const proj = frac > 0.05 ? actual / frac : null;
  return { state: 'live', actual, proj, onPace: proj == null ? side === 'under' : side === 'over' ? proj > line : proj < line };
}

/** Props for this game: your saved legs, graded PrizePicks lines and the model's highest-chance lines, all live. */
export default function GameProps({ game, sport }) {
  const cfg = CFGS[sport];
  const { ctx, rows } = OWN_HOOK[sport]();
  const P = usePropLines(sport);
  const { gameByTeam } = useData();
  const teams = [game.away.abbr, game.home.abbr];
  const frac = progress(game, sport);

  const evaluated = useMemo(() => (ctx ? P.lines.map((l) => cfg.evaluate(l, ctx)).filter(Boolean) : null), [ctx, P.lines, cfg]);
  usePickLogger(cfg, ctx, rows, evaluated);
  const lines = useMemo(() => (evaluated || [])
    .filter((e) => teams.includes(e.team) && !e.unmatched && e.grade.key !== 'pass')
    .sort((a, b) => b.prob - a.prob), [evaluated]); // eslint-disable-line react-hooks/exhaustive-deps
  const safe = useMemo(() => (ctx && rows ? buildSafePicks(cfg, ctx, rows, 0.75, gameByTeam) : [])
    .filter((p) => teams.includes(p.team)), [ctx, rows, gameByTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = useMemo(() => {
    const t0 = new Date(game.date).getTime();
    return loadSlips().flatMap((s) => s.legs.map((l) => ({ ...l, slip: s.title })))
      .filter((l) => l.sport === sport && teams.includes(l.team) && (!l.gameTime || Math.abs(new Date(l.gameTime).getTime() - t0) < 12 * 3600e3));
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ctx) return <SkeletonRows n={6} h={64} />;
  const liveOf = (playerId, market) => {
    const r = ctx.liveById?.get(playerId);
    return r ? (cfg.markets[market].get(r.s) ?? 0) : game.state === 'pre' ? null : 0;
  };

  return (
    <div className="gp">
      {mine.length > 0 && (
        <section>
          <h3 className="gp-h">Your slips <small>{mine.length} leg{mine.length > 1 ? 's' : ''} in this game</small></h3>
          <ol className="gp-list">
            {mine.map((l, i) => {
              const s = l.result ? { state: 'final', ...l.result } : legStatus(l, { markets: cfg.markets, season: ctx.season, liveById: ctx.liveById, gameByTeam: ctx.gameByTeam });
              const st = s.state === 'live' ? liveSt(s.actual, l.line, l.side, game, frac) : s;
              return <Row key={i} sport={sport} p={{ ...l, sub: l.slip }} st={st} />;
            })}
          </ol>
        </section>
      )}

      <section>
        <h3 className="gp-h">PrizePicks lines <small>{lines.length ? 'model pick on each line' : ''}</small></h3>
        {lines.length === 0 ? (
          <p className="muted small gp-empty">{P.lines.length ? 'No graded lines for this game right now.' : 'No PrizePicks lines are loaded. Add a source on the Props page, or use the model lines below.'}</p>
        ) : (
          <ol className="gp-list">
            {lines.map((e) => (
              <Row key={e.id} sport={sport} p={{ playerId: e.playerId, player: e.player, team: e.team, side: e.side, line: e.line, stat: e.marketShort, prob: e.prob, grade: e.grade }} st={liveSt(e.result?.actual ?? liveOf(e.playerId, e.market), e.line, e.side, game, frac)} />
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="gp-h">Highest-chance lines <small>75%+ model floor lines</small></h3>
        {safe.length === 0 ? <Empty title="No picks clear 75% for this game">Players need a few games of history and no injury tag.</Empty> : (
          <>
            <ol className="gp-list">
              {safe.map((p) => <Row key={p.key} sport={sport} p={p} st={liveSt(p.actual ?? liveOf(p.playerId, p.market), p.line, 'over', game, frac)} />)}
            </ol>
            {game.state === 'pre' && safe.length >= 2 && (
              <div className="gp-save"><SaveSlipButton legs={safe.slice(0, 3)} title={`${game.away.abbr} @ ${game.home.abbr} · top ${Math.min(3, safe.length)}`} source="game" /></div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Row({ p, st, sport }) {
  const { openPlayer } = useUi();
  const name = p.player.split(' ');
  return (
    <li className={`gp-row ${st.state === 'final' ? (st.push ? 'push' : st.hit ? 'hit' : 'miss') : st.state}`}>
      <button type="button" className="gp-av" onClick={() => p.playerId && openPlayer(p.playerId)} aria-label={p.player}>
        <Avatar player={{ id: p.playerId, sport, team: p.team, first: name[0], last: name.slice(-1)[0] }} size={46} />
        {st.state === 'final' && <span className={`lf-oc ${st.push ? 'to' : st.hit ? 'made' : 'miss'}`}>{st.push ? '–' : st.hit ? '✓' : '✕'}</span>}
      </button>
      <span className="gp-main">
        <strong>{p.player}</strong>
        <span className={`gp-pick ${p.side}`}>{p.side === 'over' ? 'More' : 'Less'} {p.line} {p.stat}{p.prob != null && <small> · {Math.round(p.prob * 100)}%{p.grade ? ` ${p.grade.label || ''}` : ''}</small>}{p.sub && <small> · {p.sub}</small>}</span>
        <LegBar leg={p} st={st} />
      </span>
      <span className="gp-val">
        {st.state === 'pending' ? <small>Pregame</small> : (
          <>
            <b>{fmt(st.actual)}</b>
            <small>{st.state === 'final' ? (st.push ? 'push' : st.hit ? 'hit' : 'miss') : st.proj ? `pace ${fmt(Math.round(st.proj * 10) / 10)}` : 'live'}</small>
          </>
        )}
      </span>
    </li>
  );
}
