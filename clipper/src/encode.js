// ffmpeg helpers: pipe raw RGBA frames into an MP4, run commands, probe media.
const { spawn, execFileSync } = require('node:child_process');

function openEncoder(file, { w, h, fps = 60, crf = 20 }) {
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    file,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.slice(-800)}`)))));
  return {
    write: (buf) => new Promise((resolve) => { if (ff.stdin.write(buf)) resolve(); else ff.stdin.once('drain', resolve); }),
    close: async () => { ff.stdin.end(); await done; },
  };
}

function run(cmd, args, { quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-1200)}`))));
  });
}

/** Duration (s), width and height of a media file. */
function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  return { duration: Number(j.format?.duration || 0), width: v?.width || 0, height: v?.height || 0, hasAudio: (j.streams || []).some((s) => s.codec_type === 'audio') };
}

module.exports = { openEncoder, run, probe };
