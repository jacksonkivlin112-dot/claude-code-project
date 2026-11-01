import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { useProjectionRows } from '../components/players.jsx';
import { Avatar, Card, Delta, Empty, GradeChip, InjuryDot, PosBadge, Segmented, SkeletonRows, Sparkline, Tag, TeamLogo, f0, f1, useUi } from '../components/ui.jsx';

const POS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const PAGE = 50;

export function statLine(pos, s) {
  const n = (k, d = 0) => (s[k] || 0).toFixed(d);
  switch (pos) {
    case 'QB':
      return `${n('pass_yd')} pass yds · ${n('pass_td', 1)} TD · ${n('pass_int', 1)} INT · ${n('rush_yd')} rush`;
    case 'RB':
      return `${n('rush_att', 1)} car · ${n('rush_yd')} yds · ${n('rec', 1)} rec · ${n('rec_yd')} rec yds · ${((s.rush_td || 0) + (s.rec_td || 0)).toFixed(1)} TD`;
    case 'WR':
    case 'TE':
      return `${n('rec_tgt', 1)} tgt · ${n('rec', 1)} rec · ${n('rec_yd')} yds · ${n('rec_td', 1)} TD`;
    case 'K':
      return `${n('fgm', 1)}/${n('fga', 1)} FG · ${n('xpm', 1)} XP`;
    case 'DEF':
      return `${n('sack', 1)} sck · ${n('int', 1)} INT · ${n('pts_allow', 1)} PA`;
    default:
      return '';
  }
}

export default function Projections({ params }) {
  const { core, proj, loadProjections } = useData();
  const { openPlayer } = useUi();
  const [week, setWeek] = useState(core?.week);
  const [pos, setPos] = useState(params.get('pos') || 'ALL');
  const [team, setTeam] = useState('ALL');
  const [q, setQ] = useState('');
  const [hideOut, setHideOut] = useState(true);
  const [sort, setSort] = useState({ key: 'proj', dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef();

  useEffect(() => { if (core && week == null) setWeek(core.week); }, [core, week]);
  useEffect(() => { if (week) loadProjections(week); }, [week, loadProjections]);
  useEffect(() => setLimit(PAGE), [pos, team, q, week, sort]);
  useEffect(() => { const p = params.get('pos'); if (p) setPos(p); }, [params]);

  // Press "/" to jump to search.
  useEffect(() => {
    const on = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const rows = useProjectionRows(week);
  const teams = useMemo(() => [...new Set((rows || []).map((r) => r.team))].sort(), [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (pos === 'ALL' || r.pos === pos) &&
        (team === 'ALL' || r.team === team) &&
        (!hideOut || !['Out', 'IR', 'PUP', 'Sus'].includes(r.injury)) &&
        (!needle || r.name.toLowerCase().includes(needle) || r.team.toLowerCase() === needle),
    );
    const get = {
      proj: (r) => r.proj,
      outlook: (r) => r.outlook,
      ppg: (r) => r.season.ppg,
      edge: (r) => r.edge ?? -99,
      grade: (r) => (r.matchup ? -r.matchup.rank : -99),
      name: (r) => r.last,
      actual: (r) => r.actual ?? -99,
    }[sort.key];
    return [...list].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
    });
  }, [rows, pos, team, q, hideOut, sort]);

  const isCurrent = core && week === core.week;
  const showActual = isCurrent && filtered.some((r) => r.actual != null);

  const Th = ({ k, children, className = '', title }) => (
    <th className={`sortable ${className} ${sort.key === k ? 'sorted' : ''}`} title={title} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : k === 'name' ? 1 : -1 }))} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      {children}
      <span className="sort-ind">{sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Fantasy projections</p>
          <h1>Week {week} Projections</h1>
          <p className="hero-sub">Updated continuously through the week. Matchup grades use fantasy points allowed by each defense to the position this season.</p>
        </div>
        {core && core.week < 18 && (
          <Segmented
            label="Week"
            value={week}
            onChange={setWeek}
            options={[{ value: core.week, label: `Week ${core.week}` }, { value: core.week + 1, label: `Week ${core.week + 1}` }]}
          />
        )}
      </div>

      <div className="toolbar">
        <Segmented options={POS} value={pos} onChange={setPos} label="Position" />
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" aria-label="Search players" />
          <kbd>/</kbd>
        </div>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team filter">
          <option value="ALL">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} /> Hide inactive
        </label>
      </div>

      <Card pad={false}>
        {!rows ? (
          <div className="card-body"><SkeletonRows n={10} /></div>
        ) : filtered.length === 0 ? (
          <Empty title="No players match">Try a different position or clear your search.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <Th k="name">Player</Th>
                  <Th k="grade" title="Matchup grade: A+ = opponent allows the most points to this position">Matchup</Th>
                  <th className="hide-sm">Projected line</th>
                  <Th k="ppg" className="num hide-sm">Avg</Th>
                  <th className="hide-md">Trend</th>
                  <Th k="edge" className="num hide-sm" title="Projection minus season average">Edge</Th>
                  {showActual && <Th k="actual" className="num">Actual</Th>}
                  <Th k="proj" className="num">Proj</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r, i) => (
                  <tr key={r.id} onClick={() => openPlayer(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openPlayer(r.id)}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <div className="cell-player">
                        <Avatar player={r} size={34} />
                        <div>
                          <div className="cell-name">
                            {r.name}
                            <InjuryDot status={r.injury} part={r.injuryPart} />
                          </div>
                          <div className="cell-meta">
                            <PosBadge pos={r.pos} /> <TeamLogo abbr={r.team} size={13} /> {r.team}
                            <span className="muted">· {r.pos}{r.posRank}</span>
                            {r.tags.filter((t) => t.k !== 'inj').slice(0, 1).map((t) => <Tag key={t.k} tag={t} />)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="cell-match">
                        <GradeChip grade={r.grade} matchup={r.matchup} pos={r.pos} />
                        <span className="muted">{r.opp}</span>
                      </div>
                    </td>
                    <td className="hide-sm statline">{statLine(r.pos, r.s)}</td>
                    <td className="num hide-sm">{r.season.games ? f1(r.season.ppg) : '—'}</td>
                    <td className="hide-md"><Sparkline values={r.season.weekly.slice(-6).map((w) => w.pts)} /></td>
                    <td className="num hide-sm"><Delta value={r.edge} /></td>
                    {showActual && (
                      <td className="num">
                        {r.actual != null ? <span className={r.actual >= r.proj ? 'pos-txt' : 'neg-txt'}>{f1(r.actual)}</span> : <span className="muted">—</span>}
                      </td>
                    )}
                    <td className="num"><span className="proj-val">{f1(r.proj)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit && (
          <button type="button" className="more-btn" onClick={() => setLimit((l) => l + PAGE)}>
            Show more · {f0(filtered.length - limit)} remaining
          </button>
        )}
      </Card>
      {!proj[week] && week !== core?.week && <p className="muted center">Loading Week {week} projections…</p>}
    </div>
  );
}
