// export.js —— 从 Chromium net-log 导出火影OL 组织数据为 5 个 Excel
// 零外部依赖：netlog 解析 + 腾讯TEA解密 + Protobuf解析 + xlsx 生成
const fs = require('fs');
const path = require('path');
const { writeXlsx } = require('./xlsx');

// ---------- 常量 ----------
const HDR = 36;
const SALT_LEN = 2;
const ZERO_LEN = 7;
const DELTA = 0x9E3779B9;
const KEY = Buffer.from('d796c2542916b456', 'latin1');
const GAME_PORT = 11096;

const IDENTITY = { 0: '成员', 1: '精英', 2: '暗部', 3: '高层', 4: '首领', 5: '指挥官', 6: '军需官', 7: '科学家', 8: '通灵使' };
const CAREER = { 1: '碧蓝之牙', 2: '红莲之瞳', 3: '疾风舞者', 4: '黑夜之刃', 5: '赤色岩拳' };
const ITEM_NAME = { 11000001: '金币', 10800057: '洞穴钥匙' };

const u32 = (x) => x >>> 0;

// ---------- TEA ----------
function teaDec8(buf, off, k) {
  let v0 = buf.readUInt32BE(off);
  let v1 = buf.readUInt32BE(off + 4);
  let s = u32(DELTA << 4);
  for (let i = 0; i < 16; i++) {
    const a1 = u32(u32(u32(v0 << 4) + k[2]) ^ u32(v0 + s) ^ u32(u32(v0 >>> 5) + k[3]));
    v1 = u32(v1 - a1);
    const a2 = u32(u32(u32(v1 << 4) + k[0]) ^ u32(v1 + s) ^ u32(u32(v1 >>> 5) + k[1]));
    v0 = u32(v0 - a2);
    s = u32(s - DELTA);
  }
  const out = Buffer.alloc(8);
  out.writeUInt32BE(v0, 0);
  out.writeUInt32BE(v1, 4);
  return out;
}

function teaDecrypt(data) {
  const k = [KEY.readUInt32BE(0), KEY.readUInt32BE(4), KEY.readUInt32BE(8), KEY.readUInt32BE(12)];
  const n = Math.floor(data.length / 8);
  if (n < 2) return null;
  let p = teaDec8(data, 0, k);
  const out = [p];
  for (let i = 1; i < n; i++) {
    const x = Buffer.alloc(8);
    for (let j = 0; j < 8; j++) x[j] = p[j] ^ data[i * 8 + j];
    p = teaDec8(x, 0, k);
    const o = Buffer.alloc(8);
    for (let j = 0; j < 8; j++) o[j] = p[j] ^ data[(i - 1) * 8 + j];
    out.push(o);
  }
  return Buffer.concat(out);
}

function strip(full, total) {
  const pad = full[0] & 7;
  const n = total - 1 - pad - SALT_LEN - ZERO_LEN;
  if (n < 0) return null;
  return full.slice(1 + pad + SALT_LEN, 1 + pad + SALT_LEN + n);
}

// ---------- protobuf ----------
function readVarint(b, i) {
  let r = 0, s = 0;
  while (i < b.length) {
    const x = b[i++];
    r += (x & 0x7f) * Math.pow(2, s);
    if (!(x & 0x80)) return [r, i];
    s += 7;
  }
  throw new Error('varint eof');
}

function pb(b) {
  const out = [];
  let i = 0;
  while (i < b.length) {
    const [key, i2] = readVarint(b, i);
    i = i2;
    const fn = Math.floor(key / 8), wt = key & 7;
    if (wt === 0) { const [v, i3] = readVarint(b, i); i = i3; out.push([fn, v]); }
    else if (wt === 2) { const [ln, i3] = readVarint(b, i); i = i3; out.push([fn, b.slice(i, i + ln)]); i += ln; }
    else if (wt === 5) { out.push([fn, b.readUInt32LE(i)]); i += 4; }
    else if (wt === 1) { out.push([fn, b.readUInt32LE(i) + b.readUInt32LE(i + 4) * 4294967296]); i += 8; }
    else break;
  }
  return out;
}

const g = (f, n) => { for (const [fn, v] of f) if (fn === n) return v; return undefined; };
const ga = (f, n) => f.filter(([fn]) => fn === n).map(([, v]) => v);
const txt = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v);

function playerKey(m) {
  const key = g(m, 1);
  if (!Buffer.isBuffer(key)) return [null, null];
  const kf = pb(key);
  return [g(kf, 1), g(kf, 3)];
}

function fmtDur(s) {
  s = Math.floor(s || 0);
  if (s <= 0) return '离线';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return d + '天' + h + '小时';
  if (h) return h + '小时' + m + '分';
  if (m) return m + '分';
  return sec + '秒';
}

function numOrInt(x) { return x === Math.floor(x) ? x : Math.round(x * 100) / 100; }

// ---------- 分帧 ----------
function frames(d) {
  const out = [];
  let off = 0;
  while (off + HDR <= d.length) {
    if (d[off] !== 0x09 || d[off + 1] !== 0x01) { off++; continue; }
    const ln = d.readUInt16BE(off + 2);
    if (off + HDR + ln > d.length) break;
    out.push([d.readUInt32BE(off + 4), d.slice(off + HDR, off + HDR + ln)]);
    off += HDR + ln;
  }
  return out;
}

function byCmd(rx) {
  const m = {};
  for (const [cmd, p] of frames(rx)) (m[cmd] = m[cmd] || []).push(p);
  return m;
}

function dec(cmd, p) {
  if (!p || p.length % 8 || p.length < 16) return null;
  return strip(teaDecrypt(p), p.length);
}

// ---------- 5 类数据集 ----------
function dsMembers(m) {
  const rows = [['成员', '职务', '组织贡献度', '职业', '等级', '战斗力', '离线时间', '组织战白名单']];
  const seen = new Set();
  for (const p of (m[199179] || [])) {
    const plain = dec(199179, p); if (!plain) continue;
    for (const [fn, v] of pb(plain)) {
      if (fn !== 3) continue;
      const e = pb(v);
      const [uin, sid] = playerKey(e);
      if (uin == null || seen.has(sid + '-' + uin)) continue;
      seen.add(sid + '-' + uin);
      rows.push([
        sid + '区-' + txt(g(e, 2)),
        IDENTITY[g(e, 6) || 0],
        (g(e, 9) || 0) + '/' + (g(e, 10) || 0),
        CAREER[g(e, 5) || 0],
        g(e, 3), g(e, 4),
        (g(e, 7) === 1) ? '在线' : fmtDur(g(e, 8)),
        (g(e, 13) || 0) ? '是' : '—'
      ]);
    }
  }
  return rows;
}

function dsDonate(m) {
  const rows = [['排行', '角色名字', '捐献贡献']];
  const seen = new Set();
  for (const p of (m[199184] || [])) {
    const plain = dec(199184, p); if (!plain) continue;
    for (const [fn, v] of pb(plain)) {
      if (fn !== 4) continue;
      const e = pb(v);
      const [uin, sid] = playerKey(e);
      if (uin == null || seen.has(sid + '-' + uin)) continue;
      seen.add(sid + '-' + uin);
      rows.push([seen.size, sid + '区-' + txt(g(e, 2)), g(e, 3)]);
    }
  }
  return rows;
}

function dsRebel(m) {
  const rows = [['排名', '玩家名', '缉拿叛忍数', '击杀数', '杰出奖']];
  const seen = new Set();
  for (const p of (m[852147] || [])) {
    const plain = dec(852147, p); if (!plain) continue;
    for (const [fn, v] of pb(plain)) {
      if (fn !== 2) continue;
      const e = pb(v);
      const key = g(e, 2);
      const kf = Buffer.isBuffer(key) ? pb(key) : [];
      const uin = g(kf, 1), sid = g(kf, 3);
      if (uin == null || seen.has(sid + '-' + uin)) continue;
      seen.add(sid + '-' + uin);
      const rewards = ga(e, 5).map((x) => {
        const it = pb(x);
        const iid = g(it, 1);
        return (ITEM_NAME[iid] || ('道具' + iid)) + (g(it, 2) || 0);
      }).join('/');
      rows.push([g(e, 1), sid + '区-' + txt(g(e, 3)),
        Math.floor((g(e, 6) || 0) / 600), numOrInt((g(e, 4) || 0) / 600), rewards]);
    }
  }
  return rows;
}

function dsBeast(m) {
  const rows = [['排行', '角色名字', '献祭通灵查克拉']];
  const seen = new Set();
  for (const p of (m[199209] || [])) {
    const plain = dec(199209, p); if (!plain) continue;
    for (const [fn, v] of pb(plain)) {
      if (fn !== 6) continue;
      const e = pb(v);
      const [uin, sid] = playerKey(e);
      if (uin == null || seen.has(sid + '-' + uin)) continue;
      seen.add(sid + '-' + uin);
      rows.push([seen.size, sid + '区-' + txt(g(e, 2)), g(e, 3)]);
    }
  }
  return rows;
}

function dsGvg(m) {
  const rows = [['名称', '职务', '参战次数', '战斗力', '战力增幅', '本周贡献']];
  const seen = new Set();
  for (const cmd of [852296, 852233]) {
    for (const p of (m[cmd] || [])) {
      const plain = dec(cmd, p); if (!plain) continue;
      for (const [fn, v] of pb(plain)) {
        if (fn !== 2) continue;
        const e = pb(v);
        const [uin, sid] = playerKey(e);
        if (uin == null || seen.has(sid + '-' + uin)) continue;
        seen.add(sid + '-' + uin);
        rows.push([sid + '区-' + txt(g(e, 2)), IDENTITY[g(e, 3) || 0],
          g(e, 4), g(e, 6), g(e, 7), g(e, 8)]);
      }
    }
  }
  return rows;
}

// ---------- netlog 解析 ----------
function nameMap(consts) {
  const out = {};
  for (const [k, v] of Object.entries(consts || {})) out[v] = k;
  return out;
}

function extractGameStream(netlogPath) {
  const log = JSON.parse(fs.readFileSync(netlogPath, 'utf8'));
  const typeName = nameMap(log.constants && log.constants.logEventTypes);
  const addrOf = {};
  for (const ev of (log.events || [])) {
    const t = typeName[ev.type];
    if (t === 'TCP_CONNECT' || t === 'TCP_CONNECT_ATTEMPT' || t === 'SSL_CONNECT' || t === 'UDP_CONNECT') {
      const p = ev.params || {};
      const a = p.address || (Array.isArray(p.address_list) ? p.address_list.join('|') : null);
      if (a && ev.source) addrOf[ev.source.id] = a;
    }
  }
  const cands = [];
  for (const [id, addr] of Object.entries(addrOf)) {
    if (addr.indexOf(':' + GAME_PORT) >= 0) cands.push(Number(id));
  }
  if (!cands.length) throw new Error('未在 netlog 中找到连到 ' + GAME_PORT + ' 端口的游戏连接');
  // 同一端口可能有多个 socket（策略文件 843/11096、游戏主连接 11096）→ 取数据量最大的
  let best = null;
  for (const sid of cands) {
    const tx = [], rx = [];
    for (const ev of (log.events || [])) {
      const t = typeName[ev.type];
      if (!t || !ev.source || ev.source.id !== sid) continue;
      if (t !== 'SOCKET_BYTES_SENT' && t !== 'SOCKET_BYTES_RECEIVED') continue;
      const b64 = ev.params && ev.params.bytes;
      if (typeof b64 !== 'string') continue;
      (t.indexOf('RECEIVED') >= 0 ? rx : tx).push(Buffer.from(b64, 'base64'));
    }
    const cand = { tx: Buffer.concat(tx), rx: Buffer.concat(rx) };
    if (!best || cand.rx.length > best.rx.length) best = cand;
  }
  return best;
}

// ---------- 流程 ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForNetlog(userData, mainPid) {
  const dir = path.join(userData, 'captures');
  // 1) 等主进程退出
  for (let i = 0; i < 600; i++) {
    if (!mainPid || !isAlive(mainPid)) break;
    await sleep(500);
  }
  // 2) 找最新 netlog
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^netlog-.*\.json$/.test(f)).map((f) => path.join(dir, f))
    : [];
  if (!files.length) throw new Error('未找到 netlog 文件（' + dir + '）');
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const latest = files[0];
  // 3) 等文件完整（可 JSON.parse）
  for (let i = 0; i < 60; i++) {
    try { JSON.parse(fs.readFileSync(latest, 'utf8')); return latest; } catch (e) { await sleep(500); }
  }
  throw new Error('netlog 未写完或损坏: ' + latest);
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

// ---------- 合并表 ----------
const MERGED_COLS = ['成员', '职务', '战斗力', '捐献贡献', '缉拿叛忍数', '献祭通灵查克拉', '参战次数'];
const ZERO_COLS = ['战斗力', '捐献贡献', '缉拿叛忍数', '献祭通灵查克拉', '参战次数'];

function mergeRows(tables) {
  const map = {};
  const order = [];
  for (const t of tables) {
    const header = t.rows[0];
    const ni = header.indexOf(t.nameCol);
    if (ni < 0) continue;
    for (let r = 1; r < t.rows.length; r++) {
      const row = t.rows[r];
      const name = row[ni];
      if (!name) continue;
      if (!map[name]) { map[name] = {}; order.push(name); }
      header.forEach((col, ci) => {
        if (MERGED_COLS.indexOf(col) >= 0 && map[name][col] === undefined &&
            row[ci] !== '' && row[ci] !== undefined && row[ci] !== null) {
          map[name][col] = row[ci];
        }
      });
      map[name]['成员'] = name;
    }
  }
  const out = [MERGED_COLS.slice()];
  for (const name of order) {
    out.push(MERGED_COLS.map((c) => {
      let v = map[name][c];
      if ((v === undefined || v === '') && ZERO_COLS.indexOf(c) >= 0) v = 0;
      return v === undefined ? '' : v;
    }));
  }
  return out;
}

function buildSheets(rx, stamp) {
  const m = byCmd(rx);
  const members = dsMembers(m), donate = dsDonate(m), rebel = dsRebel(m), beast = dsBeast(m), gvg = dsGvg(m);
  const merged = mergeRows([
    { rows: members, nameCol: '成员' },
    { rows: donate, nameCol: '角色名字' },
    { rows: rebel, nameCol: '玩家名' },
    { rows: beast, nameCol: '角色名字' },
    { rows: gvg, nameCol: '名称' },
  ]);
  return [
    ['火影忍者数据统计表' + (stamp || '') + '.xlsx', [{ name: '统计表', rows: merged }]],
    ['1-组织成员.xlsx', [{ name: '组织成员', rows: members }]],
    ['2-组织捐献.xlsx', [{ name: '组织捐献', rows: donate }]],
    ['3-叛忍数据.xlsx', [{ name: '成员排名', rows: rebel }]],
    ['4-组织通灵兽.xlsx', [{ name: '本周献祭', rows: beast }]],
    ['5-忍战数据.xlsx', [{ name: '忍战成员', rows: gvg }]],
  ];
}

async function runExport(opts) {
  const { app, shell } = require('electron');
  const userData = app.getPath('userData');
  const netlog = await waitForNetlog(userData, opts && opts.mainPid);
  const { rx } = extractGameStream(netlog);
  if (!rx.length) throw new Error('游戏连接无数据（可能未进入游戏或未打开面板）');

  const d = new Date();
  const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let outDir = path.join(app.getPath('desktop'), '火影组织数据', stamp);
  try { fs.mkdirSync(outDir, { recursive: true }); }
  catch (e) { outDir = path.join(userData, '导出', stamp); fs.mkdirSync(outDir, { recursive: true }); }

  for (const [name, sheets] of buildSheets(rx, stamp)) writeXlsx(path.join(outDir, name), sheets);

  try { shell.openPath(outDir); } catch (e) {}
  return outDir;
}

module.exports = { runExport, extractGameStream, buildSheets };
