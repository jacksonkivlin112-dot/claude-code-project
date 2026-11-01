import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { Avatar, Card, Empty, InjuryDot, PosBadge, Segmented, SkeletonRows, Sparkline, TeamLogo, f1, useUi } from '../../components/ui.jsx';

const pctOf = (m, a) => (a ? (m / a) * 100 : null);
const COLS = [
  ['gp', 'GP', (p) => p.gp, (v) => v],
  ['min', 'MIN', (p) => p.avg.min, f1],
  ['pts', 'PTS', (p) => p.avg.pts, f1],
  ['reb', 'REB', (p) => p.avg.reb, f1],
  ['ast', 'AST', (p) => p.avg.ast, f1],
  ['stl', 'STL', (p) => p.avg.stl, f1],
  ['blk', 'BLK', (p) => p.avg.blk, f1],
  ['tpm', '3PM', (p) => p.avg.tpm, f1],
  ['fg', 'FG%', (p) => pctOf(p.tot.fgm, p.tot.fga), f1, 'hide-sm'],
  ['tp', '3P%', (p) => pctOf(p.tot.tpm, p.tot.tpa), f1, 'hide-md'],
  ['ft', 'FT%', (p) => pctOf(p.tot.ftm, p.tot.fta), f1, 'hide-md'],
  ['to', 'TO', (p) => p.avg.to, f1, 'hide-sm'],
];

export default function NbaStats() {
  const { season, core } = useData();
  const { openPlayer } = useUi();
  const [grp, setGrp] = useState('ALL');
  const [sort, setSort] = useState({ key: 'fpg', dir: -1 });
  const [minGp, setMinGp] = useState('3');

  const list = useMemo(() => {
    const out = [...season.players.values()].filter((p) => p.gp >= Number(minGp) && (grp === 'ALL' || p.group === grp));
    const col = COLS.find((c) => c[0] === sort.key);
    const get = sort.key === 'fpg' ? (p) => p.fpg || 0 : (p) => col[2](p) ?? -1;
    return out.sort((a, b) => (get(a) - get(b)) * sort.dir).slice(0, 150);
  }, [season, grp, sort, minGp]);

  const H = ({ k, children, className = '' }) => (
    <th className={`num sortable ${className} ${sort.key === k ? 'sorted' : ''}`} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}>
      {children}<span className="sort-ind">{sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Season to date</p>
          <h1>{core?.label} Per-Game Leaders</h1>
          <p className="hero-sub">Per-game averages for the full season, updated after every game. The trend line covers the last 10 games.</p>
        </div>
      </div>
      <div className="toolbar">
        <Segmented options={[{ value: 'ALL', label: 'All' }, { value: 'G', label: 'Guards' }, { value: 'F', label: 'Forwards' }, { value: 'C', label: 'Centers' }]} value={grp} onChange={setGrp} label="Position group" />
        <label className="select-label">Min games
          <select value={minGp} onChange={(e) => setMinGp(e.target.value)}>{['1', '3', '5', '10', '20'].map((n) => <option key={n} value={n}>{n}+</option>)}</select>
        </label>
      </div>
      <Card pad={false}>
        {season.players.size === 0 ? <div className="card-body"><SkeletonRows n={10} /></div> : list.length === 0 ? <Empty title="No qualifying players" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th><th>Player</th>
                  {COLS.map(([k, label, , , cls]) => <H key={k} k={k} className={cls}>{label}</H>)}
                  <th className="hide-md">Trend</th>
                  <H k="fpg">FPTS/G</H>
                </tr>
              </thead>
              <tbody>
                {list.map((p, i) => (
                  <tr key={p.id} onClick={() => openPlayer(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openPlayer(p.id)}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <div className="cell-player">
                        <Avatar player={p} size={32} />
                        <div>
                          <div className="cell-name">{p.name}<InjuryDot status={p.injury} part={p.injuryPart} /></div>
                          <div className="cell-meta"><PosBadge pos={p.pos} /> <TeamLogo abbr={p.team} size={13} /> {p.team}</div>
                        </div>
                      </div>
                    </td>
                    {COLS.map(([k, , get, fmt, cls]) => { const v = get(p); return <td key={k} className={`num ${cls || ''}`}>{v == null ? '—' : fmt(v)}</td>; })}
                    <td className="hide-md"><Sparkline values={p.log.slice(-10).map((l) => l.fp)} /></td>
                    <td className="num"><span className="proj-val">{f1(p.fpg)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
