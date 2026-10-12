// tools/parse-frames.js
// 解析游戏 TCP 分帧协议: 36 字节定长头 + 载荷(长度见头 offset 2, 大端 u16)。
// 用法: node tools/parse-frames.js <sockets/xxx.bin> [--dump <目录>]
//
// 头部字段(实测):
//   [0..1]  09 01              magic
//   [2..3]  u16BE              payload 长度
//   [4..5]  u16BE              命令/类型字段 A
//   [6..7]  u16BE              命令/类型字段 B
//   [8..11] u32BE              序号(客户端自增; 服务端推送为 0)
//   [12..15]u32BE              标志: 2=载荷加密, 3=载荷明文(如服务端通知)
//   [24..27]conn               连接/会话标识(整场固定)
//   [28..31]u32BE              常量(实测 1098)
const fs = require('fs');
const path = require('path');

const HDR = 36;
const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/parse-frames.js <sockets/xxx.bin> [--dump <目录>]');
  process.exit(1);
}
const dumpIdx = process.argv.indexOf('--dump');
const dumpDir = dumpIdx >= 0 ? process.argv[dumpIdx + 1] : null;

const buf = fs.readFileSync(file);
const packets = [];
let off = 0;
let resync = 0;
while (off + HDR <= buf.length) {
  if (buf[off] !== 0x09 || buf[off + 1] !== 0x01) {
    let j = off + 1;
    while (j + 1 < buf.length && !(buf[j] === 0x09 && buf[j + 1] === 0x01)) j++;
    if (j + 1 >= buf.length) break;
    resync++;
    off = j;
    continue;
  }
  const len = buf.readUInt16BE(off + 2);
  if (off + HDR + len > buf.length) break;
  const h = buf.slice(off, off + HDR);
  packets.push({
    seq: h.readUInt32BE(8),
    f4: h.readUInt16BE(4),
    f6: h.readUInt16BE(6),
    flag: h.readUInt32BE(12),
    conn: h.slice(24, 28).toString('hex'),
    len,
    payload: buf.slice(off + HDR, off + HDR + len)
  });
  off += HDR + len;
}

// 粗略判断载荷是否为 protobuf: 首字节低 3 位是合法 wire type
function looksProto(b) {
  if (!b.length) return false;
  const wt = b[0] & 7;
  return wt === 0 || wt === 1 || wt === 2 || wt === 5;
}
const ascii = (b) => b.toString('latin1').replace(/[^\x20-\x7e]/g, '.');

console.log(`${file}  共 ${packets.length} 帧  未解析尾部 ${buf.length - off}B  重同步 ${resync} 次\n`);
console.log('idx  seq    f4   f6    flag  len    proto?  payload(hex head) |ascii|');
for (let i = 0; i < packets.length; i++) {
  const p = packets[i];
  const head = (p.payload.slice(0, 16).toString('hex').match(/.{1,2}/g) || []).join(' ');
  console.log(
    String(i).padStart(3) + '  ' + String(p.seq).padStart(5) + '  ' +
    String(p.f4).padStart(3) + '  ' + String(p.f6).padStart(5) + '  ' +
    String(p.flag).padStart(4) + '  ' + String(p.len).padStart(5) + '  ' +
    (looksProto(p.payload) ? 'yes  ' : 'no   ') +
    head.padEnd(48) + ' |' + ascii(p.payload.slice(0, 20)) + '|'
  );
}

if (dumpDir) {
  fs.mkdirSync(dumpDir, { recursive: true });
  packets.forEach((p, i) => {
    fs.writeFileSync(path.join(dumpDir, `frame-${String(i).padStart(3, '0')}-seq${p.seq}-f${p.f4}-${p.f6}-flag${p.flag}.bin`), p.payload);
  });
  console.log(`\n已导出 ${packets.length} 个载荷到 ${dumpDir}`);
}
