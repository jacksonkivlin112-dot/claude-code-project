// ESPN tennis scoreboard -> compact singles matches. Shared by the app and the data script.
export const SINGLES = { atp: "Men's Singles", wta: "Women's Singles" };
export const flagCode = (href) => href?.match(/countries\/500\/(\w+)\.png/)?.[1] || null;

/** One singles match. Sets are [games A, games B, tiebreak points?]. */
export function compactMatch(c, ev) {
  const [A, B] = [...c.competitors].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  if (!A?.athlete || !B?.athlete) return null;
  const sets = (A.linescores || []).map((ls, i) => {
    const o = B.linescores?.[i] || {};
    const tb = ls.tiebreak ?? o.tiebreak;
    const out = tb != null ? [ls.value, o.value, tb] : [ls.value, o.value];
    if (ls.winner == null && o.winner == null) out.open = true;
    return out;
  }).filter((s) => s[0] != null && s[1] != null);
  const st = c.status?.type || {};
  const pl = (x) => ({ id: x.id, name: x.athlete.displayName, short: x.athlete.shortName, flag: flagCode(x.athlete.flag?.href), seed: x.tournamentSeed ?? null, rank: x.curatedRank?.current ?? null });
  return {
    id: c.id, date: c.date, eventId: ev.id, event: ev.name, major: !!ev.major, round: c.round?.displayName || '',
    state: st.state, status: st.name, detail: st.shortDetail || st.detail || '', court: c.venue?.court || null,
    note: c.notes?.[0]?.text || null,
    a: pl(A), b: pl(B), winner: A.winner ? 'a' : B.winner ? 'b' : null, sets: sets.map((s) => (s.open ? [...s, 'open'] : [...s])),
  };
}

export function parseScoreboard(d, tour) {
  const matches = [];
  for (const ev of d.events || []) {
    for (const g of ev.groupings || []) {
      if (g.grouping?.displayName !== SINGLES[tour]) continue;
      for (const c of g.competitions || []) { const m = compactMatch(c, ev); if (m) matches.push(m); }
    }
  }
  return { matches, events: (d.events || []).map((e) => ({ id: e.id, name: e.name, major: !!e.major, start: e.date, end: e.endDate, venue: e.venue?.displayName || null })) };
}
