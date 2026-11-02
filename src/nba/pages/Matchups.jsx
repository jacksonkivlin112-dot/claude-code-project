import { useMemo, useState } from 'react';
import { useData } from '../../data.jsx';
import { grade } from '../../model.js';
import { Card, Empty, Segmented, TeamLogo, useUi } from '../../components/ui.jsx';
import { groupName } from '../model.js';

const GROUPS = ['G', 'F', 'C'];
const STATS = [
  { value: 'fp', label: 'Fantasy' },
  { value: 'pts', label: 'Points' },
  { value: 'reb', label: 'Rebounds' },
  { value: 'ast', label: 'Assists' },
  { value: 'tpm', label: 'Threes' },
];

export default function NbaMatchups() {
  const { ranks, gameByTeam, season } = useData();
  const { openTeam } = useUi();
  const [stat, setStat] = useState('fp');
  const [sortGrp, setSortGrp] = useState('G');
  const teams = useMemo(() => Object.keys(ranks).filter((t) => ranks[t][sortGrp]?.[stat]).sort((a, b) => ranks[a][sortGrp][stat].rank - ranks[b][sortGrp][stat].rank), [ranks, sortGrp, stat]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Defense vs. position · last 4 weeks</p>
          <h1>Matchup Heatmap</h1>
          <p className="hero-sub">What each defense allows per game to guards, forwards and centers. Green means a soft spot to target and red means a unit to avoid. Switch the stat to find the best spots for points, rebounds, assists or threes props.</p>
        </div>
        <Segmented options={STATS} value={stat} onChange={setStat} label="Stat" />
      </div>
      <Card pad={false}>
        {teams.length === 0 ? <Empty title={season.players.size ? 'Not enough games yet' : 'Loading…'} /> : (
          <div className="table-wrap">
            <table className="table heat">
              <thead>
                <tr>
                  <th>Defense</th>
                  <th className="hide-sm">Tonight</th>
                  {GROUPS.map((g) => (
                    <th key={g} className={`num sortable ${sortGrp === g ? 'sorted' : ''}`} onClick={() => setSortGrp(g)}>
                      vs {groupName(g)}<span className="sort-ind">{sortGrp === g ? '▼' : ''}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const g = gameByTeam[t];
                  const opp = g ? (g.home.abbr === t ? { abbr: g.away.abbr, home: true } : { abbr: g.home.abbr, home: false }) : null;
                  return (
                    <tr key={t} onClick={() => openTeam(t)}>
                      <td><span className="cell-opp"><TeamLogo abbr={t} size={20} /> <strong>{t}</strong></span></td>
                      <td className="hide-sm">{opp ? <span className="cell-opp"><span className="muted">{opp.home ? 'vs' : '@'}</span> <TeamLogo abbr={opp.abbr} size={16} /> {opp.abbr}</span> : <span className="muted">Off</span>}</td>
                      {GROUPS.map((grp) => {
                        const m = ranks[t][grp]?.[stat];
                        if (!m) return <td key={grp} className="num muted">—</td>;
                        const gr = grade(m.rank, m.of);
                        return (
                          <td key={grp} className={`num heat-cell tone-${gr.tone}`} title={`${t} allows ${m.avg.toFixed(1)} ${STATS.find((s) => s.value === stat).label.toLowerCase()}/g to ${groupName(grp)} · rank ${m.rank}/${m.of}`}>
                            <span className="heat-val">{m.avg.toFixed(1)}</span>
                            <span className="heat-rank">{m.rank}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="legend">
        <span>Most generous</span>
        {['great', 'good', 'neutral', 'bad', 'worst'].map((t) => <span key={t} className={`legend-sw tone-${t}`} />)}
        <span>Stingiest</span>
      </div>
    </div>
  );
}
