const { app, BrowserWindow, BrowserView, ipcMain, screen, Tray, Menu, nativeImage, dialog } = require('electron');
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
  lastSpeed: 1
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
  const paths = [
    getResourcePath('flash', 'pepflashplayer.dll'),
    getResourcePath('flash', `pepflashplayer${arch}_32_0_0_344.dll`),
    getResourcePath('flash', arch === '64' ? 'pepflashplayer64_32_0_0_344.dll' : 'pepflashplayer32_32_0_0_344.dll'),
    path.join(__dirname, 'flash', 'pepflashplayer.dll'),
    'C:\\Users\\kirito\\AppData\\Roaming\\Tencent\\QQMicroGameBox\\Flash\\pepflashplayer.dll'
  ];
  
  for (const p of paths) {
    if (fs.existsSync(p)) {
      log(`找到Flash插件: ${p}`);
      return p;
    }
  }
  return null;
}

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  console.log(logEntry.trim());
  try {
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

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

function getAllChildProcessesRecursive(parentPid) {
  return new Promise((resolve, reject) => {
    const psCommand = 'Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId=' + parentPid + '" | Select-Object ProcessId,CommandLine | ForEach-Object { Write-Output "ProcessId=$($_.ProcessId)`nCommandLine=$($_.CommandLine)" }';
    
    exec('powershell.exe -Command "' + psCommand + '"', { encoding: 'utf-8', timeout: 5000 }, function (err, stdout) {
      if (err) {
        log('扫描子进程失败: ' + err.message, 'WARN');
        resolve([]);
        return;
      }
      
      const pids = [];
      const lines = stdout.split('\n');
      let cmdLine = '';
      let pid = '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('CommandLine=')) {
          cmdLine = trimmed.substring('CommandLine='.length);
        } else if (trimmed.startsWith('ProcessId=')) {
          pid = trimmed.substring('ProcessId='.length);
        }
        if (pid && cmdLine) {
          const numPid = parseInt(pid.trim(), 10);
          if (numPid && !injectedPids.has(numPid) && numPid !== parentPid) {
            const isRelevant = cmdLine.includes('--type=') ||
              cmdLine.includes('gpu-process') ||
              cmdLine.includes('plugin') ||
              cmdLine.includes('ppapi') ||
              cmdLine.includes('renderer');
            if (isRelevant) {
              pids.push(numPid);
            }
          }
          cmdLine = '';
          pid = '';
        }
      }
      
      log('通过PowerShell找到 ' + pids.length + ' 个子进程');
      resolve(pids);
    });
  });
}

async function injectAllChildProcesses() {
  try {
    const mainPid = process.pid;
    log('扫描主进程 ' + mainPid + ' 的子进程');
    
    const childPids = await getAllChildProcessesRecursive(mainPid);
    log('找到 ' + childPids.length + ' 个相关子进程');
    
    for (const pid of childPids) {
      log('准备注入子进程 PID=' + pid);
      injectSpeedHook(pid);
    }
    
    if (isWindows11) {
      log('Windows 11系统，延迟2秒后进行第二轮注入');
      setTimeout(secondPass, 2000);
    }
  } catch (e) {
    log('扫描子进程失败: ' + e.message, 'WARN');
  }
}

async function secondPass() {
  try {
    const mainPid = process.pid;
    const childPids = await getAllChildProcessesRecursive(mainPid);
    
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
const FLASH_VERSION = FLASH_PATH && FLASH_PATH.includes('32_0_0_344') ? '32.0.0.344' : '34.0.0.242';

if (FLASH_PATH) {
  app.commandLine.appendSwitch('ppapi-flash-path', FLASH_PATH);
  app.commandLine.appendSwitch('ppapi-flash-version', FLASH_VERSION);
  log('Flash插件已配置: ' + FLASH_PATH + ' (' + FLASH_VERSION + ')');
} else {
  log('Flash插件未找到！', 'ERROR');
}

app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding');
app.commandLine.appendSwitch('disable-flash-3d-software-renderer');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-fast-uncompress');
app.commandLine.appendSwitch('enable-fast-startup');
app.commandLine.appendSwitch('max-gum-fps', '60');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,EnableSkiaRenderer');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');

function createLauncherWindow() {
  const colors = getThemeColors();
  
  launcherWindow = new BrowserWindow({
    width: 360,
    height: 420,
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
      justify-content: center;
      padding-bottom: 10px;
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
    <button class="join-group-btn" onclick="joinQQGroup()">💬 加入QQ群 489455643</button>
  </div>
  
  <script>
    const { ipcRenderer, shell } = require('electron');
    
    function launchGame(url, name) {
      ipcRenderer.send('launch-game', { url, name });
    }
    
    function joinQQGroup() {
      shell.openExternal('https://qm.qq.com/q/kHOKaFZRqo');
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
  </script>
</body>
</html>`;
  
  launcherWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(launcherHtml));

  launcherWindow.webContents.on('did-finish-load', () => {
    launcherWindow.webContents.send('theme-changed', currentTheme);
  });

  launcherWindow.on('close', (event) => {
    if (gameWindows.length > 0) {
      event.preventDefault();
      launcherWindow.hide();
    } else {
      launcherWindow = null;
      app.quit();
    }
  });

  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });

  log('启动器窗口创建成功');
}

function createGameWindow(url, gameName, account) {
  if (!url) url = DEFAULT_URL;
  if (!gameName) gameName = '游戏';
  
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
  const gameWidth = Math.floor(width * 0.95);
  const gameHeight = Math.floor(height * 0.95) - toolbarHeight;

  const colors = getThemeColors();
  
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
      defaultFontSize: 16
    },
    show: true,
    fullscreenable: true,
    simpleFullscreen: false
  });
  
  win.webContents.setZoomFactor(1.0);

  win.setMenu(null);
  
  const windowId = gameWindows.length + 1;
  let localTabs = [];
  let localCurrentTabIndex = 0;
  
  function addTab(tabUrl, tabName, acc) {
    const tabIndex = localTabs.length + 1;
    const accForSession = acc || (localTabs.length === 0 ? account : null);
    const sessionId = accForSession && accForSession.qq ? `persist:qq-${accForSession.qq}` : `persist:game-session-${windowId}-${tabIndex}`;
    const session = require('electron').session.fromPartition(sessionId, {
      cache: true,
      storage: sessionId
    });
    
    session.cookies.on('changed', (event, cookie, cause, removed) => {
      log('Tab' + tabIndex + ' Cookie变化: ' + cookie.name + '=' + cookie.value.substring(0, 20) + '... ' + (removed ? '删除' : cause));
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
        sandbox: false
      }
    });

    win.addBrowserView(view);
    
    view.setBounds({ x: 0, y: toolbarHeight, width: win.getBounds().width, height: win.getBounds().height - toolbarHeight });
    view.setAutoResize({ width: true, height: true });

    const webContents = view.webContents;
    
    webContents.loadURL(tabUrl);

    const tabInfo = {
      index: tabIndex,
      name: tabName,
      view: view,
      webContents: webContents,
      speedRate: 1,
      _pendingAccount: null
    };

    localTabs.push(tabInfo);
    
    const gameWinIndex = gameWindows.findIndex(w => w.win === win);
    if (gameWinIndex !== -1) {
      gameWindows[gameWinIndex].localTabs = localTabs;
    }
    
    updateToolbarTabList();
    switchTab(tabIndex);
    
    function tryAutoLogin() {
      if (!tabInfo._pendingAccount) return;
      
      const acc = tabInfo._pendingAccount;
      injectQuickLogin(webContents, acc.qq, acc.qqPwd);
      tabInfo._pendingAccount = null;
    }
    
    webContents.on('did-finish-load', () => {
      log('Tab' + tabIndex + ' 加载完成');
      injectAllChildProcesses();
      tryAutoLogin();
    });

    webContents.on('did-navigate', () => {
      tryAutoLogin();
    });

    webContents.on('new-window', (event, newUrl) => {
      event.preventDefault();
      webContents.loadURL(newUrl);
    });

    return tabInfo;
  }

  function switchTab(index) {
    if (index < 1 || index > localTabs.length) return;
    
    const targetIndex = index - 1;
    const bounds = win.getBounds();
    
    localTabs.forEach((tab, idx) => {
      if (idx === targetIndex) {
        tab.view.setBounds({ x: 0, y: toolbarHeight, width: bounds.width, height: bounds.height - toolbarHeight });
        win.addBrowserView(tab.view);
      } else {
        tab.view.setBounds({ x: 0, y: bounds.height, width: bounds.width, height: 0 });
      }
    });
    localCurrentTabIndex = targetIndex;
    
    const gameWinIndex = gameWindows.findIndex(w => w.win === win);
    if (gameWinIndex !== -1) {
      gameWindows[gameWinIndex].localCurrentTabIndex = localCurrentTabIndex;
    }
    
    const activeTab = localTabs[localCurrentTabIndex];
    if (activeTab && activeTab.webContents) {
      activeTab.webContents.setAudioMuted(isAudioMuted);
    }
    
    updateToolbarTabList();
    log('切换到Tab: ' + index);
  }

  function closeTab(index) {
    if (index < 1 || index > localTabs.length) return;
    if (localTabs.length <= 1) {
      win.close();
      return;
    }
    
    const targetIndex = index - 1;
    const tabToClose = localTabs[targetIndex];
    
    if (tabToClose) {
      win.removeBrowserView(tabToClose.view);
      localTabs.splice(targetIndex, 1);
      
      if (localCurrentTabIndex >= localTabs.length) {
        localCurrentTabIndex = localTabs.length - 1;
      }
      
      const gameWinIndex = gameWindows.findIndex(w => w.win === win);
      if (gameWinIndex !== -1) {
        gameWindows[gameWinIndex].localTabs = localTabs;
        gameWindows[gameWinIndex].localCurrentTabIndex = localCurrentTabIndex;
      }
      
      switchTab(localCurrentTabIndex + 1);
      updateToolbarTabList();
      log('关闭Tab: ' + index);
    }
  }

  function updateToolbarTabList() {
    const tabList = localTabs.map((tab, idx) => ({ index: idx + 1, name: tab.name || ('窗口' + (idx + 1)) }));
    win.webContents.send('update-tab-list', { tabs: tabList, currentIndex: localCurrentTabIndex + 1 });
    log('[updateToolbarTabList] 更新标签列表: ' + JSON.stringify(tabList));
  }

  const toolbarHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: linear-gradient(180deg, ${colors.bg1} 0%, ${colors.bg2} 100%);
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px;
      -webkit-app-region: drag;
      overflow: hidden;
      border-bottom: 1px solid ${colors.border};
    }
    .toolbar-left { display: flex; align-items: center; gap: 4px; flex: 1; }
    .toolbar-center { display: flex; align-items: center; gap: 8px; -webkit-app-region: no-drag; }
    .toolbar-right { display: flex; align-items: center; gap: 8px; -webkit-app-region: no-drag; }
    .title {
      color: ${colors.text};
      font-size: 13px;
      font-weight: 500;
      margin-right: 8px;
    }
    .tabs-container {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .tab {
      height: 28px;
      padding: 0 12px;
      border: 1px solid ${colors.border};
      border-radius: 4px 4px 0 0;
      background: linear-gradient(${colors.btnBg}, ${colors.btnHover});
      color: ${colors.text};
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      -webkit-app-region: no-drag;
    }
    .tab:hover {
      background: linear-gradient(${colors.btnHover}, #e8e8e8);
    }
    .tab.active {
      background: #fff;
      border-bottom-color: #fff;
      color: #333;
    }
    .tab-close {
      font-size: 10px;
      opacity: 0.6;
    }
    .tab-close:hover {
      opacity: 1;
      color: #e74c3c;
    }
    .tab-add {
      height: 28px;
      width: 28px;
      border: 1px solid ${colors.border};
      border-radius: 4px;
      background: linear-gradient(${colors.btnBg}, ${colors.btnHover});
      color: ${colors.text};
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-app-region: no-drag;
    }
    .tab-add:hover {
      background: linear-gradient(${colors.btnHover}, #e8e8e8);
    }
    .btn {
      height: 24px;
      padding: 0 12px;
      border: 1px solid ${colors.border};
      border-radius: 4px;
      background: linear-gradient(${colors.btnBg}, ${colors.btnHover});
      color: ${colors.text};
      font-size: 12px;
      cursor: pointer;
      outline: none;
      font-family: 'Microsoft YaHei', sans-serif;
      min-width: 40px;
      transition: all .15s;
      -webkit-app-region: no-drag;
    }
    .btn:hover {
      background: linear-gradient(${colors.btnHover}, #e8e8e8);
      border-color: #ccc;
    }
    .btn:active {
      background: linear-gradient(#e8e8e8, #d8d8d8);
    }
    .btn.active {
      background: linear-gradient(#e74c3c, #c0392b);
      border-color: #a0291b;
      color: #fff;
    }
    .separator {
      width: 1px;
      height: 18px;
      background: ${colors.separator};
    }
    .select-container {
      position: relative;
    }
    .select-container select {
      height: 24px;
      padding: 0 24px 0 8px;
      border: 1px solid ${colors.border};
      border-radius: 4px;
      background: ${colors.btnBg};
      color: ${colors.text};
      font-size: 12px;
      cursor: pointer;
      outline: none;
      font-family: 'Microsoft YaHei', sans-serif;
      min-width: 70px;
      appearance: none;
      -webkit-appearance: none;
    }
    .select-container::after {
      content: '▼';
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 8px;
      color: ${colors.text};
      pointer-events: none;
    }
    .window-controls {
      display: flex;
      gap: 4px;
    }
    .control-btn {
      width: 28px;
      height: 24px;
      border: none;
      background: transparent;
      color: ${colors.text};
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-appearance: none;
    }
    .control-btn:hover {
      background: rgba(0,0,0,.05);
    }
    .control-btn.close:hover {
      background: #e74c3c;
      color: #fff;
    }
    .account-sidebar {
      position: fixed;
      right: -280px;
      top: 36px;
      width: 280px;
      height: calc(100vh - 36px);
      background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
      border-left: 1px solid #4a4a6a;
      transition: right 0.3s ease;
      z-index: 1000;
      display: flex;
      flex-direction: column;
    }
    .account-sidebar.visible {
      right: 0;
    }
    .account-sidebar-header {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #4a4a6a;
      gap: 8px;
    }
    .account-sidebar-header h3 {
      color: #fff;
      font-size: 14px;
      flex: 1;
      margin: 0;
    }
    .account-sidebar-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
    }
    .account-sidebar-add {
      background: #00d4ff;
      color: #1a1a2e;
      font-weight: bold;
    }
    .account-sidebar-add:hover {
      background: #00b8e6;
    }
    .account-sidebar-launch-all {
      background: #10b981;
      color: #fff;
    }
    .account-sidebar-launch-all:hover {
      background: #059669;
    }
    .account-sidebar-close {
      background: transparent;
      color: #aaa;
      padding: 4px 8px;
    }
    .account-sidebar-close:hover {
      color: #fff;
    }
    .account-sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .account-sidebar-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: #2d2d44;
      border-radius: 6px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .account-sidebar-item:hover {
      background: #3d3d5c;
    }
    .account-sidebar-info {
      flex: 1;
      min-width: 0;
    }
    .account-sidebar-win-name {
      color: #00d4ff;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .account-sidebar-qq {
      color: #aaa;
      font-size: 11px;
    }
    .account-sidebar-actions {
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .account-sidebar-item:hover .account-sidebar-actions {
      opacity: 1;
    }
    .account-sidebar-action-btn {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .account-sidebar-action-btn:hover {
      background: rgba(255,255,255,0.2);
    }
    .account-sidebar-action-btn.open {
      color: #10b981;
    }
    .account-sidebar-action-btn.edit {
      color: #ffd700;
    }
    .account-sidebar-action-btn.delete {
      color: #e74c3c;
    }
    .account-sidebar-hint {
      text-align: center;
      color: #666;
      font-size: 12px;
      padding: 20px;
    }
    .add-account-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
    }
    .add-account-box {
      background: #2d2d44;
      border-radius: 12px;
      padding: 24px;
      width: 320px;
    }
    .add-account-box h3 {
      color: #fff;
      font-size: 16px;
      margin-bottom: 16px;
      text-align: center;
    }
    .add-account-box input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #4a4a6a;
      border-radius: 6px;
      background: #1a1a2e;
      color: #fff;
      font-size: 13px;
      margin-bottom: 10px;
      outline: none;
    }
    .add-account-box input:focus {
      border-color: #00d4ff;
    }
    .add-account-box input::placeholder {
      color: #666;
    }
    .add-account-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }
    .add-account-actions button {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-cancel {
      background: #4a4a6a;
      color: #fff;
    }
    .btn-cancel:hover {
      background: #5a5a7a;
    }
    .btn-confirm {
      background: #00d4ff;
      color: #1a1a2e;
      font-weight: bold;
    }
    .btn-confirm:hover {
      background: #00b8e6;
    }
  </style>
</head>
<body>
  <div class="toolbar-left">
    <span class="title">${gameName}</span>
    <div class="tabs-container" id="tabs-container">
      <div class="tab active" data-tab="1">
        <span>窗口1</span>
        <span class="tab-close" data-tab="1">×</span>
      </div>
      <div class="tab-add" id="tab-add">+</div>
    </div>
  </div>
  <div class="toolbar-center">
    <button class="btn" id="btn-refresh" title="刷新页面（保留登录状态）">刷新</button>
    <button class="btn" id="btn-clear-cache" title="清空缓存并重新加载">清空缓存</button>
    <div class="separator"></div>
    <button class="btn" id="btn-accounts" title="账号管理">👤 账号</button>
    <div class="separator"></div>
    <div class="select-container">
      <select id="speed-select">
        <option value="1"${currentSpeedRate === 1 ? ' selected' : ''}>1x (还原)</option>
        <option value="2"${currentSpeedRate === 2 ? ' selected' : ''}>2x</option>
        <option value="4"${currentSpeedRate === 4 ? ' selected' : ''}>4x</option>
        <option value="6"${currentSpeedRate === 6 ? ' selected' : ''}>6x</option>
        <option value="10"${currentSpeedRate === 10 ? ' selected' : ''}>10x</option>
        <option value="20"${currentSpeedRate === 20 ? ' selected' : ''}>20x</option>
        <option value="0.5"${currentSpeedRate === 0.5 ? ' selected' : ''}>0.5x (减速)</option>
      </select>
    </div>
    <div class="separator"></div>
    <button class="btn" id="btn-mute" title="切换静音">${isAudioMuted ? '🔇' : '🔊'}</button>
  </div>
  <div class="toolbar-right">
    <div class="window-controls">
      <button class="control-btn" id="btn-min">-</button>
      <button class="control-btn" id="btn-max">□</button>
      <button class="control-btn close" id="btn-close">×</button>
    </div>
  </div>
  
  <div class="account-sidebar" id="account-sidebar">
    <div class="account-sidebar-header">
      <h3>账号列表</h3>
      <button class="account-sidebar-btn account-sidebar-launch-all" id="accountLaunchAll" title="一键启动全部">一键启动</button>
      <button class="account-sidebar-btn account-sidebar-add" id="accountSidebarAdd" title="添加账号">+</button>
      <button class="account-sidebar-btn account-sidebar-close" id="accountSidebarClose" title="关闭">×</button>
    </div>
    <div class="account-sidebar-list" id="account-sidebar-list">
    </div>
  </div>
  
  <script>
    const { ipcRenderer } = require('electron');
    let isMuted = ${isAudioMuted ? 'true' : 'false'};
    
    document.getElementById('tab-add').addEventListener('click', () => {
      ipcRenderer.send('new-tab');
    });
    
    document.getElementById('tabs-container').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) {
        const tabIndex = parseInt(tab.dataset.tab);
        if (e.target.classList.contains('tab-close')) {
          ipcRenderer.send('close-tab', tabIndex);
        } else {
          ipcRenderer.send('switch-tab', tabIndex);
        }
      }
    });
    
    document.getElementById('btn-refresh').addEventListener('click', () => {
      ipcRenderer.send('refresh-page');
    });
    
    document.getElementById('btn-clear-cache').addEventListener('click', () => {
      ipcRenderer.send('clear-cache');
    });
    
    document.getElementById('speed-select').addEventListener('change', (e) => {
      ipcRenderer.send('set-game-speed', parseFloat(e.target.value));
    });
    
    document.getElementById('btn-mute').addEventListener('click', () => {
      isMuted = !isMuted;
      const btn = document.getElementById('btn-mute');
      btn.textContent = isMuted ? '🔇' : '🔊';
      ipcRenderer.send('toggle-mute', isMuted);
    });
    
    document.getElementById('btn-min').addEventListener('click', () => {
      ipcRenderer.send('min-window');
    });
    
    document.getElementById('btn-max').addEventListener('click', () => {
      ipcRenderer.send('max-window');
    });
    
    document.getElementById('btn-close').addEventListener('click', () => {
      ipcRenderer.send('close-window');
    });
    
    ipcRenderer.on('speed-update', (event, speed) => {
      document.getElementById('speed-select').value = speed;
    });
    
    ipcRenderer.on('update-tab-list', (event, data) => {
      const container = document.getElementById('tabs-container');
      container.innerHTML = '';
      
      data.tabs.forEach(function(tab) {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab' + (tab.index === data.currentIndex ? ' active' : '');
        tabEl.dataset.tab = tab.index;
        tabEl.innerHTML = '<span>' + tab.name + '</span><span class="tab-close" data-tab="' + tab.index + '">×</span>';
        container.appendChild(tabEl);
      });
      
      const addBtn = document.createElement('div');
      addBtn.className = 'tab-add';
      addBtn.id = 'tab-add';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', () => {
        ipcRenderer.send('new-tab');
      });
      container.appendChild(addBtn);
    });
    
    ipcRenderer.on('theme-update', (event, theme) => {
      ipcRenderer.send('reload-with-theme', theme);
    });
    
    ipcRenderer.on('mute-update', (event, muted) => {
      isMuted = muted;
      const btn = document.getElementById('btn-mute');
      btn.textContent = isMuted ? '🔇' : '🔊';
    });
    
    let accounts = [];
    
    function renderAccountSidebar() {
      const list = document.getElementById('account-sidebar-list');
      const items = accounts.filter(a => a.qq);
      
      if (items.length === 0) {
        list.innerHTML = '<div class="account-sidebar-hint">暂无账号<br>点击 + 添加</div>';
        return;
      }
      
      let html = '';
      items.forEach(function(a) {
        const winName = a.windowName || a.qq;
        html += '<div class="account-sidebar-item" data-account-id="' + a.id + '">' +
          '<div class="account-sidebar-info">' +
            '<div class="account-sidebar-win-name">' + escapeHtml(winName) + '</div>' +
            '<span class="account-sidebar-qq">' + escapeHtml(a.qq) + '</span>' +
          '</div>' +
          '<div class="account-sidebar-actions">' +
            '<button class="account-sidebar-action-btn open" data-open-id="' + a.id + '" title="开窗并登录">⊞</button>' +
            '<button class="account-sidebar-action-btn edit" data-edit-id="' + a.id + '" title="编辑">✏</button>' +
            '<button class="account-sidebar-action-btn delete" data-delete-id="' + a.id + '" title="删除">✕</button>' +
          '</div>' +
        '</div>';
      });
      list.innerHTML = html;
    }
    
    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    
    function showAccountModal(options) {
      const { title, qq, password, windowName, onConfirm } = options;
      const modal = document.createElement('div');
      modal.className = 'add-account-modal';
      modal.innerHTML =
        '<div class="add-account-box">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<input class="modal-qq-input" placeholder="QQ号/邮箱" />' +
          '<input class="modal-pwd-input" type="password" placeholder="密码（可选）" />' +
          '<input class="modal-winname-input" placeholder="窗口名（可选）" />' +
          '<div class="add-account-actions">' +
            '<button class="btn-cancel" id="modalCancel">取消</button>' +
            '<button class="btn-confirm" id="modalSave">保存</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      
      const qqInput = modal.querySelector('.modal-qq-input');
      const pwdInput = modal.querySelector('.modal-pwd-input');
      const winNameInput = modal.querySelector('.modal-winname-input');
      
      if (qq) qqInput.value = qq;
      if (windowName) winNameInput.value = windowName;
      
      const close = () => modal.remove();
      
      modal.querySelector('#modalCancel').addEventListener('click', close);
      modal.querySelector('#modalSave').addEventListener('click', () => {
        onConfirm(qqInput, pwdInput, winNameInput, close);
      });
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
      });
    }
    
    function showNewAccountModal() {
      showAccountModal({
        title: '添加账号',
        onConfirm: (qqInput, pwdInput, winNameInput, close) => {
          const newQq = qqInput.value.trim();
          const newPwd = pwdInput.value;
          const newWinName = winNameInput.value.trim();
          
          if (!newQq || !/^(\d{5,12}|[^@\s]+@[^@\s]+\.[^@\s]+)$/.test(newQq)) {
            qqInput.style.borderColor = '#ff4444';
            return;
          }
          
          ipcRenderer.send('add-account', { qq: newQq, password: newPwd, windowName: newWinName });
          close();
        }
      });
    }
    
    function showEditAccountModal(accountId) {
      const account = accounts.find(a => a.id === accountId);
      if (!account) return;
      
      showAccountModal({
        title: '编辑账号',
        qq: account.qq,
        windowName: account.windowName,
        onConfirm: (qqInput, pwdInput, winNameInput, close) => {
          const newQq = qqInput.value.trim();
          const newPwd = pwdInput.value;
          const newWinName = winNameInput.value.trim();
          
          if (newQq && /^(\d{5,12}|[^@\s]+@[^@\s]+\.[^@\s]+)$/.test(newQq)) {
            ipcRenderer.send('update-account', { id: accountId, qq: newQq, password: newPwd, windowName: newWinName });
          } else if (newPwd || newWinName) {
            ipcRenderer.send('update-account', { id: accountId, password: newPwd, windowName: newWinName });
          }
          close();
        }
      });
    }
    
    document.getElementById('btn-accounts').addEventListener('click', () => {
      console.log('[TOOLBAR] 点击账号按钮');
      
      const sidebar = document.getElementById('account-sidebar');
      if (sidebar) {
        const isVisible = sidebar.classList.contains('visible');
        
        if (isVisible) {
          sidebar.classList.remove('visible');
          ipcRenderer.send('toggle-sidebar', false);
        } else {
          sidebar.classList.add('visible');
          ipcRenderer.send('toggle-sidebar', true);
          ipcRenderer.send('get-accounts');
        }
      }
    });
    
    document.getElementById('accountSidebarClose').addEventListener('click', () => {
      document.getElementById('account-sidebar').classList.remove('visible');
      ipcRenderer.send('toggle-sidebar', false);
    });
    
    document.getElementById('accountSidebarAdd').addEventListener('click', showNewAccountModal);
    
    document.getElementById('accountLaunchAll').addEventListener('click', () => {
      ipcRenderer.send('launch-all-accounts');
    });
    
    document.getElementById('account-sidebar-list').addEventListener('click', (e) => {
      const target = e.target;
      
      if (target.classList.contains('open')) {
        const accountId = target.dataset.openId;
        ipcRenderer.send('launch-account', accountId);
        return;
      }
      
      if (target.classList.contains('edit')) {
        showEditAccountModal(target.dataset.editId);
        return;
      }
      
      if (target.classList.contains('delete')) {
        ipcRenderer.send('remove-account', target.dataset.deleteId);
        return;
      }
      
      const item = target.closest('.account-sidebar-item');
      if (item) {
        const accountId = item.dataset.accountId;
        ipcRenderer.send('fill-account', accountId);
      }
    });
    
    ipcRenderer.on('accounts-update', (event, accountList) => {
      console.log('[TOOLBAR] 收到 accounts-update，账号数量: ' + (accountList ? accountList.length : 0));
      ipcRenderer.send('debug-log', '[TOOLBAR] 收到 accounts-update，账号数量: ' + (accountList ? accountList.length : 0));
      accounts = accountList || [];
      const sidebar = document.getElementById('account-sidebar');
      if (sidebar) {
        sidebar.classList.add('visible');
        console.log('[TOOLBAR] 侧边栏已显示');
        ipcRenderer.send('debug-log', '[TOOLBAR] 侧边栏已显示');
      } else {
        console.log('[TOOLBAR] 错误：找不到 account-sidebar 元素');
        ipcRenderer.send('debug-log', '[TOOLBAR] 错误：找不到 account-sidebar 元素');
      }
      renderAccountSidebar();
    });
    
    ipcRenderer.on('account-updated', () => {
      ipcRenderer.send('get-accounts');
    });
  </script>
</body>
</html>`;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toolbarHtml));

  addTab(url, '窗口1', account);

  const ipcListeners = [];

  const addListener = (channel, handler) => {
    ipcMain.on(channel, handler);
    ipcListeners.push({ channel, handler });
  };

  addListener('new-tab', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      addTab(DEFAULT_URL, '窗口' + (localTabs.length + 1));
    }
  });

  addListener('switch-tab', (event, index) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      switchTab(index);
    }
  });

  addListener('close-tab', (event, index) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      closeTab(index);
    }
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
      localTabs.forEach(({ webContents }) => {
        if (webContents && !webContents.isDestroyed()) {
          webContents.setAudioMuted(muted);
        }
      });
    }
  });

  let isSidebarVisible = false;

  addListener('toggle-sidebar', (event, visible) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === win) {
      isSidebarVisible = visible;
      const sidebarWidth = 280;
      const bounds = win.getBounds();
      const toolbarHeight = 36;
      
      localTabs.forEach(({ view }) => {
        if (view) {
          if (visible) {
            view.setBounds({ x: 0, y: toolbarHeight, width: bounds.width - sidebarWidth, height: bounds.height - toolbarHeight });
          } else {
            view.setBounds({ x: 0, y: toolbarHeight, width: bounds.width, height: bounds.height - toolbarHeight });
          }
        }
      });
    }
  });

  win.on('resize', () => {
    const bounds = win.getBounds();
    const sidebarWidth = isSidebarVisible ? 280 : 0;
    localTabs.forEach(({ view }) => {
      view.setBounds({ x: 0, y: toolbarHeight, width: bounds.width - sidebarWidth, height: bounds.height - toolbarHeight });
    });
  });

  win.on('blur', () => {
    log('游戏窗口 失去焦点');
    localTabs.forEach(({ webContents }) => {
      if (webContents && !webContents.isDestroyed()) {
        webContents.setBackgroundThrottling(false);
      }
    });
  });

  win.on('focus', () => {
    log('游戏窗口 获取焦点');
    localTabs.forEach(({ webContents }) => {
      if (webContents && !webContents.isDestroyed()) {
        webContents.setBackgroundThrottling(false);
      }
    });
  });

  win.on('show', () => {
    log('游戏窗口 显示');
    localTabs.forEach(({ webContents }) => {
      if (webContents && !webContents.isDestroyed()) {
        webContents.setBackgroundThrottling(false);
        webContents.setAudioMuted(isAudioMuted);
      }
    });
  });

  win.on('restore', () => {
    log('游戏窗口 从最小化恢复');
    localTabs.forEach(({ webContents }) => {
      if (webContents && !webContents.isDestroyed()) {
        webContents.setBackgroundThrottling(false);
        webContents.setAudioMuted(isAudioMuted);
      }
    });
    win.setSize(win.getSize()[0], win.getSize()[1] + 1);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setSize(win.getSize()[0], win.getSize()[1] - 1);
      }
    }, 50);
  });

  win.on('closed', () => {
    ipcListeners.forEach(({ channel, handler }) => {
      ipcMain.removeListener(channel, handler);
    });
    
    log('游戏窗口 已关闭');
    
    const index = gameWindows.findIndex(w => w.win === win);
    if (index !== -1) {
      gameWindows.splice(index, 1);
    }
    
    if (gameWindows.length === 0) {
      currentSpeedRate = 1;
      config.lastSpeed = 1;
      saveConfig();
      
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
          }
        }, 100);
      }
    }
  });

  gameWindows.push({ win, localTabs, localCurrentTabIndex, updateToolbarTabList });
  
  log('游戏窗口创建成功');
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
        try {
          for (let i = 0; i < gameWindows.length; i++) {
            const gameWin = gameWindows[i].win;
            if (gameWin && !gameWin.isDestroyed()) {
              gameWin.destroy();
            }
          }
          gameWindows = [];
        } catch (e) {
          log('关闭游戏窗口失败: ' + e.message, 'ERROR');
        }
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
    
    isShowingUpdateDialog = true;
    dialog.showMessageBox({
      type: 'info',
      title: '发现更新',
      message: `发现新版本 ${info.version}\n\n当前版本: ${CURRENT_VERSION}\n\n更新说明: ${info.releaseNotes || '无'}`,
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
      width: 360,
      height: 120,
      title: '下载更新',
      resizable: false,
      maximizable: false,
      minimizable: false,
      backgroundColor: '#1a1a2e',
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
    body {
      background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
      padding: 20px;
      font-family: 'Microsoft YaHei', sans-serif;
      color: #fff;
    }
    .progress-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .title {
      font-size: 14px;
      text-align: center;
    }
    .progress-bar {
      height: 8px;
      background: #2d2d44;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00d4ff, #0099cc);
      border-radius: 4px;
      transition: width 0.3s ease;
      min-width: 0%;
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #aaa;
    }
  </style>
</head>
<body>
  <div class="progress-container">
    <div class="title">📦 正在下载更新...</div>
    <div class="progress-bar">
      <div class="progress-fill" id="progressFill"></div>
    </div>
    <div class="progress-info">
      <span id="progressText">0%</span>
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
      sandbox: false
    }
  });

  win.addBrowserView(view);
  view.setBounds({ x: 0, y: toolbarHeight, width: win.getBounds().width, height: win.getBounds().height - toolbarHeight });
  view.setAutoResize({ width: true, height: true });

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
  
  // 显示新标签，隐藏其他标签
  const bounds = win.getBounds();
  localTabs.forEach((tab, idx) => {
    if (idx === localTabs.length - 1) {
      tab.view.setBounds({ x: 0, y: toolbarHeight, width: bounds.width, height: bounds.height - toolbarHeight });
      win.addBrowserView(tab.view);
    } else {
      tab.view.setBounds({ x: 0, y: bounds.height, width: bounds.width, height: 0 });
    }
  });
  
  gameWindow.localCurrentTabIndex = localTabs.length - 1;
  
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
  
  ipcMain.on('set-theme', (event, theme) => {
    currentTheme = theme;
    saveConfig();
    log('主题已切换为: ' + theme);
    
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.webContents.send('theme-changed', theme);
    }
    
    gameWindows.forEach(({ win }) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('theme-changed', theme);
      }
    });
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
});
