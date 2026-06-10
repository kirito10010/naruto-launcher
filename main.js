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
let sharedSession = null;
let tray = null;

let speedctlPath = '';
let speedhookPath = '';
let currentSpeedRate = 1;
let injectedPids = new Set();
let useNativeInjectionSuccess = false;
let isWindows11 = false;
let hvciStatus = 'unknown';

let currentTheme = 'light';

let config = {
  theme: 'light',
  lastSpeed: 1
};

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
  if (currentTheme === 'dark') {
    return 'background:linear-gradient(180deg,#1a1a1a 0%,#2d2d2d 100%);border-bottom:1px solid #444}.toolbar-left .title,.toolbar-right .btn,.toolbar-right .select-container select,.toolbar-right .control-btn{color:#fff !important;border-color:#555 !important;background:linear-gradient(#333,#444) !important}.separator{background:#555 !important}';
  }
  return 'background:linear-gradient(180deg,#fff 0%,#f5f5f5 100%);border-bottom:1px solid #e0e0e0}.toolbar-left .title,.toolbar-right .btn,.toolbar-right .select-container select,.toolbar-right .control-btn{color:#333 !important;border-color:#ddd !important;background:linear-gradient(#fff,#f8f8f8) !important}.separator{background:#ddd !important}';
}

function getThemeColors() {
  if (currentTheme === 'dark') {
    return {
      bg1: '#1a1a1a',
      bg2: '#2d2d2d',
      border: '#444',
      text: '#fff',
      btnBg: '#333',
      btnHover: '#444',
      btnBorder: '#555',
      separator: '#555'
    };
  }
  return {
    bg1: '#fff',
    bg2: '#f5f5f5',
    border: '#e0e0e0',
    text: '#333',
    btnBg: '#fff',
    btnHover: '#f8f8f8',
    btnBorder: '#ddd',
    separator: '#ddd'
  };
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
    dialog.showMessageBox({
      type: 'error',
      title: '组件缺失',
      message: '未找到加速组件(speedctl.exe/speedhook.dll)\n\n请确保这些文件存在于 resources/native/ 目录中',
      buttons: ['确定']
    });
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
  
  gameWindows.forEach(({ webContentsId }) => {
    if (webContentsId) {
      try {
        const webContents = require('electron').webContents.fromId(webContentsId);
        if (webContents) {
          webContents.send('set-speed', rate);
        }
      } catch (e) {
        log(`发送JS加速指令失败: ${e.message}`, 'WARN');
      }
    }
  });
  
  gameWindows.forEach(({ toolbar }) => {
    if (toolbar && toolbar.webContents) {
      toolbar.webContents.send('speed-update', rate);
    }
  });
  
  log(`变速率已设置为: ${rate}x`);
}

function getAllChildProcessesRecursive(parentPid) {
  return new Promise((resolve, reject) => {
    const psCommand = 'Get-WmiObject -Class Win32_Process -Filter "ParentProcessId=' + parentPid + '" | Select-Object ProcessId,CommandLine | ForEach-Object { Write-Output "ProcessId=$($_.ProcessId)`nCommandLine=$($_.CommandLine)" }';
    
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
    body {
      background: linear-gradient(180deg, #ffffff 0%, #f5f5f5 100%);
      padding: 20px;
      font-family: 'Microsoft YaHei', sans-serif;
      color: #333;
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
      color: #333;
      font-size: 18px;
      margin-bottom: 10px;
    }
    .add-btn {
      width: 28px;
      height: 28px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: linear-gradient(#fff, #f8f8f8);
      color: #333;
      font-size: 16px;
      cursor: pointer;
      outline: none;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      -webkit-app-region: no-drag;
    }
    .add-btn:hover {
      border-color: #e74c3c;
      color: #e74c3c;
      background: #fff;
    }
    .game-list {
      flex: 1;
      overflow-y: auto;
    }
    .game-item {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .game-item:hover {
      border-color: #e74c3c;
      box-shadow: 0 2px 8px rgba(231, 76, 60, 0.15);
      background: #fff;
    }
    .game-title {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 5px;
      color: #333;
    }
    .game-url {
      font-size: 11px;
      color: #888;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>🎮 火影忍者Online启动器</h2>
  </div>
  
  <div class="game-list">
    <div class="game-item" onclick="launchGame('https://huoying.qq.com/', '火影忍者Online')">
      <div class="game-title">🔥 火影忍者Online</div>
      <div class="game-url">https://huoying.qq.com/</div>
    </div>
  </div>
  
  <script>
    const { ipcRenderer } = require('electron');
    
    function launchGame(url, name) {
      ipcRenderer.send('launch-game', { url, name });
    }
  </script>
</body>
</html>`;
  
  launcherWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(launcherHtml));

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

function createGameWindow(url, gameName) {
  if (!url) url = DEFAULT_URL;
  if (!gameName) gameName = '游戏';
  
  gameWindowCount++;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const toolbarHeight = 36;
  const gameWidth = Math.floor(width * 0.9);
  const gameHeight = Math.floor(height * 0.9);

  if (!sharedSession) {
    sharedSession = require('electron').session.fromPartition('persist:game-session', {
      cache: true,
      storage: 'persist:game-session'
    });
    
    sharedSession.cookies.on('changed', (event, cookie, cause, removed) => {
      log('Cookie变化: ' + cookie.name + '=' + cookie.value.substring(0, 20) + '... ' + (removed ? '删除' : cause));
    });
  }

  const colors = getThemeColors();
  
  const win = new BrowserWindow({
    width: gameWidth,
    height: gameHeight + toolbarHeight,
    title: gameName + ' - 窗口' + gameWindowCount,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableRemoteModule: true
    },
    show: true
  });

  win.setMenu(null);

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
      padding: 0 16px;
      -webkit-app-region: drag;
      overflow: hidden;
      border-bottom: 1px solid ${colors.border};
    }
    .toolbar-left { display: flex; align-items: center; gap: 8px; }
    .toolbar-right { display: flex; align-items: center; gap: 8px; -webkit-app-region: no-drag; }
    .title {
      color: ${colors.text};
      font-size: 13px;
      font-weight: 500;
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
      -webkit-app-region: no-drag;
    }
    .control-btn:hover {
      background: rgba(0,0,0,.05);
    }
    .control-btn.close:hover {
      background: #e74c3c;
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="toolbar-left">
    <span class="title">${gameName}</span>
  </div>
  <div class="toolbar-right">
        <button class="btn" id="btn-new-window">多开</button>
        <button class="btn" id="btn-clear-cache" title="清空缓存并重新加载">清空缓存</button>
        <div class="separator"></div>
        <div class="select-container">
          <select id="speed-select">
            <option value="1" ${currentSpeedRate === 1 ? 'selected' : ''}>1x (还原)</option>
            <option value="2" ${currentSpeedRate === 2 ? 'selected' : ''}>2x</option>
            <option value="4" ${currentSpeedRate === 4 ? 'selected' : ''}>4x</option>
            <option value="6" ${currentSpeedRate === 6 ? 'selected' : ''}>6x</option>
            <option value="10" ${currentSpeedRate === 10 ? 'selected' : ''}>10x</option>
            <option value="20" ${currentSpeedRate === 20 ? 'selected' : ''}>20x</option>
          </select>
        </div>
        <div class="separator"></div>
        <button class="btn" id="btn-mute" title="切换静音">🔊</button>
        <div class="separator"></div>
        <div class="window-controls">
          <button class="control-btn" id="btn-min">-</button>
          <button class="control-btn" id="btn-max">□</button>
          <button class="control-btn close" id="btn-close">×</button>
        </div>
      </div>
  <script>
    const { ipcRenderer } = require('electron');
    let isMuted = false;
    
    document.getElementById('btn-new-window').addEventListener('click', () => {
      ipcRenderer.send('new-game-window');
    });
    
    document.getElementById('btn-clear-cache').addEventListener('click', () => {
      if (confirm('确定要清空缓存并重新加载吗？这将清除登录状态。')) {
        ipcRenderer.send('clear-cache');
      }
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
    
    ipcRenderer.on('theme-update', (event, theme) => {
      ipcRenderer.send('reload-with-theme', theme);
    });
    
    ipcRenderer.on('mute-update', (event, muted) => {
      isMuted = muted;
      const btn = document.getElementById('btn-mute');
      btn.textContent = isMuted ? '🔇' : '🔊';
    });
  </script>
</body>
</html>`;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toolbarHtml));

  const gameView = new BrowserView({
    webPreferences: {
      plugins: true,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
      allowRunningInsecureContent: true,
      session: sharedSession,
      enableRemoteModule: false,
      sandbox: false
    }
  });

  win.setBrowserView(gameView);
  gameView.setBounds({ x: 0, y: toolbarHeight, width: gameWidth, height: gameHeight });

  const gameContents = gameView.webContents;

  gameContents.on('did-start-loading', () => {
    log('游戏窗口' + gameWindowCount + ' 开始加载: ' + url);
  });

  gameContents.on('did-finish-load', () => {
    log('游戏窗口' + gameWindowCount + ' 加载完成');
    
    setTimeout(() => {
      injectAllChildProcesses();
    }, 1500);
  });

  gameContents.on('plugin-crashed', () => {
    log('游戏窗口' + gameWindowCount + ' Flash插件崩溃', 'ERROR');
  });

  gameContents.on('render-process-gone', (event, details) => {
    log('游戏窗口' + gameWindowCount + ' 渲染进程异常退出: ' + details.reason, 'ERROR');
  });

  gameContents.on('new-window', (event, newUrl, frameName, disposition) => {
    event.preventDefault();
    gameContents.loadURL(newUrl);
    log('拦截弹窗(' + frameName + '), 在当前窗口打开: ' + newUrl);
  });

  ipcMain.on('min-window', () => {
    win.minimize();
  });

  ipcMain.on('max-window', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('close-window', () => {
    gameContents.destroy();
    win.close();
  });

  ipcMain.on('set-game-speed', (event, speed) => {
    setSpeedRate(speed);
  });

  ipcMain.on('toggle-mute', (event, muted) => {
    gameWindows.forEach(({ webContentsId }) => {
      if (webContentsId) {
        try {
          const wc = require('electron').webContents.fromId(webContentsId);
          if (wc && !wc.isDestroyed()) {
            wc.setAudioMuted(muted);
          }
        } catch (e) {
          log('设置静音失败: ' + e.message, 'WARN');
        }
      }
    });
  });

  ipcMain.on('new-game-window', () => {
    createGameWindow(DEFAULT_URL, '火影忍者Online');
  });

  gameContents.on('did-finish-load', () => {
    log('游戏窗口' + gameWindowCount + ' 加载完成');
    
    setTimeout(() => {
      injectAllChildProcesses();
    }, 1500);
  });

  win.on('resize', () => {
    const bounds = win.getBounds();
    gameView.setBounds({ x: 0, y: toolbarHeight, width: bounds.width, height: bounds.height - toolbarHeight });
  });

  win.on('blur', () => {
    log('游戏窗口' + gameWindowCount + ' 失去焦点');
    if (gameContents && !gameContents.isDestroyed()) {
      gameContents.setBackgroundThrottling(false);
      gameContents.setAudioMuted(false);
    }
  });

  win.on('focus', () => {
    log('游戏窗口' + gameWindowCount + ' 获取焦点');
    if (gameContents && !gameContents.isDestroyed()) {
      gameContents.setBackgroundThrottling(false);
    }
  });

  win.on('show', () => {
    log('游戏窗口' + gameWindowCount + ' 显示');
    if (gameContents && !gameContents.isDestroyed()) {
      gameContents.setBackgroundThrottling(false);
      gameContents.setAudioMuted(false);
    }
  });

  win.on('restore', () => {
    log('游戏窗口' + gameWindowCount + ' 从最小化恢复');
    if (gameContents && !gameContents.isDestroyed()) {
      gameContents.setBackgroundThrottling(false);
      gameContents.setAudioMuted(false);
      win.setSize(win.getSize()[0], win.getSize()[1] + 1);
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.setSize(win.getSize()[0], win.getSize()[1] - 1);
        }
      }, 50);
    }
  });

  win.on('closed', () => {
    const index = gameWindows.findIndex(item => item.win === win);
    if (index > -1) {
      gameWindows.splice(index, 1);
    }
    log('游戏窗口' + gameWindowCount + ' 已关闭');
    
    if (gameWindows.length === 0 && launcherWindow) {
      launcherWindow.show();
    }
  });

  gameContents.loadURL(url);
  gameWindows.push({ 
    win: win, 
    toolbar: win, 
    webContentsId: gameContents.id 
  });

  log('游戏窗口' + gameWindowCount + ' 创建成功, webContentsId=' + gameContents.id);
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
  
  const promises = [];
  
  if (sharedSession) {
    promises.push(sharedSession.clearStorageData({
      storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cacheStorage']
    }));
    
    promises.push(sharedSession.clearCache());
  }
  
  gameWindows.forEach(({ webContentsId }) => {
    if (webContentsId) {
      try {
        const wc = require('electron').webContents.fromId(webContentsId);
        if (wc && !wc.isDestroyed()) {
          promises.push(new Promise((resolve) => {
            wc.session.clearStorageData({
              storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cacheStorage']
            }).then(resolve).catch(resolve);
          }));
          promises.push(new Promise((resolve) => {
            wc.session.clearCache().then(resolve).catch(resolve);
          }));
        }
      } catch (e) {
        log('清除单个窗口缓存失败: ' + e.message, 'WARN');
      }
    }
  });
  
  Promise.all(promises).then(() => {
    log('所有缓存清除完成');
    
    gameWindows.forEach(({ webContentsId }) => {
      if (webContentsId) {
        try {
          const wc = require('electron').webContents.fromId(webContentsId);
          if (wc && !wc.isDestroyed()) {
            wc.loadURL(DEFAULT_URL);
          }
        } catch (e) {
          log('重新加载失败: ' + e.message, 'WARN');
        }
      }
    });
  }).catch((err) => {
    log('缓存清除过程中发生错误: ' + err.message, 'ERROR');
  });
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
    
    dialog.showMessageBox({
      type: 'info',
      title: '发现更新',
      message: `发现新版本 ${info.version}\n\n当前版本: ${CURRENT_VERSION}\n\n更新说明: ${info.releaseNotes || '无'}`,
      buttons: ['立即更新', '稍后提醒']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });
  
  autoUpdater.on('update-not-available', () => {
    log('当前已是最新版本: ' + CURRENT_VERSION);
  });
  
  autoUpdater.on('download-progress', (progress) => {
    log(`下载进度: ${Math.round(progress.percent)}%`);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log('更新包下载完成');
    
    dialog.showMessageBox({
      type: 'info',
      title: '更新完成',
      message: `更新包已下载完成，版本: ${info.version}\n\n请重启应用以应用更新。`,
      buttons: ['立即重启', '稍后重启']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });
  
  autoUpdater.on('error', (err) => {
    log('自动更新错误: ' + err.message, 'ERROR');
  });
  
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 5000);
}

app.whenReady().then(() => {
  log('应用启动');
  loadConfig();
  detectWindowsVersion();
  initSpeedControl();
  initAutoUpdater();
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
