#!/usr/bin/env node
// Usage:
//   node src/cli.js                         one random Short
//   node src/cli.js --format escape --count 5
//   node src/cli.js --format colors --seed 42
//   node src/cli.js --count 10 --out videos/batch1
const { makeShort, FORMATS } = require('./make');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
if (args.includes('--help') || args.includes('-h')) {
  console.log(`sim-shorts: generate satisfying simulation YouTube Shorts\n\n  --format ${Object.keys(FORMATS).join('|')}|random (default random)\n  --count N        how many videos (default 1)\n  --seed S         start seed (default: random)\n  --out DIR        output folder (default out)\n`);
  process.exit(0);
}
const count = Number(opt('count', 1));
const outDir = opt('out', 'out');
const fmt = opt('format', 'random');
const seed0 = opt('seed', null);

(async () => {
  for (let n = 0; n < count; n++) {
    const format = fmt === 'random' ? Object.keys(FORMATS)[n % Object.keys(FORMATS).length] : fmt;
    const seed = seed0 != null ? `${seed0}${count > 1 ? `-${n}` : ''}` : Math.random().toString(36).slice(2, 8);
    const t0 = Date.now();
    process.stdout.write(`[${n + 1}/${count}] ${format} seed=${seed} `);
    const { out, meta } = await makeShort({ format, seed, outDir, onProgress: (f) => process.stdout.write(`${Math.round(f * 100)}% `) });
    console.log(`\n  -> ${out} (${meta.seconds}s, rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s)\n  title: ${meta.titles[0]}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
