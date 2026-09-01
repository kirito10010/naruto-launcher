const { app, BrowserWindow, BrowserView, ipcMain, screen, Tray, Menu, nativeImage, dialog, webContents } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { execFile, exec, spawn } = require('child_process');
const os = require('os');

const DEFAULT_URL = 'https://huoying.qq.com/';
const LOG_FILE = path.join(app.getPath('userData'), 'launcher.log');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const CURRENT_VERSION = app.getVersion();

let launcherWindow = null;
let gameWindows = [];
let gameWindowCount = 0;
let tray = null;
let isQuitting = false;

let logBuffer = [];
const MAX_LOG_BUFFER = 10;
const MAX_LOG_FILE_SIZE = 1024 * 1024 * 5;

let speedctlPath = '';
let speedhookPath = '';
let currentSpeedRate = 1;
let injectedPids = new Set();
let useNativeInjectionSuccess = false;
let isWindows11 = false;
let hvciStatus = 'unknown';

let currentTheme = 'light';
let isAudioMuted = false;

let config = {
  theme: 'light',
  lastSpeed: 1,
  diskCache: true,
  flashChoice: 'bundled'
};

const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
let accounts = [];

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      accounts = JSON.parse(data);
      log(`账号已加载: ${accounts.length} 个`);
    } else {
      log('账号文件不存在，使用空列表');
    }
  } catch (e) {
    log('加载账号失败: ' + e.message, 'WARN');
    accounts = [];
  }
}

function saveAccounts() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
    log(`账号已保存: ${accounts.length} 个`);
  } catch (e) {
    log('保存账号失败: ' + e.message, 'WARN');
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
    if (qq) account.qq = qq;
    if (password !== undefined) account.qqPwd = password;
    if (windowName !== undefined) account.windowName = windowName;
    saveAccounts();
    return true;
  }
  return false;
}

function isLoginPage(url) {
  if (!url) return false;
  return /ptlogin2\.qq\.com/i.test(url) ||
         /xui\.ptlogin2\.qq\.com/i.test(url) ||
         /ssl\.ptlogin2\.qq\.com/i.test(url) ||
         /login\.qq\.com/i.test(url) ||
         /qlogin\.qq\.com/i.test(url);
}

function injectQuickLogin(webContents, qqNumber, password) {
  const js = [
    '(function() {',
    '  var qqNum = ' + JSON.stringify(qqNumber) + ';',
    '  var pwd = ' + JSON.stringify(password || '') + ';',
    '',
    '  function fillInput(doc, selector, value) {',
    '    try {',
    '      var input = doc.querySelector(selector);',
    '      if (input && input.offsetParent !== null) {',
    '        var nativeSetter = Object.getOwnPropertyDescriptor(',
    '          window.HTMLInputElement.prototype, "value").set;',
    '        nativeSetter.call(input, value);',
    '        input.dispatchEvent(new Event("input", { bubbles: true }));',
    '        input.dispatchEvent(new Event("change", { bubbles: true }));',
    '        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));',
    '        return true;',
    '      }',
    '    } catch(e) {}',
    '    return false;',
    '  }',
    '  function tryFillInputs(doc) {',
    '    var qqSelectors = ["#u", "input[name=\\"u\\"]", "#qq_num",',
    '      "input[placeholder*=\\"QQ\\"]", "input[placeholder*=\\"账号\\"]",',
    '      "input[placeholder*=\\"号码\\"]", "input[placeholder*=\\"邮箱\\"]",',
    '      "input[placeholder*=\\"email\\"]", "input[type=\\"email\\"]",',
    '      "input[type=\\"text\\"]"];',
    '    for (var i = 0; i < qqSelectors.length; i++) {',
    '      if (fillInput(doc, qqSelectors[i], qqNum)) break;',
    '    }',
    '    if (pwd) {',
    '      var pwdSelectors = ["#p", "input[name=\\"p\\"]",',
    '        "input[type=\\"password\\"]", "input[placeholder*=\\"密码\\"]"];',
    '      for (var i = 0; i < pwdSelectors.length; i++) {',
    '        if (fillInput(doc, pwdSelectors[i], pwd)) break;',
    '      }',
    '    }',
    '  }',
    '  function searchAllFrames(win) {',
    '    try { tryFillInputs(win.document); } catch(e) {}',
    '    try {',
    '      for (var i = 0; i < win.frames.length; i++) {',
    '        try { searchAllFrames(win.frames[i]); } catch(e) {}',
    '      }',
    '    } catch(e) {}',
    '  }',
    '  searchAllFrames(window);',
    '})()'
  ].join('\n');
  
  webContents.executeJavaScript(js).catch(() => {});
  log('自动填充账号: ' + qqNumber + (password ? ' +密码' : ''));
}

function setupAutoLogin(tabInfo) {
  if (!tabInfo._pendingAccount) return;
  
  const maxAttempts = 30;
  const intervalMs = 2000;
  let attempts = 0;
  
  const tryInject = () => {
    attempts++;
    
    if (!tabInfo._pendingAccount || !tabInfo.webContents) {
      log('[AutoLogin] 停止自动登录尝试');
      return;
    }
    
    const url = tabInfo.webContents.getURL();
    
    if (isLoginPage(url)) {
      log('[AutoLogin] 检测到登录页面，尝试注入: ' + url);
      injectQuickLogin(tabInfo.webContents, tabInfo._pendingAccount.qq, tabInfo._pendingAccount.qqPwd);
      
      if (attempts >= maxAttempts) {
        log('[AutoLogin] 达到最大尝试次数 (' + maxAttempts + ')');
        tabInfo._pendingAccount = null;
      }
    }
    
    if (tabInfo._pendingAccount) {
      setTimeout(tryInject, intervalMs);
    }
  };
  
  tryInject();
  
  tabInfo.webContents.on('did-navigate', () => {
    if (tabInfo._pendingAccount) {
      const url = tabInfo.webContents.getURL();
      log('[AutoLogin] 页面导航: ' + url);
      if (isLoginPage(url)) {
        injectQuickLogin(tabInfo.webContents, tabInfo._pendingAccount.qq, tabInfo._pendingAccount.qqPwd);
      }
    }
  });
  
  tabInfo.webContents.on('did-navigate-in-page', () => {
    if (tabInfo._pendingAccount) {
      injectQuickLogin(tabInfo.webContents, tabInfo._pendingAccount.qq, tabInfo._pendingAccount.qqPwd);
    }
  });
  
  tabInfo.webContents.on('did-stop-loading', () => {
    if (tabInfo._pendingAccount) {
      injectQuickLogin(tabInfo.webContents, tabInfo._pendingAccount.qq, tabInfo._pendingAccount.qqPwd);
    }
  });
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = JSON.parse(data);
      currentTheme = config.theme || 'light';
      currentSpeedRate = config.lastSpeed || 1;
      if (config.diskCache === undefined) config.diskCache = true;
      if (config.flashChoice === undefined) config.flashChoice = 'bundled';
      log('配置已加载: theme=' + currentTheme + ', lastSpeed=' + currentSpeedRate);
    } else {
      log('配置文件不存在，使用默认配置');
    }
  } catch (e) {
    log('加载配置失败: ' + e.message, 'WARN');
  }
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

function getThemeCSS() {
  const themes = {
    light: 'background:linear-gradient(180deg,#ffffff 0%,#f5f5f5 100%);border-bottom:1px solid #e0e0e0}.toolbar-left .title,.toolbar-right .btn,.toolbar-right .select-container select,.toolbar-right .control-btn{color:#333 !important;border-color:#ddd !important;background:linear-gradient(#fff,#f8f8f8) !important}.separator{background:#ddd !important}',
    dark: 'background:linear-gradient(180deg,#1a1a2e 0%,#16213e 100%);border-bottom:1px solid #4a4a6a}.toolbar-left .title,.toolbar-right .btn,.toolbar-right .select-container select,.toolbar-right .control-btn{color:#fff !important;border-color:#5a5a7a !important;background:linear-gradient(#2d2d44,#3d3d5c) !important}.separator{background:#4a4a6a !important}',
    blue: 'background:linear-gradient(180deg,#0f3460 0%,#16213e 100%);border-bottom:1px solid #1e4d7b}.toolbar-left .title,.toolbar-right .btn,.toolbar-right .select-container select,.toolbar-right .control-btn{color:#eaeaea !important;border-color:#2e6a9a !important;background:linear-gradient(#1a4a7a,#2a5a8a) !important}.separator{background:#1e4d7b !important}',
    orange: 'background:linear-gradient(180deg,#2d2d2d 0%,#1a1a1a 100%);border-bottom:1px solid #5a4a3a}.toolbar-left .title,.toolbar-right .btn,.toolbar-right .select-container select,.toolbar-right .control-btn{color:#ffddaa !important;border-color:#6a5a4a !important;background:linear-gradient(#4a3a2a,#5a4a3a) !important}.separator{background:#5a4a3a !important}'
  };
  return themes[currentTheme] || themes.light;
}

function getThemeColors() {
  const themes = {
    light: {
      bg1: '#ffffff',
      bg2: '#f5f5f5',
      border: '#e0e0e0',
      text: '#333333',
      btnBg: '#ffffff',
      btnHover: '#f8f8f8',
      btnBorder: '#dddddd',
      separator: '#dddddd',
      accent: '#3498db',
      gradient: 'linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)'
    },
    dark: {
      bg1: '#1a1a2e',
      bg2: '#16213e',
      border: '#4a4a6a',
      text: '#ffffff',
      btnBg: '#2d2d44',
      btnHover: '#3d3d5c',
      btnBorder: '#5a5a7a',
      separator: '#4a4a6a',
      accent: '#00d4ff',
      gradient: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)'
    },
    blue: {
      bg1: '#0f3460',
      bg2: '#16213e',
      border: '#1e4d7b',
      text: '#eaeaea',
      btnBg: '#1a4a7a',
      btnHover: '#2a5a8a',
      btnBorder: '#2e6a9a',
      separator: '#1e4d7b',
      accent: '#4ecdc4',
      gradient: 'linear-gradient(180deg, #0f3460 0%, #16213e 100%)'
    },
    orange: {
      bg1: '#2d2d2d',
      bg2: '#1a1a1a',
      border: '#5a4a3a',
      text: '#ffddaa',
      btnBg: '#4a3a2a',
      btnHover: '#5a4a3a',
      btnBorder: '#6a5a4a',
      separator: '#5a4a3a',
      accent: '#ff6b35',
      gradient: 'linear-gradient(180deg, #2d2d2d 0%, #1a1a1a 100%)'
    }
  };
  return themes[currentTheme] || themes.light;
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

  // 读取 Flash 选择（内置国际版 / 系统国内版），此函数在 config 加载前执行，故直接读文件
  let flashChoice = 'bundled';
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      flashChoice = cfg.flashChoice || 'bundled';
    }
  } catch (e) {}

  const bundled = [
    // 内置 32.0.0.344（与竞品一致，更稳定）
    getResourcePath('flash', `pepflashplayer${arch}_32_0_0_344.dll`),
    getResourcePath('flash', `pepflashplayer${arch}_34_0_0_380.dll`),
    getResourcePath('flash', 'pepflashplayer.dll'),
    `C:\\Windows\\${sysDir}\\Macromed\\Flash\\pepflashplayer${arch}_32_0_0_344.dll`,
    path.join(__dirname, 'flash', 'pepflashplayer.dll')
  ];

  // 系统国内重橙版 34.0.0.380
  const system = [
    `C:\\Windows\\${sysDir}\\Macromed\\Flash\\pepflashplayer${arch}_34_0_0_380.dll`,
    `C:\\Windows\\System32\\Macromed\\Flash\\pepflashplayer64_34_0_0_380.dll`,
    `C:\\Windows\\SysWOW64\\Macromed\\Flash\\pepflashplayer32_34_0_0_380.dll`
  ];

  const paths = (flashChoice === 'system') ? system.concat(bundled) : bundled.concat(system);

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
  // 缓存保留天数
  cacheRetainDays: 3,
  // 单次清理最大文件数
  maxFilesPerCleanup: 500
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
  const cacheDirs = [
    'GPUCache',
    'Code Cache',
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

/**
 * 清理未使用的 persist session 分区数据
 * 只保留当前活跃的 session，清理过期的
 */
function cleanupUnusedSessions() {
  const userDataPath = app.getPath('userData');
  const partitionsDir = path.join(userDataPath, 'Partitions');

  if (!fs.existsSync(partitionsDir)) return;

  try {
    const entries = fs.readdirSync(partitionsDir);
    let cleanedCount = 0;

    for (const entry of entries) {
      const partitionPath = path.join(partitionsDir, entry);
      const stat = fs.statSync(partitionPath);

      if (!stat.isDirectory()) continue;

      // 只清理过期的 session 分区（超过保留期）
      if (isExpired(partitionPath, CLEANUP_CONFIG.cacheRetainDays)) {
        safeRemoveDir(partitionPath);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log(`清理过期 Session 分区: ${cleanedCount} 个`, 'INFO');
    }
  } catch (e) {
    console.error('清理 session 失败:', e);
  }
}

/**
 * 清理更新下载的临时文件
 */
function cleanupUpdateTempFiles() {
  const userDataPath = app.getPath('userData');
  const pendingUpdateDir = path.join(userDataPath, 'pending');

  if (fs.existsSync(pendingUpdateDir)) {
    safeRemoveDir(pendingUpdateDir);
    log('清理更新临时文件', 'INFO');
  }

  // 清理可能残留的更新包
  try {
    const entries = fs.readdirSync(userDataPath);
    for (const entry of entries) {
      if (entry.endsWith('.exe') || entry.endsWith('.zip') || entry.endsWith('.7z')) {
        const filePath = path.join(userDataPath, entry);
        if (isExpired(filePath, 1)) {
          safeRemoveFile(filePath);
        }
      }
    }
  } catch (e) {}
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
      if (isExpired(entryPath, CLEANUP_CONFIG.cacheRetainDays)) {
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

  cleanupLogFile();
  cleanupElectronCache();
  cleanupUnusedSessions();
  cleanupUpdateTempFiles();
  cleanupLocalStorage();

  log('启动清理完成', 'INFO');
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
    
    if (release.startsWith('10.0')) {
      const parts = release.split('.');
      if (parts.length >= 3) {
        const buildNumber = parseInt(parts[2], 10);
        if (buildNumber >= 22000) {
          isWindows11 = true;
          log('检测到Windows 11系统');
          checkHVCI();
        } else {
          isWindows11 = false;
          log('检测到Windows 10系统');
        }
      }
    }
    
    return release;
  } catch (e) {
    log(`检测系统版本失败: ${e.message}`, 'WARN');
    return 'unknown';
  }
}

function checkHVCI() {
  exec('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" /v Enabled', (err, stdout, stderr) => {
    if (!err && stdout.includes('0x1')) {
      hvciStatus = 'enabled';
      log('HVCI (内存完整性) 已启用 - 这可能阻止DLL注入', 'WARN');
    } else {
      hvciStatus = 'disabled';
      log('HVCI (内存完整性) 已禁用');
    }
  });
}

function showHVCIWarning() {
  if (isWindows11 && hvciStatus === 'enabled') {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Windows 11 加速提示',
      message: '检测到您的Windows 11系统启用了"内存完整性"功能，这会阻止游戏加速功能。\n\n请按照以下步骤关闭：\n\n1. 打开"设置" → "更新和安全" → "Windows安全中心"\n2. 点击"设备安全性"\n3. 点击"核心隔离"\n4. 关闭"内存完整性"\n5. 重启电脑\n\n关闭后加速功能即可正常使用。',
      buttons: ['知道了']
    });
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
    timeout: 10000,
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
      useNativeInjectionSuccess = true;
      log(`DLL注入成功 PID ${pid}${stdoutData.trim() ? ' - ' + stdoutData.trim() : ''}`);
      if (currentSpeedRate !== 1) {
        updateNativeRate(currentSpeedRate);
      }
    } else {
      log(`DLL注入失败 PID ${pid}, 退出码=${code}, stderr=${stderrData.trim()}`, 'ERROR');
      
      if (isWindows11 && code === -1073741510) {
        log('Win11错误码 -1073741510: 可能是HVCI阻止了注入', 'ERROR');
      }
      
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
    timeout: 5000,
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
      log(`设置变速率失败，退出码=${code}, stderr=${stderrData.trim()}`, 'ERROR');
      
      if (code === -1073741510) {
        log('错误码 -1073741510: 权限不足或HVCI阻止', 'ERROR');
      }
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
    injectAllChildProcesses();
  }
  
  log(`变速率已设置为: ${rate}x`);
}

function getAllRelevantChildPids() {
  try {
    // Electron 自带的进程指标，无需 spawn PowerShell 扫描
    const metrics = app.getAppMetrics();
    const relevantTypes = new Set([
      'renderer', 'tab', 'plugin', 'ppapi plugin', 'pepper plugin'
    ]);
    return metrics
      .filter(m => m.pid && m.pid !== process.pid)
      .filter(m => relevantTypes.has(String(m.type || '').toLowerCase()))
      .map(m => m.pid);
  } catch (e) {
    log('获取进程列表失败: ' + e.message, 'WARN');
    return [];
  }
}

let lastInjectTime = 0;
const INJECT_COOLDOWN = 5000;

async function injectAllChildProcesses() {
  const now = Date.now();
  if (now - lastInjectTime < INJECT_COOLDOWN) {
    return;
  }
  lastInjectTime = now;
  
  try {
    const childPids = getAllRelevantChildPids();
    
    for (const pid of childPids) {
      if (!injectedPids.has(pid)) {
        injectSpeedHook(pid);
      }
    }
    
    if (isWindows11) {
      setTimeout(secondPass, 2000);
    }
  } catch (e) {
    log('扫描子进程失败: ' + e.message, 'WARN');
  }
}

async function secondPass() {
  try {
    const childPids = getAllRelevantChildPids();
    
    for (const pid of childPids) {
      if (!injectedPids.has(pid)) {
        log('第二轮注入 PID=' + pid);
        injectSpeedHook(pid);
      }
    }
  } catch (e) {
    log('第二轮注入失败: ' + e.message, 'WARN');
  }
}

const FLASH_PATH = getFlashPath();

function detectFlashVersion(flashPath) {
  if (!flashPath) return '34.0.0.380';
  const match = flashPath.match(/(\d+_\d+_\d+_\d+)/);
  if (match) {
    return match[1].replace(/_/g, '.');
  }
  return '34.0.0.380';
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
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('no-sandbox');

// 性能最大化：解除帧率锁 + 禁止后台节流
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('enable-fast-startup');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');

// 磁盘缓存上限 1GB（1073741824 字节）
app.commandLine.appendSwitch('disk-cache-size', '1073741824');

function createLauncherWindow() {
  const colors = getThemeColors();
  
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const dpr = display.scaleFactor || 1;
  
  // 标准塔罗牌比例：宽:高 = 7:12
  const baseWidth = 350;
  const baseHeight = 600;
  
  const scaledWidth = Math.max(baseWidth, Math.floor(baseWidth * dpr * 0.8));
  const scaledHeight = Math.max(baseHeight, Math.floor(baseHeight * dpr * 0.8));
  
  launcherWindow = new BrowserWindow({
    width: scaledWidth,
    height: scaledHeight,
    title: '火影忍者Online启动器',
    resizable: false,
    maximizable: false,
    minimizable: true,
    backgroundColor: colors.bg1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableRemoteModule: true
    }
  });

  launcherWindow.setMenu(null);
  
  const launcherHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-gradient: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
      --text-color: #333;
      --border-color: #ddd;
      --btn-bg: linear-gradient(#fff, #f8f8f8);
      --btn-border: #ddd;
      --game-bg: #f5f5f5;
      --accent-color: #e74c3c;
    }
    body {
      background: var(--bg-gradient);
      padding: 20px;
      font-family: 'Microsoft YaHei', sans-serif;
      color: var(--text-color);
      height: 100vh;
      display: flex;
      flex-direction: column;
      gap: 15px;
      position: relative;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h2 {
      color: var(--text-color);
      font-size: 18px;
      margin-bottom: 10px;
    }
    .theme-selector {
      display: flex;
      gap: 5px;
    }
    .theme-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
      -webkit-app-region: no-drag;
    }
    .theme-btn:hover {
      transform: scale(1.1);
    }
    .theme-btn.active {
      border-color: var(--accent-color);
      box-shadow: 0 0 0 2px rgba(231, 76, 60, 0.3);
    }
    .theme-light {
      background: linear-gradient(135deg, #ffffff 50%, #f5f5f5 50%);
    }
    .theme-dark {
      background: linear-gradient(135deg, #1a1a2e 50%, #16213e 50%);
    }
    .theme-blue {
      background: linear-gradient(135deg, #0f3460 50%, #16213e 50%);
    }
    .theme-orange {
      background: linear-gradient(135deg, #2d2d2d 50%, #1a1a1a 50%);
    }
    .game-list {
      flex: 1;
      overflow-y: auto;
    }
    .game-item {
      background: var(--game-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .game-item:hover {
      border-color: var(--accent-color);
      box-shadow: 0 2px 8px rgba(231, 76, 60, 0.15);
      background: #fff;
    }
    .game-title {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      color: var(--text-color);
    }
    .game-url {
      font-size: 11px;
      color: #888;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .footer {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding-bottom: 10px;
    }
    .footer-buttons {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .join-group-btn {
      padding: 8px 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      border: none;
      border-radius: 20px;
      color: white;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
      -webkit-app-region: no-drag;
    }
    .join-group-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
    }
    .join-group-btn:active {
      transform: translateY(0);
    }
    .flash-selector {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      -webkit-app-region: no-drag;
    }
    .flash-selector label {
      font-size: 12px;
      color: #888;
    }
    .flash-selector select {
      padding: 5px 8px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--game-bg);
      color: var(--text-color);
      font-size: 12px;
      outline: none;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>🎮 火影忍者Online启动器</h2>
    <div class="theme-selector" id="themeSelector">
      <button class="theme-btn theme-light" title="明亮主题" data-theme="light"></button>
      <button class="theme-btn theme-dark" title="暗黑主题" data-theme="dark"></button>
      <button class="theme-btn theme-blue" title="深海主题" data-theme="blue"></button>
      <button class="theme-btn theme-orange" title="火影主题" data-theme="orange"></button>
    </div>
  </div>
  
  <div class="game-list">
    <div class="game-item" onclick="launchGame('https://huoying.qq.com/', '火影忍者Online')">
      <div class="game-title">🔥 火影忍者Online</div>
      <div class="game-url">https://huoying.qq.com/</div>
    </div>
  </div>
  
  <div class="footer">
    <div class="footer-buttons">
      <button class="join-group-btn" onclick="joinQQGroup()">💬 加入QQ群</button>
      <button class="join-group-btn" onclick="openSite()">🌐 网站</button>
    </div>
    <div class="flash-selector">
      <label>Flash 版本</label>
      <select id="flashSelect" onchange="changeFlash(this.value)">
        <option value="bundled">内置国际版 32.0.0.344</option>
        <option value="system">系统国内版 34.0.0.380</option>
      </select>
    </div>
  </div>
  
  <script>
    const { ipcRenderer, shell } = require('electron');
    
    function launchGame(url, name) {
      ipcRenderer.send('launch-game', { url, name });
    }
    
    function joinQQGroup() {
      shell.openExternal('https://qm.qq.com/q/kHOKaFZRqo');
    }
    
    function openSite() {
      shell.openExternal('http://49.235.142.253/');
    }
    
    function changeFlash(choice) {
      ipcRenderer.send('set-flash-choice', choice);
    }
    
    function setTheme(theme) {
      ipcRenderer.send('set-theme', theme);
    }
    
    function applyTheme(theme) {
      const root = document.documentElement;
      const themes = {
        light: {
          '--bg-gradient': 'linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%)',
          '--text-color': '#333',
          '--border-color': '#ddd',
          '--btn-bg': 'linear-gradient(#fff, #f8f8f8)',
          '--btn-border': '#ddd',
          '--game-bg': '#f5f5f5',
          '--accent-color': '#e74c3c'
        },
        dark: {
          '--bg-gradient': 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
          '--text-color': '#fff',
          '--border-color': '#4a4a6a',
          '--btn-bg': 'linear-gradient(#2d2d44, #3d3d5c)',
          '--btn-border': '#5a5a7a',
          '--game-bg': '#2d2d44',
          '--accent-color': '#00d4ff'
        },
        blue: {
          '--bg-gradient': 'linear-gradient(180deg, #0f3460 0%, #16213e 100%)',
          '--text-color': '#eaeaea',
          '--border-color': '#1e4d7b',
          '--btn-bg': 'linear-gradient(#1a4a7a, #2a5a8a)',
          '--btn-border': '#2e6a9a',
          '--game-bg': '#1a4a7a',
          '--accent-color': '#4ecdc4'
        },
        orange: {
          '--bg-gradient': 'linear-gradient(180deg, #2d2d2d 0%, #1a1a1a 100%)',
          '--text-color': '#ffddaa',
          '--border-color': '#5a4a3a',
          '--btn-bg': 'linear-gradient(#4a3a2a, #5a4a3a)',
          '--btn-border': '#6a5a4a',
          '--game-bg': '#4a3a2a',
          '--accent-color': '#ff6b35'
        }
      };
      const t = themes[theme] || themes.light;
      Object.keys(t).forEach(key => {
        root.style.setProperty(key, t[key]);
      });
      document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelector('.theme-' + theme)?.classList.add('active');
    }
    
    function initThemeButtons() {
      document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const theme = btn.getAttribute('data-theme');
          if (theme) {
            setTheme(theme);
          }
        });
      });
    }
    
    document.addEventListener('DOMContentLoaded', () => {
      initThemeButtons();
    });
    
    ipcRenderer.on('theme-changed', (event, theme) => {
      applyTheme(theme);
    });
    
    ipcRenderer.on('flash-choice', (event, choice) => {
      const sel = document.getElementById('flashSelect');
      if (sel) sel.value = choice || 'bundled';
    });
  </script>
</body>
</html>`;
  
  launcherWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(launcherHtml));

  launcherWindow.webContents.on('did-finish-load', () => {
    launcherWindow.webContents.send('theme-changed', currentTheme);
    launcherWindow.webContents.send('flash-choice', config.flashChoice);
  });

  launcherWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      launcherWindow.hide();
    }
  });

  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  log('启动器窗口创建成功');
}

function createGameWindow(url, gameName, account) {
  if (!url) url = DEFAULT_URL;
  if (!gameName) gameName = '火影忍者Online';

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
  const toolbarHeight = 36;

  const maxGameWidth = 1440;
  const maxGameHeight = 810;

  const gameWidth = Math.min(Math.floor(width * 0.95), maxGameWidth);
  const gameHeight = Math.min(Math.floor(height * 0.95) - toolbarHeight, maxGameHeight);

  const win = new BrowserWindow({
    width: gameWidth,
    height: gameHeight + toolbarHeight,
    title: gameName,
    frame: false,
    backgroundColor: '#ffffff',
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
    simpleFullscreen: false
  });

  win.webContents.setZoomFactor(1.0);

  win.setMenu(null);

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

  // 加载 game.html
  win.loadFile('game.html');

  win.webContents.on('did-finish-load', () => {
    // 发送游戏信息给 game.html
    const gameInfo = {
      name: gameName,
      url: url
    };
    win.webContents.send('game-info', {
      game: gameInfo,
      accounts: accounts,
      account: account,
      diskCache: config.diskCache !== false
    });

    // 发送当前配置
    win.webContents.send('theme-update', currentTheme);
    win.webContents.send('speed-update', currentSpeedRate);
    win.webContents.send('mute-update', isAudioMuted);

    log('游戏窗口加载完成');
  });

  const ipcListeners = [];

  const addListener = (channel, handler) => {
    ipcMain.on(channel, handler);
    ipcListeners.push({ channel, handler });
  };

  // 游戏窗口内的 IPC 处理
  addListener('new-tab', (event) => {
    // 游戏窗口自己处理
  });

  addListener('switch-tab', (event, index) => {
    // 游戏窗口自己处理
  });

  addListener('close-tab', (event, index) => {
    // 游戏窗口自己处理
  });

  addListener('min-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win && win && !win.isDestroyed()) {
      win.minimize();
    }
  });

  addListener('max-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win && win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  addListener('close-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win && win && !win.isDestroyed()) {
      win.close();
    }
  });

  addListener('set-game-speed', (event, speed) => {
    currentSpeedRate = speed;
    config.lastSpeed = speed;
    saveConfig();

    if (fs.existsSync(speedctlPath)) {
      updateNativeRate(speed);
      injectAllChildProcesses();
    }

    log(`全局变速率已设置为: ${speed}x`);
  });

  addListener('toggle-mute', (event, muted) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      isAudioMuted = muted;
    }
  });

  addListener('toggle-sidebar', (event, visible) => {
    // 侧边栏由 game.html 自己处理
  });

  addListener('show-modal', (event, show) => {
    // 模态框由 game.html 自己处理
  });

  addListener('refresh-page', (event) => {
    // 杀掉残留 Flash 插件进程，触发 plugin-crashed 自动冷启动恢复
    killFlashPluginProcesses();
  });

  addListener('clear-cache', (event) => {
    // 由 game.html 处理
  });

  // 账号相关 IPC
  addListener('get-accounts-window', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      senderWin.webContents.send('accounts-update', accounts);
    }
  });

  addListener('save-accounts-window', (event, accountList) => {
    accounts = accountList || [];
    saveAccounts();
  });

  addListener('launch-account-window', (event, accountId) => {
    // 在当前窗口添加新标签并自动登录
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      const account = accounts.find(a => a.id === accountId);
      if (account) {
        senderWin.webContents.send('launch-account', account);
      }
    }
  });

  addListener('launch-all-accounts-window', (event) => {
    // 在当前窗口启动所有账号
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      const validAccounts = accounts.filter(a => a.qq);
      validAccounts.forEach(account => {
        senderWin.webContents.send('launch-account', account);
      });
    }
  });

  addListener('fill-account', (event, accountId) => {
    // 由 game.html 处理
  });

  addListener('get-config', (event, key) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      senderWin.webContents.send('config-result', config[key]);
    }
  });

  addListener('set-config', (event, key, value) => {
    config[key] = value;
    saveConfig();
  });

  win.on('resize', () => {
    // 窗口大小变化由 webview 自己处理
  });

  win.on('blur', () => {
    win.webContents.send('window-blur');
  });

  win.on('focus', () => {
    win.webContents.send('window-focus');
  });

  win.on('minimize', () => {
    win.webContents.send('window-minimized');
  });

  win.on('restore', () => {
    win.webContents.send('window-restored');
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

      if (accountWindow && !accountWindow.isDestroyed()) {
        accountWindow.close();
        log('账号管理窗口已关闭');
      }

      if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.show();
        launcherWindow.focus();
        launcherWindow.setAlwaysOnTop(true);
        setTimeout(() => {
          if (!launcherWindow.isDestroyed()) {
            launcherWindow.setAlwaysOnTop(false);
            // 置顶切换可能干扰重绘，强制刷新一次
            try { launcherWindow.webContents.invalidate(); } catch (e) {}
          }
        }, 100);
      }
    }
  });

  gameWindows.push({ win });
  log('游戏窗口创建成功: ' + gameName);
  return win;
}

function createTray() {
  const iconPath = getResourcePath('icons', 'Naruto.png');
  let trayIcon = null;
  
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示启动器',
      click: () => {
        if (launcherWindow) {
          launcherWindow.show();
        }
      }
    },
    {
      label: '新建游戏窗口',
      click: () => {
        createGameWindow(DEFAULT_URL, '火影忍者Online');
      }
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: () => {
        log('用户点击托盘退出');
        isQuitting = true;
        try {
          // 退出前停止所有游戏窗口的音频并销毁BrowserView
          for (let i = 0; i < gameWindows.length; i++) {
            const gw = gameWindows[i];
            if (gw.localTabs) {
              gw.localTabs.forEach((tab) => {
                if (tab.webContents && typeof tab.webContents.isDestroyed === 'function' && !tab.webContents.isDestroyed()) {
                  tab.webContents.setAudioMuted(true);
                  tab.webContents.removeAllListeners();
                } else if (tab.webContents) {
                  tab.webContents.setAudioMuted(true);
                  tab.webContents.removeAllListeners();
                }
                if (tab.view && typeof tab.view.destroy === 'function') {
                  try {
                    tab.view.destroy();
                  } catch (e) {}
                }
              });
              gw.localTabs = [];
            }
            if (gw.win && typeof gw.win.isDestroyed === 'function' && !gw.win.isDestroyed()) {
              gw.win.destroy();
            } else if (gw.win) {
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
    }
  ]);
  
  tray.setToolTip('火影忍者Online启动器');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (launcherWindow) {
      launcherWindow.show();
    }
  });
}

ipcMain.on('check-flash', (event) => {
  const found = fs.existsSync(FLASH_PATH);
  event.reply('flash-status', {
    found: found,
    version: FLASH_VERSION,
    path: FLASH_PATH
  });
});

ipcMain.on('launch-game', (event, data) => {
  log('收到启动游戏请求: ' + data.name + ' - ' + data.url);
  
  if (isWindows11 && hvciStatus === 'enabled') {
    showHVCIWarning();
  }
  
  createGameWindow(data.url, data.name);
  
  if (launcherWindow) {
    launcherWindow.hide();
  }
});

ipcMain.on('new-window', (event, url) => {
  log('收到新建窗口请求: ' + (url || '默认URL'));
  const win = createGameWindow(url || DEFAULT_URL, '火影忍者Online');
  log('新建窗口已创建，当前游戏窗口数: ' + gameWindows.length);
});

ipcMain.on('get-window-count', (event) => {
  event.returnValue = gameWindows.length;
});

ipcMain.on('set-speed', (event, speed) => {
  log('收到设置倍速请求: ' + speed + 'x');
  setSpeedRate(speed);
});

ipcMain.on('clear-cache', (event) => {
  log('收到清空缓存请求');
  
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const gameWindow = gameWindows.find(w => w.win === win);
      if (gameWindow && gameWindow.localTabs && gameWindow.localCurrentTabIndex !== undefined) {
        const activeTab = gameWindow.localTabs[gameWindow.localCurrentTabIndex];
        if (activeTab && activeTab.webContents && !activeTab.webContents.isDestroyed()) {
          const wc = activeTab.webContents;
          
          const promises = [];
          promises.push(new Promise((resolve) => {
            wc.session.clearStorageData({
              storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cacheStorage']
            }).then(resolve).catch(resolve);
          }));
          promises.push(new Promise((resolve) => {
            wc.session.clearCache().then(resolve).catch(resolve);
          }));
          
          Promise.all(promises).then(() => {
            log('缓存清除完成');
            wc.loadURL(DEFAULT_URL);
          }).catch((err) => {
            log('缓存清除过程中发生错误: ' + err.message, 'ERROR');
          });
        }
      }
    }
  } catch (e) {
    log('清除缓存失败: ' + e.message, 'WARN');
  }
});

ipcMain.on('refresh-page', (event) => {
  log('收到刷新页面请求');
  
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const gameWindow = gameWindows.find(w => w.win === win);
      if (gameWindow && gameWindow.localTabs && gameWindow.localCurrentTabIndex !== undefined) {
        const activeTab = gameWindow.localTabs[gameWindow.localCurrentTabIndex];
        if (activeTab && activeTab.webContents && !activeTab.webContents.isDestroyed()) {
          activeTab.webContents.loadURL(DEFAULT_URL);
        }
      }
    }
  } catch (e) {
    log('刷新页面失败: ' + e.message, 'WARN');
  }
});

ipcMain.on('log-message', (event, message, level) => {
  log(message, level);
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

function initAutoUpdater() {
  if (!app.isPackaged) {
    log('开发模式下跳过自动更新检查');
    return;
  }
  
  log('初始化自动更新模块，当前版本: ' + CURRENT_VERSION);
  
  let isShowingUpdateDialog = false;
  let updateDownloaded = false;
  let progressWindow = null;
  
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'kirito10010',
    repo: 'naruto-launcher'
  });
  
  autoUpdater.on('checking-for-update', () => {
    log('正在检查更新...');
  });
  
  autoUpdater.on('update-available', (info) => {
    log('发现新版本: ' + info.version);
    log('更新说明: ' + (info.releaseNotes || '无'));
    
    if (isShowingUpdateDialog || updateDownloaded) {
      log('已有更新弹窗显示或更新已下载，跳过重复提示');
      return;
    }
    
    // 处理更新说明，将 HTML 标签转换为纯文本
    let releaseNotes = info.releaseNotes || '无';
    if (typeof releaseNotes === 'string') {
      // 替换常见 HTML 标签
      releaseNotes = releaseNotes
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<p>/gi, '\n')
        .replace(/<\/p>/gi, '')
        .replace(/<li>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<ul>/gi, '\n')
        .replace(/<\/ul>/gi, '')
        .replace(/<ol>/gi, '\n')
        .replace(/<\/ol>/gi, '')
        .replace(/<[^>]+>/g, '') // 移除其他 HTML 标签
        .replace(/\n\s*\n/g, '\n') // 合并多余换行
        .trim();
    }
    
    isShowingUpdateDialog = true;
    dialog.showMessageBox({
      type: 'info',
      title: '发现更新',
      message: `发现新版本 ${info.version}\n\n当前版本: ${CURRENT_VERSION}\n\n更新说明:\n${releaseNotes}`,
      buttons: ['立即更新', '稍后提醒']
    }).then((result) => {
      isShowingUpdateDialog = false;
      if (result.response === 0) {
        createProgressWindow();
        autoUpdater.downloadUpdate();
      }
    }).catch(() => {
      isShowingUpdateDialog = false;
    });
  });
  
  autoUpdater.on('update-not-available', () => {
    log('当前已是最新版本: ' + CURRENT_VERSION);
  });
  
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    const downloaded = (progress.transferred / 1024 / 1024).toFixed(2);
    const total = (progress.total / 1024 / 1024).toFixed(2);
    const speed = (progress.bytesPerSecond / 1024 / 1024).toFixed(2);
    
    log(`下载进度: ${percent}% (${downloaded}MB/${total}MB) ${speed}MB/s`);
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.webContents.send('update-progress', {
        percent: percent,
        downloaded: downloaded,
        total: total,
        speed: speed
      });
    }
  });
  
  function createProgressWindow() {
    progressWindow = new BrowserWindow({
      width: 400,
      height: 160,
      title: '下载更新',
      resizable: false,
      maximizable: false,
      minimizable: false,
      backgroundColor: '#ffffff',
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    
    progressWindow.setMenu(null);
    
    const progressHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
      padding: 24px;
      font-family: 'Microsoft YaHei', sans-serif;
      color: #333333;
    }
    .progress-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      height: 100%;
      justify-content: center;
    }
    .title {
      font-size: 14px;
      text-align: center;
      color: #333333;
    }
    .progress-bar {
      height: 8px;
      background: #f0f0f0;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4a90d9, #357abd);
      border-radius: 4px;
      transition: width 0.3s ease;
      min-width: 0%;
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #666666;
    }
  </style>
</head>
<body>
  <div class="progress-container">
    <div class="title">正在下载更新...</div>
    <div class="progress-bar">
      <div class="progress-fill" id="progressFill"></div>
    </div>
    <div class="progress-info">
      <span id="progressText">0% (0MB/0MB)</span>
      <span id="speedText">0MB/s</span>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('update-progress', (event, data) => {
      document.getElementById('progressFill').style.width = data.percent + '%';
      document.getElementById('progressText').textContent = data.percent + '% (' + data.downloaded + 'MB/' + data.total + 'MB)';
      document.getElementById('speedText').textContent = data.speed + 'MB/s';
    });
  </script>
</body>
</html>`;
    
    progressWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(progressHtml));
    
    progressWindow.once('ready-to-show', () => {
      progressWindow.show();
    });
    
    progressWindow.on('closed', () => {
      progressWindow = null;
    });
  }
  
  autoUpdater.on('update-downloaded', (info) => {
    log('更新包下载完成');
    updateDownloaded = true;
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }
    
    if (isShowingUpdateDialog) {
      log('已有弹窗显示，等待关闭后再显示更新完成提示');
      return;
    }
    
    isShowingUpdateDialog = true;
    dialog.showMessageBox({
      type: 'info',
      title: '更新完成',
      message: `更新包已下载完成，版本: ${info.version}\n\n请重启应用以应用更新。`,
      buttons: ['立即重启', '稍后重启']
    }).then((result) => {
      isShowingUpdateDialog = false;
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }).catch(() => {
      isShowingUpdateDialog = false;
    });
  });
  
  autoUpdater.on('error', (err) => {
    log('自动更新错误: ' + err.message, 'ERROR');
    isShowingUpdateDialog = false;
    
    if (progressWindow && !progressWindow.isDestroyed()) {
      progressWindow.close();
      progressWindow = null;
    }
  });
  
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 5000);
}

let accountWindow = null;

function createAccountWindow() {
  if (accountWindow && !accountWindow.isDestroyed()) {
    accountWindow.focus();
    return;
  }
  
  accountWindow = new BrowserWindow({
    width: 360,
    height: 500,
    resizable: false,
    title: '账号管理',
    parent: null,
    modal: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false
    }
  });
  
  accountWindow.on('closed', () => {
    accountWindow = null;
  });
  
  const accountHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>账号管理</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 16px; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .header h2 { font-size: 18px; }
    .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
    .btn-add { background: #00d4ff; color: #1a1a2e; font-weight: bold; }
    .btn-add:hover { background: #00b8e6; }
    .btn-launch-all { background: #10b981; color: #fff; }
    .btn-launch-all:hover { background: #059669; }
    .btn-close { background: transparent; color: #aaa; padding: 4px 8px; }
    .btn-close:hover { color: #fff; }
    .account-list { max-height: 320px; overflow-y: auto; }
    .account-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #2d2d44; border-radius: 6px; margin-bottom: 8px; cursor: pointer; }
    .account-item:hover { background: #3d3d5c; }
    .account-info { flex: 1; }
    .account-name { color: #00d4ff; font-weight: 500; }
    .account-qq { color: #aaa; font-size: 12px; }
    .account-actions { display: flex; gap: 4px; }
    .action-btn { width: 28px; height: 28px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .action-btn.open { background: #10b981; color: #fff; }
    .action-btn.edit { background: #ffd700; color: #1a1a2e; }
    .action-btn.delete { background: #e74c3c; color: #fff; }
    .empty-hint { text-align: center; color: #666; padding: 40px; }
    .modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; }
    .modal-box { background: #2d2d44; border-radius: 8px; padding: 20px; width: 300px; }
    .modal-box h3 { margin-bottom: 16px; }
    .modal-box input { width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #4a4a6a; border-radius: 4px; background: #1a1a2e; color: #fff; }
    .modal-box button { flex: 1; padding: 10px; border: none; border-radius: 4px; margin-top: 10px; }
    .btn-cancel { background: #4a4a6a; color: #fff; }
    .btn-save { background: #00d4ff; color: #1a1a2e; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <h2>账号列表</h2>
    <div style="display: flex; gap: 8px;">
      <button class="btn btn-launch-all" id="launchAll">一键启动</button>
      <button class="btn btn-add" id="addAccount">+ 添加</button>
      <button class="btn btn-close" onclick="window.close()">×</button>
    </div>
  </div>
  <div class="account-list" id="accountList"></div>
  
  <script>
    const { ipcRenderer } = require('electron');
    let accounts = [];
    
    function renderList() {
      const list = document.getElementById('accountList');
      if (accounts.length === 0) {
        list.innerHTML = '<div class="empty-hint">暂无账号</div>';
        return;
      }
      list.innerHTML = accounts.map(a => \`
        <div class="account-item" data-id="\${a.id}">
          <div class="account-info">
            <div class="account-name">\${a.windowName || a.qq}</div>
            <div class="account-qq">\${a.qq}</div>
          </div>
          <div class="account-actions">
            <button class="action-btn open" onclick="launchAccount('\${a.id}')">⊞</button>
            <button class="action-btn edit" onclick="editAccount('\${a.id}')">✏</button>
            <button class="action-btn delete" onclick="deleteAccount('\${a.id}')">✕</button>
          </div>
        </div>
      \`).join('');
    }
    
    function showModal(title, account = null) {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = \`
        <div class="modal-box">
          <h3>\${title}</h3>
          <input id="qqInput" placeholder="QQ号/邮箱" value="\${account?.qq || ''}" />
          <input id="pwdInput" type="password" placeholder="密码（可选）" value="\${account?.qqPwd || ''}" />
          <input id="nameInput" placeholder="窗口名（可选）" value="\${account?.windowName || ''}" />
          <div style="display: flex; gap: 10px;">
            <button class="btn-cancel" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
            <button class="btn-save" onclick="saveAccount('\${account?.id || ''}')">保存</button>
          </div>
        </div>
      \`;
      document.body.appendChild(modal);
    }
    
    function saveAccount(accountId) {
      const qq = document.getElementById('qqInput').value.trim();
      const pwd = document.getElementById('pwdInput').value;
      const name = document.getElementById('nameInput').value.trim();
      if (!qq) return;
      
      if (accountId) {
        ipcRenderer.send('update-account', { id: accountId, qq, password: pwd, windowName: name });
      } else {
        ipcRenderer.send('add-account', { qq, password: pwd, windowName: name });
      }
      document.querySelector('.modal').remove();
    }
    
    function launchAccount(accountId) {
      ipcRenderer.send('launch-account', accountId);
    }
    
    function editAccount(accountId) {
      const account = accounts.find(a => a.id === accountId);
      if (account) showModal('编辑账号', account);
    }
    
    function deleteAccount(accountId) {
      if (confirm('确定删除此账号？')) {
        ipcRenderer.send('remove-account', accountId);
      }
    }
    
    document.getElementById('addAccount').addEventListener('click', () => showModal('添加账号'));
    document.getElementById('launchAll').addEventListener('click', () => ipcRenderer.send('launch-all-accounts'));
    
    ipcRenderer.send('get-accounts');
    
    ipcRenderer.on('accounts-update', (event, data) => {
      accounts = data || [];
      renderList();
    });
  </script>
</body>
</html>
  `;
  
  accountWindow.loadURL('data:text/html,' + encodeURIComponent(accountHtml));
}

ipcMain.on('get-accounts', (event) => {
  log('[IPC] 收到 get-accounts 请求');
  loadAccounts();
  log('[IPC] 账号数量: ' + accounts.length);
  
  try {
    event.sender.send('accounts-update', accounts);
    log('[IPC] 已向发送者发送 accounts-update 事件');
  } catch (err) {
    log('[IPC] 发送失败：' + err.message, 'ERROR');
  }
});

ipcMain.on('debug-log', (event, message) => {
  log('[DEBUG] ' + message);
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

ipcMain.on('launch-account', (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (!account) {
    log('[账号启动] 未找到账号: ' + accountId);
    return;
  }
  
  const winName = account.windowName || account.qq;
  log('[账号启动] ====================');
  log('[账号启动] 启动账号: ' + winName + ' (' + account.qq + ')');
  log('[账号启动] 游戏窗口数量: ' + gameWindows.length);
  
  let targetGameWindow = gameWindows.find(w => w.win && !w.win.isDestroyed());
  
  if (!targetGameWindow) {
    log('[账号启动] 没有找到游戏窗口，创建新窗口');
    createGameWindow(DEFAULT_URL, winName, account);
    
    setTimeout(() => {
      const newWindow = gameWindows.find(w => w.win && !w.win.isDestroyed());
      if (newWindow && newWindow.localTabs && newWindow.localTabs[0]) {
        newWindow.localTabs[0]._pendingAccount = { qq: account.qq, qqPwd: account.qqPwd || '' };
        log('[账号启动] 已设置自动登录: ' + account.qq);
      }
    }, 500);
  } else {
    log('[账号启动] 找到现有窗口，窗口ID: ' + targetGameWindow.win.id);
    log('[账号启动] 当前标签数量: ' + (targetGameWindow.localTabs ? targetGameWindow.localTabs.length : 0));
    log('[账号启动] 在现有窗口添加标签: ' + winName);
    
    const newTab = addTabToGameWindow(targetGameWindow, winName, account);
    if (newTab) {
      log('[账号启动] 新标签创建成功，索引: ' + newTab.index);
      newTab._pendingAccount = { qq: account.qq, qqPwd: account.qqPwd || '' };
      setupAutoLogin(newTab);
      log('[账号启动] 已设置自动登录: ' + account.qq);
    } else {
      log('[账号启动] 添加标签失败');
    }
  }
});

ipcMain.on('launch-all-accounts', () => {
  const validAccounts = accounts.filter(a => a.qq);
  log('[一键启动] 准备启动 ' + validAccounts.length + ' 个账号');
  
  let targetGameWindow = gameWindows.find(w => w.win && !w.win.isDestroyed());
  
  validAccounts.forEach((account, index) => {
    const winName = account.windowName || account.qq;
    
    if (index === 0 && !targetGameWindow) {
      log('[一键启动] 第1个账号，创建新窗口: ' + winName);
      const win = createGameWindow(DEFAULT_URL, winName, account);
      targetGameWindow = gameWindows.find(w => w.win === win);
      if (targetGameWindow && targetGameWindow.localTabs && targetGameWindow.localTabs[0]) {
        targetGameWindow.localTabs[0]._pendingAccount = { qq: account.qq, qqPwd: account.qqPwd || '' };
        setupAutoLogin(targetGameWindow.localTabs[0]);
      }
    } else {
      log('[一键启动] 添加标签: ' + winName);
      if (targetGameWindow) {
        const newTab = addTabToGameWindow(targetGameWindow, winName, account);
        if (newTab) {
          newTab._pendingAccount = { qq: account.qq, qqPwd: account.qqPwd || '' };
          setupAutoLogin(newTab);
        }
      }
    }
  });
  
  log('[一键启动] 完成启动 ' + validAccounts.length + ' 个账号');
});

ipcMain.on('fill-account', (event, accountId) => {
  const account = accounts.find(a => a.id === accountId);
  if (account) {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin) {
      const gameWindow = gameWindows.find(w => w.win === senderWin);
      if (gameWindow && gameWindow.localTabs && gameWindow.localCurrentTabIndex !== undefined) {
        const activeTab = gameWindow.localTabs[gameWindow.localCurrentTabIndex];
        if (activeTab && activeTab.webContents) {
          injectQuickLogin(activeTab.webContents, account.qq, account.qqPwd || '');
        }
      }
    }
  }
});

function addTabToGameWindow(gameWindow, name, account) {
  if (!gameWindow || !gameWindow.win || gameWindow.win.isDestroyed()) {
    log('[addTab] 窗口无效');
    return null;
  }
  
  const win = gameWindow.win;
  const localTabs = gameWindow.localTabs || [];
  const toolbarHeight = 36;
  
  const tabIndex = localTabs.length + 1;
  log('[addTab] 创建新标签 Tab' + tabIndex + ', 名称: ' + name);
  
  const sessionId = account && account.qq ? `persist:qq-${account.qq}` : `persist:game-session-${win.id}-${tabIndex}`;
  log('[addTab] 使用Session: ' + sessionId);
  
  const session = require('electron').session.fromPartition(sessionId, {
    cache: true,
    storage: sessionId
  });

  const { BrowserView } = require('electron');
  const view = new BrowserView({
    webPreferences: {
      plugins: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRunningInsecureContent: true,
      session: session,
      enableRemoteModule: false,
      sandbox: false,
      backgroundThrottling: true,
      offscreen: false,
      enablePreferredSizeMode: false
    }
  });

  win.addBrowserView(view);
  const contentBounds = win.getContentBounds();
  view.setBounds({ x: 0, y: toolbarHeight, width: contentBounds.width, height: contentBounds.height - toolbarHeight });

  const webContents = view.webContents;
  webContents.loadURL(DEFAULT_URL);

  const tabInfo = {
    index: tabIndex,
    name: name || '窗口' + tabIndex,
    view: view,
    webContents: webContents,
    speedRate: 1,
    _pendingAccount: null
  };

  localTabs.push(tabInfo);
  gameWindow.localTabs = localTabs;
  
  // 隐藏新标签，保持当前标签显示
  const bounds = win.getBounds();
  
  localTabs.forEach((tab, idx) => {
    if (idx === gameWindow.localCurrentTabIndex) {
      tab.view.setBounds({ x: 0, y: toolbarHeight, width: bounds.width, height: bounds.height - toolbarHeight });
      win.addBrowserView(tab.view);
    } else {
      tab.view.setBounds({ x: 0, y: bounds.height, width: bounds.width, height: 0 });
    }
  });
  
  webContents.on('did-finish-load', () => {
    log('Tab' + tabIndex + ' 加载完成');
    injectAllChildProcesses();
  });

  webContents.on('did-navigate', () => {
    log('Tab' + tabIndex + ' 页面导航');
  });

  // 阻止新窗口打开，在当前标签内跳转
  webContents.on('new-window', (event, newUrl) => {
    log('Tab' + tabIndex + ' 阻止新窗口: ' + newUrl);
    event.preventDefault();
    webContents.loadURL(newUrl);
  });

  // 更新工具栏标签列表
  setTimeout(() => {
    if (typeof gameWindow.updateToolbarTabList === "function") {
      gameWindow.updateToolbarTabList();
      log('[addTab] 已调用updateToolbarTabList');
    } else {
      log('[addTab] updateToolbarTabList函数不存在');
    }
  }, 200);

  log('[addTab] 标签创建完成: ' + name);
  return tabInfo;
}

app.whenReady().then(() => {
  log('应用启动');
  loadConfig();
  loadAccounts();
  detectWindowsVersion();
  initSpeedControl();
  initAutoUpdater();

  // 启动时延迟执行自动清理，避免同步 IO 阻塞主进程
  setTimeout(() => {
    if (gameWindows.length === 0) {
      performStartupCleanup();
    }
  }, 3000);
  
  ipcMain.on('set-theme', (event, theme) => {
    currentTheme = theme;
    saveConfig();
    log('主题已切换为: ' + theme);
    
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.webContents.send('theme-changed', theme);
      // 强制重绘，修复启动器隐藏后重新显示时主题不刷新的问题
      try { launcherWindow.webContents.invalidate(); } catch (e) {}
    }
    
    // 游戏窗口监听的是 theme-update，且加空值保护避免解构崩溃
    gameWindows.forEach((gw) => {
      if (gw && gw.win && !gw.win.isDestroyed()) {
        gw.win.webContents.send('theme-update', theme);
      }
    });
  });
  
  // Flash 版本选择：内置国际版 / 系统国内版
  ipcMain.on('set-flash-choice', async (event, choice) => {
    config.flashChoice = (choice === 'system') ? 'system' : 'bundled';
    saveConfig();
    log('Flash 版本已切换为: ' + config.flashChoice);
    const label = (config.flashChoice === 'system') ? '系统国内版 34.0.0.380' : '内置国际版 32.0.0.344';
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Flash 版本切换',
      message: '已切换到「' + label + '」，需要重启应用才能生效。',
      buttons: ['立即重启', '稍后']
    });
    if (response === 0) {
      app.relaunch();
      app.exit(0);
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
  
  createLauncherWindow();
  createTray();
  
  setTimeout(() => {
    if (isWindows11 && hvciStatus === 'enabled') {
      showHVCIWarning();
    }
  }, 3000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (launcherWindow === null) {
    createLauncherWindow();
  }
});

app.on('before-quit', () => {
  saveConfig();
  performExitCleanup();
});
