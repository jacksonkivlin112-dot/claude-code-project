#!/usr/bin/env node
// Tennis snapshot: ATP + WTA rankings, this week's draws and scores, and every singles
// result since the start of last season, used to rate every player (Elo) and backtest the model.
// Writes public/data/tennis/{atp,wta}.json (app data) and {atp,wta}-history.json (all results).
// Usage: node scripts/fetch-espn-tennis.mjs [--full]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELO_START, eloExpect, kFactor, matchOutlook } from '../src/tennis/model.js';
import { parseScoreboard } from '../src/tennis/parse.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(root, 'public/data/tennis');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const FULL = process.argv.includes('--full');

async function json(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 700 * (i + 1)));
    }
  }
}
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
async function scoreboard(tour, date) {
  return parseScoreboard(await json(`${SITE}/${tour}/scoreboard${date ? `?dates=${ymd(date)}` : ''}`), tour);
}

async function pool(items, n, fn) {
  const res = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]).catch(() => null); } }));
  return res;
}

const read = async (f, fb) => { try { return JSON.parse(await readFile(resolve(DIR, f), 'utf8')); } catch { return fb; } };

async function buildTour(tour) {
  const hist = await read(`${tour}-history.json`, { matches: [] });
  const byId = new Map(hist.matches.map((m) => [m.id, m]));
  const now = new Date();
  const start = FULL || !hist.matches.length ? new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)) : new Date(now.getTime() - 12 * 864e5);
  const dates = [];
  for (let t = start.getTime(); t <= now.getTime() + 864e5; t += 2 * 864e5) dates.push(new Date(t));
  const boards = await pool(dates, 6, (d) => scoreboard(tour, d));
  for (const b of boards) for (const m of b?.matches || []) if (m.state === 'post' && m.winner) byId.set(m.id, m);
  const today = await scoreboard(tour);
  for (const m of today.matches) if (m.state === 'post' && m.winner) byId.set(m.id, m);
  const matches = [...byId.values()].sort((x, y) => new Date(x.date) - new Date(y.date));

  // Elo, with a backtest of pre-match predictions for this season.
  const rating = new Map();
  const get = (id) => rating.get(id) || { elo: ELO_START, n: 0 };
  const thisYear = String(now.getUTCFullYear());
  const preds = []; // [raw pA, a won?, bestOf, total games] for this season's rated matches
  const players = new Map();
  const touch = (pl) => {
    if (!players.has(pl.id)) players.set(pl.id, { id: pl.id, name: pl.name, short: pl.short, flag: pl.flag, w: 0, l: 0, sw: 0, sl: 0, gw: 0, gl: 0, tbw: 0, tbl: 0, dw: 0, dl: 0, recent: [] });
    const p = players.get(pl.id);
    if (pl.flag) p.flag = pl.flag;
    return p;
  };
  for (const m of matches) {
    const valid = /FINAL/.test(m.status) && m.sets.length >= 2; // walkovers and retirements don't count toward ratings
    const ra = get(m.a.id);
    const rb = get(m.b.id);
    const pA = eloExpect(ra.elo, rb.elo);
    const bestOf = m.major && tour === 'atp' ? 5 : 3;
    if (valid && m.date.startsWith(thisYear) && ra.n >= 10 && rb.n >= 10) {
      preds.push([pA, m.winner === 'a' ? 1 : 0, bestOf, m.sets.reduce((t, x) => t + x[0] + x[1], 0)]);
    }
    if (valid) {
      const y = m.winner === 'a' ? 1 : 0;
      rating.set(m.a.id, { elo: ra.elo + kFactor(ra.n) * (y - pA), n: ra.n + 1 });
      rating.set(m.b.id, { elo: rb.elo + kFactor(rb.n) * ((1 - y) - (1 - pA)), n: rb.n + 1 });
    }
    // Season stats (this year only).
    if (!m.date.startsWith(thisYear)) { touch(m.a); touch(m.b); continue; }
    for (const side of ['a', 'b']) {
      const me = touch(m[side]);
      const op = m[side === 'a' ? 'b' : 'a'];
      const win = m.winner === side;
      me[win ? 'w' : 'l'] += 1;
      let sw = 0; let sl = 0;
      for (const s of m.sets) {
        const [g1, g2] = side === 'a' ? [s[0], s[1]] : [s[1], s[0]];
        me.gw += g1; me.gl += g2;
        if (g1 > g2) sw += 1; else if (g2 > g1) sl += 1;
        if ((g1 === 7 && g2 === 6) || (g1 === 6 && g2 === 7)) me[g1 > g2 ? 'tbw' : 'tbl'] += 1;
      }
      me.sw += sw; me.sl += sl;
      if (valid && sw >= 1 && sl >= 1 && sw + sl === m.sets.length && Math.min(sw, sl) === (bestOf === 5 ? 2 : 1)) me[win ? 'dw' : 'dl'] += 1;
      me.recent.push({ id: m.id, date: m.date, event: m.event, round: m.round, opp: op.name, oppId: op.id, win, score: m.sets.map((s) => (side === 'a' ? `${s[0]}-${s[1]}` : `${s[1]}-${s[0]}`)).join(' '), ret: !/FINAL/.test(m.status) });
    }
  }
  for (const p of players.values()) {
    const r = get(p.id);
    p.elo = Math.round(r.elo);
    p.n = r.n;
    p.recent = p.recent.slice(-12).reverse();
  }

  // Rankings.
  let rankings = [];
  try {
    const r = await json(`${SITE}/${tour}/rankings`);
    rankings = (r.rankings?.[0]?.ranks || []).map((x) => ({ rank: x.current, prev: x.previous, points: x.points, id: x.athlete?.id, name: x.athlete?.displayName }));
  } catch { /* keep empty */ }
  for (const r of rankings) { const p = players.get(r.id); if (p) { p.rank = r.rank; p.points = r.points; } }

  // Only players who matter to the app: ranked, active this year, or in this week's draws.
  const inDraw = new Set(today.matches.flatMap((m) => [m.a.id, m.b.id]));
  const keep = {};
  for (const p of players.values()) {
    if (!((p.rank && p.rank <= 400) || p.w + p.l >= 8 || inDraw.has(p.id))) continue;
    keep[p.id] = { ...p, recent: p.recent.slice(0, inDraw.has(p.id) || (p.rank && p.rank <= 100) ? 10 : 5) };
  }
  // Head-to-head (all stored seasons) for every pairing in this week's draws.
  const pairs = new Set(today.matches.map((m) => [m.a.id, m.b.id].sort().join('|')));
  const h2h = {};
  for (const m of matches) {
    const k = [m.a.id, m.b.id].sort().join('|');
    if (!pairs.has(k) || !m.winner) continue;
    (h2h[k] ||= []).push({ date: m.date, event: m.event, round: m.round, winner: m[m.winner].id, score: m.sets.map((s) => `${s[0]}-${s[1]}`).join(' '), aId: m.a.id });
  }

  // Calibration: Elo is overconfident, so shrink toward 50%: p' = 0.5 + (p - 0.5) * shrink.
  // Fit on the first two-thirds of the season, then report on the last third (out of sample).
  const ll = (rows, k) => rows.reduce((a, [p, y]) => { const q = 0.5 + (p - 0.5) * k; return a - Math.log(Math.max(1e-6, y ? q : 1 - q)); }, 0);
  const cut = Math.floor(preds.length * 0.67);
  let shrink = 1;
  for (let k = 0.5; k <= 1.0001; k += 0.01) if (ll(preds.slice(0, cut), k) < ll(preds.slice(0, cut), shrink)) shrink = Math.round(k * 100) / 100;
  const evalRows = preds.slice(cut);
  const summary = (rows, k) => {
    const buckets = Array.from({ length: 5 }, (_, i) => ({ lo: 0.5 + i * 0.1, n: 0, hit: 0, exp: 0 }));
    let correct = 0; let brier = 0;
    for (const [p, y] of rows) {
      const q = 0.5 + (p - 0.5) * k;
      const fav = q >= 0.5 ? 1 : 0;
      const pf = Math.max(q, 1 - q);
      correct += y === fav ? 1 : 0;
      brier += (q - y) ** 2;
      const b = buckets[Math.min(4, Math.floor((pf - 0.5) / 0.1))];
      b.n += 1; b.hit += y === fav ? 1 : 0; b.exp += pf;
    }
    return { n: rows.length, accuracy: correct / rows.length, brier: brier / rows.length, logloss: ll(rows, k) / rows.length, calibration: buckets.filter((b) => b.n).map((b) => ({ lo: Math.round(b.lo * 100) / 100, n: b.n, rate: b.hit / b.n, expected: b.exp / b.n })) };
  };
  let gamesErr = 0; let gamesN = 0;
  for (const [p, , bo, total] of evalRows.slice(-800)) { gamesErr += Math.abs(matchOutlook(0.5 + (p - 0.5) * shrink, bo).meanGames - total); gamesN += 1; }
  const btOut = evalRows.length ? { ...summary(evalRows, shrink), raw: summary(evalRows, 1), shrink, fitN: cut, gamesMae: gamesN ? gamesErr / gamesN : null } : null;
  await writeFile(resolve(DIR, `${tour}-history.json`), JSON.stringify({ generatedAt: new Date().toISOString(), matches }));
  await writeFile(resolve(DIR, `${tour}.json`), JSON.stringify({
    generatedAt: new Date().toISOString(), tour, events: today.events, matches: today.matches, players: keep, rankings, backtest: btOut, h2h, shrink: btOut?.shrink ?? 1,
  }));
  console.log(`${tour.toUpperCase()}: ${matches.length} results, ${Object.keys(keep).length} players, ${today.matches.length} matches this week. Backtest (out of sample): ${btOut ? `${(btOut.accuracy * 100).toFixed(1)}% of ${btOut.n}, shrink ${btOut.shrink}, logloss ${btOut.raw.logloss.toFixed(3)} -> ${btOut.logloss.toFixed(3)}, games MAE ${btOut.gamesMae?.toFixed(2)}` : 'n/a'}`);
}

await mkdir(DIR, { recursive: true });
for (const tour of ['atp', 'wta']) {
  try { await buildTour(tour); } catch (e) { console.warn(`${tour}: ${e.message}`); }
}
