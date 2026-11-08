import { useMemo } from 'react';
import { useData } from '../../data.jsx';
import { MARKETS_NBA } from '../../oddsapi.js';
import { PropsPage } from '../../pages/Props.jsx';
import { DateNav, useNbaOutlook, useNbaRows } from '../components.jsx';
import { NBA_ALIASES, buildNbaLookups, evaluateNbaProp, parseManualNba } from '../props.js';
import { useLineCalibration } from '../../lineCal.js';

const ALL = Object.keys(MARKETS_NBA);

export const NBA_CFG = {
  sport: 'nba',
  markets: MARKETS_NBA,
  evaluate: evaluateNbaProp,
  parseManual: parseManualNba,
  groups: ['G', 'F', 'C'],
  groupOf: (r) => r.group,
  groupLabel: (g) => ({ G: 'Guards', F: 'Forwards', C: 'Centers' })[g],
  boardMinProj: 5,
  safeMinProj: 15,
  period: 'slate',
  title: 'NBA Player Props · Over / Under',
  example: 'Nikola Jokic, Points, 27.5\nVictor Wembanyama Rebounds 11.5\nTyrese Maxey, PRA, 35.5',
  searchHint: 'Search any player or team (e.g. Jokic, Wemby, LAL)',
  keyMarkets: {
    G: ['player_points', 'player_assists', 'player_threes', 'player_points_rebounds_assists'],
    F: ['player_points', 'player_rebounds', 'player_points_rebounds_assists'],
    C: ['player_points', 'player_rebounds', 'player_points_rebounds_assists'],
  },
  safeMarkets: {
    G: ['player_points', 'player_assists', 'player_points_assists', 'player_points_rebounds_assists', 'player_threes'],
    F: ['player_points', 'player_rebounds', 'player_points_rebounds', 'player_points_rebounds_assists'],
    C: ['player_points', 'player_rebounds', 'player_points_rebounds', 'player_rebounds_assists', 'player_points_rebounds_assists'],
  },
  minLine: {
    player_points: 9.5, player_rebounds: 3.5, player_assists: 2.5, player_threes: 1.5, player_points_rebounds_assists: 14.5,
    player_points_rebounds: 11.5, player_points_assists: 11.5, player_rebounds_assists: 5.5,
  },
  marketsFor: () => ALL,
  HeaderExtra: DateNav,
  aliases: NBA_ALIASES,
};

export function useNbaContext() {
  const { season, dvp, b2b, liveById, gameByTeam, teams, allGames } = useData();
  const rows = useNbaRows();
  const outlook = useNbaOutlook();
  const lineCal = useLineCalibration('nba');
  const ctx = useMemo(() => {
    if (!rows || !outlook) return null;
    return {
      lookups: buildNbaLookups(rows, season, teams),
      season,
      dvp,
      b2b,
      outlookByTeam: Object.fromEntries(outlook.teams.map((t) => [t.abbr, t])),
      leagueAvg: outlook.leagueAvg,
      liveById,
      gameByTeam,
      lineCal,
      allGames,
    };
  }, [rows, outlook, season, dvp, b2b, liveById, gameByTeam, teams, lineCal, allGames]);
  return { ctx, rows };
}

export default function NbaProps() {
  return <PropsPage cfg={NBA_CFG} useSportContext={useNbaContext} />;
}
