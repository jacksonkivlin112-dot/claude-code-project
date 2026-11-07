import HomeFeed from '../components/HomeFeed.jsx';
import { DateStrip, GamesSection, InjuriesSection, PerformerPill, StreaksSection, useNflDays } from '../components/HomeSections.jsx';
import { useState } from 'react';
import { sportPath, useData } from '../data.jsx';
import { GameStatus } from '../components/shell.jsx';
import { PlayerLine, useProjectionRows, useTeamOutlook } from '../components/players.jsx';
import { Avatar, Card, Empty, Meter, Segmented, SkeletonRows, TeamLogo, WinProbBar, f1, kickoff, pct, useUi } from '../components/ui.jsx';

const POS_TABS = ['ALL', 'QB', 'RB', 'WR', 'TE'];

export default function Home() {
  const { core, board, loading, sport: league = 'nfl' } = useData();
  const rows = useProjectionRows(core?.week);
  const outlook = useTeamOutlook();
  const [pos, setPos] = useState('ALL');
  const { days, defaultDay } = useNflDays();
  const [day, setDay] = useState(null);
  const selDay = day || defaultDay;
  const dayGames = days.find((d) => d.ymd === selDay)?.games || [];
  const spreadOf = (g) => {
    const h = outlook?.teams.find((t) => t.abbr === g.home.abbr);
    if (!h) return null;
    const m = Math.round(Math.abs(h.margin) * 2) / 2;
    return m < 0.5 ? 'Pick’em (proj)' : `${h.margin > 0 ? g.home.abbr : g.away.abbr} by ${m} (proj)`;
  };

  if (!core || !rows) return <HomeSkeleton />;

  const live = board.games.filter((g) => g.state === 'in').length;
  const final = board.games.filter((g) => g.state === 'post').length;
  const upcoming = board.games.length - live - final;

  const pool = rows.filter((r) => r.pos !== 'K' && r.pos !== 'DEF' && r.injury !== 'Out' && r.injury !== 'IR');
  const primed = [...(pos === 'ALL' ? pool : pool.filter((r) => r.pos === pos))].sort((a, b) => b.outlook - a.outlook).slice(0, 8);
  const smash = pool.filter((r) => r.tags.some((t) => t.k === 'smash')).slice(0, 6);
  const hot = pool.filter((r) => r.proj >= 6 && r.tags.some((t) => t.k === 'hot')).sort((a, b) => b.season.last3 / b.season.ppg - a.season.last3 / a.season.ppg).slice(0, 6);
  const caution = pool.filter((r) => r.posRank <= 24 && (r.tags.some((t) => t.k === 'tough') || r.injury === 'Questionable' || r.injury === 'Doubtful')).slice(0, 6);
  const defs = rows.filter((r) => r.pos === 'DEF').slice(0, 5);

  const top = rows[0];
  const bestTeam = outlook?.teams[0];
  const fav = outlook ? [...outlook.teams].sort((a, b) => b.winProb - a.winProb)[0] : null;
  const shootout = outlook
    ? [...board.games]
        .map((g) => ({ g, total: (outlook.teams.find((t) => t.abbr === g.home.abbr)?.projPts || 0) + (outlook.teams.find((t) => t.abbr === g.away.abbr)?.projPts || 0) }))
        .sort((a, b) => b.total - a.total)[0]
    : null;

  return (
    <div className="page">
      <DateStrip days={days} value={selDay} onChange={setDay} />
      <GamesSection games={dayGames} sport={league} spreadOf={spreadOf} onStandings={() => { window.location.hash = `/${sportPath(league)}teams`; }} />
      <InjuriesSection sport="nfl" />
      <StreaksSection sport="nfl" />
      <HomeFeed sport="nfl" rail={false} />
      <PerformerPill sport="nfl" />
      <section className="hero">
        <div>
          <p className="eyebrow">{core.season} regular season</p>
          <h1>Week {core.week} Outlook</h1>
          <p className="hero-sub">
            {board.games.length} games
            {live > 0 && <> · <span className="live-txt"><span className="live-dot" /> {live} live</span></>}
            {final > 0 && <> · {final} final</>}
            {upcoming > 0 && <> · {upcoming} upcoming</>}
            {board.byes.length > 0 && <> · Byes: {board.byes.join(', ')}</>}
          </p>
        </div>
        <div className="kpis">
          {top && <Kpi label="Top projected" value={f1(top.proj)} unit="pts" detail={top.name} avatar={top} />}
          {bestTeam && <Kpi label="Best team outlook" value={f1(bestTeam.projPts)} unit="proj pts" detail={`${bestTeam.abbr} ${bestTeam.home ? 'vs' : '@'} ${bestTeam.opp}`} logo={bestTeam.abbr} />}
          {fav && <Kpi label="Biggest favorite" value={pct(fav.winProb)} unit="win prob" detail={`${fav.abbr} ${fav.home ? 'vs' : '@'} ${fav.opp}`} logo={fav.abbr} />}
          {shootout && <Kpi label="Shootout watch" value={f1(shootout.total)} unit="combined" detail={`${shootout.g.away.abbr} @ ${shootout.g.home.abbr}`} logo={shootout.g.home.abbr} />}
        </div>
      </section>

      <div className="grid-2">
        <Card
          title="Primed for a big week"
          subtitle="Projection adjusted for matchup and recent form"
          action={<Segmented size="sm" options={POS_TABS} value={pos} onChange={setPos} label="Position" />}
        >
          <div className="plist">{primed.map((r, i) => <PlayerLine key={r.id} r={r} rank={i + 1} />)}</div>
          <a className="card-link" href={`#/projections${pos !== 'ALL' ? `?pos=${pos}` : ''}`}>All projections →</a>
        </Card>

        <Card title="Teams to watch" subtitle="Implied team totals blended with a points-for and points-against model">
          {!outlook ? <SkeletonRows n={6} /> : outlook.teams.length === 0 ? <Empty title="No games this week" /> : <TeamOutlookList teams={outlook.teams.slice(0, 7)} />}
          <a className="card-link" href="#/teams">Full team outlook →</a>
        </Card>
      </div>

      <div className="grid-3">
        <Card title="Smash spots" subtitle="Starters facing the softest defenses at their position">
          {smash.length ? <div className="plist dense">{smash.map((r) => <PlayerLine key={r.id} r={r} showTags={false} />)}</div> : <Empty title="No smash spots yet">Matchup grades sharpen after a few weeks of data.</Empty>}
        </Card>
        <Card title="Heating up" subtitle="Last 3 games well above season average">
          {hot.length ? <div className="plist dense">{hot.map((r) => <PlayerLine key={r.id} r={r} showTags={false} />)}</div> : <Empty title="Nobody trending yet" />}
        </Card>
        <Card title="Proceed with caution" subtitle="Top-24 players with tough matchups or injury tags">
          {caution.length ? <div className="plist dense">{caution.map((r) => <PlayerLine key={r.id} r={r} showTags={false} />)}</div> : <Empty title="All clear" />}
        </Card>
      </div>

      <Card title="The slate" subtitle="Projected scores, win probability and live box scores" className="slate-card">
        {board.games.length === 0 ? (
          <Empty title={loading ? 'Loading games…' : 'No games this week'} />
        ) : (
          <div className="slate">
            {[...board.games].sort((a, b) => new Date(a.date) - new Date(b.date)).map((g) => (
              <GameCard key={g.id} g={g} outlook={outlook} />
            ))}
          </div>
        )}
      </Card>

      {defs.length > 0 && (
        <Card title="Defenses to stream" subtitle="Top projected team defenses this week">
          <div className="def-strip">
            {defs.map((d, i) => (
              <DefTile key={d.id} d={d} rank={i + 1} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, unit, detail, avatar, logo }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        <small>{unit}</small>
      </span>
      <span className="kpi-detail">
        {avatar && <Avatar player={avatar} size={18} />}
        {logo && <TeamLogo abbr={logo} size={16} />}
        {detail}
      </span>
    </div>
  );
}

export function TeamOutlookList({ teams }) {
  const { openTeam } = useUi();
  return (
    <div className="tlist">
      {teams.map((t, i) => (
        <button type="button" key={t.abbr} className="tline" onClick={() => openTeam(t.abbr)}>
          <span className="pline-rank">{i + 1}</span>
          <TeamLogo abbr={t.abbr} size={32} />
          <span className="tline-main">
            <span className="tline-name">
              {t.abbr} <span className="muted">{t.home ? 'vs' : '@'}</span> {t.opp}
              <span className="rec-sm">{t.record}</span>
            </span>
            <span className="tline-meta">
              Proj {f1(t.projPts)}–{f1(t.oppPts)} · {pct(t.winProb)} to win
            </span>
            <Meter value={t.outlook} tone={t.outlook >= 75 ? 'great' : t.outlook >= 50 ? 'good' : 'neutral'} label={`Outlook ${t.outlook}/100`} />
          </span>
          <span className="pline-num">
            <strong>{t.outlook}</strong>
            <small>outlook</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function GameCard({ g, outlook }) {
  const { sport: league } = useData();
  const { openTeam } = useUi();
  const h = outlook?.teams.find((t) => t.abbr === g.home.abbr);
  const a = outlook?.teams.find((t) => t.abbr === g.away.abbr);
  return (
    <article className={`game ${g.state}`}>
      <header className="game-head">
        <GameStatus g={g} />
        <span className="muted">{g.tv}</span>
      </header>
      {[{ s: g.away, p: a }, { s: g.home, p: h }].map(({ s, p }) => (
        <button type="button" key={s.abbr} className={`game-row ${g.state === 'post' && !s.winner ? 'lost' : ''}`} onClick={() => openTeam(s.abbr)}>
          <TeamLogo abbr={s.abbr} size={28} />
          <span className="game-team">
            <strong>{s.abbr}</strong>
            <small>{s.record}</small>
          </span>
          {g.state !== 'pre' && s.linescores.length > 0 && (
            <span className="quarters">{s.linescores.map((q, i) => <span key={i}>{q}</span>)}</span>
          )}
          <span className="game-score">{g.state === 'pre' ? <span className="proj-score">{p ? f1(p.projPts) : '—'}</span> : s.score}</span>
        </button>
      ))}
      {h && a && <WinProbBar home={g.home.abbr} away={g.away.abbr} pHome={h.winProb} />}
      <footer className="game-foot">
        {g.state === 'pre' ? (
          <>
            <span>{kickoff(g.date, { long: true })}</span>
            <span>
              {g.indoor ? 'Indoors' : g.weather ? `${g.weather.temp}° ${g.weather.text || ''}` : ''}
            </span>
          </>
        ) : g.leaders.length > 0 ? (
          <div className="leaders">
            {g.leaders.slice(0, 3).map((l) => (
              <span key={l.label}>
                <b>{l.label}</b> {l.name} <span className="muted">{l.line}</span>
              </span>
            ))}
          </div>
        ) : null}
        {g.state === 'pre' && g.venue && <span className="venue">{g.venue}{g.city ? ` · ${g.city}` : ''}</span>}
      </footer>
      <a className={`gc-link ${g.state}`} href={`#/${sportPath(league)}game?id=${g.id}`}>
        {g.state === 'in' ? <><span className="live-dot" /> Live play-by-play</> : g.state === 'post' ? 'Recap & play-by-play' : 'Game preview'} →
      </a>
    </article>
  );
}

function DefTile({ d, rank }) {
  const { openPlayer } = useUi();
  return (
    <button type="button" className="def-tile" onClick={() => openPlayer(d.id)}>
      <span className="def-rank">#{rank}</span>
      <TeamLogo abbr={d.team} size={40} />
      <strong>{d.team} D/ST</strong>
      <span className="muted">vs {d.opp} · {d.grade.letter} matchup</span>
      <span className="def-proj">{f1(d.proj)}</span>
      <span className="def-line">
        {f1(d.s.sack)} sacks · {f1(d.s.int)} INT · {f1(d.s.pts_allow)} pts allowed
      </span>
    </button>
  );
}

function HomeSkeleton() {
  const { progress, error } = useData();
  if (error) return null;
  return (
    <div className="page">
      <div className="loading-card">
        <div className="loading-ball" aria-hidden />
        <strong>Building this week’s board…</strong>
        <span className="muted">Loading stats, projections and matchups ({progress.done}/{progress.total})</span>
        <div className="meter"><div className="meter-fill tone-accent" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
      </div>
      <div className="grid-2">
        <Card title=" "><SkeletonRows n={7} /></Card>
        <Card title=" "><SkeletonRows n={7} /></Card>
      </div>
    </div>
  );
}
