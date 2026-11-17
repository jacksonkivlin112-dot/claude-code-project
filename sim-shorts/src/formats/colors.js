// "Which color wins?" — each ball bounces through its own color and flips any other
// color it touches, bouncing back. Territory swings back and forth until time runs out.
const { W, H } = require('../video');
const { noteFreq } = require('../audio');
const { caption, background, pop } = require('../draw');

const TEAMS = [
  { name: 'RED', fill: '#ff3b5c', ball: '#5a0718', note: 0 },
  { name: 'BLUE', fill: '#2f8cff', ball: '#06224d', note: 2 },
  { name: 'GREEN', fill: '#22d36b', ball: '#05401c', note: 4 },
  { name: 'YELLOW', fill: '#ffc61a', ball: '#4d3800', note: 7 },
  { name: 'PURPLE', fill: '#a259ff', ball: '#2a0b55', note: 9 },
];
const AX = 60;
const AY = 520;
const AW = 960;
const CELL = 32;
const N = AW / CELL; // 30x30
const R = 13;
const SPEED = 900;
const LENGTH = 52; // seconds of battle

class Colors {
  constructor(rng) {
    this.rng = rng;
    this.hue = Math.floor(rng() * 360);
    const nTeams = [2, 3, 4, 4][Math.floor(rng() * 4)];
    const order = [...TEAMS].sort(() => rng() - 0.5).slice(0, nTeams);
    this.teams = order;
    this.grid = new Uint8Array(N * N);
    const owner = (i, j) => {
      if (nTeams === 2) return i < N / 2 ? 0 : 1;
      if (nTeams === 3) return Math.min(2, Math.floor(i / (N / 3)));
      return (i < N / 2 ? 0 : 1) + (j < N / 2 ? 0 : 2);
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) this.grid[j * N + i] = owner(i, j);
    this.balls = order.map((_, k) => {
      let cx; let cy;
      if (nTeams === 2) { cx = k === 0 ? 0.25 : 0.75; cy = 0.5; }
      else if (nTeams === 3) { cx = (k + 0.5) / 3; cy = 0.5; }
      else { cx = k % 2 ? 0.75 : 0.25; cy = k < 2 ? 0.25 : 0.75; }
      const a = rng() * Math.PI * 2;
      return { team: k, x: AX + cx * AW, y: AY + cy * AW, vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED, lastNote: -1 };
    });
    this.t = 0;
    this.events = [];
    this.leadChanges = 0;
    this.leader = -1;
    this.flips = new Float32Array(N * N); // flash timers
    this.doneAt = LENGTH;
  }

  counts() {
    const c = new Array(this.teams.length).fill(0);
    for (const v of this.grid) c[v] += 1;
    return c;
  }

  step(dt) {
    this.t += dt;
    if (this.t > LENGTH) return;
    const sub = 4;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const b of this.balls) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        // Walls.
        if (b.x < AX + R) { b.x = AX + R; b.vx = Math.abs(b.vx); this.jitter(b); }
        if (b.x > AX + AW - R) { b.x = AX + AW - R; b.vx = -Math.abs(b.vx); this.jitter(b); }
        if (b.y < AY + R) { b.y = AY + R; b.vy = Math.abs(b.vy); this.jitter(b); }
        if (b.y > AY + AW - R) { b.y = AY + AW - R; b.vy = -Math.abs(b.vy); this.jitter(b); }
        // Flip enemy cells at the ball's leading edges and bounce off them.
        for (const [ox, oy, axis] of [[R, 0, 'x'], [-R, 0, 'x'], [0, R, 'y'], [0, -R, 'y']]) {
          const i = Math.floor((b.x + ox - AX) / CELL);
          const j = Math.floor((b.y + oy - AY) / CELL);
          if (i < 0 || j < 0 || i >= N || j >= N) continue;
          const idx = j * N + i;
          if (this.grid[idx] === b.team) continue;
          this.grid[idx] = b.team;
          this.flips[idx] = 1;
          if (axis === 'x' && Math.sign(ox) === Math.sign(b.vx)) b.vx = -b.vx;
          if (axis === 'y' && Math.sign(oy) === Math.sign(b.vy)) b.vy = -b.vy;
          if (this.t - b.lastNote > 0.09) { b.lastNote = this.t; this.events.push({ t: this.t, type: 'flip', team: b.team }); }
        }
      }
    }
    // Lead tracking (for picking dramatic seeds).
    const c = this.counts();
    const lead = c.indexOf(Math.max(...c));
    if (lead !== this.leader) { if (this.leader !== -1 && this.t > 3) this.leadChanges += 1; this.leader = lead; }
    if (this.t >= LENGTH && !this.endLogged) { this.endLogged = true; this.events.push({ t: LENGTH, type: 'win', team: lead }); }
  }

  jitter(b) {
    const a = Math.atan2(b.vy, b.vx) + (this.rng() - 0.5) * 0.25;
    b.vx = Math.cos(a) * SPEED; b.vy = Math.sin(a) * SPEED;
    // Never too flat, or the ball skims a wall forever.
    if (Math.abs(b.vx) < SPEED * 0.25) b.vx = Math.sign(b.vx || 1) * SPEED * 0.25;
    if (Math.abs(b.vy) < SPEED * 0.25) b.vy = Math.sign(b.vy || 1) * SPEED * 0.25;
  }

  frame(dt) { for (let i = 0; i < this.flips.length; i++) if (this.flips[i] > 0) this.flips[i] = Math.max(0, this.flips[i] - dt * 3); }

  sound(synth, e) {
    if (e.type === 'flip') synth.tone(e.t, noteFreq(this.teams[e.team].note + (Math.floor(e.t * 37) % 3) * 5, 261.63), { dur: 0.32, vol: 0.12, bright: 0.2 });
    else if (e.type === 'win') { synth.chord(e.t, [5, 7, 9, 10], { dur: 1.4, vol: 0.16, bright: 0.45 }); synth.noise(e.t, { dur: 0.6, vol: 0.2, seed: 3 }); }
  }

  draw(ctx) {
    background(ctx, W, H, this.hue);
    // Arena.
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        ctx.fillStyle = this.teams[this.grid[idx]].fill;
        ctx.fillRect(AX + i * CELL, AY + j * CELL, CELL, CELL);
        if (this.flips[idx] > 0) { ctx.fillStyle = `rgba(255,255,255,${this.flips[idx] * 0.6})`; ctx.fillRect(AX + i * CELL, AY + j * CELL, CELL, CELL); }
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 4; ctx.strokeRect(AX - 2, AY - 2, AW + 4, AW + 4);
    for (const b of this.balls) {
      ctx.save();
      ctx.fillStyle = this.teams[b.team].ball; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Score bar.
    const c = this.counts();
    const total = N * N;
    let x = AX;
    const by = 1520;
    c.forEach((v, k) => {
      const w = (v / total) * AW;
      ctx.fillStyle = this.teams[k].fill; ctx.fillRect(x, by, w, 56);
      x += w;
    });
    const cols = this.teams.length;
    c.forEach((v, k) => {
      const cx = AX + (k + 0.5) * (AW / cols);
      caption(ctx, `${Math.round((v / total) * 100)}%`, cx, 1640, { size: 64, color: this.teams[k].fill });
      caption(ctx, this.teams[k].name, cx, 1705, { size: 34, color: '#ddd', weight: 'SimBold', stroke: 8 });
    });
    // Header.
    const left = Math.max(0, LENGTH - this.t);
    if (this.t < 3.2) caption(ctx, 'Which color wins?', W / 2, 300, { size: 104, alpha: Math.min(1, (3.2 - this.t) * 2) });
    else if (this.t < LENGTH) {
      caption(ctx, `${Math.ceil(left)}`, W / 2, 290, { size: 150, color: left < 10 ? '#ff6b6b' : '#fff' });
      caption(ctx, 'SECONDS LEFT', W / 2, 395, { size: 42, color: '#ccc', weight: 'SimBold' });
      if (this.t < 7) caption(ctx, 'Comment your pick before it ends', W / 2, 1810, { size: 46, weight: 'SimBold', alpha: Math.min(1, (this.t - 3.2) * 2, (7 - this.t) * 2) });
    } else {
      const win = c.indexOf(Math.max(...c));
      const s = pop((this.t - LENGTH) / 0.5);
      ctx.save(); ctx.translate(W / 2, 320); ctx.scale(s, s);
      caption(ctx, `${this.teams[win].name} WINS!`, 0, 0, { size: 130, color: this.teams[win].fill });
      ctx.restore();
      caption(ctx, 'Did your color win?', W / 2, 1810, { size: 56, alpha: Math.min(1, (this.t - LENGTH - 0.6) * 3) });
    }
  }

  meta() {
    const names = this.teams.map((t) => t.name.toLowerCase());
    return {
      titles: [
        'Which color wins?',
        `${names.map((n) => n[0].toUpperCase() + n.slice(1)).join(' vs ')} — who takes the board?`,
        'Pick a color before it ends',
        `${this.teams.length} colors, 52 seconds, 1 winner`,
      ],
      description: `Each ball flips every square it hits to its own color. Pick a color and comment before the timer runs out!\n\n#satisfying #colorbattle #simulation #shorts`,
      tags: ['which color wins', 'color battle', 'satisfying', 'simulation', 'pong wars', 'shorts'],
    };
  }
}

/** Try several seeds, keep the most back-and-forth battle. */
function plan(rng0, seed) {
  let best = { attempt: 0, leadChanges: -1 };
  for (let attempt = 0; attempt < 12; attempt++) {
    const sim = new Colors(rng0(`${seed}:${attempt}`));
    while (sim.t < LENGTH) sim.step(1 / 60);
    const c = sim.counts();
    const sorted = [...c].sort((a, b) => b - a);
    const close = (sorted[0] - sorted[1]) / (N * N) < 0.12; // winner by under 12 points: tense finish
    const score = sim.leadChanges + (close ? 4 : 0);
    if (score > best.leadChanges) best = { attempt, leadChanges: score };
  }
  return best;
}

module.exports = { Colors, plan, name: 'colors', LENGTH };
