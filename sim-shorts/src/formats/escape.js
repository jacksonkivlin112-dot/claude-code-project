// "Can the ball escape?" — a ball bouncing inside spinning rings, each with a gap.
// Every bounce plays the next note; slipping through a gap shatters that ring.
const { W, H } = require('../video');
const { noteFreq } = require('../audio');
const { caption, background, pop, fmtTime } = require('../draw');

const CX = W / 2;
const CY = H / 2 + 40;
const G = 1100;
const BALL = 17;

class Escape {
  constructor(rng, { gapScale = 1 } = {}) {
    this.rng = rng;
    this.hue = Math.floor(rng() * 360);
    const n = 7 + Math.floor(rng() * 6); // 7-12 rings
    this.rings = [];
    const r0 = 120;
    const r1 = 470;
    for (let i = 0; i < n; i++) {
      const r = r0 + (r1 - r0) * (i / (n - 1));
      const dir = i % 2 ? -1 : 1;
      this.rings.push({
        r,
        rot: rng() * Math.PI * 2,
        w: dir * (0.55 + rng() * 0.9) * (1 - i * 0.03),
        gap: Math.min(1.1, (95 * gapScale) / r),
        hue: (this.hue + i * (300 / n)) % 360,
        broken: null,
        flash: 0,
      });
    }
    const a = rng() * Math.PI * 2;
    const sp = 700 + rng() * 300;
    this.p = { x: CX + Math.cos(a) * 20, y: CY + Math.sin(a) * 20 };
    this.v = { x: Math.cos(a + 1.3) * sp, y: Math.sin(a + 1.3) * sp };
    this.t = 0;
    this.k = 0; // innermost unbroken ring
    this.note = 0;
    this.events = [];
    this.trail = [];
    this.parts = [];
    this.doneAt = null;
  }

  get total() { return this.rings.length; }
  get left() { return this.rings.length - this.k; }

  step(dt) {
    this.t += dt;
    for (const ring of this.rings) ring.rot += ring.w * dt;
    const sub = 8;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.v.y += G * h;
      this.p.x += this.v.x * h;
      this.p.y += this.v.y * h;
      if (this.k >= this.rings.length) continue;
      const ring = this.rings[this.k];
      const dx = this.p.x - CX;
      const dy = this.p.y - CY;
      const d = Math.hypot(dx, dy);
      if (d + BALL < ring.r) continue;
      const ang = Math.atan2(dy, dx);
      const rel = (((ang - ring.rot) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const margin = (BALL * 0.6) / ring.r;
      if (rel > margin && rel < ring.gap - margin) {
        // In the gap: let it through; once fully outside, the ring shatters.
        if (d - BALL > ring.r) this.breakRing();
        continue;
      }
      const nx = dx / d;
      const ny = dy / d;
      const vn = this.v.x * nx + this.v.y * ny;
      if (vn > 0) {
        this.v.x -= 2 * vn * nx;
        this.v.y -= 2 * vn * ny;
        // Keep it lively: nudge speed toward a target so it never dies or explodes.
        const sp = Math.hypot(this.v.x, this.v.y);
        const target = 980;
        const k = (sp + (target - sp) * 0.08) / sp;
        this.v.x *= k; this.v.y *= k;
        ring.flash = 1;
        this.events.push({ t: this.t, type: 'bounce', note: this.note++ });
      }
      this.p.x = CX + nx * (ring.r - BALL - 0.01);
      this.p.y = CY + ny * (ring.r - BALL - 0.01);
    }
    if (this.k >= this.rings.length && this.doneAt == null) this.doneAt = this.t;
    for (const ring of this.rings) ring.flash = Math.max(0, ring.flash - dt * 4);
  }

  breakRing() {
    const ring = this.rings[this.k];
    ring.broken = this.t;
    this.k += 1;
    this.events.push({ t: this.t, type: 'break', ring: this.k, left: this.left });
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const sp = 150 + this.rng() * 450;
      this.parts.push({ x: CX + Math.cos(a) * ring.r, y: CY + Math.sin(a) * ring.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, t0: this.t, hue: ring.hue, s: 4 + this.rng() * 6 });
    }
  }

  /** Visual-only updates (trail, particles) once per frame. */
  frame(dt) {
    this.trail.push({ x: this.p.x, y: this.p.y });
    if (this.trail.length > 22) this.trail.shift();
    for (const q of this.parts) { q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
    this.parts = this.parts.filter((q) => this.t - q.t0 < 1.4);
  }

  /** Sound for one event. */
  sound(synth, e) {
    if (e.type === 'bounce') synth.tone(e.t, noteFreq(e.note % 15, 329.63), { dur: 0.5, vol: 0.2 });
    else {
      synth.noise(e.t, { dur: 0.45, vol: 0.32, seed: e.ring });
      synth.chord(e.t, [e.ring * 2, e.ring * 2 + 2, e.ring * 2 + 4], { dur: 0.8, vol: 0.13, bright: 0.5 });
    }
  }

  draw(ctx, endAt) {
    background(ctx, W, H, this.hue);
    // Rings.
    ctx.lineCap = 'round';
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      if (ring.broken != null) continue;
      const active = i === this.k;
      const lw = active ? 13 + ring.flash * 8 : 9;
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, ring.r, ring.rot + ring.gap, ring.rot + Math.PI * 2);
      // Cheap glow: wide translucent strokes under the solid line (blur is far too slow on CPU).
      ctx.strokeStyle = `hsla(${ring.hue}, 100%, 60%, ${active ? 0.16 : 0.07})`;
      ctx.lineWidth = lw * 3.2; ctx.stroke();
      ctx.strokeStyle = `hsla(${ring.hue}, 100%, 62%, ${active ? 0.3 : 0.12})`;
      ctx.lineWidth = lw * 1.9; ctx.stroke();
      ctx.strokeStyle = `hsl(${ring.hue}, 95%, ${active ? 62 + ring.flash * 25 : 50}%)`;
      ctx.globalAlpha = active ? 1 : 0.8;
      ctx.lineWidth = lw; ctx.stroke();
      ctx.restore();
    }
    // Shatter particles.
    for (const q of this.parts) {
      const a = 1 - (this.t - q.t0) / 1.4;
      ctx.fillStyle = `hsla(${q.hue}, 100%, 65%, ${a})`;
      ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    // Ball + trail (hidden once it has flown clear after escaping, so it never crosses the finish text).
    const showBall = this.doneAt == null || this.t - this.doneAt < 0.5;
    const tc = this.rings[Math.min(this.k, this.rings.length - 1)].hue;
    if (showBall) this.trail.forEach((p, i) => {
      const a = i / this.trail.length;
      ctx.fillStyle = `hsla(${tc}, 100%, 70%, ${a * 0.55})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, BALL * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
    });
    if (showBall) for (const [rr, a] of [[BALL * 2.4, 0.08], [BALL * 1.6, 0.18]]) {
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(this.p.x, this.p.y, rr, 0, Math.PI * 2); ctx.fill();
    }
    if (showBall) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(this.p.x, this.p.y, BALL, 0, Math.PI * 2); ctx.fill();
    }

    // Captions.
    if (this.t < 3.2) caption(ctx, `Can the ball escape\nall ${this.total} rings?`, W / 2, 300, { size: 96, alpha: Math.min(1, (3.2 - this.t) * 2), color: '#fff' });
    else if (this.doneAt == null) caption(ctx, `${this.left}`, W / 2, 260, { size: 150, color: `hsl(${tc}, 100%, 70%)` });
    if (this.t >= 3.2 && this.doneAt == null) caption(ctx, this.left === 1 ? 'LAST RING' : 'RINGS LEFT', W / 2, 355, { size: 46, color: '#ddd', weight: 'SimBold' });
    caption(ctx, fmtTime(Math.min(this.t, this.doneAt ?? this.t)), W / 2, 1560, { size: 64, color: '#bbb', weight: 'SimBold' });
    if (this.doneAt != null) {
      const s = pop((this.t - this.doneAt) / 0.5);
      ctx.save(); ctx.translate(W / 2, 300); ctx.scale(s, s);
      caption(ctx, 'ESCAPED!', 0, 0, { size: 150, color: '#fff' });
      ctx.restore();
      caption(ctx, `in ${this.doneAt.toFixed(1)} seconds`, W / 2, 420, { size: 56, color: '#ddd', weight: 'SimBold' });
      if (this.t > this.doneAt + 1) caption(ctx, 'Did you guess right?', W / 2, 1680, { size: 60, alpha: Math.min(1, (this.t - this.doneAt - 1) * 3) });
    } else if (this.t > 3.2 && this.t < 7) {
      caption(ctx, 'Guess the time in the comments', W / 2, 1680, { size: 52, weight: 'SimBold', alpha: Math.min(1, (this.t - 3.2) * 2, (7 - this.t) * 2) });
    }
  }

  meta() {
    const n = this.total;
    const titles = [
      `Can the ball escape all ${n} rings?`,
      `This ball has to escape ${n} spinning rings`,
      `Guess how long it takes to escape ${n} rings`,
      `${n} rings. 1 ball. How fast can it escape?`,
    ];
    return {
      titles,
      description: `A ball bouncing inside ${n} spinning rings. Every gap it slips through shatters a ring. Guess the escape time in the comments!\n\n#satisfying #physics #simulation #shorts`,
      pinned: 'What time did you guess? 👇 Closest guess gets pinned next video',
      tags: ['satisfying', 'physics simulation', 'ball escape', 'bouncing ball', 'satisfying video', 'shorts'],
    };
  }
}

/** Find settings whose escape lands inside the target window, by simulating ahead. */
function plan(rng0, seed, { min = 34, max = 54 } = {}) {
  let gapScale = 1.9;
  for (let attempt = 0; attempt < 40; attempt++) {
    const sim = new Escape(rng0(`${seed}:${attempt}`), { gapScale });
    while (sim.doneAt == null && sim.t < 75) sim.step(1 / 60);
    const t = sim.doneAt ?? 99;
    if (t >= min && t <= max) return { attempt, gapScale, escapeAt: t };
    gapScale *= t < min ? 0.93 : 1.08;
  }
  return { attempt: 0, gapScale: 1, escapeAt: null };
}

module.exports = { Escape, plan, name: 'escape' };
