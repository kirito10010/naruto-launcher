// miao-export.js —— 题库抓包：从 net-log 解析「喵问答」的题目，导出 JSON + 配图
//
// 协议（zone.huoying.qq.com:11096，36 字节头 + TEA 加密的 Protobuf）：
//   199684 服务端→客户端  第一题 + 作答结果：f3 = 题目对象，f5 = 上一题是否答对（1 对 / 0 错）
//   199684 客户端→服务端  提交答案：f1 = 选项下标（0-3）
//   199685 服务端→客户端  后续题目：f2 = 题目对象
//
// 题目对象：f1 = 题号（0 起）  f2 = 题干  f3 × 4 = 选项  f4 = 配图 ID
//           f8 = 活动加成「排除一项错误答案」排除的选项下标
//
// 协议里没有「正确答案」字段（判分在服务端）。只有答对时，才能用
// 「我方提交的下标 + 对错标志」反推出正确选项；答错时答案留空。
// bonusRemoved 是确定的错误选项，可作为排除法参考。
const fs = require('fs');
const path = require('path');
const https = require('https');
const { extractGameStream, waitForNetlog, frames, dec, pb } = require('./export');

const Q_MAIN = 199684;
const Q_PUSH = 199685;

const IMG_RE = /\/assets\/knowledgeTest\/(\d+)\.(png|jpg|jpeg|gif|webp)/i;

const one = (fields, n) => { for (const [fn, v] of fields) if (fn === n) return v; return undefined; };
const all = (fields, n) => fields.filter(([fn]) => fn === n).map(([, v]) => v);
const toText = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : '');

// 题目对象 → { no, question, options, imageId, removedIdx, slots }
// slots：4 个 NPC 的站圈与累计分（f7 = { f1: NPC ID, f3: 站圈下标, f4: 累计分 }）
function parseQuestion(buf) {
  let q;
  try { q = pb(buf); } catch (e) { return null; }
  const no = one(q, 1);
  const text = toText(one(q, 2)).trim();
  const options = all(q, 3).map((v) => toText(v).trim()).filter(Boolean);
  if (!text || !options.length) return null;
  const img = one(q, 4);
  // f8 可以出现多次：活动加成可能排除 1 项，也可能排除 2 项
  const removedIdxs = q.filter(([k]) => k === 8).map(([, v]) => v).filter((v) => typeof v === 'number');
  const slots = [];
  for (const [k, v] of q) {
    if (k !== 7 || !Buffer.isBuffer(v)) continue;
    let sf;
    try { sf = pb(v); } catch (e) { continue; }
    const id = one(sf, 1);
    const ans = one(sf, 3);
    const score = one(sf, 4);
    if (typeof id !== 'number') continue;
    slots.push({ id, ans: typeof ans === 'number' ? ans : null, score: typeof score === 'number' ? score : 0 });
  }
  return {
    no: typeof no === 'number' ? no : null,
    question: text,
    options,
    imageId: img ? toText(img).trim() : '',
    removedIdxs: removedIdxs,
    slots
  };
}

// 解析题库；内部返回 [{ no, question, options, answer, bonusRemoved, image, imageId }]
// 对外 JSON 由 toOutput() 收窄为 问题 / 选项 / 答案 / 排除项 / 图片
function parseMiao(rx, tx) {
  const exchanges = [];   // { qd, flag }：199684 响应（题目 + 对错）
  const pushes = [];      // 题目对象：199685 推送
  const choices = [];     // 我方提交的选项下标，按出现顺序

  for (const [cmd, payload] of frames(rx)) {
    if (cmd !== Q_MAIN) continue;
    const plain = dec(cmd, payload);      // 下行同样是加密的
    if (!plain) continue;
    const f = pb(plain);
    const qb = one(f, 3);
    const qd = Buffer.isBuffer(qb) ? parseQuestion(qb) : null;
    if (!qd) continue;
    const flag = one(f, 5);
    exchanges.push({ qd, flag: flag === 1 ? true : (flag === 0 ? false : null) });
  }

  for (const [cmd, payload] of frames(rx)) {
    if (cmd !== Q_PUSH) continue;
    const plain = dec(cmd, payload);
    if (!plain) continue;
    const f = pb(plain);
    const qb = one(f, 2);
    const qd = Buffer.isBuffer(qb) ? parseQuestion(qb) : null;
    if (qd) pushes.push(qd);
  }

  for (const [cmd, payload] of frames(tx)) {
    if (cmd !== Q_MAIN) continue;
    const plain = dec(cmd, payload);
    if (!plain) continue;
    const f = pb(plain);
    const idx = one(f, 1);
    if (typeof idx === 'number') choices.push(idx);
  }

  // 题目按题干合并（同题可能既被推送又在作答响应里出现）
  const map = new Map();
  const add = (qd) => {
    const key = qd.question;
    let e = map.get(key);
    if (!e) {
      e = {
        no: qd.no, question: qd.question, options: qd.options,
        imageId: qd.imageId, removedIdxs: qd.removedIdxs || [],
        slots: qd.slots || [], choice: null, flag: null
      };
      map.set(key, e);
    }
    if (qd.no != null && e.no == null) e.no = qd.no;
    if (qd.imageId && !e.imageId) e.imageId = qd.imageId;
    if (qd.removedIdxs && qd.removedIdxs.length) e.removedIdxs = qd.removedIdxs;
    if ((!e.slots || !e.slots.length) && qd.slots && qd.slots.length) e.slots = qd.slots;
    return e;
  };

  pushes.forEach(add);
  exchanges.forEach((ex, i) => {
    const e = add(ex.qd);
    if (ex.flag === true || ex.flag === false) e.flag = ex.flag;
    const idx = choices[i];
    if (typeof idx === 'number') e.choice = idx;
  });

  const list = [...map.values()];
  list.sort((a, b) => {
    if (a.no == null && b.no == null) return 0;
    if (a.no == null) return 1;
    if (b.no == null) return -1;
    return a.no - b.no;
  });

  // 第一遍：来源 A（NPC 加分）
  const removedTextsOf = (e) => (e.removedIdxs || []).map((i) => e.options[i]).filter(Boolean);
  const ansAList = list.map((e, i) => {
    const removed = removedTextsOf(e);
    const byNpc = deriveFromScores(e, list[i + 1]);
    return (byNpc != null && e.options[byNpc] && removed.indexOf(e.options[byNpc]) < 0) ? byNpc : null;
  });

  // 来源 B 的可信度自检：f5 的对错含义必须在本场里被来源 A 验证过。
  // 只要出现过一次矛盾，或没有任何可对照的样本，就整场不启用来源 B（宁可少填，不能填错）。
  let bChecks = 0;
  let bBad = 0;
  list.forEach((e, i) => {
    if (e.flag !== true && e.flag !== false) return;
    if (typeof e.choice !== 'number') return;
    if (ansAList[i] == null) return;
    if ((e.choice === ansAList[i]) === e.flag) bChecks++;
    else bBad++;
  });
  const bTrusted = bChecks > 0 && bBad === 0;

  const out = list.map((e, i) => {
    const removedTexts = removedTextsOf(e);
    const ansA = ansAList[i];
    const ansB = (bTrusted && e.flag === true && typeof e.choice === 'number'
      && e.options[e.choice] && removedTexts.indexOf(e.options[e.choice]) < 0) ? e.choice : null;

    let conflict = false;
    let ans = null;
    if (ansA != null && ansB != null) {
      if (ansA === ansB) ans = ansA;
      else conflict = true;               // 两个证据打架 → 不输出，宁可空着
    } else {
      ans = (ansA != null) ? ansA : ansB;
    }

    return {
      no: (e.no != null ? e.no : i) + 1,      // 内部字段：给配图命名用，不写进 JSON
      question: e.question,
      options: e.options,
      answer: ans != null ? e.options[ans] : '',
      bonusRemoved: removedTexts,             // 数组：可能排除 1 项或 2 项
      image: '',
      imageId: e.imageId || '',               // 内部字段：配图查找用
      conflict
    };
  });

  // 同一题干重复时，优先保留有答案的那条
  const byText = new Map();
  for (const r of out) {
    const prev = byText.get(r.question);
    if (!prev) byText.set(r.question, r);
    else if (!prev.answer && r.answer) byText.set(r.question, r);
  }
  return [...byText.values()];
}

// 来源 A：比较本题与下一题同一 NPC 的累计分，恰好 +10 的 NPC 站对了圈
// 任何一个 NPC 的增量不是 0/10（数据异常/跨轮重置）→ 本题不推导；多个 +10 指向不同圈 → 不推导
function deriveFromScores(cur, next) {
  if (!next || !cur.slots || !cur.slots.length || !next.slots || !next.slots.length) return null;
  const voters = [];
  for (const s of cur.slots) {
    const t = next.slots.find((x) => x.id === s.id);
    if (!t) return null;
    const d = t.score - s.score;
    if (d !== 0 && d !== 10) return null;
    if (d === 10) {
      if (typeof s.ans !== 'number') return null;
      voters.push(s.ans);
    }
  }
  if (!voters.length) return null;
  const uniq = [...new Set(voters)];
  return uniq.length === 1 ? uniq[0] : null;
}

// 对外输出的字段：问题 / 四个选项 / 正确答案 / 被排除的错误选项 / 图片
function toOutput(list) {
  return list.map((x) => ({
    question: x.question,
    options: x.options,
    answer: x.answer,
    removed: x.bonusRemoved,
    image: x.image
  }));
}

// ---------- 配图 ----------
function findSessionJsonl(userData, netlogPath) {
  const dir = path.join(userData, 'captures');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /^http-.*\.jsonl$/.test(f)).map((f) => path.join(dir, f));
  } catch (e) {
    return null;
  }
  if (!files.length) return null;
  let start = 0;
  try {
    const st = fs.statSync(netlogPath);
    start = Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs) - 10 * 60 * 1000;
  } catch (e) { /* ignore */ }
  const byNewest = (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
  const session = files.filter((f) => fs.statSync(f).mtimeMs >= start).sort(byNewest);
  return session[0] || files.sort(byNewest)[0];
}

// 从 CDP jsonl 里取出 knowledgeTest 图片：id → { url, ext, buf }
// 用流式读取，避免全量抓包的 jsonl（可能上百 MB）一次性读进内存
function loadImageIndex(jsonlPath) {
  return new Promise((resolve) => {
    const index = new Map();
    if (!jsonlPath || !fs.existsSync(jsonlPath)) return resolve(index);

    const urlById = new Map();
    const rl = require('readline').createInterface({ input: fs.createReadStream(jsonlPath, 'utf8') });

    rl.on('line', (line) => {
      if (!line || line.indexOf('knowledgeTest') < 0) return;
      let o;
      try { o = JSON.parse(line); } catch (e) { return; }
      if (o.type === 'req' || o.type === 'res') {
        const m = IMG_RE.exec(o.url || '');
        if (m) urlById.set(o.id, { id: m[1], ext: m[2].toLowerCase(), url: o.url });
      } else if (o.type === 'body' && o.base64 && typeof o.body === 'string' && urlById.has(o.id)) {
        const info = urlById.get(o.id);
        if (index.has(info.id)) return;
        let buf = null;
        try { buf = Buffer.from(o.body, 'base64'); } catch (e) { return; }
        if (!buf || !buf.length) return;
        index.set(info.id, { url: info.url, ext: info.ext, buf: buf });
      }
    });

    rl.on('close', () => {
      // 只抓到 URL、没拿到响应体的，留给后续下载
      for (const info of urlById.values()) {
        if (!index.has(info.id)) index.set(info.id, { url: info.url, ext: info.ext, buf: null });
      }
      resolve(index);
    });
    rl.on('error', () => resolve(index));
  });
}

function httpsGetBuffer(url, timeoutMs, depth) {
  const d = depth || 0;
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && d < 2) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return httpsGetBuffer(next, timeoutMs, d + 1).then(resolve);
        }
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
    } catch (e) {
      return resolve(null);
    }
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (e) {} resolve(null); });
  });
}

// 把题目引用的图片存到 images/，并把相对路径写回 list[i].image
async function attachImages(jsonlPath, list, imagesDir) {
  const index = await loadImageIndex(jsonlPath);
  if (!index.size) return 0;

  fs.mkdirSync(imagesDir, { recursive: true });
  const saved = new Map();   // imageId → 相对路径
  let count = 0;

  for (const item of list) {
    const id = item.imageId;
    if (!id) continue;
    const info = index.get(id);
    if (!info) continue;

    if (!saved.has(id)) {
      let buf = info.buf;
      if (!buf && info.url) buf = await httpsGetBuffer(info.url, 5000);
      if (!buf || !buf.length) continue;
      const name = String(item.no).padStart(2, '0') + '_' + id + '.' + info.ext;
      try {
        fs.writeFileSync(path.join(imagesDir, name), buf);
      } catch (e) {
        continue;
      }
      saved.set(id, 'images/' + name);
      count++;
    }
    item.image = saved.get(id);
  }
  return count;
}

// ---------- 本地答案库（只存有证据的答案） ----------
function loadBank(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  } catch (e) {
    return {};
  }
}

function saveBank(file, bank) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(bank, null, 2), 'utf8');
  } catch (e) { /* 写不进去不影响导出 */ }
}

// 本轮没推导出来的，用库里确认过的答案补（按选项原文匹配，选项顺序变了也能对上）
function applyBank(list, bank) {
  let filled = 0;
  for (const e of list) {
    if (e.answer) continue;
    const a = bank[e.question];
    if (typeof a === 'string' && a && e.options.indexOf(a) >= 0) {
      e.answer = a;
      filled++;
    }
  }
  return filled;
}

function updateBank(list, bank) {
  for (const e of list) if (e.answer) bank[e.question] = e.answer;
}

// ---------- 导出 ----------
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function runMiaoExport(opts) {
  const { app, shell } = require('electron');
  const userData = app.getPath('userData');

  let list = [];
  let error = '';
  let jsonl = null;
  let netlog = null;
  let stats = null;

  try {
    netlog = await waitForNetlog(userData, opts && opts.mainPid);
    // 优先选含喵问答命令号的 socket（zone 端口会变，不能再按端口找）
    const stream = extractGameStream(netlog, [Q_MAIN, Q_PUSH]);
    stats = stream.stats || null;
    list = parseMiao(stream.rx, stream.tx);
    if (!list.length) error = '未在抓包里找到喵问答数据（本场可能没参加活动，或抓包模式未重启生效）';
    jsonl = findSessionJsonl(userData, netlog);
  } catch (e) {
    error = (e && e.message) || String(e);
  }

  let dir = path.join(app.getPath('desktop'), '火影题库', '喵问答_' + timestamp());
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    dir = path.join(userData, '火影题库', '喵问答_' + timestamp());
    fs.mkdirSync(dir, { recursive: true });
  }

  if (list.length) {
    try {
      await attachImages(jsonl, list, path.join(dir, 'images'));
    } catch (e) {
      error = error || ('配图导出失败：' + ((e && e.message) || String(e)));
    }

    // 本地答案库：只吸收有证据的答案，再用库里确认过的补空缺
    try {
      const bankFile = path.join(userData, 'quiz-answers.json');
      const bank = loadBank(bankFile);
      applyBank(list, bank);
      updateBank(list, bank);
      saveBank(bankFile, bank);
    } catch (e) { /* ignore */ }

    const conflicts = list.filter((e) => e.conflict).map((e) => e.no);
    if (conflicts.length) {
      try {
        fs.appendFileSync(path.join(userData, 'miao-export.log'),
          '[' + new Date().toISOString() + '] 答案证据冲突，已留空：Q' + conflicts.join(', Q') + '\n');
      } catch (e) { /* ignore */ }
    }
  }

  const file = path.join(dir, 'questions.json');
  fs.writeFileSync(file, JSON.stringify(toOutput(list), null, 2), 'utf8');

  // 没抓到任何题目时留一份诊断，方便排查（端口变化、没参加活动、模式没重启都写在这）
  if (error) {
    const lines = [];
    lines.push('喵问答导出诊断');
    lines.push('时间：' + new Date().toLocaleString());
    lines.push('netlog：' + (netlog || '（未找到）'));
    lines.push('题目数：' + list.length);
    lines.push('错误：' + error);
    if (stats && stats.length) {
      lines.push('');
      lines.push('socket 统计（按喵问答命令命中、帧数排序）：');
      for (const s of stats) {
        lines.push('  sock ' + s.id + ' ' + (s.addr || '') + '  帧=' + s.frames + '  命中=' + s.hits + '  rx=' + s.rxLen);
      }
    }
    try { fs.writeFileSync(path.join(dir, '导出诊断.txt'), lines.join('\r\n'), 'utf8'); } catch (e) { /* ignore */ }
  }
  try { shell.showItemInFolder(file); } catch (e) { /* ignore */ }

  return { file, count: list.length, error };
}

module.exports = {
  runMiaoExport, parseMiao, toOutput, attachImages, loadImageIndex, findSessionJsonl,
  deriveFromScores, loadBank, saveBank, applyBank, updateBank
};
