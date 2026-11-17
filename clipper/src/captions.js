// Builds an .ass subtitle file: big word-by-word captions on the split line (current word
// highlighted and popped), plus an optional hook headline at the top for the first seconds.

const ts = (t) => {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};
const esc = (t) => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');

/** Group words into short on-screen chunks (3 words, broken early at punctuation or pauses). */
function chunks(words, size = 3) {
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const pause = next ? next.s - w.e > 0.6 : true;
    if (cur.length >= size || /[.!?,]$/.test(w.w) || pause) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * @param words  [{w, s, e}] with times relative to the clip start
 * @param opts   { hook, hookSeconds, y (caption center line) }
 */
function buildAss(words, { hook = null, hookSeconds = 3, y = 960, highlight = '&H0000E5FF&' } = {}) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter Display Black,92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,7,3,5,40,40,0,1
Style: Hook,Inter Display Black,58,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,3,18,0,8,60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  if (hook) lines.push(`Dialogue: 1,${ts(0)},${ts(hookSeconds)},Hook,,0,0,0,,{\\fad(0,250)}${esc(hook)}`);
  const groups = chunks(words);
  groups.forEach((g, gi) => {
    const groupEnd = groups[gi + 1] ? Math.min(groups[gi + 1][0].s, g[g.length - 1].e + 0.6) : g[g.length - 1].e + 0.5;
    g.forEach((w, k) => {
      const start = k === 0 ? g[0].s : w.s;
      const end = g[k + 1] ? g[k + 1].s : groupEnd;
      if (end <= start) return;
      const text = g.map((x, n) => {
        const word = esc(x.w.toUpperCase());
        return n === k ? `{\\c${highlight}\\fscx112\\fscy112}${word}{\\c&H00FFFFFF&\\fscx100\\fscy100}` : word;
      }).join(' ');
      lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Cap,,0,0,0,,{\\pos(540,${y})}${text}`);
    });
  });
  return head + lines.join('\n') + '\n';
}

module.exports = { buildAss, chunks };
