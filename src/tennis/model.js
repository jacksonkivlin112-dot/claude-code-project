// Tennis model, shared by the browser and scripts/fetch-espn-tennis.mjs (pure JS, no browser APIs).
//
// 1. Elo ratings from every completed singles match (FiveThirtyEight-style decaying K).
// 2. The Elo win chance is turned into q = chance the player wins any single game,
//    so a game-by-game chain reproduces it. That chain then gives set-score odds,
//    total-games odds and live win chances from any score.

export const ELO_START = 1500;
export const kFactor = (n) => 250 / (n + 5) ** 0.4;
export const eloExpect = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

// Tiebreaks are closer to a coin flip than regular games.
const tbProb = (q) => 0.5 + (q - 0.5) * 0.9;

/**
 * Final set-score distribution from games (x, y) in the current set.
 * -> Map "x-y" -> probability (A's games first).
 */
export function setScoreDist(q, x = 0, y = 0) {
  const out = new Map();
  const walk = (a, b, pr) => {
    if (pr < 1e-9) return;
    const key = `${a}-${b}`;
    if ((a >= 6 && a - b >= 2) || a === 7 || (b >= 6 && b - a >= 2) || b === 7) {
      out.set(key, (out.get(key) || 0) + pr);
      return;
    }
    if (a === 6 && b === 6) {
      const t = tbProb(q);
      out.set('7-6', (out.get('7-6') || 0) + pr * t);
      out.set('6-7', (out.get('6-7') || 0) + pr * (1 - t));
      return;
    }
    walk(a + 1, b, pr * q);
    walk(a, b + 1, pr * (1 - q));
  };
  walk(x, y, 1);
  return out;
}

const setWinProb = (q, x = 0, y = 0) => {
  let p = 0;
  for (const [k, v] of setScoreDist(q, x, y)) { const [a, b] = k.split('-').map(Number); if (a > b) p += v; }
  return p;
};

/** Chance A wins the match from sets (a, b) and games (x, y) in the current set. */
export function matchWinProb(q, bestOf = 3, a = 0, b = 0, x = 0, y = 0) {
  const need = bestOf === 5 ? 3 : 2;
  const s0 = setWinProb(q, 0, 0);
  const memo = new Map();
  const fromSets = (sa, sb) => {
    if (sa >= need) return 1;
    if (sb >= need) return 0;
    const k = `${sa}-${sb}`;
    if (!memo.has(k)) memo.set(k, s0 * fromSets(sa + 1, sb) + (1 - s0) * fromSets(sa, sb + 1));
    return memo.get(k);
  };
  if (a >= need) return 1;
  if (b >= need) return 0;
  if (x === 0 && y === 0) return fromSets(a, b);
  const sc = setWinProb(q, x, y);
  return sc * fromSets(a + 1, b) + (1 - sc) * fromSets(a, b + 1);
}

/** Game win chance q that makes the match win chance equal p. */
export function gameProbFor(p, bestOf = 3) {
  let lo = 0.2;
  let hi = 0.8;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (matchWinProb(mid, bestOf) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Everything about a matchup from A's point of view.
 * -> { p, q, setScores: [{a, b, p}], totalGames: Map(total -> p), meanGames, straightSets, winASet, winBSet }
 */
export function matchOutlook(p, bestOf = 3) {
  const q = gameProbFor(p, bestOf);
  const need = bestOf === 5 ? 3 : 2;
  const sd = setScoreDist(q);
  const aSets = [];
  const bSets = [];
  for (const [k, v] of sd) { const [x, y] = k.split('-').map(Number); (x > y ? aSets : bSets).push({ games: x + y, p: v }); }
  // DP over (setsA, setsB, total games).
  let states = new Map([['0|0|0', 1]]);
  const finals = new Map();
  const setScores = new Map();
  for (let guard = 0; guard < 10 && states.size; guard++) {
    const next = new Map();
    for (const [k, pr] of states) {
      const [sa, sb, g] = k.split('|').map(Number);
      for (const [list, isA] of [[aSets, true], [bSets, false]]) {
        for (const s of list) {
          const na = sa + (isA ? 1 : 0);
          const nb = sb + (isA ? 0 : 1);
          const ng = g + s.games;
          const pp = pr * s.p;
          if (na === need || nb === need) {
            finals.set(ng, (finals.get(ng) || 0) + pp);
            const sk = `${na}-${nb}`;
            setScores.set(sk, (setScores.get(sk) || 0) + pp);
          } else {
            const nk = `${na}|${nb}|${ng}`;
            next.set(nk, (next.get(nk) || 0) + pp);
          }
        }
      }
    }
    states = next;
  }
  let meanGames = 0;
  for (const [g, v] of finals) meanGames += g * v;
  const scores = [...setScores.entries()].map(([k, v]) => { const [a, b] = k.split('-').map(Number); return { a, b, p: v }; }).sort((x, y) => y.p - x.p);
  return {
    p, q, bestOf,
    setScores: scores,
    totalGames: finals,
    meanGames,
    straightSetsA: setScores.get(`${need}-0`) || 0,
    straightSetsB: setScores.get(`0-${need}`) || 0,
    goesDistance: (setScores.get(`${need}-${need - 1}`) || 0) + (setScores.get(`${need - 1}-${need}`) || 0),
  };
}

/** P(total games > line) from an outlook's distribution. */
export function overProb(outlook, line) {
  let p = 0;
  for (const [g, v] of outlook.totalGames) if (g > line) p += v;
  return p;
}

/** Fair American odds for a probability. */
export const americanOdds = (p) => (p <= 0 || p >= 1 ? '—' : p >= 0.5 ? `-${Math.round((p / (1 - p)) * 100)}` : `+${Math.round(((1 - p) / p) * 100)}`);

/**
 * Joint distribution of final games (A's games, B's games) for an outlook.
 * -> Map "ga|gb" -> probability
 */
export function gamesJoint(outlook) {
  if (outlook._joint) return outlook._joint;
  const need = outlook.bestOf === 5 ? 3 : 2;
  const sets = [...setScoreDist(outlook.q)].map(([k, v]) => { const [x, y] = k.split('-').map(Number); return { x, y, p: v }; });
  let states = new Map([['0|0|0|0', 1]]);
  const out = new Map();
  for (let guard = 0; guard < 6 && states.size; guard++) {
    const next = new Map();
    for (const [k, pr] of states) {
      const [sa, sb, ga, gb] = k.split('|').map(Number);
      for (const s of sets) {
        const pp = pr * s.p;
        if (pp < 1e-10) continue;
        const na = sa + (s.x > s.y ? 1 : 0);
        const nb = sb + (s.x > s.y ? 0 : 1);
        const key = (na === need || nb === need) ? `${ga + s.x}|${gb + s.y}` : null;
        if (key) out.set(key, (out.get(key) || 0) + pp);
        else { const nk = `${na}|${nb}|${ga + s.x}|${gb + s.y}`; next.set(nk, (next.get(nk) || 0) + pp); }
      }
    }
    states = next;
  }
  outlook._joint = out;
  return out;
}

/** P(f(ga, gb) > line) over the joint games distribution. */
export function jointProb(outlook, f, line) {
  let p = 0; let mean = 0;
  for (const [k, v] of gamesJoint(outlook)) { const [a, b] = k.split('|').map(Number); const x = f(a, b); mean += x * v; if (x > line) p += v; }
  return { p, mean };
}

/** Highest x.5 line whose "over" still hits with at least `target` chance. */
export function safeOverLine(outlook, f, target = 0.75) {
  const vals = new Map();
  for (const [k, v] of gamesJoint(outlook)) { const [a, b] = k.split('|').map(Number); const x = f(a, b); vals.set(x, (vals.get(x) || 0) + v); }
  const xs = [...vals.keys()].sort((a, b) => a - b);
  let best = null;
  for (const x of xs) {
    const line = x - 0.5;
    let p = 0; for (const [y, v] of vals) if (y > line) p += v;
    if (p >= target) best = { line, p }; else break;
  }
  return best;
}
