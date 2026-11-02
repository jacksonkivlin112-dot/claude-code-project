import { useEffect, useMemo, useRef, useState } from 'react';
import { getGameSummary } from '../api.js';
import { useData } from '../data.jsx';
import { parseSummary } from '../gamecast.js';
import { buildFeed } from '../liveFeed.js';
import LiveFeed from '../components/LiveFeed.jsx';
import { useProjectionRows } from '../components/players.jsx';
import { Avatar, Card, Empty, Segmented, SkeletonRows, TeamLogo, f1, kickoff, timeAgo, useNow, useUi } from '../components/ui.jsx';

const LIVE_MS = 12000;
const lum = (hex = '#000000') => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
};
const IDLE_MS = 60000;

function useGame(id) {
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const timer = useRef();

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setGame(null);
    setError(null);
    const tick = async () => {
      try {
        const raw = await getGameSummary(id);
        const g = parseSummary(raw);
        g.feed = buildFeed(g, raw, 'nfl');
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
    const schedule = (ms) => {
      clearTimeout(timer.current);
      if (ms) timer.current = setTimeout(() => (document.hidden ? schedule(ms) : tick()), ms);
    };
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => {
      alive = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id]);
  return { game, error, fetchedAt };
}

export default function Game({ params }) {
  const id = params.get('id');
  const { board, teams } = useData();
  const { game, error, fetchedAt } = useGame(id);
  const [tab, setTab] = useState('feed');
  useNow(5000);
  const fallback = board.games.find((g) => g.id === id);

  if (!id) return <div className="page"><Card><Empty title="No game selected">Pick a game from the score bar above.</Empty></Card></div>;

  if (!game) {
    return (
      <div className="page">
        <a className="back-link" href="#/home">← This Week</a>
        {error ? (
          <Card>
            <Empty title="Live play-by-play couldn’t load">
              The game feed didn’t respond ({error}). It will retry automatically. You can also follow along on{' '}
              <a className="link" href={`https://www.espn.com/nfl/game/_/gameId/${id}`} target="_blank" rel="noreferrer">ESPN Gamecast</a>.
            </Empty>
            {fallback && <p className="center muted">{fallback.away.abbr} {fallback.away.score ?? ''} @ {fallback.home.abbr} {fallback.home.score ?? ''} · {fallback.detail}</p>}
          </Card>
        ) : (
          <Card><SkeletonRows n={8} h={40} /></Card>
        )}
      </div>
    );
  }

  // Very dark team colors (e.g., navy) vanish on the dark theme: use the alternate color instead.
  const color = (t) => {
    const c = t.color || teams?.[t.abbr]?.color || '#475569';
    const a = t.alt || teams?.[t.abbr]?.alt;
    return lum(c) < 0.16 && a && lum(a) > lum(c) && lum(a) < 0.92 ? a : c;
  };
  return (
    <div className="page game-page">
      <div className="game-topline">
        <a className="back-link" href="#/home">← This Week</a>
        <span className="muted small">
          {game.state === 'in' ? <><span className="live-dot" /> Live · updates every {LIVE_MS / 1000}s</> : game.state === 'post' ? 'Final' : 'Pregame'}
          {fetchedAt && ` · refreshed ${timeAgo(fetchedAt)}`}
          {error && ' · reconnecting…'}
        </span>
      </div>

      <Scorebug game={game} color={color} />
      {game.state !== 'pre' && <Field game={game} color={color} />}

      <div className="game-grid">
        <div className="game-main">
          <Segmented
            label="Game view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'feed', label: 'Live feed' },
              { value: 'plays', label: 'Drives' },
              { value: 'scoring', label: 'Scoring' },
              { value: 'box', label: 'Box score' },
              { value: 'fantasy', label: 'Fantasy' },
            ]}
          />
          {tab === 'feed' && <LiveFeed feed={game.feed} game={game} color={color} sport="nfl" />}
          {tab === 'plays' && <PlayByPlay game={game} color={color} />}
          {tab === 'scoring' && <Scoring game={game} />}
          {tab === 'box' && <BoxScore game={game} />}
          {tab === 'fantasy' && <GameFantasy game={game} />}
        </div>
        <aside className="game-side">
          {game.winprob.length > 1 && <WinProbChart game={game} color={color} />}
          <TeamStats game={game} color={color} />
          <GameInfo game={game} />
        </aside>
      </div>
    </div>
  );
}

function Scorebug({ game, color }) {
  const { openTeam } = useUi();
  const periods = Math.max(4, game.home.linescores.length, game.away.linescores.length);
  const label = (i) => (i < 4 ? i + 1 : i === 4 ? 'OT' : `${i - 3}OT`);
  return (
    <section className="scorebug" style={{ '--away': color(game.away), '--home': color(game.home) }}>
      {[game.away, game.home].map((t, idx) => (
        <button type="button" key={t.abbr} className={`sb-team ${idx ? 'home' : 'away'} ${game.state === 'post' && !t.winner ? 'lost' : ''}`} onClick={() => openTeam(t.abbr)}>
          <TeamLogo abbr={t.abbr} size={64} />
          <span className="sb-name">
            <strong>{t.short || t.abbr}</strong>
            <small>{t.record}{t.timeouts != null && game.state === 'in' ? ` · ${t.timeouts} TO` : ''}</small>
          </span>
          <span className="sb-score">
            {game.state === 'pre' ? '' : t.score}
            {game.state === 'in' && game.lastPlay?.end?.team === t.abbr && <span className="sb-poss" title="Possession" />}
          </span>
        </button>
      ))}
      <div className="sb-mid">
        <span className={`sb-status ${game.state}`}>
          {game.state === 'in' && <span className="live-dot" />}
          {game.state === 'pre' ? kickoff(game.date, { long: true }) : game.shortDetail}
        </span>
        {game.state !== 'pre' && (
          <table className="linescore">
            <thead><tr><th />{Array.from({ length: periods }, (_, i) => <th key={i}>{label(i)}</th>)}<th>T</th></tr></thead>
            <tbody>
              {[game.away, game.home].map((t) => (
                <tr key={t.abbr}>
                  <td>{t.abbr}</td>
                  {Array.from({ length: periods }, (_, i) => <td key={i}>{t.linescores[i] ?? '–'}</td>)}
                  <td><strong>{t.score}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {game.line && <span className="muted small">{game.line.details} · O/U {game.line.overUnder}</span>}
      </div>
    </section>
  );
}

/** Field graphic: away end zone on the left, home on the right. */
function Field({ game, color }) {
  const lp = game.lastPlay;
  const sit = lp?.end?.yardsToEndzone != null && lp.end.team ? lp.end : lp?.start;
  if (!sit || sit.yardsToEndzone == null || !sit.team) return null;
  const offenseHome = sit.team === game.home.abbr;
  // x in yards from the away goal line (0) to the home goal line (100).
  const ball = offenseHome ? sit.yardsToEndzone : 100 - sit.yardsToEndzone;
  const toGo = sit.distance || 0;
  const first = offenseHome ? Math.max(0, ball - toGo) : Math.min(100, ball + toGo);
  const pct = (yd) => `${8.333 + (yd / 100) * 83.333}%`;
  const redZone = sit.yardsToEndzone <= 20;
  const drive = game.drives[game.drives.length - 1];
  const driveStart = drive?.plays?.[0]?.start;
  const startX = driveStart?.yardsToEndzone != null ? (offenseHome ? driveStart.yardsToEndzone : 100 - driveStart.yardsToEndzone) : null;
  const live = game.state === 'in';
  return (
    <section className={`field-wrap ${redZone && live ? 'rz' : ''}`}>
      <div className="field-head">
        <span>
          {live ? (
            <>
              <TeamLogo abbr={sit.team} size={18} /> <strong>{sit.team} ball</strong> · {sit.downDistanceText || sit.possessionText}
              {redZone && <span className="tag tone-worst">Red zone</span>}
            </>
          ) : (
            <strong>Final drive: {drive?.team} · {drive?.result}</strong>
          )}
        </span>
        {drive && <span className="muted small">{drive.isCurrent ? 'Current drive' : 'Drive'}: {drive.description}</span>}
      </div>
      <div className="field" style={{ '--away': color(game.away), '--home': color(game.home) }}>
        <div className="ez away"><span>{game.away.abbr}</span></div>
        <div className="ez home"><span>{game.home.abbr}</span></div>
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
          <div key={y} className="yard" style={{ left: pct(y) }}><span>{y > 50 ? 100 - y : y}</span></div>
        ))}
        {startX != null && live && (
          <div className="drive-trail" style={{ left: pct(Math.min(startX, ball)), width: `${(Math.abs(ball - startX) / 100) * 83.333}%`, background: color({ abbr: sit.team, color: sit.team === game.home.abbr ? game.home.color : game.away.color }) }} />
        )}
        {live && toGo > 0 && <div className="los first" style={{ left: pct(first) }} title={`First down: ${toGo} to go`} />}
        <div className="los" style={{ left: pct(ball) }} />
        <div className={`ball ${offenseHome ? 'to-left' : 'to-right'}`} style={{ left: pct(ball) }} title={sit.possessionText} />
      </div>
      {lp && <p className="last-play"><span className="muted">Last play ({lp.clock} Q{lp.period}):</span> {lp.text}</p>}
    </section>
  );
}

const ORDINAL_Q = (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);

function PlayByPlay({ game, color }) {
  const drives = [...game.drives].reverse();
  const [open, setOpen] = useState(() => new Set(drives.slice(0, 2).map((d) => d.id)));
  const seen = useRef(new Set());
  const [fresh, setFresh] = useState(new Set());
  const [filter, setFilter] = useState('ALL');

  // Flash plays that arrived since the last refresh.
  useEffect(() => {
    const ids = game.drives.flatMap((d) => d.plays.map((p) => p.id));
    if (seen.current.size) {
      const n = new Set(ids.filter((x) => !seen.current.has(x)));
      if (n.size) {
        setFresh(n);
        const latest = game.drives[game.drives.length - 1];
        if (latest) setOpen((o) => new Set([...o, latest.id]));
        setTimeout(() => setFresh(new Set()), 4000);
      }
    }
    seen.current = new Set(ids);
  }, [game]);

  if (!drives.length) return <Card><Empty title="No plays yet">Play-by-play starts at kickoff.</Empty></Card>;
  const keep = (p) => filter === 'ALL' || (filter === 'BIG' && (p.scoring || p.turnover || (p.yards ?? 0) >= 20)) || (filter === 'SCORE' && p.scoring);
  let lastPeriod = null;
  return (
    <div className="pbp">
      <div className="pbp-tools">
        <Segmented size="sm" label="Play filter" value={filter} onChange={setFilter} options={[{ value: 'ALL', label: 'All plays' }, { value: 'BIG', label: 'Big plays' }, { value: 'SCORE', label: 'Scores' }]} />
        <button type="button" className="btn-ghost" onClick={() => setOpen(open.size ? new Set() : new Set(drives.map((d) => d.id)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
      </div>
      {drives.map((d) => {
        const plays = [...d.plays].reverse().filter(keep);
        if (filter !== 'ALL' && !plays.length) return null;
        const isOpen = open.has(d.id) || filter !== 'ALL';
        const header = d.startPeriod !== lastPeriod ? d.startPeriod : null;
        lastPeriod = d.startPeriod;
        const teamColor = d.team === game.home.abbr ? color(game.home) : color(game.away);
        return (
          <div key={d.id}>
            {header && <div className="pbp-period">{header <= 4 ? `${['1st', '2nd', '3rd', '4th'][header - 1]} Quarter` : 'Overtime'}</div>}
            <article className={`drive ${d.isCurrent ? 'current' : ''} ${d.isScore ? 'scored' : ''}`} style={{ '--team': teamColor }}>
              <button type="button" className="drive-head" onClick={() => setOpen((o) => { const n = new Set(o); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} aria-expanded={isOpen}>
                <TeamLogo abbr={d.team} size={26} />
                <span className="drive-title">
                  <strong>{d.result || '—'}{d.isCurrent && <span className="live-chip"><span className="live-dot" /> Live</span>}</strong>
                  <small>{d.description}{d.start ? ` · started at ${d.start}` : ''}</small>
                </span>
                <span className="drive-score muted">{d.plays.length ? `${game.away.abbr} ${d.plays[d.plays.length - 1].awayScore} – ${d.plays[d.plays.length - 1].homeScore} ${game.home.abbr}` : ''}</span>
                <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {isOpen && (
                <ol className="plays">
                  {plays.map((p) => (
                    <li key={p.id} className={`play ${fresh.has(p.id) ? 'new' : ''} ${p.scoring ? 'score' : ''} ${p.turnover ? 'turnover' : ''}`}>
                      <span className="play-when">{ORDINAL_Q(p.period)} {p.clock}</span>
                      <span className="play-body">
                        {p.start?.shortDownDistanceText && p.start.down > 0 && <span className="play-dd">{p.start.shortDownDistanceText} at {p.start.possessionText}</span>}
                        <span className="play-text">{p.text || p.type}</span>
                      </span>
                      <span className="play-tags">
                        {p.scoring && <span className="tag tone-great">{/touchdown/i.test(p.type) || p.scoreValue >= 6 ? 'TD' : /field goal/i.test(p.type) ? 'FG' : /safety/i.test(p.type) ? 'Safety' : p.scoreValue ? `+${p.scoreValue}` : 'Score'}</span>}
                        {p.turnover && <span className="tag tone-worst">Turnover</span>}
                        {p.penalty && !p.scoring && <span className="tag tone-warn">Flag</span>}
                        {p.yards != null && p.yards !== 0 && !p.penalty && ['Rush', 'Pass Reception', 'Sack', 'Passing Touchdown', 'Rushing Touchdown'].some((t) => p.type.startsWith(t)) && (
                          <span className={`yds ${p.yards > 0 ? 'pos' : 'neg'}`}>{p.yards > 0 ? '+' : ''}{p.yards}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          </div>
        );
      })}
    </div>
  );
}

function Scoring({ game }) {
  if (!game.scoring.length) return <Card><Empty title="No points yet" /></Card>;
  return (
    <Card pad={false}>
      <ol className="scoring">
        {game.scoring.map((p) => (
          <li key={p.id}>
            <TeamLogo abbr={p.team} size={28} />
            <span className="sc-main">
              <strong>{p.type}</strong>
              <span>{p.text}</span>
            </span>
            <span className="sc-when muted">{ORDINAL_Q(p.period)} {p.clock}</span>
            <span className="sc-score">{game.away.abbr} {p.awayScore} – {p.homeScore} {game.home.abbr}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

const BOX_GROUPS = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'kicking', 'punting'];

function BoxScore({ game }) {
  const [team, setTeam] = useState(game.away.abbr);
  const t = game.players.find((x) => x.abbr === team);
  return (
    <div className="box">
      <Segmented size="sm" label="Team" value={team} onChange={setTeam} options={[game.away.abbr, game.home.abbr]} />
      {!t ? <Card><Empty title="Box score not available yet" /></Card> : t.groups.filter((g) => BOX_GROUPS.includes(g.name) && g.athletes.length).map((g) => (
        <Card key={g.name} title={g.name[0].toUpperCase() + g.name.slice(1)} pad={false}>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Player</th>{g.labels.map((l) => <th key={l} className="num">{l}</th>)}</tr></thead>
              <tbody>
                {g.athletes.map((a) => (
                  <tr key={a.id || a.name} className="static">
                    <td><span className="cell-opp">{a.headshot && <img className="mini-head" src={a.headshot} alt="" loading="lazy" />}{a.name}</span></td>
                    {a.stats.map((s, i) => <td key={i} className="num">{s}</td>)}
                  </tr>
                ))}
                {g.totals?.length > 0 && (
                  <tr className="static totals"><td>Team</td>{g.totals.map((s, i) => <td key={i} className="num">{s}</td>)}</tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function GameFantasy({ game }) {
  const { core, fmt, liveById } = useData();
  const rows = useProjectionRows(core?.week);
  const { openPlayer } = useUi();
  const list = useMemo(
    () => (rows || []).filter((r) => r.team === game.home.abbr || r.team === game.away.abbr).map((r) => ({ ...r, act: r.actual ?? null })).sort((a, b) => (b.act ?? -1) - (a.act ?? -1) || b.proj - a.proj).slice(0, 16),
    [rows, game.home.abbr, game.away.abbr, liveById], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!rows) return <Card><SkeletonRows n={6} /></Card>;
  if (!list.length) return <Card><Empty title="No fantasy projections for this game" /></Card>;
  return (
    <Card title="Fantasy points in this game" subtitle={`${fmt.toUpperCase()} scoring · actual vs projection, updated live`} pad={false}>
      <div className="fan-list">
        {list.map((r) => {
          const pctDone = r.act != null && r.proj ? Math.min(1.5, r.act / r.proj) : 0;
          return (
            <button type="button" key={r.id} className="fan-row" onClick={() => openPlayer(r.id)}>
              <Avatar player={r} size={34} />
              <span className="fan-name"><strong>{r.name}</strong><small>{r.pos} · {r.team}</small></span>
              <span className="fan-bar"><span className={pctDone >= 1 ? 'over' : ''} style={{ width: `${Math.min(100, pctDone * 100)}%` }} /></span>
              <span className="fan-nums"><strong>{r.act != null ? f1(r.act) : '—'}</strong><small>proj {f1(r.proj)}</small></span>
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
  pts.forEach((p, i) => { if (i && p.period && pts[i - 1].period && p.period !== pts[i - 1].period) qMarks.push({ i, q: p.period }); });
  const leader = last >= 0.5 ? game.home : game.away;
  return (
    <Card title="Win probability" subtitle={`${leader.abbr} ${Math.round(Math.max(last, 1 - last) * 100)}%${game.state === 'in' ? ' · live' : ''}`}>
      <svg className="wp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Win probability over the game">
        <defs>
          <clipPath id="wp-top"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="wp-bot"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        <path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} fill={color(game.home)} opacity="0.35" clipPath="url(#wp-top)" />
        <path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} fill={color(game.away)} opacity="0.35" clipPath="url(#wp-bot)" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="wp-mid" />
        {qMarks.map((m) => <line key={m.i} x1={x(m.i)} x2={x(m.i)} y1="0" y2={H} className="wp-q" />)}
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

const KEY_STATS = ['totalYards', 'netPassingYards', 'rushingYards', 'firstDowns', 'thirdDownEff', 'turnovers', 'totalPenaltiesYards', 'possessionTime', 'redZoneAttempts', 'sacksYardsLost'];

function TeamStats({ game, color }) {
  const a = game.teamStats.find((t) => t.abbr === game.away.abbr);
  const h = game.teamStats.find((t) => t.abbr === game.home.abbr);
  if (!a || !h) return null;
  const rows = KEY_STATS.map((k) => ({ k, a: a.stats.find((s) => s.key === k), h: h.stats.find((s) => s.key === k) })).filter((r) => r.a && r.h);
  const lead = (v) => { const n = parseFloat(String(v).replace(':', '.')); return Number.isNaN(n) ? 0 : n; };
  return (
    <Card title="Team stats" subtitle={`${game.away.abbr} vs ${game.home.abbr}`}>
      <div className="tstats">
        {rows.map(({ k, a: av, h: hv }) => {
          const x = lead(av.value);
          const y = lead(hv.value);
          const lowerBetter = k === 'turnovers' || k === 'totalPenaltiesYards' || k === 'sacksYardsLost';
          const share = x + y ? x / (x + y) : 0.5;
          return (
            <div key={k} className="tstat">
              <div className="tstat-vals">
                <strong className={(lowerBetter ? x < y : x > y) ? 'win' : ''}>{av.value}</strong>
                <span>{av.label}</span>
                <strong className={(lowerBetter ? y < x : y > x) ? 'win' : ''}>{hv.value}</strong>
              </div>
              <div className="tstat-bar"><span style={{ width: `${share * 100}%`, background: color(game.away) }} /><span style={{ width: `${(1 - share) * 100}%`, background: color(game.home) }} /></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function GameInfo({ game }) {
  return (
    <Card title="Game info">
      <dl className="ginfo">
        {game.venue && <><dt>Venue</dt><dd>{game.venue.name}{game.venue.city ? `, ${game.venue.city}` : ''}{game.venue.grass != null ? ` · ${game.venue.grass ? 'Grass' : 'Turf'}` : ''}</dd></>}
        {game.tv && <><dt>TV</dt><dd>{game.tv}</dd></>}
        {game.weather && <><dt>Weather</dt><dd>{game.weather.temp}° {game.weather.text || ''}</dd></>}
        {game.line && <><dt>Line</dt><dd>{game.line.details} · O/U {game.line.overUnder}{game.line.provider ? ` (${game.line.provider})` : ''}</dd></>}
        {game.attendance ? <><dt>Attendance</dt><dd>{game.attendance.toLocaleString()}</dd></> : null}
      </dl>
      <a className="link small" href={`https://www.espn.com/nfl/game/_/gameId/${game.id}`} target="_blank" rel="noreferrer">Open on ESPN →</a>
    </Card>
  );
}
