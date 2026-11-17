// Voiceover with Piper (local, free). Only voices whose training data allows commercial use
// are bundled: joe (CC0), kristin and norman (public domain LibriVox recordings).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PY = fs.existsSync(path.join(ROOT, '.venv/bin/python')) ? path.join(ROOT, '.venv/bin/python') : 'python3';

function speak(text, voice, file, { speed = 1.0 } = {}) {
  const model = path.join(ROOT, 'voices', `en_US-${voice}-medium.onnx`);
  if (!fs.existsSync(model)) throw new Error(`Voice "${voice}" not found at ${model}. Run the setup in the README.`);
  return new Promise((resolve, reject) => {
    // length_scale < 1 speaks a little faster, which suits Shorts.
    const p = spawn(PY, ['-m', 'piper', '-m', model, '-f', file, '--length-scale', String(1 / speed)], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve(file) : reject(new Error(`piper: ${err.slice(-500)}`))));
    p.stdin.end(text);
  });
}

/** 16-bit mono WAV -> { rate, samples: Float32Array }. */
function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12; let rate = 22050; let data = null;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(off + 12);
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  const n = data.length / 2;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, samples };
}

/** Where the speech actually starts and ends (Piper pads both ends with silence). */
function speechBounds({ rate, samples }) {
  const win = Math.floor(rate * 0.02);
  const loud = (i) => { let m = 0; for (let k = i; k < Math.min(samples.length, i + win); k++) m = Math.max(m, Math.abs(samples[k])); return m > 0.02; };
  let a = 0; while (a < samples.length && !loud(a)) a += win;
  let z = samples.length - win; while (z > a && !loud(z)) z -= win;
  return { start: a / rate, end: Math.min(samples.length, z + win) / rate };
}

/** Rough word timings across the spoken part of a line, weighted by word length. */
function wordTimes(text, start, end) {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = words.map((w) => 2 + w.replace(/[^\w]/g, '').length + (/[.,!?]$/.test(w) ? 2 : 0));
  const total = weight.reduce((a, v) => a + v, 0);
  let t = start;
  return words.map((w, i) => {
    const d = ((end - start) * weight[i]) / total;
    const out = { w, s: t, e: t + d };
    t += d;
    return out;
  });
}

module.exports = { speak, readWav, speechBounds, wordTimes };
