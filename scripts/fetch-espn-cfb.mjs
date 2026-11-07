#!/usr/bin/env node
// College football (FBS) snapshot from ESPN, shaped like the NFL data so the same screens work:
//   public/data/cfb/espn.json      teams, standings, every game (with lines), Top 25, team ratings,
//                                  game picks and the model backtests
//   public/data/cfb/week-N.json    player box-score rows for week N (NFL row shape)
//   public/data/cfb/proj-N.json    projected rows for the current week
//   public/data/cfb/positions.json roster positions (refreshed weekly)
// Incremental: only games without a stored box score are fetched. Usage: node scripts/fetch-espn-cfb.mjs [--full]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvent } from '../src/espn.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(root, 'public/data/cfb');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
const FULL = process.argv.includes('--full');
const id = (x) => x;

async function json(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
}
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}
const read = async (f, fb) => { try { return JSON.parse(await readFile(resolve(DIR, f), 'utf8')); } catch { return fb; } };
const write = (f, v) => writeFile(resolve(DIR, f), JSON.stringify(v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

await mkdir(DIR, { recursive: true });
const cur = await json(`${SITE}/scoreboard?groups=80&limit=400`);
const season = cur.season?.year;
const seasonType = cur.season?.type ?? 2;
const curWeek = cur.week?.number ?? 1;
const lastWeek = seasonType === 2 ? Math.min(curWeek + 1, 16) : curWeek;

// ---- Schedule, teams, Top 25 -------------------------------------------------
const teams = {};
const games = [];
const boards = await pool(Array.from({ length: lastWeek }, (_, i) => i + 1), 6, (w) => json(`${SITE}/scoreboard?groups=80&limit=400&week=${w}&seasontype=2&dates=${season}`));
boards.forEach((b, i) => {
  for (const e of b?.events || []) {
    const g = parseEvent(e, id, i + 1);
    g.week = i + 1;
    for (const k of e.competitions[0].competitors) {
      const t = k.team;
      if (!teams[t.abbreviation]) {
        teams[t.abbreviation] = {
          espnId: t.id, abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName || t.name, location: t.location,
          color: t.color ? `#${t.color}` : '#64748b', alt: t.alternateColor ? `#${t.alternateColor}` : '#94a3b8',
          logo: t.logo || `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png`, conf: t.conferenceId || null,
        };
      }
    }
    games.push(g);
  }
});
let top25 = [];
try {
  const r = await json(`${SITE}/rankings`);
  const poll = r.rankings.find((x) => /playoff/i.test(x.name)) || r.rankings[0];
  top25 = { name: poll.name, ranks: poll.ranks.slice(0, 25).map((x) => ({ rank: x.current, prev: x.previous, abbr: x.team.abbreviation, record: x.recordSummary || '' })) };
} catch { /* optional */ }

// ---- Box scores ----------------------------------------------------------------
const store = await read('boxes.json', { games: {} }); // gameId -> { week, rows, line }
if (FULL) store.games = {};
const needBox = games.filter((g) => g.state === 'post' && !store.games[g.id]);
console.log(`CFB ${season}: week ${curWeek}, ${games.length} games, fetching ${needBox.length} box scores...`);
const CAT = {
  passing: { 'completions/passingAttempts': (s, v) => { const [c, a] = String(v).split('/'); s.pass_cmp = num(c); s.pass_att = num(a); }, passingYards: 'pass_yd', passingTouchdowns: 'pass_td', interceptions: 'pass_int' },
  rushing: { rushingAttempts: 'rush_att', rushingYards: 'rush_yd', rushingTouchdowns: 'rush_td' },
  receiving: { receptions: 'rec', receivingYards: 'rec_yd', receivingTouchdowns: 'rec_td' },
  fumbles: { fumblesLost: 'fum_lost' },
};
await pool(needBox, 8, async (g) => {
  const d = await json(`${SITE}/summary?event=${g.id}`);
  if (!d) return;
  const players = new Map();
  for (const tb of d.boxscore?.players || []) {
    const team = tb.team?.abbreviation;
    const opp = team === g.home.abbr ? g.away.abbr : g.home.abbr;
    for (const cat of tb.statistics || []) {
      const map = CAT[cat.name];
      if (!map) continue;
      for (const a of cat.athletes || []) {
        const aid = a.athlete?.id;
        if (!aid) continue;
        if (!players.has(aid)) players.set(aid, { id: aid, name: a.athlete.displayName, team, opp, s: {} });
        const row = players.get(aid);
        cat.keys.forEach((k, i) => {
          const f = map[k];
          if (!f) return;
          if (typeof f === 'function') f(row.s, a.stats[i]); else row.s[f] = num(a.stats[i]);
        });
      }
    }
  }
  const pc = d.pickcenter?.[0];
  store.games[g.id] = {
    week: g.week,
    rows: [...players.values()],
    line: pc ? { details: pc.details || null, spread: pc.spread ?? null, overUnder: pc.overUnder ?? null, homeFav: pc.homeTeamOdds?.favorite ?? null } : null,
  };
});
await write('boxes.json', store);

// ---- Positions (rosters) -------------------------------------------------------
const pos = await read('positions.json', { at: 0, players: {} });
const teamIds = [...new Set(Object.values(store.games).flatMap((x) => x.rows.map((r) => r.team)))].map((a) => teams[a]?.espnId).filter(Boolean);
if (FULL || Date.now() - pos.at > 6 * 864e5 || !Object.keys(pos.players).length) {
  const POS = { QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE' };
  await pool(teamIds, 8, async (tid) => {
    const r = await json(`${SITE}/teams/${tid}/roster`);
    for (const grp of r?.athletes || []) for (const a of grp.items || [grp]) {
      const p = POS[a.position?.abbreviation];
      if (p && a.id) pos.players[a.id] = { pos: p, first: a.firstName, last: a.lastName, jersey: a.jersey || null, year: a.experience?.displayValue || null };
    }
  });
  pos.at = Date.now();
  await write('positions.json', pos);
}
const guessPos = (s) => ((s.pass_att || 0) >= 5 ? 'QB' : (s.rush_att || 0) > (s.rec || 0) * 1.5 ? 'RB' : 'WR');

// ---- Weekly rows in the NFL row shape -----------------------------------------
const fantasy = (s, ppr) => 0.04 * (s.pass_yd || 0) + 4 * (s.pass_td || 0) - 2 * (s.pass_int || 0) + 0.1 * ((s.rush_yd || 0) + (s.rec_yd || 0)) + 6 * ((s.rush_td || 0) + (s.rec_td || 0)) - 2 * (s.fum_lost || 0) + ppr * (s.rec || 0);
const finish = (s) => {
  for (const k of Object.keys(s)) s[k] = Math.round(s[k] * 100) / 100;
  s.pts_std = Math.round(fantasy(s, 0) * 100) / 100;
  s.pts_half_ppr = Math.round(fantasy(s, 0.5) * 100) / 100;
  s.pts_ppr = Math.round(fantasy(s, 1) * 100) / 100;
  return s;
};
// Compact: zero stats dropped, names split client-side.
const slim = (s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v));
const rowOf = (r) => ({ id: r.id, name: r.name, pos: pos.players[r.id]?.pos || guessPos(r.s), team: r.team, opp: r.opp, s: slim(finish({ ...r.s, gp: 1 })) });
const meaningful = (r) => (r.s.pass_att || 0) + (r.s.rush_att || 0) + (r.s.rec || 0) > 0;
const byWeek = {};
const gameDate = Object.fromEntries(games.map((g) => [g.id, g.date]));
for (const [gid, gm] of Object.entries(store.games)) {
  (byWeek[gm.week] ||= []).push(...gm.rows.filter((r) => meaningful(r) && ['QB', 'RB', 'WR', 'TE'].includes(pos.players[r.id]?.pos || guessPos(r.s))).map((r) => rowOf(r)));
}
for (const [w, rows] of Object.entries(byWeek)) await write(`week-${w}.json`, rows);

// ---- Team ratings (points) with an out-of-sample backtest ----------------------
// Warm up on last season (regular season + bowls), then regress a third toward average.
let prior = await read('prior.json', null);
if (!prior || prior.season !== season - 1) {
  const b2 = await pool(Array.from({ length: 17 }, (_, i) => i + 1), 6, (w) => json(`${SITE}/scoreboard?groups=80&limit=400&week=${w}&seasontype=${w === 17 ? 3 : 2}&dates=${season - 1}`));
  prior = { season: season - 1, games: b2.flatMap((b) => (b?.events || []).map((e) => parseEvent(e, id))).filter((g) => g.state === 'post' && g.home.score != null).map((g) => ({ date: g.date, neutral: g.neutral, home: { abbr: g.home.abbr, score: g.home.score }, away: { abbr: g.away.abbr, score: g.away.score } })) };
  await write('prior.json', prior);
}
const HFA = Number(process.env.CFB_HFA || 2.5);
const K0 = Number(process.env.CFB_K || 0.25); // tuned on the backtest (0.18-0.7 tried)
const done = games.filter((g) => g.state === 'post' && g.home.score != null).sort((a, b) => new Date(a.date) - new Date(b.date));
const R = {}; // abbr -> { r: margin rating, o: offense, d: defense, n }
const get = (a) => (R[a] ||= { r: teams[a] ? 0 : -14, o: 0, d: 0, n: 0 });
let avgPts = 28;
const step = (g, H, A) => {
  const hfa = g.neutral ? 0 : HFA;
  const pred = H.r - A.r + hfa;
  const predH = avgPts + H.o - A.d + hfa / 2;
  const predA = avgPts + A.o - H.d - hfa / 2;
  const k = (n) => Math.max(0.08, K0 / Math.sqrt(n + 1));
  const err = Math.max(-28, Math.min(28, g.home.score - g.away.score - pred));
  H.r += k(H.n) * err; A.r -= k(A.n) * err;
  const eH = Math.max(-24, Math.min(24, g.home.score - predH));
  const eA = Math.max(-24, Math.min(24, g.away.score - predA));
  H.o += k(H.n) * eH * 0.5; A.d += k(A.n) * eH * 0.5;
  A.o += k(A.n) * eA * 0.5; H.d += k(H.n) * eA * 0.5;
  avgPts += 0.01 * ((g.home.score + g.away.score) / 2 - avgPts);
  H.n += 1; A.n += 1;
};
for (const g of prior.games.sort((a, b) => new Date(a.date) - new Date(b.date))) step(g, get(g.home.abbr), get(g.away.abbr));
for (const x of Object.values(R)) { x.r *= 0.67; x.o *= 0.67; x.d *= 0.67; x.n = Math.min(x.n, 4); }
const bt = { n: 0, correct: 0, rows: [], ats: { n: 0, hit: 0 }, ou: { n: 0, hit: 0 } };
for (const g of done) {
  const H = get(g.home.abbr); const A = get(g.away.abbr);
  const hfa = g.neutral ? 0 : HFA;
  const pred = H.r - A.r + hfa;
  const predH = avgPts + H.o - A.d + hfa / 2;
  const predA = avgPts + A.o - H.d - hfa / 2;
  const margin = g.home.score - g.away.score;
  const total = g.home.score + g.away.score;
  if (g.week >= 2 && H.n >= 3 && A.n >= 3) {
    bt.n += 1;
    if ((pred > 0) === (margin > 0)) bt.correct += 1;
    bt.rows.push([pred, margin > 0 ? 1 : 0]);
    const line = store.games[g.id]?.line;
    if (line?.spread != null) {
      // ESPN spread is from the home side (negative = home favored).
      const homeLine = -line.spread;
      const edge = pred - homeLine;
      const cover = margin - homeLine;
      if (Math.abs(edge) >= 3 && cover !== 0) { bt.ats.n += 1; if ((edge > 0) === (cover > 0)) bt.ats.hit += 1; }
    }
    if (line?.overUnder != null) {
      const edge = predH + predA - line.overUnder;
      const over = total - line.overUnder;
      if (Math.abs(edge) >= 3 && over !== 0) { bt.ou.n += 1; if ((edge > 0) === (over > 0)) bt.ou.hit += 1; }
    }
  }
  step(g, H, A);
}
// Fit the win-probability spread (sigma) by log loss on the backtest.
const Phi = (z) => 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
let sigma = 14;
let best = Infinity;
for (let s = 8; s <= 24; s += 0.5) {
  const ll = bt.rows.reduce((a, [p, y]) => { const q = Math.min(0.99, Math.max(0.01, Phi(p / s))); return a - Math.log(y ? q : 1 - q); }, 0);
  if (ll < best) { best = ll; sigma = s; }
}
const calib = Array.from({ length: 5 }, (_, i) => ({ lo: 0.5 + i * 0.1, n: 0, hit: 0, exp: 0 }));
for (const [p, y] of bt.rows) {
  const q = Phi(p / sigma); const fav = q >= 0.5 ? 1 : 0; const pf = Math.max(q, 1 - q);
  const b = calib[Math.min(4, Math.floor((pf - 0.5) / 0.1))]; b.n += 1; b.hit += y === fav ? 1 : 0; b.exp += pf;
}

// ---- This week's game picks -----------------------------------------------------
const upcoming = games.filter((g) => g.week === curWeek && g.state !== 'post');
const odds = await pool(upcoming, 8, async (g) => {
  const d = await json(`${CORE}/events/${g.id}/competitions/${g.id}/odds`);
  const it = d?.items?.find((x) => x.provider?.id === '100') || d?.items?.[0];
  return it ? { details: it.details || null, spread: it.spread ?? null, overUnder: it.overUnder ?? null } : null;
});
const picks = upcoming.map((g, i) => {
  const H = get(g.home.abbr); const A = get(g.away.abbr);
  const hfa = g.neutral ? 0 : HFA;
  const pred = H.r - A.r + hfa;
  const pH = avgPts + H.o - A.d + hfa / 2;
  const pA = avgPts + A.o - H.d - hfa / 2;
  const line = odds[i] || g.line;
  if (line) g.line = line;
  return {
    id: g.id, home: g.home.abbr, away: g.away.abbr, date: g.date, predMargin: Math.round(pred * 10) / 10,
    homeWin: Math.round(Phi(pred / sigma) * 1000) / 1000, predHome: Math.round(pH * 10) / 10, predAway: Math.round(pA * 10) / 10,
    line, thin: H.n < 3 || A.n < 3,
  };
});

// ---- Standings (from results) --------------------------------------------------
const st = {};
for (const g of done) {
  for (const [me, them] of [[g.home, g.away], [g.away, g.home]]) {
    if (!teams[me.abbr]) continue;
    const s = (st[me.abbr] ||= { abbr: me.abbr, conf: teams[me.abbr].conf, div: '', wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, gp: 0 });
    s.gp += 1; s.pf += me.score; s.pa += them.score;
    if (me.score > them.score) s.wins += 1; else if (me.score < them.score) s.losses += 1; else s.ties += 1;
  }
}
const standings = Object.values(st).map((s) => ({ ...s, pct: s.gp ? s.wins / s.gp : 0, diff: s.pf - s.pa, ppg: s.gp ? s.pf / s.gp : null, oppg: s.gp ? s.pa / s.gp : null, streak: '', seed: null, home: '', road: '', divRec: '', confRec: '', last10: '', gb: '' }));

// ---- Projections for the current week ------------------------------------------
const allRows = Object.keys(byWeek).map(Number).sort((a, b) => a - b).flatMap((w) => byWeek[w].map((r) => ({ ...r, week: w })));
const byPlayer = new Map();
for (const r of allRows) { if (!byPlayer.has(r.id)) byPlayer.set(r.id, []); byPlayer.get(r.id).push(r); }
// Defense factors: yards allowed per game vs league average.
const allowed = {};
for (const r of allRows) { const a = (allowed[r.opp] ||= { pass: 0, rush: 0, games: new Set() }); a.pass += r.s.pass_yd || 0; a.rush += r.s.rush_yd || 0; a.games.add(r.week); }
const lg = Object.values(allowed).filter((a) => a.games.size >= 3);
const lgPass = lg.reduce((x, a) => x + a.pass / a.games.size, 0) / Math.max(1, lg.length);
const lgRush = lg.reduce((x, a) => x + a.rush / a.games.size, 0) / Math.max(1, lg.length);
const defF = (opp, kind) => {
  const a = allowed[opp];
  if (!a || a.games.size < 3) return 1;
  const f = (kind === 'pass' ? a.pass / a.games.size / lgPass : a.rush / a.games.size / lgRush);
  return Math.max(0.8, Math.min(1.2, 1 + (f - 1) * 0.5));
};
const STATS = ['pass_att', 'pass_cmp', 'pass_yd', 'pass_td', 'pass_int', 'rush_att', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td', 'fum_lost'];
const proj = [];
const teamGamesPlayed = {};
for (const s of standings) teamGamesPlayed[s.abbr] = s.gp;
for (const pk of picks) {
  for (const [team, opp, ptsFor] of [[pk.home, pk.away, pk.predHome], [pk.away, pk.home, pk.predAway]]) {
    const avgFor = st[team]?.gp ? st[team].pf / st[team].gp : null;
    const line = pk.line;
    let implied = null;
    if (line?.overUnder != null && line?.spread != null) implied = team === pk.home ? line.overUnder / 2 - line.spread / 2 : line.overUnder / 2 + line.spread / 2;
    const target = implied ?? ptsFor;
    const pace = avgFor ? Math.max(0.75, Math.min(1.3, 1 + (target / avgFor - 1) * 0.6)) : 1;
    for (const [pid, rows] of byPlayer) {
      const mine = rows.filter((r) => r.team === team);
      if (!mine.length) continue;
      const recent = mine.slice(-3);
      const lastTeamWeek = Math.max(...allRows.filter((r) => r.team === team).map((r) => r.week));
      if (mine[mine.length - 1].week < lastTeamWeek - 2) continue; // hasn't played lately
      const s = {};
      for (const k of STATS) {
        const season = mine.reduce((a, r) => a + (r.s[k] || 0), 0) / mine.length;
        const last3 = recent.reduce((a, r) => a + (r.s[k] || 0), 0) / recent.length;
        let v = 0.5 * season + 0.5 * last3;
        if (k.startsWith('pass') || k.startsWith('rec')) v *= defF(opp, 'pass');
        if (k.startsWith('rush')) v *= defF(opp, 'rush');
        if (k !== 'pass_int' && k !== 'fum_lost') v *= pace;
        s[k] = v;
      }
      const base = mine[mine.length - 1];
      const out = { id: base.id, name: base.name, pos: base.pos, team, opp, gameDate: pk.date, s: slim(finish({ ...s, gp: 1 })) };
      if (out.s.pts_ppr >= 1) proj.push(out);
    }
  }
}
await write(`proj-${curWeek}.json`, proj.sort((a, b) => b.s.pts_ppr - a.s.pts_ppr));

await write('espn.json', {
  generatedAt: new Date().toISOString(), season, seasonType, week: curWeek, teams, standings, games, top25,
  ratings: Object.fromEntries(Object.entries(R).filter(([a]) => teams[a]).map(([a, x]) => [a, { r: Math.round(x.r * 10) / 10, o: Math.round(x.o * 10) / 10, d: Math.round(x.d * 10) / 10, n: x.n }])),
  picks,
  backtest: {
    n: bt.n, accuracy: bt.n ? bt.correct / bt.n : null, sigma,
    calibration: calib.filter((b) => b.n).map((b) => ({ lo: Math.round(b.lo * 100) / 100, n: b.n, rate: b.hit / b.n, expected: b.exp / b.n })),
    ats: { n: bt.ats.n, rate: bt.ats.n ? bt.ats.hit / bt.ats.n : null },
    ou: { n: bt.ou.n, rate: bt.ou.n ? bt.ou.hit / bt.ou.n : null },
  },
  weeksWithStats: Object.keys(byWeek).map(Number).sort((a, b) => a - b),
});
console.log(`Wrote CFB: ${Object.keys(teams).length} teams, ${allRows.length} player-games over ${Object.keys(byWeek).length} weeks, ${proj.length} projections for week ${curWeek}. Backtest: winners ${(bt.correct / Math.max(1, bt.n) * 100).toFixed(1)}% of ${bt.n}, sigma ${sigma}, ATS ${bt.ats.n ? (bt.ats.hit / bt.ats.n * 100).toFixed(1) : '-'}% of ${bt.ats.n}, O/U ${bt.ou.n ? (bt.ou.hit / bt.ou.n * 100).toFixed(1) : '-'}% of ${bt.ou.n}`);
