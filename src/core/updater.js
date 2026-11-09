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
//
// 1.7.0 起：自建镜像（网站「项目管理 → 版本发布」）加入更新源；
//   1.13.0 起腾讯云 COS 作为国内首选；2026-11-03 起缤纷云 S4 作为国内首选；
//   2026-11-09 起移除腾讯云 COS（只保留缤纷云 + GitHub）。
//   2026-11-07 起：自建镜像为明文 HTTP，会破坏更新包完整性校验，已移出 FEEDS
//   （官网仍可手动下载；上 HTTPS 后可再启用）。
//   GitHub 直连与加速代理保留为兜底。选源时并发拉取各源的 latest.yml，
//   取**版本号最高**的那个；版本相同则缤纷云优先，其它源按探测速度从快到慢。
//   这样即使某个镜像还没传新版本，用户也能从其它源拿到更新，不会卡住。
const { app, BrowserWindow, ipcMain, screen, dialog, net } = require('electron');
const { autoUpdater } = require('electron-updater');

const OWNER = 'kirito10010';
const REPO = 'naruto-launcher';
// GitHub 版本无关的稳定地址：/releases/latest/download/<asset>
const GH_LATEST = `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
// 自建镜像地址（网站的「项目管理 → 版本发布」对外提供 latest.yml）
// 注意：目前是明文 HTTP，不能作为静默更新源（latest.yml 与安装包同源，可被中间人替换），
// 因此暂不放进 FEEDS。启用前必须先上 HTTPS。
// HYOL_UPDATE_MIRROR 仅用于本地联调
const MIRROR = process.env.HYOL_UPDATE_MIRROR || 'http://49.235.142.253/api/release/public/naruto-launcher';
// 缤纷云 S4 直链（S4 是产品名，兼容 S3 协议；控制台里的 s3://naruto-launcher/ 对应下面的公开 HTTPS 地址）
// 桶需开启公开读取：10GB 存储 + 每月 10GB 流量免费
// HYOL_UPDATE_S4 仅用于本地联调
const S4_MIRROR = process.env.HYOL_UPDATE_S4 || 'https://naruto-launcher.s3.bitiful.net';

// 更新源候选表：
//   - 先并发拉取各源 latest.yml，选版本号最高的；
//   - 版本相同时缤纷云（preferred）优先；
//   - 缤纷云不可用时，其余源按探测耗时从快到慢选择。
// 注意：所有源都必须是 HTTPS。明文 HTTP 源会让 latest.yml 与安装包同时可被替换，
// electron-updater 的 sha512 校验也就失去意义，因此不再收录。
const FEEDS = [
  { name: '缤纷云 S4', url: S4_MIRROR, mirror: true, preferred: true },
  { name: 'GitHub 直连', url: GH_LATEST },
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
let feedOrder = [];     // 本次检测的优先级顺序（按设置：国内镜像优先 / GitHub 优先）
let orderPos = 0;       // 当前位于 feedOrder 的位置
let getUpdateSource = () => 'mirror';   // 'mirror' | 'github'
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

// 基于 Electron 内置 net 的 GET：默认 manual 重定向（探测用）；follow=true 时自动跟随（读清单用）
function netGet(url, timeoutMs, follow) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let req;
    try {
      req = net.request({ url, method: 'GET', redirect: follow ? 'follow' : 'manual' });
    } catch (e) {
      done(null);
      return;
    }
    const timer = setTimeout(() => {
      try { req.abort(); } catch (e) { /* ignore */ }
      done(null);
    }, timeoutMs);
    // manual 模式下 3xx 只触发 redirect 事件（对探测来说也算可用）
    if (!follow) {
      req.on('redirect', (statusCode) => {
        clearTimeout(timer);
        try { req.abort(); } catch (e) { /* ignore */ }
        done({ status: statusCode, body: '' });
      });
    }
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

// 并发探测所有候选源：缤纷云优先，其余按探测耗时从快到慢；全部失败返回 null
async function probeFeeds() {
  const results = await Promise.all(FEEDS.map(async (f, i) => {
    const start = Date.now();
    const r = await netGet(f.url + '/latest.yml', PROBE_TIMEOUT);
    const ms = Date.now() - start;
    if (!r || r.status < 200 || r.status >= 400) return null;
    // 200 时确认拿到的确实是 latest.yml，避免代理返回 200 + HTML 错误页
    if (r.status === 200 && r.body && r.body.indexOf('version:') === -1) {
      log('[update] 更新源 ' + f.name + ' 返回内容异常，跳过', 'WARN');
      return null;
    }
    return { idx: i, ms: ms };
  }));
  const avail = results.filter(Boolean);
  if (!avail.length) return null;
  avail.sort((a, b) => {
    const pa = FEEDS[a.idx].preferred ? 0 : 1;
    const pb = FEEDS[b.idx].preferred ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.ms - b.ms;
  });
  const best = avail[0];
  info('更新源可用: ' + FEEDS[best.idx].name + '（' + best.ms + 'ms）');
  return best.idx;
}

// 从 latest.yml 文本里取 version
function parseVersionFromYml(text) {
  const m = /^version:\s*([^\s]+)/m.exec(String(text || ''));
  return m ? m[1].replace(/^v/i, '').trim() : '';
}

// 版本比较：a > b → 1，a < b → -1，相等 → 0
function cmpVersion(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 按设置计算优先级顺序：'mirror' = 国内镜像优先（S4），'github' = GitHub/代理优先（镜像兜底）
function computeFeedOrder() {
  const mirrors = FEEDS.map((f, i) => (f.mirror ? i : -1)).filter((i) => i >= 0);
  const others = FEEDS.map((_, i) => i).filter((i) => mirrors.indexOf(i) < 0);
  if (!mirrors.length) return others;
  return getUpdateSource() === 'github'
    ? others.concat(mirrors)
    : mirrors.concat(others);
}

// 选源：并发拉各源的 latest.yml（跟随重定向拿正文），
// 先取版本号最高的那一批；版本相同时缤纷云优先，其余按探测耗时从快到慢。
// 全部拿不到清单时退回“能连上就用”（同样缤纷云优先 + 最快）。
async function pickFeed() {
  const results = await Promise.all(FEEDS.map(async (f, i) => {
    const start = Date.now();
    const r = await netGet(f.url + '/latest.yml', PROBE_TIMEOUT, true);
    const ms = Date.now() - start;
    if (!r || r.status !== 200 || !r.body) return null;
    const version = parseVersionFromYml(r.body);
    if (!version) return null;
    return { idx: i, version: version, ms: ms };
  }));

  feedOrder = computeFeedOrder();
  orderPos = 0;

  let maxV = '';
  const seen = [];
  for (const r of results) {
    if (!r) continue;
    seen.push(FEEDS[r.idx].name + '=' + r.version);
    if (cmpVersion(r.version, maxV) > 0) maxV = r.version;
  }
  if (seen.length) info('各源版本: ' + seen.join(', '));

  if (maxV) {
    const cands = results
      .filter((r) => r && cmpVersion(r.version, maxV) === 0)
      .sort((a, b) => {
        const pa = FEEDS[a.idx].preferred ? 0 : 1;
        const pb = FEEDS[b.idx].preferred ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.ms - b.ms;
      });
    if (cands.length) {
      const chosen = cands[0];
      // 下载失败时：先换其它同版本的源（快→慢），最后再试剩余源
      const restSame = cands.slice(1).map((c) => c.idx);
      feedOrder = [chosen.idx].concat(
        restSame,
        computeFeedOrder().filter((i) => i !== chosen.idx && restSame.indexOf(i) < 0)
      );
      orderPos = 0;
      info('选中更新源: ' + FEEDS[chosen.idx].name + ' (v' + chosen.version + '，' + chosen.ms + 'ms)');
      return chosen.idx;
    }
  }

  // 都拿不到清单（例如全部 3xx 无正文）→ 退回可用性探测
  const probed = await probeFeeds();
  if (probed != null) {
    feedOrder = computeFeedOrder();
    orderPos = Math.max(0, feedOrder.indexOf(probed));
  }
  return probed;
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
  updateWindow.loadFile('src/ui/update.html');

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
  progressWindow.loadFile('src/ui/progress.html');
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
  const idx = await pickFeed();         // 多源取版本最高者（镜像优先）
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
  // GitHub API 拉不到时，退回 latest.yml 里带的 releaseNotes（网站发布页会写进清单）
  if (!notes.trim() && updateInfo.releaseNotes) notes = String(updateInfo.releaseNotes);
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

  // 换下一个候选源重试：按本次检测的优先级顺序走（国内镜像优先 / GitHub 优先）
  if (showError && retries < MAX_RETRY && orderPos < feedOrder.length - 1) {
    retries++;
    orderPos++;
    feedIdx = feedOrder[orderPos];
    // 第一次重试起改用全量下载：增量下载对 Range/旧 blockmap 有要求，失败就别再试
    autoUpdater.disableDifferentialDownload = true;
    log('[update] 切换下载源重试 #' + retries + ' → ' + FEEDS[feedIdx].name + '（全量下载）', 'WARN');
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
  getUpdateSource = (opts && opts.getUpdateSource) || (() => 'mirror');

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
  // 增量下载：只下变化的块（通常 3~10MB，比整包 67MB 快很多）。
  // 若因代理/Range 失败，onError 的重试路径会切回全量下载。
  autoUpdater.disableDifferentialDownload = false;

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
      autoUpdater.disableDifferentialDownload = false;   // 新一轮下载先试增量
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
