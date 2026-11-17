#!/usr/bin/env node
// Builds upload-list.md (title, description, tags, pinned comment) for every video in a folder.
//   node src/sheet.js out/batch1
const fs = require('node:fs');
const path = require('node:path');

const PINNED = {
  escape: 'What time did you guess? 👇 Closest guess gets pinned next video',
  colors: 'Which color did you pick? 👇 Reply with your color before you watch the end',
  race: 'Which marble did you pick? 👇 Winners reply with 🏆',
  battle: 'Which side did you pick? 👇',
};

const SLOTS = [12, 18]; // post at noon and 6 PM

/** Posting time for the i-th video: two a day starting on `start` (a Date at local midnight). */
function slot(start, i) {
  const d = new Date(start);
  d.setDate(d.getDate() + Math.floor(i / SLOTS.length));
  d.setHours(SLOTS[i % SLOTS.length], 0, 0, 0);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function tomorrow() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d; }

function writeUploadList(dir, metas, start = tomorrow()) {
  const rows = metas.map((m, i) => [
    `## ${i + 1}. ${m.file}`,
    '',
    `**Post:** ${slot(start, i)}`,
    `**Title:** ${m.titles[0]}`,
    `Other titles: ${m.titles.slice(1).join(' · ')}`,
    '',
    '**Description:**',
    '```',
    m.description,
    '```',
    `**Tags:** ${m.tags.join(', ')}`,
    `**Pinned comment:** ${m.pinned || PINNED[m.format] || ''}`,
    '',
  ].join('\n'));
  const file = path.join(dir, 'upload-list.md');
  const days = Math.ceil(metas.length / SLOTS.length);
  fs.writeFileSync(file, `# Upload list (${metas.length} videos, ${days} day${days > 1 ? 's' : ''})\n\nTwo a day at noon and 6 PM, starting ${slot(start, 0).split(',').slice(0, 2).join(',')}. Pin the suggested comment right after posting.\nTip: in YouTube Studio you can upload them all now and set each one's "Schedule" time from this list.\n\n${rows.join('\n')}`);
  return file;
}

const ORDER = ['escape', 'colors', 'race', 'battle'];
/** Every video's metadata in a folder, rotating formats so no two in a row match. */
function readMetas(dir) {
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'series.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((m) => m.file && fs.existsSync(path.join(dir, m.file)));
  // One queue per format in episode order, then deal them out round-robin so formats rotate.
  const queues = new Map();
  for (const m of all.sort((a, b) => (a.episode || 0) - (b.episode || 0) || a.file.localeCompare(b.file))) {
    if (!queues.has(m.format)) queues.set(m.format, []);
    queues.get(m.format).push(m);
  }
  const formats = [...queues.keys()].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const out = [];
  while (out.length < all.length) for (const f of formats) { const q = queues.get(f); if (q.length) out.push(q.shift()); }
  return out;
}

module.exports = { writeUploadList, readMetas };

if (require.main === module) {
  // node src/sheet.js DIR [YYYY-MM-DD first posting day]
  const dir = process.argv[2] || 'out';
  const start = process.argv[3] ? new Date(`${process.argv[3]}T00:00:00`) : tomorrow();
  console.log(writeUploadList(dir, readMetas(dir), start));
}
