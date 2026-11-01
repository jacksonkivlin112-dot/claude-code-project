import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { playerSummary } from '../model.js';
import { Avatar, Card, Empty, InjuryDot, Segmented, SkeletonRows, Sparkline, TeamLogo, f0, f1, useUi } from '../components/ui.jsx';

const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const div = (a, b) => (b ? a / b : null);
const pctf = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

// Column definitions per position: [label, getter(tot, games), formatter, title]
const COLS = {
  QB: [
    ['Cmp/Att', (t) => `${f0(t.pass_cmp)}/${f0(t.pass_att)}`, null, 'Completions / attempts'],
    ['Cmp%', (t) => div(t.pass_cmp, t.pass_att), pctf],
    ['Yds', (t) => t.pass_yd || 0, f0, 'Passing yards'],
    ['TD', (t) => t.pass_td || 0, f0, 'Passing touchdowns'],
    ['INT', (t) => t.pass_int || 0, f0],
    ['Y/G', (t, g) => div(t.pass_yd || 0, g), f1, 'Passing yards per game'],
    ['Rush', (t) => t.rush_yd || 0, f0, 'Rushing yards'],
    ['RTD', (t) => t.rush_td || 0, f0, 'Rushing touchdowns'],
  ],
  RB: [
    ['Car', (t) => t.rush_att || 0, f0, 'Carries'],
    ['Yds', (t) => t.rush_yd || 0, f0, 'Rushing yards'],
    ['YPC', (t) => div(t.rush_yd || 0, t.rush_att), f1, 'Yards per carry'],
    ['TD', (t) => t.rush_td || 0, f0, 'Rushing touchdowns'],
    ['Tgt', (t) => t.rec_tgt || 0, f0, 'Targets'],
    ['Rec', (t) => t.rec || 0, f0],
    ['RecYd', (t) => t.rec_yd || 0, f0, 'Receiving yards'],
    ['Snap%', (t) => div(t.off_snp, t.tm_off_snp), pctf, 'Share of team offensive snaps'],
  ],
  WR: [
    ['Tgt', (t) => t.rec_tgt || 0, f0, 'Targets'],
    ['Rec', (t) => t.rec || 0, f0],
    ['Catch%', (t) => div(t.rec, t.rec_tgt), pctf, 'Catch rate'],
    ['Yds', (t) => t.rec_yd || 0, f0, 'Receiving yards'],
    ['Y/R', (t) => div(t.rec_yd || 0, t.rec), f1, 'Yards per reception'],
    ['TD', (t) => t.rec_td || 0, f0],
    ['Y/G', (t, g) => div(t.rec_yd || 0, g), f1, 'Receiving yards per game'],
    ['Snap%', (t) => div(t.off_snp, t.tm_off_snp), pctf, 'Share of team offensive snaps'],
  ],
  K: [
    ['FG', (t) => `${f0(t.fgm)}/${f0(t.fga)}`, null, 'Field goals made / attempted'],
    ['FG%', (t) => div(t.fgm, t.fga), pctf],
    ['XP', (t) => t.xpm || 0, f0, 'Extra points made'],
  ],
  DEF: [
    ['Sacks', (t) => t.sack || 0, f0],
    ['INT', (t) => t.int || 0, f0],
    ['FR', (t) => t.fum_rec || 0, f0, 'Fumble recoveries'],
    ['TD', (t) => t.def_td || 0, f0, 'Defensive touchdowns'],
    ['PA/G', (t, g) => div(t.pts_allow || 0, g), f1, 'Points allowed per game'],
  ],
};
COLS.TE = COLS.WR;

export default function Stats() {
  const { season, fmt, core } = useData();
  const { openPlayer } = useUi();
  const [pos, setPos] = useState('WR');
  const [sort, setSort] = useState({ i: 'pts', dir: -1 });
  const [minGames, setMinGames] = useState('2');
  const cols = COLS[pos];

  const list = useMemo(() => {
    const out = [];
    for (const p of season.players.values()) {
      if (p.pos !== pos || p.games < Number(minGames)) continue;
      const sum = playerSummary(p, fmt);
      const total = sum.weekly.reduce((a, w) => a + w.pts, 0);
      out.push({ p, sum, total, vals: cols.map(([, get]) => get(p.tot, p.games)) });
    }
    const key = (r) => (sort.i === 'pts' ? r.total : sort.i === 'ppg' ? r.sum.ppg : sort.i === 'gp' ? r.p.games : typeof r.vals[sort.i] === 'number' ? r.vals[sort.i] : parseFloat(r.vals[sort.i]) || 0);
    return out.sort((a, b) => (key(a) - key(b)) * sort.dir).slice(0, 100);
  }, [season, pos, fmt, cols, sort, minGames]);

  const clickSort = (i) => setSort((s) => ({ i, dir: s.i === i ? -s.dir : -1 }));
  const H = ({ i, children, title }) => (
    <th className={`num sortable ${sort.i === i ? 'sorted' : ''}`} onClick={() => clickSort(i)} title={title}>
      {children}<span className="sort-ind">{sort.i === i ? (sort.dir > 0 ? '▲' : '▼') : ''}</span>
    </th>
  );

  const weeksDone = core ? core.week - 1 : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Season to date</p>
          <h1>{core?.season} Stat Leaders</h1>
          <p className="hero-sub">
            Through Week {weeksDone}{core ? ', plus finished Week ' + core.week + ' games' : ''}. New games are added automatically each week.
          </p>
        </div>
      </div>
      <div className="toolbar">
        <Segmented options={POS} value={pos} onChange={(p) => { setPos(p); setSort({ i: 'pts', dir: -1 }); }} label="Position" />
        <label className="select-label">
          Min games
          <select value={minGames} onChange={(e) => setMinGames(e.target.value)}>
            {['1', '2', '3', '4', '5'].map((n) => <option key={n} value={n}>{n}+</option>)}
          </select>
        </label>
      </div>
      <Card pad={false}>
        {season.players.size === 0 ? (
          <div className="card-body"><SkeletonRows n={10} /></div>
        ) : list.length === 0 ? (
          <Empty title="No qualifying players" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Player</th>
                  <H i="gp">GP</H>
                  {cols.map(([label, , , title], i) => <H key={label} i={i} title={title}>{label}</H>)}
                  <th className="hide-md">Last 6</th>
                  <H i="ppg" title="Fantasy points per game">FPPG</H>
                  <H i="pts" title="Total fantasy points">FPTS</H>
                </tr>
              </thead>
              <tbody>
                {list.map((r, idx) => (
                  <tr key={r.p.id} onClick={() => openPlayer(r.p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openPlayer(r.p.id)}>
                    <td className="num muted">{idx + 1}</td>
                    <td>
                      <div className="cell-player">
                        <Avatar player={r.p} size={32} />
                        <div>
                          <div className="cell-name">{r.p.name}<InjuryDot status={r.p.injury} part={r.p.injuryPart} /></div>
                          <div className="cell-meta"><TeamLogo abbr={r.p.team} size={13} /> {r.p.team}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{r.p.games}</td>
                    {cols.map(([label, , fmtFn], i) => (
                      <td key={label} className="num">{fmtFn ? fmtFn(r.vals[i]) : r.vals[i]}</td>
                    ))}
                    <td className="hide-md"><Sparkline values={r.sum.weekly.slice(-6).map((w) => w.pts)} /></td>
                    <td className="num">{f1(r.sum.ppg)}</td>
                    <td className="num"><span className="proj-val">{f1(r.total)}</span></td>
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
