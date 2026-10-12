// tools/swf-strings.js
// 解压 SWF(CWS/ZWS) 并提取可读 ASCII 字符串，用于定位类名/方法名/密钥等。
// 用法: node tools/swf-strings.js <xxx.swf> [输出txt]
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/swf-strings.js <xxx.swf> [输出txt]');
  process.exit(1);
}
const buf = fs.readFileSync(file);
const sig = buf.slice(0, 3).toString('latin1');

let body;
if (sig === 'CWS') {
  body = zlib.inflateSync(buf.slice(8));
} else if (sig === 'ZWS') {
  const lzma = require('zlib'); // 占位: LZMA 需额外库, 这里仅提示
  console.error('ZWS(LZMA) 暂不支持');
  process.exit(1);
} else if (sig === 'FWS') {
  body = buf.slice(8);
} else {
  console.error('不是有效的 SWF 文件, 签名: ' + JSON.stringify(sig));
  process.exit(1);
}

const strs = [];
let cur = [];
for (const b of body) {
  if (b >= 0x20 && b < 0x7f) {
    cur.push(b);
  } else {
    if (cur.length >= 4) strs.push(Buffer.from(cur).toString('latin1'));
    cur = [];
  }
}
if (cur.length >= 4) strs.push(Buffer.from(cur).toString('latin1'));

console.log(`${file}  签名=${sig}  解压后=${body.length}B  字符串数=${strs.length}`);

const out = process.argv[3];
if (out) {
  fs.writeFileSync(out, strs.join('\n'));
  console.log('已写入 ' + out);
} else {
  console.log(strs.join('\n'));
}
