#!/usr/bin/env node
// Generates media for the made-up demo brand "Quillo" (a notes app): a logo and four
// phone-screen mockups, so the pipeline can be tested without a real brand's assets.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const FONTS = path.join(__dirname, '..', 'assets', 'fonts');
GlobalFonts.registerFromPath(path.join(FONTS, 'InterDisplay-Black.otf'), 'Black');
GlobalFonts.registerFromPath(path.join(FONTS, 'InterDisplay-Bold.otf'), 'Bold');

const OUT = path.join(__dirname, '..', 'examples', 'quillo', 'media');
fs.mkdirSync(OUT, { recursive: true });
const PRIMARY = '#6d5dfc';
const ACCENT = '#ffd166';

function save(cv, name) { fs.writeFileSync(path.join(OUT, name), cv.toBuffer('image/png')); }

function logo() {
  const cv = createCanvas(512, 512); const c = cv.getContext('2d');
  c.fillStyle = PRIMARY; c.beginPath(); c.roundRect(32, 32, 448, 448, 110); c.fill();
  c.fillStyle = '#fff'; c.font = '300px Black'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Q', 256, 270);
  c.fillStyle = ACCENT; c.beginPath(); c.arc(372, 372, 46, 0, Math.PI * 2); c.fill();
  save(cv, 'logo.png');
}

/** A phone screen: status bar, title, then content drawn by `body`. */
function phone(name, title, body) {
  const W = 900; const H = 1600;
  const cv = createCanvas(W, H); const c = cv.getContext('2d');
  c.fillStyle = '#f6f5ff'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1b1830'; c.font = '34px Bold'; c.fillText('9:41', 50, 70);
  c.font = '74px Black'; c.fillText(title, 50, 200);
  body(c, W, H);
  save(cv, name);
}

const card = (c, x, y, w, h, fill = '#fff') => { c.fillStyle = 'rgba(40,30,90,0.08)'; c.beginPath(); c.roundRect(x + 4, y + 8, w, h, 36); c.fill(); c.fillStyle = fill; c.beginPath(); c.roundRect(x, y, w, h, 36); c.fill(); };
const lines = (c, x, y, n, w, col = '#d9d6ef') => { for (let i = 0; i < n; i++) { c.fillStyle = col; c.beginPath(); c.roundRect(x, y + i * 42, w * (i === n - 1 ? 0.6 : 1), 18, 9); c.fill(); } };

logo();
phone('screen-notes.png', 'My notes', (c, W) => {
  [['Trip to Lisbon', '#ffe9b0'], ['Q4 launch plan', '#e3defe'], ['Book ideas', '#d8f5e4'], ['Groceries', '#ffd9e4'], ['Podcast outline', '#d9ecff']].forEach(([t, col], i) => {
    card(c, 50, 260 + i * 250, W - 100, 210, col);
    c.fillStyle = '#1b1830'; c.font = '46px Black'; c.fillText(t, 90, 330 + i * 250);
    lines(c, 90, 360 + i * 250, 2, W - 220, 'rgba(27,24,48,0.18)');
  });
});
phone('screen-summary.png', 'AI summary', (c, W) => {
  card(c, 50, 260, W - 100, 520);
  c.fillStyle = PRIMARY; c.font = '40px Black'; c.fillText('Summary of 12 notes', 90, 330);
  lines(c, 90, 380, 8, W - 220);
  card(c, 50, 830, W - 100, 420, '#1b1830');
  c.fillStyle = ACCENT; c.font = '40px Black'; c.fillText('3 action items', 90, 900);
  ['Book flights by Friday', 'Send launch deck', 'Call the venue'].forEach((t, i) => { c.fillStyle = '#fff'; c.font = '38px Bold'; c.fillText(`○  ${t}`, 90, 980 + i * 80); });
});
phone('screen-search.png', 'Search', (c, W) => {
  card(c, 50, 250, W - 100, 120);
  c.fillStyle = '#8a86a8'; c.font = '40px Bold'; c.fillText('"that restaurant in Lisbon"', 90, 325);
  [0, 1, 2].forEach((i) => { card(c, 50, 430 + i * 300, W - 100, 260); c.fillStyle = ACCENT; c.fillRect(90, 480 + i * 300, 260, 46); c.fillStyle = '#1b1830'; c.font = '36px Black'; c.fillText(['Taberna da Rua', 'Trip to Lisbon', 'Food list'][i], 100, 515 + i * 300); lines(c, 90, 560 + i * 300, 3, W - 220); });
});
phone('screen-sync.png', 'Everywhere', (c, W) => {
  ['Phone', 'Laptop', 'Tablet', 'Watch'].forEach((d, i) => {
    card(c, 50, 270 + i * 300, W - 100, 250);
    c.fillStyle = PRIMARY; c.beginPath(); c.arc(140, 395 + i * 300, 50, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1b1830'; c.font = '50px Black'; c.fillText(d, 220, 380 + i * 300);
    c.fillStyle = '#22a861'; c.font = '36px Bold'; c.fillText('✓ Synced just now', 220, 440 + i * 300);
  });
});
console.log(`Demo media written to ${OUT}`);
