// Everyone the slip reader can match: this slate's players first (they have projections),
// then every other player with games this season, so slips for other days still read.
const per = (log = []) => {
  const out = {};
  for (const l of log) for (const [k, v] of Object.entries(l.s || {})) out[k] = (out[k] || 0) + (Number(v) || 0);
  for (const k of Object.keys(out)) out[k] /= Math.max(1, log.length);
  return out;
};

export function buildRoster(sports) {
  const out = [];
  const seen = new Set();
  for (const sp of ['nfl', 'nba']) {
    const S = sports[sp];
    if (!S) continue;
    for (const r of S.rows || []) {
      if (r.pos === 'DEF') continue;
      out.push({ ...r, sport: sp, onSlate: true });
      seen.add(`${sp}:${r.id}`);
    }
    for (const p of S.ctx?.season?.players?.values() || []) {
      if (seen.has(`${sp}:${p.id}`) || p.pos === 'DEF' || !(p.log?.length || p.gp)) continue;
      out.push({ id: p.id, name: p.name, first: p.first, last: p.last, pos: p.pos, group: p.group, team: p.team, sport: sp, s: sp === 'nba' && p.avg && Object.keys(p.avg).length ? p.avg : per(p.log), onSlate: false });
    }
  }
  return out;
}

/** The team's current or next game from a league's schedule (for players not on the loaded slate). */
export function nextGame(ctx, team) {
  const now = Date.now();
  const list = (ctx?.allGames || Object.values(ctx?.gameByTeam || {})).filter((g) => g.home?.abbr === team || g.away?.abbr === team);
  return list.filter((g) => g.state !== 'post' && new Date(g.date).getTime() > now - 5 * 3600e3).sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;
}
