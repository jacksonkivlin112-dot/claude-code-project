import { useMemo } from 'react';
import { useData } from '../data.jsx';
import { buildProjectionRows, buildTeamOutlook } from '../model.js';
import { Avatar, GradeChip, InjuryDot, PosBadge, Tag, TeamLogo, f1, useUi } from './ui.jsx';

export function useProjectionRows(week) {
  const { proj, season, ranks, fmt, liveById, core } = useData();
  const rows = proj?.[week];
  return useMemo(() => {
    if (!rows) return null;
    const actual = core && week === core.week ? liveById : null;
    return buildProjectionRows(rows, season, ranks, fmt, actual);
  }, [rows, season, ranks, fmt, liveById, core, week]);
}

export function useTeamOutlook() {
  const { board, standings, proj, core, fmt } = useData();
  const rows = core ? proj[core.week] : null;
  return useMemo(() => {
    if (!rows) return null;
    return buildTeamOutlook(board.games, standings, rows, fmt);
  }, [board, standings, rows, fmt]);
}

/** Compact player line used in dashboard lists. */
export function PlayerLine({ r, rank, metric = 'proj', showTags = true }) {
  const { openPlayer } = useUi();
  const { gameByTeam } = useData();
  const g = gameByTeam[r.team];
  const home = g ? g.home.abbr === r.team : null;
  return (
    <button type="button" className="pline" onClick={() => openPlayer(r.id)}>
      {rank != null && <span className="pline-rank">{rank}</span>}
      <Avatar player={r} size={38} />
      <span className="pline-main">
        <span className="pline-name">
          {r.name}
          <InjuryDot status={r.injury} part={r.injuryPart} />
        </span>
        <span className="pline-meta">
          <PosBadge pos={r.pos} />
          <TeamLogo abbr={r.team} size={14} />
          <span>{r.team}</span>
          <span className="vs">{home === false ? '@' : 'vs'}</span>
          <span>{r.opp}</span>
          {r.matchup && <GradeChip grade={r.grade} matchup={r.matchup} pos={r.pos} />}
        </span>
        {showTags && r.tags.filter((t) => t.k !== 'inj').length > 0 && (
          <span className="pline-tags">{r.tags.filter((t) => t.k !== 'inj').slice(0, 2).map((t) => <Tag key={t.k} tag={t} />)}</span>
        )}
      </span>
      <span className="pline-num">
        <strong>{f1(metric === 'outlook' ? r.outlook : r.proj)}</strong>
        <small>{r.actual != null ? <span className={r.actual >= r.proj ? 'pos-txt' : 'neg-txt'}>{f1(r.actual)} act</span> : `${r.pos}${r.posRank}`}</small>
      </span>
    </button>
  );
}
