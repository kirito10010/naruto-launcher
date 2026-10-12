// 解包游戏的 .pkg 资源包 (格式见 PKGLoader.as: readUTF 名 + u32 长度 + 内容)
// 用法: node tools/unpack_pkg.js <x.pkg> [输出目录] [be|le]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let buf = fs.readFileSync(process.argv[2]);
const outDir = process.argv[3] || 'pkg-out';
const endian = process.argv[4] || 'be';
fs.mkdirSync(outDir, { recursive: true });

// pkg 整体可能是 zlib 压缩 (78 da / 78 9c ...)
if (buf[0] === 0x78) {
  try {
    buf = zlib.inflateSync(buf);
    console.log('(zlib 解压后 ' + buf.length + ' 字节)');
  } catch (e) {
    try { buf = zlib.inflateRawSync(buf.slice(2)); console.log('(raw 解压后 ' + buf.length + ' 字节)'); } catch (e2) {}
  }
}

let off = 0, n = 0;
while (off + 2 <= buf.length) {
  const len = endian === 'be' ? buf.readUInt16BE(off) : buf.readUInt16LE(off);
  off += 2;
  if (len === 0 || off + len > buf.length) break;
  const name = buf.slice(off, off + len).toString('utf8');
  off += len;
  if (off + 4 > buf.length) break;
  const size = endian === 'be' ? buf.readUInt32BE(off) : buf.readUInt32LE(off);
  off += 4;
  if (off + size > buf.length) { console.log('TRUNCATED', name, size); break; }
  const data = buf.slice(off, off + size);
  off += size;
  const dest = path.join(outDir, name.replace(/[\\/]/g, '_'));
  fs.writeFileSync(dest, data);
  const sig = data.slice(0, 3).toString('latin1');
  console.log(`${String(size).padStart(8)}  ${sig}  ${name}`);
  n++;
}
console.log(`\n共 ${n} 个文件, 剩余 ${buf.length - off} 字节, 输出 ${outDir}`);
