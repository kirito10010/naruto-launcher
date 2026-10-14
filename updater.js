// updater.js —— 自动更新：自定义弹窗 + 国内加速下载
// 由 main.js 调用 init({ log, currentVersion })
const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// GitHub 下载加速代理（按序尝试，最后一项为空 = 直连）
const PROXIES = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://gh.llkk.cc/',
  ''
];
const MAX_RETRY = 3;
const WIN_WIDTH = 460;

let log = () => {};
let currentVersion = '';
let proxyIdx = 0;
let retries = 0;

let updateWindow = null;
let updateWindowShown = false;   // 高度算好后再显示，避免先以初始高度闪一下、内容显示不全
let progressWindow = null;
let pendingInfo = null;
let downloaded = false;
let skipped = false;        // 用户点了「稍后提醒」
let showError = false;      // 用户主动更新后才弹错误框
let errorHandled = false;   // 单次下载内只处理一次错误（downloadUpdate 的 reject 与 'error' 事件会重复触发）

// ---------- 工具 ----------
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

// 覆写 httpExecutor.createRequest：把 github.com 的下载请求走代理
function patchProxy() {
  const ex = autoUpdater.httpExecutor;
  if (!ex) return;
  if (!ex.__proxyPatched) {
    const orig = ex.createRequest.bind(ex);
    ex.createRequest = function (options, callback) {
      try {
        const prefix = PROXIES[proxyIdx];
        if (prefix && options) {
          if (typeof options.url === 'string' && options.url.indexOf('https://github.com/') === 0) {
            options = Object.assign({}, options, { url: prefix + options.url });
          } else if (options.host === 'github.com' && typeof options.path === 'string') {
            const u = new URL(prefix);
            options = Object.assign({}, options, {
              host: u.host,
              path: u.pathname.replace(/\/$/, '') + '/https://github.com' + options.path
            });
          }
        }
      } catch (e) { /* 代理改写失败就直连 */ }
      return orig(options, callback);
    };
    ex.__proxyPatched = true;
  }
}

function maxWindowHeight() {
  try { return Math.round(screen.getPrimaryDisplay().workAreaSize.height * 0.8); }
  catch (e) { return 560; }
}

// ---------- 更新提示窗口 ----------
function showUpdateWindow(info) {
  pendingInfo = info;
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
      latest: info.version,
      notes: cleanNotes(info.releaseNotes),
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

// ---------- 事件 ----------
function onUpdateAvailable(info) {
  log('发现新版本: ' + info.version);
  if (skipped || downloaded) return;
  showUpdateWindow(info);
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

function onDownloaded(info) {
  log('更新包下载完成: ' + (info && info.version));
  downloaded = true;
  showError = false;
  closeProgressWindow();
  closeUpdateWindow();
  dialog.showMessageBox({
    type: 'info',
    title: '更新完成',
    message: '更新包已下载完成，版本: ' + ((info && info.version) || ''),
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

  // 换代理重试
  if (showError && retries < MAX_RETRY && proxyIdx < PROXIES.length - 1) {
    retries++;
    proxyIdx++;
    log('切换下载源重试 #' + retries + ' → ' + (PROXIES[proxyIdx] || '直连'));
    startDownload();
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

  if (!app.isPackaged) { log('开发模式，跳过自动更新检查'); return; }

  autoUpdater.autoDownload = false;   // 必须：否则弹窗前就偷偷下载，进度事件会丢
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'kirito10010',
    repo: 'naruto-launcher'
  });
  patchProxy();

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
      closeUpdateWindow();
      showError = true;
      retries = 0;
      proxyIdx = 0;
      startDownload();
    }
  });

  autoUpdater.on('checking-for-update', () => log('正在检查更新…'));
  autoUpdater.on('update-not-available', () => log('当前已是最新版本'));
  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('download-progress', onProgress);
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error', onError);

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => log('检查更新失败: ' + (e && e.message), 'WARN'));
  }, 5000);
}

module.exports = { init };
