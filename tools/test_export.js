// tools/test_export.js —— 用已有 netlog 直接跑导出逻辑（不开游戏即可验证）
// 用法: node tools/test_export.js <captures/netlog-xxx.json> [输出目录]
const path = require('path');
const fs = require('fs');
const ex = require('../export');
const { writeXlsx } = require('../xlsx');

const netlog = process.argv[2];
if (!netlog) {
  console.error('用法: node tools/test_export.js <captures/netlog-xxx.json> [输出目录]');
  process.exit(1);
}
const out = process.argv[3] || path.join(path.dirname(netlog), 'export-test');

const { tx, rx } = ex.extractGameStream(netlog);
console.log('提取游戏流: tx=' + tx.length + 'B  rx=' + rx.length + 'B');
const stamp = process.argv[4] || '2026-10-12';
const sheets = ex.buildSheets(rx, stamp);

fs.mkdirSync(out, { recursive: true });
for (const [name, s] of sheets) {
  writeXlsx(path.join(out, name), s);
  console.log(name.padEnd(20) + s.map((x) => x.name + ':' + (x.rows.length - 1) + '行').join(', '));
}
console.log('\n输出目录: ' + out);
for (const [name, s] of sheets) {
  console.log('=== ' + name + ' ===');
  for (const r of s[0].rows.slice(0, 4)) console.log('  ' + r.join(' | '));
}
