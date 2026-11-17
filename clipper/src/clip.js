#!/usr/bin/env node
// Turns a long stream/podcast video into ready-to-post vertical Shorts:
//   1. transcribe (word timestamps + loudness)   2. pick the best moments
//   3. cut each one: stream on top, original parkour gameplay below, word-by-word captions
//   4. write an upload sheet with titles and the campaign checklist
//
//   node src/clip.js input/stream.mp4 --name speed-tour --count 6
//   options: --min 20 --max 50   clip length (s)
//            --focus 0.5         horizontal crop of the stream (0 = left edge, 1 = right edge)
//            --model base.en     speech model (small.en is more accurate, slower)
//            --parkour DIR       folder of gameplay videos for the bottom half (default assets/parkour)
//            --no-parkour        full-height stream instead of split screen
//            --creator "Name"    used in titles/hashtags
const fs = require('node:fs');
const path = require('node:path');
const { run, probe } = require('./encode');
const { findMoments, headline } = require('./moments');
const { buildAss } = require('./captions');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const input = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!input || args.includes('--help')) {
  console.log('Usage: node src/clip.js <video> [--name NAME] [--count 5] [--min 20] [--max 50] [--focus 0.5] [--model base.en] [--creator NAME] [--parkour DIR] [--no-parkour]');
  process.exit(input ? 0 : 1);
}
const name = opt('name', path.basename(input).replace(/\.[^.]+$/, ''));
const outDir = path.join(ROOT, 'out', name);
const count = Number(opt('count', 5));
const minLen = Number(opt('min', 20));
const maxLen = Number(opt('max', 50));
const focus = Math.max(0, Math.min(1, Number(opt('focus', 0.5))));
const model = opt('model', 'base.en');
const creator = opt('creator', null);
const parkourDir = opt('parkour', path.join(ROOT, 'assets', 'parkour'));
const split = !args.includes('--no-parkour');

/** Transcript with word times and loudness, cached next to the clips. */
async function transcript() {
  const file = path.join(outDir, 'transcript.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const wav = path.join(outDir, 'audio.wav');
  console.log('Extracting audio…');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', wav]);
  console.log(`Transcribing with ${model} (a long stream takes a while)…`);
  const py = fs.existsSync(path.join(ROOT, '.venv/bin/python')) ? path.join(ROOT, '.venv/bin/python') : 'python3';
  await run(py, [path.join(__dirname, 'transcribe.py'), wav, file, model], { quiet: false });
  fs.unlinkSync(wav);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Gameplay videos available for the bottom half. */
function gameplay() {
  if (!split) return [];
  const files = fs.existsSync(parkourDir) ? fs.readdirSync(parkourDir).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f)).map((f) => path.join(parkourDir, f)) : [];
  // Skip files that are still being written or broken.
  const ok = files.filter((f) => { try { return probe(f).duration > 5; } catch { return false; } });
  if (ok.length < files.length) console.log(`Skipping ${files.length - ok.length} unreadable gameplay file(s).`);
  files.length = 0; files.push(...ok);
  if (!files.length) throw new Error(`No gameplay videos in ${parkourDir}. Make some with: npm run parkour -- --count 4 --seconds 90`);
  return files;
}

async function cut(m, idx, src, games) {
  const dur = +(m.e - m.s + 0.35).toFixed(2);
  const file = path.join(outDir, `clip-${String(idx + 1).padStart(2, '0')}.mp4`);
  const assFile = path.join(outDir, `.clip-${idx + 1}.ass`);
  const hook = headline(m);
  const words = m.words.map((w) => ({ ...w, s: +(w.s - m.s).toFixed(2), e: +(w.e - m.s).toFixed(2) }));
  fs.writeFileSync(assFile, buildAss(words, { hook, y: split ? 960 : 1300 }));

  const inputs = ['-ss', String(m.s), '-t', String(dur), '-i', src];
  // Fill a box of w x h from the stream, cropping around `focus`.
  const fill = (w, h) => `scale=w='if(gt(a,${w}/${h}),-2,${w})':h='if(gt(a,${w}/${h}),${h},-2)',crop=${w}:${h}:'(iw-${w})*${focus}':'(ih-${h})/2',setsar=1,fps=30`;
  let graph;
  if (split) {
    const g = games[idx % games.length];
    const gd = probe(g).duration;
    const off = gd > dur + 1 ? ((idx * 37.3) % (gd - dur - 0.5)) : 0; // a different stretch of gameplay per clip
    inputs.push('-ss', off.toFixed(2), '-t', String(dur), '-i', g);
    graph = `[0:v]${fill(1080, 960)}[top];[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30[bot];[top][bot]vstack=inputs=2[v0]`;
  } else {
    graph = `[0:v]${fill(1080, 1920)}[v0]`;
  }
  const fontsDir = path.join(ROOT, 'assets', 'fonts');
  graph += `;[v0]ass=${assFile.replace(/:/g, '\\:')}:fontsdir=${fontsDir.replace(/:/g, '\\:')}[v];[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', String(dur), file]);
  fs.unlinkSync(assFile);
  return { file: path.basename(file), start: m.s, end: m.e, seconds: dur, hook, score: +m.score.toFixed(2) };
}

const fmt = (t) => `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function sheet(clips) {
  const tag = creator ? `#${creator.replace(/\s+/g, '').toLowerCase()} ` : '';
  const rows = clips.map((c, i) => [
    `## ${i + 1}. ${c.file}`,
    '',
    `From ${fmt(c.start)} to ${fmt(c.end)} of the source (${c.seconds.toFixed(0)} s)`,
    `**Title:** ${c.hook}${creator ? ` | ${creator}` : ''}`,
    '**Description:**',
    '```',
    `${c.hook}${creator ? `\n\nClip from ${creator}'s stream.` : ''}\n\n${tag}#shorts #clips #stream`,
    '```',
    '',
  ].join('\n'));
  const file = path.join(outDir, 'upload-list.md');
  fs.writeFileSync(file, `# ${name}: ${clips.length} clips\n\nBefore posting, check the campaign rules: allowed platforms, required tags or mentions, and whether gameplay split-screens are allowed. Submit each posted link in the campaign dashboard.\n\n${rows.join('\n')}`);
  return file;
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const info = probe(input);
  if (!info.hasAudio) throw new Error('The video has no audio track to transcribe.');
  const games = gameplay();
  const tr = await transcript();
  const moments = findMoments(tr, { count, minLen, maxLen });
  console.log(`Found ${moments.length} moments. Cutting…`);
  const clips = [];
  for (let i = 0; i < moments.length; i++) {
    const c = await cut(moments[i], i, input, games);
    clips.push(c);
    console.log(`  ${c.file}  ${fmt(c.start)}–${fmt(c.end)}  "${c.hook}"`);
  }
  fs.writeFileSync(path.join(outDir, 'clips.json'), JSON.stringify(clips, null, 2));
  console.log(`Upload sheet: ${sheet(clips)}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
