import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../data.jsx';
import { Avatar, Card, Delta, Empty, GradeChip, InjuryDot, PosBadge, Segmented, SkeletonRows, Sparkline, Tag, TeamLogo, f0, f1, useUi } from '../../components/ui.jsx';
import { DateNav, useNbaRows } from '../components.jsx';
import { groupName } from '../model.js';

const GROUPS = ['ALL', 'G', 'F', 'C'];
const PAGE = 60;

export default function NbaProjections() {
  const { openPlayer } = useUi();
  const rows = useNbaRows();
  const [grp, setGrp] = useState('ALL');
  const [team, setTeam] = useState('ALL');
  const [q, setQ] = useState('');
  const [hideOut, setHideOut] = useState(true);
  const [sort, setSort] = useState({ key: 'proj', dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef();

  useEffect(() => setLimit(PAGE), [grp, team, q, sort]);
  useEffect(() => {
    const on = (e) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const teams = useMemo(() => [...new Set((rows || []).map((r) => r.team))].sort(), [rows]);
  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    const get = {
      proj: (r) => r.proj, pts: (r) => r.s.pts || 0, reb: (r) => r.s.reb || 0, ast: (r) => r.s.ast || 0, tpm: (r) => r.s.tpm || 0,
      min: (r) => r.min || 0, avg: (r) => r.season.fpg, edge: (r) => r.edge ?? -99, grade: (r) => (r.matchup ? -r.matchup.rank : -99), actual: (r) => r.actual ?? -99, name: (r) => r.last,
    }[sort.key];
    return rows
      .filter((r) => (grp === 'ALL' || r.group === grp) && (team === 'ALL' || r.team === team) && (!hideOut || !['Out', 'IR', 'Sus', 'Doubtful'].includes(r.injury)) && (!needle || r.name.toLowerCase().includes(needle) || r.team.toLowerCase() === needle))
      .sort((a, b) => { const x = get(a); const y = get(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir; });
  }, [rows, grp, team, q, hideOut, sort]);
  const showActual = filtered.some((r) => r.actual != null);

  const Th = ({ k, children, className = '', title }) => (
    <th className={`sortable ${className} ${sort.key === k ? 'sorted' : ''}`} title={title} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : k === 'name' ? 1 : -1 }))}>
      {children}<span className="sort-ind">{sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Fantasy projections</p>
          <h1>NBA Projections</h1>
          <p className="hero-sub">Per-game projections with PrizePicks-style fantasy scoring (PTS + 1.2 REB + 1.5 AST + 3 STL + 3 BLK − TO). Matchup grades use what each defense has allowed to guards, forwards and centers over the last 4 weeks.</p>
        </div>
        <DateNav />
      </div>
      <div className="toolbar">
        <Segmented options={GROUPS.map((g) => ({ value: g, label: g === 'ALL' ? 'ALL' : g === 'G' ? 'Guards' : g === 'F' ? 'Forwards' : 'Centers' }))} value={grp} onChange={setGrp} label="Position group" />
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" aria-label="Search players" />
          <kbd>/</kbd>
        </div>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team filter">
          <option value="ALL">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} /> Hide inactive</label>
      </div>
      <Card pad={false}>
        {!rows ? <div className="card-body"><SkeletonRows n={10} /></div> : filtered.length === 0 ? <Empty title="No players match">Try another date or clear filters.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <Th k="name">Player</Th>
                  <Th k="grade" title="A+ = opponent allows the most fantasy points to this position group">Matchup</Th>
                  <Th k="min" className="num hide-sm">MIN</Th>
                  <Th k="pts" className="num">PTS</Th>
                  <Th k="reb" className="num">REB</Th>
                  <Th k="ast" className="num">AST</Th>
                  <Th k="tpm" className="num hide-sm">3PM</Th>
                  <th className="num hide-md">S/B</th>
                  <Th k="avg" className="num hide-sm">Avg</Th>
                  <th className="hide-md">Last 8</th>
                  <Th k="edge" className="num hide-sm">Edge</Th>
                  {showActual && <Th k="actual" className="num">Actual</Th>}
                  <Th k="proj" className="num">FPTS</Th>
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
                          <div className="cell-name">{r.name}<InjuryDot status={r.injury} part={r.injuryPart} /></div>
                          <div className="cell-meta">
                            <PosBadge pos={r.pos} /> <TeamLogo abbr={r.team} size={13} /> {r.team}
                            {r.tags.filter((t) => t.k !== 'inj').slice(0, 1).map((t) => <Tag key={t.k} tag={t} />)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><div className="cell-match"><GradeChip grade={r.grade} matchup={r.matchup} pos={groupName(r.group)} /><span className="muted">{r.opp}</span></div></td>
                    <td className="num hide-sm">{f0(r.min)}</td>
                    <td className="num">{f1(r.s.pts)}</td>
                    <td className="num">{f1(r.s.reb)}</td>
                    <td className="num">{f1(r.s.ast)}</td>
                    <td className="num hide-sm">{f1(r.s.tpm)}</td>
                    <td className="num hide-md">{f1(r.s.stl)}/{f1(r.s.blk)}</td>
                    <td className="num hide-sm">{r.season.gp ? f1(r.season.fpg) : '—'}</td>
                    <td className="hide-md"><Sparkline values={r.season.log.slice(-8).map((l) => l.fp)} /></td>
                    <td className="num hide-sm"><Delta value={r.edge} /></td>
                    {showActual && <td className="num">{r.actual != null ? <span className={r.actual >= r.proj ? 'pos-txt' : 'neg-txt'}>{f1(r.actual)}</span> : <span className="muted">—</span>}</td>}
                    <td className="num"><span className="proj-val">{f1(r.proj)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit && <button type="button" className="more-btn" onClick={() => setLimit((l) => l + PAGE)}>Show more · {filtered.length - limit} remaining</button>}
      </Card>
    </div>
  );
}
