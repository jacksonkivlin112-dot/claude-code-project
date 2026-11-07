// Pure ESPN response parsers, shared by the browser and the snapshot script
// (scripts/fetch-espn.mjs). Keep this file free of browser-only APIs.

export const ESPN_BASE = 'https://site.api.espn.com/apis';

// ESPN and Sleeper disagree on some abbreviations. Sleeper's are canonical here.
const ESPN_TO_SLEEPER = {
  nfl: { WSH: 'WAS' },
  nba: { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' },
};
export const normFor = (sport) => (abbr) => ESPN_TO_SLEEPER[sport]?.[abbr] || abbr;
export const normTeam = normFor('nfl');

export function parseTeams(data, normTeam = normFor('nfl')) {
  const out = {};
  for (const { team: t } of data.sports[0].leagues[0].teams) {
    const abbr = normTeam(t.abbreviation);
    out[abbr] = {
      espnId: t.id,
      abbr,
      name: t.displayName,
      short: t.shortDisplayName || t.name,
      location: t.location,
      color: t.color ? `#${t.color}` : '#64748b',
      alt: t.alternateColor ? `#${t.alternateColor}` : '#94a3b8',
      logo: t.logos?.[0]?.href || `https://a.espncdn.com/i/teamlogos/nfl/500/${t.abbreviation.toLowerCase()}.png`,
    };
  }
  return out;
}

export function parseStandings(data, normTeam = normFor('nfl')) {
  const rows = [];
  for (const conf of data.children || []) {
    for (const div of conf.children || []) {
      for (const e of div.standings.entries) {
        const stat = (n) => e.stats.find((s) => s.name === n || s.type === n);
        const num = (n) => Number(stat(n)?.value ?? 0);
        const disp = (n) => e.stats.find((s) => s.name === n)?.displayValue || '';
        rows.push({
          abbr: normTeam(e.team.abbreviation),
          conf: conf.abbreviation,
          div: div.name,
          wins: num('wins'),
          losses: num('losses'),
          ties: num('ties'),
          pct: num('winPercent'),
          pf: num('pointsFor'),
          pa: num('pointsAgainst'),
          diff: num('pointDifferential'),
          streak: stat('streak')?.displayValue || '',
          seed: num('playoffSeed') || null,
          home: disp('Home'),
          road: disp('Road'),
          divRec: disp('vs. Div.'),
          confRec: disp('vs. Conf.'),
          last10: disp('Last Ten Games'),
          ppg: Number(stat('avgPointsFor')?.value ?? 0) || null,
          oppg: Number(stat('avgPointsAgainst')?.value ?? 0) || null,
          gb: stat('gamesBehind')?.displayValue || '',
        });
      }
    }
  }
  return rows;
}

/** NBA standings have no division level by default: conferences hold entries directly. */
export function parseConferenceStandings(data, normTeam) {
  const shaped = {
    children: (data.children || []).map((conf) => ({
      ...conf,
      abbreviation: conf.abbreviation || (conf.name.startsWith('East') ? 'East' : 'West'),
      children: conf.children?.length ? conf.children : [{ name: conf.name, standings: conf.standings }],
    })),
  };
  return parseStandings(shaped, normTeam);
}

export function parseScoreboard(data, normTeam = normFor('nfl')) {
  return { week: data.week?.number, games: (data.events || []).map((e) => parseEvent(e, normTeam, data.week?.number)), byes: (data.week?.teamsOnBye || []).map((t) => normTeam(t.abbreviation)) };
}

/** Prefer national broadcasts; fall back to the first listed network. */
function broadcastNames(list = []) {
  const name = (b) => b.names || (b.media?.shortName ? [b.media.shortName] : []);
  const national = list.filter((b) => b.market === 'national' || b.market?.type === 'National');
  const names = [...new Set((national.length ? national : list.slice(0, 1)).flatMap(name))];
  return names.slice(0, 2).join(', ');
}

export function parseEvent(e, normTeam = normFor('nfl'), week) {
  {
    const c = e.competitions[0];
    const side = (homeAway) => {
      const x = c.competitors.find((k) => k.homeAway === homeAway);
      return {
        abbr: normTeam(x.team.abbreviation),
        score: x.score == null || x.score === '' ? null : typeof x.score === 'object' ? x.score.value ?? null : Number(x.score),
        record: (x.records || x.record)?.find?.((r) => r.type === 'total')?.summary || '',
        winner: !!x.winner,
        linescores: (x.linescores || []).map((l) => l.value),
      };
    };
    const st = c.status.type;
    const poss = c.situation?.possession;
    return {
      id: e.id,
      week: e.week?.number ?? week,
      date: e.date,
      state: st.state, // pre | in | post
      detail: st.shortDetail,
      completed: st.completed,
      home: side('home'),
      away: side('away'),
      neutral: !!c.neutralSite,
      venue: c.venue?.fullName || '',
      city: c.venue?.address ? [c.venue.address.city, c.venue.address.state].filter(Boolean).join(', ') : '',
      indoor: !!c.venue?.indoor,
      tv: broadcastNames(c.broadcasts),
      weather: e.weather ? { temp: e.weather.temperature, text: e.weather.conditionId } : null,
      possession: poss ? normTeam(c.competitors.find((k) => k.team?.id === poss || k.id === poss)?.team?.abbreviation) : null,
      downDistance: c.situation?.shortDownDistanceText || null,
      redZone: !!c.situation?.isRedZone,
      leaders: c.leaders?.length
        ? c.leaders.map((l) => ({ label: l.shortDisplayName, name: l.leaders?.[0]?.athlete?.shortName, line: l.leaders?.[0]?.displayValue }))
        : c.competitors.flatMap((k) => {
            const l = k.leaders?.find((x) => x.name === 'points') || k.leaders?.[0];
            const top = l?.leaders?.[0];
            return top ? [{ label: normTeam(k.team.abbreviation), name: top.athlete?.shortName, line: `${top.displayValue} ${l.shortDisplayName || ''}`.trim() }] : [];
          }),
      liveHomeWp: c.situation?.lastPlay?.probability?.homeWinPercentage ?? null,
      line: c.odds?.[0] ? { details: c.odds[0].details || null, overUnder: c.odds[0].overUnder ?? null, spread: c.odds[0].spread ?? null } : null,
      rank: { home: c.competitors.find((k) => k.homeAway === 'home')?.curatedRank?.current ?? null, away: c.competitors.find((k) => k.homeAway === 'away')?.curatedRank?.current ?? null },
    };
  }
}
