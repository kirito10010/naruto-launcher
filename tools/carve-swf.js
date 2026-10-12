// tools/carve-swf.js
// 从 Chromium 缓存目录中按签名(FWS/CWS/ZWS)提取 SWF 文件。
// 用法: node tools/carve-swf.js <缓存目录> [输出目录] [最小字节数]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const dir = process.argv[2];
const outDir = process.argv[3] || 'swf-out';
const minSize = parseInt(process.argv[4] || '10000', 10);
if (!dir) {
  console.error('用法: node tools/carve-swf.js <缓存目录> [输出目录] [最小字节数]');
  process.exit(1);
}

const SIGS = ['FWS', 'CWS', 'ZWS'];

function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

fs.mkdirSync(outDir, { recursive: true });
const files = walk(dir, []);
const found = [];

for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(f); } catch (e) { continue; }
  for (const sig of SIGS) {
    const sigBuf = Buffer.from(sig);
    let i = buf.indexOf(sigBuf);
    while (i >= 0) {
      if (i + 8 <= buf.length) {
        const version = buf[i + 3];
        const declared = buf.readUInt32LE(i + 4);
        if (declared >= minSize && declared < 100 * 1024 * 1024) {
          const end = Math.min(buf.length, i + declared);
          const raw = buf.slice(i, end);
          const hash = crypto.createHash('md5').update(raw).digest('hex').slice(0, 8);
          const name = `${sig}-v${version}-${declared}-${hash}.swf`;
          const out = path.join(outDir, name);
          if (!fs.existsSync(out)) fs.writeFileSync(out, raw);
          let inflated = '';
          if (sig === 'CWS') {
            try {
              const body = zlib.inflateSync(buf.slice(i + 8));
              const head = Buffer.alloc(8);
              head.write('FWS', 0, 'latin1');
              head[3] = version;
              head.writeUInt32LE(8 + body.length, 4);
              fs.writeFileSync(out.replace(/\.swf$/, '.fws.swf'), Buffer.concat([head, body]));
              inflated = ` (inflated ${body.length})`;
            } catch (e) { inflated = ' (inflate failed)'; }
          }
          found.push({ file: path.basename(f), sig, version, declared, carved: raw.length, name });
          console.log(`${name.padEnd(34)} from ${path.basename(f).padEnd(12)} declared=${declared} carved=${raw.length}${inflated}`);
        }
      }
      i = buf.indexOf(sigBuf, i + 1);
    }
  }
}

console.log(`\n共提取 ${found.length} 个 SWF，输出目录: ${outDir}`);
console.log('\n=== 按声明大小排序（与 content-length 对照）===');
for (const x of found.sort((a, b) => b.declared - a.declared)) {
  console.log(`${String(x.declared).padStart(9)}  ${x.name}`);
}
