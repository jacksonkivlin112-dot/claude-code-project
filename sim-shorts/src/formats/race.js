// "Which marble wins?" — colored marbles race down a randomly built course of pegs,
// zigzag ramps, funnels and bumpers. The camera follows the leader; first across the line wins.
const { W, H } = require('../video');
const { noteFreq } = require('../audio');
const { caption, background, pop } = require('../draw');

const MARBLES = [
  { name: 'RED', fill: '#ff3b5c' }, { name: 'BLUE', fill: '#2f8cff' }, { name: 'GREEN', fill: '#22d36b' },
  { name: 'YELLOW', fill: '#ffc61a' }, { name: 'PURPLE', fill: '#a259ff' }, { name: 'ORANGE', fill: '#ff8a1f' },
  { name: 'PINK', fill: '#ff5fc8' }, { name: 'CYAN', fill: '#1fe0e0' },
];
const L = 70; // left wall
const RW = 1010; // right wall
const R = 25;
const G = 1500;
const VIEW_TOP = 470; // screen y where the course view starts (header above)

class Race {
  constructor(rng, { sections = 7 } = {}) {
    this.rng = rng;
    this.hue = Math.floor(rng() * 360);
    const n = 4 + Math.floor(rng() * 3); // 4-6 marbles
    this.teams = [...MARBLES].sort(() => rng() - 0.5).slice(0, n);
    this.segs = [];
    this.pegs = [];
    this.bumpers = [];
    let y = 260;
    const kinds = ['pegs', 'zigzag', 'funnel', 'bumpers', 'pegs', 'zigzag', 'stairs'];
    for (let s = 0; s < sections; s++) {
      const kind = s === 0 ? 'pegs' : kinds[Math.floor(rng() * kinds.length)];
      y = this.build(kind, y) + 120;
    }
    this.finish = y + 60;
    this.length = this.finish + 200;
    this.segs.push([L, -400, L, this.length], [RW, -400, RW, this.length]);
    this.balls = this.teams.map((t, i) => ({
      team: i, x: L + 90 + (i + 0.5) * ((RW - L - 180) / n) + (rng() - 0.5) * 30, y: 80 + rng() * 40,
      vx: (rng() - 0.5) * 120, vy: 0, done: null, still: 0, lastHit: -1,
    }));
    this.t = 0;
    this.camY = 0;
    this.events = [];
    this.order = [];
    this.leader = -1;
    this.leadChanges = 0;
    this.doneAt = null;
  }

  build(kind, y) {
    const rng = this.rng;
    const mid = (L + RW) / 2;
    if (kind === 'pegs') {
      const rows = 6 + Math.floor(rng() * 3);
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? 60 : 0;
        for (let x = L + 70 + off; x < RW - 40; x += 120) this.pegs.push({ x, y: y + r * 105, r: 11 });
      }
      return y + rows * 105;
    }
    if (kind === 'zigzag') {
      const n = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const fromLeft = i % 2 === 0;
        const gap = 150;
        if (fromLeft) this.segs.push([L, y + i * 260, RW - gap, y + i * 260 + 210]);
        else this.segs.push([RW, y + i * 260, L + gap, y + i * 260 + 210]);
      }
      return y + n * 260 + 210;
    }
    if (kind === 'funnel') {
      const gap = 90 + rng() * 40;
      const cx = mid + (rng() - 0.5) * 300;
      this.segs.push([L, y, cx - gap / 2, y + 300], [RW, y, cx + gap / 2, y + 300]);
      this.pegs.push({ x: cx, y: y + 420, r: 18 }); // splitter below the neck
      return y + 480;
    }
    if (kind === 'bumpers') {
      const n = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) this.bumpers.push({ x: L + 110 + rng() * (RW - L - 220), y: y + 60 + i * 150 + rng() * 40, r: 38 + rng() * 14 });
      return y + n * 150 + 80;
    }
    // stairs: short alternating ledges marbles bounce down
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = i % 2 ? mid - 40 : L;
      const x1 = i % 2 ? RW : mid + 40;
      this.segs.push([x0, y + i * 160 + (i % 2 ? 40 : 0), x1, y + i * 160 + (i % 2 ? 0 : 40)]);
    }
    return y + n * 160 + 60;
  }

  progress(b) { return b.done != null ? 1e6 - b.done : b.y; }

  step(dt) {
    this.t += dt;
    const sub = 10;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const b of this.balls) {
        if (b.done != null) continue;
        b.vy += G * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        for (const sg of this.segs) this.hitSeg(b, sg);
        for (const p of this.pegs) this.hitCircle(b, p, 0.55, 0);
        for (const p of this.bumpers) this.hitCircle(b, p, 1.0, 380);
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 1600) { b.vx *= 1600 / sp; b.vy *= 1600 / sp; }
      }
      // Marble-marble.
      for (let i = 0; i < this.balls.length; i++) {
        for (let j = i + 1; j < this.balls.length; j++) {
          const a = this.balls[i]; const c = this.balls[j];
          if (a.done != null || c.done != null) continue;
          const dx = c.x - a.x; const dy = c.y - a.y; const d = Math.hypot(dx, dy);
          if (d > 0 && d < 2 * R) {
            const nx = dx / d; const ny = dy / d; const o = (2 * R - d) / 2;
            a.x -= nx * o; a.y -= ny * o; c.x += nx * o; c.y += ny * o;
            const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (rv < 0) { const imp = -1.8 * rv / 2; a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny; }
          }
        }
      }
    }
    for (const b of this.balls) {
      if (b.done != null) continue;
      // A marble resting on a ledge gets a small push so nobody is stuck forever.
      b.still = Math.hypot(b.vx, b.vy) < 40 ? b.still + dt : 0;
      if (b.still > 1.2) { b.vx += (this.rng() - 0.5) * 500; b.vy -= 200; b.still = 0; }
      if (b.y > this.finish) {
        b.done = this.t;
        this.order.push(b.team);
        this.events.push({ t: this.t, type: this.order.length === 1 ? 'win' : 'finish', team: b.team, place: this.order.length });
      }
    }
    const lead = [...this.balls].sort((a, c) => this.progress(c) - this.progress(a))[0].team;
    if (lead !== this.leader) { if (this.leader !== -1 && this.t > 2) this.leadChanges += 1; this.leader = lead; }
    if (this.doneAt == null && this.order.length === this.balls.length) this.doneAt = this.t;
    if (this.doneAt == null && this.order.length && this.t - this.balls.find((b) => b.team === this.order[0]).done > 6) this.doneAt = this.t;
  }

  hitSeg(b, [x1, y1, x2, y2]) {
    const dx = x2 - x1; const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const u = Math.max(0, Math.min(1, ((b.x - x1) * dx + (b.y - y1) * dy) / len2));
    const px = x1 + u * dx; const py = y1 + u * dy;
    const ex = b.x - px; const ey = b.y - py;
    const d = Math.hypot(ex, ey);
    if (d >= R || d === 0) return;
    const nx = ex / d; const ny = ey / d;
    b.x = px + nx * R; b.y = py + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= 1.45 * vn * nx; b.vy -= 1.45 * vn * ny; // restitution 0.45
      if (-vn > 260) this.click(b, -vn);
    }
  }

  hitCircle(b, p, rest, kick) {
    const dx = b.x - p.x; const dy = b.y - p.y; const d = Math.hypot(dx, dy);
    const min = R + p.r;
    if (d >= min || d === 0) return;
    const nx = dx / d; const ny = dy / d;
    b.x = p.x + nx * min; b.y = p.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny;
      if (kick) { b.vx += nx * kick; b.vy += ny * kick; p.flash = 1; }
      if (-vn > 200 || kick) this.click(b, -vn + kick);
    }
  }

  click(b, strength) {
    if (this.t - b.lastHit < 0.07) return;
    b.lastHit = this.t;
    this.events.push({ t: this.t, type: 'hit', team: b.team, s: Math.min(1, strength / 1200) });
  }

  frame(dt) {
    // Camera follows the leader (still racing), smoothly.
    const racing = this.balls.filter((b) => b.done == null);
    const target = racing.length ? Math.max(...racing.map((b) => b.y)) : this.finish;
    const want = Math.min(this.length - (H - VIEW_TOP), Math.max(0, target - (H - VIEW_TOP) * 0.55));
    this.camY += (want - this.camY) * Math.min(1, dt * 4);
    for (const p of this.bumpers) p.flash = Math.max(0, (p.flash || 0) - dt * 4);
  }

  sound(synth, e) {
    if (e.type === 'hit') synth.tone(e.t, noteFreq(e.team * 2 + Math.floor(e.t * 13) % 4, 392), { dur: 0.18, vol: 0.05 + e.s * 0.1, bright: 0.6 });
    else if (e.type === 'win') { synth.chord(e.t, [7, 9, 11, 12], { dur: 1.4, vol: 0.17, bright: 0.45 }); synth.noise(e.t, { dur: 0.5, vol: 0.18, seed: 7 }); }
    else synth.tone(e.t, noteFreq(10 - e.place, 392), { dur: 0.4, vol: 0.1 });
  }

  draw(ctx) {
    background(ctx, W, H, this.hue);
    const oy = VIEW_TOP - this.camY;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, VIEW_TOP - 20, W, H - VIEW_TOP + 20); ctx.clip();
    const vis = (y) => y + oy > VIEW_TOP - 120 && y + oy < H + 120;
    // Finish line (checkered).
    if (vis(this.finish)) {
      for (let i = 0; i < 24; i++) for (let k = 0; k < 2; k++) {
        ctx.fillStyle = (i + k) % 2 ? '#fff' : '#111';
        ctx.fillRect(L + i * ((RW - L) / 24), this.finish + oy + k * 20, (RW - L) / 24, 20);
      }
    }
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2] of this.segs) {
      if (!vis(y1) && !vis(y2) && !(y1 + oy < VIEW_TOP && y2 + oy > H)) continue;
      ctx.strokeStyle = `hsla(${this.hue}, 70%, 70%, 0.25)`; ctx.lineWidth = 22;
      ctx.beginPath(); ctx.moveTo(x1, y1 + oy); ctx.lineTo(x2, y2 + oy); ctx.stroke();
      ctx.strokeStyle = `hsl(${this.hue}, 60%, 85%)`; ctx.lineWidth = 9; ctx.stroke();
    }
    ctx.fillStyle = `hsl(${(this.hue + 180) % 360}, 70%, 75%)`;
    for (const p of this.pegs) if (vis(p.y)) { ctx.beginPath(); ctx.arc(p.x, p.y + oy, p.r, 0, Math.PI * 2); ctx.fill(); }
    for (const p of this.bumpers) {
      if (!vis(p.y)) continue;
      ctx.fillStyle = `hsla(${(this.hue + 90) % 360}, 90%, ${55 + (p.flash || 0) * 30}%, 1)`;
      ctx.beginPath(); ctx.arc(p.x, p.y + oy, p.r + (p.flash || 0) * 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
    }
    for (const b of this.balls) {
      if (b.done != null && b.y + oy > H + 50) continue;
      const t = this.teams[b.team];
      ctx.fillStyle = t.fill;
      ctx.beginPath(); ctx.arc(b.x, b.y + oy, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(b.x - R * 0.35, b.y + oy - R * 0.35, R * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y + oy, R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // Header: hook, then the live standings.
    const ranked = [...this.balls].sort((a, c) => this.progress(c) - this.progress(a));
    if (this.t < 3.2) caption(ctx, 'Which marble wins?', W / 2, 250, { size: 104, alpha: Math.min(1, (3.2 - this.t) * 2) });
    else if (!this.order.length) {
      const n = ranked.length;
      const slot = Math.min(170, (W - 80) / n);
      ranked.forEach((b, i) => {
        const x = W / 2 + (i - (n - 1) / 2) * slot;
        const t = this.teams[b.team];
        ctx.fillStyle = t.fill;
        ctx.beginPath(); ctx.arc(x, 250, i === 0 ? 40 : 30, 0, Math.PI * 2); ctx.fill();
        caption(ctx, `${i + 1}`, x, 250, { size: i === 0 ? 44 : 34, stroke: 8 });
        caption(ctx, t.name, x, 320, { size: 26, weight: 'SimBold', stroke: 6, color: '#ddd' });
      });
      if (this.t < 7) caption(ctx, 'Pick a color in the comments', W / 2, 400, { size: 44, weight: 'SimBold', alpha: Math.min(1, (this.t - 3.2) * 2, (7 - this.t) * 2) });
    } else {
      const win = this.teams[this.order[0]];
      const tw = this.balls.find((b) => b.team === this.order[0]).done;
      const s = pop((this.t - tw) / 0.5);
      ctx.save(); ctx.translate(W / 2, 250); ctx.scale(s, s);
      caption(ctx, `${win.name} WINS!`, 0, 0, { size: 130, color: win.fill });
      ctx.restore();
      caption(ctx, this.order.slice(1, 3).map((k, i) => `${i + 2}. ${this.teams[k].name}`).join('   '), W / 2, 370, { size: 44, weight: 'SimBold', color: '#ddd' });
    }
  }

  meta() {
    const names = this.teams.map((t) => t.name[0] + t.name.slice(1).toLowerCase());
    return {
      titles: ['Which marble wins?', `${this.teams.length} marbles, 1 winner. Pick yours`, `${names.join(' vs ')} marble race`, 'Pick a marble before the race starts'],
      description: 'Pick a marble and comment before it crosses the line! Every course is randomly built, so no two races are the same.\n\n#marblerace #satisfying #simulation #shorts',
      pinned: 'Which marble did you pick? 👇 Winners reply with 🏆',
      tags: ['marble race', 'which marble wins', 'satisfying', 'simulation', 'marble run', 'shorts'],
    };
  }
}

/** Build courses until the winner lands in the time window, preferring lots of lead changes. */
function plan(rng0, seed, { min = 38, max = 52 } = {}) {
  let sections = 7;
  let best = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const sim = new Race(rng0(`${seed}:${attempt}`), { sections });
    while (sim.doneAt == null && sim.t < 70) sim.step(1 / 60);
    const win = sim.order.length ? sim.balls.find((b) => b.team === sim.order[0]).done : 99;
    if (win >= min && win <= max) {
      const score = sim.leadChanges;
      if (!best || score > best.score) best = { attempt, sections, winAt: win, score };
      if (score >= 6) break;
    } else sections = Math.max(3, Math.min(14, sections + (win < min ? 1 : -1)));
  }
  return best || { attempt: 0, sections: 7, winAt: null, score: 0 };
}

module.exports = { Race, plan, name: 'race' };
