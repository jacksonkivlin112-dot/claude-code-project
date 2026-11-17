// Shared drawing helpers: fonts, big outlined captions, backgrounds.
const path = require('node:path');
const { GlobalFonts } = require('@napi-rs/canvas');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'InterDisplay-Black.otf'), 'SimBlack');
GlobalFonts.registerFromPath(path.join(FONT_DIR, 'InterDisplay-Bold.otf'), 'SimBold');

/** Big caption with a dark outline so it reads on any background (Shorts-style). */
function caption(ctx, text, x, y, { size = 84, color = '#fff', weight = 'SimBlack', align = 'center', alpha = 1, stroke = 14, maxWidth = 980 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  let s = size;
  ctx.font = `${s}px ${weight}`;
  const lines = String(text).split('\n');
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > maxWidth) { s = Math.floor(s * maxWidth / widest); ctx.font = `${s}px ${weight}`; }
  lines.forEach((l, i) => {
    const ly = y + (i - (lines.length - 1) / 2) * s * 1.12;
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke * (s / size);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(l, x, ly);
    ctx.fillStyle = color;
    ctx.fillText(l, x, ly);
  });
  ctx.restore();
}

const bgCache = new Map();
/** Dark radial background with a slight hue tint per video (rendered once, then reused). */
function background(ctx, W, H, hue) {
  let bg = bgCache.get(hue);
  if (!bg) {
    const { createCanvas } = require('@napi-rs/canvas');
    bg = createCanvas(W, H);
    const c = bg.getContext('2d');
    const g = c.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, `hsl(${hue}, 45%, 12%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360}, 50%, 3%)`);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    bgCache.set(hue, bg);
  }
  ctx.drawImage(bg, 0, 0);
}

const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const pop = (x) => { const t = Math.min(1, Math.max(0, x)); return t < 0.6 ? ease(t / 0.6) * 1.12 : 1.12 - 0.12 * ease((t - 0.6) / 0.4); };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

module.exports = { caption, background, ease, pop, fmtTime };
