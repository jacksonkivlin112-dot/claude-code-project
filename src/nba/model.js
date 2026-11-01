// NBA analytics: season/recent aggregates, defense vs position (G/F/C),
// projection rows with outlook tags, and the nightly team game model.

import { grade, ordinal } from '../model.js';

/** PrizePicks-style fantasy score. */
export const fantasy = (s = {}) =>
  (s.pts || 0) + 1.2 * (s.reb || 0) + 1.5 * (s.ast || 0) + 3 * (s.stl || 0) + 3 * (s.blk || 0) - (s.to || 0);

const DVP_KEYS = ['pts', 'reb', 'ast', 'tpm', 'stl', 'blk'];

/**
 * @param seasonRows  season totals (one row per player, s.gp = games played)
 * @param recentRows  per-game rows from the last few weeks
 */
export function buildNbaSeason(seasonRows, recentRows) {
  const players = new Map();
  const ensure = (r) => {
    let p = players.get(r.id);
    if (!p) {
      p = { id: r.id, sport: 'nba', name: r.name, first: r.first, last: r.last, pos: r.pos, group: r.group, team: r.team, injury: r.injury, injuryPart: r.injuryPart, exp: r.exp, gp: 0, tot: {}, avg: {}, log: [] };
      players.set(r.id, p);
    }
    return p;
  };

  for (const r of seasonRows) {
    const p = ensure(r);
    p.gp = r.s.gp || 0;
    p.tot = r.s;
    for (const [k, v] of Object.entries(r.s)) p.avg[k] = p.gp ? v / p.gp : 0;
    p.avg.min = p.gp ? (r.s.min ?? (r.s.sp || 0) / 60) / p.gp : 0;
    p.fpg = p.gp ? fantasy(r.s) / p.gp : 0;
  }

  // Recent per-game logs, plus defense-vs-position from those games.
  const seen = new Set();
  const fpa = {}; // opp -> group -> {fp, pts, ...}
  const oppGames = {}; // opp -> Set(gameId)
  for (const r of [...recentRows].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const k = `${r.id}|${r.gameId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const p = ensure(r);
    p.team = r.team;
    p.injury = r.injury;
    p.injuryPart = r.injuryPart;
    const fp = fantasy(r.s);
    p.log.push({ date: r.date, opp: r.opp, s: r.s, fp, gameId: r.gameId });
    if (r.opp) {
      const slot = ((fpa[r.opp] ||= {})[r.group] ||= { fp: 0 });
      slot.fp += fp;
      for (const key of DVP_KEYS) slot[key] = (slot[key] || 0) + (r.s[key] || 0);
      (oppGames[r.opp] ||= new Set()).add(r.gameId);
    }
  }
  for (const p of players.values()) {
    // Players missing from the season file (e.g., brand-new signings): derive from logs.
    if (!p.gp && p.log.length) {
      p.gp = p.log.length;
      p.fpg = p.log.reduce((a, l) => a + l.fp, 0) / p.gp;
      for (const key of ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'min']) p.avg[key] = p.log.reduce((a, l) => a + (l.s[key] || 0), 0) / p.gp;
    }
  }

  const dvp = {};
  for (const [team, byGroup] of Object.entries(fpa)) {
    const g = oppGames[team]?.size || 1;
    dvp[team] = {};
    for (const [grp, v] of Object.entries(byGroup)) dvp[team][grp] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / g]));
    dvp[team].games = g;
  }
  return { players, dvp };
}

/** rank 1 = allows the most (softest matchup), per group and per stat. */
export function rankNbaDvp(dvp) {
  const ranks = {};
  const leagueAvg = {};
  for (const grp of ['G', 'F', 'C']) {
    for (const key of ['fp', ...DVP_KEYS]) {
      const list = Object.entries(dvp).filter(([, v]) => v[grp]).map(([t, v]) => [t, v[grp][key] || 0]).sort((a, b) => b[1] - a[1]);
      leagueAvg[`${grp}:${key}`] = list.length ? list.reduce((a, [, x]) => a + x, 0) / list.length : 0;
      list.forEach(([t, val], i) => {
        ((ranks[t] ||= {})[grp] ||= {})[key] = { rank: i + 1, avg: val, of: list.length };
      });
    }
  }
  return { ranks, leagueAvg };
}

export function nbaSummary(p) {
  if (!p) return { gp: 0, fpg: 0, last5: 0, floor: 0, ceiling: 0, log: [] };
  const vals = p.log.map((l) => l.fp);
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (x) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(x * (sorted.length - 1))))] : 0);
  const last = vals.slice(-5);
  return {
    gp: p.gp,
    fpg: p.fpg || 0,
    last5: last.length ? last.reduce((a, b) => a + b, 0) / last.length : 0,
    floor: q(0.2),
    ceiling: q(0.8),
    best: sorted[sorted.length - 1] || 0,
    log: p.log,
  };
}

/** Teams that played the previous day (second night of a back-to-back). */
export function backToBack(allGames, ymd, etDate, addDays) {
  const prev = addDays(ymd, -1);
  const set = new Set();
  for (const g of allGames) if (etDate(g.date) === prev) { set.add(g.home.abbr); set.add(g.away.abbr); }
  return set;
}

export function buildNbaProjectionRows(projRows, season, dvpRanks, b2b, actualById) {
  const rows = projRows.map((r) => {
    const p = season.players.get(r.id);
    const sm = nbaSummary(p);
    const proj = fantasy(r.s);
    const m = dvpRanks.ranks[r.opp]?.[r.group]?.fp || null;
    const actual = actualById?.get(r.id);
    return {
      ...r,
      proj,
      min: r.s.min ?? (r.s.sp ? r.s.sp / 60 : null),
      season: sm,
      matchup: m,
      grade: grade(m?.rank, m?.of),
      edge: sm.gp >= 3 ? proj - sm.fpg : null,
      b2b: b2b.has(r.team),
      actual: actual ? fantasy(actual.s) : null,
      actualLine: actual?.s || null,
    };
  });
  rows.sort((a, b) => b.proj - a.proj);
  const posCount = {};
  rows.forEach((r, i) => {
    r.rank = i + 1;
    posCount[r.group] = (posCount[r.group] || 0) + 1;
    r.posRank = posCount[r.group];
    r.tags = nbaTags(r);
    const mAdj = r.matchup ? (r.matchup.of / 2 + 0.5 - r.matchup.rank) / (r.matchup.of / 2) : 0;
    const formAdj = r.season.log.length >= 3 && r.season.fpg > 0 ? Math.max(-0.3, Math.min(0.3, r.season.last5 / r.season.fpg - 1)) : 0;
    r.outlook = r.proj * (1 + 0.08 * mAdj + 0.12 * formAdj - (r.b2b ? 0.03 : 0));
  });
  return rows;
}

function nbaTags(r) {
  const tags = [];
  if (r.injury) tags.push({ k: 'inj', label: r.injury === 'Questionable' ? 'Q' : r.injury === 'Doubtful' ? 'D' : r.injury === 'Out' ? 'OUT' : r.injury, tone: r.injury === 'Questionable' ? 'warn' : 'bad', title: `${r.injury}${r.injuryPart ? ` · ${r.injuryPart}` : ''}` });
  const relevant = r.rank <= 90;
  if (relevant && (r.grade.letter === 'A+' || r.grade.letter === 'A')) tags.push({ k: 'smash', label: 'Smash spot', tone: 'great', title: `${r.opp} allows the ${ordinal(r.matchup.rank)}-most fantasy points to ${groupName(r.group)} (last 4 weeks)` });
  if (r.season.log.length >= 4 && r.season.last5 >= r.season.fpg * 1.2 && r.season.last5 >= 20) tags.push({ k: 'hot', label: 'Heating up', tone: 'hot', title: `${r.season.last5.toFixed(1)} fantasy pts over the last 5 vs ${r.season.fpg.toFixed(1)} on the season` });
  if (r.edge != null && r.edge >= 5 && r.proj >= 20) tags.push({ k: 'edge', label: `+${r.edge.toFixed(1)} vs avg`, tone: 'good', title: 'Projected well above season average' });
  if (r.b2b) tags.push({ k: 'b2b', label: 'B2B', tone: 'warn', title: 'Second night of a back-to-back: minutes and efficiency often dip' });
  if (relevant && (r.grade.letter === 'F' || r.grade.letter === 'D')) tags.push({ k: 'tough', label: 'Tough matchup', tone: 'bad', title: `${r.opp} allows the ${ordinal(r.matchup.of - r.matchup.rank + 1)}-fewest fantasy points to ${groupName(r.group)}` });
  return tags;
}

export const groupName = (g) => ({ G: 'guards', F: 'forwards', C: 'centers' })[g] || g;

// ---- team game model ----------------------------------------------------------------

function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Projected score for each team on the slate. Blends the sum of Sleeper's
 * per-player point projections (a de-facto implied total) with a ratings
 * model from points scored/allowed per game, home court and rest.
 */
export function buildNbaTeamOutlook(games, standings, projRows, b2b) {
  const st = Object.fromEntries(standings.map((s) => [s.abbr, s]));
  const rated = standings.filter((s) => s.ppg);
  const leagueAvg = rated.length ? rated.reduce((a, s) => a + s.ppg, 0) / rated.length : 114;
  const ptsSum = {};
  const fanSum = {};
  const top = {};
  for (const r of projRows) {
    ptsSum[r.team] = (ptsSum[r.team] || 0) + (r.s.pts || 0);
    fanSum[r.team] = (fanSum[r.team] || 0) + fantasy(r.s);
    (top[r.team] ||= []).push(r);
  }
  const teams = [];
  for (const g of games) {
    const sides = [
      { me: g.home.abbr, opp: g.away.abbr, home: true },
      { me: g.away.abbr, opp: g.home.abbr, home: false },
    ];
    const proj = {};
    for (const s of sides) {
      const a = st[s.me];
      const b = st[s.opp];
      const off = a?.ppg || leagueAvg;
      const def = b?.oppg || leagueAvg;
      s.model = (off + def) / 2 + (g.neutral ? 0 : s.home ? 1.4 : -1.4) - (b2b.has(s.me) ? 1.5 : 0) + (b2b.has(s.opp) ? 0.75 : 0);
      s.implied = ptsSum[s.me] && ptsSum[s.me] > 85 && ptsSum[s.me] < 150 ? ptsSum[s.me] : null;
      proj[s.me] = s.implied ? 0.55 * s.implied + 0.45 * s.model : s.model;
    }
    for (const s of sides) {
      const margin = proj[s.me] - proj[s.opp];
      const sd = st[s.me];
      teams.push({
        abbr: s.me,
        opp: s.opp,
        home: s.home,
        game: g,
        projPts: proj[s.me],
        oppPts: proj[s.opp],
        total: proj[s.me] + proj[s.opp],
        margin,
        winProb: normCdf(margin / 12.5),
        implied: s.implied,
        model: s.model,
        offPpg: sd?.ppg ?? null,
        defPpg: sd?.oppg ?? null,
        fantasy: fanSum[s.me] || 0,
        b2b: b2b.has(s.me),
        top: (top[s.me] || []).sort((x, y) => fantasy(y.s) - fantasy(x.s)).slice(0, 5),
        record: sd ? `${sd.wins}-${sd.losses}` : '',
      });
    }
  }
  const pct = (arr, v) => (arr.length <= 1 ? 0.5 : arr.filter((x) => x < v).length / (arr.length - 1));
  const ptsArr = teams.map((t) => t.projPts);
  const fanArr = teams.map((t) => t.fantasy);
  for (const t of teams) t.outlook = Math.round(100 * (0.6 * pct(ptsArr, t.projPts) + 0.4 * pct(fanArr, t.fantasy)));
  teams.sort((a, b) => b.outlook - a.outlook || b.projPts - a.projPts);
  return { teams, leagueAvg };
}
