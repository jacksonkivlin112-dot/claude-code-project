#!/usr/bin/env node
// Brief + product media -> original, voiced brand Shorts (1080x1920, 30 fps).
//
//   node src/make.js examples/quillo/brief.json --count 4
//   options: --out DIR (default out/<brand>)  --start N (first variant number)  --speed 1.08
//
// Every variant rotates hook, structure, points, voice and layout, so videos for the same
// brand don't look duplicated (Launchpoint and similar platforms check for that).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const seedrandom = require('seedrandom');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { scriptFor } = require('./script');
const { speak, readWav, speechBounds, wordTimes } = require('./tts');
const { Synth } = require('./audio');

const ROOT = path.join(__dirname, '..');
GlobalFonts.registerFromPath(path.join(ROOT, 'assets/fonts/InterDisplay-Black.otf'), 'Black');
GlobalFonts.registerFromPath(path.join(ROOT, 'assets/fonts/InterDisplay-Bold.otf'), 'Bold');

const W = 1080; const H = 1920; const FPS = 30;
const RATE = 44100;
const GAP = 0.14; // pause between lines

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

function run(cmd, a) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, a, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd}: ${err.slice(-800)}`))));
  });
}
function encoder(file) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = ''; ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-800))))));
  return { write: (b) => new Promise((r) => (ff.stdin.write(b) ? r() : ff.stdin.once('drain', r))), close: async () => { ff.stdin.end(); await done; } };
}

// ---- Drawing helpers --------------------------------------------------------------

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
function roundImage(ctx, img, x, y, w, h, r) {
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); ctx.drawImage(img, x, y, w, h); ctx.restore();
}
/** Image scaled to cover a w x h box, as a draw call. */
function cover(ctx, img, x, y, w, h, zoom = 1, panX = 0, panY = 0) {
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * s; const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2 + panX, y + (h - dh) / 2 + panY, dw, dh);
}
/** Cheap blur: draw tiny, scale back up. Cached per image. */
const blurCache = new Map();
function blurred(img) {
  if (blurCache.has(img)) return blurCache.get(img);
  // Blur at quarter size (fast), then scale up smoothly.
  const small = createCanvas(270, 480); const sc = small.getContext('2d');
  sc.filter = 'blur(14px)'; cover(sc, img, -20, -20, 310, 520);
  const big = createCanvas(W, H); const c = big.getContext('2d');
  c.imageSmoothingQuality = 'high'; c.drawImage(small, 0, 0, W, H);
  c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, W, H);
  blurCache.set(img, big);
  return big;
}
function textBlock(ctx, lines, cx, y, { size, color = '#fff', stroke = 0, lead = 1.15, align = 'center' }) {
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const ly = y + i * size * lead;
    if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(l, cx, ly); }
    ctx.fillStyle = color; ctx.fillText(l, cx, ly);
  });
}

// ---- One video -----------------------------------------------------------------------

async function makeVideo(brief, baseDir, i, outDir, { speed }) {
  const sc = scriptFor(brief, i);
  const rng = seedrandom(`${brief.brand}:${i}`);
  const tmp = path.join(outDir, `.v${i}`);
  fs.mkdirSync(tmp, { recursive: true });
  const primary = brief.colors?.primary || '#6d5dfc';
  const accent = brief.colors?.accent || '#ffd166';

  // 1. Voiceover, line by line, and the timeline.
  let t = 0.25;
  const lines = [];
  for (const [k, ln] of sc.lines.entries()) {
    const f = path.join(tmp, `l${k}.wav`);
    await speak(ln.text, sc.voice, f, { speed });
    const wav = readWav(f);
    const dur = wav.samples.length / wav.rate;
    const b = speechBounds(wav);
    lines.push({ ...ln, wav, start: t, dur, words: wordTimes(ln.text, t + b.start, t + b.end) });
    t += dur + GAP;
  }
  const total = t + 1.2; // let the end card breathe

  // 2. Audio: voice placed on the timeline over a quiet original beat.
  const synth = new Synth(total + 1);
  synth.buf = synth.buf.subarray(0, Math.ceil(total * RATE));
  synth.music(total, seedrandom(`${brief.brand}:music:${i}`), { gain: 0.06 });
  for (const ln of lines) {
    const ratio = ln.wav.rate / RATE; const off = Math.floor(ln.start * RATE);
    for (let n = 0; off + n < synth.buf.length; n++) {
      const src = n * ratio; const a = Math.floor(src);
      if (a + 1 >= ln.wav.samples.length) break;
      synth.buf[off + n] += (ln.wav.samples[a] + (ln.wav.samples[a + 1] - ln.wav.samples[a]) * (src - a)) * 0.9;
    }
  }
  const wavFile = path.join(tmp, 'mix.wav');
  synth.writeWav(wavFile);

  // 3. Visuals: one product image per scene, cycling, end card for the call to action.
  const media = await Promise.all((brief.media || []).map((m) => loadImage(path.resolve(baseDir, m))));
  if (!media.length) throw new Error('The brief needs at least one image in "media".');
  const logo = brief.logo ? await loadImage(path.resolve(baseDir, brief.logo)) : null;
  // A line can name its own image (points as {"text", "media"}); others cycle through the rest.
  const byPath = new Map((brief.media || []).map((m, k) => [m, k]));
  const order = media.map((_, k) => (k + i) % media.length);
  lines.forEach((ln, k) => {
    const own = ln.media != null ? byPath.get(ln.media) : undefined;
    ln.img = media[own != null ? own : order[k % order.length]];
    ln.end = lines[k + 1] ? lines[k + 1].start : total;
  });
  const pans = lines.map(() => ({ x: (rng() - 0.5) * 80, y: (rng() - 0.5) * 120 }));

  const cv = createCanvas(W, H); const ctx = cv.getContext('2d');
  const vidFile = path.join(tmp, 'video.mp4');
  const enc = encoder(vidFile);
  const frames = Math.ceil(total * FPS);
  for (let f = 0; f < frames; f++) {
    const now = f / FPS;
    const k = Math.max(0, lines.findIndex((ln) => now >= ln.start - 0.001 && now < ln.end));
    const ln = lines[k];
    const u = (now - ln.start) / Math.max(0.1, ln.end - ln.start); // progress through the scene
    const enter = ease((now - ln.start) / 0.3);

    if (ln.kind === 'cta') {
      // End card in brand colors.
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, primary); g.addColorStop(1, '#14112a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (logo) { const s = 340 * (0.85 + 0.15 * enter); roundImage(ctx, logo, W / 2 - s / 2, 560 - s / 2, s, s, 60); }
      ctx.font = '96px Black'; textBlock(ctx, [brief.brand], W / 2, 840, { size: 96 });
      ctx.font = '58px Bold'; textBlock(ctx, wrap(ctx, brief.cta, 900), W / 2, 990, { size: 58, color: accent });
    } else if (sc.style === 'full') {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      cover(ctx, ln.img, 0, 0, W, H, 1.04 + 0.1 * u, pans[k].x * u, pans[k].y * u);
      const g = ctx.createLinearGradient(0, H * 0.55, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.drawImage(blurred(ln.img), 0, 0);
      // Fit the whole image (phone screenshots shouldn't lose their top or bottom).
      const fit = Math.min(900 / ln.img.width, 1180 / ln.img.height);
      const bw = ln.img.width * fit; const bh = ln.img.height * fit;
      const s = (0.94 + 0.06 * enter) * (1 + 0.04 * u);
      const x = W / 2 - (bw * s) / 2; const y = 860 - (bh * s) / 2 + (1 - enter) * 60;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.roundRect(x + 10, y + 24, bw * s, bh * s, 48); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, bw * s, bh * s, 48); ctx.clip();
      ctx.drawImage(ln.img, x, y, bw * s, bh * s);
      ctx.restore();
    }

    // Numbered point badge for list videos.
    if (ln.n) {
      const r = 70 * (0.6 + 0.4 * enter);
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(150, 330, r, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${Math.round(r * 1.2)}px Black`; textBlock(ctx, [String(ln.n)], 150, 336, { size: r * 1.2, color: '#14112a' });
    }
    // Hook headline for the opening scene.
    if (ln.kind === 'hook') {
      ctx.font = '66px Black';
      const hl = wrap(ctx, ln.text, 900);
      const bh = hl.length * 66 * 1.15 + 50; const y0 = 210;
      ctx.globalAlpha = enter;
      ctx.fillStyle = primary; ctx.beginPath(); ctx.roundRect(60, y0, W - 120, bh, 28); ctx.fill();
      textBlock(ctx, hl, W / 2, y0 + 25 + 66 * 0.58, { size: 66 });
      ctx.globalAlpha = 1;
    }
    // Captions (not on the end card, which shows the CTA in full).
    if (ln.kind !== 'cta') {
      const words = ln.words;
      const idx = words.findIndex((w) => now >= w.s && now < w.e);
      const cur = idx >= 0 ? idx : (now < words[0].s ? 0 : words.length - 1);
      const g0 = Math.floor(cur / 3) * 3;
      const group = words.slice(g0, g0 + 3);
      ctx.font = '80px Black'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const widths = group.map((w) => ctx.measureText(w.w).width);
      const space = 22; const totalW = widths.reduce((a, v) => a + v, 0) + space * (group.length - 1);
      let x = (W - totalW) / 2; const y = sc.style === 'full' ? 1480 : 1640;
      group.forEach((w, n) => {
        const on = g0 + n === cur && idx >= 0;
        ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(w.w, x, y);
        ctx.fillStyle = on ? accent : '#fff'; ctx.fillText(w.w, x, y);
        x += widths[n] + space;
      });
    }
    // Always-on: progress bar and paid-partnership label.
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, W * (now / total), 10);
    ctx.font = '30px Bold';
    const label = brief.disclosure || `Paid partnership with ${brief.brand}`;
    const lw = ctx.measureText(label).width + 40;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect(40, 60, lw, 56, 28); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, 60, 89);

    await enc.write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
  }
  await enc.close();

  // 4. Mux with loudness normalization.
  const slug = brief.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const out = path.join(outDir, `${slug}-${String(i + 1).padStart(2, '0')}.mp4`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', vidFile, '-i', wavFile, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '44100', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { file: path.basename(out), seconds: +total.toFixed(1), structure: sc.structure, voice: sc.voice, style: sc.style, hook: sc.hook, script: sc.lines.map((l) => l.text) };
}

function sheet(brief, outDir, vids) {
  const tags = (brief.hashtags || ['#ad']).join(' ');
  const rows = vids.map((v, n) => [
    `## ${n + 1}. ${v.file}  (${v.seconds}s, ${v.structure}, voice: ${v.voice}, ${v.style} layout)`,
    '',
    `**Title:** ${v.hook.replace(/[.!]$/, '')} #ad`,
    '**Description:**',
    '```',
    `${v.hook}\n\n${brief.cta}\n\n${brief.disclosure || `Paid partnership with ${brief.brand}`}\n${tags} #shorts`,
    '```',
    '**Script:**',
    ...v.script.map((s) => `> ${s}`),
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(outDir, 'upload-list.md'), `# ${brief.brand}: ${vids.length} videos\n\nBefore posting:\n- In YouTube Studio, open **Details → Show more → Paid promotion** and tick **"My video contains paid promotion"**. It's required for brand deals and the campaign won't pay without a disclosure.\n- Keep the on-screen "Paid partnership" label and #ad.\n- Submit each posted link in the campaign dashboard.\n- Watch every video once before posting.\n\n${rows.join('\n')}`);
}

(async () => {
  const briefPath = args.find((a) => a.endsWith('.json'));
  if (!briefPath) { console.log('Usage: node src/make.js <brief.json> [--count 4] [--start 0] [--out DIR] [--speed 1.08]'); process.exit(1); }
  const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
  const baseDir = path.dirname(path.resolve(briefPath));
  const count = Number(opt('count', 4));
  const start = Number(opt('start', 0));
  const speed = Number(opt('speed', 1.08));
  const outDir = path.resolve(opt('out', path.join(ROOT, 'out', brief.brand.toLowerCase().replace(/[^a-z0-9]+/g, '-'))));
  fs.mkdirSync(outDir, { recursive: true });
  const vids = [];
  for (let i = start; i < start + count; i++) {
    const t0 = Date.now();
    const v = await makeVideo(brief, baseDir, i, outDir, { speed });
    vids.push(v);
    console.log(`${v.file}  ${v.seconds}s  ${v.structure}/${v.voice}/${v.style}  "${v.hook}"  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  sheet(brief, outDir, vids);
  console.log(`Upload sheet: ${path.join(outDir, 'upload-list.md')}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
