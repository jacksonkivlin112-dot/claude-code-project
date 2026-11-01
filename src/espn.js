// Pure ESPN response parsers, shared by the browser and the snapshot script
// (scripts/fetch-espn.mjs). Keep this file free of browser-only APIs.

export const ESPN_BASE = 'https://site.api.espn.com/apis';

// ESPN and Sleeper disagree on one abbreviation. Sleeper's is canonical here.
const ESPN_TO_SLEEPER = { WSH: 'WAS' };
export const normTeam = (abbr) => ESPN_TO_SLEEPER[abbr] || abbr;

export function parseTeams(data) {
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

export function parseStandings(data) {
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
        });
      }
    }
  }
  return rows;
}

export function parseScoreboard(data) {
  const week = data.week?.number;
  const games = (data.events || []).map((e) => {
    const c = e.competitions[0];
    const side = (homeAway) => {
      const x = c.competitors.find((k) => k.homeAway === homeAway);
      return {
        abbr: normTeam(x.team.abbreviation),
        score: x.score != null && x.score !== '' ? Number(x.score) : null,
        record: x.records?.find((r) => r.type === 'total')?.summary || '',
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
      tv: (c.broadcasts || []).flatMap((b) => b.names).join(', '),
      weather: e.weather ? { temp: e.weather.temperature, text: e.weather.conditionId } : null,
      possession: poss ? normTeam(c.competitors.find((k) => k.team?.id === poss || k.id === poss)?.team?.abbreviation) : null,
      downDistance: c.situation?.shortDownDistanceText || null,
      redZone: !!c.situation?.isRedZone,
      leaders: (c.leaders || []).map((l) => ({
        label: l.shortDisplayName,
        name: l.leaders?.[0]?.athlete?.shortName,
        line: l.leaders?.[0]?.displayValue,
      })),
    };
  });
  const byes = (data.week?.teamsOnBye || []).map((t) => normTeam(t.abbreviation));
  return { week, games, byes };
}
