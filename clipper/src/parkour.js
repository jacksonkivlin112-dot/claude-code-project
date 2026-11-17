#!/usr/bin/env node
// Original block-parkour gameplay footage for the bottom half of split-screen clips:
// a first-person run across a randomly built course of floating blocks.
// Everything (course, colors, textures, sky) is generated, so the footage is yours.
//
//   node src/parkour.js                         one 60 s clip, random theme
//   node src/parkour.js --theme neon --seconds 90 --seed 7
//   node src/parkour.js --count 4               a small library, one per theme
const fs = require('node:fs');
const path = require('node:path');
const seedrandom = require('seedrandom');
const { createCanvas } = require('@napi-rs/canvas');
const { openEncoder } = require('./encode');

const W = 1080;
const H = 960;
const FPS = 60;
const F = H * 0.95; // focal length in px (about 70° vertical field of view)

// Themes: sky colors, block palettes, fog, optional neon edges and stars.
const THEMES = {
  sky: { skyTop: [96, 165, 255], skyBot: [214, 236, 255], fog: [200, 228, 255], sun: [255, 250, 220], blocks: [[120, 200, 90], [150, 120, 90], [130, 135, 145], [230, 210, 150]], edge: null, stars: false, clouds: true },
  sunset: { skyTop: [70, 40, 120], skyBot: [255, 150, 90], fog: [240, 140, 110], sun: [255, 210, 140], blocks: [[240, 120, 80], [200, 80, 120], [255, 190, 90], [130, 90, 160]], edge: null, stars: false, clouds: true },
  neon: { skyTop: [6, 4, 20], skyBot: [30, 10, 60], fog: [20, 8, 45], sun: null, blocks: [[30, 30, 50], [25, 35, 55], [40, 25, 55]], edge: [[0, 255, 220], [255, 60, 200], [120, 120, 255]], stars: true, clouds: false },
  candy: { skyTop: [255, 180, 220], skyBot: [255, 235, 245], fog: [255, 225, 240], sun: [255, 255, 255], blocks: [[255, 140, 190], [140, 210, 255], [170, 240, 190], [255, 220, 130], [200, 170, 255]], edge: null, stars: false, clouds: true },
};

// ---- Course ---------------------------------------------------------------------

/** Platforms (each a short run of blocks) and the waypoints the runner lands on. */
function buildCourse(rng, n = 260) {
  const blocks = [];
  const way = [];
  let x = 0; let y = 0; let z = 0;
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const addPlatform = (len, colorIdx, pillar) => {
    for (let k = 0; k < len; k++) {
      blocks.push({ x, y, z: z + k, c: colorIdx, seed: Math.floor(rng() * 1e6) });
      if (pillar) for (let d = 1; d <= pillar; d++) blocks.push({ x, y: y - d, z: z + k, c: colorIdx, seed: Math.floor(rng() * 1e6), under: true });
    }
    for (let k = 0; k < len; k++) way.push({ x: x + 0.5, y: y + 1, z: z + k + 0.5, walk: k > 0 });
    z += len - 1;
  };
  addPlatform(4, 0, 0);
  for (let i = 0; i < n; i++) {
    const gap = pick([1, 1, 2, 2, 2, 3]);
    let dy = pick([0, 0, 0, 1, -1, -1]);
    if (gap === 3 && dy > 0) dy = 0; // keep every jump makeable
    const dx = pick([0, 0, 1, -1, 1, -1, 2, -2]);
    x = Math.max(-4, Math.min(4, x + (gap === 3 ? Math.sign(dx) : dx)));
    y = Math.max(-6, Math.min(8, y + dy));
    z += gap + 1;
    const len = pick([1, 1, 1, 1, 2, 2, 3]);
    addPlatform(len, Math.floor(rng() * 5), rng() < 0.18 ? 1 + Math.floor(rng() * 3) : 0);
  }
  return { blocks, way };
}

/** Feet position over time along the waypoints: walks between neighbours, arcs over gaps. */
function makePath(way) {
  const segs = [];
  let t = 0;
  for (let i = 0; i + 1 < way.length; i++) {
    const a = way[i]; const b = way[i + 1];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const walk = b.walk;
    const dur = walk ? dist / 4.6 : Math.max(0.42, dist / 5.4 + Math.max(0, b.y - a.y) * 0.08);
    const apex = walk ? 0 : 1.05 + Math.max(0, b.y - a.y) * 0.9;
    segs.push({ a, b, t0: t, dur, apex, walk });
    t += dur;
  }
  const total = t;
  let idx = 0;
  const at = (time) => {
    while (idx > 0 && segs[idx].t0 > time) idx--;
    while (idx < segs.length - 1 && segs[idx].t0 + segs[idx].dur < time) idx++;
    const s = segs[idx];
    const u = Math.max(0, Math.min(1, (time - s.t0) / s.dur));
    const x = s.a.x + (s.b.x - s.a.x) * u;
    const z = s.a.z + (s.b.z - s.a.z) * u;
    const base = s.a.y + (s.b.y - s.a.y) * u;
    const y = base + (s.walk ? 0 : 4 * s.apex * u * (1 - u) - (s.b.y - s.a.y) * 0);
    return { x, y, z, seg: idx, u, walk: s.walk };
  };
  return { at, total, segs };
}

// ---- 3D -------------------------------------------------------------------------

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

function camera(pos, yaw, pitch) {
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  const f = [Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp];
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]; // up = forward × right
  const toCam = (p) => { const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]]; return [d[0] * r[0] + d[1] * r[1] + d[2] * r[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * f[0] + d[1] * f[1] + d[2] * f[2]]; };
  return { pos, toCam };
}

const NEAR = 0.06;
/** Clip a camera-space polygon against the near plane, then project to the screen. */
function project(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const ain = a[2] >= NEAR; const bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (NEAR - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]); }
  }
  if (out.length < 3) return null;
  return out.map((p) => [W / 2 + (F * p[0]) / p[2], H / 2 - (F * p[1]) / p[2]]);
}

// Cube faces: corner offsets and shade.
const FACES = [
  { n: 'top', c: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], shade: 1.0, vis: (b, e) => e[1] > b.y + 1 },
  { n: 'bottom', c: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], shade: 0.45, vis: (b, e) => e[1] < b.y },
  { n: 'front', c: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], shade: 0.78, vis: (b, e) => e[2] < b.z },
  { n: 'back', c: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], shade: 0.7, vis: (b, e) => e[2] > b.z + 1 },
  { n: 'left', c: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], shade: 0.64, vis: (b, e) => e[0] < b.x },
  { n: 'right', c: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], shade: 0.6, vis: (b, e) => e[0] > b.x + 1 },
];

// ---- Render ---------------------------------------------------------------------

function render({ seed, theme: themeName, seconds, out }) {
  const rng = seedrandom(String(seed));
  const theme = THEMES[themeName];
  const { blocks, way } = buildCourse(rng);
  const route = makePath(way);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const sky = createCanvas(W, H);
  {
    const s = sky.getContext('2d');
    const g = s.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(theme.skyTop)); g.addColorStop(1, rgb(theme.skyBot));
    s.fillStyle = g; s.fillRect(0, 0, W, H);
    if (theme.stars) { const r2 = seedrandom(`${seed}:stars`); for (let i = 0; i < 220; i++) { s.fillStyle = `rgba(255,255,255,${0.3 + r2() * 0.7})`; s.fillRect(r2() * W, r2() * H * 0.8, 2, 2); } }
  }
  const clouds = theme.clouds ? Array.from({ length: 16 }, () => ({ a: rng() * Math.PI * 2, y: rng() * 900, w: 120 + rng() * 260 })) : [];
  let yaw = 0;
  const frames = Math.round(seconds * FPS);
  // Start a little way in so the first frame is already mid-run.
  const t0 = 1.5;
  const enc = openEncoder(out, { w: W, h: H, fps: FPS });
  const look = (time) => { const p = route.at(time); return p; };

  return (async () => {
    for (let fi = 0; fi < frames; fi++) {
      const time = t0 + fi / FPS;
      const p = look(time);
      const ahead = look(time + 0.55);
      const far = look(time + 1.2);
      const wantYaw = Math.atan2(far.x - p.x, far.z - p.z);
      yaw += (wantYaw - yaw) * 0.08;
      const bob = p.walk ? Math.sin(time * 14) * 0.03 : 0;
      const eye = [p.x, p.y + 1.62 + bob, p.z];
      // Look down at the next landing spot, the way parkour footage does.
      const pitch = -0.62 + Math.max(-0.15, Math.min(0.15, (ahead.y - p.y) * 0.1));
      const cam = camera(eye, yaw, pitch);

      // Sky above the horizon, open void below it; sun and clouds sit relative to the horizon.
      const hy = H / 2 + F * Math.tan(pitch); // horizon line on screen (above the frame when looking down)
      const g = ctx.createLinearGradient(0, hy - H * 1.2, 0, hy + H * 1.4);
      g.addColorStop(0, rgb(theme.skyTop)); g.addColorStop(0.46, rgb(theme.skyBot)); g.addColorStop(1, rgb(mix(theme.skyBot, theme.skyTop, 0.55)));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (theme.stars) ctx.drawImage(sky, 0, 0);
      if (theme.sun) {
        const sx = W / 2 + Math.sin(0.6 - yaw) * 900;
        const sy = hy - 260;
        if (sy > -150) {
          ctx.fillStyle = `rgba(${theme.sun.join(',')},0.25)`; ctx.beginPath(); ctx.arc(sx, sy, 120, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgb(theme.sun); ctx.beginPath(); ctx.arc(sx, sy, 70, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const c of clouds) {
        const cx = ((Math.sin(c.a - yaw * 0.6) * 0.5 + 0.5) * (W + 600)) - 300;
        const cy = hy - 420 + c.y; // a band of clouds around the horizon, plus some below you
        if (cy < -60 || cy > H + 60) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(cx, cy, c.w, 36); ctx.fillRect(cx + c.w * 0.2, cy - 22, c.w * 0.5, 26);
      }

      // Blocks near the runner, far to near.
      const near = [];
      for (const b of blocks) {
        const dz = b.z - p.z;
        if (dz < -3 || dz > 34) continue;
        const cc = cam.toCam([b.x + 0.5, b.y + 0.5, b.z + 0.5]);
        if (cc[2] < -1.5) continue;
        near.push({ b, d: cc[0] * cc[0] + cc[1] * cc[1] + cc[2] * cc[2] });
      }
      near.sort((m, n) => n.d - m.d);
      for (const { b, d } of near) {
        const dist = Math.sqrt(d);
        const fog = Math.min(1, Math.max(0, (dist - 8) / 26));
        const base = theme.blocks[b.c % theme.blocks.length];
        for (const face of FACES) {
          if (!face.vis(b, eye)) continue;
          const camPts = face.c.map((o) => cam.toCam([b.x + o[0], b.y + o[1], b.z + o[2]]));
          const scr = project(camPts);
          if (!scr) continue;
          const lit = face.n === 'top' && !b.under ? mix(base, [255, 255, 255], 0.12) : base;
          const col = mix(lit.map((v) => v * face.shade), theme.fog, fog);
          ctx.fillStyle = rgb(col);
          ctx.beginPath(); scr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill();
          // Pixel texture on close faces: a 4x4 grid of slightly varied squares.
          if (dist < 11 && camPts.every((q) => q[2] > NEAR)) {
            const [p0, p1, p2, p3] = scr;
            const lerp = (u, v) => [
              p0[0] * (1 - u) * (1 - v) + p1[0] * u * (1 - v) + p2[0] * u * v + p3[0] * (1 - u) * v,
              p0[1] * (1 - u) * (1 - v) + p1[1] * u * (1 - v) + p2[1] * u * v + p3[1] * (1 - u) * v,
            ];
            let s = b.seed + face.n.length * 31;
            for (let gy = 0; gy < 4; gy++) {
              for (let gx = 0; gx < 4; gx++) {
                s = (s * 9301 + 49297) % 233280;
                const k = (s / 233280 - 0.5) * 0.16;
                if (Math.abs(k) < 0.03) continue;
                const a = lerp(gx / 4, gy / 4); const bb = lerp((gx + 1) / 4, gy / 4); const cc = lerp((gx + 1) / 4, (gy + 1) / 4); const dd = lerp(gx / 4, (gy + 1) / 4);
                ctx.fillStyle = k > 0 ? `rgba(255,255,255,${k * (1 - fog)})` : `rgba(0,0,0,${-k * (1 - fog)})`;
                ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bb[0], bb[1]); ctx.lineTo(cc[0], cc[1]); ctx.lineTo(dd[0], dd[1]); ctx.closePath(); ctx.fill();
              }
            }
          }
          if (theme.edge) {
            ctx.strokeStyle = rgb(mix(theme.edge[b.c % theme.edge.length], theme.fog, fog));
            ctx.lineWidth = Math.max(1, 6 / Math.max(1, dist * 0.35));
            ctx.beginPath(); scr.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.stroke();
          } else {
            ctx.strokeStyle = `rgba(0,0,0,${0.18 * (1 - fog)})`; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
      }
      await enc.write(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
      if (fi % 600 === 0) process.stdout.write(`${Math.round((fi / frames) * 100)}% `);
    }
    await enc.close();
    return out;
  })();
}

module.exports = { render, THEMES, buildCourse, makePath };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const count = Number(opt('count', 1));
  const seconds = Number(opt('seconds', 60));
  const outDir = opt('out', 'assets/parkour');
  fs.mkdirSync(outDir, { recursive: true });
  (async () => {
    for (let n = 0; n < count; n++) {
      const theme = opt('theme', null) || Object.keys(THEMES)[n % Object.keys(THEMES).length];
      const seed = opt('seed', null) ? `${opt('seed')}${count > 1 ? `-${n}` : ''}` : Math.random().toString(36).slice(2, 8);
      const out = path.join(outDir, `parkour-${theme}-${seed}.mp4`);
      const t = Date.now();
      process.stdout.write(`${out} `);
      await render({ seed, theme, seconds, out });
      console.log(`done in ${((Date.now() - t) / 1000).toFixed(0)}s`);
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
