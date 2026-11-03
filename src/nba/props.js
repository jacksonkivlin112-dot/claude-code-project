// NBA over/under model for PrizePicks lines.
//
//   mean  = Sleeper per-game projection (60%) + season per-game average (25%)
//           + last-5 average (15%)
//           × stat-specific matchup (what the opponent allows to G/F/C, ±6%)
//           × pace (projected game total vs league, ±5%)
//           × blowout risk (|spread| ≥ 10 trims heavy-minute players 3%)
//           × rest (second night of a back-to-back −3%)
//           × injury (Questionable −8%; Out/Doubtful → avoid)
//   shape = Poisson for low counts (threes, blocks, steals, TOs, small reb/ast
//           means); otherwise normal with the player's spread shrunk to a prior.

import { MARKETS_NBA, normName } from '../oddsapi.js';
import { ordinal } from '../model.js';
import { BREAKEVEN, GRADES, calibrateLine, parseManual, probabilities } from '../propsModel.js';
import { groupName } from './model.js';

const STAT_KEY = {
  player_points: 'pts',
  player_rebounds: 'reb',
  player_assists: 'ast',
  player_threes: 'tpm',
  player_blocks: 'blk',
  player_steals: 'stl',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));
const shortDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

export function buildNbaLookups(projRows, season, teams) {
  const projByName = new Map((projRows || []).map((r) => [normName(r.name), r]));
  const seasonByName = new Map([...season.players.values()].map((p) => [normName(p.name), p]));
  const teamByName = {};
  for (const t of Object.values(teams || {})) teamByName[t.name] = t.abbr;
  return { projByName, seasonByName, teamByName };
}

/**
 * @param ctx { lookups, season, dvp:{ranks, leagueAvg}, outlookByTeam, leagueAvg, b2b, liveById, gameByTeam }
 */
export function evaluateNbaProp(prop, ctx) {
  const M = MARKETS_NBA[prop.market];
  if (!M) return null;
  const key = normName(prop.player);
  const proj = ctx.lookups.projByName.get(key);
  const sp = (proj && ctx.season.players.get(proj.id)) || ctx.lookups.seasonByName.get(key);
  const base = proj || sp;
  const common = { ...prop, sport: 'nba', marketLabel: M.label, marketShort: M.short };
  if (!base) {
    return { ...common, unmatched: true, grade: GRADES[3], reasons: [{ tone: 'neutral', text: 'No projection or game log found for this player on this slate.' }] };
  }
  const group = base.group;
  const pos = base.pos;
  const team = proj?.team || sp?.team;
  const homeAbbr = ctx.lookups.teamByName[prop.home];
  const awayAbbr = ctx.lookups.teamByName[prop.away];
  const opp = proj?.opp || (team && homeAbbr && awayAbbr ? (team === homeAbbr ? awayAbbr : homeAbbr) : null);

  const log = sp?.log || [];
  const history = log.map((l, i) => ({ week: i + 1, date: l.date, opp: l.opp, val: M.get(l.s) ?? 0, min: l.s.min }));
  const vals = history.map((h) => h.val);
  const n = vals.length;
  const seasonAvg = sp?.gp ? M.get(sp.avg) ?? null : avg(vals);
  const last5 = avg(vals.slice(-5));
  const projVal = proj ? M.get(proj.s) : undefined;
  const projMin = proj?.s?.min ?? (proj?.s?.sp ? proj.s.sp / 60 : null);
  const seasonMin = sp?.avg?.min || null;

  if (projVal == null && !n && seasonAvg == null) {
    return { ...common, pos, team, opp, playerId: base.id, unmatched: true, grade: GRADES[3], reasons: [{ tone: 'neutral', text: 'Not enough data for this stat yet.' }] };
  }

  let mean;
  if (projVal != null && seasonAvg != null && n >= 3) mean = 0.6 * projVal + 0.25 * seasonAvg + 0.15 * last5;
  else if (projVal != null && seasonAvg != null) mean = 0.75 * projVal + 0.25 * seasonAvg;
  else if (projVal != null) mean = projVal;
  else mean = n >= 3 ? 0.65 * (seasonAvg ?? avg(vals)) + 0.35 * last5 : seasonAvg ?? avg(vals);

  // Matchup: stat-specific where we can, fantasy points for combos.
  const statKey = STAT_KEY[prop.market] || 'fp';
  const m = opp && group ? ctx.dvp.ranks[opp]?.[group]?.[statKey] : null;
  let matchupF = 1;
  if (m && prop.market !== 'player_turnovers') {
    const mAdj = (m.of / 2 + 0.5 - m.rank) / (m.of / 2);
    matchupF = 1 + 0.06 * mAdj;
  }

  // Pace / game environment.
  const o = team ? ctx.outlookByTeam[team] : null;
  let paceF = 1;
  if (o && ctx.leagueAvg) paceF = clamp(1 + (o.total - 2 * ctx.leagueAvg) / (2 * ctx.leagueAvg) * 0.8, 0.95, 1.05);

  // Blowout risk trims starters' minutes.
  const blowout = o && Math.abs(o.margin) >= 10 && (projMin || seasonMin || 0) >= 28;
  const blowF = blowout ? 0.97 : 1;
  const b2b = team ? ctx.b2b.has(team) : false;
  const restF = b2b ? 0.97 : 1;

  const injury = proj?.injury || sp?.injury || null;
  const injF = injury === 'Questionable' ? 0.92 : 1;
  const inactive = ['Out', 'Doubtful', 'IR', 'Sus'].includes(injury);

  mean = Math.max(0, mean * matchupF * paceF * blowF * restF * injF);

  let dist = M.dist;
  if (M.poissonBelow && mean < M.poissonBelow) dist = 'poisson';
  let sd = 0;
  if (dist === 'normal') {
    const sampleSd = n >= 2 ? Math.sqrt(vals.reduce((a, v) => a + (v - avg(vals)) ** 2, 0) / (n - 1)) : 0;
    const prior = M.cv * Math.max(mean, 1);
    const k = 5;
    sd = Math.sqrt((n * sampleSd ** 2 + k * prior ** 2) / (n + k));
    sd = Math.max(sd, 0.12 * mean, 1);
  }
  const p = calibrateLine(probabilities(dist, mean, sd, prop.line), prop, ctx.lineCal);
  const side = p.over >= p.under ? 'over' : 'under';
  const prob = Math.max(p.over, p.under);
  let grade = GRADES.find((g) => prob >= g.min);
  if (inactive || (n < 2 && projVal == null)) grade = GRADES[3];
  else if (injury === 'Questionable' && grade.key === 'strong') grade = GRADES[1];

  const recent = history.slice(-10).map((h) => ({ ...h, label: `${shortDate(h.date)} vs ${h.opp}`, over: h.val > prop.line, push: h.val === prop.line }));
  const overs = recent.filter((h) => h.over).length;

  const reasons = [];
  const diff = mean - prop.line;
  reasons.push({ tone: Math.abs(diff) < 0.03 * prop.line ? 'neutral' : 'pos', text: `Model mean ${fmt(mean)} vs line ${prop.line} (${diff >= 0 ? '+' : ''}${fmt(diff)}) → ${Math.round(prob * 100)}% ${side === 'over' ? 'more' : 'less'}.` });
  if (projVal != null) {
    const agrees = (projVal > prop.line) === (side === 'over');
    reasons.push({ tone: agrees ? 'pos' : 'neg', text: `Sleeper projects ${fmt(projVal)} ${M.short}${projMin ? ` in ${fmt(projMin, 0)} minutes` : ''}.` });
  }
  if (projMin && seasonMin && Math.abs(projMin - seasonMin) >= 3) {
    const up = projMin > seasonMin;
    reasons.push({ tone: (up && side === 'over') || (!up && side === 'under') ? 'pos' : 'neg', text: `Projected minutes ${up ? 'up' : 'down'}: ${fmt(projMin, 0)} vs ${fmt(seasonMin, 0)} season average.` });
  }
  if (recent.length) {
    const hits = side === 'over' ? overs : recent.filter((h) => !h.over && !h.push).length;
    const rate = hits / recent.length;
    reasons.push({ tone: rate >= 0.6 ? 'pos' : rate <= 0.4 ? 'neg' : 'neutral', text: `Went ${side === 'over' ? 'over' : 'under'} this line in ${hits} of the last ${recent.length} games.` });
  }
  if (seasonAvg != null && n >= 3) {
    const hot = last5 > seasonAvg * 1.15;
    const cold = last5 < seasonAvg * 0.85;
    reasons.push({ tone: hot || cold ? ((hot && side === 'over') || (cold && side === 'under') ? 'pos' : 'neg') : 'neutral', text: `Averaging ${fmt(seasonAvg)} this season and ${fmt(last5)} over the last ${Math.min(5, n)}${hot ? ' (trending up)' : cold ? ' (trending down)' : ''}.` });
  }
  if (m && (m.rank <= 7 || m.rank > m.of - 7)) {
    const soft = m.rank <= 7;
    const what = statKey === 'fp' ? 'fantasy points' : M.label.toLowerCase();
    reasons.push({ tone: (soft && side === 'over') || (!soft && side === 'under') ? 'pos' : 'neg', text: `${opp} allows the ${ordinal(soft ? m.rank : m.of - m.rank + 1)}-${soft ? 'most' : 'fewest'} ${what} to ${groupName(group)} (${fmt(m.avg)}/g, last 4 weeks).` });
  }
  if (o && Math.abs(o.total - 2 * ctx.leagueAvg) >= 5) {
    const fast = o.total > 2 * ctx.leagueAvg;
    reasons.push({ tone: (fast && side === 'over') || (!fast && side === 'under') ? 'pos' : 'neg', text: `Projected game total ${fmt(o.total, 0)} (${fast ? 'above' : 'below'} the ${fmt(2 * ctx.leagueAvg, 0)} league norm).` });
  }
  if (blowout) reasons.push({ tone: side === 'under' ? 'pos' : 'neg', text: `Blowout risk: ${team} ${o.margin > 0 ? 'favored' : 'underdog'} by ${fmt(Math.abs(o.margin))}, so starters may sit late.` });
  if (b2b) reasons.push({ tone: side === 'under' ? 'pos' : 'neg', text: `${team} is on the second night of a back-to-back.` });
  if (injury) reasons.push({ tone: 'neg', text: `Injury designation: ${injury}${base.injuryPart ? ` (${base.injuryPart})` : ''}.${inactive ? ' Avoid unless confirmed active.' : ' Mean trimmed 8%.'}` });
  if (n < 3) reasons.push({ tone: 'neutral', text: `Small recent sample (${n} game${n === 1 ? '' : 's'}).` });
  if (prop.prevLine != null && prop.prevLine !== prop.line) reasons.push({ tone: 'neutral', text: `Line moved ${prop.line > prop.prevLine ? 'up' : 'down'} from ${prop.prevLine} to ${prop.line}.` });

  const g = team ? ctx.gameByTeam[team] : null;
  const live = ctx.liveById.get(base.id);
  const started = g ? g.state !== 'pre' : prop.commence ? new Date(prop.commence).getTime() < Date.now() : false;
  let result = null;
  if (started && live && g) {
    const actual = M.get(live.s) ?? 0;
    const final = g.state === 'post';
    const hit = side === 'over' ? actual > prop.line : actual < prop.line;
    result = { actual, final, hit: final ? hit : null };
  }

  if (p.calibrated) {
    const raw = side === 'over' ? p.rawOver : p.rawUnder;
    const cal = ctx.lineCal;
    reasons.push({ tone: 'neutral', text: `Sportsbook lines are sharp${cal?.n ? `: on ${cal.n.toLocaleString()} graded lines the model's confident leans hit ${cal.modelSide70 ? Math.round(cal.modelSide70.hit * 100) : '—'}%` : ''}, so this chance is pulled toward 50/50 (model alone said ${Math.round(raw * 100)}%).` });
  }
  return {
    ...common,
    commence: prop.commence || g?.date,
    playerId: base.id,
    pos,
    team,
    opp,
    injury,
    inactive,
    mean,
    sd,
    projVal,
    seasonAvg,
    last3: last5,
    games: n,
    pOver: p.over,
    pUnder: p.under,
    side,
    prob,
    edge: prob - BREAKEVEN,
    grade,
    recent,
    overs,
    matchup: m,
    reasons,
    started,
    result,
  };
}

export const NBA_ALIASES = [
  ['player_points_rebounds_assists', ['pts+rebs+asts', 'pts+reb+ast', 'points+rebounds+assists', 'pra']],
  ['player_points_rebounds', ['pts+rebs', 'pts+reb', 'points+rebounds', 'p+r', 'pr']],
  ['player_points_assists', ['pts+asts', 'pts+ast', 'points+assists', 'p+a', 'pa']],
  ['player_rebounds_assists', ['rebs+asts', 'reb+ast', 'rebounds+assists', 'r+a', 'ra']],
  ['player_blocks_steals', ['blks+stls', 'blk+stl', 'blocks+steals', 'stocks', 'b+s']],
  ['player_threes', ['3-pt made', '3pt made', '3-pointers made', '3pm', 'threes', '3s', '3-pt']],
  ['player_points', ['points', 'pts']],
  ['player_rebounds', ['rebounds', 'rebs', 'reb']],
  ['player_assists', ['assists', 'asts', 'ast']],
  ['player_blocks', ['blocked shots', 'blocks', 'blks', 'blk']],
  ['player_steals', ['steals', 'stls', 'stl']],
  ['player_turnovers', ['turnovers', 'tov', 'to']],
];

export const parseManualNba = (text) => parseManual(text, NBA_ALIASES);
