// tools/analyze-capture.js
// 用法: node tools/analyze-capture.js <captures/http-xxx.jsonl>
// 离线分析抓包结果：按 host 汇总、找大响应体、关键词检索、打印 WebSocket 帧。
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('用法: node tools/analyze-capture.js <captures/http-xxx.jsonl>');
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const lines = raw
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      return null;
    }
  })
  .filter(Boolean);

const byHost = {};
const byPath = {};
const bodies = [];
const wsFrames = [];

for (const ev of lines) {
  if (ev.type === 'req') {
    let host = '?';
    let pathname = '?';
    try {
      const u = new URL(ev.url);
      host = u.host;
      pathname = u.pathname;
    } catch (e) {
      // 非标准 URL，忽略
    }
    byHost[host] = byHost[host] || { count: 0, methods: {}, urls: new Set() };
    byHost[host].count++;
    byHost[host].methods[ev.method] = (byHost[host].methods[ev.method] || 0) + 1;
    byHost[host].urls.add(ev.url.split('?')[0]);

    const pk = host + pathname;
    byPath[pk] = (byPath[pk] || 0) + 1;
  }

  if (ev.type === 'body' && ev.body) bodies.push(ev);
  if (ev.type.startsWith('ws-')) wsFrames.push(ev);
}

console.log('=== 总览 ===');
console.log('事件总数: ' + lines.length + '，响应体条数: ' + bodies.length + '，WS 帧数: ' + wsFrames.length);

console.log('\n=== 按 Host 汇总 ===');
for (const [h, v] of Object.entries(byHost).sort((a, b) => b[1].count - a[1].count)) {
  const methods = Object.entries(v.methods).map(([m, c]) => `${m}:${c}`).join(' ');
  console.log(`${String(v.count).padStart(6)}  ${h}  [${methods}]`);
}

console.log('\n=== 请求最频繁的端点 Top20 ===');
for (const [p, c] of Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`${String(c).padStart(6)}  ${p}`);
}

console.log('\n=== 大响应体 Top10（疑似业务数据）===');
bodies
  .sort((a, b) => b.len - a.len)
  .slice(0, 10)
  .forEach((b) => {
    console.log(`len=${b.len} id=${b.id} head=${String(b.body).slice(0, 120)}`);
  });

const KW = /组织|成员|活动|member|guild|org|activity|rank/i;
console.log('\n=== 关键词命中 ===');
let hits = 0;
for (const ev of lines) {
  const s = JSON.stringify(ev);
  if (KW.test(s)) {
    hits++;
    if (hits <= 50) {
      console.log(ev.type, ev.url || ev.id, String(s).slice(0, 200));
    }
  }
}
console.log('命中总数: ' + hits);

console.log('\n=== WebSocket 帧（前 30 条）===');
wsFrames.slice(0, 30).forEach((ev) => {
  console.log(`[${ev.type}] id=${ev.id} opcode=${ev.opcode} ${String(ev.payload).slice(0, 200)}`);
});
