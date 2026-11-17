// Picks the most clippable moments from a transcript: hype (loudness spikes), reaction words,
// fast talking, no dead air, and clean sentence boundaries at both ends.

const HYPE = ['no way', 'oh my god', 'omg', 'what the', 'bro', 'bruh', 'crazy', 'insane', 'wild', 'yo', 'holy', 'dude', 'wow', 'literally',
  'lets go', "let's go", 'chat', 'nah', 'deadass', 'fr', 'hell', 'shut up', 'stop', 'wait', 'look', 'what', 'why', 'never', 'craziest', 'best', 'worst',
  'scared', 'love', 'hate', 'money', 'million', 'fight', 'won', 'lost', 'funny', 'laugh', 'haha', 'lol', 'secret', 'truth', 'honestly'];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const norm = (t) => ` ${t.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** Real sentences from the words: end at . ? ! or a long pause (the speech engine's own segments split mid-sentence). */
function sentences(words) {
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.?!]["')\]]?$/.test(w.w) || !next || next.s - w.e > 1.2) {
      out.push({ text: cur.map((x) => x.w).join(' '), s: cur[0].s, e: cur[cur.length - 1].e });
      cur = [];
    }
  });
  return out;
}

/** Score every window of whole sentences that is minLen–maxLen long; return the best, non-overlapping. */
function findMoments(tr, { count = 5, minLen = 20, maxLen = 50, idealLen = 34 } = {}) {
  const segs = sentences(tr.words).filter((s) => s.text);
  const rms = tr.rms || [];
  const step = tr.rmsStep || 0.5;
  const base = median(rms.filter((v) => v > -60));
  const wordsIn = (s, e) => tr.words.filter((w) => w.s >= s && w.e <= e);
  const cands = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i; j < segs.length; j++) {
      const s = segs[i].s; const e = segs[j].e;
      const len = e - s;
      if (len > maxLen) break;
      if (len < minLen) continue;
      const ws = wordsIn(s, e);
      if (ws.length < len * 1.2) continue; // too much silence
      // Dead air: biggest gap between words.
      let gap = 0;
      for (let k = 1; k < ws.length; k++) gap = Math.max(gap, ws[k].s - ws[k - 1].e);
      // Energy: how far the loudest stretch rises above this video's normal level.
      const r = rms.slice(Math.floor(s / step), Math.ceil(e / step)).filter((v) => v > -60).sort((a, b) => b - a);
      const top = r.slice(0, Math.max(1, Math.floor(r.length * 0.2)));
      const energy = top.length ? top.reduce((a, v) => a + v, 0) / top.length - base : 0;
      const spikes = r.filter((v) => v > base + 9).length;
      const text = norm(segs.slice(i, j + 1).map((x) => x.text).join(' '));
      const hype = HYPE.reduce((a, h) => a + (text.split(` ${h} `).length - 1), 0);
      const marks = segs.slice(i, j + 1).reduce((a, x) => a + (x.text.match(/[!?]/g) || []).length, 0);
      const hook = /[?!]/.test(segs[i].text) || HYPE.some((h) => norm(segs[i].text).includes(` ${h} `)) ? 1 : 0;
      const pace = ws.length / len; // words per second
      const score = energy * 0.9 + spikes * 0.15 + (hype / len) * 30 + (marks / len) * 12 + hook * 2 + Math.min(pace, 4) * 1.2
        - Math.max(0, gap - 1.5) * 1.5 - Math.abs(len - idealLen) * 0.06;
      cands.push({ s, e, len, score, i, j, energy, hype, pace, gap });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.some((p) => c.s < p.e + 5 && c.e > p.s - 5)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.s - b.s).map((c) => ({ ...c, segs: segs.slice(c.i, c.j + 1), words: wordsIn(c.s, c.e) }));
}

/** A short hook headline from the moment's punchiest sentence. */
function headline(m) {
  const scoreSeg = (x) => (x.text.match(/[!?]/g) || []).length * 2 + HYPE.filter((h) => norm(x.text).includes(` ${h} `)).length + Math.min(1, 12 / Math.max(1, x.text.length / 6));
  const best = [...m.segs].sort((a, b) => scoreSeg(b) - scoreSeg(a))[0] || m.segs[0];
  let t = best.text.replace(/\s+/g, ' ').trim();
  if (t.length > 70) t = `${t.slice(0, 67).replace(/\s+\S*$/, '')}...`;
  return t.replace(/^[a-z]/, (c) => c.toUpperCase());
}

module.exports = { findMoments, headline, sentences };
