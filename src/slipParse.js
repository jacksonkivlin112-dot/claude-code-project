// Turns OCR text from a PrizePicks screenshot into slip legs.
import { normName } from './oddsapi.js';
import { matchMarket } from './propsModel.js';

const clean = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019`]/g, '').replace(/[^a-z0-9.+\- ]/g, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

/** Find which roster player a text line names, tolerating OCR typos. */
function findPlayer(line, roster) {
  const text = clean(line);
  if (text.length < 4) return null;
  const words = text.split(' ');
  let best = null;
  for (const p of roster) {
    const full = clean(p.name).replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = full.split(' ');
    const last = parts[parts.length - 1];
    const first = parts[0];
    let score = 0;
    if (text.replace(/-/g, ' ').includes(full)) score = 1;
    else {
      // last name (fuzzy) + first name or initial nearby
      for (let i = 0; i < words.length; i++) {
        if (words[i].length < 3 || sim(words[i], last) < 0.8) continue;
        const prevWord = words[i - 1] || '';
        const firstOk = prevWord && (sim(prevWord, first) >= 0.75 || (prevWord.replace('.', '').length === 1 && prevWord[0] === first[0]));
        score = Math.max(score, firstOk ? 0.92 : last.length >= 6 && sim(words[i], last) >= 0.95 ? 0.7 : 0);
      }
    }
    if (score > (best?.score || 0)) best = { p, score };
  }
  return best && best.score >= 0.7 ? best : null;
}

const SIDE_OVER = /\b(more|higher|over|mor)\b|▲|↑/i;
const SIDE_UNDER = /\b(less|lower|under)\b|▼|↓/i;

/**
 * @param text    raw OCR text
 * @param roster  [{ name, ... }] players with projections
 * @param aliases market alias table for matchMarket
 */
export function parseSlipText(text, roster, aliases) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const hits = [];
  lines.forEach((l, i) => {
    const m = findPlayer(l, roster);
    if (m && !(hits.length && hits[hits.length - 1].idx === i - 1 && hits[hits.length - 1].p.id === m.p.id)) hits.push({ idx: i, ...m });
  });
  const legs = [];
  const seen = new Set();
  hits.forEach((h, k) => {
    const end = Math.min(lines.length, (hits[k + 1]?.idx ?? lines.length), h.idx + 6);
    const windowLines = lines.slice(h.idx, end);
    // Take the stat and number from the lines closest to the player name.
    let mk = null;
    let line = null;
    for (const l of windowLines) {
      if (!mk) mk = matchMarket(clean(l), aliases);
      if (line == null) {
        const nums = [...l.replace(/\d{1,2}:\d{2}/g, ' ').replace(/#\d+/g, ' ').replace(/\$\d+(\.\d+)?/g, ' ').matchAll(/(?<![\w.])(\d{1,3}(?:\.\d)?)(?![\d%:])/g)].map((x) => parseFloat(x[1]));
        const half = nums.find((x) => Math.abs((x % 1) - 0.5) < 1e-6);
        line = half ?? null;
      }
      if (mk && line != null) break;
    }
    if (line == null) {
      const any = windowLines.join(' ').match(/(?<![\w.$])(\d{1,3})(?![\d%:.])/);
      if (any) line = parseFloat(any[1]);
    }
    const win = windowLines.join(' ');
    const side = SIDE_UNDER.test(win) && !SIDE_OVER.test(win) ? 'under' : 'over';
    const key = `${normName(h.p.name)}|${mk?.key}`;
    if (seen.has(key)) return;
    seen.add(key);
    legs.push({
      player: h.p.name,
      market: mk?.key || null,
      line,
      side,
      confidence: Math.round(100 * Math.min(1, h.score * (mk ? 1 : 0.6) * (line != null ? 1 : 0.6))),
      source: windowLines.slice(0, 3).join(' · '),
    });
  });
  return legs;
}
