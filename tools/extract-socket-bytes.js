// tools/extract-socket-bytes.js
// 从 Chromium net-log 中提取 socket 原始收发字节，按连接重建为二进制流。
// 用法: node tools/extract-socket-bytes.js <captures/netlog-xxx.json> [输出目录] [socketId]
// 前置: 抓包时须使用 --net-log-capture-mode=IncludeSocketBytes
//
// 说明: net-log 的 params.bytes 是 base64 编码的原始字节（不是 hex）。
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/extract-socket-bytes.js <captures/netlog-xxx.json> [输出目录] [socketId]');
  process.exit(1);
}
const outDir = process.argv[3] || path.join(path.dirname(file), 'sockets');
const onlyId = process.argv[4] ? String(process.argv[4]) : null;

const log = JSON.parse(fs.readFileSync(file, 'utf8'));

const nameOfType = {};
for (const [name, val] of Object.entries((log.constants && log.constants.logEventTypes) || {})) {
  nameOfType[val] = name;
}

const BYTE_EVENTS = new Set([
  'SOCKET_BYTES_SENT',
  'SOCKET_BYTES_RECEIVED',
  'SSL_SOCKET_BYTES_SENT',
  'SSL_SOCKET_BYTES_RECEIVED'
]);

const streams = {}; // `${srcId}-${rx|tx}` -> Buffer[]
const addrOf = {};
const counts = {}; // srcId -> {tx, rx}

for (const ev of log.events || []) {
  const tname = nameOfType[ev.type];
  if (!tname) continue;
  const srcId = ev.source && ev.source.id;
  const p = ev.params || {};

  if (tname === 'TCP_CONNECT' || tname === 'TCP_CONNECT_ATTEMPT' || tname === 'SSL_CONNECT' || tname === 'UDP_CONNECT') {
    const a = p.address || (Array.isArray(p.address_list) ? p.address_list.join('|') : null);
    if (a) addrOf[srcId] = a;
  }

  if (BYTE_EVENTS.has(tname)) {
    if (typeof p.bytes !== 'string') continue;
    const buf = Buffer.from(p.bytes, 'base64'); // ← base64, 不是 hex
    const dir = tname.indexOf('RECEIVED') >= 0 ? 'rx' : 'tx';
    const key = `${srcId}-${dir}`;
    (streams[key] = streams[key] || []).push(buf);
    counts[srcId] = counts[srcId] || { tx: 0, rx: 0 };
    counts[srcId][dir] += buf.length;
  }
}

let keys = Object.keys(streams);
if (onlyId) keys = keys.filter((k) => k.startsWith(onlyId + '-'));

if (keys.length === 0) {
  console.error('未发现 socket 字节事件。请确认抓包时使用了 --net-log-capture-mode=IncludeSocketBytes');
  process.exit(2);
}

console.log('=== 连接信息（socket id -> 地址）===');
for (const [id, addr] of Object.entries(addrOf)) {
  const c = counts[id] || { tx: 0, rx: 0 };
  console.log(`  #${id}\t${addr}\ttx=${c.tx} rx=${c.rx}`);
}

fs.mkdirSync(outDir, { recursive: true });
console.log('\n=== 提取结果 ===');
for (const key of keys.sort()) {
  const buf = Buffer.concat(streams[key]);
  const outFile = path.join(outDir, `${key}.bin`);
  fs.writeFileSync(outFile, buf);
  const hex = buf.slice(0, 24).toString('hex').match(/.{1,2}/g).join(' ');
  console.log(`${key.padEnd(12)} ${String(buf.length).padStart(8)} 字节  ${outFile}`);
  console.log(`              hex: ${hex}${buf.length > 24 ? ' ...' : ''}`);
}
console.log(`\n共 ${keys.length} 条流，输出目录: ${outDir}`);
