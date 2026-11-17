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

  /**
   * Original background beat across the whole track: kick, off-beat hats, a bass line and soft
   * chords over a I–V–vi–IV progression. Tempo and key come from the seed; it fades in and out
   * and sits well under the sound effects.
   */
  music(seconds, rng, { gain = 0.15 } = {}) {
    const m = new Float32Array(this.buf.length);
    const bpm = 108 + Math.floor(rng() * 20);
    const beat = 60 / bpm;
    const key = 2 ** ((Math.floor(rng() * 8) - 3) / 12); // shift the key -3..+4 semitones
    const C = 130.81 * key; // C3
    const semis = (n) => C * 2 ** (n / 12);
    const prog = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]]; // I V vi IV
    const add = (t, n, fn) => { const st = Math.floor(t * RATE); for (let i = 0; i < n && st + i < m.length; i++) m[st + i] += fn(i / RATE, i); };
    let seed = 7;
    const noise = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 * 2 - 1; };
    const bars = Math.ceil(seconds / (beat * 4));
    for (let bar = 0; bar < bars; bar++) {
      const chord = prog[bar % 4];
      const t0 = bar * beat * 4;
      // Pad: the chord, one octave up, slow swell.
      for (const n of chord) {
        const f = semis(n + 12);
        add(t0, Math.floor(beat * 4 * RATE), (x) => Math.sin(2 * Math.PI * f * x) * 0.05 * Math.min(1, x / 0.4) * Math.min(1, (beat * 4 - x) / 0.3));
      }
      for (let b = 0; b < 4; b++) {
        const tb = t0 + b * beat;
        if (tb > seconds) break;
        // Kick on every beat.
        add(tb, Math.floor(0.25 * RATE), (x) => Math.sin(2 * Math.PI * (45 * x + 75 * (1 - Math.exp(-x * 30)) / 30)) * Math.exp(-x * 14) * 0.55);
        // Hat on the off-beat.
        add(tb + beat / 2, Math.floor(0.04 * RATE), (x) => noise() * Math.exp(-x * 120) * 0.12);
        // Bass: chord root on each eighth, plucky.
        const root = semis(chord[0] - 12);
        for (const off of [0, beat / 2]) add(tb + off, Math.floor(beat / 2 * RATE), (x) => Math.sin(2 * Math.PI * root * x) * Math.exp(-x * 7) * 0.22);
      }
    }
    const fade = Math.floor(1.2 * RATE);
    const end = Math.min(m.length, Math.floor(seconds * RATE));
    for (let i = 0; i < end; i++) {
      const g = Math.min(1, i / fade, (end - i) / fade);
      this.buf[i] += m[i] * g * gain;
    }
  }

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
