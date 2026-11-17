// Renders one Short: simulates, draws every frame, synthesizes audio, writes MP4 + metadata JSON.
const fs = require('node:fs');
const path = require('node:path');
const seedrandom = require('seedrandom');
const { createCanvas } = require('@napi-rs/canvas');
const { W, H, FPS, openEncoder, mux, tmp, cleanup } = require('./video');
const { Synth } = require('./audio');
const escape = require('./formats/escape');
const colors = require('./formats/colors');

const FORMATS = { escape, colors };
const rngFor = (s) => seedrandom(String(s));

async function makeShort({ format, seed, outDir, onProgress }) {
  const F = FORMATS[format];
  if (!F) throw new Error(`Unknown format "${format}". Options: ${Object.keys(FORMATS).join(', ')}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Pick the most watchable variation of this seed before rendering anything.
  const p = F.plan(rngFor, seed);
  const sim = format === 'escape'
    ? new escape.Escape(rngFor(`${seed}:${p.attempt}`), { gapScale: p.gapScale })
    : new colors.Colors(rngFor(`${seed}:${p.attempt}`));

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
    await enc.write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
    frames += 1;
    if (onProgress && frames % 120 === 0) onProgress(sim.t / end());
  }
  await enc.close();
  synth.buf = synth.buf.subarray(0, Math.ceil((frames / FPS) * 44100));
  synth.writeWav(wtmp);
  await mux(vtmp, wtmp, out);
  cleanup(vtmp, wtmp);

  const meta = { file: path.basename(out), format, seed, seconds: +(frames / FPS).toFixed(2), ...sim.meta(), plan: p };
  fs.writeFileSync(out.replace(/\.mp4$/, '.json'), JSON.stringify(meta, null, 2));
  return { out, meta };
}

module.exports = { makeShort, FORMATS };
