// Turns a brief into different scripts, so no two videos for the same brand look alike.
// Each structure is a list of lines; every line becomes one scene with its own visual.

// Points can be plain strings or {"text", "media"} to pin an image to that line.
const textOf = (p) => (typeof p === 'string' ? p : p.text);
const mediaOf = (p) => (typeof p === 'string' ? undefined : p.media);

const pick3 = (points, k) => {
  const out = [];
  for (let i = 0; i < Math.min(3, points.length); i++) out.push(points[(k + i) % points.length]);
  return out;
};

const STRUCTURES = {
  // Problem → discovery → payoff. Works for almost any product.
  story: (b, hook, pts) => [
    { text: hook, kind: 'hook' },
    ...(b.problem ? [{ text: b.problem, kind: 'line' }] : []),
    { text: `Then I found ${b.product}.`, kind: 'line' },
    ...pts.map((p) => ({ text: textOf(p), media: mediaOf(p), kind: 'point' })),
    { text: b.cta, kind: 'cta' },
  ],
  // Numbered list: easy to follow, holds attention to the end.
  list: (b, hook, pts) => [
    { text: hook, kind: 'hook' },
    { text: `Here's why I switched to ${b.product}.`, kind: 'line' },
    ...pts.map((p, i) => ({ text: `${['One', 'Two', 'Three'][i]}. ${textOf(p)}`, media: mediaOf(p), kind: 'point', n: i + 1 })),
    { text: b.cta, kind: 'cta' },
  ],
  // Straight demo: show, don't tell.
  demo: (b, hook, pts) => [
    { text: hook, kind: 'hook' },
    { text: 'Let me show you.', kind: 'line' },
    ...pts.map((p) => ({ text: textOf(p), media: mediaOf(p), kind: 'point' })),
    { text: `Honestly, I'm not going back.`, kind: 'line' },
    { text: b.cta, kind: 'cta' },
  ],
  // Quick hit for short attention spans.
  quick: (b, hook, pts) => [
    { text: hook, kind: 'hook' },
    ...pts.slice(0, 2).map((p) => ({ text: textOf(p), media: mediaOf(p), kind: 'point' })),
    { text: b.cta, kind: 'cta' },
  ],
};

/** Script number `i` for a brief: hook, structure, points and voice all rotate. */
function scriptFor(brief, i) {
  const hooks = brief.hooks?.length ? brief.hooks : [`You need to see what ${brief.product} can do.`];
  const names = Object.keys(STRUCTURES);
  const structure = names[(i + Math.floor(i / hooks.length)) % names.length];
  const hook = hooks[i % hooks.length];
  const pts = pick3(brief.points || [], i);
  const voices = brief.voices?.length ? brief.voices : ['joe'];
  return { structure, hook, voice: voices[i % voices.length], lines: STRUCTURES[structure](brief, hook, pts), style: i % 2 ? 'full' : 'card' };
}

module.exports = { scriptFor, STRUCTURES };
