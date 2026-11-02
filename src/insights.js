// Home-screen insights: active streaks, injury status changes, top performers.

const NFL_STREAKS = [
  { key: 'rec100', label: '100-yard receiving', pos: ['WR', 'TE', 'RB'], test: (s) => (s.rec_yd || 0) >= 100, w: 3 },
  { key: 'rush80', label: '80-yard rushing', pos: ['RB', 'QB'], test: (s) => (s.rush_yd || 0) >= 80, w: 2.5 },
  { key: 'scrim100', label: '100-scrimmage-yard', pos: ['RB'], test: (s) => (s.rush_yd || 0) + (s.rec_yd || 0) >= 100, w: 1.6 },
  { key: 'recTd', label: 'receiving TD', pos: ['WR', 'TE', 'RB'], test: (s) => (s.rec_td || 0) >= 1, w: 2.2 },
  { key: 'rushTd', label: 'rushing TD', pos: ['RB', 'QB'], test: (s) => (s.rush_td || 0) >= 1, w: 2 },
  { key: 'catch6', label: '6+ catch', pos: ['WR', 'TE', 'RB'], test: (s) => (s.rec || 0) >= 6, w: 1.5 },
  { key: 'pass250', label: '250-yard passing', pos: ['QB'], test: (s) => (s.pass_yd || 0) >= 250, w: 1.4 },
  { key: 'pass2td', label: 'multi-TD passing', pos: ['QB'], test: (s) => (s.pass_td || 0) >= 2, w: 2 },
];
const dd = (s) => ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => (s[k] || 0) >= 10).length;
const NBA_STREAKS = [
  { key: 'pts30', label: '30-point', test: (s) => (s.pts || 0) >= 30, w: 3 },
  { key: 'dd', label: 'double-double', test: (s) => dd(s) >= 2, w: 2 },
  { key: 'ast10', label: '10-assist', test: (s) => (s.ast || 0) >= 10, w: 2.4 },
  { key: 'reb10', label: '10-rebound', test: (s) => (s.reb || 0) >= 10, w: 1.4 },
  { key: 'tpm4', label: '4+ three', test: (s) => (s.tpm || 0) >= 4, w: 2.2 },
  { key: 'pts20', label: '20-point', test: (s) => (s.pts || 0) >= 20, w: 1 },
];

/** Active streaks: consecutive most-recent games meeting a bar. One (best) per player. */
export function computeStreaks(players, sport) {
  const rules = sport === 'nba' ? NBA_STREAKS : NFL_STREAKS;
  const min = sport === 'nba' ? 4 : 3;
  const out = [];
  for (const p of players.values()) {
    if (!p.log?.length || p.pos === 'DEF' || p.pos === 'K') continue;
    let best = null;
    for (const r of rules) {
      if (r.pos && !r.pos.includes(p.pos)) continue;
      let n = 0;
      for (let i = p.log.length - 1; i >= 0 && r.test(p.log[i].s); i--) n++;
      if (n >= min) {
        const score = n * r.w;
        if (!best || score > best.score) best = { n, label: r.label, score };
      }
    }
    if (best) out.push({ player: p, text: `${best.n}-game ${best.label} streak`, n: best.n, score: best.score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const STATUS_RANK = { Out: 4, IR: 4, Doubtful: 3, Questionable: 2, Active: 0 };

/**
 * Current injury designations for relevant players, plus status changes since
 * this device last looked (e.g. "Out -> Active"). Changes stay visible for 2 days.
 */
export function injuryReport(players, sport, relevant) {
  const key = `ge:inj:${sport}`;
  let store = { statuses: {}, changes: [] };
  try { store = JSON.parse(localStorage.getItem(key) || 'null') || store; } catch { /* ignore */ }
  const now = Date.now();
  const statuses = {};
  const changes = (store.changes || []).filter((c) => now - c.ts < 2 * 86400000);
  const current = [];
  for (const p of players.values()) {
    if (!relevant(p)) continue;
    const st = p.injury || 'Active';
    statuses[p.id] = st;
    const prev = store.statuses?.[p.id];
    if (prev && prev !== st) {
      const i = changes.findIndex((c) => c.id === p.id);
      if (i >= 0) changes.splice(i, 1);
      changes.unshift({ id: p.id, from: prev, to: st, part: p.injuryPart || null, ts: now });
    }
    if (p.injury) current.push(p);
  }
  try { localStorage.setItem(key, JSON.stringify({ statuses: { ...store.statuses, ...statuses }, changes })); } catch { /* ignore */ }
  const changed = changes.map((c) => ({ ...c, player: players.get(c.id) })).filter((c) => c.player);
  const changedIds = new Set(changed.map((c) => c.id));
  current.sort((a, b) => (STATUS_RANK[b.injury] || 1) - (STATUS_RANK[a.injury] || 1));
  return [
    ...changed.map((c) => ({ player: c.player, from: c.from, to: c.to, part: c.part, ts: c.ts })),
    ...current.filter((p) => !changedIds.has(p.id)).map((p) => ({ player: p, to: p.injury, part: p.injuryPart })),
  ];
}

const pct = (m, a) => (a ? `${Math.round((m / a) * 100)}% fg` : null);

/** Best stat lines from the most recent games, for the rotating performer pill. */
export function topPerformers(players, sport, limit = 8) {
  const rows = [];
  if (sport === 'nba') {
    let latest = '';
    for (const p of players.values()) for (const l of p.log || []) if (l.date > latest) latest = l.date;
    const days = new Set([latest]);
    for (const p of players.values()) {
      const l = (p.log || []).find((x) => days.has(x.date));
      if (!l) continue;
      const s = l.s;
      const line = [`${s.pts || 0} pts`, (s.reb || 0) >= 8 ? `${s.reb} reb` : null, (s.ast || 0) >= 6 ? `${s.ast} ast` : null, (s.tpm || 0) >= 3 ? `${s.tpm} 3pm` : null, pct(s.fgm, s.fga)].filter(Boolean).slice(0, 4).join(', ');
      rows.push({ player: p, line, score: l.fp, when: l.date });
    }
  } else {
    let latest = 0;
    for (const p of players.values()) for (const l of p.log || []) latest = Math.max(latest, l.week);
    for (const p of players.values()) {
      const l = (p.log || []).find((x) => x.week === latest);
      if (!l || p.pos === 'DEF' || p.pos === 'K') continue;
      const s = l.s;
      let line;
      if (p.pos === 'QB') line = [`${s.pass_yd || 0} pass yds`, `${s.pass_td || 0} TD`, (s.rush_yd || 0) >= 30 ? `${s.rush_yd} rush` : null].filter(Boolean).join(', ');
      else if ((s.rush_yd || 0) >= (s.rec_yd || 0)) line = [`${s.rush_yd || 0} rush yds`, (s.rec_yd || 0) >= 20 ? `${s.rec_yd} rec` : null, (s.rush_td || 0) + (s.rec_td || 0) ? `${(s.rush_td || 0) + (s.rec_td || 0)} TD` : null].filter(Boolean).join(', ');
      else line = [`${s.rec || 0} rec`, `${s.rec_yd || 0} yds`, (s.rec_td || 0) ? `${s.rec_td} TD` : null].filter(Boolean).join(', ');
      rows.push({ player: p, line, score: s.pts_ppr || 0, when: `Wk ${latest}` });
    }
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}
