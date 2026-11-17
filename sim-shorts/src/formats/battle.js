// "Who wins?" — two fighter balls with different powers bounce around a round arena.
// Every hit deals damage and makes the attacker's power grow. Last ball standing wins.
const { W, H } = require('../video');
const { noteFreq } = require('../audio');
const { caption, background, pop } = require('../draw');

const CX = W / 2;
const CY = 1080;
const ARENA = 470;
const G = 700;

// Each fighter's power: what grows when it lands a hit.
const KINDS = {
  SPIKE: { color: '#ff3b5c', desc: (b) => `DMG ${b.dmg.toFixed(0)}`, onHit: (b) => { b.dmg += 1.6; } },
  DASH: { color: '#1fe0e0', desc: (b) => `SPD ${(b.speed / 800).toFixed(1)}x`, onHit: (b) => { b.speed = Math.min(2000, b.speed * 1.05); } },
  GIANT: { color: '#22d36b', desc: (b) => `SIZE ${Math.round(b.r)}`, onHit: (b) => { b.r = Math.min(150, b.r + 5); } },
  VAMPIRE: { color: '#a259ff', desc: () => 'HEALS ON HIT', onHit: (b, dealt) => { b.hp = Math.min(100, b.hp + dealt * 0.55); } },
  TANK: { color: '#ffc61a', desc: (b) => `ARMOR ${Math.round(b.armor * 100)}%`, onHit: (b) => { b.armor = Math.min(0.6, b.armor + 0.05); } },
};

class Battle {
  // fighters: 2 for a duel, 3-4 for a free-for-all (last ball standing).
  constructor(rng, { dmgScale = 1, fighters = 2 } = {}) {
    this.rng = rng;
    this.hue = Math.floor(rng() * 360);
    const names = Object.keys(KINDS);
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
    names.length = fighters;
    this.ffa = fighters > 2;
    this.balls = names.map((kind, i) => {
      const a = rng() * Math.PI * 2;
      const at = (i / fighters) * Math.PI * 2 + 0.4;
      const start = fighters === 2 ? { x: CX + (i ? 180 : -180), y: CY - 100 + rng() * 60 } : { x: CX + Math.cos(at) * 230, y: CY + Math.sin(at) * 230 };
      return {
        kind, k: KINDS[kind], hp: 100, dmg: 5 * dmgScale, speed: 800, r: this.ffa ? 52 : 62, r0: this.ffa ? 52 : 62, armor: 0,
        ...start, vx: Math.cos(a) * 800, vy: Math.sin(a) * 800,
        flash: 0, hits: 0, out: null,
      };
    });
    this.cools = new Map();
    this.t = 0;
    this.events = [];
    this.pops = []; // floating damage numbers
    this.parts = [];
    this.cool = 0;
    this.doneAt = null;
    this.winner = null;
  }

  step(dt) {
    this.t += dt;
    if (this.doneAt != null) return;
    const sub = 8;
    const h = dt / sub;
    const alive = this.balls.filter((b) => b.out == null);
    for (let s = 0; s < sub; s++) {
      for (const b of alive) {
        b.vy += G * h;
        b.x += b.vx * h; b.y += b.vy * h;
        const dx = b.x - CX; const dy = b.y - CY; const d = Math.hypot(dx, dy);
        if (d + b.r > ARENA) {
          const nx = dx / d; const ny = dy / d;
          b.x = CX + nx * (ARENA - b.r); b.y = CY + ny * (ARENA - b.r);
          const vn = b.vx * nx + b.vy * ny;
          if (vn > 0) {
            b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny;
            // Keep each fighter at its own speed so the fight never stalls.
            const sp = Math.hypot(b.vx, b.vy);
            b.vx *= b.speed / sp; b.vy *= b.speed / sp;
            this.events.push({ t: this.t, type: 'wall', kind: b.kind });
          }
        }
      }
      for (let p = 0; p < alive.length; p++) {
        for (let q = p + 1; q < alive.length; q++) {
          const a = alive[p]; const c = alive[q];
          if (a.hp <= 0 || c.hp <= 0) continue;
          const dx = c.x - a.x; const dy = c.y - a.y; const d = Math.hypot(dx, dy);
          if (!(d > 0 && d < a.r + c.r)) continue;
          const nx = dx / d; const ny = dy / d; const o = (a.r + c.r - d) / 2;
          // How hard each one was charging into the other (before the bounce).
          const inA = Math.max(0, a.vx * nx + a.vy * ny) / a.speed;
          const inC = Math.max(0, -(c.vx * nx + c.vy * ny)) / c.speed;
          a.x -= nx * o; a.y -= ny * o; c.x += nx * o; c.y += ny * o;
          const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rv < 0) {
            // Bigger balls push harder.
            const ma = a.r * a.r; const mc = c.r * c.r;
            const jj = (-2 * rv) / (1 / ma + 1 / mc);
            a.vx -= (jj / ma) * nx; a.vy -= (jj / ma) * ny; c.vx += (jj / mc) * nx; c.vy += (jj / mc) * ny;
            for (const b of [a, c]) { const sp = Math.hypot(b.vx, b.vy); b.vx *= b.speed / sp; b.vy *= b.speed / sp; }
            const key = `${a.kind}|${c.kind}`;
            if (this.t - (this.cools.get(key) ?? -1) > 0.2) { this.cools.set(key, this.t); this.clash(a, c, (a.x + c.x) / 2, (a.y + c.y) / 2, inA, inC); }
          }
        }
      }
    }
    for (const dead of this.balls.filter((b) => b.hp <= 0 && b.out == null)) {
      dead.out = this.t;
      const left = this.balls.filter((b) => b.out == null);
      const final = left.length <= 1;
      this.events.push({ t: this.t, type: 'ko', final });
      for (let i = 0; i < 70; i++) {
        const ang = (i / 70) * Math.PI * 2; const sp = 200 + this.rng() * 600;
        this.parts.push({ x: dead.x, y: dead.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t0: this.t, c: dead.k.color });
      }
      if (final) { this.doneAt = this.t; this.winner = left[0] || dead; }
    }
  }

  clash(a, c, x, y, inA, inC) {
    for (const [att, def, charge] of [[a, c, inA], [c, a, inC]]) {
      // Size and speed hit harder; so does the ball that charged in.
      const power = (att.r / 62) * Math.sqrt(att.speed / 800);
      const dealt = Math.min(def.hp, att.dmg * power * (0.35 + 0.65 * charge) * (1 - def.armor));
      def.hp -= dealt;
      def.flash = 1;
      att.hits += 1;
      att.k.onHit(att, dealt);
      this.pops.push({ x: def.x, y: def.y - def.r - 20, text: `-${Math.max(1, Math.round(dealt))}`, t0: this.t, c: att.k.color });
    }
    // Both can't fall on the same hit: the one with more left over survives on 1 HP.
    if (a.hp <= 0 && c.hp <= 0) { const keep = a.hp >= c.hp ? a : c; keep.hp = 1; }
    for (let i = 0; i < 14; i++) {
      const ang = this.rng() * Math.PI * 2; const sp = 150 + this.rng() * 350;
      this.parts.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t0: this.t, c: '#fff' });
    }
    this.events.push({ t: this.t, type: 'hit', n: a.hits });
  }

  frame(dt) {
    for (const b of this.balls) b.flash = Math.max(0, b.flash - dt * 5);
    for (const q of this.parts) { q.vy += 600 * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
    this.parts = this.parts.filter((q) => this.t - q.t0 < 1);
    this.pops = this.pops.filter((p) => this.t - p.t0 < 0.9);
  }

  sound(synth, e) {
    if (e.type === 'hit') { synth.tone(e.t, noteFreq(e.n % 10, 196), { dur: 0.3, vol: 0.2, bright: 0.7 }); synth.noise(e.t, { dur: 0.12, vol: 0.12, seed: e.n }); }
    else if (e.type === 'wall') synth.tone(e.t, e.kind === this.balls[0].kind ? 523 : 659, { dur: 0.12, vol: 0.035 });
    else if (e.final) { synth.noise(e.t, { dur: 0.8, vol: 0.32, seed: 9 }); synth.chord(e.t + 0.05, [7, 9, 11, 14], { dur: 1.6, vol: 0.16, bright: 0.45 }); }
    else { synth.noise(e.t, { dur: 0.6, vol: 0.28, seed: 4 }); synth.chord(e.t, [0, 2, 4], { dur: 0.9, vol: 0.12 }); }
  }

  draw(ctx) {
    background(ctx, W, H, this.hue);
    // Arena.
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.arc(CX, CY, ARENA, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `hsla(${this.hue}, 70%, 75%, 0.25)`; ctx.lineWidth = 26; ctx.stroke();
    ctx.strokeStyle = `hsl(${this.hue}, 60%, 85%)`; ctx.lineWidth = 8; ctx.stroke();
    ctx.restore();
    // Fighters.
    for (const b of this.balls) {
      if (b.out != null || b.hp <= 0) continue;
      ctx.save();
      ctx.fillStyle = b.k.color;
      ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 14, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      if (b.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${b.flash * 0.7})`; ctx.fill(); }
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 6; ctx.stroke();
      if (b.kind === 'SPIKE') { // spikes around the edge
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 + this.t * 2;
          ctx.beginPath();
          ctx.moveTo(b.x + Math.cos(ang - 0.12) * b.r, b.y + Math.sin(ang - 0.12) * b.r);
          ctx.lineTo(b.x + Math.cos(ang) * (b.r + 18), b.y + Math.sin(ang) * (b.r + 18));
          ctx.lineTo(b.x + Math.cos(ang + 0.12) * b.r, b.y + Math.sin(ang + 0.12) * b.r);
          ctx.fill();
        }
      }
      ctx.restore();
      caption(ctx, `${Math.ceil(b.hp)}`, b.x, b.y, { size: Math.max(34, b.r * 0.7), stroke: 8 });
    }
    for (const q of this.parts) { ctx.globalAlpha = 1 - (this.t - q.t0); ctx.fillStyle = q.c; ctx.fillRect(q.x - 4, q.y - 4, 8, 8); }
    ctx.globalAlpha = 1;
    for (const p of this.pops) caption(ctx, p.text, p.x, p.y - (this.t - p.t0) * 90, { size: 46, color: p.c, alpha: 1 - (this.t - p.t0) / 0.9, stroke: 8 });

    // Health bars + powers.
    if (this.ffa) this.drawRoster(ctx);
    else this.balls.forEach((b, i) => {
      const x0 = i ? W / 2 + 30 : 60;
      const w = W / 2 - 90;
      const y = 420;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0, y, w, 34);
      ctx.fillStyle = b.k.color; const f = Math.max(0, b.hp) / 100;
      if (i) ctx.fillRect(x0, y, w * f, 34); else ctx.fillRect(x0 + w * (1 - f), y, w * f, 34);
      caption(ctx, b.kind, x0 + w / 2, y - 48, { size: 56, color: b.k.color });
      caption(ctx, b.k.desc(b), x0 + w / 2, y + 74, { size: 34, weight: 'SimBold', color: '#ddd', stroke: 8 });
    });
    if (!this.ffa) caption(ctx, 'VS', W / 2, 400, { size: 48, color: '#fff' });
    if (this.t < 3.2) caption(ctx, this.ffa ? 'Last ball standing?' : 'Who wins?', W / 2, 230, { size: this.ffa ? 96 : 110, alpha: Math.min(1, (3.2 - this.t) * 2) });
    else if (this.doneAt == null && this.t < 7) caption(ctx, this.ffa ? 'Pick a fighter in the comments' : 'Pick a side in the comments', W / 2, 1700, { size: 48, weight: 'SimBold', alpha: Math.min(1, (this.t - 3.2) * 2, (7 - this.t) * 2) });
    if (this.doneAt != null) {
      const s = pop((this.t - this.doneAt) / 0.5);
      ctx.save(); ctx.translate(W / 2, 230); ctx.scale(s, s);
      caption(ctx, `${this.winner.kind} WINS!`, 0, 0, { size: 130, color: this.winner.k.color });
      ctx.restore();
      if (this.t > this.doneAt + 0.8) caption(ctx, `with ${Math.ceil(this.winner.hp)} HP left`, W / 2, 1700, { size: 56, alpha: Math.min(1, (this.t - this.doneAt - 0.8) * 3) });
    }
  }

  /** Free-for-all header: one card per fighter with HP bar and power, crossed out when knocked out. */
  drawRoster(ctx) {
    const n = this.balls.length;
    const slot = (W - 60) / n;
    this.balls.forEach((b, i) => {
      const cx = 30 + slot * (i + 0.5);
      const w = slot - 24;
      const y = 400;
      const out = b.out != null;
      ctx.save();
      ctx.globalAlpha = out ? 0.4 : 1;
      caption(ctx, b.kind, cx, y - 40, { size: 40, color: b.k.color, stroke: 8, maxWidth: w });
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(cx - w / 2, y, w, 24);
      ctx.fillStyle = b.k.color; ctx.fillRect(cx - w / 2, y, w * Math.max(0, b.hp) / 100, 24);
      caption(ctx, out ? 'OUT' : b.k.desc(b), cx, y + 56, { size: 26, weight: 'SimBold', color: out ? '#ff6b6b' : '#ddd', stroke: 6, maxWidth: w });
      ctx.restore();
    });
  }

  meta() {
    const names = this.balls.map((x) => x.kind[0] + x.kind.slice(1).toLowerCase());
    if (this.ffa) {
      return {
        titles: [`${names.length} fighters, 1 survivor: who wins?`, `${names.join(' vs ')}: last ball standing`, 'Every hit makes them stronger. Pick a fighter', 'Free-for-all: which ball survives?'],
        description: `${names.length} fighter balls with different powers in one arena. Every hit makes the attacker stronger. Last ball standing wins: ${names.join(', ')}. Comment your pick!\n\n#ballbattle #satisfying #simulation #shorts`,
        pinned: `Which fighter did you pick? 👇 ${names.join(' / ')}`,
        tags: ['ball battle', 'free for all', 'last ball standing', 'satisfying', 'simulation', 'shorts'],
      };
    }
    const [a, b] = names;
    return {
      titles: [`${a} vs ${b}: who wins?`, `${a} ball vs ${b} ball`, `Every hit makes them stronger. ${a} or ${b}?`, 'Pick a side before the fight starts'],
      description: `Two fighter balls with different powers. Every hit deals damage and makes the attacker stronger. ${a} or ${b}? Comment your pick!\n\n#ballbattle #satisfying #simulation #shorts`,
      pinned: `${a} or ${b}? 👇 Comment your pick`,
      tags: ['ball battle', 'who wins', 'satisfying', 'simulation', 'bouncing balls', 'shorts'],
    };
  }
}

/** Tune damage so the fight lasts 30–50 s and ends close. */
function plan(rng0, seed, { min = 36, max = 52, variant = null } = {}) {
  // About 4 in 10 battles are free-for-alls with 3 or 4 fighters, picked by the seed.
  const vr = rng0(`${seed}:variant`);
  const v = variant || (vr() < 0.4 ? 'ffa' : 'duel');
  const fighters = v === 'ffa' ? (vr() < 0.5 ? 3 : 4) : 2;
  let dmgScale = v === 'ffa' ? 1.4 : 1;
  let best = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const sim = new Battle(rng0(`${seed}:${attempt}`), { dmgScale, fighters });
    while (sim.doneAt == null && sim.t < 70) sim.step(1 / 60);
    const t = sim.doneAt ?? 99;
    if (t >= min && t <= max) {
      const left = sim.winner.hp; // lower = closer fight
      // Best: a close fight that isn't a coin-flip finish on 1 HP.
      const closeness = Math.abs(left - 15);
      if (!best || closeness < best.closeness) best = { attempt, dmgScale, fighters, variant: v, koAt: t, left, closeness };
      if (left > 4 && left < 30) break;
    } else dmgScale *= t < min ? 0.85 : 1.15;
  }
  return best || { attempt: 0, dmgScale: 1, fighters, variant: v, koAt: null, left: null };
}

module.exports = { Battle, plan, name: 'battle' };
