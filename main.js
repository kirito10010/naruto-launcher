const { app, BrowserWindow, ipcMain, screen, Tray, nativeImage, dialog, webContents, globalShortcut } = require('electron');
const updater = require('./src/core/updater');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const capture = require('./src/capture/capture');
const online = require('./src/core/online');
const videoCache = require('./src/core/video-cache');
const debugConsole = require('./src/core/debug-console');
const urlTool = require('./src/core/url-tool');

































// 导出模式：由主进程退出时 spawn 的子进程执行（见 before-quit），不建任何窗口
if (process.argv.includes('--export')) {
  const _idx = process.argv.indexOf('--export');
  const _mainPid = parseInt(process.argv[_idx + 1], 10) || 0;
  app.whenReady()
    .then(() => require('./src/export/export').runExport({ mainPid: _mainPid }))
    .catch((e) => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'export-error.log'),
          '[' + new Date().toISOString() + '] ' + (e && e.stack || String(e)) + '\n');
      } catch (_) {}
    })
    // 注意：不能用 app.quit()/app.exit()。等待过程里用过 setTimeout，
    // 走 Electron 的退出流程会在 teardown 阶段崩溃（0xC0000005）；process.exit 直接退出。
    // 延迟 200ms 是为了让 shell.openPath 的打开请求先派发出去。
    .finally(() => setTimeout(() => process.exit(0), 200));
  return;
}

// [全量抓包] 全量抓包导出：由主进程退出时 spawn 的子进程执行（见 before-quit），不建任何窗口
// 与组织统计导出（--export）完全独立；删除本功能时连同 capture-dump.js 一起删掉即可
if (process.argv.includes('--dump-capture')) {
  const _dIdx = process.argv.indexOf('--dump-capture');
  const _dPid = parseInt(process.argv[_dIdx + 1], 10) || 0;
  app.whenReady()
    .then(() => require('./src/capture/capture-dump').runDump({ mainPid: _dPid }))
    .catch((e) => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'capture-dump-error.log'),
          '[' + new Date().toISOString() + '] ' + (e && e.stack || String(e)) + '\n');
      } catch (_) {}
    })
    // 同 --export：避免 Electron 退出流程在 teardown 阶段崩溃
    .finally(() => setTimeout(() => process.exit(0), 200));
  return;
}

// [题库抓包] 题库导出：由主进程退出时 spawn 的子进程执行（见 before-quit），不建任何窗口
// 解析「考官红豆 · 忍者检测」的题目，导出 JSON（题目 / 四个选项 / 正确选项）
if (process.argv.includes('--export-quiz')) {
  const _qIdx = process.argv.indexOf('--export-quiz');
  const _qPid = parseInt(process.argv[_qIdx + 1], 10) || 0;
  app.whenReady()
    .then(() => require('./src/export/quiz-export').runQuizExport({ mainPid: _qPid }))
    .catch((e) => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'quiz-export-error.log'),
          '[' + new Date().toISOString() + '] ' + (e && e.stack || String(e)) + '\n');
      } catch (_) {}
    })
    // 同 --export：避免 Electron 退出流程在 teardown 阶段崩溃
    .finally(() => setTimeout(() => process.exit(0), 200));
  return;
}

// [题库抓包] 喵问答导出：由主进程退出时 spawn 的子进程执行（见 before-quit），不建任何窗口
// 解析「喵问答」的 20 道题 + 配图，导出 JSON 与 images 文件夹
if (process.argv.includes('--export-miao')) {
  const _mIdx = process.argv.indexOf('--export-miao');
  const _mPid = parseInt(process.argv[_mIdx + 1], 10) || 0;
  app.whenReady()
    .then(() => require('./src/export/miao-export').runMiaoExport({ mainPid: _mPid }))
    .catch((e) => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'miao-export-error.log'),
          '[' + new Date().toISOString() + '] ' + (e && e.stack || String(e)) + '\n');
      } catch (_) {}
    })
    // 同 --export：避免 Electron 退出流程在 teardown 阶段崩溃
    .finally(() => setTimeout(() => process.exit(0), 200));
  return;
}

// [商城特惠抓包] 由主进程退出时 spawn 的子进程执行（见 before-quit），不建任何窗口
// 解析商城商品列表（限购 / 折扣价 / 活动时间 / 每个商品当日窗口）+ 从 CDP jsonl 取商品图标
if (process.argv.includes('--export-shop')) {
  const _sIdx = process.argv.indexOf('--export-shop');
  const _sPid = parseInt(process.argv[_sIdx + 1], 10) || 0;
  app.whenReady()
    .then(() => require('./src/export/shop-export').runShopExport({ mainPid: _sPid }))
    .catch((e) => {
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'shop-export-error.log'),
          '[' + new Date().toISOString() + '] ' + (e && e.stack || String(e)) + '\n');
      } catch (_) {}
    })
    // 同 --export：避免 Electron 退出流程在 teardown 阶段崩溃
    .finally(() => setTimeout(() => process.exit(0), 200));
  return;
}

// 单实例锁：只允许一个启动器实例。
// 注意必须在 --export 分支之后（导出子进程要能独立运行，不能被锁拦掉）。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  // 重复启动时，把已有窗口唤到前台（启动器已关闭则重建）
  showLauncherWindow();
});

const DEFAULT_URL = 'https://huoying.qq.com/';
const LOG_FILE = path.join(app.getPath('userData'), 'launcher.log');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const CURRENT_VERSION = app.getVersion();

// Flash 默认版本迁移标记：
// 1.12.1 起默认改成「内置国际版 32」（部分机器用国内版 34 会卡在进游戏）。
// 升级到 1.12.1 时会把所有用户的 flashChoice 强制重置为国际版一次，之后不再强制。
// 注意：这个值不要再改（改成新版本号会导致下次升级又强制重置一次）。
const FLASH_MIGRATION_ID = '1.12.1';
const FLASH_DEFAULT_CHOICE = 'system';   // system = 内置国内版 34.0.0.376（纯净版）
// 1.14.0 一次性重置用户设置：升级后旧设置全部恢复默认，仅此一次。
// 注意：以后发版不要再改这个值，否则会再次强制重置。
const SETTINGS_RESET_ID = '1.14.0';
const DEFAULT_SETTINGS = {
  theme: 'mint',
  tabDisplayMode: 'sidebar',
  lastSpeed: 1,
  diskCache: true,
  flashChoice: FLASH_DEFAULT_CHOICE,
  flashMigrated: FLASH_MIGRATION_ID,
  captureEnabled: false,
  captureMode: 'off',
  forceGpu: true,
  softwareRender: false,
  highPriority: true,
  flashQuality: 'high',
  // 渲染分辨率（固定 16:9）：只决定游戏渲染像素，窗口大小与之无关；默认 1600×900
  renderWidth: 1600,
  renderSizeMigrated: '2.3.1',
  gameOpacity: 1,
  renderDefault: '',
  gameEntry: 'qqgame',
  uiScale: 0,
  settingsResetId: SETTINGS_RESET_ID
};

// 主题单一数据源：启动器界面 + 游戏窗口 + 4399 窗口共用
// bg/panel/... 供启动器 CSS 变量；winBg 供窗口 backgroundColor；
// toolbarBg1/2 + toolbar* 供游戏窗口/4399 窗口工具栏（由 getThemeColors() 统一下发）
const THEMES = {
  mint: {
    name: '薄荷',
    bg: 'linear-gradient(160deg,#d6f5ec 0%,#e6fbf4 100%)',
    winBg: '#ddf3ea',
    panel: 'rgba(255,255,255,0.88)',
    panelBorder: 'rgba(13,148,136,0.20)',
    text: '#1e2a37',
    sub: '#7c8794',
    accent: '#0d9488',
    accent2: '#2dd4bf',
    accentText: '#ffffff',
    hover: 'rgba(13,148,136,0.12)',
    shadow: 'rgba(13,148,136,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#effcf8',
    toolbarBorder: '#cfe9e3',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#c4e2dc',
    toolbarSep: '#d5e9e5'
  },
  sky: {
    name: '天空',
    bg: 'linear-gradient(160deg,#d8e6ff 0%,#eaf2ff 100%)',
    winBg: '#dbe8ff',
    panel: 'rgba(255,255,255,0.88)',
    panelBorder: 'rgba(37,99,235,0.20)',
    text: '#17233a',
    sub: '#7a8699',
    accent: '#2563eb',
    accent2: '#60a5fa',
    accentText: '#ffffff',
    hover: 'rgba(37,99,235,0.12)',
    shadow: 'rgba(37,99,235,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#eef4ff',
    toolbarBorder: '#d3e3fb',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#c6dbf7',
    toolbarSep: '#d8e4f7'
  },
  violet: {
    name: '紫罗兰',
    bg: 'linear-gradient(160deg,#e9e0ff 0%,#f4ecff 100%)',
    winBg: '#eae1ff',
    panel: 'rgba(255,255,255,0.88)',
    panelBorder: 'rgba(109,40,217,0.20)',
    text: '#281c3a',
    sub: '#887a99',
    accent: '#6d28d9',
    accent2: '#a78bfa',
    accentText: '#ffffff',
    hover: 'rgba(109,40,217,0.12)',
    shadow: 'rgba(109,40,217,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#f5f0ff',
    toolbarBorder: '#e0d5f8',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#d5c8f5',
    toolbarSep: '#e2d9f7'
  },
  sakura: {
    name: '樱花',
    bg: 'linear-gradient(160deg,#ffdcec 0%,#ffeaf6 100%)',
    winBg: '#ffdfee',
    panel: 'rgba(255,255,255,0.88)',
    panelBorder: 'rgba(219,39,119,0.20)',
    text: '#3a1e2c',
    sub: '#997d8c',
    accent: '#db2777',
    accent2: '#f472b6',
    accentText: '#ffffff',
    hover: 'rgba(219,39,119,0.12)',
    shadow: 'rgba(219,39,119,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#fff0f7',
    toolbarBorder: '#f7d3e4',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#efc9dc',
    toolbarSep: '#f3d7e6'
  },
  crimson: {
    name: '绯红',
    bg: 'linear-gradient(160deg,#ffd9d9 0%,#ffe9e6 100%)',
    winBg: '#ffdcdc',
    panel: 'rgba(255,255,255,0.90)',
    panelBorder: 'rgba(220,38,38,0.20)',
    text: '#3a1c1c',
    sub: '#9b7c7c',
    accent: '#dc2626',
    accent2: '#fb7185',
    accentText: '#ffffff',
    hover: 'rgba(220,38,38,0.12)',
    shadow: 'rgba(220,38,38,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#fff1ef',
    toolbarBorder: '#f8d2cf',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#f1c7c4',
    toolbarSep: '#f5d8d4'
  },
  amber: {
    name: '暖阳',
    bg: 'linear-gradient(160deg,#fff1c9 0%,#fff6da 100%)',
    winBg: '#fdf0cd',
    panel: 'rgba(255,255,255,0.90)',
    panelBorder: 'rgba(217,119,6,0.22)',
    text: '#3a2c14',
    sub: '#9a8a6d',
    accent: '#d97706',
    accent2: '#fbbf24',
    accentText: '#ffffff',
    hover: 'rgba(217,119,6,0.12)',
    shadow: 'rgba(217,119,6,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#fff8e6',
    toolbarBorder: '#f7e2b8',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#efd6a6',
    toolbarSep: '#f3e3c4'
  },
  forest: {
    name: '森野',
    bg: 'linear-gradient(160deg,#d9f7e0 0%,#eafbe9 100%)',
    winBg: '#dcf7e1',
    panel: 'rgba(255,255,255,0.88)',
    panelBorder: 'rgba(22,163,74,0.20)',
    text: '#1c3323',
    sub: '#7b8f80',
    accent: '#16a34a',
    accent2: '#4ade80',
    accentText: '#ffffff',
    hover: 'rgba(22,163,74,0.12)',
    shadow: 'rgba(22,163,74,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#f1fcf3',
    toolbarBorder: '#d3ecd7',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#c6e6cb',
    toolbarSep: '#d9ecd9'
  },
  mocha: {
    name: '摩卡',
    bg: 'linear-gradient(160deg,#f1e2cd 0%,#f8efe1 100%)',
    winBg: '#f1e4d0',
    panel: 'rgba(255,255,255,0.90)',
    panelBorder: 'rgba(120,53,15,0.22)',
    text: '#372a1c',
    sub: '#94836f',
    accent: '#92400e',
    accent2: '#d97706',
    accentText: '#ffffff',
    hover: 'rgba(120,53,15,0.12)',
    shadow: 'rgba(120,53,15,0.25)',
    toolbarBg1: '#ffffff',
    toolbarBg2: '#faf3e8',
    toolbarBorder: '#e9d9bf',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#ddc9a8',
    toolbarSep: '#ebdcc6'
  },
  night: {
    name: '暗夜',
    bg: 'linear-gradient(160deg,#0b1220 0%,#0e1a2e 100%)',
    winBg: '#0b1220',
    panel: 'rgba(255,255,255,0.06)',
    panelBorder: 'rgba(56,189,248,0.18)',
    text: '#e6edf3',
    sub: '#8b97a6',
    accent: '#38bdf8',
    accent2: '#22d3ee',
    accentText: '#04231f',
    hover: 'rgba(56,189,248,0.14)',
    shadow: 'rgba(0,0,0,0.5)',
    toolbarBg1: '#101a2b',
    toolbarBg2: '#0c1424',
    toolbarBorder: '#1d2c44',
    toolbarBtn: '#152238',
    toolbarBtnBorder: '#24354f',
    toolbarSep: '#1d2c44'
  },
  graphite: {
    name: '石墨',
    bg: 'linear-gradient(160deg,#191919 0%,#131313 100%)',
    winBg: '#191919',
    panel: 'rgba(255,255,255,0.06)',
    panelBorder: 'rgba(255,255,255,0.12)',
    text: '#e5e5e5',
    sub: '#9a9a9a',
    accent: '#d4d4d8',
    accent2: '#a1a1aa',
    accentText: '#111111',
    hover: 'rgba(212,212,216,0.14)',
    shadow: 'rgba(0,0,0,0.5)',
    toolbarBg1: '#202020',
    toolbarBg2: '#171717',
    toolbarBorder: '#333333',
    toolbarBtn: '#252525',
    toolbarBtnBorder: '#3a3a3a',
    toolbarSep: '#333333'
  }
};
// 旧主题 key 迁移
const THEME_ALIAS = { light: 'mint', blue: 'sky', orange: 'amber', dark: 'night' };
function normalizeTheme(t) {
  t = THEME_ALIAS[t] || t;
  return THEMES[t] ? t : 'mint';
}

// 抓包开关：必须在 app ready 之前判定（net-log 需提前设置命令行开关）
function readConfigSync() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      // 1.14.0 一次性重置：旧设置不参与本次启动的抓包 / GPU / 软件渲染判定
      if (cfg.settingsResetId !== SETTINGS_RESET_ID) return {};
      return cfg;
    }
  } catch (e) {
    // 忽略，使用默认
  }
  return {};
}
const EARLY_CONFIG = readConfigSync();

// 抓包模式：off（关闭）/ stats（组织统计 → 生成 Excel）/ full（全量抓包 → 导出原始文件）
//           / quiz（题库抓包 → 解析「考官红豆·忍者检测」题目，导出 JSON）
//           / miao（题库抓包 → 解析「喵问答」题目 + 配图，导出 JSON）
//           / shop（商城特惠抓包 → 商品/限购/折扣价/时间范围 + 商品图片，导出 JSON）
function normalizeCaptureMode(v) {
  if (v === 'off' || v === 'stats' || v === 'full' || v === 'quiz' || v === 'miao' || v === 'shop') return v;
  return v === true ? 'stats' : 'off';   // 兼容老的 captureEnabled: true
}

// 游戏画面画质：high（抗锯齿，默认）/ medium / low（关闭抗锯齿，文字更锐利）
function normalizeFlashQuality(v) {
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return 'high';
}

// preload 只能保证主 frame；QQ 游戏大厅入口把游戏放在 iframe 里，
// 这里用 CDP 把同一份补丁注入 guest 的每个新文档（含子 frame）。
function flashQualityPatchSource(quality) {
  if (quality !== 'low' && quality !== 'medium') return '';
  const file = quality === 'low' ? 'flash-quality-low-preload.js' : 'flash-quality-medium-preload.js';
  try {
    return fs.readFileSync(path.join(__dirname, 'src', 'ui', file), 'utf8');
  } catch (e) {
    return '';
  }
}

function attachFlashQualityPatch(wc) {
  if (!wc || wc.isDestroyed()) return;
  const quality = normalizeFlashQuality(config.flashQuality);
  const source = flashQualityPatchSource(quality);
  if (!source) return;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const pending = wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (e) {
    log('[quality] CDP 注入失败: ' + e.message, 'WARN');
  }
}

// 游戏入口：official（官网）/ qqgame（QQ 游戏大厅 app_frame）
function normalizeGameEntry(v) {
  return v === 'qqgame' ? 'qqgame' : 'official';
}

// 渲染分辨率配置（固定 16:9）
// 分辨率只决定游戏渲染像素（越低越省性能），渲染层再缩放到窗口铺满。
// 游戏本身最大只到 1920×1080；只保留 5 个常用档位，从高到低排列。
const RENDER_WIDTHS = [1920, 1600, 1440, 1280];
const RENDER_MIGRATION_ID = '2.3.1';

function normalizeRenderWidth(v) {
  const n = parseInt(v, 10);
  return RENDER_WIDTHS.indexOf(n) >= 0 ? n : 1600;
}

// 游戏窗口透明度：0.1 ~ 1（100% = 不透明）
function normalizeGameOpacity(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1;
  return Math.max(0.1, Math.min(1, n));
}

// 统一设置所有游戏窗口透明度（滑杆 / Ctrl+←→ 都走这里）
function applyGameOpacity(pct) {
  const op = normalizeGameOpacity(Number(pct) / 100);
  config.gameOpacity = op;
  saveConfig();
  const pctRound = Math.round(op * 100);
  gameWindows.forEach((gw) => {
    if (!gw || !gameWinAlive(gw.win)) return;
    try { gw.win.setOpacity(op); } catch (e) { /* ignore */ }
    try { gw.win.webContents.send('opacity-state', pctRound); } catch (e) { /* ignore */ }
  });
  return op;
}

function renderHeightOf(w) {
  return Math.round((Number(w) || 1920) * 9 / 16);
}

function getRenderConfig() {
  const w = normalizeRenderWidth(config.renderWidth);
  return {
    width: w,
    height: renderHeightOf(w),
    options: RENDER_WIDTHS.map(function (x) { return { w: x, h: renderHeightOf(x) }; })
  };
}
const CAPTURE_MODE =
  process.argv.includes('--capture-full') ? 'full' :
  process.argv.includes('--capture-miao') ? 'miao' :
  (process.argv.includes('--capture-traffic') || process.env.NARUTO_CAPTURE === '1') ? 'stats' :
  normalizeCaptureMode(
    EARLY_CONFIG.captureMode !== undefined ? EARLY_CONFIG.captureMode : EARLY_CONFIG.captureEnabled
  );

let launcherWindow = null;
let gameWindows = [];
let lastGameWin = null;
const bossHiddenWindows = new Set();

function gameWinAlive(w) {
  return !!(w && !w.isDestroyed());
}

// 老板键：先还原被隐藏的游戏窗口；没有隐藏窗口时，隐藏当前 / 最后一个游戏窗口
function toggleBossKey(explicitWin) {
  for (const g of gameWindows) {
    if (gameWinAlive(g.win) && bossHiddenWindows.has(g.win.id)) {
      bossHiddenWindows.delete(g.win.id);
      try { g.win.show(); g.win.focus(); } catch (e) { /* ignore */ }
      return;
    }
  }
  let target = gameWinAlive(explicitWin) ? explicitWin : null;
  if (!target) {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && gameWindows.some((g) => g.win === focused)) target = focused;
  }
  if (!target && gameWinAlive(lastGameWin)) target = lastGameWin;
  if (!target) target = gameWindows.map((g) => g.win).find(gameWinAlive) || null;
  if (!target) return;
  try {
    bossHiddenWindows.add(target.id);
    target.hide();
    lastGameWin = target;
  } catch (e) { /* ignore */ }
}
// 窗口槽位：本次运行内按窗口创建顺序单调递增（1 起），用于生成互不冲突的会话分区名
let gameWindowSlotCounter = 0;
let tray = null;
let isQuitting = false;

let logBuffer = [];
const MAX_LOG_BUFFER = 10;
const MAX_LOG_FILE_SIZE = 1024 * 1024 * 5;

let speedctlPath = '';
let speedhookPath = '';
let currentSpeedRate = 1;
let injectedPids = new Set();
// 游戏页面（webview guest / BrowserView）的 webContents，切倍率时按需补注
const gameContents = new Set();

let currentTheme = 'mint';
let isAudioMuted = false;

let config = Object.assign({}, DEFAULT_SETTINGS);

// 游戏优先：把本应用的 Browser / 渲染 / GPU / Flash 插件进程设为高优先级。
// 只用到 HIGH（非 Realtime），避免抢占系统输入、音频导致假死。
function applyProcessPriority() {
  if (process.platform !== 'win32' || typeof os.setPriority !== 'function') return;
  const priority = (config.highPriority !== false)
    ? (os.constants.priority && os.constants.priority.PRIORITY_HIGH) || -14
    : (os.constants.priority && os.constants.priority.PRIORITY_NORMAL) || 0;
  const pids = new Set();
  try { pids.add(process.pid); } catch (e) {}
  try {
    app.getAppMetrics().forEach((m) => { if (m && m.pid) pids.add(m.pid); });
  } catch (e) { /* ignore */ }
  for (const pid of pids) {
    try { os.setPriority(pid, priority); } catch (e) { /* 进程可能已退出/无权限 */ }
  }
}

const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
const ACCOUNTS_ENC_FILE = path.join(app.getPath('userData'), 'accounts.dat');
const ACCOUNTS_MAGIC = 'HYOL-ACC-1:';
let accounts = [];
let accountsLoaded = false;
// 解密失败时锁住写入：避免用空列表覆盖掉原文件（可能只是系统组件临时不可用）
let accountsStorageLocked = false;
let accountStorageErrorShown = false;
// 异步保存：合并连续写入，避免每次登录抓取都同步阻塞主进程
let accountSaveTimer = null;
let accountSaveRunning = false;
let accountSavePending = null;

// ========== 账号加密存储（Windows DPAPI） ==========
// Electron 11 没有 safeStorage，且项目不允许引入原生模块，
// 这里用系统自带 DPAPI（CurrentUser 作用域）通过 PowerShell 加解密。
// 注意：stdin/stdout 一律按原始字节读写。PowerShell 的 [Console]::In/Out
// 会按系统控制台代码页（中文 Windows 是 GBK）处理，中文会被写坏。
const DPAPI_ENC_PS = [
  'Add-Type -AssemblyName System.Security',
  '$stdin = [Console]::OpenStandardInput()',
  '$ms = New-Object System.IO.MemoryStream',
  '$stdin.CopyTo($ms)',
  '$e = [Security.Cryptography.ProtectedData]::Protect($ms.ToArray(), $null, \'CurrentUser\')',
  '$out = [Console]::OpenStandardOutput()',
  '$bytes = [Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($e))',
  '$out.Write($bytes, 0, $bytes.Length)',
  '$out.Flush()'
].join('; ');

const DPAPI_DEC_PS = [
  'Add-Type -AssemblyName System.Security',
  '$stdin = [Console]::OpenStandardInput()',
  '$ms = New-Object System.IO.MemoryStream',
  '$stdin.CopyTo($ms)',
  '$s = [Text.Encoding]::ASCII.GetString($ms.ToArray()).Trim()',
  '$e = [Convert]::FromBase64String($s)',
  '$b = [Security.Cryptography.ProtectedData]::Unprotect($e, $null, \'CurrentUser\')',
  '$out = [Console]::OpenStandardOutput()',
  '$out.Write($b, 0, $b.Length)',
  '$out.Flush()'
].join('; ');

function dpapiRun(script, input) {
  if (process.platform !== 'win32') throw new Error('DPAPI 仅支持 Windows');
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { input, encoding: null, windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const errText = r.stderr ? r.stderr.toString('utf8').trim() : '';
    throw new Error(errText || ('powershell 退出码 ' + r.status));
  }
  return r.stdout ? r.stdout.toString('utf8') : '';
}

function dpapiProtect(text) {
  return dpapiRun(DPAPI_ENC_PS, text);
}

function dpapiUnprotect(base64) {
  return dpapiRun(DPAPI_DEC_PS, base64);
}

// 异步加密：账号保存不再阻塞主进程（同步跑 PowerShell 约 0.3~0.6 秒）
function dpapiProtectAsync(text) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { reject(new Error('DPAPI 仅支持 Windows')); return; }
    const child = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DPAPI_ENC_PS],
      { windowsHide: true });
    const out = [];
    const err = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (e) { /* ignore */ }
      reject(new Error('DPAPI 加密超时'));
    }, 20000);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString('utf8').trim() || ('powershell 退出码 ' + code)));
        return;
      }
      resolve(Buffer.concat(out).toString('utf8'));
    });
    child.stdin.on('error', () => { /* ignore */ });
    child.stdin.end(Buffer.from(text, 'utf8'));
  });
}

function showAccountStorageErrorOnce(err) {
  if (accountStorageErrorShown) return;
  accountStorageErrorShown = true;
  try {
    dialog.showErrorBox('账号加密保存失败',
      '无法使用 Windows DPAPI 加密账号文件，已退回明文保存（安全性降低）。\n' +
      '请检查安全软件是否拦截了 PowerShell。\n\n' +
      (err && err.message ? err.message : String(err)));
  } catch (e) { /* ignore */ }
}

function readEncryptedAccounts() {
  const raw = fs.readFileSync(ACCOUNTS_ENC_FILE, 'utf8');
  if (raw.indexOf(ACCOUNTS_MAGIC) !== 0) throw new Error('账号文件格式不正确');
  const list = JSON.parse(dpapiUnprotect(raw.slice(ACCOUNTS_MAGIC.length)));
  if (!Array.isArray(list)) throw new Error('账号文件内容不是数组');
  return list;
}

function writeEncryptedRaw(base64) {
  const data = ACCOUNTS_MAGIC + base64;
  const tmp = ACCOUNTS_ENC_FILE + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, ACCOUNTS_ENC_FILE);
}

function writeEncryptedAccounts() {
  writeEncryptedRaw(dpapiProtect(JSON.stringify(accounts, null, 2)));
}

function removePlaintextAccounts() {
  [ACCOUNTS_FILE, ACCOUNTS_FILE + '.bak'].forEach((file) => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        log('已删除明文账号文件: ' + path.basename(file));
      }
    } catch (e) {
      log('删除明文账号文件失败: ' + e.message, 'WARN');
    }
  });
}

function loadAccounts(force) {
  if (accountsLoaded && !force) return;
  accountsLoaded = false;
  // 强制重读时复位保护状态：用户可能已经删掉损坏的 accounts.dat
  accountsStorageLocked = false;
  try {
    if (fs.existsSync(ACCOUNTS_ENC_FILE)) {
      try {
        accounts = readEncryptedAccounts();
        accountsLoaded = true;
        migrateAccountsByZone();
        sanitizeCredentials();
        // 加密文件已经可用，顺手清掉历史遗留的明文文件
        removePlaintextAccounts();
        log(`账号已加载: ${accounts.length} 个（加密文件）`);
        return;
      } catch (e) {
        log('解密账号文件失败: ' + e.message, 'ERROR');
        accountsStorageLocked = true;
        accounts = [];
        // 保留原文件，另存一份现场用于排查，绝不覆盖
        try { fs.copyFileSync(ACCOUNTS_ENC_FILE, ACCOUNTS_ENC_FILE + '.corrupt'); } catch (_) { /* ignore */ }
        try {
          dialog.showErrorBox('账号文件无法解密',
            '账号文件无法解密，可能是系统组件暂时不可用，或文件来自其他电脑 / 其他 Windows 账号。\n\n' +
            '为避免覆盖数据，本次启动不会写入账号文件。\n' +
            '如需重新开始，可先备份后删除 accounts.dat。\n\n' + e.message);
        } catch (_) { /* ignore */ }
      }
    }

    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      accounts = JSON.parse(data);
      migrateAccountsByZone();
      sanitizeCredentials();
      accountsLoaded = true;
      // 加密迁移失败不能把已解析出来的账号丢掉：继续用明文文件跑，只提示一次
      try {
        writeEncryptedAccounts();
        const verify = readEncryptedAccounts();
        if (JSON.stringify(verify) !== JSON.stringify(accounts)) {
          throw new Error('加密文件回读校验不一致');
        }
        removePlaintextAccounts();
        log(`账号已迁移到加密存储: ${accounts.length} 个`);
      } catch (e) {
        log('迁移到加密存储失败，继续使用明文账号文件: ' + e.message, 'ERROR');
        showAccountStorageErrorOnce(e);
      }
      return;
    }

    if (!accounts.length) log('账号文件不存在，使用空列表');
    accountsLoaded = true;
  } catch (e) {
    log('加载账号失败: ' + e.message, 'WARN');
    accounts = [];
  }
}

// 账号按「QQ + 区服」拆分保存：
// 老数据里一个 QQ 的多个区在 credentials 映射里，这里拆成多条账号，
// 每条只保留一个 credential。拆分后没有 credentials，重复启动不会再次拆分。
function migrateAccountsByZone() {
  let changed = false;
  const before = accounts.length;
  const seenIds = Object.create(null);
  const nextId = (base, zoneKey, primary) => {
    let id = primary ? String(base || '') : (String(base || '') + '-z-' + String(zoneKey || 'default'));
    if (!id) id = 'account-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    let unique = id;
    let n = 2;
    while (seenIds[unique]) { unique = id + '-' + n; n++; }
    seenIds[unique] = true;
    return unique;
  };

  const out = [];
  for (const a of accounts) {
    if (!a || !a.qq) { if (a) { if (a.id) seenIds[String(a.id)] = true; out.push(a); } continue; }
    const map = (a.credentials && typeof a.credentials === 'object' && !Array.isArray(a.credentials))
      ? a.credentials : null;
    const byZone = Object.create(null);
    if (map) {
      Object.keys(map).forEach((k) => {
        const c = map[k];
        if (!c || !(c.login_url || c.zone_id || c.zone_name)) return;
        const zk = String(c.zone_id || k || 'default');
        const old = byZone[zk];
        // 同区同时有“已清空占位”和真实凭证时，优先保留真实凭证
        if (!old || (!old.login_url && c.login_url)) byZone[zk] = c;
      });
    }
    const legacy = a.credential;
    if (legacy && (legacy.login_url || legacy.zone_id || legacy.zone_name)) {
      const zk = String(legacy.zone_id || 'default');
      const old = byZone[zk];
      if (!old || (!old.login_url && legacy.login_url)) byZone[zk] = legacy;
    }
    const zones = Object.keys(byZone).map((k) => byZone[k]);

    if (zones.length <= 1) {
      const entry = Object.assign({}, a);
      delete entry.credentials;
      if (zones.length === 1) {
        entry.credential = zones[0];
        entry.lastZoneId = String(zones[0].zone_id || 'default');
      } else {
        delete entry.credential;
        entry.lastZoneId = '';
      }
      entry.id = nextId(a.id, entry.lastZoneId || 'default', true);
      out.push(entry);
      if (map) changed = true;
      continue;
    }

    // 多区：原 ID 留给第一个区，其余区生成独立 ID
    zones.forEach((cred, idx) => {
      const zk = String(cred.zone_id || 'default');
      const entry = Object.assign({}, a, { credential: cred, lastZoneId: zk });
      delete entry.credentials;
      entry.id = nextId(a.id, zk, idx === 0);
      out.push(entry);
    });
    changed = true;
  }

  if (out.length !== accounts.length) changed = true;
  accounts = out;
  if (changed) {
    try {
      if (fs.existsSync(ACCOUNTS_ENC_FILE)) fs.copyFileSync(ACCOUNTS_ENC_FILE, ACCOUNTS_ENC_FILE + '.bak');
    } catch (e) { /* ignore */ }
    saveAccounts();
    log('账号多区整理: ' + before + ' -> ' + accounts.length);
  }
}

// 清理历史串号凭证：uin 不一致、skey 属于别的 QQ 的，清空该条凭证，回退账号密码登录
function sanitizeCredentials() {
  let changed = false;
  const skeyOwner = new Map();
  accounts.forEach((a) => {
    const c = a && a.credential;
    if (c && c.skey) skeyOwner.set(String(c.skey), String(a.qq || '').replace(/\D/g, ''));
  });
  accounts.forEach((a) => {
    const c = a && a.credential;
    if (!c || !c.login_url) return;
    const expected = normalizeUinValue(c.uin) || normalizeUinValue(a.qq);
    if (c.skey && skeyOwner.has(String(c.skey))) {
      const owner = skeyOwner.get(String(c.skey));
      if (owner && expected && owner !== String(expected)) {
        log('[credential] 清理串号凭证: ' + a.qq + ' 区服=' + (c.zone_id || '-'), 'WARN');
        a.credential = {
          zone_id: c.zone_id || '',
          zone_name: c.zone_name || '',
          login_url: '',
          skey: '',
          cookies: [],
          expires_at: '',
          captured_at: ''
        };
        a.lastZoneId = String(c.zone_id || 'default');
        changed = true;
        return;
      }
    }
    const list = Array.isArray(c.cookies) ? c.cookies : [];
    const kept = list.filter((k) => {
      if (!k || !k.name || !k.value) return false;
      if (/^(uin|p_uin|ptui_loginuin|luin|pt2gguin)$/i.test(k.name)) {
        const v = normalizeUinValue(k.value);
        if (v && expected && v !== expected) return false;
      }
      if ((k.name === 'skey' || k.name === 'p_skey') && skeyOwner.has(String(k.value))) {
        const owner = skeyOwner.get(String(k.value));
        if (owner && expected && owner !== String(expected) && k.value !== c.skey) return false;
      }
      return true;
    });
    if (kept.length !== list.length) {
      c.cookies = kept;
      changed = true;
    }
    const skeyCookie = (c.cookies || []).find((k) => k && k.name === 'skey' && /huoying\.qq\.com$/i.test(k.domain || ''));
    if (c.skey && skeyCookie && skeyCookie.value !== c.skey) {
      skeyCookie.value = c.skey;
      changed = true;
    }
  });
  if (changed) saveAccounts();
}

function saveAccounts() {
  if (accountsStorageLocked) {
    log('账号文件处于保护状态（解密失败），本次不写入', 'WARN');
    return;
  }
  accountSavePending = JSON.stringify(accounts, null, 2);
  if (accountSaveTimer) clearTimeout(accountSaveTimer);
  accountSaveTimer = setTimeout(() => {
    accountSaveTimer = null;
    drainAccountSave();
  }, 250);
}

function fallbackPlaintextSave() {
  // 加密不可用时宁可降级明文，也不能让用户的账号改动凭空消失。
  // 先把旧加密文件挪开，否则下次启动仍会优先读它，导致这次改动丢失。
  try {
    if (fs.existsSync(ACCOUNTS_ENC_FILE)) {
      fs.renameSync(ACCOUNTS_ENC_FILE, ACCOUNTS_ENC_FILE + '.stale');
    }
  } catch (e) { /* ignore */ }
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
    accountsLoaded = true;
    log('账号已明文保存: ' + ACCOUNTS_FILE, 'WARN');
  } catch (e2) {
    log('明文保存账号也失败: ' + e2.message, 'ERROR');
  }
}

function drainAccountSave() {
  if (accountSaveRunning || accountSavePending == null) return;
  const plain = accountSavePending;
  accountSavePending = null;
  accountSaveRunning = true;
  dpapiProtectAsync(plain).then((base64) => {
    // 退出流程会走同步落盘，异步结果直接丢弃，避免覆盖更新的数据
    if (isQuitting) return;
    writeEncryptedRaw(base64);
    accountsLoaded = true;
    log(`账号已加密保存: ${accounts.length} 个`);
  }).catch((e) => {
    if (isQuitting) return;
    log('加密保存账号失败，退回明文保存: ' + e.message, 'ERROR');
    fallbackPlaintextSave();
    showAccountStorageErrorOnce(e);
  }).then(() => {
    accountSaveRunning = false;
    if (accountSavePending != null) drainAccountSave();
  });
}

// 退出前必须同步落盘，异步 PowerShell 可能来不及完成
function flushAccountSaveSync() {
  if (accountSaveTimer) {
    clearTimeout(accountSaveTimer);
    accountSaveTimer = null;
  }
  const hadPending = accountSavePending != null || accountSaveRunning;
  accountSavePending = null;
  if (!hadPending) return;
  try {
    writeEncryptedAccounts();
    accountsLoaded = true;
    log(`账号已加密保存（退出前）: ${accounts.length} 个`);
  } catch (e) {
    log('退出前加密保存失败，退回明文: ' + e.message, 'WARN');
    fallbackPlaintextSave();
  }
}

function addAccount(qq, password, windowName) {
  const account = {
    id: 'account-' + Date.now(),
    qq: qq,
    qqPwd: password || '',
    windowName: windowName || ''
  };
  accounts.push(account);
  saveAccounts();
  return account;
}

function removeAccount(accountId) {
  accounts = accounts.filter(a => a.id !== accountId);
  saveAccounts();
}

function updateAccount(accountId, qq, password, windowName) {
  const account = accounts.find(a => a.id === accountId);
  if (account) {
    if (qq && String(account.qq) !== String(qq)) {
      delete account.credential;
      delete account.credentials;
      account.lastZoneId = '';
    }
    if (qq) account.qq = qq;
    if (password !== undefined) account.qqPwd = password;
    if (windowName !== undefined) account.windowName = windowName;
    saveAccounts();
    return true;
  }
  return false;
}

// ========== 账号凭证（skey 直连，借鉴 GameLauncher） ==========
const QQGAME_ENTRY_URL = 'https://minigame.qq.com/plat/social_hall/app_frame/?appid=10190';
const CREDENTIAL_COOKIE_NAMES = [
  'skey', 'uin', 'p_uin', 'p_skey', 'pt2gguin', 'luin', 'ptui_loginuin',
  'openid', 'access_token', 'openkey', 'pf', 'pfkey'
];

function normalizeUinValue(raw) {
  if (!raw) return 0;
  const s = String(raw).replace(/^o0*/, '').replace(/\D/g, '');
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

function parseZoneFromUrl(url) {
  let zoneId = '';
  let zoneName = '';
  try {
    const q = String(url || '');
    const idm = /[?&]sServerID=(\d+)/i.exec(q);
    if (idm) zoneId = idm[1];
    const nm = /[?&]sServerName=([^&]*)/i.exec(q);
    if (nm) {
      try { zoneName = decodeURIComponent(nm[1].replace(/\+/g, ' ')); } catch (e) { zoneName = nm[1]; }
    }
  } catch (e) { /* ignore */ }
  return { zone_id: zoneId, zone_name: zoneName };
}

function isCredentialUsable(cred) {
  if (!cred || !cred.skey || !cred.login_url) return false;
  if (!cred.expires_at) return true;
  const t = new Date(cred.expires_at).getTime();
  return isFinite(t) ? t > Date.now() : true;
}


// 多区服凭证：一个 QQ 可保存多个区的 credential
function getAccountZones(account) {
  if (!account) return [];
  const map = account.credentials && typeof account.credentials === 'object' ? account.credentials : {};
  const list = Object.keys(map).map((k) => map[k]).filter((c) => c && (c.login_url || c.zone_id || c.zone_name));
  if (!list.length && account.credential && account.credential.login_url) list.push(account.credential);
  return list;
}

function resolveAccountZoneId(account, zoneId) {
  if (!account) return '';
  const map = account.credentials && typeof account.credentials === 'object' ? account.credentials : {};
  if (zoneId && map[String(zoneId)]) return String(zoneId);
  if (account.lastZoneId && map[String(account.lastZoneId)]) return String(account.lastZoneId);
  if (account.credential) {
    const z = account.credential.zone_id ? String(account.credential.zone_id) : '';
    if (z && map[z]) return z;
    if (!z && map.default) return 'default';
  }
  const keys = Object.keys(map);
  if (keys.length) return keys[0];
  // 拆分后的账号没有 credentials 映射，直接取单凭证的区服
  if (account.credential) return account.credential.zone_id ? String(account.credential.zone_id) : 'default';
  return '';
}

function pickAccountCredential(account, zoneId) {
  if (!account) return null;
  const map = account.credentials && typeof account.credentials === 'object' ? account.credentials : {};
  const key = resolveAccountZoneId(account, zoneId);
  if (key && map[key]) return map[key].login_url ? map[key] : null;
  if (account.credential && account.credential.login_url) return account.credential;
  const zones = getAccountZones(account);
  return zones.length ? zones[0] : null;
}

function pickAccountForZone(account, zoneId) {
  if (!account) return null;
  const key = resolveAccountZoneId(account, zoneId);
  const copy = Object.assign({}, account, { credential: pickAccountCredential(account, key) });
  if (key) copy._selectedZoneId = key;
  return copy;
}

function accountLabelForZone(account, zoneId) {
  if (!account) return '窗口';
  const base = account.windowName || account.qq;
  const cred = pickAccountCredential(account, zoneId);
  const zoneName = cred && (cred.zone_name || cred.zone_id);
  return zoneName ? (base + ' · ' + zoneName) : base;
}

function broadcastAccountsChanged() {
  for (const gw of gameWindows) {
    try {
      if (gw && gw.win && !gw.win.isDestroyed()) gw.win.webContents.send('accounts-changed');
    } catch (e) { /* ignore */ }
  }
}

// 进入 main.html?sServerID= 之后，从该窗口分区里抓 skey 存成账号凭证
async function captureCredentialFromGuest(guest, url) {
  try {
    if (!guest || guest.isDestroyed()) return;
    const ses = guest.session;
    const cookies = await ses.cookies.get({});
    const skey = cookies.find((c) => c.name === 'skey' && c.value);
    if (!skey) return;
    const uinCookie = cookies.find((c) => ['uin', 'p_uin', 'ptui_loginuin', 'luin'].indexOf(c.name) >= 0 && c.value);
    const uin = normalizeUinValue(uinCookie && uinCookie.value);
    if (!uin) return;

    // skey 经常是会话型 cookie（没有 expirationDate），此时不编造到期时间，
    // 只记录“已保存”，由下次进区自动续期覆盖。
    const hasExpiry = !!skey.expirationDate;
    const expiresAt = hasExpiry ? Math.round(skey.expirationDate * 1000) : 0;
    const keep = cookies
      .filter((c) => CREDENTIAL_COOKIE_NAMES.indexOf(c.name) >= 0 && c.value &&
        /(^|\.)(qq|huoying\.qq|ptlogin2\.qq)\.com$/i.test(c.domain || ''))
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expirationDate: c.expirationDate || 0
      }));
    // uin 类 cookie 与本次抓到的 QQ 不一致 → 分区里残留了别的账号，丢弃
    try {
      for (let i = keep.length - 1; i >= 0; i--) {
        const c = keep[i];
        if (/^(uin|p_uin|ptui_loginuin|luin|pt2gguin)$/i.test(c.name)) {
          const v = normalizeUinValue(c.value);
          if (v && uin && v !== uin) {
            log('[credential] 丢弃不匹配的 uin cookie: ' + c.name + '=' + c.value, 'WARN');
            keep.splice(i, 1);
          }
        }
      }
    } catch (e) { /* ignore */ }
    // 防跨账号污染：同一个分区先后登过 A、B 时，A 的票据会残留在 cookie 里，
    // 被当成 B 的凭证存下来。skey / p_skey 只要值属于其他账号、又不是本次抓到的 skey，就丢弃。
    try {
      const foreignTickets = new Set();
      accounts.forEach((a) => {
        if (!a || String(a.qq || '').replace(/\D/g, '') === String(uin)) return;
        const c = a.credential;
        if (c && c.skey) foreignTickets.add(c.skey);
      });
      if (foreignTickets.size) {
        for (let i = keep.length - 1; i >= 0; i--) {
          const c = keep[i];
          const isTicket = c.name === 'skey' || c.name === 'p_skey';
          if (isTicket && c.value !== skey.value && foreignTickets.has(c.value)) {
            log('[credential] 丢弃跨账号票据: ' + c.name + '@' + c.domain, 'WARN');
            keep.splice(i, 1);
          }
        }
      }
    } catch (e) { /* ignore */ }
    const zone = parseZoneFromUrl(url);
    const now = new Date().toISOString();
    const credential = {
      uin: uin,
      skey: skey.value,
      cookies: keep,
      login_url: url,
      zone_id: zone.zone_id,
      zone_name: zone.zone_name,
      expires_at: hasExpiry ? new Date(expiresAt).toISOString() : '',
      expires_source: hasExpiry ? 'cookie' : 'unknown',
      captured_at: now,
      last_ok_at: now,
      expired_at: ''
    };
    const zoneKey = String(zone.zone_id || 'default');

    // 账号按「QQ + 区服」拆分保存：同 QQ 不同区各占一条，一键启动才能全部拉起
    const qqKey = String(uin);
    const sameQQ = (a) => a && String(a.qq || '').replace(/\D/g, '') === qqKey;
    let account = accounts.find((a) => sameQQ(a) && a.credential &&
      String(a.credential.zone_id || 'default') === zoneKey);
    let autoCreated = false;
    if (!account) {
      // 只复用完全空白的手动账号；已清空凭证的占位条目属于它自己的区，不能被别的区覆盖
      account = accounts.find((a) => sameQQ(a) && !a.credential);
    }
    if (!account) {
      account = {
        id: 'account-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        qq: qqKey,
        qqPwd: '',
        windowName: '',
        autoSaved: true
      };
      accounts.push(account);
      autoCreated = true;
    }
    account.credential = credential;
    account.lastZoneId = zoneKey;
    delete account.credentials;
    saveAccounts();
    broadcastAccountsChanged();
    log('[credential] ' + (autoCreated ? '已自动保存新账号: ' : '已保存账号凭证: ') + account.qq + ' 区服=' + (zone.zone_name || zone.zone_id || '-'));
  } catch (e) {
    log('[credential] 抓取失败: ' + e.message, 'WARN');
  }
}

function attachCredentialCapture(guest) {
  if (!guest || guest.isDestroyed()) return;
  let lastUrl = '';
  const onUrl = (url) => {
    if (!url || url === lastUrl) return;
    if (/^https:\/\/game\.huoying\.qq\.com\/main\.html/i.test(url) && /sServerID=\d+/i.test(url)) {
      lastUrl = url;
      // 等 cookie 落盘后再抓
      setTimeout(() => {
        if (guest && !guest.isDestroyed()) captureCredentialFromGuest(guest, url);
      }, 1500);
    }
  };
  guest.on('did-navigate', (e, url) => onUrl(url));
  guest.on('did-navigate-in-page', (e, url, isMainFrame) => { if (isMainFrame !== false) onUrl(url); });
  guest.on('did-frame-navigate', (e, url) => onUrl(url));
}

// 把凭证里的 cookie 原样写回指定分区
ipcMain.handle('apply-credential', async (event, partition, cred) => {
  if (!partition || !cred || !cred.login_url) return false;
  const ses = require('electron').session.fromPartition(partition);
  // 没有真实到期时间就写成会话 cookie，不再伪造 7 天
  const expSec = cred.expires_at ? Math.round(new Date(cred.expires_at).getTime() / 1000) : 0;
  const expectedUin = normalizeUinValue(cred.uin);
  const list = Array.isArray(cred.cookies) ? cred.cookies : [];
  let written = 0;
  let hasSkeyOnHuoying = false;
  let hasUin = false;
  let hasPt2gguin = false;
  for (const c of list) {
    if (!c || !c.name || !c.value) continue;
    // 分区可能残留别的账号：skey/uin 只认凭证自己的值，不把旧票据写回去
    if (c.name === 'skey' && cred.skey && c.value !== cred.skey) continue;
    if (/^(uin|p_uin|ptui_loginuin|luin|pt2gguin)$/i.test(c.name)) {
      const v = normalizeUinValue(c.value);
      if (expectedUin && v && v !== expectedUin) continue;
    }
    const domain = c.domain || '.huoying.qq.com';
    const url = /(^|\.)ptlogin2\.qq\.com$/i.test(domain) ? 'https://xui.ptlogin2.qq.com/' : 'https://game.huoying.qq.com/';
    const cookie = {
      url: url,
      name: c.name,
      value: c.value,
      domain: domain,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly
    };
    const exp = c.expirationDate || expSec;
    if (exp) cookie.expirationDate = exp;
    try {
      await ses.cookies.set(cookie);
      written++;
      if (c.name === 'skey' && /(^|\.)huoying\.qq\.com$/i.test(domain) &&
        (!cred.skey || c.value === cred.skey)) hasSkeyOnHuoying = true;
      if (c.name === 'uin' && /(^|\.)huoying\.qq\.com$/i.test(domain)) {
        hasUin = !expectedUin || normalizeUinValue(c.value) === expectedUin;
      }
      if (c.name === 'pt2gguin' && /(^|\.)ptlogin2\.qq\.com$/i.test(domain)) hasPt2gguin = true;
    } catch (e) { /* ignore */ }
  }

  // 兜底：无论 cookie 列表是否完整，都保证游戏域名上有 skey / uin；
  // 再补 pt2gguin（充值页走 xui.ptlogin2.qq.com，缺它会被要求重新登录）。
  const setCookie = async (url, domain, name, value) => {
    const cookie = { url: url, name: name, value: value, domain: domain, path: '/', secure: false, httpOnly: false };
    if (expSec) cookie.expirationDate = expSec;
    try {
      await ses.cookies.set(cookie);
      written++;
      return true;
    } catch (e) {
      return false;
    }
  };
  if (cred.skey && !hasSkeyOnHuoying) {
    await setCookie('https://game.huoying.qq.com/', '.huoying.qq.com', 'skey', cred.skey);
  }
  if (cred.uin && !hasUin) {
    await setCookie('https://game.huoying.qq.com/', '.huoying.qq.com', 'uin', 'o0' + String(cred.uin).padStart(10, '0'));
  }
  if (cred.uin && !hasPt2gguin) {
    await setCookie('https://xui.ptlogin2.qq.com/', '.ptlogin2.qq.com', 'pt2gguin', 'o' + String(cred.uin).padStart(10, '0'));
  }
  // 充值/支付页 SSO：游戏域名的 skey 不一定会带到 .qq.com，
  // 补一份 .qq.com 的登录标记，减少 pay.qq.com 要求重新登录
  if (cred.uin) {
    const padded = String(cred.uin).padStart(10, '0');
    const pick = (name) => {
      const c = list.find((x) => x && x.name === name && x.value);
      return c ? c.value : '';
    };
    const hasQq = (name) => list.some((x) => x && x.name === name && /(^|\.)qq\.com$/i.test(x.domain || ''));
    if (!hasQq('pt2gguin')) await setCookie('https://qq.com/', '.qq.com', 'pt2gguin', pick('pt2gguin') || ('o' + padded));
    if (!hasQq('uin')) await setCookie('https://qq.com/', '.qq.com', 'uin', pick('uin') || ('o0' + padded));
    if (!hasQq('p_uin')) await setCookie('https://qq.com/', '.qq.com', 'p_uin', pick('p_uin') || ('o' + padded));
    if (cred.skey && !hasQq('skey')) await setCookie('https://qq.com/', '.qq.com', 'skey', cred.skey);
    const pSkey = pick('p_skey');
    if (pSkey && !hasQq('p_skey')) await setCookie('https://qq.com/', '.qq.com', 'p_skey', pSkey);
  }
  log('[credential] 注入 cookie: ' + written + ' 条 → ' + partition);
  return written > 0;
});

ipcMain.handle('clear-credential', (event, accountId, zoneId) => {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return false;
  const old = account.credential || {};
  const key = String(zoneId || old.zone_id || 'default');
  // 账号已按区拆分，清除只作用于当前这一条；保留区服占位，卡片不消失
  account.credential = {
    zone_id: old.zone_id || key,
    zone_name: old.zone_name || '',
    login_url: '',
    skey: '',
    cookies: [],
    expires_at: '',
    captured_at: ''
  };
  account.lastZoneId = key;
  delete account.credentials;
  saveAccounts();
  broadcastAccountsChanged();
  log('[credential] 已清除账号凭证: ' + account.qq + ' 区服=' + key);
  return true;
});

ipcMain.on('set-account-zone', (event, accountId, zoneId) => {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;
  const key = String(zoneId || '');
  if (!key) return;
  // 拆分后的账号只有自己这一区，切区不再改凭证，只记录当前区
  if (account.credential && String(account.credential.zone_id || 'default') === key) {
    account.lastZoneId = key;
    saveAccounts();
    broadcastAccountsChanged();
    log('[credential] 账号 ' + account.qq + ' 当前区服: ' + key);
  }
});

// 凭证被判定失效：保留 login_url / cookie / 区服，只打标记，重新登录后抓取会自动清掉
ipcMain.handle('mark-credential-expired', (event, accountId, zoneId) => {
  const account = accounts.find((a) => a.id === accountId);
  if (!account || !account.credential || !account.credential.login_url) return false;
  const key = String(zoneId || account.credential.zone_id || 'default');
  if (String(account.credential.zone_id || 'default') !== key) return false;
  if (account.credential.expired_at) return true;
  account.credential.expired_at = new Date().toISOString();
  saveAccounts();
  broadcastAccountsChanged();
  log('[credential] 标记失效: ' + account.qq + ' 区服=' + key);
  return true;
});

// 1.14.0 一次性重置：把旧配置改写成默认值（保留 clientId，账号/凭证在加密的 accounts.dat）
function resetSettingsIfNeeded() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (parsed.settingsResetId === SETTINGS_RESET_ID) return;
    const fresh = Object.assign({}, DEFAULT_SETTINGS, { settingsResetId: SETTINGS_RESET_ID });
    if (parsed.clientId) fresh.clientId = parsed.clientId;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(fresh, null, 2), 'utf8');
    log(SETTINGS_RESET_ID + ' 一次性重置用户设置');
  } catch (e) {
    log('重置用户设置失败: ' + e.message, 'WARN');
  }
}

function loadConfig() {
  let needSave = false;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = JSON.parse(data);
      currentTheme = normalizeTheme(config.theme);
      currentSpeedRate = normalizeSpeedChoice(config.lastSpeed);
      config.lastSpeed = currentSpeedRate;
      if (config.diskCache === undefined) config.diskCache = true;
      if (config.flashChoice === undefined) config.flashChoice = FLASH_DEFAULT_CHOICE;
      if (config.tabDisplayMode !== 'taskbar') config.tabDisplayMode = 'sidebar';
      // 1.12.1 一次性迁移：所有用户（包括手动选过国内版 34 的）统一重置为国际版 32
      if (config.flashMigrated !== FLASH_MIGRATION_ID) {
        config.flashChoice = FLASH_DEFAULT_CHOICE;
        config.flashMigrated = FLASH_MIGRATION_ID;
        needSave = true;
        log('Flash 默认版本已迁移为国际版 32（一次性重置）');
      }
      log('配置已加载: theme=' + currentTheme + ', lastSpeed=' + currentSpeedRate + ', flash=' + config.flashChoice);
    } else {
      config.flashChoice = FLASH_DEFAULT_CHOICE;
      config.flashMigrated = FLASH_MIGRATION_ID;
      needSave = true;
      log('配置文件不存在，使用默认配置（Flash = 国际版 32）');
    }
  } catch (e) {
    log('加载配置失败: ' + e.message, 'WARN');
    // 配置损坏：回退默认值，并把 Flash 迁移标记写进去，避免每次启动都重复重置
    config = Object.assign({}, config, { flashChoice: FLASH_DEFAULT_CHOICE, flashMigrated: FLASH_MIGRATION_ID });
    needSave = true;
  }
  // 2.3.1 渲染配置迁移：老的 renderSize 语义已废弃
  if (config.renderSizeMigrated !== RENDER_MIGRATION_ID) {
    const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(config.renderSize || ''));
    if (m) config.renderWidth = normalizeRenderWidth(parseInt(m[1], 10));
    config.renderSizeMigrated = RENDER_MIGRATION_ID;
    needSave = true;
    log('渲染配置已迁移为「16:9 固定分辨率」');
  }
  // 默认渲染分辨率调整为 1600×900：老配置里仍是 1920 的跟随一次（用户手动选过的其他档位不动）
  if (config.renderDefault !== '2.3.1') {
    if (config.renderWidth === 1920) config.renderWidth = 1600;
    config.renderDefault = '2.3.1';
    needSave = true;
  }
  config.renderWidth = normalizeRenderWidth(config.renderWidth);
  config.gameOpacity = normalizeGameOpacity(config.gameOpacity);
  // 界面缩放固定跟随系统 DPI（设置项已移除，不再读取旧的手动倍率）
  config.uiScale = 0;
  delete config.renderMode;
  delete config.renderRatio;
  delete config.renderSize;
  delete config.fitLargeScreen;
  delete config.renderAutoPick;

  // 固定策略：游戏优先常开
  config.highPriority = true;
  config.uiScale = normalizeUiScale(config.uiScale);
  if (needSave) saveConfig();
}

function saveConfig() {
  try {
    config.theme = currentTheme;
    config.lastSpeed = currentSpeedRate;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    log('配置已保存: theme=' + currentTheme + ', lastSpeed=' + currentSpeedRate);
  } catch (e) {
    log('保存配置失败: ' + e.message, 'WARN');
  }
}

// ========== 卡死治理 / 诊断 ==========

// 逐进程性能快照（调试控制台 / 卡死日志共用）
function collectPerf() {
  try {
    const metrics = app.getAppMetrics();
    let rss = 0;
    const types = {};
    const per = [];
    for (const m of metrics) {
      const mb = Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024);
      rss += mb;
      const t = String(m.type || '?');
      types[t] = (types[t] || 0) + 1;
      const cpu = (m.cpu && typeof m.cpu.percentCPUUsage === 'number')
        ? Math.round(m.cpu.percentCPUUsage * 10) / 10 : 0;
      per.push(t + '#' + m.pid + ' ' + mb + 'MB cpu=' + cpu + '%');
    }
    return { count: metrics.length, rss: rss, types: types, per: per };
  } catch (e) {
    return { count: 0, rss: 0, types: {}, per: [], error: e.message };
  }
}

function perfSummary() {
  const p = collectPerf();
  const render = SOFTWARE_RENDER ? 'software' : (EARLY_CONFIG.forceGpu !== false ? 'gpu-forced' : 'gpu-auto');
  return 'procs=' + p.count + ' rss=' + p.rss + 'MB ' + JSON.stringify(p.types) +
    ' render=' + render +
    ' flash=' + (FLASH_VERSION || '?') +
    ' gameWindows=' + gameWindows.length +
    ' launcher=' + ((launcherWindow && !launcherWindow.isDestroyed()) ? 1 : 0) +
    (p.error ? ' metricsError=' + p.error : '');
}

// 卡死/恢复/崩溃事件：写入调试控制台（由控制台决定是否落盘）；
// level 有值时同时写 launcher.log。
function logPerfEvent(tag, detail, level) {
  try { debugConsole.write('perf', level || 'INFO', '[' + tag + '] ' + detail); } catch (e) { /* ignore */ }
  if (level) log('[' + tag + '] ' + detail, level);
}

let freezePromptOpen = false;   // 同一时间只弹一个「无响应」框
let freezePromptMuted = false;  // 用户选了「本次不再提示」

// 无响应看门狗：渲染层卡住时主进程仍然可用，可以弹框并提供重载
function attachFreezeWatch(wc, label) {
  if (!wc || wc.isDestroyed()) return;
  let hangStart = 0;

  wc.on('unresponsive', () => {
    hangStart = Date.now();
    const snap = perfSummary();
    const p = collectPerf();
    logPerfEvent('HANG', label + ' unresponsive speed=' + currentSpeedRate + 'x capture=' + CAPTURE_MODE +
      ' ' + snap + ' [' + p.per.join(' | ') + ']');

    if (freezePromptOpen || freezePromptMuted) return;
    freezePromptOpen = true;
    dialog.showMessageBox({
      type: 'warning',
      title: '游戏窗口无响应',
      message: '游戏窗口暂时没有响应。',
      detail: '可能只是正在加载战斗资源，也可能已经卡死。\n选择「重新加载页面」会重进游戏（通常不会丢进度）。',
      buttons: ['继续等待', '重新加载页面', '本次不再提示'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then((r) => {
      freezePromptOpen = false;
      if (r.response === 1) {
        try { wc.reload(); } catch (e) { /* ignore */ }
      } else if (r.response === 2) {
        freezePromptMuted = true;
      }
    }).catch(() => { freezePromptOpen = false; });
  });

  wc.on('responsive', () => {
    const secs = hangStart ? Math.round((Date.now() - hangStart) / 1000) : 0;
    hangStart = 0;
    logPerfEvent('RECOVER', label + ' responsive after ' + secs + 's');
  });
}

// 渲染进程崩溃：记录原因，crashed/oom 自动恢复一次
function attachCrashRecovery(wc, label) {
  if (!wc || wc.isDestroyed()) return;
  let lastReload = 0;

  wc.on('render-process-gone', (event, details) => {
    const reason = (details && details.reason) || 'unknown';
    const exitCode = details && details.exitCode;
    logPerfEvent('CRASH', label + ' renderer gone reason=' + reason + ' exitCode=' + exitCode, 'ERROR');

    if (reason !== 'crashed' && reason !== 'oom') return;
    const now = Date.now();
    if (now - lastReload < 60000) {
      dialog.showMessageBox({
        type: 'error',
        title: '游戏页面反复崩溃',
        message: '游戏页面连续崩溃，已停止自动恢复。',
        detail: '请关闭其他多开窗口 / 标签页后重试；若仍崩溃，可在「设置 → 性能」里开启「兼容模式」。',
        buttons: ['知道了']
      }).catch(() => {});
      return;
    }
    lastReload = now;
    logPerfEvent('CRASH', label + ' 自动重新加载', 'WARN');
    try { wc.reload(); } catch (e) { /* ignore */ }
  });
}

function attachWindowWatch(wc, label) {
  attachFreezeWatch(wc, label);
  attachCrashRecovery(wc, label);
}

// ---------- 游戏窗口快捷键 ----------
// 返回动作名（未命中返回空字符串）。在 before-input-event 里拦截，
// 所以焦点在游戏画面（Flash）里时也能生效。
function matchShortcut(input) {
  if (!input || input.type !== 'keyDown') return '';
  const key = String(input.key || '');
  const k = key.toLowerCase();
  const ctrl = !!input.control;
  const alt = !!input.alt;
  const shift = !!input.shift;

  if (key === 'Escape') return 'escape';
  // F11 由 web-contents-created 里的全局监听统一处理，这里不要再返回，否则会切两次
  if (key === 'F5') return 'refresh';
  if (ctrl && !alt && k === 'r') return 'refresh';
  if (ctrl && !alt && !shift && k === 't') return 'new-tab';
  if (ctrl && !alt && !shift && k === 'w') return 'close-tab';
  if (ctrl && alt && k === 'w') return 'close-window';
  if (ctrl && key === 'Tab') return shift ? 'prev-tab' : 'next-tab';
  if (alt && !ctrl && /^[1-9]$/.test(key)) return 'switch-tab:' + key;
  if (alt && !ctrl && k === 'l') return 'toggle-tabs';
  if (alt && !ctrl && k === 'a') return 'toggle-accounts';
  if (alt && !ctrl && k === 'm') return 'mute';
  if (alt && !ctrl && k === 's') return 'more';
  return '';
}

// 挂到宿主页 + 每个 webview 客进程：哪个有焦点，快捷键就从哪里触发
const escapeInjectedUntil = new Map();

function attachShortcuts(wc, win) {
  if (!wc || wc.isDestroyed()) return;
  wc.on('before-input-event', (event, input) => {
    // Ctrl+方向键：←→ 调透明度，↑↓ 调变速（游戏内也生效）
    if (input && input.type === 'keyDown' && input.control && !input.alt && !input.shift) {
      const key = String(input.key || '');
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        if (!win || win.isDestroyed()) return;
        if (!gameWindows.some((g) => g && g.win === win)) return;
        try { event.preventDefault(); } catch (e) { /* ignore */ }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          const cur = Math.round(normalizeGameOpacity(config.gameOpacity) * 100);
          applyGameOpacity(cur + (key === 'ArrowRight' ? 5 : -5));
        } else {
          stepSpeed(key === 'ArrowUp' ? 1 : -1);
        }
        return;
      }
    }
    const action = matchShortcut(input);
    if (!action) return;
    // 主动注入给游戏页的 Esc 不再拦截，否则会无限转发
    if (action === 'escape' && (escapeInjectedUntil.get(wc.id) || 0) > Date.now()) return;
    try { event.preventDefault(); } catch (e) { /* ignore */ }
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('shortcut', action); } catch (e) { /* ignore */ }
  });
}

// 启动器侧边栏/弹窗都关闭时，把 Esc 真正送进当前游戏页（Flash），让游戏关掉内部窗口
ipcMain.on('send-escape-to-guest', (event, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return;
  const targetId = wc.id;
  escapeInjectedUntil.set(targetId, Date.now() + 200);
  try { wc.focus(); } catch (e) { /* ignore */ }
  try {
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  } catch (e) { /* ignore */ }
  setTimeout(() => {
    if ((escapeInjectedUntil.get(targetId) || 0) <= Date.now()) escapeInjectedUntil.delete(targetId);
  }, 500);
});

// ========== 在线人数 ==========

// 本机当前打开的标签页数（火影 / 4399 分开）
function getOnlineCounts() {
  let fire = 0, mini = 0;
  for (const gw of gameWindows) {
    if (!gw || !gw.win || gw.win.isDestroyed()) continue;
    const n = gw.tabs || 0;
    if (gw.plain) mini += n; else fire += n;
  }
  return { fire, mini };
}

// 客户端标识：纯随机串，仅用于服务端去重，不含任何个人信息
function ensureClientId() {
  if (config.clientId) return config.clientId;
  try {
    config.clientId = require('crypto').randomBytes(12).toString('hex');
  } catch (e) {
    config.clientId = 'c' + Date.now().toString(36);
  }
  saveConfig();
  return config.clientId;
}

// GPU 进程崩溃/被 OOM 杀掉，最常见的表现就是「游戏窗口突然卡死」。
// 这里自动把「强制启用 GPU」关掉，下次启动不再无视驱动黑名单，避免反复踩坑。
app.on('child-process-gone', (event, details) => {
  const type = (details && details.type) || 'unknown';
  const reason = (details && details.reason) || 'unknown';
  const exitCode = details && details.exitCode;
  const isGpu = String(type).toUpperCase() === 'GPU';
  // reason=killed 通常是我们主动清理 Flash 插件，不应打成崩溃吓人
  const tag = reason === 'killed' ? 'EXIT' : 'CRASH';

  logPerfEvent(tag, type + ' 进程退出 reason=' + reason + ' exitCode=' + exitCode,
    isGpu && reason !== 'killed' ? 'ERROR' : undefined);

  if (!isGpu) return;
  if (reason === 'crashed' || reason === 'oom') {
    try {
      config.forceGpu = false;
      config.gpuCrashAt = new Date().toISOString();
      saveConfig();
      log('[crash] 已自动关闭「强制启用 GPU」，下次启动生效', 'ERROR');
    } catch (e) {
      log('[crash] 写入 GPU 降级配置失败: ' + e.message, 'WARN');
    }
  }
});



// 下发给游戏窗口 / 4399 窗口的主题颜色（单一来源，两处不再各自维护主题表）
function getThemeColors() {
  const t = THEMES[currentTheme] || THEMES.mint;
  return {
    bg1: t.toolbarBg1,
    bg2: t.toolbarBg2,
    border: t.toolbarBorder,
    text: t.text,
    sub: t.sub,
    btnBg: t.toolbarBtn,
    btnHover: t.hover,
    btnBorder: t.toolbarBtnBorder,
    separator: t.toolbarSep,
    accent: t.accent,
    gradient: t.bg
  };
}

// ========== 界面缩放（启动器/账号窗口，不影响游戏渲染） ==========
// 0 = 自动（跟随系统 DPI / 屏宽）；其余为固定倍率。高分屏上选 100% 可完全避开系统放大。
const UI_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2];
const UI_SCALE_OPTIONS = [0, 1, 1.25, 1.5, 1.75, 2];
let systemDpiCache = 0;

function normalizeUiScale(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  if (n === 0) return 0;
  return UI_SCALE_OPTIONS.indexOf(n) >= 0 ? n : 0;
}

function readSystemDpi() {
  if (systemDpiCache) return systemDpiCache;
  systemDpiCache = 96;
  if (process.platform !== 'win32') return systemDpiCache;
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Control Panel\\Desktop\\WindowMetrics', '/v', 'AppliedDPI'],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const m = /AppliedDPI\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.stdout || '');
    if (m) systemDpiCache = parseInt(m[1], 16) || 96;
  } catch (e) { /* ignore */ }
  return systemDpiCache;
}


function getUiScale() {
  const fixed = normalizeUiScale(config.uiScale);
  if (fixed >= 1) return fixed;
  const d = screen.getPrimaryDisplay();
  const width = (d.size && d.size.width) || (d.bounds && d.bounds.width) || 1920;
  const raw = Math.max(1, readSystemDpi() / 96, width / 1920);
  return UI_SCALE_STEPS.find((s) => s >= raw - 0.01) || 2;
}

function applyUiScaleToWindow(win, baseW, baseH) {
  if (!win || win.isDestroyed()) return;
  const scale = getUiScale();
  let effective = scale;
  try {
    const d = screen.getDisplayMatching(win.getBounds());
    const maxH = Math.max(1, d.workAreaSize.height - 40);
    const maxW = Math.max(1, d.workAreaSize.width - 40);
    effective = Math.min(scale, maxH / baseH, maxW / baseW);
    effective = Math.max(1, Math.floor(effective * 20) / 20);
  } catch (e) {
    effective = scale;
  }
  win.__uiEffectiveScale = effective;
  try { win.webContents.setZoomFactor(effective); } catch (e) { /* ignore */ }
  // 导航完成后 zoomFactor 可能被重置，窗口加载完再补一次
  if (!win.__uiZoomBound) {
    win.__uiZoomBound = true;
    try {
      win.webContents.on('did-finish-load', () => {
        if (!win.isDestroyed()) {
          try { win.webContents.setZoomFactor(win.__uiEffectiveScale || getUiScale()); } catch (e) { /* ignore */ }
        }
      });
    } catch (e) { /* ignore */ }
  }
  try { win.setContentSize(Math.round(baseW * effective), Math.round(baseH * effective)); } catch (e) { /* ignore */ }
  // 放大后如果窗口跑出工作区，往回收一点
  try {
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    const wa = d.workArea;
    const nx = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width);
    const ny = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
    if (nx !== b.x || ny !== b.y) win.setPosition(nx, ny);
  } catch (e) { /* ignore */ }
}


function getResourcePath(...segments) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(__dirname, 'resources', ...segments);
}

function getFlashPath() {
  const arch = process.arch === 'x64' ? '64' : '32';
  const sysDir = process.arch === 'x64' ? 'System32' : 'SysWOW64';

  // 读取 Flash 选择（内置国内版 / 内置国际版），此函数在 config 加载前执行，故直接读文件
  // 默认 = 内置国际版 32.0.0.344（1.12.1 起；未迁移过的用户一律按国际版处理）
  let flashChoice = FLASH_DEFAULT_CHOICE;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      flashChoice = (cfg.flashMigrated === FLASH_MIGRATION_ID)
        ? (cfg.flashChoice || FLASH_DEFAULT_CHOICE)
        : FLASH_DEFAULT_CHOICE;
    }
  } catch (e) {}

  const bundled32 = getResourcePath('flash', `pepflashplayer${arch}_32_0_0_344.dll`);
  const bundled34 = getResourcePath('flash', `pepflashplayer${arch}_34_0_0_376.dll`);
  const system32 = `C:\\Windows\\${sysDir}\\Macromed\\Flash\\pepflashplayer${arch}_32_0_0_344.dll`;
  const system34 = `C:\\Windows\\${sysDir}\\Macromed\\Flash\\pepflashplayer${arch}_34_0_0_376.dll`;
  const generic = getResourcePath('flash', 'pepflashplayer.dll');
  const devFlash = path.join(__dirname, 'flash', 'pepflashplayer.dll');

  let paths;
  if (flashChoice === 'system') {
    // 国内版：优先内置 34（已打包，别人电脑也能用），其次系统 34，最后回退内置 32
    paths = [bundled34, system34, bundled32, generic, devFlash];
  } else {
    // 国际版：内置 32，其次系统 32，最后内置 34
    paths = [bundled32, system32, bundled34, generic, devFlash];
  }

  for (const p of paths) {
    if (fs.existsSync(p)) {
      log('找到Flash插件: ' + p);
      return p;
    }
  }
  return null;
}

function flushLogBuffer() {
  if (logBuffer.length === 0) return;
  
  const content = logBuffer.join('');
  logBuffer = [];
  
  fs.stat(LOG_FILE, (err, stats) => {
    if (!err && stats.size > MAX_LOG_FILE_SIZE) {
      fs.writeFile(LOG_FILE, content, (writeErr) => {
        if (writeErr) console.error('Failed to write log:', writeErr);
      });
    } else {
      fs.writeFile(LOG_FILE, content, { flag: 'a' }, (writeErr) => {
        if (writeErr) console.error('Failed to write log:', writeErr);
      });
    }
  });
}

function log(message, level = 'INFO') {
  try { debugConsole.write('main', level, message); } catch (e) { /* ignore */ }
  if (level !== 'ERROR' && level !== 'WARN') return;

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;

  logBuffer.push(logEntry);

  if (logBuffer.length >= MAX_LOG_BUFFER) {
    flushLogBuffer();
  }
}

// ========== 自动清理功能 ==========

const CLEANUP_CONFIG = {
  // 日志文件最大大小（5MB）
  maxLogSize: 1024 * 1024 * 5,
  // 日志保留天数
  logRetainDays: 7,
  // 会话分区（Partitions/）保留天数：目录里是 cookie / 登录态，
  // 已保存账号的分区始终跳过，其余分区才按这个天数清理
  partitionRetainDays: 90,
  // 默认会话 Local Storage 保留天数
  localStorageRetainDays: 30,
  // 抓包缓存（captures/）：每次开抓包都会新增 netlog，单个可达数百 MB
  captureKeepFiles: 3,                        // 最新保留份数（netlog / jsonl 分别算）
  captureKeepDays: 7,                         // 超过天数删除
  captureMaxTotal: 2 * 1024 * 1024 * 1024     // 总量上限 2 GB
};

/**
 * 安全的删除目录（递归）
 */
function safeRemoveDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return;

    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const entryStat = fs.statSync(fullPath);
      if (entryStat.isDirectory()) {
        safeRemoveDir(fullPath);
      } else {
        try {
          fs.unlinkSync(fullPath);
        } catch (e) {}
      }
    }
    fs.rmdirSync(dirPath);
  } catch (e) {}
}

/**
 * 安全的删除文件
 */
function safeRemoveFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {}
}

/**
 * 检查文件/目录是否过期
 */
function isExpired(filePath, retainDays) {
  try {
    const stat = fs.statSync(filePath);
    const now = Date.now();
    const age = now - stat.mtimeMs;
    return age > retainDays * 24 * 60 * 60 * 1000;
  } catch (e) {
    return false;
  }
}

// ---------- 抓包缓存（captures/） ----------
const CAPTURE_FILE_RE = /^(netlog|http)-.*\.(json|jsonl)$/;

// 列出抓包目录里的 netlog / jsonl，按修改时间倒序（新 → 旧）
function listCaptureFiles() {
  const dir = path.join(app.getPath('userData'), 'captures');
  const out = [];
  try {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      if (!CAPTURE_FILE_RE.test(name)) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (st.isFile()) out.push({ path: full, name, size: st.size, mtime: st.mtimeMs });
      } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function captureStorageInfo() {
  const files = listCaptureFiles();
  return { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) };
}

/**
 * 清理抓包缓存：保留最新 N 份 + 天数上限 + 总量上限
 * 注意：始终保留最新 1 个 netlog，避免把当前/最近一次会话删掉
 */
function cleanupCaptures() {
  const files = listCaptureFiles();
  if (!files.length) return { removed: 0, freed: 0 };

  const newestNetlog = files.find((f) => f.name.startsWith('netlog-')) || null;

  // 最新 N 个 netlog / N 个 jsonl 永远保留
  const keep = new Set();
  let netlogKept = 0, jsonlKept = 0;
  for (const f of files) {
    if (f.name.startsWith('netlog-')) {
      if (netlogKept < CLEANUP_CONFIG.captureKeepFiles) { keep.add(f.path); netlogKept++; }
    } else if (jsonlKept < CLEANUP_CONFIG.captureKeepFiles) {
      keep.add(f.path); jsonlKept++;
    }
  }

  let removed = 0, freed = 0;
  const removeOne = (f) => {
    try {
      fs.unlinkSync(f.path);
      removed++;
      freed += f.size;
      return true;
    } catch (e) {
      return false;   // 被占用等情况，跳过
    }
  };

  // ① 超过保留天数的（保留集合内的不动）
  const cutoff = Date.now() - CLEANUP_CONFIG.captureKeepDays * 24 * 60 * 60 * 1000;
  const rest = [];
  for (const f of files) {
    if (keep.has(f.path)) { rest.push(f); continue; }
    if (f.mtime < cutoff && removeOne(f)) continue;
    rest.push(f);     // 未过期 / 删除失败，留给总量判断
  }

  // ② 总量超上限：从最旧的开始删（保留最新 netlog）
  let total = rest.reduce((s, f) => s + f.size, 0);
  if (total > CLEANUP_CONFIG.captureMaxTotal) {
    for (let i = rest.length - 1; i >= 0; i--) {
      if (total <= CLEANUP_CONFIG.captureMaxTotal) break;
      const f = rest[i];
      if (newestNetlog && f.path === newestNetlog.path) continue;
      if (removeOne(f)) total -= f.size;
    }
  }

  if (removed) {
    log(`清理抓包缓存: ${removed} 个文件, 释放 ${(freed / 1048576).toFixed(1)} MB`, 'WARN');
  }
  return { removed, freed };
}

/**
 * 清理日志文件 - 限制大小并轮转
 */
function cleanupLogFile() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;

    const stats = fs.statSync(LOG_FILE);
    if (stats.size > CLEANUP_CONFIG.maxLogSize) {
      // 超过限制，备份旧日志并创建新日志
      const backupPath = LOG_FILE + '.old';
      safeRemoveFile(backupPath);
      fs.renameSync(LOG_FILE, backupPath);
      log('日志文件超过限制已轮转', 'INFO');
    }

    // 删除超过保留期的旧日志备份
    const oldLogPath = LOG_FILE + '.old';
    if (fs.existsSync(oldLogPath) && isExpired(oldLogPath, CLEANUP_CONFIG.logRetainDays)) {
      safeRemoveFile(oldLogPath);
      log('删除过期日志备份', 'INFO');
    }
  } catch (e) {
    console.error('清理日志失败:', e);
  }
}

/**
 * 清理 Electron 缓存目录
 */
function cleanupElectronCache() {
  const userDataPath = app.getPath('userData');
  // 注意：不清理 GPUCache / Code Cache —— 删掉会丢失 GPU 着色器缓存与 V8 字节码缓存，
  // 之后需要重新编译，反而让启动与开局前几分钟更吃 CPU。
  const cacheDirs = [
    'blob_storage',
    'Session Storage',
    'Service Worker',
    'shared_proto_db'
  ];

  let cleanedCount = 0;
  for (const dirName of cacheDirs) {
    const dirPath = path.join(userDataPath, dirName);
    if (fs.existsSync(dirPath)) {
      safeRemoveDir(dirPath);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    log(`清理 Electron 缓存目录: ${cleanedCount} 个`, 'INFO');
  }
}

// 已保存账号的 QQ 集合（用于保护对应分区，避免清理把登录态删掉）
function savedAccountQqSet() {
  const set = new Set();
  (accounts || []).forEach((a) => {
    const qq = String((a && a.qq) || '').replace(/\D/g, '');
    if (qq) set.add(qq);
  });
  return set;
}

// 从分区目录名里取归属 QQ（Electron 把 persist:qq-123456 落盘为 qq-123456）
function partitionOwnerQq(name) {
  const m = /(?:^|[^0-9])(\d{5,12})(?:[^0-9]|$)/.exec(String(name || ''));
  return m ? m[1] : '';
}

/**
 * 清理未使用的 persist session 分区数据
 * 已保存账号的分区（登录态载体）永不自动删除；其余按 partitionRetainDays 清理
 */
function cleanupUnusedSessions() {
  const userDataPath = app.getPath('userData');
  const partitionsDir = path.join(userDataPath, 'Partitions');

  if (!fs.existsSync(partitionsDir)) return;

  try {
    const savedQq = savedAccountQqSet();
    const entries = fs.readdirSync(partitionsDir);
    let cleanedCount = 0;

    for (const entry of entries) {
      const partitionPath = path.join(partitionsDir, entry);
      let stat;
      try { stat = fs.statSync(partitionPath); } catch (e) { continue; }

      if (!stat.isDirectory()) continue;

      const owner = partitionOwnerQq(entry);
      if (owner && savedQq.has(owner)) continue;

      if (isExpired(partitionPath, CLEANUP_CONFIG.partitionRetainDays)) {
        safeRemoveDir(partitionPath);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log(`清理过期 Session 分区: ${cleanedCount} 个（已保存账号的分区保留）`, 'WARN');
    }
  } catch (e) {
    console.error('清理 session 失败:', e);
  }
}

/**
 * 清理更新下载的临时文件
 * 只处理 pending 目录内过期的安装包，不碰 userData 根目录
 */
function cleanupUpdateTempFiles() {
  const pendingUpdateDir = path.join(app.getPath('userData'), 'pending');
  if (!fs.existsSync(pendingUpdateDir)) return;

  let removed = 0;
  try {
    for (const entry of fs.readdirSync(pendingUpdateDir)) {
      if (!/\.(exe|zip|7z)$/i.test(entry)) continue;
      const filePath = path.join(pendingUpdateDir, entry);
      try {
        if (!fs.statSync(filePath).isFile()) continue;
        if (!isExpired(filePath, 7)) continue;
        fs.unlinkSync(filePath);
        removed++;
      } catch (e) { /* 被占用等情况，跳过 */ }
    }
  } catch (e) { /* ignore */ }

  if (removed > 0) log('清理更新临时文件: ' + removed + ' 个', 'INFO');
}

/**
 * 清理 Local Storage 中过期的游戏数据（保留 config）
 */
function cleanupLocalStorage() {
  const userDataPath = app.getPath('userData');
  const localStorageDir = path.join(userDataPath, 'Local Storage');

  if (!fs.existsSync(localStorageDir)) return;

  try {
    const entries = fs.readdirSync(localStorageDir);
    for (const entry of entries) {
      const entryPath = path.join(localStorageDir, entry);
      if (isExpired(entryPath, CLEANUP_CONFIG.localStorageRetainDays)) {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          safeRemoveDir(entryPath);
        } else {
          safeRemoveFile(entryPath);
        }
      }
    }
  } catch (e) {}
}

/**
 * 主清理函数 - 应用启动时调用
 */
function performStartupCleanup() {
  log('开始启动清理...', 'INFO');

  // 分步执行，每步之间让出事件循环，避免长时间独占主进程造成卡顿
  const steps = [
    cleanupLogFile,
    cleanupElectronCache,
    cleanupUnusedSessions,
    cleanupUpdateTempFiles,
    cleanupLocalStorage,
    cleanupCaptures
  ];
  let i = 0;
  const next = () => {
    if (i >= steps.length) {
      log('启动清理完成', 'INFO');
      return;
    }
    try { steps[i++](); } catch (e) {}
    setTimeout(next, 50);
  };
  next();
}

/**
 * 退出时清理 - 清理临时数据
 */
function performExitCleanup() {
  try {
    // 清理当前会话的临时缓存
    const defaultSession = require('electron').session.defaultSession;
    if (defaultSession) {
      defaultSession.clearCache().catch(() => {});
    }

    // 确保日志已写入
    flushLogBuffer();
  } catch (e) {}
}

// ========== 自动清理结束 ==========

function detectWindowsVersion() {
  try {
    const release = os.release();
    const version = os.version();
    log(`系统信息: release=${release}, version=${version}`);
    return release;
  } catch (e) {
    log(`检测系统版本失败: ${e.message}`, 'WARN');
    return 'unknown';
  }
}

function initSpeedControl() {
  speedctlPath = getResourcePath('native', 'speedctl.exe');
  speedhookPath = getResourcePath('native', 'speedhook.dll');
  
  log(`变速组件路径: speedctl=${speedctlPath}, speedhook=${speedhookPath}`);
  log(`检查组件是否存在: speedctl=${fs.existsSync(speedctlPath)}, speedhook=${fs.existsSync(speedhookPath)}`);
  
  if (fs.existsSync(speedctlPath) && fs.existsSync(speedhookPath)) {
    log('原生变速组件已就绪');
  } else {
    log('原生变速组件未找到！', 'ERROR');
    log('加速功能将不可用，请确保 speedctl.exe 和 speedhook.dll 存在于 resources/native/ 目录中');
  }
}

function injectSpeedHook(pid) {
  if (injectedPids.has(pid)) return;
  
  if (!fs.existsSync(speedctlPath) || !fs.existsSync(speedhookPath)) {
    log('原生变速组件未找到，跳过DLL注入', 'WARN');
    return;
  }

  injectedPids.add(pid);
  log(`尝试注入DLL到 PID ${pid}`);
  
  const args = ['inject', String(pid), speedhookPath];
  
  const child = spawn(speedctlPath, args, {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: process.env.PATH + ';' + path.dirname(speedctlPath)
    }
  });
  
  let stdoutData = '';
  let stderrData = '';
  
  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });
  
  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });
  
  child.on('error', (err) => {
    log(`DLL注入进程启动失败 PID ${pid}: ${err.message}`, 'ERROR');
    injectedPids.delete(pid);
  });
  
  child.on('close', (code) => {
    if (code === 0) {
      log(`DLL注入成功 PID ${pid}${stdoutData.trim() ? ' - ' + stdoutData.trim() : ''}`);
      if (currentSpeedRate !== 1) {
        updateNativeRate(currentSpeedRate);
      }
    } else {
      log(`DLL注入失败 PID ${pid}, 退出码=${code}, stderr=${stderrData.trim()}`, 'WARN');
      injectedPids.delete(pid);
    }
  });
}

function updateNativeRate(rate) {
  if (!fs.existsSync(speedctlPath)) {
    log('speedctl.exe不存在，无法更新原生变速率', 'WARN');
    return;
  }
  
  log(`尝试设置原生变速率为 ${rate}x`);
  const child = spawn(speedctlPath, ['rate', String(rate)], {
    windowsHide: true,
    env: {
      ...process.env,
      PATH: process.env.PATH + ';' + path.dirname(speedctlPath)
    }
  });
  
  let stdoutData = '';
  let stderrData = '';
  
  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });
  
  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });
  
  child.on('error', (err) => {
    log(`设置变速率进程启动失败: ${err.message}`, 'ERROR');
  });
  
  child.on('close', (code) => {
    if (code === 0) {
      log(`原生变速率设置成功${stdoutData.trim() ? ' - ' + stdoutData.trim() : ''}`);
    } else {
      log(`设置变速率失败，退出码=${code}, stderr=${stderrData.trim()}`, 'WARN');
    }
  });
}

function setSpeedRate(rate) {
  if (typeof rate !== 'number' || isNaN(rate)) {
    log(`无效的变速率: ${rate}`, 'WARN');
    return;
  }
  if (rate < 0.01 || rate > 100) {
    log(`变速率超出范围 (0.01~100): ${rate}`, 'WARN');
    return;
  }
  
  currentSpeedRate = rate;
  config.lastSpeed = rate;
  saveConfig();
  log(`开始设置变速率为: ${rate}x`);
  
  if (fs.existsSync(speedctlPath)) {
    updateNativeRate(rate);
    injectIntoGameContents();
    injectAllChildProcesses();
    scheduleSpeedRescan();
  }
  
  log(`变速率已设置为: ${rate}x`);
}

// 变速档位：只保留 UI 提供的 6 档（旧的 20x 归到 10x）
const SPEED_STEPS = [0.5, 1, 2, 4, 6, 10];
function normalizeSpeedChoice(v) {
  const n = Number(v);
  if (SPEED_STEPS.indexOf(n) >= 0) return n;
  return n > 10 ? 10 : 1;
}
function stepSpeed(dir) {
  const cur = Number(currentSpeedRate) || 1;
  let idx = SPEED_STEPS.findIndex((x) => Math.abs(x - cur) < 1e-6);
  if (idx < 0) {
    idx = SPEED_STEPS.findIndex((x) => x >= cur);
    if (idx < 0) idx = SPEED_STEPS.length - 1;
  }
  const next = SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + dir))];
  if (Math.abs(next - cur) < 1e-6) return;
  setSpeedRate(next);
  gameWindows.forEach((gw) => {
    if (!gw || !gameWinAlive(gw.win)) return;
    try { gw.win.webContents.send('speed-update', next); } catch (e) { /* ignore */ }
  });
}

function getAllRelevantChildPids() {
  try {
    // 只扫描 Flash 插件进程。游戏渲染进程在各自 dom-ready 时按 PID 直注，
    // 避免把启动器/账号窗口的渲染进程也挂上 hook。
    const metrics = app.getAppMetrics();
    const relevantTypes = new Set(['ppapi plugin', 'pepper plugin']);
    return metrics
      .filter(m => m.pid && m.pid !== process.pid)
      .filter(m => relevantTypes.has(String(m.type || '').toLowerCase()))
      .map(m => m.pid);
  } catch (e) {
    log('获取进程列表失败: ' + e.message, 'WARN');
    return [];
  }
}

// 进程退出后 pid 可能被系统复用，注入记录必须及时清理
function pruneInjectedPids() {
  try {
    const alive = new Set(app.getAppMetrics().map(m => m.pid));
    injectedPids.forEach((pid) => {
      if (!alive.has(pid)) injectedPids.delete(pid);
    });
  } catch (e) { /* ignore */ }
}

function trackGameContents(wc) {
  if (!wc) return;
  gameContents.add(wc);
  try {
    wc.once('destroyed', () => gameContents.delete(wc));
  } catch (e) { /* ignore */ }
}

// 用户切倍率时，已经打开的游戏页面也要补注（dom-ready 时倍率可能还是 1x）
function injectIntoGameContents() {
  if (Math.abs(currentSpeedRate - 1) < 1e-6) return;
  gameContents.forEach((wc) => {
    try {
      if (wc.isDestroyed()) {
        gameContents.delete(wc);
        return;
      }
      const pid = wc.getOSProcessId();
      if (pid) injectSpeedHook(pid);
    } catch (e) { /* ignore */ }
  });
}

async function injectAllChildProcesses() {
  pruneInjectedPids();
  // 1x（还原）时只需清理注入记录：hook 常驻进程会带来额外开销。
  // 之后用户把倍率改成非 1 时，setSpeedRate 会重新调用本函数完成注入。
  if (Math.abs(currentSpeedRate - 1) < 1e-6) {
    return;
  }

  try {
    const childPids = getAllRelevantChildPids();

    for (const pid of childPids) {
      if (!injectedPids.has(pid)) {
        injectSpeedHook(pid);
      }
    }
  } catch (e) {
    log('扫描子进程失败: ' + e.message, 'WARN');
  }
}

// Flash 插件进程可能晚于 dom-ready / 切换倍率才创建，延迟补几次扫描
function scheduleSpeedRescan() {
  if (Math.abs(currentSpeedRate - 1) < 1e-6) return;
  [3000, 8000, 15000].forEach((ms) => {
    setTimeout(() => { injectAllChildProcesses(); }, ms);
  });
}

const FLASH_PATH = getFlashPath();

function detectFlashVersion(flashPath) {
  if (!flashPath) return '34.0.0.376';
  const match = flashPath.match(/(\d+_\d+_\d+_\d+)/);
  if (match) {
    return match[1].replace(/_/g, '.');
  }
  return '34.0.0.376';
}

const FLASH_VERSION = detectFlashVersion(FLASH_PATH);

if (FLASH_PATH) {
  app.commandLine.appendSwitch('ppapi-flash-path', FLASH_PATH);
  app.commandLine.appendSwitch('ppapi-flash-version', FLASH_VERSION);
  log('Flash插件已配置: ' + FLASH_PATH + ' (' + FLASH_VERSION + ')');
} else {
  log('Flash插件未找到！', 'ERROR');
}

// 确保 Flash 对所有页面可用
app.commandLine.appendSwitch('ppapi-flash-Allow-Windows-Sandbox', 'true');

app.commandLine.appendSwitch('allow-running-insecure-content');

// 证书校验：不再全局忽略（ignore-certificate-errors 会连更新源一起放开，
// 攻击者可自签证书冒充 S4/COS/GitHub → 替换安装包）。只对游戏必需的域名放行。
// 调试控制台出现 [cert] 拒绝 <host> 时，确认后把域名加进 CERT_ALLOWED_HOSTS。
const CERT_ALLOWED_HOSTS = ['.qq.com', '.gtimg.cn', '.qpic.cn'];
const certRejectedHosts = new Set();
function isCertAllowedHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  return CERT_ALLOWED_HOSTS.some((suffix) => h === suffix.slice(1) || h.endsWith(suffix));
}
app.on('certificate-error', (event, wc, url, error, certificate, callback) => {
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { /* ignore */ }
  if (isCertAllowedHost(host)) {
    event.preventDefault();
    callback(true);
    return;
  }
  if (host && !certRejectedHosts.has(host)) {
    certRejectedHosts.add(host);
    log('[cert] 拒绝 ' + host + ' (' + error + ')', 'WARN');
  }
  callback(false);
});

// 去掉 UA 里的 Electron 标记：QQ 的 qqgame app_frame 入口会对「带 Electron 且无 Referer」的请求直接 403。
// 内核仍是 Chromium 87，所以 UA 里的版本号保持一致，不影响页面特性判断。
try {
  app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36';
} catch (e) { /* ignore */ }
// 软件渲染（兼容模式）：显卡驱动本身有问题的机器最后的兜底（走 CPU 渲染）
const SOFTWARE_RENDER = EARLY_CONFIG.softwareRender === true;
// 强制启用 GPU（无视驱动黑名单）：默认开启以保持原有行为，可在「设置」里关闭
// 注意：GPU 进程崩溃后会被自动写回 forceGpu=false（见 child-process-gone）
if (SOFTWARE_RENDER) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else if (EARLY_CONFIG.forceGpu !== false) {
  // GPU 加速开关（与 GameLauncher 对齐）：双显卡机器优先独显，并显式打开光栅化/合成/视频硬解。
  // 关掉「强制启用 GPU」时这一组整体不生效，保留给驱动有问题的机器作退路。
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-accelerated-video');
  app.commandLine.appendSwitch('enable-gpu-compositing');
  // 避免 Flash 的 3D 内容回退到软件渲染
  app.commandLine.appendSwitch('disable-flash-3d-software-renderer');
  if (process.platform === 'win32') {
    // Windows：请求高性能 GPU（独显），混合显卡笔记本上影响明显
    app.commandLine.appendSwitch('force_high_performance_gpu');
  }
}
app.commandLine.appendSwitch('no-sandbox');

// 关掉与游戏无关的后台维护任务，减少持续 CPU / IO / 网络噪声
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('metrics-recording-only');
app.commandLine.appendSwitch('no-first-run');

// 性能：禁止后台节流（保证多开时后台游戏照常运行）
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding');
// 窗口最小化/被遮挡时 Chromium 会暂停渲染（Flash 插件会因此卡住，恢复后一动不动）
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// 注：已移除 disable-frame-rate-limit / disable-gpu-vsync
//     这两个会让合成器不锁帧、不等垂直同步，CPU/GPU 持续满转 → 发热降频 → 越玩越卡

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity,CalculateNativeWinOcclusion');

// 磁盘缓存上限 1GB（1073741824 字节）
app.commandLine.appendSwitch('disk-cache-size', '1073741824');

// 流量抓包：net-log 记录网络栈全量事件（含 socket 层）
// 两种抓包模式（stats / full）都需要它，所以这里是共用部分
if (CAPTURE_MODE !== 'off') {
  const capDir = path.join(app.getPath('userData'), 'captures');
  try {
    fs.mkdirSync(capDir, { recursive: true });
  } catch (e) {
    // 忽略
  }
  const capStamp = new Date().toISOString().replace(/[:.]/g, '-');
  app.commandLine.appendSwitch('log-net-log', path.join(capDir, `netlog-${capStamp}.json`));
  // IncludeSocketBytes 才能记录 socket 上实际收发的原始字节（原始 TCP 协议必需）
  app.commandLine.appendSwitch('net-log-capture-mode', 'IncludeSocketBytes');
}

function createLauncherWindow() {
  const T = THEMES[currentTheme] || THEMES.mint;

  const { nativeImage } = require('electron');

  const baseWidth = 360;
  const baseHeight = 640;

  const uiScale = getUiScale();
  const scaledWidth = Math.round(baseWidth * uiScale);
  const scaledHeight = Math.round(baseHeight * uiScale);

  // 标题栏 logo（小尺寸 base64；失败则留空，页面会隐藏该 img）
  let logoDataUrl = '';
  try {
    const iconPath = getResourcePath('icons', 'Naruto.png');
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        logoDataUrl = img.resize({ width: 34, height: 34, quality: 'best' }).toDataURL();
      }
    }
  } catch (e) {
    log('生成标题栏 logo 失败: ' + e.message, 'WARN');
  }

  launcherWindow = new BrowserWindow({
    width: scaledWidth,
    height: scaledHeight,
    title: '火影忍者启动器',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    backgroundColor: T.winBg,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableRemoteModule: true
    }
  });

  launcherWindow.setMenu(null);
  applyUiScaleToWindow(launcherWindow, baseWidth, baseHeight);

  const launcherHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  /* 去掉 Chromium 默认焦点环（跟随系统强调色，会残留成黄框） */
  button:focus, button:focus-visible { outline:none; }
  :root {
    --bg: ${T.bg};
    --panel: ${T.panel};
    --border: ${T.panelBorder};
    --text: ${T.text};
    --sub: ${T.sub};
    --accent: ${T.accent};
    --accent2: ${T.accent2};
    --accentText: ${T.accentText};
    --hover: ${T.hover};
    --shadow: ${T.shadow};
  }
  html, body { height:100%; overflow:hidden; }
  body {
    font-family:'Microsoft YaHei', sans-serif;
    color:var(--text);
    background:var(--bg);
    display:flex;
    flex-direction:column;
  }
  /* 自绘标题栏 */
  .titlebar {
    height:44px; flex:0 0 44px;
    display:flex; align-items:center; justify-content:space-between;
    padding:0 6px 0 14px;
    -webkit-app-region:drag; user-select:none;
  }
  .tb-left { display:flex; align-items:center; gap:9px; }
  .tb-logo { width:24px; height:24px; border-radius:6px; display:block; }
  .tb-title { font-size:13.5px; font-weight:600; letter-spacing:.3px; }
  .tb-actions { display:flex; -webkit-app-region:no-drag; }
  .tb-btn {
    width:34px; height:30px; border:none; background:transparent;
    color:var(--sub); font-size:13px; border-radius:8px; cursor:pointer;
    transition:background .18s, color .18s;
  }
  .tb-btn:hover { background:var(--hover); color:var(--text); }
  .tb-close:hover { background:#ef4444; color:#fff; }
  /* 内容 */
  .content { flex:1; display:flex; flex-direction:column; padding:4px 16px 0; gap:14px; overflow:hidden; }
  .game-list { display:flex; flex-direction:column; gap:12px; }
  .game-card {
    display:flex; align-items:center; gap:13px; padding:15px 16px;
    background:var(--panel); border:1px solid var(--border); border-radius:15px;
    cursor:pointer; box-shadow:0 4px 14px var(--shadow);
    transition:transform .18s, box-shadow .18s;
  }
  .game-card:hover { transform:translateY(-2px); box-shadow:0 9px 24px var(--shadow); }
  .gc-emoji {
    font-size:22px; width:42px; height:42px; flex:0 0 42px;
    display:flex; align-items:center; justify-content:center;
    background:var(--hover); border-radius:12px;
  }
  .gc-body { flex:1; min-width:0; }
  .gc-title { font-size:15px; font-weight:600; }
  .gc-sub { font-size:11.5px; color:var(--sub); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gc-go { font-size:20px; color:var(--sub); }
  /* 在线人数胶囊 */
  .gc-online {
    flex:0 0 auto; display:flex; align-items:center; gap:5px;
    padding:3px 8px; border-radius:20px;
    font-size:10.5px; color:var(--sub); background:var(--hover);
  }
  .gc-online .dot { width:5px; height:5px; border-radius:50%; background:var(--accent); }
  .gc-online b { font-weight:600; color:var(--text); }
  .quick { margin-top:auto; display:flex; gap:10px; padding-bottom:8px; }
  .pill {
    flex:1; padding:11px; border:none; border-radius:12px; cursor:pointer;
    font-size:12.5px; font-weight:600; color:var(--accentText);
    background:linear-gradient(135deg, var(--accent), var(--accent2));
    box-shadow:0 5px 14px var(--shadow);
    transition:transform .16s, filter .16s;
  }
  .pill:hover { transform:translateY(-1px); filter:brightness(1.05); }
  .pill:active { transform:translateY(0); }
  /* 底栏 */
  .bottombar {
    flex:0 0 48px; height:48px; display:flex; align-items:center;
    justify-content:space-between; padding:0 16px;
    border-top:1px solid var(--border); background:var(--panel);
  }
  .settings-btn {
    border:none; background:transparent; color:var(--text);
    font-size:13px; font-weight:600; cursor:pointer;
    padding:8px 12px; border-radius:10px; transition:background .18s, color .18s;
  }
  .settings-btn:hover { background:var(--hover); color:var(--accent); }
  .ver { font-size:11px; color:var(--sub); }
  .about-link { color:var(--accent); cursor:pointer; text-decoration:underline; font-size:11px; }
  .about-link:hover { opacity:.75; }
  /* 设置面板 */
  .sheet-mask {
    position:fixed; inset:0; z-index:30; background:rgba(0,0,0,.28);
    opacity:0; pointer-events:none; transition:opacity .24s;
  }
  .sheet-mask.open { opacity:1; pointer-events:auto; }
  .sheet {
    position:fixed; left:0; right:0; bottom:0; z-index:40;
    background:var(--panel);
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    border-top-left-radius:20px; border-top-right-radius:20px;
    padding:14px 18px 20px;
    box-shadow:0 -8px 30px rgba(0,0,0,.20);
    transform:translateY(110%);
    transition:transform .28s cubic-bezier(.2,.8,.2,1);
  }
  .sheet.open { transform:translateY(0); }
  .sheet-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .sheet-head span { font-size:14px; font-weight:700; }
  .sheet-close {
    border:none; background:transparent; color:var(--sub);
    font-size:14px; cursor:pointer; width:28px; height:28px; border-radius:8px;
  }
  .sheet-close:hover { background:var(--hover); color:var(--text); }
  .sheet-body {
    max-height:70vh;
    overflow-y:auto;
    padding-right:4px;
    scrollbar-width:thin;
  }
  /* 细窄、圆角、半透明的滚动条（默认的系统滚动条太丑） */
  .sheet-body::-webkit-scrollbar { width:8px; height:8px; }
  .sheet-body::-webkit-scrollbar-track { background:transparent; }
  .sheet-body::-webkit-scrollbar-thumb {
    background:rgba(128,128,128,.30);
    border:2px solid transparent;
    background-clip:padding-box;
    border-radius:8px;
  }
  .sheet-body::-webkit-scrollbar-thumb:hover {
    background:rgba(128,128,128,.55);
    background-clip:padding-box;
  }
  .sheet-body::-webkit-scrollbar-button { display:none; width:0; height:0; }
  .sheet-body::-webkit-scrollbar-corner { background:transparent; }
  .sec-title { font-size:11.5px; color:var(--sub); margin:12px 0 8px; font-weight:600; }
  .sec-title:first-child { margin-top:0; }
  .field-label { font-size:11.5px; font-weight:600; color:var(--sub); margin:10px 0 6px; }
  .theme-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; }
  .theme-card {
    height:46px; border-radius:12px; cursor:pointer; position:relative;
    border:2px solid transparent; transition:border-color .18s, box-shadow .18s;
  }
  .theme-card.active { border-color:var(--accent); box-shadow:0 0 0 3px var(--shadow); }
  .theme-card span {
    position:absolute; left:0; right:0; bottom:4px; text-align:center;
    font-size:10px; color:#333; text-shadow:0 1px 2px rgba(255,255,255,.7);
  }
  /* 暗色主题卡片：标签改用浅色，否则看不见 */
  .theme-card.dark span { color:#e9eef5; text-shadow:0 1px 2px rgba(0,0,0,.65); }
  .sel {
    width:100%; padding:10px 12px; font-size:12.5px; cursor:pointer;
    color:var(--text); background:var(--hover);
    border:1px solid var(--border); border-radius:10px; outline:none;
  }
  /* 下拉框 + 右侧「说明」入口 */
  .sel-row { display:flex; gap:8px; align-items:stretch; }
  .sel-row .sel { flex:1; min-width:0; }
  .info-btn {
    flex:0 0 auto; min-height:28px; padding:4px 12px; border-radius:10px; cursor:pointer;
    font-size:12px; font-weight:600; white-space:nowrap;
    color:var(--accent); background:var(--hover);
    border:1px solid var(--border);
    transition:background .18s, color .18s, border-color .18s;
  }
  .info-btn:hover { background:var(--accent); color:var(--accentText); border-color:transparent; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:14px; }
  .row-label { font-size:12.5px; flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .row-hint { font-size:10.5px; color:var(--sub); }
  .switch { position:relative; display:inline-block; width:44px; height:24px; flex:0 0 44px; }
  .switch input { opacity:0; width:0; height:0; }
  .switch .track {
    position:absolute; inset:0; background:var(--hover);
    border:1px solid var(--border); border-radius:24px; transition:.2s;
  }
  .switch .track::before {
    content:''; position:absolute; width:18px; height:18px; left:2px; top:2px;
    background:#fff; border-radius:50%; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:.2s;
  }
  .switch input:checked + .track { background:linear-gradient(135deg, var(--accent), var(--accent2)); border-color:transparent; }
  .switch input:checked + .track::before { transform:translateX(20px); }
  .guide { font-size:11.5px; color:var(--sub); line-height:1.75; }
  .guide ol { margin:6px 0 0 16px; padding:0; }
  .guide li { margin-bottom:5px; }
  .guide .step-name { color:var(--text); font-weight:600; }
  .guide .done { margin-top:8px; }
  /* 说明弹层（盖在设置面板之上） */
  .help-mask {
    position:fixed; inset:0; z-index:50; background:rgba(0,0,0,.34);
    opacity:0; pointer-events:none; transition:opacity .22s;
  }
  .help-mask.open { opacity:1; pointer-events:auto; }
  .help-card {
    position:fixed; z-index:60; left:50%; top:50%;
    width:min(320px, 88vw); max-height:70vh;
    display:flex; flex-direction:column; padding:14px 16px 16px;
    background:var(--panel);
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    border:1px solid var(--border); border-radius:16px;
    box-shadow:0 12px 36px rgba(0,0,0,.28);
    transform:translate(-50%,-46%) scale(.96); opacity:0; pointer-events:none;
    transition:transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s;
  }
  .help-card.open { transform:translate(-50%,-50%) scale(1); opacity:1; pointer-events:auto; }
  .help-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .help-head span { font-size:13.5px; font-weight:700; }
  .help-body { overflow-y:auto; padding-right:4px; scrollbar-width:thin; }
  .help-body::-webkit-scrollbar { width:8px; }
  .help-body::-webkit-scrollbar-track { background:transparent; }
  .help-body::-webkit-scrollbar-thumb {
    background:rgba(128,128,128,.30); border:2px solid transparent;
    background-clip:padding-box; border-radius:8px;
  }
  .help-body::-webkit-scrollbar-thumb:hover { background:rgba(128,128,128,.55); background-clip:padding-box; }
  .help-body .h { display:block; margin-top:10px; color:var(--text); font-weight:700; }
  .help-body .h:first-child { margin-top:0; }
  .help-body p { margin:3px 0 0; }
  .help-body code {
    font-family:inherit; font-size:11px; color:var(--text);
    background:var(--hover); padding:1px 4px; border-radius:4px;
  }
</style>
</head>
<body>
  <header class="titlebar">
    <div class="tb-left">
      <img class="tb-logo" src="${logoDataUrl}" onerror="this.style.display='none'">
      <span class="tb-title">火影忍者启动器</span>
    </div>
    <div class="tb-actions">
      <button class="tb-btn" id="btnDebug" title="调试控制台">🐞</button>
      <button class="tb-btn" id="btnMin" title="最小化">&#8211;</button>
      <button class="tb-btn tb-close" id="btnClose" title="关闭">&#10005;</button>
    </div>
  </header>

  <main class="content">
    <div class="game-list">
      <div class="game-card" onclick="launchGame('https://huoying.qq.com/', '火影忍者Online')">
        <div class="gc-emoji">&#128293;</div>
        <div class="gc-body">
          <div class="gc-title">火影忍者Online</div>
          <div class="gc-sub">huoying.qq.com</div>
        </div>
        <span class="gc-online" id="onlineFire"><i class="dot"></i><b>--</b></span>
        <div class="gc-go">&#8250;</div>
      </div>
      <div class="game-card" onclick="launchGame('https://www.4399.com/', '4399小游戏')">
        <div class="gc-emoji">&#127918;</div>
        <div class="gc-body">
          <div class="gc-title">4399小游戏</div>
          <div class="gc-sub">www.4399.com</div>
        </div>
        <span class="gc-online" id="onlineMini"><i class="dot"></i><b>--</b></span>
        <div class="gc-go">&#8250;</div>
      </div>
    </div>

    <div class="quick">
      <button class="pill" onclick="joinQQGroup()">&#128172; 加入QQ群</button>
      <button class="pill" onclick="openSite()">&#127760; 官方网站</button>
    </div>
  </main>

  <footer class="bottombar">
    <button class="settings-btn" id="btnSettings">&#9881; 设置</button>
    <span class="ver">v${CURRENT_VERSION} · <span class="about-link" id="aboutLink">关于</span></span>
  </footer>

  <div class="sheet-mask" id="sheetMask"></div>
  <section class="sheet" id="sheet">
    <div class="sheet-head">
      <span>设置</span>
      <button class="sheet-close" id="btnSheetClose">&#10005;</button>
    </div>
    <div class="sheet-body">
      <div class="sec-title">主题</div>
      <div class="theme-grid" id="themeGrid"></div>

      <div class="sec-title">游戏</div>
      <div class="field-label">Flash 版本</div>
      <div class="sel-row">
        <select class="sel" id="flashSelect" onchange="changeFlash(this.value)">
          <option value="system">国内版 34.0.0.376（默认）</option>
          <option value="bundled">国际版 32.0.0.344</option>
        </select>
        <button class="info-btn" onclick="openHelp('flash')" title="Flash 版本说明">说明</button>
      </div>
      <div class="field-label">游戏入口</div>
      <div class="sel-row">
        <select class="sel" id="gameEntrySel" onchange="changeGameEntry(this.value)">
          <option value="qqgame">QQ游戏大厅（默认）</option>
          <option value="official">官网</option>
        </select>
        <button class="info-btn" onclick="openHelp('gameEntry')" title="游戏入口说明">说明</button>
      </div>

      <div class="sec-title">画面</div>
      <div class="field-label">画面画质</div>
      <div class="sel-row">
        <select class="sel" id="qualitySel" onchange="changeFlashQuality(this.value)">
          <option value="high">高（默认）</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <button class="info-btn" onclick="openHelp('quality')" title="游戏画面画质说明">说明</button>
      </div>
      <div class="field-label">渲染分辨率</div>
      <div class="sel-row">
        <select class="sel" id="renderModeSel" onchange="changeRenderMode(this.value)"></select>
        <button class="info-btn" onclick="openHelp('render')" title="渲染分辨率说明">说明</button>
      </div>

      <div class="sec-title">性能</div>
      <div class="row">
        <span class="row-label">强制启用 GPU</span>
        <button class="info-btn" onclick="openHelp('gpu')" title="强制启用 GPU 说明">说明</button>
        <label class="switch">
          <input type="checkbox" id="gpuChk" onchange="toggleForceGpu(this.checked)">
          <span class="track"></span>
        </label>
      </div>
      <div class="row">
        <span class="row-label">兼容模式</span>
        <button class="info-btn" onclick="openHelp('software')" title="兼容模式说明">说明</button>
        <label class="switch">
          <input type="checkbox" id="swChk" onchange="toggleSoftwareRender(this.checked)">
          <span class="track"></span>
        </label>
      </div>

      <div class="sec-title">抓包</div>
      <div class="sel-row">
        <select class="sel" id="captureModeSel" onchange="changeCaptureMode(this.value)">
          <option value="off">关闭</option>
          <option value="stats">组织统计（Excel）</option>
          <option value="full">全量抓包</option>
          <option value="quiz">题库抓包（忍者检测）</option>
          <option value="miao">题库抓包（喵问答）</option>
          <option value="shop">商城特惠</option>
        </select>
        <button class="info-btn" onclick="openHelp('capture')" title="抓包模式说明">说明</button>
      </div>
      <div class="row">
        <span class="row-label">抓包缓存<span class="row-hint" id="capInfo">统计中…</span></span>
        <button class="info-btn" onclick="clearCaptures()" title="删除已抓取的 netlog 文件">清理</button>
      </div>
    </div>
  </section>

  <div class="help-mask" id="helpMask"></div>
  <section class="help-card" id="helpCard">
    <div class="help-head">
      <span id="helpTitle"></span>
      <button class="sheet-close" id="btnHelpClose">&#10005;</button>
    </div>
    <div class="help-body guide" id="helpBody"></div>
  </section>

  <script>
    const { ipcRenderer, shell } = require('electron');
    const THEMES = ${JSON.stringify(THEMES)};
    let curTheme = '${currentTheme}';

    function launchGame(url, name) { ipcRenderer.send('launch-game', { url: url, name: name }); }
    function joinQQGroup() { shell.openExternal('https://qm.qq.com/q/kHOKaFZRqo'); }
    function openSite() { shell.openExternal('http://49.235.142.253/'); }
    function changeFlash(choice) { ipcRenderer.send('set-flash-choice', choice); }
    function changeCaptureMode(mode) { ipcRenderer.send('set-capture-mode', mode); }
    function toggleForceGpu(on) { ipcRenderer.send('set-force-gpu', on); }
    function changeGameEntry(v) { ipcRenderer.send('set-game-entry', v); }
    function changeFlashQuality(v) { ipcRenderer.send('set-flash-quality', v); }
    function changeRenderMode(v) { ipcRenderer.send('set-render-config', v); }
    function changeUiScale(v) { ipcRenderer.send('set-ui-scale', v); }
    function toggleSoftwareRender(on) { ipcRenderer.send('set-software-render', on); }
    function refreshStorageInfo() { ipcRenderer.send('get-storage-info'); }
    function clearCaptures() { ipcRenderer.send('clear-captures'); }

    function fmtBytes(n) {
      n = n || 0;
      if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
      return n + ' B';
    }
    function setTheme(t) { ipcRenderer.send('set-theme', t); }

    function applyTheme(t) {
      const th = THEMES[t] || THEMES.mint;
      const r = document.documentElement.style;
      r.setProperty('--bg', th.bg);
      r.setProperty('--panel', th.panel);
      r.setProperty('--border', th.panelBorder);
      r.setProperty('--text', th.text);
      r.setProperty('--sub', th.sub);
      r.setProperty('--accent', th.accent);
      r.setProperty('--accent2', th.accent2);
      r.setProperty('--accentText', th.accentText);
      r.setProperty('--hover', th.hover);
      r.setProperty('--shadow', th.shadow);
      const cards = document.querySelectorAll('.theme-card');
      for (let i = 0; i < cards.length; i++) {
        cards[i].classList.toggle('active', cards[i].dataset.theme === t);
      }
      curTheme = t;
    }

    // 底色相对亮度判断：暗色主题的卡片标签要用浅色字
    function isDarkColor(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
      if (!m) return false;
      const n = parseInt(m[1], 16);
      const r = (n >> 16) & 255, g2 = (n >> 8) & 255, b = n & 255;
      return (0.299 * r + 0.587 * g2 + 0.114 * b) < 140;
    }

    (function buildThemeGrid() {
      const g = document.getElementById('themeGrid');
      Object.keys(THEMES).forEach(function (k) {
        const th = THEMES[k];
        const c = document.createElement('div');
        c.className = 'theme-card';
        c.dataset.theme = k;
        c.style.background = th.bg;
        if (isDarkColor(th.winBg)) c.classList.add('dark');
        c.innerHTML = '<span>' + th.name + '</span>';
        c.onclick = function () { setTheme(k); };
        g.appendChild(c);
      });
    })();

    const sheet = document.getElementById('sheet');
    const mask = document.getElementById('sheetMask');
    function openSheet() {
      sheet.classList.add('open');
      mask.classList.add('open');
      refreshStorageInfo();
    }
    function closeSheet() { sheet.classList.remove('open'); mask.classList.remove('open'); }

    // ---------- 设置项说明弹层 ----------
    const HELP = {
      flash: {
        title: 'Flash 版本说明',
        html:
          '<span class="h">国内版 34.0.0.376（默认）</span>' +
          '<p>去掉广告与检测组件的纯净版，版本较新；部分机器可能提示「必要组件缺失 / 地区不相容」。</p>' +
          '<span class="h">国际版 32.0.0.344</span>' +
          '<p>Adobe 官方国际版，不依赖后台服务，进游戏最稳；版本较旧，个别新内容可能不兼容。</p>' +
          '<span class="h">怎么选</span>' +
          '<p>默认用国内版即可；遇到不兼容再切国际版。切换后需重启启动器生效。</p>'
      },
      capture: {
        title: '抓包模式说明',
        html:
          '<span class="h">关闭</span>' +
          '<p>不抓包，性能最好（默认）。</p>' +
          '<span class="h">组织统计（生成 Excel）</span>' +
          '<p>重启后进入游戏，依次打开下面 5 个界面（打开即会被记录）：</p>' +
          '<ol>' +
          '<li><span class="step-name">组织成员</span>：组织 → 组织成员</li>' +
          '<li><span class="step-name">本周捐献</span>：组织 → 组织捐献 → 本周捐献</li>' +
          '<li><span class="step-name">叛忍数据</span>：大和 → 叛忍再临 → 管理员 → 我的组织 → 查看详情</li>' +
          '<li><span class="step-name">通灵兽献祭</span>：组织 → 组织基地 → 深作 → 组织通灵兽管理员 → 组织通灵兽 → 献祭 → 本周献祭</li>' +
          '<li><span class="step-name">忍战数据</span>：忍界大战参谋（或 跨服忍界大战接引忍者）→ 参与忍界大战（或 参加跨服忍界大战）→ 礼包分配</li>' +
          '</ol>' +
          '<p>抓包期间会略微卡顿，属正常现象。完成后：① 关闭「火影忍者」游戏窗口 ② 托盘图标右键 → 关闭启动器。退出后会自动在桌面「火影组织数据 / 日期」生成 6 张 Excel。</p>' +
          '<span class="h">全量抓包（导出原始文件）</span>' +
          '<p>重启后正常玩游戏即可，不会生成 Excel。退出启动器时把本次会话的全部原始网络数据导出到桌面「火影全量抓包 / 时间」，含 net-log（socket 原始字节）、http jsonl 与一份说明.txt。用于以后做更深入的数据分析；文件可能较大，分析完可自行删除。</p>' +
          '<span class="h">题库抓包（忍者检测）</span>' +
          '<p>重启后找考官红豆做「忍者检测」，把 10 道题答完（答错的题也能抓，只是拿不到正确答案）。</p>' +
          '<p>完成后关闭游戏窗口，再走托盘「退出」，会在桌面「火影题库 / 忍者检测_时间.json」生成题库，内容为：题目、四个选项、正确选项。</p>' +
          '<p>因为同一道题的选项顺序每次可能不同，正确选项存的是选项原文，不是 A/B/C/D；本次答错的题正确选项为空字符串。</p>' +
          '<span class="h">题库抓包（喵问答）</span>' +
          '<p>重启后参加「喵问答」活动，把题答完。退出后在桌面「火影题库 / 喵问答_时间」生成 questions.json 和 images 文件夹。</p>' +
          '<p>每条记录含：题干、四个选项、正确答案（答对才有）、我选的选项、活动加成排除的错误选项、配图路径。带图的题会把图片一起存到 images 里，文件名形如 03_10082.png（题号_资源ID）。</p>' +
          '<p>协议本身不传正确答案（服务端判分），所以答错的题 answer 为空，但 bonusRemoved 一定是错误选项，可用排除法；同一道题多答几轮即可逐步补齐答案。</p>' +
          '<span class="h">商城特惠（导出 JSON + 图片）</span>' +
          '<p>重启后进入游戏，打开「商城特惠」面板，<b>把 16 张商品卡片上下滚动一遍</b>（滚动到哪张，游戏才会去下载哪张的图标），然后关闭游戏窗口、走托盘「退出」。</p>' +
          '<p>导出到桌面「火影商城特惠 / 商城特惠_时间」，含：商城特惠.json（活动时间、当日窗口、每件商品的每日限购 / 已购 / 剩余 / 折扣价 / 时间范围）、商城特惠.txt（同内容的可读表格，所有时间都带星期）、images 文件夹（商品图标）。</p>' +
          '<p>时间一律按服务器时间（UTC+8）换算，不受本机时区影响；每日限购每天 05:00 刷新，当日窗口即「当天 05:00 ~ 次日 04:59:59」。</p>' +
          '<p>物品图标只能来自游戏真实请求，没法按 ID 拼地址；没滚到的卡片会显示为缺失，重新抓一次并把卡片滚全即可。</p>' +
          '<span class="h">通用</span>' +
          '<p>切换模式后需重启启动器生效；导出必须走托盘「退出」，直接关窗口会导致数据写不完、导不出。</p>'
      },
      gameEntry: {
        title: '游戏入口说明',
        html:
          '<p>决定游戏窗口打开哪个页面，<b>新开窗口生效</b>。</p>' +
          '<span class="h">官网入口（默认）</span>' +
          '<p>直接打开火影官网 <code>huoying.qq.com</code>，登录页是官网样式。稳定、改动少。</p>' +
          '<span class="h">QQ游戏大厅入口</span>' +
          '<p>打开 QQ 游戏大厅内嵌页 <code>minigame.qq.com/.../app_frame/?appid=10190</code>，登录页显示「QQ游戏」。</p>' +
          '<p>好处：登录后更容易抓到 skey 凭证，配合账号栏可以直接一键进游戏；部分机器观感更好。短板：页面结构由腾讯维护，改版时可能需要切回官网。</p>' +
          '<span class="h">怎么选</span>' +
          '<p>先按默认官网用；如果想用账号栏的凭证直连、或者想对比登录页/画面效果，再切到 QQ 游戏大厅。切回官网随时可以。</p>'
      },
      quality: {
        title: '游戏画面画质说明',
        html:
          '<p>等同于游戏里右键 Flash 画面 →「品质」→ 低 / 中 / 高，设置一次即可，不用每次进游戏手动调。</p>' +
          '<span class="h">高（默认）</span>' +
          '<p>保留完整抗锯齿与画面平滑度，角色、场景边缘最细腻，最吃性能。</p>' +
          '<span class="h">中</span>' +
          '<p>画质与性能折中，适合想稍微流畅一点、但不想画面太糙的情况。</p>' +
          '<span class="h">低</span>' +
          '<p>关闭大部分抗锯齿与平滑处理，角色和场景边缘会明显变硬、变糙，但最省性能，多开 / 低配机器更流畅。</p>' +
          '<span class="h">生效范围</span>' +
          '<p>对<b>新开的游戏窗口和新标签</b>生效；已经加载完的标签可能保持原画质，需要新开标签才会完全切换。后台标签始终使用低画质，窗口失焦时整窗临时降低，回到前台后活跃标签恢复为你选的画质。</p>' +
          '<p>注意：这是 Flash 的渲染品质，不是分辨率；调到低不会让画面变模糊发虚，主要是去掉了边缘平滑。</p>'
      },
      gpu: {
        title: '强制启用 GPU 说明',
        html:
          '<p>这个开关决定启动时是否加 <code>--ignore-gpu-blacklist</code>（无视显卡驱动的黑名单，强制启用硬件加速）。</p>' +
          '<span class="h">开启（默认）</span>' +
          '<p>优点：页面 / Flash 由显卡渲染，更流畅，CPU 占用更低，多开时更省资源。</p>' +
          '<p>缺点：驱动本身有问题的机器可能出现花屏、闪烁、黑屏、掉帧，甚至启动失败。</p>' +
          '<span class="h">关闭</span>' +
          '<p>优点：交给 Chromium 按官方黑名单判断，稳定性更好，驱动异常的机器不容易花屏 / 崩溃。</p>' +
          '<p>缺点：可能回退到软件渲染，渲染压力转到 CPU，多开或长时间玩更容易卡顿、发热。</p>' +
          '<span class="h">什么时候开 / 关</span>' +
          '<p>默认开着就行。显卡驱动较新、以前没出现过花屏 / 闪烁 → 保持开启。</p>' +
          '<p>出现花屏、闪烁、黑屏、画面撕裂，或启动即崩溃 → 关掉再试。切换后需重启启动器生效。</p>' +
          '<p>如果关掉后仍然卡死，说明驱动本身有问题，请改用下面的「兼容模式」。</p>'
      },
      software: {
        title: '兼容模式说明',
        html:
          '<p>兼容模式即软件渲染：开启后启动参数会加 <code>--disable-gpu</code> 与 <code>--disable-gpu-compositing</code>，完全不走显卡渲染。</p>' +
          '<span class="h">什么时候用</span>' +
          '<p>游戏窗口在打开面板、进入战斗、战斗结算时<strong>直接卡死</strong>，并且「强制启用 GPU」已经关闭也没用 —— 说明显卡驱动本身有问题，这时开软件渲染最有效。</p>' +
          '<span class="h">优点 / 缺点</span>' +
          '<p>优点：绕开显卡驱动，稳定性最好，不容易花屏 / 卡死。</p>' +
          '<p>缺点：渲染压力全部转到 CPU，帧率下降、CPU 占用升高，多开时更明显。</p>' +
          '<span class="h">注意</span>' +
          '<p>开启后「强制启用 GPU」不起作用（软件渲染优先）。切换后需重启启动器生效。</p>' +
          '<p>如果只是偶尔卡一下、能自己恢复，不建议开这个。</p>'
      },
      render: {
        title: '渲染分辨率说明',
        html:
          '<p>决定游戏内部按多少像素渲染，再铺满窗口。越高越清晰，越低越省性能。</p>' +
          '<span class="h">默认 1600×900</span>' +
          '<p>清晰度和性能比较均衡；配置够就直接选 1920×1080。</p>' +
          '<span class="h">最大化 / 全屏</span>' +
          '<p>缩放倍率会自动取 1/8 步进（1.125 / 1.25 / 1.375 / 1.5…），让地图方块边界落在整数像素上，避免出现细黑线；同时逻辑视口不会超过所选分辨率，不会渲染出多余的黑边。</p>' +
          '<span class="h">注意</span>' +
          '<p>只改渲染像素，不改窗口大小；窗口大小可以自由拖动。</p>'
      },
      uiScale: {
        title: '界面缩放说明',
        html:
          '<p>只影响启动器窗口和游戏窗口的工具栏 / 侧栏 / 弹窗，不影响游戏画面本身。</p>' +
          '<span class="h">自动</span>' +
          '<p>跟随系统 DPI 缩放。</p>' +
          '<span class="h">固定百分比</span>' +
          '<p>高分屏上如果系统放大让界面显得太大，选 100% 可以完全避开系统放大（窗口会偏小）。</p>'
      },
      about: {
        title: '关于',
        html:
          '<span class="h">作者</span>' +
          '<p>lijin · QQ 3025863517 · 邮箱 a3025863517@163.com</p>' +
          '<p>Q 群：489455643</p>' +
          '<span class="h">关于启动器</span>' +
          '<p>火影忍者 Online 页游桌面启动器，开源项目，基于 Electron + PPAPI Flash。</p>' +
          '<span class="h">主要亮点</span>' +
          '<p>多标签 / 多账号、一键启动、凭证自动登录与本地加密、画质与分辨率调节、变速、窗口透明度、老板键、绿色免安装。</p>' +
          '<span class="h">开源与署名</span>' +
          '<p>本项目开源，欢迎学习与二次开发；修改或分发时请保留原作者 lijin 及本关于信息。</p>'
      },
    };

    const helpMask = document.getElementById('helpMask');
    const helpCard = document.getElementById('helpCard');
    function openHelp(key) {
      const h = HELP[key];
      if (!h) return;
      document.getElementById('helpTitle').textContent = h.title;
      document.getElementById('helpBody').innerHTML = h.html;
      helpMask.classList.add('open');
      helpCard.classList.add('open');
    }
    function closeHelp() {
      helpMask.classList.remove('open');
      helpCard.classList.remove('open');
    }
    document.getElementById('btnHelpClose').onclick = closeHelp;
    helpMask.onclick = closeHelp;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeHelp();
    });


    document.getElementById('btnDebug').onclick = function () { ipcRenderer.send('open-debug-console'); };
    document.getElementById('btnMin').onclick = function () { ipcRenderer.send('launcher-minimize'); };
    document.getElementById('btnClose').onclick = function () { ipcRenderer.send('launcher-close'); };
    document.getElementById('btnSettings').onclick = openSheet;
    document.getElementById('aboutLink').onclick = function () { openHelp('about'); };
    document.getElementById('btnSheetClose').onclick = closeSheet;
    mask.onclick = closeSheet;

    // 鼠标在面板外的遮罩区域滚动时，也把设置内容跟着滚（否则会以为"滚动坏了"）
    mask.addEventListener('wheel', function (e) {
      const b = document.querySelector('.sheet-body');
      if (!b) return;
      b.scrollTop += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    ipcRenderer.on('theme-changed', function (e, t) { applyTheme(t); });
    ipcRenderer.on('flash-choice', function (e, c) {
      const s = document.getElementById('flashSelect');
      if (s) s.value = c || 'system';
    });
    ipcRenderer.on('capture-mode-state', function (e, mode) {
      const s = document.getElementById('captureModeSel');
      if (s) s.value = mode || 'off';
    });
    ipcRenderer.on('force-gpu-state', function (e, on) {
      const c = document.getElementById('gpuChk');
      if (c) c.checked = !!on;
    });
    ipcRenderer.on('game-entry-state', function (e, v) {
      const s = document.getElementById('gameEntrySel');
      if (s) s.value = v || 'official';
    });
    ipcRenderer.on('flash-quality-state', function (e, v) {
      const s = document.getElementById('qualitySel');
      if (s) s.value = (v === 'low' || v === 'medium') ? v : 'high';
    });
    ipcRenderer.on('render-config-state', function (e, cfg) {
      const s = document.getElementById('renderModeSel');
      if (!s || !cfg) return;
      const opts = cfg.options || [];
      s.innerHTML = '';
      const g = document.createElement('optgroup');
      g.label = '16:9 · 越高越清晰，越低越省性能';
      opts.forEach(function (o) {
        const op = document.createElement('option');
        op.value = 'fixed:' + o.w + 'x' + o.h;
        op.textContent = o.w + '×' + o.h;
        g.appendChild(op);
      });
      s.appendChild(g);
      const value = 'fixed:' + cfg.width + 'x' + cfg.height;
      s.value = value;
      if (s.value !== value && opts.length) {
        s.value = 'fixed:' + opts[0].w + 'x' + opts[0].h;
      }
    });
    ipcRenderer.on('ui-scale-state', function (e, v) {
      const s = document.getElementById('uiScaleSel');
      if (!s) return;
      const val = String(v == null ? 0 : v);
      s.value = val;
      if (s.value !== val) s.value = '0';
    });
    ipcRenderer.on('software-render-state', function (e, on) {
      const c = document.getElementById('swChk');
      if (c) c.checked = !!on;
    });
    ipcRenderer.on('storage-info', function (e, info) {
      const el = document.getElementById('capInfo');
      if (!el) return;
      el.textContent = (info && info.files)
        ? fmtBytes(info.bytes) + ' · ' + info.files + ' 个文件'
        : '无缓存';
    });
    ipcRenderer.on('storage-cleared', function (e, info) {
      const el = document.getElementById('capInfo');
      if (!el) return;
      const freed = info && info.freed ? fmtBytes(info.freed) : '0 B';
      el.textContent = '已释放 ' + freed + ' · 现在 ' + fmtBytes(info && info.bytes);
    });
    function setOnline(id, n) {
      const el = document.getElementById(id);
      if (!el) return;
      const b = el.querySelector('b');
      if (b) b.textContent = (typeof n === 'number') ? String(n) : '--';
    }
    ipcRenderer.on('online-update', function (e, data) {
      setOnline('onlineFire', data && data.fire);
      setOnline('onlineMini', data && data.mini);
    });

    document.addEventListener('DOMContentLoaded', function () { applyTheme(curTheme); });
  </script>
</body>
</html>`;

  launcherWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(launcherHtml));

  launcherWindow.webContents.on('did-finish-load', () => {
    launcherWindow.webContents.send('theme-changed', currentTheme);
    launcherWindow.webContents.send('flash-choice', config.flashChoice);
    launcherWindow.webContents.send('capture-mode-state', normalizeCaptureMode(config.captureMode));
    launcherWindow.webContents.send('force-gpu-state', config.forceGpu !== false);
    launcherWindow.webContents.send('game-entry-state', normalizeGameEntry(config.gameEntry));
    launcherWindow.webContents.send('flash-quality-state', normalizeFlashQuality(config.flashQuality));
    launcherWindow.webContents.send('render-config-state', getRenderConfig());
    launcherWindow.webContents.send('ui-scale-state', normalizeUiScale(config.uiScale));
    launcherWindow.webContents.send('software-render-state', !!config.softwareRender);
    // 窗口重建时补发在线人数，避免空白
    const lastOnline = online.getLast();
    launcherWindow.webContents.send('online-update', lastOnline || { fire: null, mini: null });
  });

  // 关闭即销毁（不再 hide）：玩游戏时启动器不必常驻一个渲染进程，托盘可随时重新打开。
  // 注意：因此 window-all-closed 不再退出应用（见文件末尾），退出统一走托盘菜单 / before-quit。
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  log('启动器窗口创建成功');
}

// 显示启动器：窗口不存在（已销毁）时重建
function showLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    if (launcherWindow.isMinimized()) launcherWindow.restore();
    launcherWindow.show();
    launcherWindow.focus();
    return launcherWindow;
  }
  createLauncherWindow();
  return launcherWindow;
}

// 游戏窗口固定 16:9 普通窗口（约工作区 85% 宽，最大 1728），不跟着渲染分辨率变化。
// 窗口内的游戏按所选逻辑分辨率渲染后铺满窗口（见 game.html computeRenderTarget）。
function computeFixedContentSize(display) {
  const d = display || screen.getPrimaryDisplay();
  const wa = d.workAreaSize;
  const maxH = Math.max(360, wa.height - 44);   // 44 = 工具栏
  let w = Math.min(1728, Math.floor(wa.width * 0.85), Math.floor(maxH * 16 / 9));
  w = Math.max(640, w);
  let h = Math.round(w * 9 / 16);
  return { w: w, h: Math.max(360, h) };
}

// 游戏区域宽高比（固定 16:9）
const GAME_ASPECT = 9 / 16;

// 拖拽缩放时按 16:9 修正（窗口高 = 游戏高 + 44 工具栏）
function fitAspectBounds(bounds, edge, toolbar) {
  const tb = typeof toolbar === 'number' ? toolbar : 44;
  const vertical = edge === 'top' || edge === 'bottom';
  let w = Math.max(640, bounds.width);
  let h = Math.max(360, bounds.height - tb);
  if (vertical) w = Math.round(h / GAME_ASPECT);
  else h = Math.round(w * GAME_ASPECT);
  w = Math.max(640, w);
  h = Math.max(360, h);
  const out = { x: bounds.x, y: bounds.y, width: w, height: h + tb };
  if (String(edge).indexOf('left') >= 0) out.x = bounds.x + (bounds.width - w);
  if (String(edge).indexOf('top') >= 0) out.y = bounds.y + (bounds.height - (h + tb));
  return out;
}

function createGameWindow(url, gameName, account, opts) {
  if (!url) url = DEFAULT_URL;
  if (!gameName) gameName = '火影忍者Online';

  // plain = 非火影（如 4399）：加载极简窗口，不显示火影工具栏
  const plain = !!(opts && opts.plain);

  // 游戏入口：官网（默认）/ QQ 游戏大厅 app_frame（闪客入口，登录页显示 QQ游戏）
  if (!plain && !(opts && opts.exactUrl) && config.gameEntry === 'qqgame') url = QQGAME_ENTRY_URL;

  // 本窗口的会话槽位：让不同窗口的标签使用互不冲突的 partition（避免多窗口串号）
  const windowSlot = ++gameWindowSlotCounter;

  const displays = screen.getAllDisplays();
  let primaryDisplay = screen.getPrimaryDisplay();

  if (displays.length > 1) {
    const mousePos = screen.getCursorScreenPoint();
    const currentDisplay = displays.find(display => {
      const bounds = display.bounds;
      return mousePos.x >= bounds.x && mousePos.x <= bounds.x + bounds.width &&
            mousePos.y >= bounds.y && mousePos.y <= bounds.y + bounds.height;
    });
    if (currentDisplay) {
      primaryDisplay = currentDisplay;
    }
  }

  const { width, height } = primaryDisplay.workAreaSize;
  const toolbarHeight = 44;

  let gameWidth;
  let gameHeight;
  if (plain) {
    const maxGameWidth = 1440;
    const maxGameHeight = 810;
    gameWidth = Math.min(Math.floor(width * 0.95), maxGameWidth);
    gameHeight = Math.min(Math.floor(height * 0.95) - toolbarHeight, maxGameHeight);
  } else {
    // 火影窗口固定 16:9 普通尺寸（约工作区 85% 宽，最大 1728），不会占满屏幕
    const fixed = computeFixedContentSize(primaryDisplay);
    gameWidth = fixed.w;
    gameHeight = fixed.h;
  }
  // 用主题底色，避免暗色主题下开窗瞬间闪白
  const gameTheme = THEMES[currentTheme] || THEMES.mint;

  const win = new BrowserWindow({
    width: gameWidth,
    height: gameHeight + toolbarHeight,
    title: gameName,
    frame: false,
    backgroundColor: gameTheme.winBg,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableRemoteModule: true,
      zoomFactor: 1.0,
      defaultFontSize: 16,
      backgroundThrottling: false,
      offscreen: false,
      webviewTag: true
    },
    show: false,
    fullscreenable: true,
    simpleFullscreen: false,
    // 最大化 = 系统最大化（填满工作区、保留任务栏）；全屏 = F11 / 菜单，两者互不替代
    maximizable: true
  });

  win.webContents.setZoomFactor(1.0);
  // 窗口透明度（设置里调过就沿用）
  try { win.setOpacity(normalizeGameOpacity(config.gameOpacity)); } catch (e) { /* ignore */ }

  win.setMenu(null);
  applyProcessPriority();

  // 首帧渲染完成后显示窗口，避免冷启动白屏
  win.once('ready-to-show', () => {
    if (win && !win.isDestroyed()) {
      win.show();
    }
  });

  // 超时兜底：5 秒未触发 ready-to-show 则强制显示
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }, 5000);

  // 加载页面：火影用 game.html（带工具栏），其余（4399 等）用 browser.html（极简）
  win.loadFile(plain ? 'src/ui/browser.html' : 'src/ui/game.html');

  // 卡死/崩溃看门狗：宿主页面 + 每个 webview 客进程
  // 同时统计「标签页数」用于在线人数：每附加一个 webview 算 1，销毁时减 1
  const winLabel = 'game#slot' + (windowSlot || '?');
  const tabEntry = { win, plain: !!plain, tabs: 0 };
  const guestWcs = [];   // 该窗口里的 webview 客进程（用于最小化/还原后强制重绘）

  // Flash 窗口化插件在最小化→还原、最大化→还原后经常不重绘（画面一动不动）。
  // 这里对宿主页和所有 webview 客进程强制 invalidate 一次，让合成器重新出图。
  const repaintWindow = () => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.invalidate(); } catch (e) { /* ignore */ }
    guestWcs.forEach((g) => {
      try { if (!g.isDestroyed()) g.invalidate(); } catch (e) { /* ignore */ }
    });
  };

  attachWindowWatch(win.webContents, winLabel + ' host');
  attachShortcuts(win.webContents, win);
  win.webContents.on('did-attach-webview', (event, guest) => {
    attachWindowWatch(guest, winLabel + ' webview');
    attachShortcuts(guest, win);
    attachCredentialCapture(guest);
    attachFlashQualityPatch(guest);
    // 禁用捏合缩放；页面缩放/大屏适配由 game.html 统一处理，这里不要再锁缩放
    try { guest.setVisualZoomLevelLimits(1, 1); } catch (e) { /* ignore */ }
    // 隐藏滚动条：滚动条会占掉视口宽度，导致 1920 逻辑视口被压缩、右侧露出空白
    try {
      guest.on('dom-ready', () => {
        try { guest.insertCSS('::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important;}'); } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    guestWcs.push(guest);
    tabEntry.tabs++;
    trackGameContents(guest);
    applyProcessPriority();
    try {
      guest.on('did-finish-load', applyProcessPriority);
      guest.on('did-stop-loading', applyProcessPriority);
    } catch (e) { /* ignore */ }
    // 页面跳转时同步网址调试窗口里的 URL（含登录后的 zone 参数）
    try {
      const syncUrlTool = () => { try { urlTool.refreshContext(); } catch (e) { /* ignore */ } };
      guest.on('did-navigate', syncUrlTool);
      guest.on('did-navigate-in-page', syncUrlTool);
    } catch (e) { /* ignore */ }
    // 只有用户真的开了加速才注入；1x 不碰未签名 DLL，避免杀软误报和无谓攻击面
    try {
      guest.on('dom-ready', () => {
        if (guest.isDestroyed()) return;
        if (Math.abs(currentSpeedRate - 1) < 1e-6) return;
        try {
          const pid = guest.getOSProcessId();
          if (pid) injectSpeedHook(pid);
        } catch (e) { /* ignore */ }
        injectAllChildProcesses();
        scheduleSpeedRescan();
      });
    } catch (e) { /* ignore */ }
    try {
      guest.once('destroyed', () => {
        tabEntry.tabs = Math.max(0, tabEntry.tabs - 1);
        const i = guestWcs.indexOf(guest);
        if (i >= 0) guestWcs.splice(i, 1);
      });
    } catch (e) { /* ignore */ }
  });


  // 宿主页重载时 did-finish-load 会再次触发；game-info 只发一次，
  // 否则 game.html 收到两次会重复建标签
  let gameInfoSent = false;
  win.webContents.on('did-finish-load', () => {
    if (!gameInfoSent) {
      gameInfoSent = true;
      // 发送游戏信息给页面
      const gameInfo = {
        name: gameName,
        url: url
      };
      win.webContents.send('game-info', {
        game: gameInfo,
        accounts: plain ? [] : accounts,
        account: plain ? null : account,
        diskCache: config.diskCache !== false,
        plain: plain,
        windowSlot: windowSlot,
        flashQuality: normalizeFlashQuality(config.flashQuality),
        renderConfig: getRenderConfig(),
        tabDisplayMode: config.tabDisplayMode === 'taskbar' ? 'taskbar' : 'sidebar',
        uiScale: getUiScale(),
        gameOpacity: normalizeGameOpacity(config.gameOpacity)
      });
    }

    // 发送当前配置
    // 下发当前主题颜色（game.html / browser.html 不再各自维护主题表）
    win.webContents.send('theme-update', getThemeColors());
    win.webContents.send('speed-update', currentSpeedRate);
    win.webContents.send('mute-update', isAudioMuted);
    win.webContents.send('window-state', {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    });

    log('游戏窗口加载完成');
  });

  // 窗口状态（最大化 / 全屏）→ 渲染层决定工具栏是否隐藏、最大化按钮图标
  // 注意：enter/leave-full-screen 触发瞬间 isFullScreen() 可能还是旧值，必须用事件本身的状态
  const sendWindowState = (fsOverride) => {
    if (!win || win.isDestroyed()) return;
    const fullscreen = (typeof fsOverride === 'boolean') ? fsOverride : win.isFullScreen();
    win.webContents.send('fullscreen-changed', fullscreen);
    win.webContents.send('window-state', {
      maximized: win.isMaximized(),
      fullscreen: fullscreen
    });
  };
  win.on('enter-full-screen', () => sendWindowState(true));
  win.on('leave-full-screen', () => sendWindowState(false));
  win.on('maximize', () => sendWindowState());
  win.on('unmaximize', () => sendWindowState());


  const ipcListeners = [];

  const addListener = (channel, handler) => {
    ipcMain.on(channel, handler);
    ipcListeners.push({ channel, handler });
  };

  // 游戏窗口内的 IPC 处理
  addListener('min-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win && win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  addListener('max-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin !== win || !win || win.isDestroyed()) return;
    try {
      // 全屏时点最大化：先退回窗口，再按普通最大化处理
      if (win.isFullScreen()) {
        win.setFullScreen(false);
        return;
      }
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } catch (e) { /* ignore */ }
  });

  addListener('close-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win && win && !win.isDestroyed()) {
      win.close();
    }
  });

  addListener('set-game-speed', (event, speed) => {
    setSpeedRate(speed);
  });

  // 账号相关 IPC
  addListener('get-accounts-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      senderWin.webContents.send('accounts-update', accounts);
    }
  });

  addListener('launch-account-window', (event, payload) => {
    // 在当前窗口添加新标签并自动登录（payload 兼容旧的 accountId 字符串）
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      const accountId = (payload && typeof payload === 'object') ? payload.accountId : payload;
      const zoneId = (payload && typeof payload === 'object') ? payload.zoneId : '';
      const account = accounts.find(a => a.id === accountId);
      if (account) senderWin.webContents.send('launch-account', pickAccountForZone(account, zoneId));
    }
  });

  addListener('launch-all-accounts-window', (event) => {
    // 在当前窗口启动所有账号（每个账号用它最后一次的区服）
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      const validAccounts = accounts.filter(a => a.qq);
      validAccounts.forEach(account => {
        senderWin.webContents.send('launch-account', pickAccountForZone(account, account.lastZoneId));
      });
    }
  });

  addListener('get-config', (event, key) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      senderWin.webContents.send('config-result', config[key]);
    }
  });

  addListener('set-config', (event, key, value) => {
    if (key === 'tabDisplayMode') value = value === 'taskbar' ? 'taskbar' : 'sidebar';
    config[key] = value;
    saveConfig();
  });

  // 窗口状态变化记一笔（排查「最小化后点不了」这类问题用，量很小）
  ['minimize', 'restore', 'maximize', 'unmaximize', 'show', 'hide'].forEach((evt) => {
    win.on(evt, () => {
      if (!win || win.isDestroyed()) return;
      logPerfEvent('WIN', winLabel + ' ' + evt + ' maximized=' + win.isMaximized() + ' visible=' + win.isVisible());
    });
  });

  // 窗口尺寸变化（最大化/还原/拖边框）结束后统一重绘一次，避免 Flash 插件停在旧画面上
  let resizeRepaintTimer = null;
  win.on('resize', () => {
    if (resizeRepaintTimer) clearTimeout(resizeRepaintTimer);
    resizeRepaintTimer = setTimeout(() => {
      resizeRepaintTimer = null;
      repaintWindow();
    }, 220);
  });

  // 最大化 / 最小化还原后，webview 客进程的视口有时不跟着宿主重新布局：
  // 表现为「画面没贴合窗口，拖一下才正常」。用 1px 尺寸抖动强制一次真实 relayout。
  const nudgeResize = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    try { win.setBounds({ x: b.x, y: b.y, width: b.width + 1, height: b.height + 1 }, false); } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      try { win.setBounds(b, false); } catch (e) { /* ignore */ }
      repaintWindow();
    }, 60);
  };
  win.on('unmaximize', () => setTimeout(nudgeResize, 40));
  win.on('restore', () => setTimeout(nudgeResize, 40));

  // 拖拽缩放锁定 16:9（窗口高 = 游戏高 + 44 工具栏）
  if (!plain) {
    let lastEdge = '';
    win.on('will-resize', (event, newBounds, details) => {
      if (!newBounds) return;
      try {
        event.preventDefault();
        const edge = String((details && details.edge) || lastEdge || '');
        lastEdge = edge;
        win.setBounds(fitAspectBounds(newBounds, edge, toolbarHeight), false);
      } catch (e) { /* ignore */ }
    });
  }

  win.on('blur', () => {
    win.webContents.send('window-blur');
  });

  win.on('focus', () => {
    lastGameWin = win;
    win.webContents.send('window-focus');
  });

  win.on('minimize', () => {
    win.webContents.send('window-minimized');
  });

  win.on('restore', () => {
    win.webContents.send('window-restored');
    // 部分情况下从任务栏恢复只触发 show/focus，不触发 restore；这里主动聚焦一次
    try { win.focus(); } catch (e) { /* ignore */ }
    // 最小化→还原后 Flash 插件常常不重绘：分两次轻推，覆盖「一帧都不出」的情况
    setTimeout(repaintWindow, 150);
    setTimeout(repaintWindow, 700);
  });

  // 兜底：从任务栏点回来时即使没触发 restore，也通知渲染层解除暂停并把窗口拉到前台
  win.on('show', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window-restored');
    setTimeout(repaintWindow, 200);
  });

  win.on('closed', () => {
    ipcListeners.forEach(({ channel, handler }) => {
      ipcMain.removeListener(channel, handler);
    });

    log('游戏窗口已关闭');

    const index = gameWindows.findIndex(w => w.win === win);
    if (index !== -1) {
      gameWindows[index] = null;
      gameWindows.splice(index, 1);
    }

    if (gameWindows.length === 0) {
      currentSpeedRate = 1;
      config.lastSpeed = 1;
      saveConfig();

      // 清理残留的 Flash 插件进程，防止长时间全屏后僵尸进程导致下次打开白屏
      killFlashPluginProcesses();

      if (fs.existsSync(speedctlPath)) {
        updateNativeRate(1);
      }

      // 游戏窗口全关 → 唤回启动器（已关闭则重建）
      const lw = showLauncherWindow();
      if (lw && !lw.isDestroyed()) {
        lw.setAlwaysOnTop(true);
        setTimeout(() => {
          if (lw && !lw.isDestroyed()) {
            lw.setAlwaysOnTop(false);
            // 置顶切换可能干扰重绘，强制刷新一次
            try { lw.webContents.invalidate(); } catch (e) {}
          }
        }, 100);
      }
    }
  });

  gameWindows.push(tabEntry);
  log('游戏窗口创建成功: ' + gameName);
  return win;
}

function quitFromTray() {
  log('用户点击托盘退出');
  isQuitting = true;
  try {
    // 标签页都在各自窗口的渲染进程里，销毁窗口即可连带回收
    for (let i = 0; i < gameWindows.length; i++) {
      const gw = gameWindows[i];
      if (gw && gw.win && !gw.win.isDestroyed()) {
        gw.win.destroy();
      }
    }
    gameWindows = [];
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.close();
    }
  } catch (e) {
    log('关闭窗口失败: ' + e.message, 'ERROR');
  }
  flushLogBuffer();
  app.quit();
}

let trayMenuWindow = null;

function closeTrayMenu() {
  const win = trayMenuWindow;
  trayMenuWindow = null;
  if (win && !win.isDestroyed()) {
    try { win.close(); } catch (e) { /* ignore */ }
  }
}

function buildTrayMenuHtml() {
  const T = getThemeColors();
  const hoverBg = T.btnHover || 'rgba(128,128,128,.12)';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{height:100%;overflow-y:auto;overflow-x:hidden;background:transparent}' +
    'body{padding:6px;font-family:"Microsoft YaHei",sans-serif;color:' + T.text + ';' +
      'background:' + T.bg1 + ';border:1px solid ' + T.border + ';border-radius:10px}' +
    '.item{height:34px;display:flex;align-items:center;padding:0 12px;border-radius:7px;' +
      'font-size:13px;cursor:default;user-select:none;white-space:nowrap}' +
    '.item:hover{background:' + hoverBg + ';color:' + T.accent + '}' +
    '.item.danger:hover{background:rgba(239,68,68,.14);color:#ef4444}' +
    '.sep{height:1px;margin:4px 8px;background:' + T.border + '}' +
    '</style></head><body>' +
    '<div class="item" data-action="show">显示启动器</div>' +
    '<div class="item" data-action="new">新建游戏窗口</div>' +
    '<div class="item" data-action="debug">调试控制台</div>' +
    '<div class="item" data-action="url-tool">网址调试</div>' +
    '<div class="sep"></div>' +
    '<div class="item danger" data-action="quit">退出</div>' +
    '<script>' +
    'const { ipcRenderer } = require("electron");' +
    'document.querySelectorAll(".item").forEach(function (el) {' +
    '  el.addEventListener("click", function () { ipcRenderer.send("tray-menu-action", el.dataset.action); });' +
    '});' +
    'document.addEventListener("keydown", function (e) {' +
    '  if (e.key === "Escape") ipcRenderer.send("tray-menu-close");' +
    '});' +
    'window.addEventListener("blur", function () { ipcRenderer.send("tray-menu-close"); });' +
    '</scr' + 'ipt></body></html>';
}

function showTrayMenu() {
  if (trayMenuWindow && !trayMenuWindow.isDestroyed()) {
    closeTrayMenu();
    return;
  }
  const scale = getUiScale();
  const baseW = 180;
  // 5 项（显示/新建/调试控制台/网址调试/退出）+ 1 条分隔 + 上下内边距 + 余量
  const baseH = 200;
  const w = Math.round(baseW * scale);
  let h = Math.round(baseH * scale);

  const pt = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(pt);
  const wa = display.workArea;
  if (h > wa.height - 16) h = Math.max(120, wa.height - 16);
  let tb = null;
  try { tb = tray && typeof tray.getBounds === 'function' ? tray.getBounds() : null; } catch (e) { /* ignore */ }

  let x = (tb && tb.width) ? (tb.x + tb.width - w) : (pt.x - w + 10);
  let y = (tb && tb.height) ? (tb.y - h - 4) : (pt.y - h - 8);
  // 任务栏在顶部时，菜单放到图标下方
  if (y < wa.y + 4) y = (tb && tb.height) ? (tb.y + tb.height + 4) : (pt.y + 8);
  x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - w - 4);
  y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - h - 4);

  const win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  trayMenuWindow = win;
  try { win.setAlwaysOnTop(true, 'pop-up-menu'); } catch (e) { /* ignore */ }
  try { win.webContents.setZoomFactor(scale); } catch (e) { /* ignore */ }
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildTrayMenuHtml()));
  // 菜单项增减后自动按内容高度修正，避免底部（如“退出”）被裁掉
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.executeJavaScript('document.documentElement.scrollHeight').then((ch) => {
      if (!ch || win.isDestroyed()) return;
      const need = Math.round(ch * scale) + 4;
      const b = win.getBounds();
      if (need > b.height) {
        let y2 = b.y;
        if (y2 + need > wa.y + wa.height - 4) y2 = Math.max(wa.y + 4, wa.y + wa.height - need - 4);
        win.setBounds({ x: b.x, y: y2, width: b.width, height: need });
      }
    }).catch(() => {});
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    try { win.webContents.setZoomFactor(scale); } catch (e) { /* ignore */ }
    win.show();
    win.focus();
  });
  win.on('blur', () => closeTrayMenu());
  win.on('closed', () => { if (trayMenuWindow === win) trayMenuWindow = null; });
}

ipcMain.on('tray-menu-action', (event, action) => {
  if (!trayMenuWindow || event.sender !== trayMenuWindow.webContents) return;
  closeTrayMenu();
  if (action === 'show') showLauncherWindow();
  else if (action === 'new') createGameWindow(DEFAULT_URL, '火影忍者Online');
  else if (action === 'debug') openDebugConsole();
  else if (action === 'url-tool') openUrlTool();
  else if (action === 'quit') quitFromTray();
});

ipcMain.on('tray-menu-close', (event) => {
  if (trayMenuWindow && event.sender === trayMenuWindow.webContents) closeTrayMenu();
});

function openDebugConsole() {
  try {
    debugConsole.open();
    try { debugConsole.write('perf', 'INFO', perfSummary()); } catch (e) { /* ignore */ }
  } catch (e) {
    log('打开调试控制台失败: ' + e.message, 'WARN');
  }
}

ipcMain.on('open-debug-console', () => {
  openDebugConsole();
});

function getUrlToolContext() {
  // 火影跑在 game.html 的 <webview> 里，账号信息从 guest 所在窗口取
  const guest = getActiveGameGuest();
  if (guest) {
    let currentUrl = '';
    try { currentUrl = guest.getURL(); } catch (e) { /* ignore */ }
    let windowTitle = '';
    const gw = getGameWindowForGuest(guest);
    if (gw) { try { windowTitle = gw.win.getTitle() || ''; } catch (e) { /* ignore */ } }
    return { qq: '', partition: '', currentUrl: currentUrl, hasTab: true, windowTitle: windowTitle };
  }
  return { qq: '', partition: '', currentUrl: '', hasTab: false };
}

// 当前游戏页所在的 webview 客进程（game.html 里每个标签一个 webview）
function getGameWindowForGuest(guest) {
  try {
    const host = guest.hostWebContents;
    if (!host) return null;
    return (gameWindows || []).find((gw) => {
      try { return gw && gw.win && !gw.win.isDestroyed() && gw.win.webContents.id === host.id; } catch (e) { return false; }
    }) || null;
  } catch (e) {
    return null;
  }
}

function getActiveGameGuest() {
  try {
    const all = webContents.getAllWebContents() || [];
    const guests = all.filter((w) => {
      try { return !w.isDestroyed() && w.getType && w.getType() === 'webview'; } catch (e) { return false; }
    });
    if (!guests.length) return null;
    const hostIds = new Set();
    (gameWindows || []).forEach((gw) => {
      try { if (gw && gw.win && !gw.win.isDestroyed()) hostIds.add(gw.win.webContents.id); } catch (e) { /* ignore */ }
    });
    const owned = guests.filter((w) => {
      try { return w.hostWebContents && hostIds.has(w.hostWebContents.id); } catch (e) { return false; }
    });
    const pool = owned.length ? owned : guests;
    const gamePool = pool.filter((w) => {
      try { return /huoying\.qq\.com/i.test(w.getURL() || ''); } catch (e) { return false; }
    });
    const list = gamePool.length ? gamePool : pool;
    // 多开时优先：当前聚焦的 webview → 聚焦窗口里的 webview → 可见窗口里的 webview
    const focusedGuest = list.find((w) => { try { return w.isFocused(); } catch (e) { return false; } });
    if (focusedGuest) return focusedGuest;
    const focusedWin = list.find((w) => {
      const gw = getGameWindowForGuest(w);
      try { return gw && gw.win.isFocused(); } catch (e) { return false; }
    });
    if (focusedWin) return focusedWin;
    const visibleWin = list.find((w) => {
      const gw = getGameWindowForGuest(w);
      try { return gw && gw.win.isVisible() && !gw.win.isMinimized(); } catch (e) { return false; }
    });
    if (visibleWin) return visibleWin;
    return list[0] || null;
  } catch (e) {
    return null;
  }
}

function getUrlToolSession() {
  const guest = getActiveGameGuest();
  if (guest) {
    try { return guest.session; } catch (e) { /* ignore */ }
  }
  return null;
}

function navigateActiveGame(url) {
  const guest = getActiveGameGuest();
  if (guest) {
    try { guest.loadURL(url); } catch (e) { /* ignore */ }
  }
}

function openUrlTool() {
  try {
    urlTool.init({
      getContext: getUrlToolContext,
      getSession: getUrlToolSession,
      navigate: navigateActiveGame,
      log: (msg, level) => log(msg, level || 'INFO')
    });
    urlTool.open();
  } catch (e) {
    log('打开网址调试失败: ' + e.message, 'WARN');
  }
}

ipcMain.on('open-url-tool', () => {
  openUrlTool();
});

function createTray() {
  const iconPath = getResourcePath('icons', 'Naruto.png');
  let trayIcon = null;
  
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);
  tray.setToolTip('火影忍者Online启动器');

  tray.on('click', () => {
    showLauncherWindow();
  });
  tray.on('right-click', () => {
    showTrayMenu();
  });
}

ipcMain.on('launch-game', (event, data) => {
  log('收到启动游戏请求: ' + data.name + ' - ' + data.url);
  
  // 非火影（4399 等）用极简窗口，与火影工具栏解耦
  const plain = !/huoying\.qq\.com/i.test(data.url || '');
  createGameWindow(data.url, data.name, null, { plain });
  
  if (launcherWindow) {
    launcherWindow.hide();
  }
});

// 内存监控：game.html 定时上报各标签 webContentsId，超阈值回传提示重载
// 强杀残留的 Flash (PPAPI) 插件进程，避免长时间全屏后僵尸进程占用 GPU 表面导致白屏
function killFlashPluginProcesses() {
  try {
    const metrics = app.getAppMetrics();
    const pluginTypes = ['pepper plugin', 'ppapi plugin', 'ppapi plugin broker', 'plugin'];
    let killed = 0;
    for (const m of metrics) {
      const t = String(m.type || '').toLowerCase();
      if (pluginTypes.includes(t) && m.pid && m.pid !== process.pid) {
        try {
          process.kill(m.pid);
          injectedPids.delete(m.pid);
          killed++;
        } catch (e) {}
      }
    }
    if (killed > 0) log('已清理残留 Flash 插件进程: ' + killed + ' 个');
  } catch (e) {
    log('清理 Flash 插件进程失败: ' + e.message, 'WARN');
  }
}

// 手动整理旧账号：重新从磁盘读取并执行「QQ + 区服」拆分
ipcMain.handle('repair-accounts', () => {
  const before = accounts.length;
  loadAccounts(true);
  broadcastAccountsChanged();
  log('[账号整理] ' + before + ' -> ' + accounts.length);
  return { ok: true, before: before, after: accounts.length };
});

ipcMain.on('add-account', (event, data) => {
  log('[IPC] 收到 add-account 请求: ' + JSON.stringify(data));
  addAccount(data.qq, data.password, data.windowName);
  event.reply('accounts-update', accounts);
});

ipcMain.on('update-account', (event, data) => {
  log('[IPC] 收到 update-account 请求: ' + JSON.stringify(data));
  updateAccount(data.id, data.qq, data.password, data.windowName);
  event.reply('accounts-update', accounts);
});

ipcMain.on('remove-account', (event, accountId) => {
  log('[IPC] 收到 remove-account 请求: ' + accountId);
  removeAccount(accountId);
  event.reply('accounts-update', accounts);
});

app.whenReady().then(async () => {
  log('应用启动');

  // 奥义 H.264 本地缓存：先把 127.0.0.1 静态服务起好，再让窗口开始加载
  videoCache.init({
    videoDir: getResourcePath('videos'),
    log,
    onLog: (level, msg) => {
      try { debugConsole.write('video', level, msg); } catch (e) { /* ignore */ }
    }
  });
  await videoCache.start();
  app.on('web-contents-created', (e, wc) => {
    try { videoCache.attach(wc.session); } catch (err) { /* ignore */ }
  });
  try {
    webContents.getAllWebContents().forEach((wc) => videoCache.attach(wc.session));
  } catch (e) { /* ignore */ }

  resetSettingsIfNeeded();
  loadConfig();
  // DPI 诊断：确认高分屏机器上游戏是否真的按 1:1 运行（scaleFactor 应为 1）
  try {
    const d = screen.getPrimaryDisplay();
    log('[dpi] size=' + d.size.width + 'x' + d.size.height +
      ' work=' + d.workAreaSize.width + 'x' + d.workAreaSize.height +
      ' scaleFactor=' + d.scaleFactor +
      ' regDpi=' + readSystemDpi() +
      ' uiScale=' + getUiScale() +
      ' gameDpr=' + (app.commandLine.getSwitchValue('force-device-scale-factor') || 'native'));
  } catch (e) { /* ignore */ }
  // 清理旧版分散日志（已统一到调试控制台，只在桌面按需生成）
  try {
    const ud = app.getPath('userData');
    ['perf.log', 'perf.log.old', 'video-cache.log', 'video-cache.log.old'].forEach((f) => {
      const p = path.join(ud, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  } catch (e) { /* ignore */ }
  loadAccounts();
  applyProcessPriority();
  detectWindowsVersion();
  initSpeedControl();
  updater.init({
    log,
    currentVersion: CURRENT_VERSION
  });

  // 初始化流量抓包层（关闭时零副作用）
  // [全量抓包] CDP 抓包（http-*.jsonl）只有全量模式和喵问答模式需要（喵问答要靠它拿配图）；
  // 组织统计 / 忍者检测走 net-log，不需要它
  const needCdp = CAPTURE_MODE === 'full' || CAPTURE_MODE === 'miao' || CAPTURE_MODE === 'shop';
  capture.initCapture({ enabled: needCdp });
  if (CAPTURE_MODE === 'full') {
    log('[capture] 全量抓包已开启，输出目录: ' + capture.getCaptureDir());
  } else if (CAPTURE_MODE === 'miao') {
    log('[capture] 喵问答抓包已开启（net-log + CDP）');
  } else if (CAPTURE_MODE === 'shop') {
    log('[capture] 商城特惠抓包已开启（net-log + CDP）');
  } else if (CAPTURE_MODE === 'stats') {
    log('[capture] 组织统计抓包已开启（net-log）');
  }

  // 在线人数上报（服务端不可达时静默失败，界面显示 --）
  online.init({
    log: log,
    clientId: ensureClientId(),
    version: CURRENT_VERSION,
    getCounts: getOnlineCounts,
    onUpdate: (data) => {
      if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.webContents.send('online-update', data);
      }
    }
  });

  // 启动时延迟执行自动清理，避免同步 IO 阻塞主进程
  setTimeout(() => {
    if (gameWindows.length === 0) {
      performStartupCleanup();
    }
  }, 3000);

  // 上次运行 GPU 进程崩溃过 → 已自动降级，启动后提示一次
  if (config.gpuCrashAt) {
    const crashAt = config.gpuCrashAt;
    delete config.gpuCrashAt;
    saveConfig();
    setTimeout(() => {
      dialog.showMessageBox({
        type: 'warning',
        title: '已自动关闭强制启用 GPU',
        message: '上次运行检测到显卡进程崩溃。',
        detail: '已在「设置 → 性能」里自动关闭「强制启用 GPU」（' + crashAt + '）。\n' +
          '如果之后画面正常，保持关闭即可；需要恢复可重新打开。\n' +
          '若关闭后仍会卡死，可再开启「兼容模式」。',
        buttons: ['知道了']
      }).catch(() => {});
    }, 1500);
  }

  
  ipcMain.on('set-theme', (event, theme) => {
    theme = normalizeTheme(theme);
    currentTheme = theme;
    saveConfig();
    log('主题已切换为: ' + theme);
    
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.webContents.send('theme-changed', theme);
      // 强制重绘，修复启动器隐藏后重新显示时主题不刷新的问题
      try { launcherWindow.webContents.invalidate(); } catch (e) {}
    }
    
    // 游戏窗口监听的是 theme-update，且加空值保护避免解构崩溃
    const themeColors = getThemeColors();
    gameWindows.forEach((gw) => {
      if (gw && gw.win && !gw.win.isDestroyed()) {
        gw.win.webContents.send('theme-update', themeColors);
      }
    });
  });

  // 启动器自绘标题栏：最小化 / 关闭
  ipcMain.on('launcher-minimize', () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.minimize();
    }
  });

  ipcMain.on('launcher-close', () => {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.close();
    }
  });
  

  // Flash 版本选择：内置国际版 / 内置国内版
  ipcMain.on('set-flash-choice', async (event, choice) => {
    config.flashChoice = (choice === 'system') ? 'system' : 'bundled';
    saveConfig();
    log('Flash 版本已切换为: ' + config.flashChoice);
    const label = (config.flashChoice === 'system') ? '内置国内版 34.0.0.376（纯净版）' : '内置国际版 32.0.0.344';
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Flash 版本切换',
      message: '已切换到「' + label + '」，需要重启应用才能生效。',
      buttons: ['立即重启', '稍后']
    });
    if (response === 0) {
      isQuitting = true;
      app.relaunch();
      app.quit();
    }
  });
  
  // 抓包模式：写入 config，需重启生效（net-log 开关需在 app ready 前设置）
  ipcMain.on('set-capture-mode', async (event, mode) => {
    mode = normalizeCaptureMode(mode);
    config.captureMode = mode;
    config.captureEnabled = (mode !== 'off');   // 兼容老字段
    saveConfig();
    const label = mode === 'stats' ? '组织统计（生成 Excel）'
      : (mode === 'full' ? '全量抓包（导出原始文件）'
        : (mode === 'quiz' ? '题库抓包（忍者检测）'
          : (mode === 'miao' ? '题库抓包（喵问答）'
            : (mode === 'shop' ? '商城特惠（导出 JSON + 图片）' : '关闭'))));
    log('[capture] 抓包模式已切换为: ' + mode);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '抓包模式',
      message: '已切换为「' + label + '」，需要重启应用才能生效。',
      buttons: ['立即重启', '稍后']
    });
    if (response === 0) {
      isQuitting = true;      // 允许真正退出（否则被托盘逻辑拦下）
      app.relaunch();
      app.quit();
    }
  });

  // 强制启用 GPU：命令行开关需在启动前设置，故提示重启
  ipcMain.on('set-force-gpu', async (event, on) => {
    config.forceGpu = !!on;
    saveConfig();
    log('强制启用 GPU 已' + (on ? '开启' : '关闭'));
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '强制启用 GPU',
      message: '已' + (on ? '开启' : '关闭') + '强制启用 GPU，需要重启应用才能生效。',
      buttons: ['立即重启', '稍后']
    });
    if (response === 0) {
      isQuitting = true;
      app.relaunch();
      app.quit();
    }
  });

  // 游戏入口：新开窗口生效
  ipcMain.on('set-game-entry', (event, v) => {
    config.gameEntry = normalizeGameEntry(v);
    saveConfig();
    log('游戏入口已设为: ' + config.gameEntry);
  });

  // 游戏画面画质：新开窗口 / 新标签生效
  ipcMain.on('set-flash-quality', (event, v) => {
    config.flashQuality = normalizeFlashQuality(v);
    saveConfig();
    log('游戏画面画质已设为: ' + config.flashQuality);
    gameWindows.forEach((gw) => {
      if (gw && gw.win && !gw.win.isDestroyed()) {
        gw.win.webContents.send('flash-quality-update', config.flashQuality);
      }
    });
  });

  // 渲染分辨率：value 形如 fixed:1600x900。固定 16:9，只影响渲染像素，不改变窗口尺寸
  ipcMain.on('set-render-config', (event, value) => {
    const raw = String(value || '');
    const parts = raw.split(':');
    if (parts[0] === 'fixed') {
      const dim = String(parts[1] || '').split('x');
      config.renderWidth = normalizeRenderWidth(dim[0]);
    }
    saveConfig();
    const rc = getRenderConfig();
    log('渲染分辨率已设为: ' + rc.width + 'x' + rc.height + '（16:9，等比缩放铺满）');
    gameWindows.forEach((gw) => {
      if (gw && gw.win && !gw.win.isDestroyed()) {
        gw.win.webContents.send('render-config-update', rc);
      }
    });
  });

  // 界面缩放：0=自动；1/1.25/1.5/1.75/2=固定倍率。只影响启动器/账号窗口与游戏窗口覆盖层，不影响 Flash 渲染。
  ipcMain.on('set-ui-scale', (event, v) => {
    config.uiScale = normalizeUiScale(v);
    saveConfig();
    const scale = getUiScale();
    log('界面缩放已设为: ' + (config.uiScale === 0 ? ('自动（' + scale + 'x）') : (Math.round(scale * 100) + '%')));
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      applyUiScaleToWindow(launcherWindow, 360, 640);
      try { launcherWindow.webContents.send('ui-scale-state', config.uiScale); } catch (e) { /* ignore */ }
    }
    gameWindows.forEach((gw) => {
      if (gw && gw.win && !gw.win.isDestroyed()) {
        gw.win.webContents.send('ui-scale-update', scale);
      }
    });
  });

  // 抓包缓存：查询占用 / 一键清理（设置面板用）
  ipcMain.on('get-storage-info', (event) => {
    try { event.reply('storage-info', captureStorageInfo()); } catch (e) {}
  });

  ipcMain.on('clear-captures', (event) => {
    let removed = 0, freed = 0;
    for (const f of listCaptureFiles()) {
      try {
        fs.unlinkSync(f.path);
        removed++;
        freed += f.size;
      } catch (e) { /* 被占用，跳过 */ }
    }
    if (removed) {
      log(`手动清理抓包缓存: ${removed} 个文件, 释放 ${(freed / 1048576).toFixed(1)} MB`, 'WARN');
    }
    try {
      event.reply('storage-cleared', Object.assign({ removed, freed }, captureStorageInfo()));
    } catch (e) {}
  });

  // 软件渲染（兼容模式）：启动参数需在 app ready 前设置，故提示重启
  ipcMain.on('set-software-render', async (event, on) => {
    config.softwareRender = !!on;
    saveConfig();
    log('软件渲染（兼容模式）已' + (on ? '开启' : '关闭'));
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '兼容模式',
      message: '已' + (on ? '开启' : '关闭') + '兼容模式，需要重启应用才能生效。',
      detail: on ? '开启后不走显卡渲染，稳定性最好，但帧率会下降、更吃 CPU。' : '',
      buttons: ['立即重启', '稍后']
    });
    if (response === 0) {
      isQuitting = true;
      app.relaunch();
      app.quit();
    }
  });



  // 标签节流：双开时冻结非活跃标签，资源全部给当前玩的标签
  ipcMain.on('set-tab-throttle', (event, data) => {
    try {
      if (!data || !data.webContentsId) return;
      const wc = webContents.fromId(data.webContentsId);
      if (wc && !wc.isDestroyed()) {
        wc.setBackgroundThrottling(!!data.throttled);
      }
    } catch (e) {}
  });

  // 全屏切换（工具栏「全屏」菜单项）
  ipcMain.on('toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // 老板键（更多侧边栏里的按钮；全局快捷键也走这里）
  ipcMain.on('boss-key', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (!gameWindows.some((g) => g && g.win === win)) return;
    toggleBossKey(win);
  });

  // 窗口透明度：所有游戏窗口统一生效，并保存为下次开窗默认值
  ipcMain.on('set-game-opacity', (event, pct) => {
    applyGameOpacity(pct);
  });

  // F11 全局捕获：注册在 web-contents-created 上，可覆盖 webview guest（宿主页面 keydown 收不到）
  app.on('web-contents-created', (event, wc) => {
    try { wc.on('did-finish-load', applyProcessPriority); } catch (e) {}
    wc.on('before-input-event', (event2, input) => {
      if (input.type !== 'keyDown' || input.key !== 'F11') return;
      let win = BrowserWindow.fromWebContents(wc);
      if (!win && wc.hostWebContents) win = BrowserWindow.fromWebContents(wc.hostWebContents);
      if (!win || win.isDestroyed()) return;
      // 仅游戏窗口响应 F11
      if (!gameWindows.some(g => g && g.win === win)) return;
      event2.preventDefault();
      if (input.isAutoRepeat) return;
      win.setFullScreen(!win.isFullScreen());
    });
  });
  
  createLauncherWindow();
  createTray();

  // 老板键：F9（单键，游戏里基本用不到）或 Ctrl+Shift+B，全局隐藏 / 还原游戏窗口
  ['F9', 'CommandOrControl+Shift+B'].forEach((accel) => {
    try {
      const ok = globalShortcut.register(accel, () => toggleBossKey());
      if (!ok) log('[boss] 老板键注册失败：' + accel + ' 可能已被其他程序占用', 'WARN');
      else log('[boss] 老板键已注册：' + accel);
    } catch (e) {
      log('[boss] 老板键注册失败: ' + accel + ' ' + e.message, 'WARN');
    }
  });

  // 游戏优先：定时补设新出现的渲染/Flash 插件进程（只在高优先级开启时）
  setInterval(() => {
    if (config.highPriority !== false) applyProcessPriority();
  }, 15000);

  // 性能快照：只在调试控制台记录时写入（30s 一次），不再落 C 盘
  setInterval(() => {
    if (!debugConsole.isRecording()) return;
    try {
      const p = collectPerf();
      const detail = p.per.length ? '\n  ' + p.per.join('\n  ') : '';
      debugConsole.write('perf', 'INFO', perfSummary() + detail);
    } catch (e) { /* ignore */ }
  }, 30000);
});

app.on('window-all-closed', () => {
  // 托盘常驻应用：窗口全关（例如关掉启动器）不退出应用，退出统一走托盘「退出」菜单。
  // 真实退出会先触发 before-quit，所以这里不退出不影响退出流程。
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
});

app.on('activate', () => {
  if (launcherWindow === null) {
    createLauncherWindow();
  }
});

app.on('before-quit', () => {
  // 真正退出：允许启动器窗口关闭（否则其 close 拦截会让 app.quit() 被取消，
  // 自动更新 quitAndInstall() / 托盘退出都会失效）
  isQuitting = true;

  // 账号异步保存可能还没落盘，退出前同步补一次
  flushAccountSaveSync();

  // 关闭本地视频服务
  try { videoCache.stop(); } catch (e) { /* ignore */ }
  // 停止调试日志并落盘
  try { debugConsole.stop(); } catch (e) { /* ignore */ }



  // 抓包开启时，退出前拉起独立导出进程（等主进程退出、netlog 写完后自动处理）
  // stats：解析 net-log → 生成 6 张 Excel（组织统计）
  // 开发模式（electron .）下 process.execPath 是 electron.exe，
  // 必须显式把 app 目录作为第一个参数传入，否则 electron 会把后面的 <pid> 当成 app 路径去加载。
  // 打包后 process.execPath 就是应用自身，不能再传参数。
  const _spawnAppArgs = app.isPackaged ? [] : [__dirname];
  if (CAPTURE_MODE === 'stats') {
    try {
      spawn(process.execPath, _spawnAppArgs.concat(['--export', String(process.pid)]), { detached: true, stdio: 'ignore' }).unref();
      log('[capture] 已启动组织统计导出子进程');
    } catch (e) {
      log('[capture] 启动导出子进程失败: ' + e.message, 'WARN');
    }
  }
  // [全量抓包] full：把本次会话的原始抓包文件导出到桌面
  else if (CAPTURE_MODE === 'full') {
    try {
      spawn(process.execPath, _spawnAppArgs.concat(['--dump-capture', String(process.pid)]), { detached: true, stdio: 'ignore' }).unref();
      log('[capture] 已启动全量抓包导出子进程');
    } catch (e) {
      log('[capture] 启动全量抓包导出子进程失败: ' + e.message, 'WARN');
    }
  }
  // [题库抓包] quiz：解析忍者检测题目，导出 JSON
  else if (CAPTURE_MODE === 'quiz') {
    try {
      spawn(process.execPath, _spawnAppArgs.concat(['--export-quiz', String(process.pid)]), { detached: true, stdio: 'ignore' }).unref();
      log('[capture] 已启动题库导出子进程');
    } catch (e) {
      log('[capture] 启动题库导出子进程失败: ' + e.message, 'WARN');
    }
  }
  // [题库抓包] miao：解析喵问答题目 + 配图，导出 JSON
  else if (CAPTURE_MODE === 'miao') {
    try {
      spawn(process.execPath, _spawnAppArgs.concat(['--export-miao', String(process.pid)]), { detached: true, stdio: 'ignore' }).unref();
      log('[capture] 已启动喵问答导出子进程');
    } catch (e) {
      log('[capture] 启动喵问答导出子进程失败: ' + e.message, 'WARN');
    }
  }
  // [商城特惠抓包] shop：解析商品数据 + 商品图片，导出 JSON
  else if (CAPTURE_MODE === 'shop') {
    try {
      spawn(process.execPath, _spawnAppArgs.concat(['--export-shop', String(process.pid)]), { detached: true, stdio: 'ignore' }).unref();
      log('[capture] 已启动商城特惠导出子进程');
    } catch (e) {
      log('[capture] 启动商城特惠导出子进程失败: ' + e.message, 'WARN');
    }
  }
  saveConfig();
  performExitCleanup();
});
