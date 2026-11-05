// server-app/main.js —— 在线人数后台（Windows 独立小窗口 + 计数服务）
//
// 职责：
//   1) 监听 10001，接收启动器上报（POST /report），返回加成后的在线人数
//   2) 面板展示实时数据（实际 / 显示 / 在线客户端数）
//   3) 分时段「虚拟人数 + 浮动」规则，保存在 %APPDATA%\hyol-online-server\config.json
//   4) 关窗口最小化到托盘，服务继续跑
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const WINDOW_W = 520;
const WINDOW_H = 640;
const TTL = 20 * 1000;            // 20 秒没上报 → 剔除（启动器 5 秒上报一次）
const PRUNE_EVERY = 5 * 1000;
const MAX_BODY = 1024;
const DEFAULT_PORT = 10001;
const SNAPSHOT_EVERY = 10 * 60 * 1000;          // 每 10 分钟一个统计点
const STORAGE_VERSION = 1;
const ACTIVE_MONTHS = 3;                        // 当前月 + 前两个月
const MAX_HISTORY = 20000;                      // 兜底上限

const CONFIG_DIR = path.join(app.getPath('appData'), 'hyol-online-server');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
// 新版按月分文件：stats/YYYY-MM.json；超过 3 个月的移到 stats/archive/
const STATS_DIR = path.join(CONFIG_DIR, 'stats');
const ARCHIVE_DIR = path.join(STATS_DIR, 'archive');
const LEGACY_STATS_FILE = path.join(CONFIG_DIR, 'stats.json');
const DASHBOARD_FILE = path.join(__dirname, 'dashboard.html');

const DEFAULT_CONFIG = {
  port: 10001,
  virtual: { fire: [], mini: [] }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let server = null;
let actualPort = 0;
let serverError = '';
let tray = null;
let win = null;
let isQuitting = false;

const clients = new Map();   // id -> { fire, mini, version, ts }
let history = [];            // 10 分钟快照
let bucketKey = 0;           // 当前 10 分钟桶
let bucketSeen = new Map();  // 当前桶内出现过的 id -> version
let dashboardHtml = '';

// ---------- 配置 ----------
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    config = normalizeConfig(data);
  } catch (e) {
    // 配置损坏：备份后回退默认
    try { fs.renameSync(CONFIG_FILE, CONFIG_FILE + '.bad'); } catch (_) {}
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function normalizeConfig(data) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!data || typeof data !== 'object') return out;

  const port = Number(data.port);
  if (Number.isFinite(port) && port > 0 && port < 65536) out.port = Math.floor(port);

  for (const game of ['fire', 'mini']) {
    const list = data.virtual && Array.isArray(data.virtual[game]) ? data.virtual[game] : [];
    out.virtual[game] = list
      .filter((r) => r && isValidTime(r.start) && isValidTime(r.end))
      .slice(0, 50)
      .map((r) => ({
        start: r.start,
        end: r.end,
        value: clampInt(r.value, 0, 9999),
        float: clampInt(r.float, 0, 999)
      }));
  }
  return out;
}

function saveConfig() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isValidTime(t) {
  return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ---------- 虚拟人数 ----------
const FLOAT_INTERVAL = 10 * 60 * 1000;   // 浮动每 10 分钟变一次

// 命中第一条规则；start > end 视为跨天
function matchRule(rules, nowMin) {
  for (const r of (rules || [])) {
    const s = timeToMinutes(r.start);
    const e = timeToMinutes(r.end);
    if (s === e) continue;                       // 空区间忽略
    const hit = s < e ? (nowMin >= s && nowMin < e) : (nowMin >= s || nowMin < e);
    if (hit) return r;
  }
  return null;
}

// 每 10 分钟换一次的伪随机偏移，范围 [-float, +float]
function virtualOffset(game, floatVal, nowMs) {
  const f = clampInt(floatVal, 0, 999);
  if (f <= 0) return 0;
  const bucket = Math.floor(nowMs / FLOAT_INTERVAL);
  const h = crypto.createHash('md5').update(game + ':' + bucket).digest();
  const r = h.readUInt32BE(0) / 0xffffffff;      // 0~1
  return Math.round((r * 2 - 1) * f);            // -f ~ +f
}

function virtualFor(game, nowMs) {
  const rules = config.virtual[game] || [];
  const nowMin = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes();
  const rule = matchRule(rules, nowMin);
  if (!rule) return 0;
  return rule.value + virtualOffset(game, rule.float, nowMs);
}

// ---------- 计数 ----------
function actualTotals() {
  let fire = 0, mini = 0;
  for (const c of clients.values()) {
    fire += c.fire;
    mini += c.mini;
  }
  return { fire, mini, clients: clients.size };
}

function displayTotals(nowMs) {
  const a = actualTotals();
  const fire = Math.max(0, Math.min(99999, a.fire + virtualFor('fire', nowMs)));
  const mini = Math.max(0, Math.min(99999, a.mini + virtualFor('mini', nowMs)));
  return { fire, mini, clients: a.clients };
}

// ---------- 版本统计 / 10 分钟快照 ----------
function normalizeVersion(v) {
  const s = String(v || '').trim().slice(0, 32);
  return s || 'unknown';
}

function currentVersionCounts() {
  const out = {};
  for (const c of clients.values()) {
    const key = normalizeVersion(c.version);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function bucketVersionCounts() {
  const out = {};
  for (const v of bucketSeen.values()) {
    const key = normalizeVersion(v);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// ---------- 按月存储 ----------
function pad2(n) { return String(n).padStart(2, '0'); }

function monthKeyFromTs(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

function shiftMonthKey(key, delta) {
  const parts = String(key || '').split('-');
  const y = Number(parts[0]) || new Date().getFullYear();
  const m = Number(parts[1]) || (new Date().getMonth() + 1);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

// 当前月 + 前两个月，共 3 个自然月
function activeMonthKeys(now) {
  const cur = monthKeyFromTs(now || Date.now());
  const out = [];
  for (let i = ACTIVE_MONTHS - 1; i >= 0; i--) out.push(shiftMonthKey(cur, -i));
  return out;
}

function ensureStatsDirs() {
  fs.mkdirSync(STATS_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function mergeSnapshots(a, b) {
  const map = new Map();
  for (const r of (a || []).concat(b || [])) {
    if (!r || !Number.isFinite(Number(r.ts))) continue;
    map.set(Number(r.ts), r);
  }
  return Array.from(map.values()).sort((x, y) => Number(x.ts) - Number(y.ts));
}

function readMonthFile(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.snapshots) ? data.snapshots : []);
    return list.filter((r) => r && Number.isFinite(Number(r.ts)));
  } catch (e) {
    return [];
  }
}

function writeMonthFile(file, month, snapshots) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const json = JSON.stringify({
      version: STORAGE_VERSION,
      month: month,
      snapshots: snapshots
    });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, json, 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      // Windows 目标被占用时退化为直接覆盖
      fs.writeFileSync(file, json, 'utf8');
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
    return true;
  } catch (e) {
    return false;
  }
}

function monthFile(key, archived) {
  return path.join(archived ? ARCHIVE_DIR : STATS_DIR, key + '.json');
}

// 旧版单文件 stats.json → 按月拆分；成功后改名 + 写标记，避免重复导入
function migrateLegacyIfNeeded() {
  const marker = path.join(STATS_DIR, '.legacy-migrated');
  if (!fs.existsSync(LEGACY_STATS_FILE) || fs.existsSync(marker)) return;
  try {
    const data = JSON.parse(fs.readFileSync(LEGACY_STATS_FILE, 'utf8'));
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.snapshots) ? data.snapshots : []);
    const byMonth = new Map();
    for (const r of list) {
      if (!r || !Number.isFinite(Number(r.ts))) continue;
      const key = monthKeyFromTs(r.ts);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(r);
    }
    const active = new Set(activeMonthKeys());
    let allOk = true;
    for (const [key, snaps] of byMonth) {
      const file = monthFile(key, !active.has(key));
      const merged = mergeSnapshots(readMonthFile(file), snaps);
      if (!writeMonthFile(file, key, merged)) allOk = false;
    }
    if (!allOk) return;
    try { fs.renameSync(LEGACY_STATS_FILE, LEGACY_STATS_FILE + '.migrated'); } catch (e) {}
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
  } catch (e) {
    // 保留旧文件，下次启动再试
  }
}

// 超出当前 3 个月的月份文件移到 stats/archive/
function archiveOldMonths() {
  ensureStatsDirs();
  const active = new Set(activeMonthKeys());
  let files = [];
  try { files = fs.readdirSync(STATS_DIR); } catch (e) { return; }
  for (const f of files) {
    const m = /^(\d{4}-\d{2})\.json$/.exec(f);
    if (!m || active.has(m[1])) continue;
    const src = path.join(STATS_DIR, f);
    const dst = path.join(ARCHIVE_DIR, f);
    try {
      const merged = mergeSnapshots(readMonthFile(dst), readMonthFile(src));
      if (writeMonthFile(dst, m[1], merged)) fs.unlinkSync(src);
    } catch (e) { /* ignore */ }
  }
}

// 只加载当前月 + 前两个月；更久的归档文件不读
function loadHistory() {
  try {
    ensureStatsDirs();
    migrateLegacyIfNeeded();
    archiveOldMonths();
    let list = [];
    for (const key of activeMonthKeys()) {
      list = list.concat(readMonthFile(path.join(STATS_DIR, key + '.json')));
    }
    history = mergeSnapshots([], list).slice(-MAX_HISTORY);
    pruneHistory();
  } catch (e) {
    history = [];
  }
}

function saveMonthForTs(ts) {
  const key = monthKeyFromTs(ts);
  const snaps = history.filter((r) => monthKeyFromTs(r.ts) === key);
  writeMonthFile(monthFile(key, false), key, snaps);
}

function saveActiveMonths() {
  ensureStatsDirs();
  for (const key of activeMonthKeys()) {
    const snaps = history.filter((r) => monthKeyFromTs(r.ts) === key);
    if (snaps.length) writeMonthFile(monthFile(key, false), key, snaps);
  }
}

function pruneHistory() {
  const active = new Set(activeMonthKeys());
  history = history.filter((r) => active.has(monthKeyFromTs(r.ts)));
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
}

// 只有用户主动点「全部历史」时才读 archive，读完不常驻内存
function readAllHistory() {
  ensureStatsDirs();
  migrateLegacyIfNeeded();
  archiveOldMonths();
  const files = [];
  for (const dir of [STATS_DIR, ARCHIVE_DIR]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { names = []; }
    for (const f of names) {
      if (/^\d{4}-\d{2}\.json$/.test(f)) files.push(path.join(dir, f));
    }
  }
  let all = [];
  for (const file of files) all = all.concat(readMonthFile(file));
  return mergeSnapshots([], all);
}

function currentBucketKey() {
  return Math.floor(Date.now() / SNAPSHOT_EVERY);
}

function finalizeBucket(boundaryTs) {
  const a = actualTotals();
  const d = displayTotals(boundaryTs);
  history.push({
    ts: boundaryTs,
    uniqueClients: bucketSeen.size,
    uniqueVersions: bucketVersionCounts(),
    clients: a.clients,
    versions: currentVersionCounts(),
    fire: { actual: a.fire, display: d.fire },
    mini: { actual: a.mini, display: d.mini }
  });
  pruneHistory();
  archiveOldMonths();
  saveMonthForTs(boundaryTs);
  pushState();
}

function ensureBucket() {
  const nowKey = currentBucketKey();
  if (!bucketKey) { bucketKey = nowKey; return; }
  // 机器休眠/服务停了很久时不要补几百条空快照，只补最近一个点
  if (nowKey - bucketKey > 12) {
    bucketKey = nowKey - 1;
    bucketSeen = new Map();
  }
  while (bucketKey < nowKey) {
    finalizeBucket((bucketKey + 1) * SNAPSHOT_EVERY);
    bucketKey++;
    bucketSeen = new Map();
  }
}

function snapshotTick() {
  ensureBucket();
}

function dashboardOverview() {
  const now = Date.now();
  const a = actualTotals();
  const d = displayTotals(now);
  return {
    ok: true,
    now: now,
    port: actualPort || DEFAULT_PORT,
    preferredPort: DEFAULT_PORT,
    running: !!server && !serverError,
    error: serverError,
    warning: '',
    clients: a.clients,
    fire: { actual: a.fire, display: d.fire },
    mini: { actual: a.mini, display: d.mini },
    versions: currentVersionCounts(),
    active10m: {
      clients: bucketSeen.size,
      versions: bucketVersionCounts(),
      since: bucketKey * SNAPSHOT_EVERY
    },
    lastSnapshot: history.length ? history[history.length - 1] : null,
    recent: history.slice(-20),
    historyCount: history.length,
    storage: {
      activeMonths: activeMonthKeys(now),
      currentMonth: monthKeyFromTs(now),
      historyCount: history.length
    }
  };
}

// ---------- HTTP ----------
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function sendHtml(res, code, html) {
  const body = Buffer.from(String(html || ''), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function handleRequest(req, res) {
  let u;
  try { u = new URL(req.url || '/', 'http://localhost'); }
  catch (e) { return send(res, 400, { ok: false, error: 'bad url' }); }
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // 远程数据可视化面板（无需登录）
  if (req.method === 'GET' && (p === '/' || p === '/dashboard' || p === '/index.html')) {
    if (!dashboardHtml) {
      try { dashboardHtml = fs.readFileSync(DASHBOARD_FILE, 'utf8'); } catch (e) { dashboardHtml = ''; }
    }
    if (dashboardHtml) return sendHtml(res, 200, dashboardHtml);
    return sendHtml(res, 500, '<!DOCTYPE html><meta charset="utf-8"><h1>数据面板文件缺失</h1><p>dashboard.html 未找到</p>');
  }

  if (req.method === 'GET' && p === '/health') {
    return send(res, 200, {
      ok: true,
      port: actualPort || DEFAULT_PORT,
      clients: clients.size,
      versions: currentVersionCounts()
    });
  }

  // 启动器上报后读取的在线人数
  if (req.method === 'GET' && p === '/stats') {
    return send(res, 200, Object.assign({ ok: true }, displayTotals(Date.now()), {
      clients: clients.size,
      versions: currentVersionCounts()
    }));
  }

  if (req.method === 'GET' && p === '/api/overview') {
    return send(res, 200, dashboardOverview());
  }

  if (req.method === 'GET' && p === '/api/history') {
    const all = u.searchParams.get('all') === '1';
    let hours = 0;
    let since = 0;
    let points;

    if (all) {
      // 只有主动点「全部历史」才读取 archive；读完不常驻内存
      points = readAllHistory();
    } else {
      hours = Number(u.searchParams.get('hours')) || 24;
      hours = Math.max(1, Math.min(2160, hours));
      since = Date.now() - hours * 3600 * 1000;
      points = history.filter((r) => Number(r.ts) >= since);
    }

    // 最多 720 个点，保证浏览器绘制流畅
    const MAX_POINTS = 720;
    if (points.length > MAX_POINTS) {
      const step = Math.ceil(points.length / MAX_POINTS);
      const sampled = [];
      for (let i = 0; i < points.length; i += step) {
        const group = points.slice(i, i + step);
        const n = group.length || 1;
        const uSum = group.reduce((s, r) => s + (Number(r.uniqueClients) || 0), 0);
        const cSum = group.reduce((s, r) => s + (Number(r.clients) || 0), 0);
        const last = group[group.length - 1];
        sampled.push({
          ts: last.ts,
          uniqueClients: Math.round(uSum / n),
          clients: Math.round(cSum / n),
          fire: last.fire,
          mini: last.mini
        });
      }
      points = sampled;
    }

    return send(res, 200, {
      ok: true,
      scope: all ? 'all' : 'active',
      hours: hours,
      since: since,
      points: points
    });
  }

  if (req.method === 'GET' && p === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && p === '/report') {
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      raw += c;
      if (raw.length > MAX_BODY) tooBig = true;
    });
    req.on('end', () => {
      if (tooBig) return send(res, 413, { ok: false, error: 'body too large' });
      let data;
      try { data = JSON.parse(raw || '{}'); }
      catch (e) { return send(res, 400, { ok: false, error: 'invalid json' }); }

      const id = String(data.id || '').slice(0, 64);
      if (!id) return send(res, 400, { ok: false, error: 'missing id' });

      const version = normalizeVersion(data.version);
      clients.set(id, {
        fire: clampInt(data.fire, 0, 999),
        mini: clampInt(data.mini, 0, 999),
        version: version,
        ts: Date.now()
      });

      // 当前 10 分钟桶记录去重后的客户端 / 版本
      ensureBucket();
      bucketSeen.set(id, version);

      return send(res, 200, Object.assign({ ok: true }, displayTotals(Date.now()), {
        clients: clients.size,
        versions: currentVersionCounts()
      }));
    });
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
}

function startServer() {
  stopServer();
  serverError = '';
  actualPort = 0;

  // 上报接口和数据面板共用 10001：启动器 POST /report，浏览器 GET /
  // 10001 被占用时不再偷偷换 10002，否则启动器仍上报 10001，会统计不到人数。
  const port = DEFAULT_PORT;
  const srv = http.createServer(handleRequest);
  server = srv;

  srv.once('error', (e) => {
    if (server !== srv) return;
    try { srv.close(); } catch (_) {}
    server = null;
    actualPort = 0;
    serverError = (e.code === 'EADDRINUSE')
      ? '端口 10001 已被占用：请先退出旧版在线人数后台，再重启本服务'
      : '端口 10001 启动失败：' + e.message;
    pushState();
  });

  srv.listen(port, '0.0.0.0', () => {
    actualPort = port;
    serverError = '';
    pushState();
  });
}

function stopServer() {
  if (server) {
    try { server.close(); } catch (e) {}
    server = null;
  }
  actualPort = 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, c] of clients) {
    if (now - c.ts > TTL) clients.delete(id);
  }
}, PRUNE_EVERY);

// ---------- 状态推送 ----------
function buildState() {
  const now = Date.now();
  const a = actualTotals();
  const d = displayTotals(now);
  const port = actualPort || DEFAULT_PORT;
  return {
    running: !!server && !serverError,
    error: serverError,
    port: port,
    preferredPort: DEFAULT_PORT,
    dashboardUrl: 'http://127.0.0.1:' + port + '/',
    warning: '',
    clients: a.clients,
    fire: { actual: a.fire, display: d.fire },
    mini: { actual: a.mini, display: d.mini },
    versions: currentVersionCounts(),
    active10m: bucketSeen.size,
    historyCount: history.length,
    virtual: config.virtual,
    now: now
  };
}

function pushState() {
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('state', buildState()); } catch (e) {}
  }
  updateTrayTitle();
}

function updateTrayTitle() {
  if (!tray) return;
  try {
    const s = buildState();
    tray.setToolTip('在线人数后台 · ' + (s.running ? '运行中' : '未运行') +
      ' · 火影 ' + s.fire.display + ' / 4399 ' + s.mini.display);
  } catch (e) {}
}

// ---------- 窗口 / 托盘 ----------
function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(WINDOW_W, width - 40);
  const h = Math.min(WINDOW_H, height - 40);

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 460,
    minHeight: 520,
    title: '在线人数后台',
    backgroundColor: '#f4f7fb',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => pushState());

  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    win.hide();
  });

  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  pushState();
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  try {
    tray = new Tray(icon);
  } catch (e) {
    return;
  }
  tray.setToolTip('在线人数后台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开面板', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showWindow);
}

// ---------- IPC ----------
ipcMain.on('get-state', (event) => {
  event.reply('state', buildState());
});

// 校验同一游戏内的时间段是否重叠（跨天按两段算）
function validateRules(rules) {
  const segs = [];
  for (const r of (rules || [])) {
    const s = timeToMinutes(r.start);
    const e = timeToMinutes(r.end);
    if (s === e) return '开始时间和结束时间不能相同（' + r.start + '）';
    if (s < e) segs.push([[s, e]]);
    else segs.push([[s, 1440], [0, e]]);
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      for (const a of segs[i]) {
        for (const b of segs[j]) {
          if (a[0] < b[1] && b[0] < a[1]) {
            return '第 ' + (i + 1) + ' 条与第 ' + (j + 1) + ' 条时间段重叠';
          }
        }
      }
    }
  }
  return '';
}

ipcMain.handle('save-rules', (event, payload) => {
  const next = normalizeConfig({ port: config.port, virtual: payload });

  let err = validateRules(next.virtual.fire);
  if (err) err = '火影忍者Online：' + err;
  if (!err) {
    const e2 = validateRules(next.virtual.mini);
    if (e2) err = '4399小游戏：' + e2;
  }
  if (err) return { ok: false, error: err, state: buildState() };

  config.virtual = next.virtual;
  const ok = saveConfig();
  pushState();
  return { ok, state: buildState() };
});

ipcMain.handle('restart-server', () => {
  startServer();
  return { ok: !serverError, state: buildState() };
});

// ---------- 启动 ----------
app.whenReady().then(() => {
  loadConfig();
  loadHistory();
  bucketKey = currentBucketKey();
  try { dashboardHtml = fs.readFileSync(DASHBOARD_FILE, 'utf8'); } catch (e) { dashboardHtml = ''; }
  createWindow();
  createTray();
  startServer();
  setInterval(snapshotTick, 15 * 1000);
  setInterval(pushState, 1000);
});

app.on('window-all-closed', () => {
  // 关窗口不退出，留在托盘
});

app.on('before-quit', () => {
  isQuitting = true;
  saveActiveMonths();
  stopServer();
});
