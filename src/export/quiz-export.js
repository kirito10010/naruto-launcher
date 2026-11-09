// quiz-export.js —— 题库抓包：从 net-log 解析「考官红豆 → 忍者检测」的题目，导出 JSON
//
// 协议（zone.huoying.qq.com:11096，36 字节头 + TEA 加密的 Protobuf）：
//   251905 服务端→客户端  开始答题，field2 = 第一道题（题目对象）
//   251906 客户端→服务端  提交答案 {1: 题号, 2: 选项下标(0-3)}
//   251906 服务端→客户端  作答结果 + 下一题：
//                           field2 = 上一题是否答对（1=对，0=错）
//                           field3 = 题目对象
//   251907 服务端→客户端  结算（忽略）
//
// 题目对象：field1 = 题面，field2 ×4 = 选项，field3 = 时限，field4 = 剩余题数 …
//
// 协议里没有「正确选项」字段，只有「上一题对不对」。因此：
//   答对 → 客户端提交的选项下标就是正确选项，写选项原文
//   答错 → 正确选项不可知，answer 写空字符串
// 正确选项存选项原文而不是 A/B/C/D，因为同一道题的选项顺序每次都可能不同。
const fs = require('fs');
const path = require('path');
const { extractGameStream, waitForNetlog, frames, dec, pb } = require('./export');

const QUIZ_START = 251905;
const QUIZ_ANSWER = 251906;

const one = (fields, n) => { for (const [fn, v] of fields) if (fn === n) return v; return undefined; };
const all = (fields, n) => fields.filter(([fn]) => fn === n).map(([, v]) => v);
const toText = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : '');

// 题目对象 → { text, options }
function parseQuestion(buf) {
  const q = pb(buf);
  const text = toText(one(q, 1)).trim();
  if (!text) return null;
  const options = all(q, 2).map((v) => toText(v).trim());
  if (!options.length) return null;
  return { text, options };
}

// 解析一次抓包里的题库；返回 [{ question, options, answer }]
function parseQuiz(rx, tx) {
  const questions = [];
  const flags = [];      // 每个 251906 响应带的对错标志，按出现顺序
  const answers = [];    // 每次提交的选项下标，按出现顺序

  for (const [cmd, payload] of frames(rx)) {
    if (cmd !== QUIZ_START && cmd !== QUIZ_ANSWER) continue;
    const plain = dec(cmd, payload);
    if (!plain) continue;
    const f = pb(plain);
    if (cmd === QUIZ_START) {
      const q = one(f, 2);
      if (Buffer.isBuffer(q)) {
        const parsed = parseQuestion(q);
        if (parsed) questions.push(parsed);
      }
      continue;
    }
    // 251906：先记对错标志，再看有没有下一题
    const flag = one(f, 2);
    if (flag === 0 || flag === 1) flags.push(flag === 1);
    const q = one(f, 3);
    if (Buffer.isBuffer(q)) {
      const parsed = parseQuestion(q);
      if (parsed) questions.push(parsed);
    }
  }

  for (const [cmd, payload] of frames(tx)) {
    if (cmd !== QUIZ_ANSWER) continue;
    const plain = dec(cmd, payload);   // 上行同样是加密的（type=1，加密方式一致）
    if (!plain) continue;
    const f = pb(plain);
    const opt = one(f, 2);
    if (typeof opt !== 'number') continue;
    answers.push(opt);
  }

  // 按出现顺序配对：第 i 个答案 ↔ 第 i 道题；第 i 个标志 = 第 i 个答案的对错
  // （帧里自带的题号实测会跳号，不能当索引）
  const out = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const optIdx = answers[i];
    const correct = flags[i] === true;
    let answer = '';
    if (correct && typeof optIdx === 'number' && q.options[optIdx]) answer = q.options[optIdx];
    out.push({ question: q.text, options: q.options, answer });
  }

  // 同一道题在一次抓包里重复出现时去重，优先保留有答案的那条
  const map = new Map();
  for (const r of out) {
    const prev = map.get(r.question);
    if (!prev) map.set(r.question, r);
    else if (!prev.answer && r.answer) map.set(r.question, r);
  }
  return [...map.values()];
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function runQuizExport(opts) {
  const { app, shell } = require('electron');
  const userData = app.getPath('userData');

  let list = [];
  let error = '';
  try {
    const netlog = await waitForNetlog(userData, opts && opts.mainPid);
    const stream = extractGameStream(netlog);
    list = parseQuiz(stream.rx, stream.tx);
  } catch (e) {
    error = (e && e.message) || String(e);
  }

  const stamp = timestamp();
  let dir = path.join(app.getPath('desktop'), '火影题库');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    dir = path.join(userData, '火影题库');
    fs.mkdirSync(dir, { recursive: true });
  }

  const file = path.join(dir, '忍者检测_' + stamp + '.json');
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  try { shell.showItemInFolder(file); } catch (e) { /* ignore */ }

  return { file, count: list.length, error };
}

module.exports = { runQuizExport, parseQuiz };
