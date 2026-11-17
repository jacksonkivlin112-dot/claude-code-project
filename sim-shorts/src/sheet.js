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

function writeUploadList(dir, metas) {
  const rows = metas.map((m, i) => [
    `## ${i + 1}. ${m.file}`,
    '',
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
  fs.writeFileSync(file, `# Upload list (${metas.length} videos)\n\nPost one or two a day. Pin the suggested comment right after posting.\n\n${rows.join('\n')}`);
  return file;
}

/** Every video's metadata in a folder, in episode order. */
function readMetas(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'series.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((m) => m.file && fs.existsSync(path.join(dir, m.file)))
    .sort((a, b) => (a.episode || 0) - (b.episode || 0) || a.file.localeCompare(b.file));
}

module.exports = { writeUploadList, readMetas };

if (require.main === module) {
  const dir = process.argv[2] || 'out';
  console.log(writeUploadList(dir, readMetas(dir)));
}
