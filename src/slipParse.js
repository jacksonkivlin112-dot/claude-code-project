// Turns OCR text from a PrizePicks screenshot into slip legs.
import { MARKETS, MARKETS_NBA, normName } from './oddsapi.js';
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

// Typical line ranges per stat, used when a player has no projection for it.
const RANGE = {
  player_points: [4, 45], player_rebounds: [1.5, 16], player_assists: [1.5, 13], player_threes: [0.5, 6], player_blocks: [0.5, 4], player_steals: [0.5, 3.5],
  player_turnovers: [0.5, 5], player_points_rebounds_assists: [8, 60], player_points_rebounds: [6, 50], player_points_assists: [6, 50], player_rebounds_assists: [3, 24], player_blocks_steals: [0.5, 5],
  player_pass_yds: [120, 350], player_pass_tds: [0.5, 3.5], player_pass_completions: [10, 35], player_pass_attempts: [18, 45], player_pass_interceptions: [0.5, 1.5], player_pass_rush_yds: [140, 400],
  player_rush_yds: [8, 140], player_rush_attempts: [3, 25], player_receptions: [0.5, 10], player_reception_yds: [8, 130], player_rush_reception_yds: [15, 170],
  player_rush_tds: [0.5, 1.5], player_reception_tds: [0.5, 1.5], player_rush_reception_tds: [0.5, 1.5], player_pass_rush_reception_tds: [0.5, 3.5],
};

/**
 * OCR often drops or merges the decimal of a line ("24.5" -> "245" or "24"; "6.5" -> "65").
 * Lines almost always end in .5, so try the readings that restore it and keep the one that fits
 * the player's projection for that stat (or the stat's usual range).
 */
export function repairLine(raw, hadDecimal, market, player) {
  if (raw == null || hadDecimal || !market) return raw;
  const M = (player?.sport === 'nba' ? MARKETS_NBA : MARKETS)[market];
  const expect = (M && player?.s ? M.get(player.s) : null) || null;
  const [lo, hi] = RANGE[market] || [0.5, 400];
  const target = expect && expect > 0 ? expect : Math.sqrt(lo * hi);
  const cands = new Set([raw + 0.5]);
  const last = raw % 10;
  if (raw >= 10 && (last === 5 || last === 0)) cands.add(raw / 10); // decimal point lost: 245 -> 24.5
  if (raw >= 1000) cands.delete(raw + 0.5); // four digits can only be a merged decimal: 2455 -> 245.5
  cands.add(raw); // a true whole-number line, last resort
  const score = (c) => {
    let sc = Math.abs(Math.log(Math.max(c, 0.25) / Math.max(target, 0.25)));
    if (c < lo * 0.6 || c > hi * 1.6) sc += 2; // outside what sportsbooks post for this stat
    if (c % 1 === 0) sc += 0.35; // whole-number lines are rare
    return sc;
  };
  return [...cands].sort((a, b) => score(a) - score(b))[0];
}

// Words that appear in stat names, for snapping OCR near-misses ("Yatds" -> "yards").
const STAT_WORDS = ['points', 'pts', 'rebounds', 'rebs', 'reb', 'assists', 'asts', 'ast', 'made', 'threes', 'pointers', 'blocks', 'blks', 'steals', 'stls',
  'turnovers', 'pass', 'passing', 'yards', 'yds', 'rush', 'rushing', 'receiving', 'receptions', 'completions', 'attempts', 'touchdowns', 'tds', 'interceptions',
  'carries', 'fantasy', 'score', 'anytime', 'touchdown'];
/** Fix common OCR slips in stat names before matching them. */
function fixStatText(t) {
  let x = t.replace(/\b3\s*[-.–·]?\s*[p7][t7]s?\b/gi, '3-pt').replace(/\b[|il](?=(rebs?|asts?|pts|reb|ast)\b)/gi, '');
  x = x.split(/(\+|\s+)/).map((w) => {
    const lw = w.toLowerCase();
    if (lw.length < 3 || STAT_WORDS.includes(lw) || /\d/.test(lw)) return w;
    let best = null;
    for (const v of STAT_WORDS) { const sc = sim(lw, v); if (sc >= 0.66 && (!best || sc > best.sc)) best = { v, sc }; }
    return best ? best.v : w;
  }).join('');
  return x;
}

// Game header rows ("NBA DEN 114 vs IND 102 Final") sit inside a pick's area: never read numbers from them.
const HEADER = /\b[a-z]{2,4}\s*\d{1,3}\s*(vs\.?|@)\s*[a-z]{2,4}\s*\d{1,3}\b|^\s*(nba|nfl|cfb|ncaaf|nhl|mlb)\b/i;
/** Remove PrizePicks icon artifacts: the ↑/↓ arrow and goblin/demon badges read as "1™", "M™", "M245". */
const deIcon = (l) => l.replace(/\S?[™®]/g, ' ').replace(/(^|\s)[A-Za-z](\d{2,4})\b/g, '$1$2').replace(/(?<![\d.])0(\d)\b/g, '0.$1');
const LOOKS = { a: '4', A: '4', s: '5', S: '5', o: '0', O: '0', l: '1', I: '1', i: '1', z: '2', Z: '2', B: '8', g: '9', q: '9', b: '6', G: '6', T: '7' };
/** A line value read as letters after the arrow ("Mas" for 4.5): map look-alike letters back to digits. */
function lettersAsNumber(tok) {
  const m = tok.match(/^[M1↑↓]?([A-Za-z0-9]{2,3})$/);
  if (!m) return null;
  const d = [...m[1]].map((c) => (/\d/.test(c) ? c : LOOKS[c])).join('');
  if (!/^\d{2,4}$/.test(d)) return null;
  // A leading zero means the decimal point was lost: "Os" -> "05" -> 0.5.
  return /^0\d$/.test(d) ? parseFloat(`0.${d[1]}`) : parseFloat(d);
}

const SIDE_OVER = /\b(more|higher|over|mor)\b|▲|↑/i;
const SIDE_UNDER = /\b(less|lower|under)\b|▼|↓/i;

/**
 * @param text    raw OCR text
 * @param roster  [{ name, ... }] players with projections
 * @param aliases market alias table, or (player) => table for mixed-sport slips
 */
export function parseSlipText(text, roster, aliases) {
  const tableFor = typeof aliases === 'function' ? aliases : () => aliases;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const hits = [];
  lines.forEach((l, i) => {
    const m = findPlayer(l, roster);
    if (m && !(hits.length && hits[hits.length - 1].idx === i - 1 && hits[hits.length - 1].p.id === m.p.id)) hits.push({ idx: i, ...m });
  });
  // A slip is usually one league: re-match weak matches from the other league within the main one
  // (e.g. "Brooks" on an all-NBA slip is Dillon Brooks, not an NFL Brooks).
  const strong = hits.filter((h) => h.score >= 0.9 && h.p.sport);
  const counts = strong.reduce((m, h) => ({ ...m, [h.p.sport]: (m[h.p.sport] || 0) + 1 }), {});
  const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (main && main[1] >= 2 && main[1] >= strong.length * 0.6) {
    const same = roster.filter((p) => p.sport === main[0]);
    hits.forEach((h, k) => {
      if (h.p.sport === main[0] || h.score >= 1) return;
      const alt = findPlayer(lines[h.idx], same);
      if (alt) hits[k] = { ...h, ...alt };
      else hits[k] = { ...h, drop: true };
    });
  }
  const legs = [];
  const seen = new Set();
  hits.filter((h) => !h.drop).forEach((h, k, kept) => {
    const end = Math.min(lines.length, (kept[k + 1]?.idx ?? lines.length), h.idx + 6);
    const windowLines = lines.slice(h.idx, end);
    // Take the stat and number from the lines closest to the player name.
    let mk = null;
    let line = null;
    const nameParts = h.p.name.split(/\s+/).filter((w) => w.length > 1);
    // PrizePicks-style rows put the line at the end of the player's row: take the last number after the name.
    {
      const row = lines[h.idx];
      const last = h.p.name.split(/\s+/).slice(-1)[0];
      const at = row.toLowerCase().lastIndexOf(last.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
      const tail = deIcon(at >= 0 ? row.slice(at + last.length) : row).replace(/#\d+/g, ' ').replace(/\b3\s*[-.]?\s*p(oin)?t(er)?s?m?\b/gi, ' ').replace(/\d{1,2}:\d{2}\s*(am|pm)?/gi, ' ');
      // A small ".5" can land as its own token: "24 5" -> 24.5.
      const joined = tail.replace(/(\d{1,3})\s+([05])\s*$/, '$1.$2');
      const nums = [...joined.matchAll(/(?<![\w.])(\d{1,4}(?:\.\d)?)(?![\d%:])/g)].map((x) => x[1]);
      if (nums.length) {
        const withDot = nums.filter((x) => x.includes('.'));
        const raw = withDot.length ? withDot[withDot.length - 1] : nums[nums.length - 1];
        line = raw.includes('.') ? parseFloat(raw) : { raw: parseFloat(raw) };
      } else {
        const toks = tail.trim().split(/\s+/).filter(Boolean);
        const n = toks.length ? lettersAsNumber(toks[toks.length - 1]) : null;
        if (n != null) line = n % 1 ? n : { raw: n };
      }
    }
    for (const l of windowLines) {
      if (HEADER.test(l) && !l.includes(h.p.name.split(/\s+/).slice(-1)[0])) continue;
      // Match the stat without the player's own name (so "Brooks" never reads as "blocks").
      const noName = nameParts.reduce((t, w) => t.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig'), ' '), l);
      if (!mk) mk = matchMarket(clean(noName), tableFor(h.p)) || matchMarket(clean(fixStatText(noName)), tableFor(h.p));
      if (line == null) {
        // Rejoin decimals OCR split with a comma, middle dot or stray space: "24,5" "24 .5" "24·5".
        const t = l.replace(/(\d{1,3})[sS](?=\s|$)/g, '$1').replace(/(\d{1,3})\s*[,·•'`]\s*([05])(?!\d)/g, '$1.$2').replace(/(?<![\w-])(\d{1,3})-([05])(?![\d\w])/g, '$1.$2').replace(/(\d{1,3})\s+\.\s*([05])(?!\d)/g, '$1.$2');
        const nums = [...t.replace(/\d{1,2}:\d{2}/g, ' ').replace(/#\d+/g, ' ').replace(/\$\d+(\.\d+)?/g, ' ').matchAll(/(?<![\w.])(\d{1,3}(?:\.\d)?)(?![\d%:])/g)].map((x) => parseFloat(x[1]));
        const half = nums.find((x) => Math.abs((x % 1) - 0.5) < 1e-6);
        line = half ?? null;
      }
      if (mk && line != null) break;
    }
    if (line && typeof line === 'object') line = repairLine(line.raw, false, mk?.key, h.p);
    if (line == null) {
      // No clean x.5 number: take the first plain number near the name and repair its decimal.
      const text = windowLines.filter((l) => !HEADER.test(l)).map(deIcon).join(' ').replace(/(\d{1,4})[sS](?=\s|$)/g, '$1').replace(/\d{1,2}:\d{2}\s*(am|pm)?/gi, ' ').replace(/#\d+/g, ' ').replace(/\$\d+(\.\d+)?/g, ' ');
      const any = text.match(/(?<![\w.$])(\d{1,4})(?![\d%:.])/);
      if (any) line = repairLine(parseFloat(any[1]), false, mk?.key, h.p);
    }
    const win = windowLines.join(' ');
    const side = SIDE_UNDER.test(win) && !SIDE_OVER.test(win) ? 'under' : 'over';
    const key = `${h.p.sport || ''}|${normName(h.p.name)}|${mk?.key}`;
    if (seen.has(key)) return;
    seen.add(key);
    legs.push({
      sport: h.p.sport || null,
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
