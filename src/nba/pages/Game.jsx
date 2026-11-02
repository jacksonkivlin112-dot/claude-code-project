import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../data.jsx';
import { Avatar, Card, Empty, Segmented, SkeletonRows, TeamLogo, f1, kickoff, timeAgo, useNow, useUi } from '../../components/ui.jsx';
import { getNbaSummary } from '../api.js';
import { useNbaRows } from '../components.jsx';
import { parseNbaSummary } from '../gamecast.js';
import { buildFeed } from '../../liveFeed.js';
import LiveFeed from '../../components/LiveFeed.jsx';
import GameTabs from '../../components/GameTabs.jsx';
import GameProps from '../../components/GameProps.jsx';
import { FlatScore, GameSwitcher, useSwipeGames } from '../../components/GameHeader.jsx';

const LIVE_MS = 10000;
const IDLE_MS = 60000;
const lum = (hex = '#000000') => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const Q = (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const QNAME = (p) => (p <= 4 ? `${['1st', '2nd', '3rd', '4th'][p - 1]} Quarter` : p === 5 ? 'Overtime' : `${p - 4}OT`);

function useNbaGame(id) {
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const timer = useRef();
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    const schedule = (ms) => {
      clearTimeout(timer.current);
      if (ms) timer.current = setTimeout(() => (document.hidden ? schedule(ms) : tick()), ms);
    };
    const tick = async () => {
      try {
        const raw = await getNbaSummary(id);
        const g = parseNbaSummary(raw);
        g.feed = buildFeed(g, raw, 'nba');
        if (!alive) return;
        setGame(g);
        setError(null);
        setFetchedAt(Date.now());
        schedule(g.state === 'in' ? LIVE_MS : g.state === 'pre' ? IDLE_MS : 0);
      } catch (e) {
        if (!alive) return;
        setError(e.message || 'Request failed');
        schedule(IDLE_MS);
      }
    };
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => { alive = false; clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); };
  }, [id]);
  return { game, error, fetchedAt };
}

export default function NbaGame({ params }) {
  const id = params.get('id');
  const { board, teams } = useData();
  const { game, error, fetchedAt } = useNbaGame(id);
  const [tab, setTab] = useState('feed');
  const swipe = useSwipeGames(id, 'nba');
  useNow(5000);
  const fallback = board.games.find((g) => g.id === id);

  if (!id) return <div className="page"><Card><Empty title="No game selected">Pick a game from the score bar above.</Empty></Card></div>;
  if (!game) {
    return (
      <div className="page">
        <a className="back-link" href="#/nba/home">← Tonight</a>
        {error ? (
          <Card>
            <Empty title="Live play-by-play couldn’t load">
              The game feed didn’t respond ({error}). It will retry automatically. You can also follow along on{' '}
              <a className="link" href={`https://www.espn.com/nba/game/_/gameId/${id}`} target="_blank" rel="noreferrer">ESPN Gamecast</a>.
            </Empty>
            {fallback && <p className="center muted">{fallback.away.abbr} {fallback.away.score ?? ''} @ {fallback.home.abbr} {fallback.home.score ?? ''} · {fallback.detail}</p>}
          </Card>
        ) : <Card><SkeletonRows n={8} h={40} /></Card>}
      </div>
    );
  }

  const color = (t) => {
    const c = t.color || teams?.[t.abbr]?.color || '#475569';
    const a = t.alt || teams?.[t.abbr]?.alt;
    return lum(c) < 0.16 && a && lum(a) > lum(c) && lum(a) < 0.92 ? a : c;
  };

  return (
    <div className="page game-page" {...swipe}>
      <div className="game-dock">
        <GameSwitcher currentId={game.id} sport="nba" back="#/nba/home" />
        <FlatScore sport="nba" game={game} wp={game.winprob.length ? game.winprob[game.winprob.length - 1].home : null} />
        <GameTabs value={tab} onChange={setTab} tabs={[{ value: 'feed', label: 'Feed' }, { value: 'box', label: 'Box score' }, { value: 'props', label: 'Props' }, { value: 'stats', label: 'Stats' }, { value: 'fantasy', label: 'Fantasy' }]} />
      </div>

      {tab === 'feed' && <LiveFeed feed={game.feed} game={game} color={color} sport="nba" />}
      {tab === 'box' && <BoxScore game={game} />}
      {tab === 'props' && <GameProps game={game} sport="nba" />}
      {tab === 'stats' && (
        <div className="stats-stack">
          {game.winprob.length > 1 && <WinProbChart game={game} color={color} />}
          <TeamStats game={game} color={color} />
          <Card title="Game info">
            <dl className="ginfo">
              {game.venue && <><dt>Arena</dt><dd>{game.venue.name}{game.venue.city ? `, ${game.venue.city}` : ''}</dd></>}
              {game.tv && <><dt>TV</dt><dd>{game.tv}</dd></>}
              {game.line && <><dt>Line</dt><dd>{game.line.details} · O/U {game.line.overUnder}{game.line.provider ? ` (${game.line.provider})` : ''}</dd></>}
              {game.attendance ? <><dt>Attendance</dt><dd>{game.attendance.toLocaleString()}</dd></> : null}
            </dl>
            <a className="link small" href={`https://www.espn.com/nba/game/_/gameId/${game.id}`} target="_blank" rel="noreferrer">Open on ESPN →</a>
          </Card>
          <div className="section-head"><h2>Full play log</h2></div>
          <PlayByPlay game={game} color={color} />
        </div>
      )}
      {tab === 'fantasy' && <GameFantasy game={game} />}
    </div>
  );
}

function Scorebug({ game, color }) {
  const { openTeam } = useUi();
  const periods = Math.max(4, game.home.linescores.length, game.away.linescores.length);
  return (
    <section className="scorebug" style={{ '--away': color(game.away), '--home': color(game.home) }}>
      {[game.away, game.home].map((t, idx) => (
        <button type="button" key={t.abbr} className={`sb-team ${idx ? 'home' : 'away'} ${game.state === 'post' && !t.winner ? 'lost' : ''}`} onClick={() => openTeam(t.abbr)}>
          <TeamLogo abbr={t.abbr} size={64} />
          <span className="sb-name"><strong>{t.short || t.abbr}</strong><small>{t.record}</small></span>
          <span className="sb-score">{game.state === 'pre' ? '' : t.score}</span>
        </button>
      ))}
      <div className="sb-mid">
        <span className={`sb-status ${game.state}`}>
          {game.state === 'in' && <span className="live-dot" />}
          {game.state === 'pre' ? kickoff(game.date, { long: true }) : game.shortDetail}
        </span>
        {game.state !== 'pre' && (
          <table className="linescore">
            <thead><tr><th />{Array.from({ length: periods }, (_, i) => <th key={i}>{i < 4 ? i + 1 : Q(i + 1)}</th>)}<th>T</th></tr></thead>
            <tbody>
              {[game.away, game.home].map((t) => (
                <tr key={t.abbr}><td>{t.abbr}</td>{Array.from({ length: periods }, (_, i) => <td key={i}>{t.linescores[i] ?? '–'}</td>)}<td><strong>{t.score}</strong></td></tr>
              ))}
            </tbody>
          </table>
        )}
        {game.line && <span className="muted small">{game.line.details} · O/U {game.line.overUnder}</span>}
      </div>
    </section>
  );
}

function PlayByPlay({ game, color }) {
  const [filter, setFilter] = useState('ALL');
  const [period, setPeriod] = useState('ALL');
  const [limit, setLimit] = useState(60);
  const seen = useRef(new Set());
  const [fresh, setFresh] = useState(new Set());
  useEffect(() => {
    const ids = game.plays.map((p) => p.id);
    if (seen.current.size) {
      const n = new Set(ids.filter((x) => !seen.current.has(x)));
      if (n.size) { setFresh(n); setTimeout(() => setFresh(new Set()), 4000); }
    }
    seen.current = new Set(ids);
  }, [game]);
  const periods = [...new Set(game.plays.map((p) => p.period))];
  const keep = (p) => (period === 'ALL' || p.period === period) && (filter === 'ALL' || (filter === 'SCORE' && p.scoring) || (filter === 'BIG' && (p.scoreValue === 3 || /block|steal|dunk|turnover/i.test(p.type + p.text))));
  const all = [...game.plays].reverse().filter(keep);
  const list = all.slice(0, limit);
  if (!game.plays.length) return <Card><Empty title="No plays yet">Play-by-play starts at tip-off.</Empty></Card>;
  let last = null;
  return (
    <div className="pbp">
      <div className="pbp-tools">
        <Segmented size="sm" label="Play filter" value={filter} onChange={(v) => { setFilter(v); setLimit(60); }} options={[{ value: 'ALL', label: 'All plays' }, { value: 'SCORE', label: 'Scoring' }, { value: 'BIG', label: 'Threes & stops' }]} />
        <Segmented size="sm" label="Quarter" value={period} onChange={(v) => { setPeriod(v); setLimit(60); }} options={[{ value: 'ALL', label: 'All' }, ...periods.map((p) => ({ value: p, label: Q(p) }))]} />
      </div>
      <div className="drive" style={{ '--team': 'var(--accent)' }}>
        <ol className="plays">
          {list.map((p) => {
            const header = p.period !== last ? <li key={`h${p.period}`} className="pbp-period nba-q">{QNAME(p.period)}</li> : null;
            last = p.period;
            const tc = p.team ? color(p.team === game.home.abbr ? game.home : game.away) : 'transparent';
            return [header, (
              <li key={p.id} className={`play ${fresh.has(p.id) ? 'new' : ''} ${p.scoring ? 'score' : ''}`} style={{ boxShadow: `inset 3px 0 0 ${tc}` }}>
                <span className="play-when">{Q(p.period)} {p.clock}</span>
                <span className="play-body">
                  <span className="play-text">{p.team && <TeamLogo abbr={p.team} size={14} />} {p.text || p.type}</span>
                </span>
                <span className="play-tags">
                  {p.scoring && <span className="tag tone-great">+{p.scoreValue}</span>}
                  {p.scoring && <span className="yds pos">{game.away.abbr} {p.awayScore}–{p.homeScore} {game.home.abbr}</span>}
                </span>
              </li>
            )];
          })}
        </ol>
      </div>
      {all.length > limit && <button type="button" className="more-btn card" onClick={() => setLimit((l) => l + 80)}>Show earlier plays · {all.length - limit} more</button>}
    </div>
  );
}

function BoxScore({ game }) {
  const [team, setTeam] = useState(game.away.abbr);
  const t = game.players.find((x) => x.abbr === team);
  if (!t) return <Card><Empty title="Box score not available yet" /></Card>;
  const starters = t.athletes.filter((a) => a.starter);
  const bench = t.athletes.filter((a) => !a.starter);
  const Rows = ({ list }) => list.map((a) => (
    <tr key={a.id || a.name} className={`static ${a.dnp ? 'dnp' : ''}`}>
      <td><span className="cell-opp">{a.headshot && <img className="mini-head" src={a.headshot} alt="" loading="lazy" />}{a.short || a.name} <span className="muted small">{a.pos}</span></span></td>
      {a.dnp ? <td colSpan={t.labels.length} className="muted small">{a.reason || 'Did not play'}</td> : a.stats.map((s, i) => <td key={i} className="num">{s}</td>)}
    </tr>
  ));
  return (
    <div className="box">
      <Segmented size="sm" label="Team" value={team} onChange={setTeam} options={[game.away.abbr, game.home.abbr]} />
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Starters</th>{t.labels.map((l) => <th key={l} className="num">{l}</th>)}</tr></thead>
            <tbody>
              <Rows list={starters} />
              <tr className="static"><th>Bench</th>{t.labels.map((l) => <th key={l} />)}</tr>
              <Rows list={bench} />
              {t.totals?.length > 0 && <tr className="static totals"><td>Team</td>{t.totals.map((s, i) => <td key={i} className="num">{s}</td>)}</tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function GameFantasy({ game }) {
  const rows = useNbaRows();
  const { openPlayer } = useUi();
  const list = useMemo(
    () => (rows || []).filter((r) => r.team === game.home.abbr || r.team === game.away.abbr).sort((a, b) => (b.actual ?? -1) - (a.actual ?? -1) || b.proj - a.proj).slice(0, 16),
    [rows, game.home.abbr, game.away.abbr],
  );
  if (!rows) return <Card><SkeletonRows n={6} /></Card>;
  if (!list.length) return <Card><Empty title="No fantasy projections for this game" /></Card>;
  return (
    <Card title="Fantasy points in this game" subtitle="PrizePicks-style scoring · actual vs projection, updated live" pad={false}>
      <div className="fan-list">
        {list.map((r) => {
          const done = r.actual != null && r.proj ? Math.min(1.5, r.actual / r.proj) : 0;
          return (
            <button type="button" key={r.id} className="fan-row" onClick={() => openPlayer(r.id)}>
              <Avatar player={r} size={34} />
              <span className="fan-name"><strong>{r.name}</strong><small>{r.pos} · {r.team}</small></span>
              <span className="fan-bar"><span className={done >= 1 ? 'over' : ''} style={{ width: `${Math.min(100, done * 100)}%` }} /></span>
              <span className="fan-nums"><strong>{r.actual != null ? f1(r.actual) : '—'}</strong><small>proj {f1(r.proj)}</small></span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function WinProbChart({ game, color }) {
  const pts = game.winprob;
  const W = 320;
  const H = 120;
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (p) => H - p * H;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.home).toFixed(1)}`).join('');
  const last = pts[pts.length - 1].home;
  const qMarks = [];
  pts.forEach((p, i) => { if (i && p.period && pts[i - 1].period && p.period !== pts[i - 1].period) qMarks.push(i); });
  const leader = last >= 0.5 ? game.home : game.away;
  return (
    <Card title="Win probability" subtitle={`${leader.abbr} ${Math.round(Math.max(last, 1 - last) * 100)}%${game.state === 'in' ? ' · live' : ''}`}>
      <svg className="wp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Win probability over the game">
        <defs>
          <clipPath id="nwp-top"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="nwp-bot"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        <path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} fill={color(game.home)} opacity="0.35" clipPath="url(#nwp-top)" />
        <path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} fill={color(game.away)} opacity="0.35" clipPath="url(#nwp-bot)" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="wp-mid" />
        {qMarks.map((i) => <line key={i} x1={x(i)} x2={x(i)} y1="0" y2={H} className="wp-q" />)}
        <path d={line} className="wp-line" />
        <circle cx={x(pts.length - 1)} cy={y(last)} r="3.5" className="wp-dot" />
      </svg>
      <div className="wp-axis">
        <span><TeamLogo abbr={game.home.abbr} size={14} /> {game.home.abbr} {Math.round(last * 100)}%</span>
        <span>{Math.round((1 - last) * 100)}% {game.away.abbr} <TeamLogo abbr={game.away.abbr} size={14} /></span>
      </div>
    </Card>
  );
}

const KEY_STATS = ['fieldGoalPct', 'threePointFieldGoalPct', 'freeThrowPct', 'totalRebounds', 'assists', 'steals', 'blocks', 'turnovers', 'pointsInPaint', 'fastBreakPoints', 'largestLead'];

function TeamStats({ game, color }) {
  const a = game.teamStats.find((t) => t.abbr === game.away.abbr);
  const h = game.teamStats.find((t) => t.abbr === game.home.abbr);
  if (!a || !h) return null;
  const rows = KEY_STATS.map((k) => ({ k, a: a.stats.find((s) => s.key === k), h: h.stats.find((s) => s.key === k) })).filter((r) => r.a && r.h);
  return (
    <Card title="Team stats" subtitle={`${game.away.abbr} vs ${game.home.abbr}`}>
      <div className="tstats">
        {rows.map(({ k, a: av, h: hv }) => {
          const x = parseFloat(av.value) || 0;
          const y = parseFloat(hv.value) || 0;
          const lower = k === 'turnovers';
          const share = x + y ? x / (x + y) : 0.5;
          return (
            <div key={k} className="tstat">
              <div className="tstat-vals">
                <strong className={(lower ? x < y : x > y) ? 'win' : ''}>{av.value}{k.endsWith('Pct') ? '%' : ''}</strong>
                <span>{av.label}</span>
                <strong className={(lower ? y < x : y > x) ? 'win' : ''}>{hv.value}{k.endsWith('Pct') ? '%' : ''}</strong>
              </div>
              <div className="tstat-bar"><span style={{ width: `${share * 100}%`, background: color(game.away) }} /><span style={{ width: `${(1 - share) * 100}%`, background: color(game.home) }} /></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
