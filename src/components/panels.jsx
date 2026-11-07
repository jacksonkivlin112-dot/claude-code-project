import { useEffect, useMemo, useRef, useState } from 'react';
import { getTeamSchedule } from '../api.js';
import PlayerBio from './PlayerBio.jsx';
import { useData } from '../data.jsx';
import { grade, ordinal, playerSummary, pts } from '../model.js';
import { statLine } from '../pages/Projections.jsx';
import { PlayerLine, useProjectionRows, useTeamOutlook } from './players.jsx';
import { GameStatus } from './shell.jsx';
import { Avatar, Empty, GradeChip, InjuryDot, PosBadge, SkeletonRows, Tag, TeamLogo, WeeklyBars, WinProbBar, f0, f1, kickoff, pct, useUi } from './ui.jsx';

export function Overlay({ PlayerPanelC = PlayerPanel, TeamPanelC = TeamPanel }) {
  const { overlay, close } = useUi();
  const closeRef = useRef(close);
  closeRef.current = close;
  const open = !!overlay;
  useEffect(() => {
    if (!open) return undefined;
    // A history entry for the sheet, so the phone's Back button/swipe closes it.
    window.history.pushState({ geOverlay: true }, '');
    const onPop = () => closeRef.current();
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    const onNav = () => closeRef.current(); // a link inside the sheet navigated away
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onNav);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onNav);
      document.body.classList.remove('no-scroll');
      if (window.history.state?.geOverlay) window.history.back(); // closed with ✕: drop the entry
    };
  }, [open]);
  if (!overlay) return null;
  return (
    <div className="overlay" onClick={close}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={close} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {overlay.type === 'player' ? <PlayerPanelC id={overlay.id} /> : <TeamPanelC abbr={overlay.id} />}
      </aside>
    </div>
  );
}

function PlayerPanel({ id }) {
  const { season, fmt, teams, core, gameByTeam, sport } = useData();
  const rows = useProjectionRows(core?.week);
  const r = rows?.find((x) => x.id === id);
  const sp = season.players.get(id);
  const base = r || sp;
  const sum = useMemo(() => playerSummary(sp, fmt), [sp, fmt]);
  if (!base) return <div className="drawer-body"><Empty title="Player not found" /></div>;
  const t = teams?.[base.team];
  const g = gameByTeam[base.team];
  const vals = sum.weekly.map((w) => w.pts);

  return (
    <>
      <div className="drawer-hero" style={{ '--team': t?.color || '#334155', '--team2': t?.alt || '#64748b' }}>
        <Avatar player={base} size={84} />
        <div className="drawer-hero-text">
          <span className="eyebrow light">
            <PosBadge pos={base.pos} /> {t?.name || base.team}
          </span>
          <h2>{base.name}</h2>
          <span className="hero-meta">
            {base.injury && <InjuryDot status={base.injury} part={base.injuryPart} />}
            {base.injury ? `${base.injury}${base.injuryPart ? ` · ${base.injuryPart}` : ''}` : 'Healthy'}
            {r?.exp != null && base.pos !== 'DEF' && <> · {r.exp === 0 ? 'Rookie' : `${ordinal(r.exp + 1)} season`}</>}
          </span>
          {base.pos !== 'DEF' && <PlayerBio league={sport === 'cfb' ? 'cfb' : 'nfl'} name={base.name} espnId={sport === 'cfb' ? base.id : null} />}
        </div>
        <TeamLogo abbr={base.team} size={72} className="hero-watermark" />
      </div>

      <div className="drawer-body">
        <div className="stat-grid">
          <Stat label={`Wk ${core?.week} proj`} value={r ? f1(r.proj) : '—'} sub={r ? `${r.pos}${r.posRank}` : 'No projection'} accent />
          <Stat label="Season avg" value={sum.games ? f1(sum.ppg) : '—'} sub={`${sum.games} games`} />
          <Stat label="Last 3 avg" value={sum.games ? f1(sum.last3) : '—'} sub={sum.games >= 3 ? (sum.last3 >= sum.ppg ? 'Trending up' : 'Trending down') : ''} />
          <Stat label="Best game" value={sum.games ? f1(sum.best) : '—'} sub={sum.games ? `Wk ${sum.weekly.find((w) => w.pts === sum.best)?.week}` : ''} />
        </div>

        {sum.games > 0 && <SeasonStats pos={base.pos} weekly={sum.weekly} />}

        {r && (
          <section className="panel-sec">
            <h3>This week</h3>
            <div className="matchup-box">
              <div className="mb-row">
                <span className="cell-opp">
                  <span className="muted">{g && g.home.abbr === r.team ? 'vs' : '@'}</span>
                  <TeamLogo abbr={r.opp} size={22} /> <strong>{teams?.[r.opp]?.name || r.opp}</strong>
                </span>
                {g && <GameStatus g={g} />}
              </div>
              <div className="mb-row">
                <span>Matchup <GradeChip grade={r.grade} matchup={r.matchup} pos={r.pos} /></span>
                <span className="muted">
                  {r.matchup ? `${r.opp} allows ${r.matchup.avg.toFixed(1)} pts/g to ${r.pos} (${ordinal(r.matchup.rank)} most)` : 'Matchup data pending'}
                </span>
              </div>
              <div className="mb-line">{statLine(r.pos, r.s)}</div>
              {sum.games >= 3 && <RangeBar floor={sum.floor} ceiling={sum.ceiling} proj={r.proj} actual={r.actual} />}
              {r.tags.length > 0 && <div className="pline-tags">{r.tags.map((x) => <Tag key={x.k} tag={x} />)}</div>}
            </div>
          </section>
        )}

        <section className="panel-sec">
          <h3>Weekly fantasy points</h3>
          {sum.games ? (
            <WeeklyBars
              data={sum.weekly.map((w) => ({ week: w.week, value: w.pts, label: `vs ${w.opp}`, tone: w.pts >= sum.ppg ? 'up' : 'down' }))}
              refLine={sum.ppg}
              refLabel="avg"
              maxWeek={Math.max(core?.week || 1, ...vals.map((_, i) => i + 1))}
            />
          ) : (
            <Empty title="No games played yet" />
          )}
        </section>

        {sum.games > 0 && (
          <section className="panel-sec">
            <h3>Game log</h3>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Wk</th>
                    <th>Opp</th>
                    <th>Line</th>
                    <th className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sum.weekly].reverse().map((w) => (
                    <tr key={w.week} className="static">
                      <td>{w.week}</td>
                      <td><span className="cell-opp"><TeamLogo abbr={w.opp} size={16} /> {w.opp}</span></td>
                      <td className="statline">{logLine(base.pos, w.s)}</td>
                      <td className={`num ${w.pts >= sum.ppg ? 'pos-txt' : ''}`}><strong>{f1(w.pts)}</strong></td>
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

const SEASON_STATS = {
  QB: [['pass_yd', 'Pass yds'], ['pass_td', 'Pass TD'], ['pass_int', 'INT'], ['cmp_pct', 'Comp %'], ['pass_att', 'Attempts'], ['rush_yd', 'Rush yds'], ['rush_td', 'Rush TD'], ['ypa', 'Yds/att']],
  RB: [['rush_yd', 'Rush yds'], ['rush_att', 'Carries'], ['ypc', 'Yds/carry'], ['rush_td', 'Rush TD'], ['rec', 'Receptions'], ['rec_yd', 'Rec yds'], ['rec_td', 'Rec TD'], ['scrim', 'Scrimmage yds']],
  WR: [['rec', 'Receptions'], ['rec_yd', 'Rec yds'], ['rec_td', 'Rec TD'], ['ypr', 'Yds/catch'], ['rec_tgt', 'Targets'], ['catch_pct', 'Catch %'], ['rush_yd', 'Rush yds'], ['long_gm', 'Best game yds']],
  K: [['fgm', 'FG made'], ['fga', 'FG att'], ['xpm', 'XP made']],
  DEF: [['sack', 'Sacks'], ['int', 'INT'], ['fum_rec', 'Fumble rec'], ['def_td', 'Def TD'], ['pts_allow', 'Pts allowed']],
};
SEASON_STATS.TE = SEASON_STATS.WR;

/** Season totals and per-game averages for the player's position. */
function SeasonStats({ pos, weekly }) {
  const keys = SEASON_STATS[pos] || SEASON_STATS.WR;
  const tot = {};
  for (const w of weekly) for (const [k, v] of Object.entries(w.s || {})) tot[k] = (tot[k] || 0) + (Number(v) || 0);
  const g = weekly.length;
  const derived = {
    cmp_pct: tot.pass_att ? (tot.pass_cmp / tot.pass_att) * 100 : null,
    ypa: tot.pass_att ? tot.pass_yd / tot.pass_att : null,
    ypc: tot.rush_att ? tot.rush_yd / tot.rush_att : null,
    ypr: tot.rec ? tot.rec_yd / tot.rec : null,
    catch_pct: tot.rec_tgt ? (tot.rec / tot.rec_tgt) * 100 : null,
    scrim: (tot.rush_yd || 0) + (tot.rec_yd || 0),
    long_gm: Math.max(0, ...weekly.map((w) => (w.s?.rec_yd || 0) + (pos === 'RB' ? w.s?.rush_yd || 0 : 0))),
  };
  const rate = new Set(['cmp_pct', 'ypa', 'ypc', 'ypr', 'catch_pct', 'long_gm']);
  const items = keys.map(([k, label]) => {
    const v = k in derived ? derived[k] : tot[k];
    if (v == null || (k === 'rec_tgt' && !v)) return null;
    const pct = k.endsWith('_pct');
    return { k, label, value: rate.has(k) ? `${f1(v)}${pct ? '%' : ''}` : f0(v), per: rate.has(k) ? null : f1(v / g) };
  }).filter(Boolean);
  return (
    <section className="panel-sec">
      <h3>Season stats <span className="muted small">{g} game{g === 1 ? '' : 's'}</span></h3>
      <div className="season-stats">
        {items.map((x) => (
          <div key={x.k} className="ss-cell">
            <small>{x.label}</small>
            <b>{x.value}</b>
            {x.per != null && <span>{x.per} / game</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function logLine(pos, s) {
  const n = (k) => f0(s[k] || 0);
  switch (pos) {
    case 'QB':
      return `${n('pass_cmp')}/${n('pass_att')}, ${n('pass_yd')} yds, ${n('pass_td')} TD, ${n('pass_int')} INT${s.rush_yd ? ` · ${n('rush_yd')} rush` : ''}`;
    case 'RB':
      return `${n('rush_att')}-${n('rush_yd')}, ${n('rush_td')} TD · ${n('rec')}-${n('rec_yd')} rec${s.rec_td ? `, ${n('rec_td')} TD` : ''}`;
    case 'WR':
    case 'TE':
      return `${s.rec_tgt ? `${n('rec')}/${n('rec_tgt')}` : `${n('rec')} rec`}, ${n('rec_yd')} yds${s.rec_td ? `, ${n('rec_td')} TD` : ''}${s.off_snp && s.tm_off_snp ? ` · ${Math.round((s.off_snp / s.tm_off_snp) * 100)}% snaps` : ''}`;
    case 'K':
      return `${n('fgm')}/${n('fga')} FG, ${n('xpm')} XP`;
    case 'DEF':
      return `${n('sack')} sck, ${n('int')} INT, ${n('pts_allow')} PA`;
    default:
      return '';
  }
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

function RangeBar({ floor, ceiling, proj, actual }) {
  const max = Math.max(ceiling, proj, actual || 0) * 1.15 || 1;
  const x = (v) => `${(v / max) * 100}%`;
  return (
    <div className="range">
      <div className="range-track">
        <div className="range-band" style={{ left: x(floor), width: `calc(${x(ceiling)} - ${x(floor)})` }} />
        <div className="range-mark proj" style={{ left: x(proj) }} title={`Projection ${proj.toFixed(1)}`} />
        {actual != null && <div className="range-mark actual" style={{ left: x(actual) }} title={`Actual ${actual.toFixed(1)}`} />}
      </div>
      <div className="range-labels">
        <span>Floor {floor.toFixed(1)}</span>
        <span className="range-key"><i className="k-proj" /> Proj{actual != null && <><i className="k-act" /> Actual</>}</span>
        <span>Ceiling {ceiling.toFixed(1)}</span>
      </div>
    </div>
  );
}

function TeamPanel({ abbr }) {
  const { api, teams, standings, core, ranks, gameByTeam, fmt, season } = useData();
  const rows = useProjectionRows(core?.week);
  const outlook = useTeamOutlook();
  const t = teams?.[abbr];
  const st = standings.find((s) => s.abbr === abbr);
  const o = outlook?.teams.find((x) => x.abbr === abbr);
  const g = gameByTeam[abbr];
  const [sched, setSched] = useState(null);

  useEffect(() => {
    setSched(null);
    (api?.getTeamSchedule || getTeamSchedule)(abbr).then(setSched).catch(() => setSched([]));
  }, [abbr]);

  const players = (rows || []).filter((r) => r.team === abbr && r.pos !== 'DEF').slice(0, 8);
  const leaders = useMemo(() => {
    const list = [...season.players.values()].filter((p) => p.team === abbr && p.pos !== 'DEF');
    const best = (fn) => list.reduce((a, p) => (fn(p) > (a ? fn(a) : 0) ? p : a), null);
    return [
      ['Passing', best((p) => p.tot.pass_yd || 0), (p) => `${f0(p.tot.pass_yd)} yds · ${f0(p.tot.pass_td)} TD`],
      ['Rushing', best((p) => p.tot.rush_yd || 0), (p) => `${f0(p.tot.rush_yd)} yds · ${f0(p.tot.rush_td)} TD`],
      ['Receiving', best((p) => p.tot.rec_yd || 0), (p) => `${f0(p.tot.rec_yd)} yds · ${f0(p.tot.rec)} rec`],
      ['Fantasy', best((p) => p.log.reduce((a, l) => a + pts(l.s, fmt), 0)), (p) => `${f1(p.log.reduce((a, l) => a + pts(l.s, fmt), 0))} pts`],
    ].filter(([, p]) => p);
  }, [season, abbr, fmt]);

  if (!t) return <div className="drawer-body"><Empty title="Team not found" /></div>;

  return (
    <>
      <div className="drawer-hero team" style={{ '--team': t.color, '--team2': t.alt }}>
        <TeamLogo abbr={abbr} size={84} />
        <div className="drawer-hero-text">
          <span className="eyebrow light">{st ? `${st.div}` : t.location}</span>
          <h2>{t.name}</h2>
          <span className="hero-meta">
            {st ? `${st.wins}-${st.losses}${st.ties ? `-${st.ties}` : ''} · ${st.diff > 0 ? '+' : ''}${st.diff} point diff · ${st.streak}` : ''}
            {st?.seed && st.seed <= 7 ? ` · #${st.seed} seed` : ''}
          </span>
        </div>
      </div>
      <div className="drawer-body">
        <div className="stat-grid">
          <Stat label="Proj points" value={o ? f1(o.projPts) : '—'} sub={o ? `vs ${o.opp} (${f1(o.oppPts)})` : 'Bye week'} accent />
          <Stat label="Win prob" value={o ? pct(o.winProb) : '—'} sub={o ? (o.margin > 0 ? `Fav by ${f1(o.margin)}` : `Dog by ${f1(-o.margin)}`) : ''} />
          <Stat label="Points / game" value={o ? f1(o.offPpg) : st ? f1(st.pf / Math.max(1, st.wins + st.losses + st.ties)) : '—'} sub="Scored" />
          <Stat label="Allowed / game" value={o ? f1(o.defPpg) : st ? f1(st.pa / Math.max(1, st.wins + st.losses + st.ties)) : '—'} sub="Against" />
        </div>

        {g && o && (
          <section className="panel-sec">
            <h3>Week {core.week} game</h3>
            <div className="matchup-box">
              <div className="mb-row">
                <span className="cell-opp"><span className="muted">{o.home ? 'vs' : '@'}</span> <TeamLogo abbr={o.opp} size={22} /> <strong>{teams[o.opp]?.name}</strong></span>
                <GameStatus g={g} />
              </div>
              {g.state !== 'pre' && (
                <div className="mb-score">
                  {g.away.abbr} {g.away.score} – {g.home.score} {g.home.abbr}
                </div>
              )}
              <WinProbBar home={g.home.abbr} away={g.away.abbr} pHome={o.home ? o.winProb : 1 - o.winProb} />
              <div className="mb-line muted">
                {kickoff(g.date, { long: true })} · {g.venue}{g.tv ? ` · ${g.tv}` : ''}
                {o.implied != null && ` · Implied total ${f1(o.implied)}, model ${f1(o.model)}`}
              </div>
            </div>
          </section>
        )}

        {players.length > 0 && (
          <section className="panel-sec">
            <h3>Fantasy projections</h3>
            <div className="plist dense">{players.map((r) => <PlayerLine key={r.id} r={r} showTags={false} />)}</div>
          </section>
        )}

        {ranks[abbr] && (
          <section className="panel-sec">
            <h3>Defense vs position</h3>
            <div className="dvp-row">
              {['QB', 'RB', 'WR', 'TE'].map((p) => {
                const m = ranks[abbr][p];
                if (!m) return null;
                const gr = grade(m.rank, m.of);
                return (
                  <div key={p} className={`dvp tone-${gr.tone}`} title={`Allows ${m.avg.toFixed(1)} pts/g to ${p}, ${ordinal(m.rank)} most`}>
                    <PosBadge pos={p} />
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
                <LeaderTile key={label} label={label} p={p} line={line(p)} />
              ))}
            </div>
          </section>
        )}

        <section className="panel-sec">
          <h3>Schedule</h3>
          {!sched ? (
            <SkeletonRows n={5} h={30} />
          ) : sched.length === 0 ? (
            <Empty title="Schedule unavailable" />
          ) : (
            <div className="sched">
              {sched.map((s) => (
                <div key={`${s.week}-${s.opp}`} className={`sched-row ${s.week === core?.week ? 'current' : ''}`}>
                  <span className="muted">Wk {s.week}</span>
                  <span className="cell-opp"><span className="muted">{s.home ? 'vs' : '@'}</span> <TeamLogo abbr={s.opp} size={16} /> {s.opp}</span>
                  {s.state === 'post' && s.us != null ? (
                    <span className={`result ${s.win ? 'w' : s.us === s.them ? 't' : 'l'}`}>
                      <b>{s.win ? 'W' : s.us === s.them ? 'T' : 'L'}</b> {s.us}-{s.them}
                    </span>
                  ) : s.state === 'in' ? (
                    <span className="status live"><span className="live-dot" /> {s.us}-{s.them}</span>
                  ) : (
                    <span className="muted">{new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function LeaderTile({ label, p, line }) {
  const { openPlayer } = useUi();
  return (
    <button type="button" className="leader-tile" onClick={() => openPlayer(p.id)}>
      <Avatar player={p} size={34} />
      <span>
        <small>{label}</small>
        <strong>{p.name}</strong>
        <span className="muted">{line}</span>
      </span>
    </button>
  );
}
