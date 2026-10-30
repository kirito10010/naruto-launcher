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

const CONFIG_DIR = path.join(app.getPath('appData'), 'hyol-online-server');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  port: 10001,
  virtual: { fire: [], mini: [] }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let server = null;
let serverError = '';
let tray = null;
let win = null;
let isQuitting = false;

const clients = new Map();   // id -> { fire, mini, ts }

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

function startServer() {
  stopServer();
  serverError = '';

  server = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && p === '/stats') return send(res, 200, displayTotals(Date.now()));
    if (req.method === 'GET' && (p === '/' || p === '/health')) return send(res, 200, { ok: true });

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

        clients.set(id, {
          fire: clampInt(data.fire, 0, 999),
          mini: clampInt(data.mini, 0, 999),
          ts: Date.now()
        });
        return send(res, 200, Object.assign({ ok: true }, displayTotals(Date.now())));
      });
      return;
    }

    send(res, 404, { ok: false, error: 'not found' });
  });

  server.on('error', (e) => {
    serverError = '端口 ' + config.port + ' 启动失败：' + (e.code === 'EADDRINUSE' ? '已被占用' : e.message);
    pushState();
  });

  server.listen(config.port, '0.0.0.0', () => {
    serverError = '';
    pushState();
  });
}

function stopServer() {
  if (server) {
    try { server.close(); } catch (e) {}
    server = null;
  }
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
  return {
    running: !!server && !serverError,
    error: serverError,
    port: config.port,
    clients: a.clients,
    fire: { actual: a.fire, display: d.fire },
    mini: { actual: a.mini, display: d.mini },
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
  createWindow();
  createTray();
  startServer();
  setInterval(pushState, 1000);
});

app.on('window-all-closed', () => {
  // 关窗口不退出，留在托盘
});

app.on('before-quit', () => { isQuitting = true; stopServer(); });
