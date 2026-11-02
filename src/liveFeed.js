// Builds the live play feed (newest first) from ESPN game summaries:
// identifies the players in each play, their headshots and game lines,
// tags big moments, and attaches the win-probability swing of each play.

const strip = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

/** id -> athlete with name, headshot and a compact game stat line. */
export function athleteIndex(raw, sport) {
  const map = new Map();
  for (const team of raw?.boxscore?.players || []) {
    const abbr = team.team?.abbreviation;
    for (const g of team.statistics || []) {
      const labels = g.labels || g.names || [];
      for (const a of g.athletes || []) {
        const ath = a.athlete || {};
        if (!ath.id) continue;
        const cur = map.get(ath.id) || {
          id: ath.id,
          name: ath.displayName,
          short: ath.shortName,
          jersey: ath.jersey,
          pos: ath.position?.abbreviation,
          team: abbr,
          headshot: ath.headshot?.href || `https://a.espncdn.com/i/headshots/${sport}/players/full/${ath.id}.png`,
          groups: {},
        };
        if (a.stats?.length) cur.groups[g.name || 'stats'] = Object.fromEntries(labels.map((l, i) => [l, a.stats[i]]));
        map.set(ath.id, cur);
      }
    }
  }
  return map;
}

/** Short stat line for the feed, e.g. "18/27, 214 YDS, 2 TD" or "24 PTS · 8 REB · 6 AST". */
export function statLine(a, sport) {
  if (!a) return '';
  const g = a.groups;
  if (sport === 'nba') {
    const s = g.stats || Object.values(g)[0];
    if (!s) return '';
    const threes = parseInt(String(s['3PT'] || '0').split('-')[0], 10);
    return [`${s.PTS ?? 0} PTS`, `${s.REB ?? 0} REB`, `${s.AST ?? 0} AST`, threes > 0 ? `${threes} 3PM` : null, s.MIN ? `${s.MIN} MIN` : null].filter(Boolean).join(' · ');
  }
  if (g.passing) return `${g.passing['C/ATT']}, ${g.passing.YDS} YDS, ${g.passing.TD} TD${Number(g.passing.INT) ? `, ${g.passing.INT} INT` : ''}`;
  const parts = [];
  if (g.rushing) parts.push(`${g.rushing.CAR}-${g.rushing.YDS} rush${Number(g.rushing.TD) ? `, ${g.rushing.TD} TD` : ''}`);
  if (g.receiving) parts.push(`${g.receiving.REC}-${g.receiving.YDS} rec${Number(g.receiving.TD) ? `, ${g.receiving.TD} TD` : ''}`);
  if (!parts.length && g.defensive) parts.push(`${g.defensive.TOT ?? g.defensive.SOLO ?? 0} TKL${Number(g.defensive.SACKS) ? `, ${g.defensive.SACKS} SCK` : ''}`);
  if (!parts.length && g.kicking) parts.push(`${g.kicking.FG} FG, ${g.kicking.PTS} PTS`);
  return parts.join(' · ');
}

/** NFL play text uses "P.Mahomes": map initial(s)+last name to athletes. */
function nflNameIndex(athletes) {
  const idx = new Map();
  for (const a of athletes.values()) {
    const parts = (a.name || '').replace(/\b(Jr|Sr|II|III|IV)\.?$/i, '').trim().split(/\s+/);
    if (parts.length < 2) continue;
    const first = strip(parts[0]);
    const last = strip(parts.slice(1).join(''));
    for (const k of [first.slice(0, 1), first.slice(0, 2), first.slice(0, 3)]) idx.set(`${k}.${last}`, a);
  }
  return idx;
}

function nflActors(text, idx) {
  const main = text.replace(/\([^)]*\)/g, ' ').replace(/PENALTY.*$/i, ' ');
  const found = [];
  for (const m of main.matchAll(/\b([A-Z][a-zA-Z]{0,2})\.\s?([A-Z][A-Za-z'’-]+(?:\s(?:St\.|Jr\.|Sr\.|II|III))?)/g)) {
    const a = idx.get(`${strip(m[1])}.${strip(m[2])}`);
    if (a && !found.includes(a)) found.push(a);
    if (found.length === 2) break;
  }
  return found;
}

/** Yards gained on the play itself, ignoring penalty yardage folded into ESPN's statYardage. */
export function gainFromText(text = '') {
  const main = text.split(/PENALTY/i)[0];
  if (/for no gain/i.test(main)) return 0;
  const m = main.match(/for (-?\d+) yards?/i);
  return m ? Number(m[1]) : null;
}

const wpIndex = (raw) => {
  const m = new Map();
  (raw?.winprobability || []).forEach((w) => m.set(String(w.playId), w.homeWinPercentage));
  return m;
};

/**
 * @param game  parsed summary (parseSummary / parseNbaSummary output)
 * @param raw   raw ESPN summary (for box score + win probability)
 */
export function buildFeed(game, raw, sport) {
  const athletes = athleteIndex(raw, sport);
  const wp = wpIndex(raw);
  const names = sport === 'nfl' ? nflNameIndex(athletes) : null;
  const items = [];
  const plays = sport === 'nfl'
    ? game.drives.flatMap((d) => d.plays.map((p) => ({ ...p, driveTeam: d.team, driveId: d.id, driveResult: d.result })))
    : game.plays;
  const rawNba = sport === 'nba' ? new Map((raw?.plays || []).map((p) => [String(p.id), p])) : null;
  const running = new Map(); // athlete id -> running game totals
  let prevWp = 0.5;
  let prevScore = [0, 0];

  for (const p of plays) {
    const homeWp = wp.get(String(p.id));
    const delta = homeWp != null ? homeWp - prevWp : null;
    if (homeWp != null) prevWp = homeWp;
    const scored = p.awayScore != null && (p.awayScore !== prevScore[0] || p.homeScore !== prevScore[1]);
    if (p.awayScore != null) prevScore = [p.awayScore, p.homeScore];

    let actors = [];
    if (sport === 'nfl') actors = nflActors(p.text || '', names);
    else {
      // Order by appearance in the text so the blocker / stealer leads on defensive plays.
      const lower = (p.text || '').toLowerCase();
      actors = (rawNba.get(String(p.id))?.participants || []).map((x) => athletes.get(String(x.athlete?.id))).filter(Boolean)
        .sort((a, b) => ((lower.indexOf((a.name || '').toLowerCase()) + 1 || 999) - (lower.indexOf((b.name || '').toLowerCase()) + 1 || 999)))
        .slice(0, 2);
    }

    const team = sport === 'nfl' ? p.start?.team || p.driveTeam : p.team;
    const t = `${p.type} ${p.text}`;
    const tags = [];
    let big = false;
    if (sport === 'nfl') {
      if (p.scoring) { tags.push({ label: /touchdown/i.test(t) || p.scoreValue >= 6 ? 'TOUCHDOWN' : /field goal/i.test(t) ? 'FIELD GOAL' : /safety/i.test(t) ? 'SAFETY' : 'SCORE', tone: 'great' }); big = true; }
      if (p.turnover) { tags.push({ label: /intercept/i.test(t) ? 'INTERCEPTION' : 'TURNOVER', tone: 'worst' }); big = true; }
      if (/sack/i.test(p.type)) { tags.push({ label: 'SACK', tone: 'bad' }); big = true; }
      if (p.penalty) tags.push({ label: 'FLAG', tone: 'warn' });
      const scrimmage = /rush|pass|reception|scramble/i.test(p.type);
      if (!p.penalty && (p.yards ?? 0) >= (scrimmage ? 20 : 40)) { tags.push({ label: `${p.yards}-YD ${scrimmage ? 'PLAY' : 'RETURN'}`, tone: 'good' }); big = true; }
      if (/4th/.test(p.start?.shortDownDistanceText || '') && !/punt|field goal/i.test(t)) tags.push({ label: '4TH DOWN', tone: 'warn' });
    } else {
      if (p.scoring && p.scoreValue === 3) { tags.push({ label: 'THREE', tone: 'great' }); big = true; }
      if (/dunk/i.test(t) && p.scoring) { tags.push({ label: 'DUNK', tone: 'hot' }); big = true; }
      if (/block/i.test(p.text)) { tags.push({ label: 'BLOCK', tone: 'good' }); big = true; }
      if (/steal/i.test(p.text)) { tags.push({ label: 'STEAL', tone: 'good' }); big = true; }
      if (/turnover/i.test(p.type) && !/steal/i.test(p.text)) tags.push({ label: 'TURNOVER', tone: 'bad' });
      if (/technical|flagrant/i.test(p.type)) tags.push({ label: 'TECH', tone: 'worst' });
    }
    if (delta != null && Math.abs(delta) >= (sport === 'nfl' ? 0.1 : 0.08)) { tags.push({ label: 'MOMENTUM', tone: 'hot' }); big = true; }
    const quiet = sport === 'nba' && /substitution|timeout|end period|jump ball/i.test(p.type) && !p.scoring;
    const after = sport === 'nfl' ? nflAccumulate(running, p, actors) : nbaAccumulate(running, p, actors);

    items.push({
      id: p.id,
      period: p.period,
      clock: p.clock,
      team,
      text: p.text || p.type,
      type: p.type,
      actors,
      tags,
      big,
      quiet,
      scored,
      scoreValue: p.scoreValue,
      awayScore: p.awayScore,
      homeScore: p.homeScore,
      homeWp,
      wpDelta: delta,
      dd: sport === 'nfl' && p.start?.down > 0 ? p.start.downDistanceText : null,
      yards: sport === 'nfl' ? (gainFromText(p.text) ?? p.yards) : null,
      driveId: p.driveId,
      driveResult: p.driveResult,
      wallclock: p.wallclock || null,
      after,
    });
  }
  // Each player's latest card shows the official box-score line, so "right now" is exact
  // (play-text replay can drift a few yards on spot-foul penalties).
  const done = new Set();
  for (let k = items.length - 1; k >= 0; k--) {
    for (const x of items[k].after || []) {
      const key = `${x.id}|${x.role}`;
      if (done.has(key)) continue;
      done.add(key);
      const official = boxLine(athletes.get(String(x.id)), x.role);
      if (official) x.line = official;
    }
  }
  return { items: items.reverse(), athletes };
}

// ---- Short play summaries ------------------------------------------------------
// "K. Walker 7 yd rush" instead of the full official play description.

const short = (a) => {
  if (!a?.name) return '';
  const parts = a.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '').split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : a.name;
};
// "R.Rice" / "J.Smith-Njigba" in raw NFL text -> "R. Rice"
const fmtAbbr = (s) => (s ? s.replace(/^([A-Z][a-z]{0,2})\.\s?/, '$1. ') : '');
const yds = (n) => (n === 0 ? 'no gain' : `${Math.abs(n)} yd${Math.abs(n) === 1 ? '' : 's'}`);

function nflSummary(i) {
  const t = i.text || '';
  const type = i.type || '';
  const [A, B] = i.actors;
  const a = short(A);
  const b = short(B);
  const y = i.yards ?? 0;
  const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  if (/two-minute warning/i.test(type)) return 'Two-minute warning';
  if (/end (of )?(period|half|game|regulation)/i.test(type)) return type;
  if (/timeout/i.test(type)) return `Timeout${i.team ? ` ${i.team}` : ''}`;
  if (/penalty/i.test(type)) {
    const m = t.match(/PENALTY on ([A-Z]{2,3})-[^,]+,\s*([^,]+?),\s*(\d+)\s*yards?/i);
    if (m) return `Flag on ${m[1]}: ${m[2].trim()}, ${m[3]} yds`;
    const d = t.match(/PENALTY on ([A-Z]{2,3})[^,]*,\s*([^,.]+)/i);
    return d ? `Flag on ${d[1]}: ${d[2].trim()}${/declined/i.test(t) ? ' (declined)' : /offsetting/i.test(t) ? ' (offsetting)' : ''}` : 'Penalty';
  }
  if (/field goal/i.test(type)) {
    const d = num(/(\d+)\s*(?:yard|yd)s?\s*field goal/i);
    return `${a || 'FG'} ${d ? `${d} yd ` : ''}FG ${/good/i.test(type) ? 'is good' : /block/i.test(type + t) ? 'blocked' : 'missed'}`;
  }
  if (/extra point|two-point/i.test(type)) return `${a || 'Try'} ${/good|succeed/i.test(type + t) ? 'converts' : 'fails'} ${/two-point/i.test(type) ? '2-pt try' : 'PAT'}`;
  if (/punt/i.test(type)) { const d = num(/punts\s+(\d+)\s+yards/i); return `Punt${d ? `, ${d} yds` : ''}${/fair catch/i.test(t) ? ' (fair catch)' : /touchback/i.test(t) ? ' (touchback)' : ''}`; }
  if (/kickoff/i.test(type)) {
    if (/touchback/i.test(t)) return 'Kickoff, touchback';
    const r = num(/for\s+(-?\d+)\s+yards?/i);
    return r != null && b ? `${b} ${r} yd kick return` : 'Kickoff';
  }
  if (/sack/i.test(type)) return `${a || 'QB'} sacked${y ? `, ${y} yds` : ''}`;
  if (/interception/i.test(type) || /INTERCEPTED/.test(t)) {
    const by = t.match(/INTERCEPTED by ([A-Z][a-zA-Z]{0,2}\.\s?[A-Z][A-Za-z'’-]+)/);
    return `${a || 'Pass'} intercepted${by ? ` by ${fmtAbbr(by[1])}` : ''}${/touchdown/i.test(type + t) ? ', returned for TD' : ''}`;
  }
  if (/fumble/i.test(type) || /FUMBLES/.test(t)) {
    const rec = t.match(/RECOVERED by ([A-Z]{2,3})/i);
    return `${a || 'Ball'} fumbles${rec ? `, recovered by ${rec[1].toUpperCase()}` : ''}`;
  }
  if (/passing touchdown/i.test(type)) return `${a} ${y ? `${y} yd ` : ''}TD pass${b ? ` to ${b}` : ''}`;
  if (/rushing touchdown/i.test(type)) return `${a} ${y ? `${y} yd ` : ''}TD run`;
  if (/pass incompletion/i.test(type) || /pass incomplete/i.test(t)) return `${a} incomplete${b ? ` to ${b}` : ''}`;
  if (/pass reception|pass$/i.test(type) || / pass (short|deep)/i.test(t)) return b ? `${b} ${y === 0 ? 'catch, no gain' : y < 0 ? `catch, loss of ${-y}` : `${y} yd catch`} from ${A?.name?.split(' ').slice(-1)[0] || ''}`.trim() : `${a} pass, ${yds(y)}`;
  if (/rush|scramble/i.test(type)) return `${a} ${y === 0 ? 'rush, no gain' : y < 0 ? `rush, loss of ${Math.abs(y)}` : `${y} yd rush`}`;
  return a ? `${a} ${type.toLowerCase()}`.trim() : type || t.slice(0, 60);
}

function nbaSummary(i) {
  const t = i.text || '';
  const type = i.type || '';
  const [A, B] = i.actors;
  const a = short(A) || (t.split(' ').slice(0, 2).join(' '));
  const b = short(B);
  if (/timeout/i.test(type)) return `Timeout${i.team ? ` ${i.team}` : ''}`;
  if (/end (period|game)/i.test(type)) return type;
  if (/jump ball/i.test(type)) return 'Jump ball';
  if (/review/i.test(type)) return `Replay review${/stands/i.test(t) ? ' (call stands)' : /overturn/i.test(t) ? ' (overturned)' : ''}`;
  if (/shot clock/i.test(type)) return `${i.team || 'Team'} shot clock violation`;
  if (/delay|violation/i.test(type) && !A) return `${i.team || 'Team'} ${type.toLowerCase()}`;
  if (/substitution/i.test(type)) return b ? `${b} in for ${a}` : `Sub: ${a}`;
  if (/free throw/i.test(type)) {
    const which = (type.match(/(\d of \d)/) || [])[1];
    return `${a} ${/misses/i.test(t) ? 'misses' : 'makes'} FT${which ? ` ${which}` : ''}`;
  }
  if (/block/i.test(t)) { const blk = t.match(/^(.+?) blocks/); return `${blk && B && t.startsWith(B.name) ? b : a} blocks ${blk && B && t.startsWith(B.name) ? a : b || 'shot'}`.trim(); }
  if (/steal/i.test(t) || /turnover/i.test(type)) {
    const kind = type.replace(/turnover/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const stolen = t.match(/\(([^)]+) steals\)/i);
    return `${a} turnover${kind ? ` (${kind})` : ''}${stolen ? `, stolen by ${short({ name: stolen[1] })}` : ''}`;
  }
  if (/rebound/i.test(type)) return !A ? `${i.team || 'Team'} team rebound` : `${a} ${/offensive/i.test(type) ? 'off.' : 'def.'} rebound`;
  if (/foul/i.test(type)) return `${a} ${type.toLowerCase()}`;
  if (/shot|layup|dunk|jumper|hook|tip/i.test(type + t)) {
    const d0 = Number((t.match(/(\d+)-foot/) || [])[1] || 0);
    const dist = d0 >= 5 ? d0 : null;
    const three = /three point/i.test(t);
    const shot = three ? 'three' : /dunk/i.test(type + t) ? 'dunk' : /layup/i.test(type + t) ? 'layup' : /hook/i.test(type + t) ? 'hook shot' : /tip/i.test(type + t) ? 'tip-in' : 'jumper';
    const made = /makes/i.test(t) || i.scored;
    const ast = t.match(/\(([^)]+?) assists\)/i);
    return `${a} ${made ? 'makes' : 'misses'} ${dist ? `${dist}-ft ` : ''}${shot}${made && ast ? ` (${short({ name: ast[1] })} ast)` : ''}`;
  }
  return `${a} ${type.toLowerCase()}`.trim();
}

/** One-line description of a feed item. */
export function summarize(item, sport) {
  try {
    return sport === 'nfl' ? nflSummary(item) : nbaSummary(item);
  } catch {
    return item.text;
  }
}

/** The one number a card leads with, e.g. { value: '+7', label: 'YDS' }. */
export function keyStat(i, sport) {
  if (sport === 'nfl') {
    if (/field goal/i.test(i.type) && /good/i.test(i.type)) return { value: '+3', label: 'PTS' };
    if (/touchdown/i.test(i.type)) return { value: '+6', label: 'TD' };
    if (/sack/i.test(i.type)) return { value: i.yards ? `${i.yards}` : 'SACK', label: i.yards ? 'YDS' : '' };
    if (i.tags.some((t) => /INTERCEPTION|TURNOVER/.test(t.label))) return { value: 'TO', label: 'TURNOVER' };
    if (i.yards != null && /rush|pass|reception|scramble|return|kickoff/i.test(i.type) && i.yards !== 0) return { value: `${i.yards > 0 ? '+' : ''}${i.yards}`, label: 'YDS' };
    return null;
  }
  if (i.scored && i.scoreValue) return { value: `+${i.scoreValue}`, label: 'PTS' };
  if (/block/i.test(i.text)) return { value: 'BLK', label: '' };
  if (/steal/i.test(i.text)) return { value: 'STL', label: '' };
  if (/rebound/i.test(i.type) && i.actors.length) return { value: 'REB', label: '' };
  return null;
}

// ---- Running stats -------------------------------------------------------------
// Box scores only give totals, so replay the game play by play to know each
// player's line right after any given play.

const normAbbr = (x) => ({ WSH: 'WAS', JAC: 'JAX', LA: 'LAR' })[x?.toUpperCase()] || x?.toUpperCase();
const tot = (map, a) => {
  if (!map.has(a.id)) map.set(a.id, {});
  return map.get(a.id);
};
const nameOf = (a) => {
  const parts = (a.name || '').replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, '').split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : a.name;
};

function nflLine(t, role) {
  if (role === 'pass') return `${t.cmp || 0}/${t.att || 0}, ${t.passYds || 0} yds${t.passTd ? `, ${t.passTd} TD` : ''}${t.int ? `, ${t.int} INT` : ''}`;
  if (role === 'rec') return `${t.rec || 0} rec, ${t.recYds || 0} yds${t.recTd ? `, ${t.recTd} TD` : ''}`;
  if (role === 'rush') return `${t.car || 0} car, ${t.rushYds || 0} yds${t.rushTd ? `, ${t.rushTd} TD` : ''}`;
  if (role === 'fg') return `${t.fgm || 0}/${t.fga || 0} FG`;
  return '';
}

/** Update NFL running totals for one play; returns the lines to show after it. */
function nflAccumulate(map, p, actors) {
  const t = p.text || '';
  const type = p.type || '';
  if (/no play/i.test(t) || /^penalty$/i.test(type) || /two-point|extra point/i.test(type)) return [];
  const [A, B] = actors;
  let y = gainFromText(t) ?? p.yards ?? 0;
  // Offensive spot fouls (e.g. holding downfield): the player is credited only up to the spot.
  const spot = t.match(/PENALTY on ([A-Z]{2,3})-[^,]+,[^,]+,\s*\d+\s*yards?,\s*enforced at ([A-Z]{2,3})?\s?(\d+)/i);
  const off = p.start?.team;
  if (spot && off && p.start?.yardsToEndzone != null && normAbbr(spot[1]) === off) {
    const spotYte = spot[2] ? (normAbbr(spot[2]) === off ? 100 - Number(spot[3]) : Number(spot[3])) : 50;
    y = Math.min(y, p.start.yardsToEndzone - spotYte);
  }
  const td = /touchdown/i.test(type);
  if (/field goal/i.test(type) && A) {
    const k = tot(map, A);
    k.fga = (k.fga || 0) + 1;
    if (/good/i.test(type)) k.fgm = (k.fgm || 0) + 1;
    return [{ id: A.id, role: 'fg', name: nameOf(A), line: nflLine(k, 'fg') }];
  }
  const isPass = /pass/i.test(type) || / pass (short|deep|incomplete)/i.test(t) || /INTERCEPTED/.test(t);
  if (isPass && A && !/sack/i.test(type)) {
    const q = tot(map, A);
    q.att = (q.att || 0) + 1;
    const complete = /reception|passing touchdown/i.test(type) && !/incomplete/i.test(t);
    if (/INTERCEPTED/.test(t) || /interception/i.test(type)) q.int = (q.int || 0) + 1;
    const out = [];
    if (complete && B) {
      q.cmp = (q.cmp || 0) + 1;
      q.passYds = (q.passYds || 0) + y;
      const r = tot(map, B);
      r.rec = (r.rec || 0) + 1;
      r.recYds = (r.recYds || 0) + y;
      if (td) { q.passTd = (q.passTd || 0) + 1; r.recTd = (r.recTd || 0) + 1; }
      out.push({ id: B.id, role: 'rec', name: nameOf(B), line: nflLine(r, 'rec') });
    }
    out.push({ id: A.id, role: 'pass', name: nameOf(A), line: nflLine(q, 'pass') });
    return out;
  }
  if (/rush|scramble/i.test(type) && A) {
    const r = tot(map, A);
    r.car = (r.car || 0) + 1;
    r.rushYds = (r.rushYds || 0) + y;
    if (td) r.rushTd = (r.rushTd || 0) + 1;
    return [{ id: A.id, role: 'rush', name: nameOf(A), line: nflLine(r, 'rush') }];
  }
  return [];
}

function nbaLine(t) {
  return [`${t.pts || 0} pts`, t.reb ? `${t.reb} reb` : null, t.ast ? `${t.ast} ast` : null, t.tpm ? `${t.tpm} 3pm` : null, t.stl ? `${t.stl} stl` : null, t.blk ? `${t.blk} blk` : null].filter(Boolean).join(', ');
}

/** Update NBA running totals for one play; returns the lines to show after it. */
function nbaAccumulate(map, p, actors) {
  const t = p.text || '';
  const type = p.type || '';
  const [A, B] = actors;
  if (!A) return [];
  const show = (...xs) => xs.filter(Boolean).map((a) => ({ id: a.id, role: 'nba', name: nameOf(a), line: nbaLine(tot(map, a)) }));
  if (p.scoring && p.scoreValue) {
    const s = tot(map, A);
    s.pts = (s.pts || 0) + p.scoreValue;
    if (p.scoreValue === 3) s.tpm = (s.tpm || 0) + 1;
    if (B && /assists/i.test(t)) { const a = tot(map, B); a.ast = (a.ast || 0) + 1; return show(A, B); }
    return show(A);
  }
  if (/rebound/i.test(type)) { const s = tot(map, A); s.reb = (s.reb || 0) + 1; return show(A); }
  if (/blocks/i.test(t)) { const s = tot(map, A); s.blk = (s.blk || 0) + 1; return show(A); }
  if (/steals/i.test(t) && B) { const s = tot(map, B); s.stl = (s.stl || 0) + 1; return show(B); }
  if (/misses/i.test(t) || /turnover|foul/i.test(type)) return show(A);
  return [];
}

/** Current official line from the box score in the same format as the replay lines. */
function boxLine(a, role) {
  const g = a?.groups;
  if (!g) return null;
  const n = (v) => Number(String(v ?? 0).split('-')[0]) || 0;
  if (role === 'pass' && g.passing) {
    const [c, att] = String(g.passing['C/ATT'] || '0/0').split('/');
    return nflLine({ cmp: n(c), att: n(att), passYds: n(g.passing.YDS), passTd: n(g.passing.TD), int: n(g.passing.INT) }, 'pass');
  }
  if (role === 'rec' && g.receiving) return nflLine({ rec: n(g.receiving.REC), recYds: n(g.receiving.YDS), recTd: n(g.receiving.TD) }, 'rec');
  if (role === 'rush' && g.rushing) return nflLine({ car: n(g.rushing.CAR), rushYds: n(g.rushing.YDS), rushTd: n(g.rushing.TD) }, 'rush');
  if (role === 'fg' && g.kicking) { const [m, att] = String(g.kicking.FG || '0/0').split('/'); return nflLine({ fgm: n(m), fga: n(att) }, 'fg'); }
  if (role === 'nba') {
    const s = g.stats || Object.values(g)[0];
    if (!s) return null;
    return nbaLine({ pts: n(s.PTS), reb: n(s.REB), ast: n(s.AST), tpm: n(s['3PT']), stl: n(s.STL), blk: n(s.BLK) });
  }
  return null;
}
