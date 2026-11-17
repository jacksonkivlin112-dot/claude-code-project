// Renders one Short: simulates, draws every frame, synthesizes audio, writes MP4 + metadata JSON.
const fs = require('node:fs');
const path = require('node:path');
const seedrandom = require('seedrandom');
const { createCanvas } = require('@napi-rs/canvas');
const { W, H, FPS, openEncoder, mux, tmp, cleanup } = require('./video');
const { Synth } = require('./audio');
const escape = require('./formats/escape');
const colors = require('./formats/colors');
const race = require('./formats/race');
const battle = require('./formats/battle');

// How to build each format's sim from its plan.
const FORMATS = {
  escape: { ...escape, create: (rng, p) => new escape.Escape(rng, { gapScale: p.gapScale }) },
  colors: { ...colors, create: (rng) => new colors.Colors(rng) },
  race: { ...race, create: (rng, p) => new race.Race(rng, { sections: p.sections }) },
  battle: { ...battle, create: (rng, p) => new battle.Battle(rng, { dmgScale: p.dmgScale }) },
};
const rngFor = (s) => seedrandom(String(s));
const SERIES = { escape: 'Ring Escape', colors: 'Color Battle', race: 'Marble Race', battle: 'Ball Battle' };

/** Next episode number for a series, remembered in the output folder. */
function nextEpisode(outDir, name) {
  const f = path.join(outDir, 'series.json');
  let j = {};
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first one */ }
  j[name] = (j[name] || 0) + 1;
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  return j[name];
}

/** "MARBLE RACE #12" pill at the top of every frame. */
function seriesTag(ctx, text) {
  ctx.save();
  ctx.font = '40px SimBlack';
  const w = ctx.measureText(text).width + 56;
  const x = (W - w) / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(x, 70, w, 68, 34); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, 106);
  ctx.restore();
}

async function makeShort({ format, seed, outDir, onProgress, series = SERIES[format], episode = null }) {
  const F = FORMATS[format];
  if (!F) throw new Error(`Unknown format "${format}". Options: ${Object.keys(FORMATS).join(', ')}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Pick the most watchable variation of this seed before rendering anything.
  const p = F.plan(rngFor, seed);
  const sim = F.create(rngFor(`${seed}:${p.attempt}`), p);
  const ep = series ? (episode ?? nextEpisode(outDir, series)) : null;
  const tag = series ? `${series.toUpperCase()} #${ep}` : null;

  const tail = 3; // seconds after the finish
  const maxLen = 59; // stay under a minute for Shorts
  const out = path.join(outDir, `${format}-${seed}.mp4`);
  const vtmp = tmp(out, 'video.mp4');
  const wtmp = tmp(out, 'wav');
  const enc = openEncoder(vtmp);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const synth = new Synth(maxLen + 1);
  const dt = 1 / FPS;
  let frames = 0;
  let soundIdx = 0;
  const end = () => (sim.doneAt != null ? Math.min(maxLen, sim.doneAt + tail) : maxLen);

  while (sim.t < end()) {
    sim.step(dt);
    sim.frame(dt);
    while (soundIdx < sim.events.length) sim.sound(synth, sim.events[soundIdx++]);
    sim.draw(ctx);
    if (tag) seriesTag(ctx, tag);
    await enc.write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
    frames += 1;
    if (onProgress && frames % 120 === 0) onProgress(sim.t / end());
  }
  await enc.close();
  synth.buf = synth.buf.subarray(0, Math.ceil((frames / FPS) * 44100));
  synth.writeWav(wtmp);
  await mux(vtmp, wtmp, out);
  cleanup(vtmp, wtmp);

  const m = sim.meta();
  if (series) m.titles = [`${m.titles[0]} | ${series} #${ep}`, ...m.titles];
  const meta = { file: path.basename(out), format, seed, series: series || null, episode: ep, seconds: +(frames / FPS).toFixed(2), ...m, plan: p };
  fs.writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify(meta, null, 2));
  return { out, meta };
}

module.exports = { makeShort, FORMATS };
