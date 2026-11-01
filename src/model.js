// Derived analytics: season aggregates, defense-vs-position, matchup grades,
// player outlook tags and the team game model.

export const FORMATS = {
  ppr: { key: 'pts_ppr', label: 'PPR' },
  half: { key: 'pts_half_ppr', label: 'Half' },
  std: { key: 'pts_std', label: 'Std' },
};

export const pts = (s, fmt) => (s ? s[FORMATS[fmt].key] || 0 : 0);

const SUM_KEYS = [
  'pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int',
  'rush_att', 'rush_yd', 'rush_td', 'rec_tgt', 'rec', 'rec_yd', 'rec_td', 'fum_lost',
  'off_snp', 'tm_off_snp', 'fgm', 'fga', 'xpm', 'sack', 'int', 'fum_rec', 'def_td', 'pts_allow', 'yds_allow',
  'pts_ppr', 'pts_half_ppr', 'pts_std',
];

/**
 * @param weeks  [{ week, rows }] finished weeks, oldest first
 * @param live   { week, rows, finalTeams:Set } current week; only rows whose game is final are counted
 */
export function buildSeason(weeks, live) {
  const players = new Map();
  const fpa = {}; // team -> pos -> { sum:{ppr,half,std}, weeks:Set }
  const teamWeeks = {}; // team -> Set(weeks played)

  const ingest = (week, rows, filter) => {
    for (const r of rows) {
      if (filter && !filter(r)) continue;
      let p = players.get(r.id);
      if (!p) {
        p = { id: r.id, name: r.name, first: r.first, last: r.last, pos: r.pos, team: r.team, injury: r.injury, injuryPart: r.injuryPart, log: [], tot: {} };
        players.set(r.id, p);
      }
      // Latest week wins for team / injury info.
      p.team = r.team;
      p.injury = r.injury;
      p.injuryPart = r.injuryPart;
      p.log.push({ week, opp: r.opp, s: r.s });
      for (const k of SUM_KEYS) if (r.s[k] != null) p.tot[k] = (p.tot[k] || 0) + r.s[k];

      (teamWeeks[r.team] ||= new Set()).add(week);
      if (r.opp) {
        const slot = ((fpa[r.opp] ||= {})[r.pos] ||= { ppr: 0, half: 0, std: 0 });
        slot.ppr += r.s.pts_ppr || 0;
        slot.half += r.s.pts_half_ppr || 0;
        slot.std += r.s.pts_std || 0;
        (teamWeeks[r.opp] ||= new Set()).add(week);
      }
    }
  };

  for (const w of weeks) ingest(w.week, w.rows);
  if (live) ingest(live.week, live.rows, (r) => live.finalTeams.has(r.team));

  for (const p of players.values()) {
    p.log.sort((a, b) => a.week - b.week);
    p.games = p.log.length;
  }

  // Defense vs position, averaged per game the defense actually played.
  const dvp = {};
  for (const [team, byPos] of Object.entries(fpa)) {
    const g = teamWeeks[team]?.size || 1;
    dvp[team] = {};
    for (const [pos, v] of Object.entries(byPos)) {
      dvp[team][pos] = { ppr: v.ppr / g, half: v.half / g, std: v.std / g };
    }
  }
  return { players, dvp, weeksPlayed: teamWeeks };
}

/** Rank defenses per position: rank 1 = allows the most fantasy points (best matchup). */
export function rankDvp(dvp, fmt) {
  const ranks = {};
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  for (const pos of positions) {
    const list = Object.entries(dvp)
      .filter(([, v]) => v[pos])
      .map(([team, v]) => [team, v[pos][fmt]])
      .sort((a, b) => b[1] - a[1]);
    list.forEach(([team, val], i) => {
      (ranks[team] ||= {})[pos] = { rank: i + 1, avg: val, of: list.length };
    });
  }
  return ranks;
}

export function grade(rank, of = 32) {
  if (!rank) return { letter: '—', tone: 'neutral' };
  const pct = (rank - 1) / Math.max(of - 1, 1);
  if (pct < 0.125) return { letter: 'A+', tone: 'great' };
  if (pct < 0.25) return { letter: 'A', tone: 'great' };
  if (pct < 0.375) return { letter: 'B+', tone: 'good' };
  if (pct < 0.5) return { letter: 'B', tone: 'good' };
  if (pct < 0.625) return { letter: 'C+', tone: 'neutral' };
  if (pct < 0.75) return { letter: 'C', tone: 'neutral' };
  if (pct < 0.875) return { letter: 'D', tone: 'bad' };
  return { letter: 'F', tone: 'worst' };
}

export function playerSummary(p, fmt) {
  if (!p || !p.games) return { games: 0, ppg: 0, last3: 0, floor: 0, ceiling: 0, weekly: [] };
  const weekly = p.log.map((l) => ({ week: l.week, opp: l.opp, pts: pts(l.s, fmt), s: l.s }));
  const vals = weekly.map((w) => w.pts);
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (x) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(x * (sorted.length - 1))))];
  const last = vals.slice(-3);
  return {
    games: vals.length,
    ppg: vals.reduce((a, b) => a + b, 0) / vals.length,
    last3: last.reduce((a, b) => a + b, 0) / last.length,
    floor: q(0.2),
    ceiling: q(0.8),
    best: sorted[sorted.length - 1],
    weekly,
  };
}

const STARTER_LINE = { QB: 14, RB: 28, WR: 36, TE: 12, K: 12, DEF: 12 };

/**
 * Join projections with season context and matchup data.
 * Returns rows sorted by projection, each with outlook tags.
 */
export function buildProjectionRows(projRows, season, ranks, fmt, actualById) {
  const byPos = {};
  const rows = projRows.map((r) => {
    const sp = playerSummary(season.players.get(r.id), fmt);
    const proj = pts(r.s, fmt);
    const m = ranks[r.opp]?.[r.pos];
    const g = grade(m?.rank, m?.of);
    const actual = actualById?.get(r.id);
    return {
      ...r,
      proj,
      season: sp,
      matchup: m || null,
      grade: g,
      edge: sp.games >= 2 ? proj - sp.ppg : null,
      actual: actual ? pts(actual.s, fmt) : null,
    };
  });
  rows.sort((a, b) => b.proj - a.proj);
  for (const r of rows) {
    byPos[r.pos] = (byPos[r.pos] || 0) + 1;
    r.posRank = byPos[r.pos];
    r.tags = outlookTags(r);
    // Composite "good week" score: projection, nudged by matchup and form.
    const mAdj = r.matchup ? (r.matchup.of / 2 + 0.5 - r.matchup.rank) / (r.matchup.of / 2) : 0; // +1 best .. -1 worst
    const formAdj = r.season.games >= 3 && r.season.ppg > 0 ? Math.max(-0.3, Math.min(0.3, r.season.last3 / r.season.ppg - 1)) : 0;
    r.outlook = r.proj * (1 + 0.1 * mAdj + 0.15 * formAdj);
  }
  return rows;
}

function outlookTags(r) {
  const tags = [];
  const starter = r.posRank <= STARTER_LINE[r.pos];
  if (r.injury && r.injury !== 'Active') tags.push({ k: 'inj', label: r.injury === 'Questionable' ? 'Q' : r.injury === 'Doubtful' ? 'D' : r.injury === 'Out' ? 'OUT' : r.injury, tone: r.injury === 'Questionable' ? 'warn' : 'bad', title: `${r.injury}${r.injuryPart ? ` · ${r.injuryPart}` : ''}` });
  if (starter && (r.grade.letter === 'A+' || r.grade.letter === 'A')) tags.push({ k: 'smash', label: 'Smash spot', tone: 'great', title: `Opponent allows the ${ordinal(r.matchup.rank)}-most points to ${r.pos}` });
  if (r.season.games >= 3 && r.season.last3 >= r.season.ppg * 1.25 && r.season.last3 >= 8) tags.push({ k: 'hot', label: 'Heating up', tone: 'hot', title: `Averaging ${r.season.last3.toFixed(1)} over the last 3 vs ${r.season.ppg.toFixed(1)} on the season` });
  if (r.edge != null && r.edge >= 4 && r.proj >= 10) tags.push({ k: 'edge', label: `+${r.edge.toFixed(1)} vs avg`, tone: 'good', title: 'Projected well above season average' });
  if (starter && (r.grade.letter === 'F' || r.grade.letter === 'D')) tags.push({ k: 'tough', label: 'Tough matchup', tone: 'bad', title: `Opponent allows the ${ordinal(r.matchup.of - r.matchup.rank + 1)}-fewest points to ${r.pos}` });
  return tags;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---- Team model -----------------------------------------------------------

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/**
 * Projects every game on the slate.
 * Blends Sleeper's implied points (opponent DEF "points allowed" projection)
 * with a ratings model built from points scored / allowed per game.
 */
export function buildTeamOutlook(games, standings, projRows, fmt) {
  const st = Object.fromEntries(standings.map((s) => [s.abbr, s]));
  const rated = standings.filter((s) => s.wins + s.losses + s.ties > 0);
  const leagueAvg = rated.length ? rated.reduce((a, s) => a + s.pf / (s.wins + s.losses + s.ties), 0) / rated.length : 22;
  const rating = (abbr) => {
    const s = st[abbr];
    const g = s ? s.wins + s.losses + s.ties : 0;
    return g ? { off: s.pf / g, def: s.pa / g } : { off: leagueAvg, def: leagueAvg };
  };

  const defProj = {};
  const fantasy = {};
  const topByTeam = {};
  for (const r of projRows) {
    if (r.pos === 'DEF') defProj[r.team] = r;
    fantasy[r.team] = (fantasy[r.team] || 0) + (r.pos === 'DEF' ? 0 : pts(r.s, fmt));
    (topByTeam[r.team] ||= []).push(r);
  }

  const teams = [];
  for (const g of games) {
    const sides = [
      { me: g.home.abbr, opp: g.away.abbr, home: true },
      { me: g.away.abbr, opp: g.home.abbr, home: false },
    ];
    const proj = {};
    for (const s of sides) {
      const a = rating(s.me);
      const b = rating(s.opp);
      const model = (a.off + b.def) / 2 + (s.home && !g.neutral ? 1.0 : -1.0);
      const implied = defProj[s.opp]?.s?.pts_allow;
      proj[s.me] = implied ? 0.65 * implied + 0.35 * model : model;
      s.model = model;
      s.implied = implied ?? null;
    }
    for (const s of sides) {
      const margin = proj[s.me] - proj[s.opp];
      const r = rating(s.me);
      teams.push({
        abbr: s.me,
        opp: s.opp,
        home: s.home,
        gameId: g.id,
        game: g,
        projPts: proj[s.me],
        oppPts: proj[s.opp],
        margin,
        winProb: normCdf(margin / 13.2),
        implied: s.implied,
        model: s.model,
        offPpg: r.off,
        defPpg: r.def,
        fantasy: fantasy[s.me] || 0,
        defense: defProj[s.me] ? pts(defProj[s.me].s, fmt) : null,
        top: (topByTeam[s.me] || []).filter((x) => x.pos !== 'DEF').slice(0, 4),
        record: st[s.me] ? `${st[s.me].wins}-${st[s.me].losses}${st[s.me].ties ? `-${st[s.me].ties}` : ''}` : '',
      });
    }
  }

  // Outlook score 0–100: projected points (60%) + team fantasy volume (40%), as percentiles.
  const pct = (arr, v) => (arr.length <= 1 ? 0.5 : arr.filter((x) => x < v).length / (arr.length - 1));
  const ptsArr = teams.map((t) => t.projPts);
  const fanArr = teams.map((t) => t.fantasy);
  for (const t of teams) t.outlook = Math.round(100 * (0.6 * pct(ptsArr, t.projPts) + 0.4 * pct(fanArr, t.fantasy)));
  teams.sort((a, b) => b.outlook - a.outlook || b.projPts - a.projPts);
  return { teams, leagueAvg };
}
