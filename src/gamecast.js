// Parses ESPN's game summary into what Game Center renders.
import { normTeam } from './espn.js';

const num = (v) => (v == null || v === '' ? null : Number(v));

export function parseSummary(d) {
  const comp = d.header?.competitions?.[0] || {};
  const byId = {};
  const side = (homeAway) => {
    const c = (comp.competitors || []).find((x) => x.homeAway === homeAway) || {};
    const t = c.team || {};
    const abbr = normTeam(t.abbreviation);
    byId[t.id] = abbr;
    return {
      id: t.id,
      abbr,
      name: t.displayName,
      short: t.name || t.shortDisplayName,
      color: t.color ? `#${t.color}` : null,
      alt: t.alternateColor ? `#${t.alternateColor}` : null,
      logo: t.logos?.[0]?.href,
      score: num(c.score),
      record: c.record?.find?.((r) => r.type === 'total')?.summary || c.record?.[0]?.summary || '',
      winner: !!c.winner,
      linescores: (c.linescores || []).map((l) => num(l.displayValue ?? l.value)),
      possession: !!c.possession,
      timeouts: c.timeoutsRemaining ?? null,
    };
  };
  const home = side('home');
  const away = side('away');
  const st = comp.status?.type || {};

  const parsePlay = (p) => ({
    id: p.id,
    text: (p.text || '').trim(),
    type: p.type?.text || '',
    typeAbbr: p.type?.abbreviation || '',
    period: p.period?.number,
    clock: p.clock?.displayValue,
    start: p.start ? { ...p.start, team: byId[p.start.team?.id] } : null,
    end: p.end ? { ...p.end, team: byId[p.end.team?.id] } : null,
    yards: p.statYardage ?? null,
    scoring: !!p.scoringPlay,
    scoreValue: p.scoreValue || 0,
    turnover: !!p.isTurnover,
    penalty: !!p.isPenalty,
    awayScore: p.awayScore,
    homeScore: p.homeScore,
    wallclock: p.wallclock,
  });

  const parseDrive = (dr, isCurrent = false) => ({
    id: dr.id,
    team: normTeam(dr.team?.abbreviation),
    description: dr.description,
    result: dr.displayResult || dr.result || (isCurrent ? 'In progress' : ''),
    isScore: !!dr.isScore,
    yards: dr.yards,
    plays: (dr.plays || []).map(parsePlay),
    start: dr.start?.text,
    startPeriod: dr.start?.period?.number,
    startClock: dr.start?.clock?.displayValue,
    elapsed: dr.timeElapsed?.displayValue,
    isCurrent,
  });

  const drives = (d.drives?.previous || []).map((x) => parseDrive(x));
  if (d.drives?.current && !drives.some((x) => x.id === d.drives.current.id)) drives.push(parseDrive(d.drives.current, true));
  else if (d.drives?.current) {
    const i = drives.findIndex((x) => x.id === d.drives.current.id);
    drives[i] = parseDrive(d.drives.current, st.state === 'in');
  }

  const allPlays = drives.flatMap((x) => x.plays);
  const periodByPlay = Object.fromEntries(allPlays.map((p) => [p.id, p.period]));
  const winprob = (d.winprobability || []).map((w) => ({ home: w.homeWinPercentage, playId: w.playId, period: periodByPlay[w.playId] }));

  const teamStats = (d.boxscore?.teams || []).map((t) => ({
    abbr: normTeam(t.team?.abbreviation),
    stats: (t.statistics || []).map((s) => ({ key: s.name, label: s.label, value: s.displayValue })),
  }));
  const players = (d.boxscore?.players || []).map((t) => ({
    abbr: normTeam(t.team?.abbreviation),
    groups: (t.statistics || []).map((g) => ({
      name: g.name,
      title: g.text || g.name,
      labels: g.labels || [],
      totals: g.totals || [],
      athletes: (g.athletes || []).map((a) => ({ id: a.athlete?.id, name: a.athlete?.displayName, short: a.athlete?.shortName, jersey: a.athlete?.jersey, headshot: a.athlete?.headshot?.href, stats: a.stats || [] })),
    })),
  }));

  const pc = d.pickcenter?.[0];
  const venue = d.gameInfo?.venue;
  return {
    id: comp.id,
    date: comp.date,
    state: st.state,
    detail: st.detail,
    shortDetail: st.shortDetail,
    completed: !!st.completed,
    home,
    away,
    drives,
    lastPlay: allPlays[allPlays.length - 1] || null,
    winprob,
    scoring: (d.scoringPlays || []).map((p) => ({ ...parsePlay(p), team: normTeam(p.team?.abbreviation) })),
    teamStats,
    players,
    venue: venue ? { name: venue.fullName, city: [venue.address?.city, venue.address?.state].filter(Boolean).join(', '), grass: venue.grass } : null,
    attendance: d.gameInfo?.attendance || null,
    weather: d.gameInfo?.weather ? { temp: d.gameInfo.weather.temperature, text: d.gameInfo.weather.conditionId || d.gameInfo.weather.displayValue } : null,
    tv: [...new Set((comp.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean))].join(', '),
    line: pc ? { details: pc.details, overUnder: pc.overUnder, provider: pc.provider?.name } : null,
    leaders: (d.leaders || []).map((t) => ({
      abbr: normTeam(t.team?.abbreviation),
      items: (t.leaders || []).map((l) => ({ label: l.displayName, name: l.leaders?.[0]?.athlete?.displayName, headshot: l.leaders?.[0]?.athlete?.headshot?.href, value: l.leaders?.[0]?.displayValue })),
    })),
  };
}
