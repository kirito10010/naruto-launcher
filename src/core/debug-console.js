// 调试控制台：打开开始记录，实时显示，关闭后日志留在桌面
const { BrowserWindow, ipcMain, app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_VIEW_LINES = 2000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FLUSH_MS = 200;
const FLUSH_LINES = 30;

let win = null;
let recording = false;
let paused = false;
let logPath = '';
let baseName = '';
let fileSeq = 1;
let fileBytes = 0;
let lines = [];
let pending = [];
let flushTimer = null;
let lastError = '';

function pad2(n) { return String(n).padStart(2, '0'); }

function stamp() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function nowIso() { return new Date().toISOString(); }

function sendState() {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('debug-state', {
      recording: recording,
      paused: paused,
      path: logPath,
      error: lastError
    });
  } catch (e) { /* ignore */ }
}

function sendLine(line) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('debug-line', line); } catch (e) { /* ignore */ }
}

function openFile() {
  if (!logPath) return;
  try {
    fs.writeFileSync(logPath,
      '# 火影OL 调试日志\n# 开始时间: ' + nowIso() + '\n# 关闭调试控制台后停止记录\n\n',
      'utf8');
    fileBytes = fs.statSync(logPath).size;
  } catch (e) {
    lastError = '无法写入桌面日志: ' + e.message;
    logPath = '';
    fileBytes = 0;
  }
}

function rotateIfNeeded() {
  if (!logPath || fileBytes <= MAX_FILE_BYTES) return;
  fileSeq++;
  const desktop = app.getPath('desktop');
  logPath = path.join(desktop, baseName + '-' + fileSeq + '.log');
  try {
    fs.writeFileSync(logPath, '# 调试日志（续 ' + fileSeq + '） ' + nowIso() + '\n\n', 'utf8');
    fileBytes = fs.statSync(logPath).size;
  } catch (e) {
    lastError = '日志滚动失败: ' + e.message;
  }
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pending.length) return;
  if (!recording || paused || !logPath) {
    pending = [];
    return;
  }
  const text = pending.join('');
  pending = [];
  try {
    rotateIfNeeded();
    fs.appendFileSync(logPath, text, 'utf8');
    fileBytes += Buffer.byteLength(text);
  } catch (e) {
    lastError = '写日志失败: ' + e.message;
    sendState();
  }
}

function scheduleFlush() {
  if (pending.length >= FLUSH_LINES) {
    flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function write(source, level, message) {
  if (!recording || paused) return;
  const lv = String(level || 'INFO').toUpperCase();
  const src = String(source || 'app');
  let msg = String(message == null ? '' : message);
  if (msg.length > 4000) msg = msg.slice(0, 4000) + ' …';
  const line = {
    ts: nowIso(),
    level: lv,
    source: src,
    message: msg
  };
  lines.push(line);
  if (lines.length > MAX_VIEW_LINES) lines = lines.slice(-MAX_VIEW_LINES);
  sendLine(line);

  const text = '[' + line.ts + '] [' + lv + '] [' + src + '] ' + msg + '\n';
  pending.push(text);
  scheduleFlush();
}

function start() {
  if (recording && !paused) return logPath;
  paused = false;
  if (recording && logPath) {
    sendState();
    return logPath;
  }
  const desktop = app.getPath('desktop');
  baseName = 'naruto-debug-' + stamp();
  logPath = path.join(desktop, baseName + '.log');
  fileSeq = 1;
  fileBytes = 0;
  lastError = '';
  lines = [];
  pending = [];
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('debug-cleared'); } catch (e) { /* ignore */ }
  }
  openFile();
  recording = true;
  sendState();
  return logPath;
}

function pause() {
  flush();
  paused = true;
  sendState();
}

function resume() {
  paused = false;
  sendState();
}

function stop() {
  flush();
  recording = false;
  paused = false;
  sendState();
}

function clearView() {
  lines = [];
  pending = [];
  if (win && !win.isDestroyed()) {
    try { win.webContents.send('debug-cleared'); } catch (e) { /* ignore */ }
  }
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 640,
    minHeight: 360,
    title: '调试控制台',
    backgroundColor: '#0b1220',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  win.setMenu(null);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(renderHtml()));
  win.webContents.on('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('debug-lines', lines); } catch (e) { /* ignore */ }
    sendState();
  });
  win.on('closed', () => {
    win = null;
    stop();
  });
  return win;
}

function open() {
  ensureWindow();
  if (!recording) start();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendState();
}

function isOpen() { return !!(win && !win.isDestroyed()); }
function isRecording() { return recording && !paused; }
function getPath() { return logPath; }

function renderHtml() {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{height:100%;background:#0b1220;color:#d7e3ee;font-family:Consolas,"Microsoft YaHei",monospace}' +
    'body{display:flex;flex-direction:column;font-size:12px}' +
    '.bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #1c2b42;flex-wrap:wrap;background:#0e1a2b}' +
    '.dot{width:8px;height:8px;border-radius:50%;background:#64748b;flex:0 0 8px}' +
    '.dot.on{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.15)}' +
    '.dot.pause{background:#eab308}' +
    '.dot.err{background:#ef4444}' +
    '#state{font-size:12px;color:#93a4b8;white-space:nowrap}' +
    '#file{flex:1;min-width:120px;font-size:11px;color:#7f93a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}' +
    '#file:hover{color:#93c5fd}' +
    'button{height:26px;padding:0 10px;border:1px solid #24354f;border-radius:7px;background:#152238;color:#d7e3ee;font-size:11px;cursor:pointer;font-family:inherit}' +
    'button:hover{background:#1b2d49;border-color:#33507a}' +
    '#filter{height:26px;width:180px;padding:0 8px;border:1px solid #24354f;border-radius:7px;background:#0b1526;color:#d7e3ee;font-size:11px;outline:none;font-family:inherit}' +
    '#filter:focus{border-color:#38bdf8}' +
    '#log{flex:1;overflow:auto;padding:8px 10px;line-height:1.55}' +
    '.ln{white-space:pre-wrap;word-break:break-word;padding:1px 0}' +
    '.ln .t{color:#5f7388}' +
    '.ln.INFO .lv{color:#38bdf8}' +
    '.ln.WARN .lv{color:#eab308}' +
    '.ln.ERROR .lv{color:#ef4444}' +
    '.ln .src{color:#a78bfa}' +
    '.ln .msg{color:#d7e3ee}' +
    '#log::-webkit-scrollbar{width:9px}' +
    '#log::-webkit-scrollbar-thumb{background:#24354f;border-radius:9px}' +
    '</style></head><body>' +
    '<div class="bar">' +
      '<i class="dot" id="dot"></i><span id="state">准备中…</span>' +
      '<span id="file" title="点击复制路径"></span>' +
      '<input id="filter" placeholder="过滤日志…" />' +
      '<button id="btnToggle">暂停</button>' +
      '<button id="btnClear">清空视图</button>' +
      '<button id="btnFolder">打开文件夹</button>' +
    '</div>' +
    '<div id="log"></div>' +
    '<script>' +
    'const { ipcRenderer, clipboard } = require("electron");' +
    'var logEl = document.getElementById("log");' +
    'var autoScroll = true;' +
    'var filterText = "";' +
    'function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}' +
    'function pad(n){return n<10?"0"+n:""+n;}' +
    'function shortTs(iso){var d=new Date(iso);if(isNaN(d.getTime()))return iso;return pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds());}' +
    'function match(l){return !filterText || (l.message+" "+l.source).toLowerCase().indexOf(filterText)>=0;}' +
    'function addLine(l,prepend){' +
      'if(!match(l))return;' +
      'var d=document.createElement("div");' +
      'd.className="ln "+l.level;' +
      'd.innerHTML=\'<span class="t">\'+esc(shortTs(l.ts))+\'</span> <span class="lv">[\'+esc(l.level)+\']</span> <span class="src">[\'+esc(l.source)+\']</span> <span class="msg">\'+esc(l.message)+\'</span>\';' +
      'if(prepend)logEl.insertBefore(d,logEl.firstChild);else logEl.appendChild(d);' +
      'while(logEl.childNodes.length>2500)logEl.removeChild(logEl.firstChild);' +
      'if(autoScroll&&!prepend)logEl.scrollTop=logEl.scrollHeight;' +
    '}' +
    'function rerender(list){logEl.innerHTML="";list.forEach(function(l){addLine(l,false);});}' +
    'logEl.addEventListener("scroll",function(){autoScroll=(logEl.scrollHeight-logEl.scrollTop-logEl.clientHeight)<24;});' +
    'document.getElementById("filter").addEventListener("input",function(e){' +
      'filterText=String(e.target.value||"").trim().toLowerCase();' +
      'ipcRenderer.send("debug-console-refilter");' +
    '});' +
    'document.getElementById("btnToggle").addEventListener("click",function(){ipcRenderer.send("debug-console-toggle");});' +
    'document.getElementById("btnClear").addEventListener("click",function(){ipcRenderer.send("debug-console-clear");});' +
    'document.getElementById("btnFolder").addEventListener("click",function(){ipcRenderer.send("debug-console-folder");});' +
    'document.getElementById("file").addEventListener("click",function(){if(window.__debugPath){clipboard.writeText(window.__debugPath);this.title="已复制";}});' +
    'ipcRenderer.on("debug-state",function(e,s){' +
      'var dot=document.getElementById("dot");' +
      'dot.className="dot"+(s.recording?(s.paused?" pause":" on"):" err");' +
      'var txt=s.recording?(s.paused?"已暂停":"记录中"):"已停止";' +
      'if(s.error)txt+=" · "+s.error;' +
      'document.getElementById("state").textContent=txt;' +
      'document.getElementById("file").textContent=s.path||"（未写入文件）";' +
      'document.getElementById("file").title=s.path||"";' +
      'window.__debugPath=s.path||"";' +
      'document.getElementById("btnToggle").textContent=s.recording&&!s.paused?"暂停":"继续";' +
    '});' +
    'ipcRenderer.on("debug-lines",function(e,list){rerender(list||[]);});' +
    'ipcRenderer.on("debug-line",function(e,l){addLine(l,false);});' +
    'ipcRenderer.on("debug-cleared",function(){logEl.innerHTML="";});' +
    'ipcRenderer.send("debug-console-ready");' +
    '</scr' + 'ipt></body></html>';
}

ipcMain.on('debug-console-ready', (event) => {
  if (!win || event.sender !== win.webContents) return;
  try { event.sender.send('debug-lines', lines); } catch (e) { /* ignore */ }
  sendState();
});

ipcMain.on('debug-console-toggle', (event) => {
  if (!win || event.sender !== win.webContents) return;
  if (!recording) start();
  else if (paused) resume();
  else pause();
});

ipcMain.on('debug-console-clear', (event) => {
  if (!win || event.sender !== win.webContents) return;
  clearView();
});

ipcMain.on('debug-console-folder', (event) => {
  if (!win || event.sender !== win.webContents) return;
  try {
    if (logPath && fs.existsSync(logPath)) shell.showItemInFolder(logPath);
    else shell.openPath(app.getPath('desktop'));
  } catch (e) { /* ignore */ }
});

ipcMain.on('debug-console-refilter', (event) => {
  if (!win || event.sender !== win.webContents) return;
  try { event.sender.send('debug-lines', lines); } catch (e) { /* ignore */ }
});

module.exports = {
  open,
  write,
  start,
  stop,
  isOpen,
  isRecording,
  getPath
};
