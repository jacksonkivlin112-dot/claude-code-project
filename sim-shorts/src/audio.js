// Tiny synth: every sound is generated, so there is nothing to license.
const fs = require('node:fs');

const RATE = 44100;
// Major pentatonic: any run of these notes sounds pleasant.
const PENTA = [0, 2, 4, 7, 9];
const noteFreq = (step, base = 261.63) => {
  const oct = Math.floor(step / PENTA.length);
  const deg = ((step % PENTA.length) + PENTA.length) % PENTA.length;
  return base * 2 ** ((oct * 12 + PENTA[deg]) / 12);
};

class Synth {
  constructor(seconds) {
    this.buf = new Float32Array(Math.ceil(seconds * RATE) + RATE);
  }

  /** A plucked tone: sine + a bit of triangle, fast attack, exponential decay. */
  tone(t, freq, { dur = 0.45, vol = 0.22, bright = 0.35 } = {}) {
    const start = Math.floor(t * RATE);
    const n = Math.floor(dur * RATE);
    for (let i = 0; i < n && start + i < this.buf.length; i++) {
      const x = i / RATE;
      const env = Math.min(1, i / 120) * Math.exp(-x * (5.5 / dur));
      const ph = 2 * Math.PI * freq * x;
      const tri = (2 / Math.PI) * Math.asin(Math.sin(ph));
      const s = Math.sin(ph) * (1 - bright) + tri * bright + 0.18 * Math.sin(ph * 2) * Math.exp(-x * 12);
      this.buf[start + i] += s * env * vol;
    }
  }

  /** Short filtered noise burst (shatter / pop). */
  noise(t, { dur = 0.35, vol = 0.18, seed = 1 } = {}) {
    let r = seed * 9301 + 49297;
    const start = Math.floor(t * RATE);
    const n = Math.floor(dur * RATE);
    let lp = 0;
    for (let i = 0; i < n && start + i < this.buf.length; i++) {
      r = (r * 9301 + 49297) % 233280;
      const w = r / 233280 * 2 - 1;
      lp += (w - lp) * 0.35;
      this.buf[start + i] += lp * Math.exp(-(i / RATE) * (7 / dur)) * vol;
    }
  }

  chord(t, steps, opts) { steps.forEach((s, i) => this.tone(t + i * 0.035, noteFreq(s), opts)); }

  /** Soft limiter + 16-bit WAV. */
  writeWav(file) {
    const n = this.buf.length;
    const out = Buffer.alloc(44 + n * 2);
    out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVE', 8);
    out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
    out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
    out.write('data', 36); out.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
      const v = Math.tanh(this.buf[i] * 1.2);
      out.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
    }
    fs.writeFileSync(file, out);
  }
}

module.exports = { Synth, noteFreq, RATE };
