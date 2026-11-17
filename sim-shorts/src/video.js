// Renders frames from a canvas into an MP4 with ffmpeg, then muxes in the generated audio.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const W = 1080;
const H = 1920;
const FPS = 60;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code}): ${err.slice(-800)}`))));
  });
}

/** Opens an ffmpeg pipe that takes raw RGBA frames. */
function openEncoder(file) {
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
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

/** Video + audio into the final MP4, with audio normalized to YouTube's -14 LUFS. */
async function mux(videoFile, wavFile, outFile) {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoFile, '-i', wavFile, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '44100', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outFile]);
}

const tmp = (out, ext) => path.join(path.dirname(out), `.${path.basename(out, '.mp4')}.${ext}`);
const cleanup = (...files) => files.forEach((f) => { try { fs.unlinkSync(f); } catch { /* ignore */ } });

module.exports = { W, H, FPS, openEncoder, mux, tmp, cleanup, run };
