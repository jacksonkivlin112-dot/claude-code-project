// Parses ESPN's NBA game summary for the NBA Game Center.
import { normFor } from '../espn.js';

const norm = normFor('nba');
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parseNbaSummary(d) {
  const comp = d.header?.competitions?.[0] || {};
  const byId = {};
  const side = (homeAway) => {
    const c = (comp.competitors || []).find((x) => x.homeAway === homeAway) || {};
    const t = c.team || {};
    const abbr = norm(t.abbreviation);
    byId[t.id] = abbr;
    return {
      id: t.id,
      abbr,
      name: t.displayName,
      short: t.name || t.shortDisplayName,
      color: t.color ? `#${t.color}` : null,
      alt: t.alternateColor ? `#${t.alternateColor}` : null,
      score: num(c.score),
      record: c.record?.find?.((r) => r.type === 'total')?.summary || c.record?.[0]?.summary || '',
      winner: !!c.winner,
      linescores: (c.linescores || []).map((l) => num(l.displayValue ?? l.value)),
    };
  };
  const home = side('home');
  const away = side('away');
  const st = comp.status?.type || {};

  const plays = (d.plays || []).map((p) => ({
    id: p.id,
    text: (p.text || '').trim(),
    type: p.type?.text || '',
    period: p.period?.number,
    clock: p.clock?.displayValue,
    team: byId[p.team?.id] || null,
    scoring: !!p.scoringPlay,
    scoreValue: p.scoreValue || 0,
    shooting: !!p.shootingPlay,
    awayScore: p.awayScore,
    homeScore: p.homeScore,
    wallclock: p.wallclock,
  }));
  const periodByPlay = Object.fromEntries(plays.map((p) => [p.id, p.period]));
  const winprob = (d.winprobability || []).map((w) => ({ home: w.homeWinPercentage, playId: w.playId, period: periodByPlay[w.playId] }));

  const teamStats = (d.boxscore?.teams || []).map((t) => ({
    abbr: norm(t.team?.abbreviation),
    stats: (t.statistics || []).map((s) => ({ key: s.name, label: s.label, value: s.displayValue })),
  }));
  const players = (d.boxscore?.players || []).map((t) => {
    const g = t.statistics?.[0] || {};
    return {
      abbr: norm(t.team?.abbreviation),
      labels: g.labels || g.names || [],
      keys: g.keys || [],
      totals: g.totals || [],
      athletes: (g.athletes || []).map((a) => ({
        id: a.athlete?.id,
        name: a.athlete?.displayName,
        short: a.athlete?.shortName,
        pos: a.athlete?.position?.abbreviation,
        headshot: a.athlete?.headshot?.href,
        starter: !!a.starter,
        dnp: !!a.didNotPlay,
        reason: a.reason || '',
        stats: a.stats || [],
      })),
    };
  });
  const pc = d.pickcenter?.[0];
  const venue = d.gameInfo?.venue;
  return {
    id: comp.id,
    date: comp.date,
    state: st.state,
    shortDetail: st.shortDetail,
    home,
    away,
    plays,
    lastPlay: plays[plays.length - 1] || null,
    winprob,
    teamStats,
    players,
    venue: venue ? { name: venue.fullName, city: [venue.address?.city, venue.address?.state].filter(Boolean).join(', ') } : null,
    attendance: d.gameInfo?.attendance || null,
    tv: [...new Set((comp.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean))].slice(0, 3).join(', '),
    line: pc ? { details: pc.details, overUnder: pc.overUnder, provider: pc.provider?.name } : null,
  };
}
