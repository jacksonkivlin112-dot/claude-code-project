// Over/Under model for player props.
//
// For each line we estimate the stat's distribution for this game, then the
// probability it lands over or under the line:
//   mean  = Sleeper projection (60%) + season average (25%) + last-3 average (15%)
//           × matchup factor (opponent's fantasy points allowed to the position, ±5%)
//           × game-script factor (team implied total / spread, ±6%)
//           × injury factor (Questionable −7%)
//   shape = Poisson for low counts (TDs, receptions, INTs); otherwise normal,
//           with the player's game-to-game spread shrunk toward a market default.
// The pick is whichever side clears 50%, graded against PrizePicks' break-even.

import { MARKETS, normName } from './oddsapi.js';
import { ordinal } from './model.js';

// PrizePicks pays ~3x on a 3-pick flex and ~10x on a 5-pick flex; the per-leg
// break-even across common entry types sits around 54-58%.
export const BREAKEVEN = 0.5425;

export const GRADES = [
  { min: 0.64, key: 'strong', label: 'Strong' },
  { min: 0.58, key: 'solid', label: 'Solid' },
  { min: BREAKEVEN, key: 'lean', label: 'Lean' },
  { min: 0, key: 'pass', label: 'No edge' },
];

function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  let term = Math.exp(-lambda);
  let total = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    total += term;
  }
  return Math.min(1, total);
}

/** P(over), P(under) — pushes on whole-number lines are excluded. */
/**
 * Sportsbook lines are sharp. Pull the model's chance toward 50/50 by the amount measured
 * on graded real lines (scripts/calibrate-lines.mjs): over' = 0.5 + s * (over - 0.5) + b.
 * Model-made floor lines (ids starting "h") are calibrated separately and left alone.
 */
export function calibrateLine(p, prop, cal) {
  if (!cal || String(prop.id || '').startsWith('h')) return p;
  const tot = p.over + p.under;
  if (!(tot > 0)) return p;
  const q = Math.min(0.99, Math.max(0.01, 0.5 + cal.s * (p.over / tot - 0.5) + (cal.b || 0)));
  return { ...p, over: q * tot, under: (1 - q) * tot, rawOver: p.over, rawUnder: p.under, calibrated: true };
}

export function probabilities(dist, mean, sd, line) {
  if (dist === 'poisson') {
    const lam = Math.max(mean, 0.01);
    const whole = Number.isInteger(line);
    const under = whole ? poissonCdf(line - 1, lam) : poissonCdf(Math.floor(line), lam);
    const over = 1 - poissonCdf(Math.floor(line), lam);
    const tot = over + under;
    return { over: over / tot, under: under / tot };
  }
  const over = 1 - normCdf((line - mean) / sd);
  return { over, under: 1 - over };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

export function buildLookups(projRows, season, teams) {
  const projByName = new Map();
  for (const r of projRows || []) if (r.pos !== 'DEF') projByName.set(normName(r.name), r);
  const seasonByName = new Map();
  for (const p of season.players.values()) if (p.pos !== 'DEF') seasonByName.set(normName(p.name), p);
  const teamByName = {};
  for (const t of Object.values(teams || {})) teamByName[t.name] = t.abbr;
  return { projByName, seasonByName, teamByName };
}

/**
 * @param prop  { id, player, market, line, home, away, commence, prevLine }
 * @param ctx   { lookups, ranks, outlookByTeam, leagueAvg, liveById, gameByTeam }
 */
export function evaluateProp(prop, ctx) {
  const M = MARKETS[prop.market];
  if (!M) return null;
  const key = normName(prop.player);
  const proj = ctx.lookups.projByName.get(key);
  const sp = (proj && ctx.season.players.get(proj.id)) || ctx.lookups.seasonByName.get(key);
  const pos = proj?.pos || sp?.pos;
  const team = proj?.team || sp?.team || null;
  const homeAbbr = ctx.lookups.teamByName[prop.home];
  const awayAbbr = ctx.lookups.teamByName[prop.away];
  const opp = proj?.opp || (team && homeAbbr && awayAbbr ? (team === homeAbbr ? awayAbbr : homeAbbr) : null);

  const history = (sp?.log || []).map((l) => ({ week: l.week, opp: l.opp, val: M.get(l.s) ?? 0 }));
  const vals = history.map((h) => h.val);
  const n = vals.length;
  const seasonAvg = avg(vals);
  const last3 = avg(vals.slice(-3));
  const projVal = proj ? M.get(proj.s) : undefined;

  const reasons = [];
  if (projVal == null && !n) {
    return { ...prop, pos, team, opp, playerId: proj?.id || sp?.id, unmatched: true, grade: GRADES[3], reasons: [{ tone: 'neutral', text: 'No projection or game history found for this player yet.' }] };
  }

  // 1) Base mean.
  let mean;
  if (projVal != null && n >= 3) mean = 0.6 * projVal + 0.25 * seasonAvg + 0.15 * last3;
  else if (projVal != null && n > 0) mean = 0.8 * projVal + 0.2 * seasonAvg;
  else if (projVal != null) mean = projVal;
  else mean = n >= 3 ? 0.65 * seasonAvg + 0.35 * last3 : seasonAvg;

  // 2) Matchup: fantasy points the opponent allows to this position. Projections
  // already price matchup in, so this is a light touch.
  const m = opp && pos ? ctx.ranks[opp]?.[pos] : null;
  let matchupF = 1;
  if (m && prop.market !== 'player_pass_interceptions') {
    const mAdj = (m.of / 2 + 0.5 - m.rank) / (m.of / 2); // +1 softest .. -1 toughest
    matchupF = 1 + 0.05 * mAdj;
  }

  // 3) Game script: projected team points and spread.
  const o = team ? ctx.outlookByTeam[team] : null;
  let scriptF = 1;
  if (o && ctx.leagueAvg) {
    const ptsDiff = o.projPts - ctx.leagueAvg;
    const passy = /pass|reception|receptions/.test(prop.market) && !/rush_reception/.test(prop.market);
    const rushy = /rush/.test(prop.market) && pos === 'RB';
    if (passy) scriptF = 1 + 0.006 * ptsDiff - (prop.market.startsWith('player_pass') ? 0.004 * o.margin : 0); // trailing teams throw more
    else if (rushy) scriptF = 1 + 0.006 * ptsDiff + 0.006 * o.margin; // leading teams run more
    else scriptF = 1 + 0.005 * ptsDiff;
    if (prop.market === 'player_pass_interceptions') scriptF = 1 - 0.004 * o.margin;
    scriptF = clamp(scriptF, 0.94, 1.06);
  }

  // 4) Injury.
  const injury = proj?.injury || sp?.injury || null;
  let injF = 1;
  if (injury === 'Questionable') injF = 0.93;
  const inactive = ['Out', 'IR', 'Doubtful', 'PUP', 'Sus'].includes(injury);

  mean = Math.max(0, mean * matchupF * scriptF * injF);

  // 5) Spread of outcomes.
  let sd = 0;
  if (M.dist === 'normal') {
    const sampleSd = n >= 2 ? Math.sqrt(vals.reduce((a, v) => a + (v - seasonAvg) ** 2, 0) / (n - 1)) : 0;
    const prior = M.cv * Math.max(mean, 1);
    const k = 4; // prior weight in "games"
    sd = Math.sqrt((n * sampleSd ** 2 + k * prior ** 2) / (n + k));
    sd = Math.max(sd, 0.15 * mean, 1);
  }

  const p = calibrateLine(probabilities(M.dist, mean, sd, prop.line), prop, ctx.lineCal);
  const side = p.over >= p.under ? 'over' : 'under';
  const prob = Math.max(p.over, p.under);
  let grade = GRADES.find((g) => prob >= g.min);
  if (inactive || (n < 2 && projVal == null)) grade = GRADES[3];
  else if (injury === 'Questionable' && grade.key === 'strong') grade = GRADES[1];

  // Hit rate vs this line.
  const recent = history.slice(-8).map((h) => ({ ...h, over: h.val > prop.line, push: h.val === prop.line }));
  const overs = recent.filter((h) => h.over).length;

  // Reasons, written for the pick side.
  const diff = mean - prop.line;
  reasons.push({
    tone: Math.abs(diff) < 0.03 * prop.line ? 'neutral' : 'pos',
    text: `Model mean ${fmt(mean)} vs line ${prop.line} (${diff >= 0 ? '+' : ''}${fmt(diff)}) → ${Math.round(prob * 100)}% ${side}.`,
  });
  if (projVal != null) {
    const agrees = (projVal > prop.line) === (side === 'over');
    reasons.push({ tone: agrees ? 'pos' : 'neg', text: `Sleeper projects ${fmt(projVal)} ${M.short.toLowerCase()}.` });
  }
  if (recent.length) {
    const hits = side === 'over' ? overs : recent.filter((h) => !h.over && !h.push).length;
    const rate = hits / recent.length;
    reasons.push({ tone: rate >= 0.6 ? 'pos' : rate <= 0.4 ? 'neg' : 'neutral', text: `Went ${side} this line in ${hits} of last ${recent.length} games.` });
  }
  if (n >= 3) {
    const hot = last3 > seasonAvg * 1.15;
    const cold = last3 < seasonAvg * 0.85;
    const supports = (hot && side === 'over') || (cold && side === 'under');
    reasons.push({
      tone: hot || cold ? (supports ? 'pos' : 'neg') : 'neutral',
      text: `Averaging ${fmt(seasonAvg)} this season and ${fmt(last3)} over the last 3${hot ? ' (trending up)' : cold ? ' (trending down)' : ''}.`,
    });
  }
  if (m && (m.rank <= 8 || m.rank > m.of - 8)) {
    const soft = m.rank <= 8;
    reasons.push({
      tone: (soft && side === 'over') || (!soft && side === 'under') ? 'pos' : 'neg',
      text: soft
        ? `${opp} allows the ${ordinal(m.rank)}-most fantasy points to ${pos}s (${fmt(m.avg)}/g).`
        : `${opp} allows the ${ordinal(m.of - m.rank + 1)}-fewest fantasy points to ${pos}s (${fmt(m.avg)}/g).`,
    });
  }
  if (o && Math.abs(o.projPts - ctx.leagueAvg) >= 2.5) {
    const high = o.projPts > ctx.leagueAvg;
    reasons.push({
      tone: (high && side === 'over') || (!high && side === 'under') ? 'pos' : 'neg',
      text: `${team} projected for ${fmt(o.projPts)} points (${high ? 'above' : 'below'} the ${fmt(ctx.leagueAvg)} league average), ${o.margin >= 0 ? `favored by ${fmt(o.margin)}` : `underdog by ${fmt(-o.margin)}`}.`,
    });
  }
  if (injury) reasons.push({ tone: 'neg', text: `Injury designation: ${injury}${(proj?.injuryPart || sp?.injuryPart) ? ` (${proj?.injuryPart || sp?.injuryPart})` : ''}.${inactive ? ' Avoid unless active.' : ' Mean trimmed 7%.'}` });
  if (n < 3) reasons.push({ tone: 'neutral', text: `Small sample (${n} game${n === 1 ? '' : 's'}), so confidence is lower.` });
  if (prop.prevLine != null && prop.prevLine !== prop.line) {
    const up = prop.line > prop.prevLine;
    reasons.push({ tone: 'neutral', text: `Line moved ${up ? 'up' : 'down'} from ${prop.prevLine} to ${prop.line}.` });
  }

  // Result tracking once the game is underway.
  const g = team ? ctx.gameByTeam[team] : null;
  const playerId = proj?.id || sp?.id;
  const live = playerId ? ctx.liveById.get(playerId) : null;
  const started = g ? g.state !== 'pre' : new Date(prop.commence).getTime() < Date.now();
  let result = null;
  if (started && live && g) {
    const actual = M.get(live.s) ?? 0;
    const final = g.state === 'post';
    const hit = side === 'over' ? actual > prop.line : actual < prop.line;
    result = { actual, final, hit: final ? hit : null, onPace: !final ? hit : null };
  }

  if (p.calibrated) {
    const raw = side === 'over' ? p.rawOver : p.rawUnder;
    const cal = ctx.lineCal;
    reasons.push({ tone: 'neutral', text: `Sportsbook lines are sharp${cal?.n ? `: on ${cal.n.toLocaleString()} graded lines the model's confident leans hit ${cal.modelSide70 ? Math.round(cal.modelSide70.hit * 100) : '—'}%` : ''}, so this chance is pulled toward 50/50 (model alone said ${Math.round(raw * 100)}%).` });
  }
  return {
    ...prop,
    inactive,
    playerId,
    pos,
    team,
    opp,
    injury,
    mean,
    sd,
    projVal,
    seasonAvg,
    last3,
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
    marketLabel: M.label,
    marketShort: M.short,
  };
}

// ---- Manual entry parsing ---------------------------------------------------

const MARKET_ALIASES = [
  ['player_pass_rush_yds', ['pass+rush', 'pass + rush', 'pass and rush', 'pass+rush yds']],
  ['player_rush_reception_yds', ['rush+rec', 'rush + rec', 'rush+rec yds', 'rush and rec', 'rec+rush']],
  ['player_pass_completions', ['completions', 'pass completions', 'cmp']],
  ['player_pass_attempts', ['pass attempts', 'attempts', 'att']],
  ['player_pass_interceptions', ['interceptions', 'int', 'ints']],
  ['player_pass_tds', ['pass tds', 'pass td', 'passing tds', 'passing touchdowns']],
  ['player_pass_yds', ['pass yards', 'pass yds', 'passing yards', 'passing yds']],
  ['player_rush_attempts', ['rush attempts', 'carries']],
  ['player_rush_yds', ['rush yards', 'rush yds', 'rushing yards', 'rushing yds']],
  ['player_reception_yds', ['receiving yards', 'rec yards', 'rec yds', 'receiving yds']],
  ['player_receptions', ['receptions', 'rec', 'catches']],
];

export function matchMarket(text, table = MARKET_ALIASES) {
  const t = ` ${text.toLowerCase().replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ').trim()} `;
  for (const [key, aliases] of table) {
    for (const a of aliases) if (t.includes(` ${a} `)) return { key, alias: a };
  }
  return null;
}

/** Parse lines like "Josh Allen, Pass Yards, 245.5" or "Josh Allen Pass Yds 245.5". */
export function parseManual(text, table = MARKET_ALIASES) {
  const out = [];
  const errors = [];
  for (const raw of text.split('\n')) {
    const lineTxt = raw.trim();
    if (!lineTxt) continue;
    const num = lineTxt.match(/(-?\d+(?:\.\d+)?)\s*$/);
    if (!num) { errors.push(`No line number in "${lineTxt}"`); continue; }
    const rest = lineTxt.slice(0, num.index).replace(/[,|\t]+/g, ' ').replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ').trim();
    const mk = matchMarket(rest, table);
    if (!mk) { errors.push(`Unknown stat in "${lineTxt}"`); continue; }
    const idx = rest.toLowerCase().replace(/\s+/g, ' ').lastIndexOf(mk.alias);
    const player = rest.slice(0, idx).trim();
    if (!player) { errors.push(`No player name in "${lineTxt}"`); continue; }
    out.push({ player, market: mk.key, line: Number(num[1]) });
  }
  return { rows: out, errors };
}
