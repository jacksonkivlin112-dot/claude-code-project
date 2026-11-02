import { useMemo } from 'react';
import { useData } from '../data.jsx';
import { ordinal } from '../model.js';
import { GameStatus } from '../components/shell.jsx';
import { Avatar, Empty, GradeChip, InjuryDot, PosBadge, Tag, TeamLogo, WeeklyBars, WinProbBar, f1, kickoff, pct, useUi } from '../components/ui.jsx';
import { addDays, etDate } from './api.js';
import { buildNbaProjectionRows, buildNbaTeamOutlook, fantasy, groupName, nbaSummary } from './model.js';

export function useNbaRows() {
  const { projRows, season, dvp, b2b, liveById } = useData();
  return useMemo(() => (projRows ? buildNbaProjectionRows(projRows, season, dvp, b2b, liveById) : null), [projRows, season, dvp, b2b, liveById]);
}

export function useNbaOutlook() {
  const { board, standings, projRows, b2b } = useData();
  return useMemo(() => (projRows ? buildNbaTeamOutlook(board.games, standings, projRows, b2b) : null), [board, standings, projRows, b2b]);
}

export const statLineNba = (s = {}) => {
  const n = (k, d = 1) => (s[k] || 0).toFixed(d);
  return `${n('pts')} pts · ${n('reb')} reb · ${n('ast')} ast · ${n('tpm')} 3PM · ${n('stl')} stl · ${n('blk')} blk`;
};

export function DateNav() {
  const { date, setDate, allGames, isToday } = useData();
  if (!date) return null;
  const count = (d) => allGames.filter((g) => etDate(g.date) === d).length;
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const step = (dir) => {
    let d = addDays(date, dir);
    for (let i = 0; i < 7 && !count(d); i++) d = addDays(d, dir); // skip empty days
    setDate(d);
  };
  return (
    <div className="date-nav">
      <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Previous slate">‹</button>
      <div className="date-nav-label">
        <strong>{isToday ? 'Tonight' : label.split(',')[0]}</strong>
        <span className="muted">{label} · {count(date)} games</span>
      </div>
      <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Next slate">›</button>
      {!isToday && <button type="button" className="btn-ghost" onClick={() => setDate(etDate())}>Today</button>}
    </div>
  );
}

export function NbaPlayerLine({ r, rank, showTags = true }) {
  const { openPlayer } = useUi();
  const { gameByTeam } = useData();
  const g = gameByTeam[r.team];
  const home = g ? g.home.abbr === r.team : null;
  return (
    <button type="button" className="pline" onClick={() => openPlayer(r.id)}>
      {rank != null && <span className="pline-rank">{rank}</span>}
      <Avatar player={r} size={38} />
      <span className="pline-main">
        <span className="pline-name">{r.name}<InjuryDot status={r.injury} part={r.injuryPart} /></span>
        <span className="pline-meta">
          <PosBadge pos={r.pos} />
          <TeamLogo abbr={r.team} size={14} />
          <span>{r.team}</span>
          <span className="vs">{home === false ? '@' : 'vs'}</span>
          <span>{r.opp}</span>
          {r.matchup && <GradeChip grade={r.grade} matchup={r.matchup} pos={groupName(r.group)} />}
        </span>
        {showTags && r.tags.filter((t) => t.k !== 'inj').length > 0 && (
          <span className="pline-tags">{r.tags.filter((t) => t.k !== 'inj').slice(0, 2).map((t) => <Tag key={t.k} tag={t} />)}</span>
        )}
      </span>
      <span className="pline-num">
        <strong>{f1(r.proj)}</strong>
        <small>{r.actual != null ? <span className={r.actual >= r.proj ? 'pos-txt' : 'neg-txt'}>{f1(r.actual)} act</span> : `${f1(r.min)} min`}</small>
      </span>
    </button>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

const shortDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

export function NbaPlayerPanel({ id }) {
  const { season, teams, gameByTeam, date } = useData();
  const rows = useNbaRows();
  const r = rows?.find((x) => x.id === id);
  const p = season.players.get(id);
  const base = r || p;
  const sm = useMemo(() => nbaSummary(p), [p]);
  if (!base) return <div className="drawer-body"><Empty title="Player not found" /></div>;
  const t = teams?.[base.team];
  const g = gameByTeam[base.team];
  const a = p?.avg || {};
  const log = sm.log;

  return (
    <>
      <div className="drawer-hero" style={{ '--team': t?.color || '#334155', '--team2': t?.alt || '#64748b' }}>
        <Avatar player={{ ...base, sport: 'nba' }} size={84} />
        <div className="drawer-hero-text">
          <span className="eyebrow light"><PosBadge pos={base.pos} /> {t?.name || base.team}</span>
          <h2>{base.name}</h2>
          <span className="hero-meta">
            {base.injury && <InjuryDot status={base.injury} part={base.injuryPart} />}
            {base.injury ? `${base.injury}${base.injuryPart ? ` · ${base.injuryPart}` : ''}` : 'Healthy'}
            {base.exp != null && <> · {base.exp === 0 ? 'Rookie' : `${ordinal(base.exp + 1)} season`}</>}
          </span>
        </div>
        <TeamLogo abbr={base.team} size={72} className="hero-watermark" />
      </div>
      <div className="drawer-body">
        <div className="stat-grid">
          <Stat label={date === etDate() ? 'Tonight proj' : 'Slate proj'} value={r ? f1(r.proj) : '—'} sub={r ? `${f1(r.min)} min · #${r.rank} overall` : 'Not on slate'} accent />
          <Stat label="Season FPTS/G" value={sm.gp ? f1(sm.fpg) : '—'} sub={`${sm.gp} games`} />
          <Stat label="Last 5 avg" value={log.length ? f1(sm.last5) : '—'} sub={log.length >= 3 ? (sm.last5 >= sm.fpg ? 'Trending up' : 'Trending down') : ''} />
          <Stat label="Recent best" value={log.length ? f1(sm.best) : '—'} sub="Last 4 weeks" />
        </div>

        {p?.gp > 0 && (
          <section className="panel-sec">
            <h3>Season averages</h3>
            <div className="avg-strip">
              {[['PTS', a.pts], ['REB', a.reb], ['AST', a.ast], ['3PM', a.tpm], ['STL', a.stl], ['BLK', a.blk], ['MIN', a.min]].map(([k, v]) => (
                <div key={k}><small>{k}</small><strong>{f1(v)}</strong></div>
              ))}
              <div><small>FG%</small><strong>{p.tot.fga ? `${((p.tot.fgm / p.tot.fga) * 100).toFixed(1)}` : '—'}</strong></div>
            </div>
          </section>
        )}

        {r && (
          <section className="panel-sec">
            <h3>{date === etDate() ? 'Tonight' : 'This slate'}</h3>
            <div className="matchup-box">
              <div className="mb-row">
                <span className="cell-opp"><span className="muted">{g && g.home.abbr === r.team ? 'vs' : '@'}</span> <TeamLogo abbr={r.opp} size={22} /> <strong>{teams?.[r.opp]?.name || r.opp}</strong></span>
                {g && <GameStatus g={g} />}
              </div>
              <div className="mb-row">
                <span>Matchup <GradeChip grade={r.grade} matchup={r.matchup} pos={groupName(r.group)} /></span>
                <span className="muted">{r.matchup ? `${r.opp} allows ${r.matchup.avg.toFixed(1)} FPTS/g to ${groupName(r.group)} (${ordinal(r.matchup.rank)} most)` : 'Matchup data pending'}</span>
              </div>
              <div className="mb-line">{statLineNba(r.s)}</div>
              {r.actualLine && <div className="mb-line"><strong>Actual:</strong> {statLineNba(r.actualLine)} · {f1(r.actual)} FPTS</div>}
              {r.tags.length > 0 && <div className="pline-tags">{r.tags.map((x) => <Tag key={x.k} tag={x} />)}</div>}
            </div>
          </section>
        )}

        <section className="panel-sec">
          <h3>Fantasy points by game (last 4 weeks)</h3>
          {log.length ? (
            <WeeklyBars
              data={log.map((l, i) => ({ week: i + 1, value: l.fp, label: `${shortDate(l.date)} vs ${l.opp}`, tone: l.fp >= sm.fpg ? 'up' : 'down' }))}
              refLine={sm.fpg}
              refLabel="season avg"
              maxWeek={log.length}
              axisLabel={(w) => (log[w - 1] ? shortDate(log[w - 1].date) : '')}
            />
          ) : <Empty title="No recent games" />}
        </section>

        {log.length > 0 && (
          <section className="panel-sec">
            <h3>Game log</h3>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr><th>Date</th><th>Opp</th><th className="num">MIN</th><th className="num">PTS</th><th className="num">REB</th><th className="num">AST</th><th className="num">3PM</th><th className="num">S/B</th><th className="num">FPTS</th></tr>
                </thead>
                <tbody>
                  {[...log].reverse().map((l) => (
                    <tr key={l.gameId} className="static">
                      <td>{shortDate(l.date)}</td>
                      <td><span className="cell-opp"><TeamLogo abbr={l.opp} size={16} /> {l.opp}</span></td>
                      <td className="num">{Math.round(l.s.min || 0)}</td>
                      <td className="num">{l.s.pts || 0}</td>
                      <td className="num">{l.s.reb || 0}</td>
                      <td className="num">{l.s.ast || 0}</td>
                      <td className="num">{l.s.tpm || 0}</td>
                      <td className="num">{(l.s.stl || 0)}/{(l.s.blk || 0)}</td>
                      <td className={`num ${l.fp >= sm.fpg ? 'pos-txt' : ''}`}><strong>{f1(l.fp)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

export function NbaTeamPanel({ abbr }) {
  const { teams, standings, allGames, gameByTeam, season, ranks, date } = useData();
  const outlook = useNbaOutlook();
  const rows = useNbaRows();
  const { openPlayer } = useUi();
  const t = teams?.[abbr];
  const st = standings.find((s) => s.abbr === abbr);
  const o = outlook?.teams.find((x) => x.abbr === abbr);
  const g = gameByTeam[abbr];
  const players = (rows || []).filter((r) => r.team === abbr).slice(0, 8);
  const leaders = useMemo(() => {
    const list = [...season.players.values()].filter((p) => p.team === abbr && p.gp >= 2);
    const best = (fn) => list.reduce((a, p) => (fn(p) > (a ? fn(a) : -1) ? p : a), null);
    return [
      ['Points', best((p) => p.avg.pts || 0), (p) => `${f1(p.avg.pts)} PPG`],
      ['Rebounds', best((p) => p.avg.reb || 0), (p) => `${f1(p.avg.reb)} RPG`],
      ['Assists', best((p) => p.avg.ast || 0), (p) => `${f1(p.avg.ast)} APG`],
      ['Fantasy', best((p) => p.fpg || 0), (p) => `${f1(p.fpg)} FPTS/G`],
    ].filter(([, p]) => p);
  }, [season, abbr]);
  const sched = useMemo(() => allGames.filter((x) => x.home.abbr === abbr || x.away.abbr === abbr), [allGames, abbr]);
  const recent = sched.filter((x) => x.state === 'post').slice(-6);
  const upcoming = sched.filter((x) => x.state !== 'post').slice(0, 6);

  if (!t) return <div className="drawer-body"><Empty title="Team not found" /></div>;
  const gp = st ? st.wins + st.losses : 0;
  return (
    <>
      <div className="drawer-hero team" style={{ '--team': t.color, '--team2': t.alt }}>
        <TeamLogo abbr={abbr} size={84} />
        <div className="drawer-hero-text">
          <span className="eyebrow light">{st ? `${st.div}` : t.location}</span>
          <h2>{t.name}</h2>
          <span className="hero-meta">
            {st ? `${st.wins}-${st.losses} · ${st.diff > 0 ? '+' : ''}${f1(gp ? st.diff / gp : 0)} net/g · ${st.streak}` : ''}
            {st?.seed ? ` · #${st.seed} in the ${st.conf}` : ''}
          </span>
        </div>
      </div>
      <div className="drawer-body">
        <div className="stat-grid">
          <Stat label="Proj points" value={o ? f1(o.projPts) : '—'} sub={o ? `vs ${o.opp} (${f1(o.oppPts)})` : 'No game this slate'} accent />
          <Stat label="Win prob" value={o ? pct(o.winProb) : '—'} sub={o ? (o.margin > 0 ? `Fav by ${f1(o.margin)}` : `Dog by ${f1(-o.margin)}`) : ''} />
          <Stat label="Points / game" value={st?.ppg ? f1(st.ppg) : '—'} sub="Scored" />
          <Stat label="Allowed / game" value={st?.oppg ? f1(st.oppg) : '—'} sub="Against" />
        </div>
        {g && o && (
          <section className="panel-sec">
            <h3>{date === etDate() ? 'Tonight' : 'This slate'}</h3>
            <div className="matchup-box">
              <div className="mb-row">
                <span className="cell-opp"><span className="muted">{o.home ? 'vs' : '@'}</span> <TeamLogo abbr={o.opp} size={22} /> <strong>{teams[o.opp]?.name}</strong></span>
                <GameStatus g={g} />
              </div>
              {g.state !== 'pre' && <div className="mb-score">{g.away.abbr} {g.away.score} – {g.home.score} {g.home.abbr}</div>}
              <WinProbBar home={g.home.abbr} away={g.away.abbr} pHome={g.state === 'in' && g.liveHomeWp != null ? g.liveHomeWp : o.home ? o.winProb : 1 - o.winProb} />
              <div className="mb-line muted">
                {kickoff(g.date, { long: true })}{g.venue ? ` · ${g.venue}` : ''}{g.tv ? ` · ${g.tv}` : ''} · Projected total {f1(o.total)}
                {o.b2b && ' · Second night of a back-to-back'}
              </div>
            </div>
          </section>
        )}
        {players.length > 0 && (
          <section className="panel-sec">
            <h3>Fantasy projections</h3>
            <div className="plist dense">{players.map((r) => <NbaPlayerLine key={r.id} r={r} showTags={false} />)}</div>
          </section>
        )}
        {ranks[abbr] && (
          <section className="panel-sec">
            <h3>Defense vs position (last 4 weeks)</h3>
            <div className="dvp-row three">
              {['G', 'F', 'C'].map((grp) => {
                const m = ranks[abbr][grp]?.fp;
                if (!m) return null;
                const tone = m.rank <= 6 ? 'great' : m.rank <= 12 ? 'good' : m.rank <= 18 ? 'neutral' : m.rank <= 24 ? 'bad' : 'worst';
                return (
                  <div key={grp} className={`dvp tone-${tone}`} title={`Allows ${m.avg.toFixed(1)} FPTS/g to ${groupName(grp)}`}>
                    <span className="pos">{grp}</span>
                    <strong>{m.avg.toFixed(1)}</strong>
                    <span>{ordinal(m.rank)} most</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {leaders.length > 0 && (
          <section className="panel-sec">
            <h3>Season leaders</h3>
            <div className="leaders-grid">
              {leaders.map(([label, p, line]) => (
                <button type="button" key={label} className="leader-tile" onClick={() => openPlayer(p.id)}>
                  <Avatar player={p} size={34} />
                  <span><small>{label}</small><strong>{p.name}</strong><span className="muted">{line(p)}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className="panel-sec">
          <h3>Recent & upcoming</h3>
          <div className="sched">
            {[...recent, ...upcoming].map((x) => {
              const home = x.home.abbr === abbr;
              const me = home ? x.home : x.away;
              const them = home ? x.away : x.home;
              const today = etDate(x.date) === date;
              return (
                <div key={x.id} className={`sched-row ${today ? 'current' : ''}`}>
                  <span className="muted">{shortDate(etDate(x.date))}</span>
                  <span className="cell-opp"><span className="muted">{home ? 'vs' : '@'}</span> <TeamLogo abbr={them.abbr} size={16} /> {them.abbr}</span>
                  {x.state === 'post' && me.score != null ? (
                    <span className={`result ${me.winner ? 'w' : 'l'}`}><b>{me.winner ? 'W' : 'L'}</b> {me.score}-{them.score}</span>
                  ) : x.state === 'in' ? (
                    <span className="status live"><span className="live-dot" /> {me.score}-{them.score}</span>
                  ) : (
                    <span className="muted">{new Date(x.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

export const fpOf = fantasy;
