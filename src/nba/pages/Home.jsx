import { useState } from 'react';
import { useData } from '../../data.jsx';
import { GameStatus } from '../../components/shell.jsx';
import { Avatar, Card, Empty, Meter, Segmented, SkeletonRows, TeamLogo, WinProbBar, f1, kickoff, pct, useUi } from '../../components/ui.jsx';
import { DateNav, NbaPlayerLine, useNbaOutlook, useNbaRows } from '../components.jsx';

const TABS = ['ALL', 'G', 'F', 'C'];

export default function NbaHome() {
  const { core, board, isToday, loading, progress, error } = useData();
  const rows = useNbaRows();
  const outlook = useNbaOutlook();
  const [grp, setGrp] = useState('ALL');

  if (!core || !rows) {
    if (error) return null;
    return (
      <div className="page">
        <div className="loading-card">
          <div className="loading-ball hoop" aria-hidden />
          <strong>Building tonight’s board…</strong>
          <span className="muted">Loading box scores, projections and matchups ({progress.done}/{progress.total})</span>
          <div className="meter"><div className="meter-fill tone-accent" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
        </div>
        <div className="grid-2"><Card title=" "><SkeletonRows n={7} /></Card><Card title=" "><SkeletonRows n={7} /></Card></div>
      </div>
    );
  }

  const live = board.games.filter((g) => g.state === 'in').length;
  const final = board.games.filter((g) => g.state === 'post').length;
  const upcoming = board.games.length - live - final;
  const pool = rows.filter((r) => !['Out', 'Doubtful', 'IR', 'Sus'].includes(r.injury));
  const primed = [...(grp === 'ALL' ? pool : pool.filter((r) => r.group === grp))].sort((a, b) => b.outlook - a.outlook).slice(0, 8);
  const smash = pool.filter((r) => r.tags.some((t) => t.k === 'smash')).slice(0, 6);
  const hot = pool.filter((r) => r.proj >= 18 && r.tags.some((t) => t.k === 'hot')).sort((a, b) => b.season.last5 / b.season.fpg - a.season.last5 / a.season.fpg).slice(0, 6);
  const caution = pool.filter((r) => r.rank <= 60 && (r.tags.some((t) => t.k === 'tough' || t.k === 'b2b') || r.injury === 'Questionable')).slice(0, 6);
  const values = pool.filter((r) => r.edge != null && r.edge >= 4 && r.season.fpg < 30).sort((a, b) => b.edge - a.edge).slice(0, 5);

  const top = rows[0];
  const bestTeam = outlook?.teams[0];
  const fav = outlook?.teams.length ? [...outlook.teams].sort((a, b) => b.winProb - a.winProb)[0] : null;
  const shootout = outlook?.teams.length ? [...outlook.teams].sort((a, b) => b.total - a.total)[0] : null;

  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">{core.label} NBA season</p>
          <h1>{isToday ? 'Tonight’s Outlook' : 'Slate Outlook'}</h1>
          <p className="hero-sub">
            {board.games.length} games
            {live > 0 && <> · <span className="live-txt"><span className="live-dot" /> {live} live</span></>}
            {final > 0 && <> · {final} final</>}
            {upcoming > 0 && <> · {upcoming} upcoming</>}
          </p>
          <DateNav />
        </div>
        <div className="kpis">
          {top && <Kpi label="Top projected" value={f1(top.proj)} unit="FPTS" detail={top.name} avatar={top} />}
          {bestTeam && <Kpi label="Best team outlook" value={f1(bestTeam.projPts)} unit="proj pts" detail={`${bestTeam.abbr} ${bestTeam.home ? 'vs' : '@'} ${bestTeam.opp}`} logo={bestTeam.abbr} />}
          {fav && <Kpi label="Biggest favorite" value={pct(fav.winProb)} unit="win prob" detail={`${fav.abbr} ${fav.home ? 'vs' : '@'} ${fav.opp}`} logo={fav.abbr} />}
          {shootout && <Kpi label="Highest total" value={f1(shootout.total)} unit="combined" detail={`${shootout.home ? shootout.opp : shootout.abbr} @ ${shootout.home ? shootout.abbr : shootout.opp}`} logo={shootout.home ? shootout.abbr : shootout.opp} />}
        </div>
      </section>

      {rows.length === 0 ? (
        <Card><Empty title="No projections for this slate yet">Projections usually post the day before games. Try another date.</Empty></Card>
      ) : (
        <>
          <div className="grid-2">
            <Card title="Primed for a big night" subtitle="Fantasy projection adjusted for matchup, form and rest" action={<Segmented size="sm" options={TABS} value={grp} onChange={setGrp} label="Position group" />}>
              <div className="plist">{primed.map((r, i) => <NbaPlayerLine key={r.id} r={r} rank={i + 1} />)}</div>
              <a className="card-link" href="#/nba/projections">All projections →</a>
            </Card>
            <Card title="Teams to watch" subtitle="Summed player projections blended with a points-for and points-against model">
              {!outlook?.teams.length ? <Empty title="No games on this slate" /> : <TeamList teams={outlook.teams.slice(0, 7)} />}
              <a className="card-link" href="#/nba/teams">Full team outlook →</a>
            </Card>
          </div>

          <div className="grid-3">
            <Card title="Smash spots" subtitle="Facing the softest defenses at their position (last 4 weeks)">
              {smash.length ? <div className="plist dense">{smash.map((r) => <NbaPlayerLine key={r.id} r={r} showTags={false} />)}</div> : <Empty title="No smash spots on this slate" />}
            </Card>
            <Card title="Heating up" subtitle="Last 5 games well above season average">
              {hot.length ? <div className="plist dense">{hot.map((r) => <NbaPlayerLine key={r.id} r={r} showTags={false} />)}</div> : <Empty title="Nobody trending yet" />}
            </Card>
            <Card title="Proceed with caution" subtitle="Top-60 plays with tough matchups, back-to-backs or injury tags">
              {caution.length ? <div className="plist dense">{caution.map((r) => <NbaPlayerLine key={r.id} r={r} showTags={false} />)}</div> : <Empty title="All clear" />}
            </Card>
          </div>
        </>
      )}

      <Card title="The slate" subtitle="Projected scores, win probability, live quarter scores and leaders">
        {board.games.length === 0 ? (
          <Empty title={loading ? 'Loading games…' : 'No games on this date'} />
        ) : (
          <div className="slate">
            {[...board.games].sort((a, b) => new Date(a.date) - new Date(b.date)).map((g) => <GameCard key={g.id} g={g} outlook={outlook} />)}
          </div>
        )}
      </Card>

      {values.length > 0 && (
        <Card title="Value watch" subtitle="Role players projected well above their season average">
          <div className="def-strip">
            {values.map((r) => <ValueTile key={r.id} r={r} />)}
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
      <span className="kpi-value">{value}<small>{unit}</small></span>
      <span className="kpi-detail">{avatar && <Avatar player={avatar} size={18} />}{logo && <TeamLogo abbr={logo} size={16} />}{detail}</span>
    </div>
  );
}

export function TeamList({ teams }) {
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
              {t.b2b && <span className="tag tone-warn" title="Second night of a back-to-back">B2B</span>}
            </span>
            <span className="tline-meta">Proj {f1(t.projPts)}–{f1(t.oppPts)} · {pct(t.winProb)} to win · total {f1(t.total)}</span>
            <Meter value={t.outlook} tone={t.outlook >= 75 ? 'great' : t.outlook >= 50 ? 'good' : 'neutral'} />
          </span>
          <span className="pline-num"><strong>{t.outlook}</strong><small>outlook</small></span>
        </button>
      ))}
    </div>
  );
}

function GameCard({ g, outlook }) {
  const { openTeam } = useUi();
  const h = outlook?.teams.find((t) => t.abbr === g.home.abbr);
  const a = outlook?.teams.find((t) => t.abbr === g.away.abbr);
  const pHome = g.state === 'in' && g.liveHomeWp != null ? g.liveHomeWp : h?.winProb;
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
            <strong>{s.abbr}{p?.b2b && <span className="b2b-dot" title="Back-to-back">B2B</span>}</strong>
            <small>{s.record}</small>
          </span>
          {g.state !== 'pre' && s.linescores.length > 0 && <span className="quarters">{s.linescores.map((q, i) => <span key={i}>{q}</span>)}</span>}
          <span className="game-score">{g.state === 'pre' ? <span className="proj-score">{p ? f1(p.projPts) : '—'}</span> : s.score}</span>
        </button>
      ))}
      {pHome != null && <WinProbBar home={g.home.abbr} away={g.away.abbr} pHome={pHome} />}
      <footer className="game-foot">
        {g.state === 'pre' ? (
          <>
            <span>{kickoff(g.date, { long: true })}</span>
            <span>{h ? `Total ${f1(h.total)} · ${h.margin >= 0 ? g.home.abbr : g.away.abbr} -${f1(Math.abs(h.margin))}` : ''}</span>
            {g.venue && <span className="venue">{g.venue}{g.city ? ` · ${g.city}` : ''}</span>}
          </>
        ) : g.leaders.length > 0 ? (
          <div className="leaders">
            {g.leaders.slice(0, 3).map((l) => <span key={l.label}><b>{l.label}</b> {l.name} <span className="muted">{l.line}</span></span>)}
            {g.state === 'in' && g.liveHomeWp != null && <span className="muted">Live win probability via ESPN</span>}
          </div>
        ) : null}
      </footer>
      <a className={`gc-link ${g.state}`} href={`#/nba/game?id=${g.id}`}>
        {g.state === 'in' ? <><span className="live-dot" /> Live play-by-play</> : g.state === 'post' ? 'Box score & play-by-play' : 'Game preview'} →
      </a>
    </article>
  );
}

function ValueTile({ r }) {
  const { openPlayer } = useUi();
  return (
    <button type="button" className="def-tile" onClick={() => openPlayer(r.id)}>
      <span className="def-rank">+{f1(r.edge)}</span>
      <Avatar player={r} size={44} />
      <strong>{r.name}</strong>
      <span className="muted">{r.team} vs {r.opp} · {r.grade.letter} matchup</span>
      <span className="def-proj">{f1(r.proj)}</span>
      <span className="def-line">{f1(r.min)} min · season {f1(r.season.fpg)} FPTS/g</span>
    </button>
  );
}
