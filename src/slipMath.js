// Slip-level math: hit-count distribution, payout EV, break-evens, Kelly, odds.

// PrizePicks' standard multipliers. Promotions and some states differ, so the
// UI shows these as editable assumptions.
export const PAYOUTS = {
  power: { 2: 3, 3: 6, 4: 10, 5: 20, 6: 37.5 },
  flex: {
    3: { 3: 3, 2: 1 },
    4: { 4: 6, 3: 1.5 },
    5: { 5: 10, 4: 2, 3: 0.4 },
    6: { 6: 25, 5: 2, 4: 0.4 },
  },
};

/** P(exactly k of n independent legs hit), k = 0..n. */
export function hitDistribution(probs) {
  let dist = [1];
  for (const p of probs) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => {
      next[k] += v * (1 - p);
      next[k + 1] += v * p;
    });
    dist = next;
  }
  return dist;
}

export function evPower(probs, table = PAYOUTS.power) {
  const mult = table[probs.length];
  if (!mult) return null;
  const pAll = probs.reduce((a, p) => a * p, 1);
  return { mult, pAll, ev: pAll * mult - 1 };
}

export function evFlex(probs, table = PAYOUTS.flex) {
  const t = table[probs.length];
  if (!t) return null;
  const dist = hitDistribution(probs);
  let ret = 0;
  for (const [k, m] of Object.entries(t)) ret += (dist[Number(k)] || 0) * m;
  const pCash = Object.keys(t).reduce((a, k) => a + (dist[Number(k)] || 0), 0);
  const pProfit = Object.entries(t).filter(([, m]) => m > 1).reduce((a, [k]) => a + (dist[Number(k)] || 0), 0);
  return { table: t, ev: ret - 1, pCash, pProfit };
}

/** Per-leg win rate at which the entry breaks even (all legs equal). */
export function breakEvenPower(n, table = PAYOUTS.power) {
  const m = table[n];
  return m ? (1 / m) ** (1 / n) : null;
}

export function breakEvenFlex(n, table = PAYOUTS.flex) {
  if (!table[n]) return null;
  let lo = 0.3;
  let hi = 0.95;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (evFlex(new Array(n).fill(mid), table).ev > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Kelly stake as a fraction of bankroll for a single binary payout. */
export function kelly(p, mult) {
  const b = mult - 1;
  if (b <= 0) return 0;
  return Math.max(0, (b * p - (1 - p)) / b);
}

export function americanOdds(p) {
  if (p <= 0 || p >= 1) return '—';
  return p >= 0.5 ? `${Math.round((-100 * p) / (1 - p))}` : `+${Math.round((100 * (1 - p)) / p)}`;
}

// Inverse normal CDF (Acklam's approximation).
export function normInv(p) {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function poissonQuantile(lambda, q) {
  let k = 0;
  let term = Math.exp(-lambda);
  let cdf = term;
  while (cdf < q && k < 200) { k += 1; term *= lambda / k; cdf += term; }
  return k;
}

/** Outcome percentiles for a leg's modelled distribution. */
export function quantiles(dist, mean, sd, qs = [0.1, 0.25, 0.5, 0.75, 0.9]) {
  return qs.map((q) => (dist === 'poisson' ? poissonQuantile(Math.max(mean, 0.01), q) : Math.max(0, mean + normInv(q) * sd)));
}
