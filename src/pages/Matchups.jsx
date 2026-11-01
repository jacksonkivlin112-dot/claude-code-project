import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { grade } from '../model.js';
import { Card, Empty, TeamLogo, useUi } from '../components/ui.jsx';

const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export default function Matchups() {
  const { ranks, season, gameByTeam, core } = useData();
  const { openTeam } = useUi();
  const [sortPos, setSortPos] = useState('WR');

  const teams = useMemo(() => {
    const list = Object.keys(ranks).filter((t) => ranks[t][sortPos]);
    return list.sort((a, b) => ranks[a][sortPos].rank - ranks[b][sortPos].rank);
  }, [ranks, sortPos]);

  const opponentOf = (abbr) => {
    const g = gameByTeam[abbr];
    if (!g) return null;
    return g.home.abbr === abbr ? { opp: g.away.abbr, home: true } : { opp: g.home.abbr, home: false };
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Defense vs. position</p>
          <h1>Matchup Heatmap</h1>
          <p className="hero-sub">
            Average fantasy points each defense allows per game to each position. Green cells are soft spots to target and red cells are units to avoid. DEF shows what defenses score against that offense. Click a column to sort.
          </p>
        </div>
      </div>
      <Card pad={false}>
        {teams.length === 0 ? (
          <Empty title={season.players.size ? 'Not enough games yet' : 'Loading…'} />
        ) : (
          <div className="table-wrap">
            <table className="table heat">
              <thead>
                <tr>
                  <th>Defense</th>
                  <th className="hide-sm">Wk {core?.week} opponent</th>
                  {POS.map((p) => (
                    <th key={p} className={`num sortable ${sortPos === p ? 'sorted' : ''}`} onClick={() => setSortPos(p)}>
                      vs {p}<span className="sort-ind">{sortPos === p ? '▼' : ''}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const o = opponentOf(t);
                  return (
                    <tr key={t} onClick={() => openTeam(t)}>
                      <td>
                        <span className="cell-opp"><TeamLogo abbr={t} size={20} /> <strong>{t}</strong></span>
                      </td>
                      <td className="hide-sm">
                        {o ? <span className="cell-opp"><span className="muted">{o.home ? 'vs' : '@'}</span> <TeamLogo abbr={o.opp} size={16} /> {o.opp}</span> : <span className="muted">Bye</span>}
                      </td>
                      {POS.map((p) => {
                        const m = ranks[t][p];
                        if (!m) return <td key={p} className="num muted">—</td>;
                        const g = grade(m.rank, m.of);
                        return (
                          <td key={p} className={`num heat-cell tone-${g.tone}`} title={`${t} allows ${m.avg.toFixed(1)} pts/g to ${p} · rank ${m.rank}/${m.of} (1 = most)`}>
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
