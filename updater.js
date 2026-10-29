// updater.js —— 自动更新：多线路自动择优 + 失败回退
// 由 main.js 调用 init({ log, currentVersion })
//
// 背景（2026-10-16 实测）：
//   1) electron-updater 的 GitHubProvider 检测第一步必须请求 releases.atom，
//      而 GitHub 加速代理都不支持 .atom（ghfast 403 / gh-proxy 404 / ghproxy.net 403），
//      于是无法直连 github.com 的机器永远检测不到更新。
//   2) 原 patchProxy() 判断的是 options.url / options.host，而 electron-updater 的请求
//      options 由 configureRequestUrl() 生成，字段是 protocol/hostname/path，
//      两个分支恒不成立 → 代理从未生效（死代码），已删除。
// 现方案：改用 generic provider，把代理前缀直接写进 feed URL。
//   generic provider 只需要 GET <feed>/latest.yml，不需要 atom feed；
//   latest.yml 里的文件是相对路径，会以 feed URL 为 base 解析，下载自动走同一个源。
const { app, BrowserWindow, ipcMain, screen, dialog, net } = require('electron');
const { autoUpdater } = require('electron-updater');

const OWNER = 'kirito10010';
const REPO = 'naruto-launcher';
// GitHub 版本无关的稳定地址：/releases/latest/download/<asset>
const GH_LATEST = `https://github.com/${OWNER}/${REPO}/releases/latest/download`;

// 更新源候选表：探测是并发的，顺序只决定优先级、不影响耗时。
// 直连放首位，能直连的机器走直连最快。
const FEEDS = [
  { name: '直连', url: GH_LATEST },
  { name: 'ghfast.top', url: 'https://ghfast.top/' + GH_LATEST },
  { name: 'gh-proxy.com', url: 'https://gh-proxy.com/' + GH_LATEST },
  { name: 'ghproxy.net', url: 'https://ghproxy.net/' + GH_LATEST }
];

// 更新说明（Release 正文）来源：generic provider 不带 releaseNotes，单独拉 GitHub API
const NOTES_SOURCES = [
  `https://gh-proxy.com/https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
  `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
];

const MAX_RETRY = 3;          // 下载换源重试次数上限
const PROBE_TIMEOUT = 4000;   // 单源探测超时（electron-updater 内部 socket 超时是 60s，太长）
const NOTES_TIMEOUT = 6000;   // 更新说明拉取超时
const FALLBACK_NOTES = '有新版本可用，点击「立即更新」下载安装';
const WIN_WIDTH = 460;

let log = () => {};
let currentVersion = '';
let devTestMode = false;
let feedIdx = 0;        // 当前选中的更新源下标
let retries = 0;
let notesPromise = null;

let updateWindow = null;
let updateWindowShown = false;   // 高度算好后再显示，避免先以初始高度闪一下、内容显示不全
let progressWindow = null;
let pendingInfo = null;
let downloaded = false;
let skipped = false;        // 用户点了「稍后提醒」
let showError = false;      // 用户主动更新后才弹错误框
let userUpdating = false;   // 用户已点过「立即更新」，不要再重复弹提示窗
let errorHandled = false;   // 单次下载内只处理一次错误（downloadUpdate 的 reject 与 'error' 事件会重复触发）

// ---------- 工具 ----------
// 生产环境 log 只落盘 WARN/ERROR；这里补一条开发模式可见的通道，方便验证更新流程
function info(message) {
  log(message);
  if (devTestMode) console.log('[update] ' + message);
}

function cleanNotes(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) notes = notes.map((n) => (n && n.note) || '').join('\n');
  if (typeof notes !== 'string') notes = String(notes);
  return notes
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 基于 Electron 内置 net 的 GET：manual 重定向 + 超时 abort，失败统一 resolve null
function netGet(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let req;
    try {
      req = net.request({ url, method: 'GET', redirect: 'manual' });
    } catch (e) {
      done(null);
      return;
    }
    const timer = setTimeout(() => {
      try { req.abort(); } catch (e) { /* ignore */ }
      done(null);
    }, timeoutMs);
    // manual 模式下 3xx 只触发 redirect 事件（对探测来说也算可用）
    req.on('redirect', (statusCode) => {
      clearTimeout(timer);
      try { req.abort(); } catch (e) { /* ignore */ }
      done({ status: statusCode, body: '' });
    });
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        done({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', () => { clearTimeout(timer); done(null); });
    });
    req.on('error', () => { clearTimeout(timer); done(null); });
    req.end();
  });
}

// 并发探测所有候选源，按 FEEDS 顺序返回第一个可用的下标；全部失败返回 null
async function probeFeeds() {
  const results = await Promise.all(FEEDS.map((f) => netGet(f.url + '/latest.yml', PROBE_TIMEOUT)));
  for (let i = 0; i < FEEDS.length; i++) {
    const r = results[i];
    if (!r || r.status < 200 || r.status >= 400) continue;
    // 200 时确认拿到的确实是 latest.yml，避免代理返回 200 + HTML 错误页
    if (r.status === 200 && r.body && r.body.indexOf('version:') === -1) {
      log('[update] 更新源 ' + FEEDS[i].name + ' 返回内容异常，跳过', 'WARN');
      continue;
    }
    info('更新源可用: ' + FEEDS[i].name + ' (HTTP ' + r.status + ')');
    return i;
  }
  return null;
}

function applyFeed(idx) {
  // generic provider：只需 <url>/latest.yml，不需要 atom feed
  autoUpdater.setFeedURL({ provider: 'generic', url: FEEDS[idx].url });
}

// 拉取 Release 正文作为更新说明（与检测并行发起，不额外增加弹窗延迟）
async function fetchReleaseNotes() {
  const results = await Promise.all(NOTES_SOURCES.map((u) => netGet(u, NOTES_TIMEOUT)));
  for (const r of results) {
    if (!r || r.status !== 200 || !r.body) continue;
    try {
      const body = JSON.parse(r.body).body;
      if (body && String(body).trim()) return String(body);
    } catch (e) { /* 解析失败，换下一个源 */ }
  }
  return '';
}

function maxWindowHeight() {
  try { return Math.round(screen.getPrimaryDisplay().workAreaSize.height * 0.8); }
  catch (e) { return 560; }
}

// ---------- 更新提示窗口 ----------
function showUpdateWindow(updateInfo) {
  pendingInfo = updateInfo;
  if (updateWindow && !updateWindow.isDestroyed()) { updateWindow.focus(); return; }

  updateWindowShown = false;
  updateWindow = new BrowserWindow({
    width: WIN_WIDTH,
    height: 200,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: true,
    title: '发现新版本',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  updateWindow.setMenu(null);
  updateWindow.loadFile('update.html');

  updateWindow.webContents.once('did-finish-load', () => {
    updateWindow.webContents.send('update-info', {
      current: currentVersion,
      latest: updateInfo.version,
      notes: cleanNotes(updateInfo.releaseNotes),
      maxHeight: maxWindowHeight()
    });
  });
  updateWindow.once('ready-to-show', () => {
    // 正常由 update-window-height 回调里显示；这里只做兜底，避免极端情况下窗口一直不显示
    setTimeout(() => {
      if (updateWindow && !updateWindow.isDestroyed() && !updateWindowShown) {
        updateWindowShown = true;
        updateWindow.show();
      }
    }, 1500);
  });
  updateWindow.on('closed', () => { updateWindow = null; });
}

function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  updateWindow = null;
}

// ---------- 进度窗口 ----------
function showProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) return;
  progressWindow = new BrowserWindow({
    width: 400,
    height: 150,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: '下载更新',
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  progressWindow.setMenu(null);
  progressWindow.loadFile('progress.html');
  progressWindow.once('ready-to-show', () => { if (progressWindow) progressWindow.show(); });
  progressWindow.on('closed', () => { progressWindow = null; });
}

function closeProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
  progressWindow = null;
}

// ---------- 下载 ----------
function startDownload() {
  errorHandled = false;
  showProgressWindow();
  autoUpdater.downloadUpdate().catch((e) => {
    onError(e);
  });
}

// ---------- 检测 ----------
async function runCheck() {
  notesPromise = fetchReleaseNotes();   // 与检测并行
  const idx = await probeFeeds();
  if (idx == null) {
    log('[update] 所有更新源均不可用，本次跳过更新检查', 'WARN');
    return;
  }
  feedIdx = idx;
  applyFeed(feedIdx);
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && !result.isUpdateAvailable) info('当前已是最新版本');
  } catch (e) {
    log('[update] 检查更新失败: ' + (e && e.message ? e.message : e), 'WARN');
  }
}

// ---------- 事件 ----------
async function onUpdateAvailable(updateInfo) {
  info('发现新版本: ' + updateInfo.version);
  if (skipped || downloaded || userUpdating) return;

  let notes = '';
  try { notes = (await notesPromise) || ''; } catch (e) { notes = ''; }
  if (!notes.trim()) notes = FALLBACK_NOTES;
  info('更新说明长度: ' + notes.length);
  updateInfo.releaseNotes = notes;
  showUpdateWindow(updateInfo);
}

function onProgress(p) {
  if (!progressWindow || progressWindow.isDestroyed()) return;
  progressWindow.webContents.send('update-progress', {
    percent: Math.round(p.percent),
    downloaded: (p.transferred / 1048576).toFixed(2),
    total: (p.total / 1048576).toFixed(2),
    speed: (p.bytesPerSecond / 1048576).toFixed(2)
  });
}

function onDownloaded(updateInfo) {
  info('更新包下载完成: ' + (updateInfo && updateInfo.version));
  downloaded = true;
  showError = false;
  closeProgressWindow();
  closeUpdateWindow();
  dialog.showMessageBox({
    type: 'info',
    title: '更新完成',
    message: '更新包已下载完成，版本: ' + ((updateInfo && updateInfo.version) || ''),
    detail: '请重启应用以完成更新。',
    buttons: ['立即重启', '稍后重启'],
    defaultId: 0
  }).then((r) => {
    if (r.response === 0) autoUpdater.quitAndInstall();
  }).catch(() => {});
}

function onError(e) {
  log('更新出错: ' + (e && e.message ? e.message : e), 'ERROR');

  // downloadUpdate() 的 promise reject 与 autoUpdater 的 'error' 事件会重复触发同一次失败，
  // 这里加一次性闸门，避免并发重试（否则会同时发起多个下载）
  if (errorHandled) return;
  errorHandled = true;

  closeProgressWindow();

  // 换下一个候选源重试：换源后必须重新 checkForUpdates() 才能重新解析文件 URL
  if (showError && retries < MAX_RETRY && feedIdx < FEEDS.length - 1) {
    retries++;
    feedIdx++;
    log('[update] 切换下载源重试 #' + retries + ' → ' + FEEDS[feedIdx].name, 'WARN');
    applyFeed(feedIdx);
    autoUpdater.checkForUpdates()
      .then(() => startDownload())
      .catch((err) => { errorHandled = false; onError(err); });
    return;
  }

  if (showError) {
    showError = false;
    dialog.showMessageBox({
      type: 'error',
      title: '更新失败',
      message: '下载更新失败',
      detail: (e && e.message) || '未知错误',
      buttons: ['知道了']
    }).catch(() => {});
  }
}

// ---------- 初始化 ----------
function init(opts) {
  log = (opts && opts.log) || (() => {});
  currentVersion = (opts && opts.currentVersion) || app.getVersion();

  devTestMode = process.env.NARUTO_UPDATE_TEST === '1';
  if (!app.isPackaged && !devTestMode) { log('开发模式，跳过自动更新检查'); return; }
  if (devTestMode) {
    // 开发模式验证更新流程：我们总是先 setFeedURL（clientPromise 非空），
    // 所以不会去读 app-update.yml，dev 下可以完整跑「探测 → 检测 → 弹窗」
    autoUpdater.forceDevUpdateConfig = true;
    const fakeVersion = process.env.NARUTO_UPDATE_TEST_VERSION;
    if (fakeVersion) {
      try {
        // 必须用 electron-updater 自己那份 semver 的构造器，否则 instanceof 判定失败
        const SemVer = autoUpdater.currentVersion.constructor;
        autoUpdater.currentVersion = new SemVer(fakeVersion);
        console.log('[update] 测试用当前版本: ' + fakeVersion);
      } catch (e) {
        console.log('[update] NARUTO_UPDATE_TEST_VERSION 无效: ' + fakeVersion);
      }
    }
    console.log('[update] 开发模式测试开关已开启（NARUTO_UPDATE_TEST=1）');
  }

  autoUpdater.autoDownload = false;   // 必须：否则弹窗前就偷偷下载，进度事件会丢
  autoUpdater.disableDifferentialDownload = true;   // 代理对多段 Range 支持不确定，全量下载更稳

  ipcMain.on('update-window-height', (event, h) => {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.setContentSize(WIN_WIDTH, Math.max(120, Math.round(h)));
      if (!updateWindowShown) {
        updateWindowShown = true;
        updateWindow.show();
      }
    }
  });

  ipcMain.on('update-action', (event, action) => {
    if (action === 'later') {
      skipped = true;
      closeUpdateWindow();
      return;
    }
    if (action === 'update') {
      userUpdating = true;
      closeUpdateWindow();
      showError = true;
      retries = 0;
      startDownload();
    }
  });

  autoUpdater.on('checking-for-update', () => info('正在检查更新…'));
  autoUpdater.on('update-not-available', () => info('当前已是最新版本'));
  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('download-progress', onProgress);
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error', onError);

  setTimeout(() => { runCheck(); }, 5000);
}

module.exports = { init };
