// shop-export.js —— 商城特惠抓包：解析 net-log 里的商城商品数据 + 从 CDP jsonl 取商品图标
//
// 协议（zone.huoying.qq.com，36 字节头 + Protobuf 载荷，下行 TEA 加密）：
//   1048608 请求：f1 = 商店ID（= 活动ID × 2），f2 = { f1: 0 商品列表 / 2 购物车 }
//   1048608 响应：f1 = 状态，f2 = { f1: 活动开始, f2: 活动结束 }，f3 × N = 商品对象
//     商品对象：f1 = 槽位，f2 = { f1: 物品ID, f2: 类型 }，
//               f3 = 每日限购 ×2，f4 = 已购数量，f7 = 折扣价 ×2，f9 = 货币类型，
//               f11 = 当日窗口开始，f12 = 当日窗口结束
//   199458  响应：f2 × N = 活动对象（f1 = 活动ID，f2 = 名称，f3 = 开始，f4 = 结束，f12 = 服务器当前时间）
//              商城特惠 = 800276
//
// 时间：全部按 UTC+8 换算，不依赖本机时区。当日窗口固定 05:00 ~ 次日 04:59:59（每日 05:00 刷新限购）。
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const { extractGameStream, waitForNetlog, frames, dec, pb } = require('./export');

const CMD_SHOP = 1048608;
const CMD_ACTIVITY = 199458;
const SHOP_ACTIVITY_ID = 800276;
const SHOP_ACTIVITY_NAME = '商城特惠';
const TZ_OFFSET = 8 * 3600;      // UTC+8
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const CURRENCY = { 1: '点券' };

const ICON_RE = /\/assets\/bag\/item\/(\d+)\.(png|jpg|jpeg|gif|webp)/i;

// 已确认的物品名称（2026-11-06 抓包与游戏内截屏逐条核对）。
// 协议里不带名称，这里只是本地种子；新物品会在 shop-item-names.json 里留空待补。
const NAME_SEED = {
  20400446: '蝎[绯流琥]碎片',
  20400420: '机甲鸣人碎片',
  20400387: '佐井[泳装]碎片',
  20400372: '宇智波带土[忍界大战]碎片',
  20400339: '阿斯玛[夏装]碎片',
  20400458: '鬼灯幻月[泳装]碎片',
  10190903: '秘卷残页',
  10190904: '真言合剂',
  10190651: '试验礼包',
  10190119: '洞穴密钥礼包',
  10190045: '洗炼保护礼包',
  10190044: '洗炼礼包',
  10190256: '宝具精粹礼包',
  10190519: '羁绊手札任选包',
  10190830: '高级试验礼袋',
  10190248: '幸运钥匙包'
};

// 碎片物品 ID → 忍者 ID。
// 图鉴（config/archives/item1.pkg）里缺了少数新形态，按名字查不到，这里用抓包里
// 「悬停时客户端请求的头像/技能图标」反推出来的对应关系兜底（可在
// %APPDATA%\naruto-online-launcher\shop-ninja-map.json 里自行补充，优先级更高）。
const NINJA_ID_SEED = {
  20400387: 11005651,   // 佐井[泳装]       → 头像 head_176_68/11005651.png + 技能 2100565x.png
  20400372: 11006041,   // 宇智波带土[忍界大战] → 头像 head_176_68/11006041.png + 技能 2100604x.png
  20400475: 11016511,   // 神秘面具男[忍者之路] → 头像 head_176_68/11016511.png
  20400352: 11003321,   // 千手柱间[新春]      → 头像 head_176_68/11003321.png
  20400404: 11002441    // 猿飞日斩[新春]      → 头像 head_176_68/11002441.png
};

const g = (f, n) => { for (const [fn, v] of f) if (fn === n) return v; return undefined; };
const ga = (f, n) => f.filter(([fn]) => fn === n).map(([, v]) => v);
const isNum = (v) => typeof v === 'number';

// ---------- 时间 ----------
function fmtTime(sec) {
  if (!isNum(sec) || sec <= 0) return '';
  const d = new Date(sec * 1000 + TZ_OFFSET * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

function weekdayOf(sec) {
  if (!isNum(sec) || sec <= 0) return '';
  return WEEK[new Date(sec * 1000 + TZ_OFFSET * 1000).getUTCDay()];
}

function fmtTimeW(sec) {
  const t = fmtTime(sec);
  return t ? t + '（' + weekdayOf(sec) + '）' : '';
}

function daysBetween(a, b) {
  if (!isNum(a) || !isNum(b) || b <= a) return null;
  return Math.round((b - a + 1) / 86400);
}

// ---------- 载荷解码 ----------
function safePb(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return null;
  try {
    const f = pb(buf);
    return f && f.length ? f : null;
  } catch (e) {
    return null;
  }
}

// 打分：可读子结构越多越像真的 protobuf（密文误判成明文的概率很低）
function pbScore(fields) {
  if (!fields) return -1;
  let s = 0;
  for (const [, v] of fields) {
    if (typeof v === 'number') { s += 1; continue; }
    if (!Buffer.isBuffer(v)) continue;
    const sub = safePb(v);
    if (sub && sub.length >= 2) s += 2 + sub.length;
    else s += 0.5;
  }
  return s;
}

// 同一帧可能是明文，也可能是 TEA 密文（type=3 也会出现密文），两边都试取更像的那个
function decodeFrame(payload) {
  let enc = null;
  try {
    const buf = dec(0, payload);     // export.js 的 dec(cmd, p) 里 cmd 未使用，传 0 即可
    if (buf) enc = safePb(buf);
  } catch (e) { enc = null; }
  const plain = safePb(payload);
  const a = pbScore(plain);
  const b = pbScore(enc);
  if (b > a && enc) return { kind: 'tea', fields: enc };
  if (plain) return { kind: 'plain', fields: plain };
  return { kind: 'none', fields: null };
}

// ---------- 解析 ----------
function parseRange(buf) {
  const f = safePb(buf);
  if (!f) return null;
  const start = g(f, 1), end = g(f, 2);
  if (!isNum(start) || !isNum(end)) return null;
  return { start, end };
}

function parseItem(buf) {
  const f = safePb(buf);
  if (!f) return null;
  const goods = g(f, 2);
  const gf = Buffer.isBuffer(goods) ? safePb(goods) : null;
  if (!gf) return null;
  const itemId = g(gf, 1);
  if (!isNum(itemId)) return null;

  const rawLimit = g(f, 3);
  const rawPrice = g(f, 7);
  const bought = g(f, 4);

  return {
    slot: isNum(g(f, 1)) ? g(f, 1) : null,
    itemId,
    itemType: g(gf, 2),
    dailyLimit: isNum(rawLimit) ? Math.round(rawLimit / 2) : null,
    bought: isNum(bought) ? bought : 0,
    price: isNum(rawPrice) ? Math.round(rawPrice / 2) : null,
    currency: g(f, 9),
    start: isNum(g(f, 11)) ? g(f, 11) : null,
    end: isNum(g(f, 12)) ? g(f, 12) : null,
    rawLimit: isNum(rawLimit) ? rawLimit : null,
    rawPrice: isNum(rawPrice) ? rawPrice : null
  };
}

function remainingOf(item) {
  if (!isNum(item.dailyLimit)) return null;
  return Math.max(0, item.dailyLimit - (item.bought || 0));
}

// RX 里所有 1048608 响应；只保留商品列表非空的那几条（购物车响应 f3 为空）
function parseShop(rx) {
  const responses = [];
  for (const [cmd, payload] of frames(rx)) {
    if (cmd !== CMD_SHOP) continue;
    const d = decodeFrame(payload);
    if (!d.fields) continue;
    // f3 是一整块「重复 f2」的容器；空购物车响应里 f3 长度为 0
    const rawList = ga(d.fields, 3).filter((v) => Buffer.isBuffer(v) && v.length);
    let items = [];
    for (const raw of rawList) {
      const container = safePb(raw);
      if (!container) continue;
      items = items.concat(ga(container, 2).map(parseItem).filter(Boolean));
    }
    if (!items.length) continue;
    responses.push({ range: parseRange(g(d.fields, 2)), items });
  }
  if (!responses.length) return null;
  return { responses, last: responses[responses.length - 1] };
}

// 199458 里的商城特惠活动（拿不到不报错）
function parseActivity(rx) {
  for (const [cmd, payload] of frames(rx)) {
    if (cmd !== CMD_ACTIVITY) continue;
    const d = decodeFrame(payload);
    if (!d.fields) continue;
    for (const v of ga(d.fields, 2)) {
      const f = Buffer.isBuffer(v) ? safePb(v) : null;
      if (!f) continue;
      if (g(f, 1) !== SHOP_ACTIVITY_ID) continue;
      const name = g(f, 2);
      return {
        id: SHOP_ACTIVITY_ID,
        name: Buffer.isBuffer(name) ? name.toString('utf8').trim() : '',
        start: isNum(g(f, 3)) ? g(f, 3) : null,
        end: isNum(g(f, 4)) ? g(f, 4) : null,
        serverNow: isNum(g(f, 12)) ? g(f, 12) : null
      };
    }
  }
  return null;
}

// ---------- 名称缓存 ----------
function namesFile(userData) {
  return path.join(userData, 'shop-item-names.json');
}

function loadNames(userData) {
  let cached = {};
  try {
    const data = JSON.parse(fs.readFileSync(namesFile(userData), 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) cached = data;
  } catch (e) { /* 没有缓存就用种子 */ }
  return Object.assign({}, NAME_SEED, cached);
}

function saveNames(userData, names) {
  try {
    fs.writeFileSync(namesFile(userData), JSON.stringify(names, null, 2), 'utf8');
  } catch (e) { /* 写不进去不影响导出 */ }
}

function ninjaMapFile(userData) {
  return path.join(userData, 'shop-ninja-map.json');
}

function loadNinjaMap(userData) {
  let user = {};
  try {
    const data = JSON.parse(fs.readFileSync(ninjaMapFile(userData), 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) user = data;
  } catch (e) { /* 没有就只用种子 */ }
  return Object.assign({}, NINJA_ID_SEED, user);
}

function saveNinjaMap(userData, map) {
  try {
    // 只写用户自定义部分，种子留在代码里
    const user = {};
    for (const k of Object.keys(map)) if (String(map[k]) !== String(NINJA_ID_SEED[k])) user[k] = map[k];
    fs.writeFileSync(ninjaMapFile(userData), JSON.stringify(user, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

// ---------- 图片 ----------
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

function httpsGetBuffer(url, referer, timeoutMs, depth) {
  const d = depth || 0;
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, {
        timeout: timeoutMs || 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36',
          Referer: referer || 'https://game.huoying.qq.com/'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && d < 2) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return httpsGetBuffer(next, referer, timeoutMs, d + 1).then(resolve);
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
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(null); });
  });
}

// ---------- 配置表（名称 / 说明 / 图标 ID） ----------
// 物品名称与说明不在协议里，只在游戏的配置表中：
//   · 道具/礼包：config/bag/conf/CommonItemCFG.xml（明文 XML，字段 name / src / desc / extraDesc）
//     <src> 就是图标资源 ID —— 礼包共用 10100000，高级试验礼袋是 10100038
//   · 忍者碎片：config/archives/item1..3.pkg（zlib），记录里有「招募，升星XXX所需材料。」
const RES_BASE = 'https://res.huoying.qq.com/';
const BAG_CFG_RE = /res\.huoying\.qq\.com\/(NarutoBeta[^/]+)\/config\/bag\/conf\/CommonItemCFG\.cfg/;
const ENTRY_RE = /res\.huoying\.qq\.com\/(NarutoBeta[^/]+)\/entry\.swf/;
const ANY_BUILD_RE = /res\.huoying\.qq\.com\/(NarutoBeta[^/"]+)\//;

function inflateAny(buf) {
  if (!buf || !buf.length) return null;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return zlib.gunzipSync(buf); } catch (e) { /* fallthrough */ }
  }
  if (buf[0] === 0x78) {
    try { return zlib.inflateSync(buf); } catch (e) { /* fallthrough */ }
    try { return zlib.inflateRawSync(buf); } catch (e) { /* fallthrough */ }
  }
  return null;
}

// 从本会话 jsonl 里收集资源版本目录：装背包配置的目录优先，其次 entry.swf 目录，其余殿后
function resolveBuildDirs(jsonlPath) {
  return new Promise((resolve) => {
    const bag = [], entry = [], other = [];
    if (!jsonlPath || !fs.existsSync(jsonlPath)) return resolve([]);

    const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath, 'utf8') });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const all = [];
      const push = (d) => { if (d && all.indexOf(d) < 0) all.push(d); };
      bag.forEach(push);
      entry.forEach(push);
      other.forEach(push);
      resolve(all.slice(0, 8));
    };

    rl.on('line', (line) => {
      if (!line || line.indexOf('NarutoBeta') < 0) return;
      let m = BAG_CFG_RE.exec(line);
      if (m) { bag.push(m[1]); return; }
      m = ENTRY_RE.exec(line);
      if (m) { entry.push(m[1]); return; }
      m = ANY_BUILD_RE.exec(line);
      if (m) other.push(m[1]);
    });
    rl.on('close', finish);
    rl.on('error', finish);
  });
}

// 每类配置文件在本会话里实际用的是哪个版本目录（资源目录逐个资源版本化，
// 光靠「前 8 个目录」会漏掉，比如 SkillExStateCFG 只在 NarutoBeta11.30Build301 里）
function resolveDirHints(jsonlPath) {
  return new Promise((resolve) => {
    const hints = {};
    if (!jsonlPath || !fs.existsSync(jsonlPath)) return resolve(hints);

    const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath, 'utf8') });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(hints);
    };

    rl.on('line', (line) => {
      if (!line || line.indexOf('NarutoBeta') < 0 || line.indexOf('/config/') < 0) return;
      const m = /res\.huoying\.qq\.com\/(NarutoBeta[^/]+)\/(config\/[^"'?\s]+)/.exec(line);
      if (!m) return;
      if (!hints[m[2]]) hints[m[2]] = m[1];
    });
    rl.on('close', finish);
    rl.on('error', finish);
  });
}

// 悬停商品卡片时客户端会请求忍者头像 head_176_68/<忍者ID>.png，
// 用它可以在「图鉴里查不到名字」时反推碎片对应的忍者
function collectHeadNinjas(jsonlPath) {
  return new Promise((resolve) => {
    const ids = [];
    if (!jsonlPath || !fs.existsSync(jsonlPath)) return resolve(ids);
    const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath, 'utf8') });
    rl.on('line', (line) => {
      if (!line || line.indexOf('head_176_68') < 0) return;
      const m = /head_176_68\/(\d+)\.png/.exec(line);
      if (m && ids.indexOf(m[1]) < 0) ids.push(m[1]);
    });
    rl.on('close', () => resolve(ids));
    rl.on('error', () => resolve(ids));
  });
}

// 名字查不到的碎片：用「头像候选 + 技能描述里出现忍者名」打分，剩下的做 1:1 排除
function autoResolveNinjas(unresolved, heads, ninjaSkills, skills) {
  const assigned = new Map();
  const notes = [];
  const cands = heads.slice();
  const scores = [];
  for (const f of unresolved) {
    const base = (/^(.+?)\[/.exec(f.name) || [])[1] || f.name;
    for (const h of cands) {
      const nb = ninjaSkills.get(h);
      if (!nb) continue;
      let text = '';
      for (const sid of [].concat(nb.normals || [], nb.specials || [], nb.skills || [])) {
        const s = skills.get(String(sid));
        if (s && s.desc) text += s.desc;
      }
      let n = 0;
      let from = 0;
      while (base.length >= 2) {
        const i = text.indexOf(base, from);
        if (i < 0) break;
        n++;
        from = i + 1;
      }
      if (n) scores.push({ item: f.id, ninja: h, n });
    }
  }
  scores.sort((a, b) => b.n - a.n);
  for (const s of scores) {
    if (assigned.has(s.item)) continue;
    const taken = [...assigned.values()].indexOf(s.ninja) >= 0;
    if (taken) continue;
    const second = scores.find((x) => x.item === s.item && x.ninja !== s.ninja);
    if (s.n >= 2 && (!second || s.n > second.n * 2)) {
      assigned.set(s.item, s.ninja);
      notes.push(s.item + '→' + s.ninja + '（技能描述里出现名字 ' + s.n + ' 次）');
    }
  }
  // 1:1 排除
  const usedNinja = new Set([...assigned.values(), ...heads.filter((h) => !cands.includes(h))]);
  const leftItems = unresolved.filter((f) => !assigned.has(f.id));
  const leftHeads = cands.filter((h) => !usedNinja.has(h));
  if (leftItems.length === 1 && leftHeads.length === 1) {
    assigned.set(leftItems[0].id, leftHeads[0]);
    notes.push(leftItems[0].id + '→' + leftHeads[0] + '（排除法：只剩这一个候选）');
  } else if (leftItems.length && leftHeads.length) {
    notes.push('未能确定：' + leftItems.map((f) => f.id).join(',') + ' 候选 ' + leftHeads.join(','));
  }
  return { assigned, notes };
}

function decodeXmlText(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function parseItemXml(text) {
  const map = new Map();
  const rows = String(text).split('<row>');
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const idm = /<id>\s*([^<]*?)\s*<\/id>/.exec(r);
    if (!idm) continue;
    const id = idm[1].trim();
    if (!id) continue;
    const cell = (tag) => {
      const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(r);
      return m ? decodeXmlText(m[1]) : '';
    };
    map.set(id, {
      name: cell('name'),
      src: cell('src'),
      desc: cell('desc'),
      extraDesc: cell('extraDesc'),
      rewardId: cell('val2')   // 礼包/道具的掉落组 ID
    });
  }
  return map;
}

// ---------- 配置缓存（避免每次导出重复下载几十 MB） ----------
function cfgCacheDir(userData) {
  return path.join(userData, 'cfg-cache');
}

function cacheKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

// 命中缓存直接读；否则下载并解压后落盘。返回 { buf, from }
async function loadCached(userData, url, timeoutMs) {
  const dir = cfgCacheDir(userData);
  const file = path.join(dir, cacheKey(url) + '.bin');
  try {
    const buf = fs.readFileSync(file);
    if (buf && buf.length) return { buf, from: 'cache' };
  } catch (e) { /* 未命中 */ }

  const raw = await httpsGetBuffer(url, 'https://game.huoying.qq.com/', timeoutMs || 25000);
  if (!raw || !raw.length) return { buf: null, from: 'fail' };

  const buf = inflateAny(raw) || raw;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
  } catch (e) { /* 缓存写不进去不影响导出 */ }
  return { buf, from: 'net' };
}

// 依次按候选目录试 <dir>/<relPath>，命中的目录（hint）排最前
async function fetchFromDirs(userData, dirs, relPath, timeoutMs, hint) {
  const order = [];
  const push = (d) => { if (d && order.indexOf(d) < 0) order.push(d); };
  if (hint) push(hint);
  (dirs || []).forEach(push);
  for (const d of order) {
    const r = await loadCached(userData, RES_BASE + d + '/' + relPath, timeoutMs);
    if (r.buf && r.buf.length) return { buf: r.buf, dir: d, from: r.from };
  }
  return { buf: null, dir: '', from: 'fail' };
}

async function loadCommonItems(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/bag/conf/CommonItemCFG.xml', 20000,
    hints && hints['config/bag/conf/CommonItemCFG.cfg']);
  if (!r.buf) return { map: new Map(), dir: '', from: 'fail' };
  const text = r.buf.toString('utf8');
  if (text.indexOf('<row>') < 0) return { map: new Map(), dir: '', from: 'fail' };
  const map = parseItemXml(text);
  return { map, dir: r.dir, from: map.size ? r.from : 'fail' };
}

// ---------- 掉落表 ----------
function parseRewards(text) {
  const map = new Map();
  for (const r of String(text).split('<row>').slice(1)) {
    const rid = xmlCell(r, 'rewardId');
    if (!rid) continue;
    const name = xmlCell(r, 'name');
    const num = Number(xmlCell(r, 'num'));
    if (!name || name === '不获得物品' || !num) continue;   // 占位项过滤
    if (!map.has(rid)) map.set(rid, []);
    map.get(rid).push({
      itemId: Number(xmlCell(r, 'itemId')) || 0,
      name,
      num,
      sure: xmlCell(r, 'sure') === '1'
    });
  }
  return map;
}

async function loadRewards(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/reward/RewardItemTransferCFG.xml', 20000,
    hints && hints['config/reward/RewardItemTransferCFG.cfg']);
  if (!r.buf) return { map: new Map(), dir: '', from: 'fail' };
  const map = parseRewards(r.buf.toString('utf8'));
  return { map, dir: r.dir, from: map.size ? r.from : 'fail' };
}

function buildDrops(rewardId, rewardMap) {
  const key = String(rewardId || '');
  if (!key || key === '0') return null;
  const list = rewardMap.get(key);
  if (!list || !list.length) return null;
  const fixed = [];
  const random = [];
  for (const x of list) {
    const entry = { 名称: x.name, 数量: x.num, 物品ID: x.itemId };
    (x.sure ? fixed : random).push(entry);
  }
  if (!fixed.length && !random.length) return null;
  return { 固定: fixed, 随机: random };
}

// ---------- 忍者技能 ----------
function xmlCell(row, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(row);
  return m ? decodeXmlText(m[1]) : '';
}

function xmlCells(row, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '>([^<]*)</' + tag + '>', 'g');
  let m;
  while ((m = re.exec(row))) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

function stripTags(s) {
  return decodeXmlText(String(s)
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- 高亮标记 ----------
// 配置里只有 <font color="#4dc831">…</font> 一种标记；其余「特殊词」是客户端按状态词表上色的，
// 词表在 SkillExStateCFG.cfg。两边合并成统一标记：正文里的关键词用【】包住。
const FONT_RE = /<font\s+color\s*=\s*"([^"]*)"\s*>([\s\S]*?)<\/font>/gi;
const PH_OPEN = '\u0000';
const PH_CLOSE = '\u0001';

function markStates(text, words) {
  const used = new Array(text.length).fill(false);
  const hits = [];
  for (const w of words) {
    if (!w) continue;
    let from = 0;
    while (true) {
      const i = text.indexOf(w, from);
      if (i < 0) break;
      from = i + 1;
      let free = true;
      for (let k = i; k < i + w.length; k++) {
        if (used[k]) { free = false; break; }
      }
      if (!free) continue;
      for (let k = i; k < i + w.length; k++) used[k] = true;
      hits.push({ i, w });
    }
  }
  hits.sort((a, b) => a.i - b.i);
  let plain = '';
  let marked = '';
  let last = 0;
  for (const h of hits) {
    plain += text.slice(last, h.i) + h.w;
    marked += text.slice(last, h.i) + '【' + h.w + '】';
    last = h.i + h.w.length;
  }
  plain += text.slice(last);
  marked += text.slice(last);
  return { plain, marked, words: hits.map((h) => h.w) };
}

function markHighlights(rawDesc, stateWords) {
  let s = String(rawDesc || '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<br\s*\/?>/gi, ' ');
  s = decodeXmlText(s);

  const fontWords = [];
  s = s.replace(FONT_RE, (m, color, inner) => {
    const w = String(inner).replace(/<[^>]*>/g, '').trim();
    if (!w) return '';
    fontWords.push(w);
    return PH_OPEN + (fontWords.length - 1) + PH_CLOSE;
  });

  const segRe = new RegExp(PH_OPEN + '(\\d+)' + PH_CLOSE, 'g');
  const segs = [];
  let last = 0;
  let m;
  while ((m = segRe.exec(s))) {
    if (m.index > last) segs.push({ t: 'text', v: s.slice(last, m.index) });
    segs.push({ t: 'hi', v: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) segs.push({ t: 'text', v: s.slice(last) });

  const words = (stateWords || []).slice().sort((a, b) => b.length - a.length);
  let plain = '';
  let marked = '';
  const highlights = [];
  for (const seg of segs) {
    if (seg.t === 'hi') {
      const w = fontWords[seg.v];
      plain += w;
      marked += '【' + w + '】';
      highlights.push(w);
      continue;
    }
    const r = markStates(seg.v, words);
    plain += r.plain;
    marked += r.marked;
    for (const w of r.words) highlights.push(w);
  }

  const uniq = [];
  for (const w of highlights) if (w && uniq.indexOf(w) < 0) uniq.push(w);
  return {
    plain: plain.replace(/\s+/g, ' ').trim(),
    marked: marked.replace(/\s+/g, ' ').trim(),
    highlights: uniq
  };
}

function parseNinjaSkills(text) {
  const map = new Map();
  for (const r of String(text).split('<row>').slice(1)) {
    const id = xmlCell(r, 'id');
    if (!id) continue;
    map.set(id, {
      normals: xmlCells(r, 'normals'),
      specials: xmlCells(r, 'specials'),
      skills: xmlCells(r, 'skills'),
      binding: xmlCells(r, 'binding')
    });
  }
  return map;
}

async function loadNinjaSkills(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/skill/NinjaSkillCFG.xml', 40000,
    hints && hints['config/skill/NinjaSkillCFG.cfg']);
  if (!r.buf) return { map: new Map(), dir: '', from: 'fail' };
  const map = parseNinjaSkills(r.buf.toString('utf8'));
  return { map, dir: r.dir, from: map.size ? r.from : 'fail' };
}

function parseSkills(text, stateWords) {
  const map = new Map();
  for (const r of String(text).split('<row>').slice(1)) {
    const id = xmlCell(r, 'id');
    if (!id) continue;
    const h = markHighlights(xmlCell(r, 'desc'), stateWords);
    map.set(id, {
      name: xmlCell(r, 'name'),
      cd: Number(xmlCell(r, 'cd')) || 0,
      enterCd: Number(xmlCell(r, 'enterCd')) || 0,
      mp: Number(xmlCell(r, 'mp')) || 0,
      displayType: Number(xmlCell(r, 'displayType')) || 0,
      showIcon: Number(xmlCell(r, 'showIcon')) || 0,
      desc: h.plain,          // 纯文本，保持旧语义
      descMarked: h.marked,   // 带【】的版本
      highlights: h.highlights
    });
  }
  return map;
}

async function loadSkills(userData, dirs, stateWords, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/skill/SkillCFG.xml', 40000,
    hints && hints['config/skill/SkillCFG.cfg']);
  if (!r.buf) return { map: new Map(), dir: '', from: 'fail' };
  const map = parseSkills(r.buf.toString('utf8'), stateWords);
  return { map, dir: r.dir, from: map.size ? r.from : 'fail' };
}

// 状态词表：SkillExStateCFG.cfg 里的中文名（倒地/浮空/中毒/麻痹…），用于给正文里的状态词打标记
function parseStateWords(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    const lead = b >= 0xf0 ? 4 : (b >= 0xe0 ? 3 : (b >= 0xc0 ? 2 : 0));
    if (!lead) { i++; continue; }
    let s = '';
    let j = i;
    while (j < buf.length) {
      const c = buf[j];
      const l = c >= 0xf0 ? 4 : (c >= 0xe0 ? 3 : (c >= 0xc0 ? 2 : 0));
      if (!l) break;
      const chunk = buf.slice(j, j + l).toString('utf8');
      if (chunk.indexOf('\ufffd') >= 0) break;
      s += chunk;
      j += l;
    }
    const cjk = s.replace(/[^\u4e00-\u9fa5]/g, '');
    if (cjk.length >= 2 && out.indexOf(s) < 0) out.push(s);
    i = j > i ? j : i + 1;
  }
  return out.sort((a, b) => b.length - a.length);
}

async function loadSkillStates(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/skill/SkillExStateCFG.cfg', 20000,
    hints && hints['config/skill/SkillExStateCFG.cfg']);
  if (!r.buf) return { words: [], from: 'fail' };
  const words = parseStateWords(r.buf);
  return { words, from: words.length ? r.from : 'fail' };
}

// 忍者图鉴：记录头 = 0x11 + 8 位忍者 ID，名称在记录里
async function loadNinjaIndex(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/archives/item1.pkg', 40000,
    hints && hints['config/archives/item1.pkg']);
  return { buf: r.buf, dir: r.dir, from: r.from };
}

// 名称 → 忍者 ID 候选（按「离记录头多近」排序）。
// 图鉴里记录头是 0x11 + 8 位数字，忍者 ID 以 11 开头；技能记录是 21 开头，要排除。
// 带形态的忍者（如「宇智波带土[忍界大战]」）有时只存基础名 + 单独的 [形态] 字段，
// 所以同时支持「整名」和「基础名 + 后缀」两种匹配。
function resolveNinjaIds(ninjaBuf, name) {
  if (!ninjaBuf || !name) return [];
  const m = /^(.+?)\[([^\]]+)\]$/.exec(name);
  const base = m ? m[1] : name;
  const suffix = m ? m[2] : '';
  const key = Buffer.from(base, 'utf8');
  const sufBuf = suffix ? Buffer.from('[' + suffix + ']', 'utf8') : null;
  const cands = [];

  let from = 0;
  while (from < ninjaBuf.length) {
    const idx = ninjaBuf.indexOf(key, from);
    if (idx < 0) break;
    from = idx + 1;
    for (let j = idx; j > 0 && j > idx - 900; j--) {
      if (ninjaBuf[j] !== 0x11) continue;
      let id = '';
      let ok = true;
      for (let k = 1; k <= 8; k++) {
        const c = ninjaBuf[j + k];
        if (c < 0x30 || c > 0x39) { ok = false; break; }
        id += String.fromCharCode(c);
      }
      if (!ok || id.slice(0, 2) !== '11') continue;
      if (sufBuf) {
        const seg = ninjaBuf.slice(j, Math.min(ninjaBuf.length, j + 900));
        if (seg.indexOf(sufBuf) < 0) break;   // 这条记录不是该形态，换下一个命中点
      }
      if (!cands.some((c) => c.id === id)) cands.push({ id, dist: idx - j });
      break;
    }
  }
  cands.sort((a, b) => a.dist - b.dist);
  return cands.map((c) => c.id);
}

// 在候选里挑第一个「NinjaSkillCFG 里确实存在」的
function pickNinjaId(ninjaBuf, name, ninjaSkills) {
  for (const id of resolveNinjaIds(ninjaBuf, name)) {
    if (ninjaSkills && ninjaSkills.has(id)) return id;
  }
  return null;
}

// 槽位：displayType 2=奥义 0=普攻 1=追打 4=触发，其余（3/9/11…）=被动
function slotOfDisplayType(dt) {
  if (dt === 2) return '奥义';
  if (dt === 0) return '普攻';
  if (dt === 1) return '追打';
  if (dt === 4) return '触发';
  return '被动';
}

function skillEntry(s, slot) {
  const out = { 槽位: slot, 名称: s.name };
  if (slot === '奥义') {
    out.冷却 = s.cd;
    out.进场冷却 = s.enterCd;
    out.查克拉 = s.mp;
  }
  out.说明 = s.desc;
  out.说明标记 = s.descMarked || s.desc;
  out.高亮 = s.highlights || [];
  return out;
}

// 顺序与游戏一致：奥义 → 普攻 → NinjaSkillCFG.skills 的原始顺序（跳过 showIcon=0、按名去重）
function buildSkillBlocks(ns, skills) {
  if (!ns) return null;
  const list = [];
  const used = new Set();

  const add = (sid, forcedSlot) => {
    const s = skills.get(String(sid));
    if (!s || !s.name || used.has(s.name)) return;
    used.add(s.name);
    list.push(skillEntry(s, forcedSlot || slotOfDisplayType(s.displayType)));
  };

  const firstOf = (arr) => (arr || []).find((id) => skills.get(String(id)));
  const mainSkill = firstOf(ns.specials);
  if (mainSkill) add(mainSkill, '奥义');
  const normalSkill = firstOf(ns.normals);
  if (normalSkill) add(normalSkill, '普攻');

  for (const sid of (ns.skills || [])) {
    const s = skills.get(String(sid));
    if (!s) continue;
    if (s.showIcon === 0) continue;   // 客户端浮窗里不显示的（多为低阶/分身技能）
    add(sid);
  }

  return list.length ? list : null;
}

// ---------- 通灵兽碎片 ----------
// config/throughTheBeast/SummonBeastFragmentCFG.cfg：记录头 0x11 + 碎片物品ID，
// 内容依次是 [类型int] [名称「通灵兽·梦貘」] [招募所需碎片数] [描述]
function readBeastCells(buf, from, to) {
  const cells = [];
  let p = from;
  // 这张表的 varint 是「大端」的（0x82 0x01 → 257），和别处的小端 LEB128 相反
  const varint = () => {
    let v = 0;
    while (p < to) {
      const x = buf[p++];
      v = v * 128 + (x & 0x7f);
      if (!(x & 0x80)) break;
    }
    return v;
  };
  while (p < to) {
    const b = buf[p];
    if (b === 0x04) { p++; cells.push({ t: 'i', v: varint() }); continue; }
    if (b === 0x06) {
      p++;
      const len = varint() >> 1;
      cells.push({ t: 's', v: buf.slice(p, p + len).toString('utf8') });
      p += len;
      continue;
    }
    p++;
  }
  return cells;
}

function parseBeastFragments(buf) {
  const map = new Map();
  const marks = recordStarts(buf);
  for (let m = 0; m < marks.length; m++) {
    const id = buf.slice(marks[m] + 1, marks[m] + 9).toString('latin1');
    const from = marks[m] + 9;
    const to = (m + 1 < marks.length) ? marks[m + 1] : buf.length;
    const cells = readBeastCells(buf, from, to);
    const strs = cells.filter((c) => c.t === 's' && c.v);
    if (!strs.length) continue;
    const nameCell = strs[0];
    const descCell = strs.reduce((a, b) => (b.v.length > a.v.length ? b : a), strs[0]);
    let need = 0;
    for (let k = cells.indexOf(nameCell) + 1; k < cells.length; k++) {
      if (cells[k].t === 'i' && cells[k].v > 0) { need = cells[k].v; break; }
    }
    // 「通灵兽·梦貘」→「梦貘碎片」（游戏里就是这么显示的）
    let name = nameCell.v.trim();
    if (name.indexOf('·') >= 0) name = name.split('·').pop();
    if (name && name.indexOf('碎片') < 0) name += '碎片';
    map.set(id, { name, desc: descCell.v, need });
  }
  return map;
}

async function loadBeastFragments(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/throughTheBeast/SummonBeastFragmentCFG.cfg', 20000,
    hints && hints['config/throughTheBeast/SummonBeastFragmentCFG.cfg']);
  if (!r.buf) return { map: new Map(), from: 'fail' };
  const map = parseBeastFragments(r.buf);
  return { map, from: map.size ? r.from : 'fail' };
}

// 上阵属性加成：SummonMonsterCFG.cfg，记录键 = 碎片ID - 2410000（22410037 → 20000037）
// 字段布局（表头顺序）：achievedWay, baseDefense, keyWord2, skillName, keyWord1, …, name, baseLife, baseNinjaAttack, …
// 取法：记录头后第一个 int = 防御；短名后面两个 int = 生命/忍术；记录里最后一个 int = 攻击
function intAfter(rec, p) {
  while (p + 1 < rec.length) {
    if (rec[p] === 0x04 && rec[p + 1] < 0x80) return { v: rec[p + 1], next: p + 2 };
    if (rec[p] === 0x06) { const len = rec[p + 1] >> 1; p = p + 2 + len; continue; }
    p++;
  }
  return { v: null, next: p };
}

function parseMonsterAttr(buf, key, shortName) {
  if (!buf || !shortName) return null;
  const marks = recordStarts(buf);
  let rec = null;
  for (let m = 0; m < marks.length; m++) {
    if (buf.slice(marks[m] + 1, marks[m] + 9).toString('latin1') !== key) continue;
    rec = buf.slice(marks[m], (m + 1 < marks.length) ? marks[m + 1] : buf.length);
    break;
  }
  if (!rec) return null;
  let def = null;
  for (let i = 10; i + 1 < rec.length && i < 40; i++) {
    if (rec[i] === 0x04 && rec[i + 1] < 0x80) { def = rec[i + 1]; break; }
  }
  const nameBuf = Buffer.from(shortName, 'utf8');
  const sIdx = rec.lastIndexOf(nameBuf);
  if (sIdx < 0) return null;
  const a1 = intAfter(rec, sIdx + nameBuf.length);
  const a2 = intAfter(rec, a1.next);
  let atk = null;
  for (let i = 0; i + 1 < rec.length; i++) {
    if (rec[i] === 0x04 && rec[i + 1] < 0x80) atk = rec[i + 1];
  }
  if (a1.v == null && a2.v == null && atk == null) return null;
  return { 生命: a1.v, 攻击: atk, 防御: def, 忍术: a2.v };
}

async function loadMonsterCfg(userData, dirs, hints) {
  const r = await fetchFromDirs(userData, dirs, 'config/throughTheBeast/SummonMonsterCFG.cfg', 20000,
    hints && hints['config/throughTheBeast/SummonMonsterCFG.cfg']);
  return { buf: r.buf, from: r.buf ? r.from : 'fail' };
}

// 记录边界：0x11 + 8 位数字 ID，到下一条同形态为止
function recordStarts(buf) {
  const marks = [];
  for (let i = 0; i + 9 <= buf.length; i++) {
    if (buf[i] !== 0x11) continue;
    let ok = true;
    for (let k = 1; k <= 8; k++) {
      const c = buf[i + k];
      if (c < 0x30 || c > 0x39) { ok = false; break; }
    }
    if (ok) marks.push(i);
  }
  return marks;
}

// 记录内的 UTF-8 中文串（允许夹带 ASCII），长度 >= 4 才算
function cjkStrings(win) {
  const out = [];
  let i = 0;
  while (i < win.length) {
    const b = win[i];
    const lead = b >= 0xf0 ? 4 : (b >= 0xe0 ? 3 : (b >= 0xc0 ? 2 : 0));
    if (!lead) { i++; continue; }
    let s = '';
    let j = i;
    while (j < win.length) {
      const c = win[j];
      const l = c >= 0xf0 ? 4 : (c >= 0xe0 ? 3 : (c >= 0xc0 ? 2 : 0));
      if (l) {
        const chunk = win.slice(j, j + l).toString('utf8');
        if (chunk.indexOf('\ufffd') >= 0) break;
        s += chunk;
        j += l;
        continue;
      }
      if (c >= 0x20 && c < 0x7f) { s += String.fromCharCode(c); j++; continue; }
      break;
    }
    if (s.replace(/[\x20-\x7e]/g, '').length >= 4) out.push(s);
    i = j > i ? j : i + 1;
  }
  return out;
}

const FRAGMENT_DESC_RE = /招募，升星(.+?)所需材料/;

function mergeArchive(buf, want, out) {
  const marks = recordStarts(buf);
  for (let m = 0; m < marks.length; m++) {
    const id = buf.slice(marks[m] + 1, marks[m] + 9).toString('latin1');
    if (!want.has(id) || out.has(id)) continue;
    const from = marks[m] + 9;
    const to = (m + 1 < marks.length) ? marks[m + 1] : Math.min(buf.length, from + 4096);
    if (to <= from) continue;
    for (const t of cjkStrings(buf.slice(from, to))) {
      const hit = FRAGMENT_DESC_RE.exec(t);
      if (!hit) continue;
      out.set(id, { name: hit[1].trim(), desc: t.trim() });
      break;
    }
  }
}

async function fetchArchives(userData, dirs, want) {
  const out = new Map();
  if (!want.size) return out;
  for (const d of dirs) {
    for (const n of ['item1.pkg', 'item2.pkg', 'item3.pkg']) {
      const r = await loadCached(userData, RES_BASE + d + '/config/archives/' + n, 40000);
      if (!r.buf || !r.buf.length) continue;
      mergeArchive(r.buf, want, out);
    }
    if (out.size) return out;
  }
  return out;
}

// 从 CDP jsonl 里取出本次商品列表的图标：id → { buf, ext, url }
// 流式读取，避免全量抓包 jsonl 一次读进内存
function collectIcons(jsonlPath, idSet) {
  return new Promise((resolve) => {
    const found = new Map();
    if (!jsonlPath || !fs.existsSync(jsonlPath)) return resolve({ found, missing: [...idSet] });

    const urlById = new Map();
    const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath, 'utf8') });

    rl.on('line', (line) => {
      if (!line || line.indexOf('bag/item') < 0) return;
      let o;
      try { o = JSON.parse(line); } catch (e) { return; }

      if (o.type === 'req' || o.type === 'res') {
        const m = ICON_RE.exec(o.url || '');
        if (!m) return;
        if (!idSet.has(m[1])) return;
        urlById.set(o.id, { id: m[1], ext: m[2].toLowerCase(), url: o.url });
        return;
      }

      if (o.type === 'body' && typeof o.body === 'string' && o.body.length && urlById.has(o.id)) {
        const info = urlById.get(o.id);
        if (found.has(info.id)) return;
        let buf = null;
        try { buf = Buffer.from(o.body, o.base64 ? 'base64' : 'utf8'); } catch (e) { return; }
        if (!buf || !buf.length) return;
        found.set(info.id, { buf, ext: info.ext, url: info.url });
      }
    });

    rl.on('close', () => {
      // 只抓到 URL、没拿到响应体的，留给后续下载
      for (const info of urlById.values()) {
        if (!found.has(info.id)) found.set(info.id, { buf: null, ext: info.ext, url: info.url });
      }
      resolve({ found, missing: [...idSet].filter((id) => !found.has(String(id))) });
    });
    rl.on('error', () => resolve({ found, missing: [...idSet] }));
  });
}

// ---------- 文本宽度（中文按 2 列） ----------
function dispWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += (c > 0x2e80 && c < 0xfe4f) ? 2 : 1;
  }
  return w;
}

function padW(s, w, right) {
  const d = w - dispWidth(s);
  if (d <= 0) return String(s);
  return right ? ' '.repeat(d) + s : String(s) + ' '.repeat(d);
}

// ---------- 导出 ----------
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// 碎片物品（204xxxxx）在游戏里显示为「XXX碎片」；图鉴里的名字不带这两个字，这里补上
function displayName(itemId, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return '';
  if (String(itemId).indexOf('204') === 0 && name.indexOf('碎片') < 0) return name + '碎片';
  return name;
}

function buildOutput(ctx) {
  const { activity, range, items, names, resolved, meta, nowSec, rewardMap, ninjaOf } = ctx;
  const actStart = range ? range.start : (activity ? activity.start : null);
  const actEnd = range ? range.end : (activity ? activity.end : null);

  const dayStart = items.find((x) => isNum(x.start))?.start ?? actStart;
  const dayEnd = items.find((x) => isNum(x.end))?.end ?? actEnd;

  return {
    抓取时间: fmtTimeW(nowSec),
    活动: {
      活动ID: SHOP_ACTIVITY_ID,
      活动名称: (activity && activity.name) || SHOP_ACTIVITY_NAME,
      商店ID: SHOP_ACTIVITY_ID * 2,
      开始: fmtTime(actStart),
      开始星期: weekdayOf(actStart),
      结束: fmtTime(actEnd),
      结束星期: weekdayOf(actEnd),
      持续天数: daysBetween(actStart, actEnd)
    },
    当日窗口: {
      开始: fmtTime(dayStart),
      结束: fmtTime(dayEnd),
      开始星期: weekdayOf(dayStart),
      结束星期: weekdayOf(dayEnd)
    },
    商品: items.map((x) => {
      const key = String(x.itemId);
      const m = meta.get(key) || {};
      const name = displayName(x.itemId, m.name || names[key] || m.archiveName || '');
      const iconId = m.src ? Number(m.src) : x.itemId;
      const icon = resolved.get(key);
      const node = {
        槽位: x.slot,
        物品ID: x.itemId,
        名称: name,
        说明: m.desc || '',
        图标ID: iconId,
        折扣价: x.price,
        货币: CURRENCY[x.currency] || (isNum(x.currency) ? '货币' + x.currency : ''),
        每日限购: x.dailyLimit,
        已购: x.bought,
        剩余: remainingOf(x),
        开始: fmtTime(x.start),
        结束: fmtTime(x.end),
        星期: weekdayOf(x.start),
        图片: icon ? 'images/' + x.itemId + '.' + icon.ext : ''
      };
      const drops = buildDrops(m.rewardId, rewardMap);
      if (drops) node.掉落 = drops;
      if (m.need) node.需求碎片 = m.need;
      if (m.attrs) node.属性加成 = m.attrs;
      if (m.descMarked && m.descMarked !== m.desc) node.说明标记 = m.descMarked;
      const nj = ninjaOf && ninjaOf.get(key);
      if (nj) node.忍者 = nj;
      return node;
    })
  };
}

function buildText(ctx, out) {
  const L = [];
  const act = out.活动;
  const win = out.当日窗口;

  L.push('火影忍者Online · 商城特惠');
  L.push('抓取时间：' + (out.抓取时间 || '（未知）'));
  L.push('');
  L.push('活动时间：' + (act.开始 ? act.开始 + '（' + act.开始星期 + '）' : '（未取到）') +
    ' ~ ' + (act.结束 ? act.结束 + '（' + act.结束星期 + '）' : '（未取到）') +
    (act.持续天数 ? '，共 ' + act.持续天数 + ' 天' : ''));
  L.push('当日窗口：' + (win.开始 ? win.开始 + '（' + win.开始星期 + '）' : '（未取到）') +
    ' ~ ' + (win.结束 ? win.结束 + '（' + win.结束星期 + '）' : '（未取到）'));
  L.push('');

  const head = ['序号', '物品ID', '名称', '折扣价', '每日限购', '已购', '图片'];
  const rows = [head];
  out.商品.forEach((x, i) => {
    rows.push([
      String(i + 1),
      String(x.物品ID),
      x.名称 || '（待补）',
      x.折扣价 == null ? '' : String(x.折扣价),
      x.每日限购 == null ? '' : (x.剩余 == null ? String(x.每日限购) : x.剩余 + '/' + x.每日限购),
      String(x.已购 == null ? '' : x.已购),
      x.图片 ? String(x.物品ID) + '.' + path.extname(x.图片).slice(1) : '（缺）'
    ]);
  });

  const widths = [];
  for (let c = 0; c < head.length; c++) {
    widths[c] = Math.max.apply(null, rows.map((r) => dispWidth(r[c])));
  }
  for (const r of rows) {
    L.push(r.map((v, c) => padW(v, widths[c], c < 2) + (c === 2 ? '  ' : ' ')).join(''));
  }

  const withImg = out.商品.filter((x) => x.图片).length;
  L.push('');
  L.push('共 ' + out.商品.length + ' 件；图片 ' + withImg + '/' + out.商品.length);

  const detail = out.商品.filter((x) => x.说明 || x.掉落 || x.忍者);
  if (detail.length) {
    L.push('');
    L.push('物品明细');
    L.push('（【】= 游戏内高亮词）');
    out.商品.forEach((x, i) => {
      if (!x.说明 && !x.掉落 && !x.忍者) return;
      L.push('');
      L.push(padW(String(i + 1), 3, true) + ' ' + (x.名称 || String(x.物品ID)) + '  [' + x.物品ID + ']');
      if (x.说明) L.push('     说明：' + (x.说明标记 || x.说明));
      if (x.需求碎片) L.push('     招募所需：' + x.需求碎片 + ' 个碎片');
      if (x.属性加成) {
        const a = x.属性加成;
        L.push('     上阵属性加成：生命 ' + a.生命 + ' / 攻击 ' + a.攻击 + ' / 防御 ' + a.防御 + ' / 忍术 ' + a.忍术);
      }
      if (x.掉落) {
        const fmt = (l) => l.map((d) => d.名称 + '×' + d.数量).join('、');
        if (x.掉落.固定 && x.掉落.固定.length) L.push('     固定掉落：' + fmt(x.掉落.固定));
        if (x.掉落.随机 && x.掉落.随机.length) L.push('     随机掉落：' + fmt(x.掉落.随机));
      }
      if (x.忍者) {
        const n = x.忍者;
        const txt = (s) => s && (s.说明标记 || s.说明);
        for (const s of (n.技能列表 || [])) {
          const extra = (s.槽位 === '奥义' && s.冷却 != null)
            ? '（冷却 ' + s.冷却 + ' / 进场 ' + s.进场冷却 + ' / 查克拉 ' + s.查克拉 + '）'
            : '';
          L.push('     ' + s.槽位 + '：' + s.名称 + extra);
          if (txt(s)) L.push('           ' + txt(s));
        }
      }
    });
  }


  const missing = out.商品.filter((x) => !x.图片).map((x) => String(x.物品ID));
  if (missing.length) {
    L.push('');
    L.push('缺少图片的物品 ID：' + missing.join(', '));
    L.push('（图片只能来自游戏真实请求。重新抓一次，把商城特惠的商品卡片上下滚动一遍再退出，即可补齐。）');
  }

  const noName = out.商品.filter((x) => !x.名称).map((x) => String(x.物品ID));
  if (noName.length) {
    L.push('');
    L.push('待补名称的物品 ID：' + noName.join(', '));
    L.push('（协议里没有物品名。把名称补进 %APPDATA%\\naruto-online-launcher\\shop-item-names.json 的对应键即可长期生效。）');
  }

  return L.join('\r\n');
}

async function runShopExport(opts) {
  const { app, shell } = require('electron');
  const userData = app.getPath('userData');

  let out = null;
  let error = '';
  let netlog = null;
  let stats = null;
  let icons = new Map();          // 会话里抓到的所有图标（物品 ID 与 src ID 都可能在里面）
  let resolved = new Map();       // 物品ID → { buf, ext }（按 src 兜底解析后的结果）
  let meta = new Map();           // 物品ID → { name, archiveName, src, desc, rewardId }
  let rewardMap = new Map();      // rewardId → [{itemId,name,num,sure}]
  let ninjaOf = new Map();        // 物品ID → { 忍者ID, 奥义, 普攻, 追打, 被动[] }
  let missingIcons = [];
  let responseCount = 0;
  let jsonl = null;
  let cfgNote = '';
  let buildDirs = [];

  try {
    netlog = await waitForNetlog(userData, opts && opts.mainPid);
    const stream = extractGameStream(netlog, [CMD_SHOP, CMD_ACTIVITY]);
    stats = stream.stats || null;

    const shop = parseShop(stream.rx);
    if (!shop) throw new Error('抓包里没有商城商品数据（1048608 响应为空）。可能没打开商城特惠，或抓到的是旧模式下的 net-log。');

    responseCount = shop.responses.length;
    const activity = parseActivity(stream.rx);
    const names = loadNames(userData);
    const items = shop.last.items;
    const itemIds = items.map((x) => String(x.itemId));
    const idSet = new Set(itemIds);

    jsonl = findSessionJsonl(userData, netlog);

    // ---------- 配置表：名称 / 说明 / 图标 ID / 掉落组 ----------
    buildDirs = await resolveBuildDirs(jsonl);
    const dirHints = await resolveDirHints(jsonl);
    let common = new Map();
    let archive = new Map();
    const cfgLog = [];
    try {
      const got = await loadCommonItems(userData, buildDirs, dirHints);
      common = got.map;
      cfgLog.push('物品表=' + (common.size ? common.size + '条/' + got.from : '未取到'));
    } catch (e) {
      cfgLog.push('物品表失败:' + ((e && e.message) || String(e)));
    }

    // 只在配置表里查不到的（例如忍者碎片）才去图鉴包里找
    const lacking = new Set(itemIds.filter((id) => !common.has(id)));
    if (lacking.size) {
      try {
        archive = await fetchArchives(userData, buildDirs, lacking);
        cfgLog.push('图鉴=' + archive.size + '/' + lacking.size);
      } catch (e) {
        cfgLog.push('图鉴失败:' + ((e && e.message) || String(e)));
      }
    }

    // 掉落表（只要有一件带 rewardId 就加载）
    const hasReward = itemIds.some((id) => {
      const c = common.get(id);
      return c && c.rewardId && c.rewardId !== '0';
    });
    if (hasReward) {
      try {
        const got = await loadRewards(userData, buildDirs, dirHints);
        rewardMap = got.map;
        cfgLog.push('掉落表=' + (rewardMap.size ? rewardMap.size + '组/' + got.from : '未取到'));
      } catch (e) {
        cfgLog.push('掉落表失败:' + ((e && e.message) || String(e)));
      }
    }

    // 通灵兽碎片（224xxxxx）：物品表和图鉴里都没有，单独一张表
    let beast = new Map();
    let beastStates = [];
    const beastCands = itemIds.filter((id) => id.indexOf('224') === 0 && !common.has(id));
    if (beastCands.length) {
      try {
        const got = await loadBeastFragments(userData, buildDirs, dirHints);
        beast = got.map;
        cfgLog.push('通灵兽碎片=' + (beast.size ? beast.size + '条/' + got.from : '未取到'));
        const st = await loadSkillStates(userData, buildDirs, dirHints);
        beastStates = st.words;
        // 上阵属性加成
        try {
          const mon = await loadMonsterCfg(userData, buildDirs, dirHints);
          if (mon.buf) {
            let n = 0;
            for (const id of beastCands) {
              const b = beast.get(id);
              if (!b) continue;
              const attrs = parseMonsterAttr(mon.buf, String(Number(id) - 2410000), String(b.name).replace(/碎片$/, ''));
              if (attrs) { b.attrs = attrs; n++; }
            }
            cfgLog.push('通灵兽属性=' + n + '/' + beastCands.length + '/' + mon.from);
          }
        } catch (e) {
          cfgLog.push('通灵兽属性失败:' + ((e && e.message) || String(e)));
        }
      } catch (e) {
        cfgLog.push('通灵兽碎片失败:' + ((e && e.message) || String(e)));
      }
    }

    for (const id of itemIds) {
      const c = common.get(id);
      const a = archive.get(id);
      const b = beast.get(id);
      let desc = c && c.desc ? (c.extraDesc ? c.desc + ' ' + c.extraDesc : c.desc) : (a ? a.desc : '');
      let descMarked = '';
      if (!desc && b) {
        const h = markHighlights(b.desc || '', beastStates);
        desc = h.plain;
        descMarked = h.marked;
      }
      meta.set(id, {
        // XML 的 name 是配置里的正名；碎片在图鉴里只有「蝎[绯流琥]」，商城显示的是「蝎[绯流琥]碎片」，
        // 所以图鉴名排在人工核对过的缓存之后
        name: (c && c.name) || (b && b.name) || '',
        archiveName: (a && a.name) || '',
        src: (c && c.src) || '',
        desc: desc || '',
        descMarked: descMarked || '',
        rewardId: (c && c.rewardId) || '',
        need: (b && b.need) || 0,
        attrs: (b && b.attrs) || null
      });
    }

    // ---------- 忍者技能（商品里有碎片才加载，省 30 MB） ----------
    const fragIds = itemIds.filter((id) => id.indexOf('204') === 0);
    if (fragIds.length) {
      try {
        const idx = await loadNinjaIndex(userData, buildDirs, dirHints);
        const nsGot = await loadNinjaSkills(userData, buildDirs, dirHints);
        const stGot = await loadSkillStates(userData, buildDirs, dirHints);
        const skGot = await loadSkills(userData, buildDirs, stGot.words, dirHints);
        cfgLog.push('图鉴索引=' + (idx.buf ? idx.from : '未取到'));
        cfgLog.push('忍者技能=' + (nsGot.map.size ? nsGot.map.size + '条/' + nsGot.from : '未取到'));
        cfgLog.push('状态词表=' + (stGot.words.length ? stGot.words.length + '个/' + stGot.from : '未取到'));
        cfgLog.push('技能表=' + (skGot.map.size ? skGot.map.size + '条/' + skGot.from : '未取到'));

        const ninjaMap = loadNinjaMap(userData);
        let mapDirty = false;
        const unresolved = [];
        // 抓包里悬停卡片时请求过的忍者头像 ID（顺序不可靠，但集合可信）：
        // 图鉴同名多形态时，用它优先选中卡片实际对应的那个形态。
        let headIds = [];
        try { headIds = await collectHeadNinjas(jsonl); } catch (e) { /* ignore */ }
        for (const id of fragIds) {
          const desc = meta.get(id).desc || '';
          const m = FRAGMENT_DESC_RE.exec(desc);
          let ninjaId = null;
          if (m) {
            const cands = resolveNinjaIds(idx.buf, m[1].trim());
            // 优先选「抓包头像集合里出现过、且有技能数据」的候选
            for (const c of cands) {
              if (headIds.indexOf(c) >= 0 && nsGot.map.has(c)) { ninjaId = c; break; }
            }
            if (!ninjaId) ninjaId = pickNinjaId(idx.buf, m[1].trim(), nsGot.map);
          }
          // 图鉴里查不到的，用「碎片ID → 忍者ID」映射兜底
          if (!ninjaId && ninjaMap[id] && nsGot.map.has(String(ninjaMap[id]))) ninjaId = String(ninjaMap[id]);
          if (!ninjaId) {
            unresolved.push({ id, name: (m && m[1].trim()) || meta.get(id).name || '' });
            continue;
          }
          if (ninjaMap[id] !== Number(ninjaId) && ninjaMap[id] !== ninjaId) { ninjaMap[id] = Number(ninjaId); mapDirty = true; }
          const blocks = buildSkillBlocks(nsGot.map.get(ninjaId), skGot.map);
          if (blocks) ninjaOf.set(id, { 忍者ID: Number(ninjaId), 技能列表: blocks });
        }

        // 图鉴里查不到的（或候选里没有头像集合命中的），再用技能描述打分 + 1:1 排除
        const still = unresolved.filter((f) => !ninjaOf.has(f.id));
        if (still.length) {
          try {
            const usedIds = new Set([...ninjaOf.values()].map((x) => String(x.忍者ID)));
            const freeHeads = headIds.filter((h) => !usedIds.has(h));
            const got = autoResolveNinjas(still, freeHeads, nsGot.map, skGot.map);
            for (const [itemId, nid] of got.assigned) {
              const blocks = buildSkillBlocks(nsGot.map.get(String(nid)), skGot.map);
              if (!blocks) continue;
              ninjaOf.set(itemId, { 忍者ID: Number(nid), 技能列表: blocks });
              if (ninjaMap[itemId] !== Number(nid)) { ninjaMap[itemId] = Number(nid); mapDirty = true; }
            }
            if (got.notes.length) cfgLog.push('自动推断：' + got.notes.join('；'));
          } catch (e) {
            cfgLog.push('头像反推失败:' + ((e && e.message) || String(e)));
          }
        }
        if (mapDirty) saveNinjaMap(userData, ninjaMap);
      } catch (e) {
        cfgLog.push('技能加载失败:' + ((e && e.message) || String(e)));
      }
    }

    cfgNote = cfgLog.join('；');

    // ---------- 图标：先按物品 ID，再按 src（礼包共用通用图标） ----------
    const iconIds = new Set(idSet);
    for (const id of itemIds) {
      const src = meta.get(id).src;
      if (src) iconIds.add(String(src));
    }

    let iconMap = { found: new Map(), missing: [...iconIds] };
    try {
      iconMap = await collectIcons(jsonl, iconIds);
    } catch (e) {
      error = '图标提取失败：' + ((e && e.message) || String(e));
    }

    // 只有 URL 没有响应体的，按真实 URL 补下载（走同一层缓存，第二次导出可离线）
    for (const [, info] of iconMap.found) {
      if (info.buf || !info.url) continue;
      const got = await loadCached(userData, info.url, 8000);
      if (got.buf && got.buf.length) info.buf = got.buf;
    }

    icons = new Map();
    for (const [id, info] of iconMap.found) if (info.buf) icons.set(String(id), info);

    resolved = new Map();
    for (const id of itemIds) {
      const src = meta.get(id).src;
      const info = icons.get(id) || (src ? icons.get(String(src)) : null);
      if (info) resolved.set(id, info);
    }
    missingIcons = itemIds.filter((id) => !resolved.has(id));

    const nowSec = (activity && activity.serverNow) || Math.floor(Date.now() / 1000);
    out = buildOutput({ activity, range: shop.last.range, items, names, resolved, meta, nowSec, rewardMap, ninjaOf });

    // 名称缓存：新出现的 ID 留空占位，方便用户补
    let dirty = false;
    for (const x of items) {
      const k = String(x.itemId);
      const nm = displayName(k, meta.get(k).name || meta.get(k).archiveName || '');
      if (!(k in names)) { names[k] = nm; dirty = true; }
      else if (!names[k] && nm) { names[k] = nm; dirty = true; }
      else if (names[k] && k.indexOf('204') === 0 && names[k].indexOf('碎片') < 0) { names[k] = names[k] + '碎片'; dirty = true; }
    }
    if (dirty) saveNames(userData, names);
  } catch (e) {
    error = (e && e.message) || String(e);
  }

  let dir = path.join(app.getPath('desktop'), '火影商城特惠', '商城特惠_' + timestamp());
  let dirNote = '';
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    dir = path.join(userData, '火影商城特惠', '商城特惠_' + timestamp());
    fs.mkdirSync(dir, { recursive: true });
    dirNote = '桌面不可写，已改为输出到：' + dir;
  }

  const files = { json: '', txt: '', diag: '', images: 0 };

  if (out) {
    try {
      fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
      for (const [id, info] of resolved) {
        try {
          fs.writeFileSync(path.join(dir, 'images', id + '.' + info.ext), info.buf);
          files.images++;
        } catch (e) { /* 单张失败不影响其它 */ }
      }
    } catch (e) { /* ignore */ }

    const ctx = {};
    files.json = path.join(dir, '商城特惠.json');
    fs.writeFileSync(files.json, JSON.stringify(out, null, 2), 'utf8');

    files.txt = path.join(dir, '商城特惠.txt');
    fs.writeFileSync(files.txt, buildText(ctx, out), 'utf8');
  }

  const needDiag = !!error || !out || missingIcons.length || (out && out.商品.some((x) => !x.说明));
  if (needDiag) {
    const L = [];
    L.push('商城特惠导出诊断');
    L.push('时间：' + new Date().toLocaleString());
    L.push('netlog：' + (netlog || '（未找到）'));
    L.push('http jsonl：' + (jsonl || '（未找到）'));
    L.push('商品数：' + (out ? out.商品.length : 0));
    L.push('商品响应条数：' + responseCount + (responseCount > 1 ? '（采用最后一条）' : ''));
    L.push('图片：' + files.images + '/' + (out ? out.商品.length : 0));
    if (buildDirs.length) L.push('候选资源目录：' + buildDirs.join(', '));
    if (cfgNote) L.push('配置表：' + cfgNote);
    if (out) {
      const noDesc = out.商品.filter((x) => !x.说明).map((x) => String(x.物品ID));
      if (noDesc.length) L.push('没有说明的物品 ID：' + noDesc.join(', '));
      const noName = out.商品.filter((x) => !x.名称).map((x) => String(x.物品ID));
      if (noName.length) L.push('没有名称的物品 ID：' + noName.join(', '));
      const fragNoNinja = out.商品.filter((x) => String(x.物品ID).indexOf('204') === 0 && !x.忍者).map((x) => String(x.物品ID));
      if (fragNoNinja.length) L.push('没查到忍者技能的物品 ID：' + fragNoNinja.join(', '));
      const noDrop = out.商品.filter((x) => !x.掉落 && String(x.物品ID).indexOf('204') !== 0).map((x) => String(x.物品ID));
      if (noDrop.length) L.push('没有掉落数据的物品 ID：' + noDrop.join(', '));
    }
    if (missingIcons.length) L.push('缺失图片的物品 ID：' + missingIcons.join(', '));
    if (error) L.push('错误：' + error);
    if (dirNote) L.push(dirNote);
    if (stats && stats.length) {
      L.push('');
      L.push('socket 统计（按商城命令命中、帧数排序）：');
      for (const s of stats) {
        L.push('  sock ' + s.id + ' ' + (s.addr || '') + '  帧=' + s.frames + '  命中=' + s.hits + '  rx=' + s.rxLen);
      }
    }
    try {
      files.diag = path.join(dir, '导出诊断.txt');
      fs.writeFileSync(files.diag, L.join('\r\n'), 'utf8');
    } catch (e) { /* ignore */ }
  }

  try {
    shell.showItemInFolder(files.json || dir);
  } catch (e) { /* ignore */ }

  return { dir, files, count: out ? out.商品.length : 0, images: files.images, error };
}

module.exports = {
  runShopExport,
  parseShop,
  parseActivity,
  parseItem,
  decodeFrame,
  fmtTime,
  weekdayOf,
  fmtTimeW,
  collectIcons,
  findSessionJsonl,
  resolveBuildDirs,
  resolveDirHints,
  collectHeadNinjas,
  autoResolveNinjas,
  parseItemXml,
  loadCommonItems,
  loadRewards,
  loadNinjaIndex,
  loadNinjaSkills,
  loadSkills,
  loadSkillStates,
  parseStateWords,
  markHighlights,
  markStates,
  parseRewards,
  parseNinjaSkills,
  parseSkills,
  buildText,
  buildOutput,
  loadBeastFragments,
  parseBeastFragments,
  loadMonsterCfg,
  parseMonsterAttr,
  resolveNinjaIds,
  pickNinjaId,
  buildSkillBlocks,
  displayName,
  slotOfDisplayType,
  buildDrops,
  loadCached,
  fetchArchives,
  inflateAny,
  cjkStrings,
  loadNames,
  saveNames,
  loadNinjaMap,
  saveNinjaMap,
  NINJA_ID_SEED,
  remainingOf,
  NAME_SEED
};
