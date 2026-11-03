'use strict';
/* Static parity check: compare the table definitions in the classic and React tool pages.
   Source-level (not runtime) so it works without loaded analysis data.
   Usage: node tools/ui_parity.js */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const classicSrc = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
const reactSrc = fs.readFileSync(path.join(root, 'web', 'tool.js'), 'utf8');

function collect(src, pattern) {
  const out = new Set();
  for (const match of src.matchAll(pattern)) out.add(match[1].trim());
  return out;
}

const norm = (name) => name
  .replace(/^亚马逊投流-/, '')
  .replace(/\s+/g, '')
  .toLowerCase();

// Classic: mkTable('tblX', { name: '...' })  React: DataTable title: '...'
const classic = collect(classicSrc, /mkTable\([^,]+,\s*\{\s*name:\s*'([^']+)'/g);
const react = collect(reactSrc, /title:\s*'([^']+)'/g);

const classicNorm = new Map([...classic].map((n) => [norm(n), n]));
const reactNorm = new Map([...react].map((n) => [norm(n), n]));

console.log('classic tables (' + classic.size + '):', [...classic].join(' | '));
console.log('react   tables (' + react.size + '):', [...react].join(' | '));

const missing = [];
for (const [key, name] of classicNorm) {
  if (!reactNorm.has(key)) {
    // Allow a substring match (classic 亚马逊投流-调价清单 vs react 调价清单 already normalised).
    const loose = [...reactNorm.keys()].some((r) => r.includes(key) || key.includes(r));
    if (!loose) missing.push(name);
  }
}

if (missing.length) {
  console.error('\nReact 版缺少这些表：' + missing.join(' | '));
  process.exit(1);
}
console.log('\n两版表格定义一致（' + classic.size + ' 张）');
