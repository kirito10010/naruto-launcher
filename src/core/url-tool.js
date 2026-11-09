// 网址调试：手动发 GET/POST，复用当前游戏会话（带登录态），直接看状态码/响应头/正文
const { BrowserWindow, ipcMain, app, net, session, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_BODY = 2 * 1024 * 1024;   // 2MB
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30000;
const MAX_SHOW_CHARS = 300000;

let win = null;
let callbacks = null;
let hookedSession = null;

function init(cb) {
  callbacks = cb || {};
}

// 被动监听当前游戏会话的 HTTP(S) 请求，列出来给用户挑（不改动任何流量）
function hookSession(ses) {
  if (!ses || ses === hookedSession) return;
  if (hookedSession) {
    try { hookedSession.webRequest.onCompleted(null); } catch (e) { /* ignore */ }
  }
  hookedSession = ses;
  try {
    ses.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
      if (!win || win.isDestroyed()) return;
      const type = details.resourceType;
      if (type === 'image' || type === 'stylesheet' || type === 'font' || type === 'media') return;
      try {
        win.webContents.send('url-tool:net', {
          method: details.method,
          url: details.url,
          status: details.statusCode,
          type: type,
          time: Date.now()
        });
      } catch (e) { /* ignore */ }
    });
  } catch (e) { hookedSession = null; }
}

function currentSession() {
  try { return (callbacks && callbacks.getSession) ? callbacks.getSession() : null; } catch (e) { return null; }
}

function enrichCtx(c, ses) {
  if (!ses || !c || c.qq) return Promise.resolve(c);
  // 从会话 Cookie 里补一个 QQ 号（p_uin），失败就算了
  return ses.cookies.get({ name: 'p_uin' }).then((list) => {
    const v = list && list[0] && list[0].value;
    if (!v) return c;
    const qq = String(v).replace(/^o0?/, '');
    const c2 = Object.assign({}, c, { qq: qq });
    if (win && !win.isDestroyed()) { try { win.webContents.send('url-tool:ctx', c2); } catch (e) {} }
    return c2;
  }).catch(() => c);
}

function getContext() {
  try {
    return (callbacks && callbacks.getContext) ? callbacks.getContext() : { qq: '', partition: '', currentUrl: '', hasTab: false };
  } catch (e) {
    return { qq: '', partition: '', currentUrl: '', hasTab: false };
  }
}

function logMsg(msg, level) {
  try { if (callbacks && callbacks.log) callbacks.log(msg, level || 'INFO'); } catch (e) {}
}

/* ---------------- 请求 ---------------- */
function doRequest(payload) {
  return new Promise((resolve) => {
    const started = Date.now();
    const method = (payload.method || 'GET').toUpperCase();
    const url = payload.url;
    let redirects = 0;
    let finalUrl = url;
    let settled = false;

    const done = (obj) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(obj);
    };

    const opts = { method: method, url: url, useSessionCookies: true, redirect: 'follow' };
    let ses = null;
    if (payload.partition) {
      try { ses = session.fromPartition(payload.partition); } catch (e) { /* 用当前会话 */ }
    }
    if (!ses) ses = currentSession();
    if (ses) opts.session = ses;

    let req;
    try {
      req = net.request(opts);
    } catch (e) {
      done({ ok: false, error: '无法创建请求: ' + e.message, ms: Date.now() - started });
      return;
    }

    const timer = setTimeout(() => {
      try { req.abort(); } catch (e) {}
      done({ ok: false, error: '请求超时（' + (TIMEOUT_MS / 1000) + 's）', ms: Date.now() - started });
    }, TIMEOUT_MS);

    req.on('redirect', (status, redirectMethod, redirectUrl) => {
      redirects++;
      finalUrl = redirectUrl;
      if (redirects > MAX_REDIRECTS) {
        try { req.abort(); } catch (e) {}
        done({ ok: false, error: '重定向超过 ' + MAX_REDIRECTS + ' 次', ms: Date.now() - started });
      }
    });

    req.on('response', (res) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
        else truncated = true;
      });
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const rawSize = buf.length;
        // CDN 上不少 .cfg/.xml 是「预压缩 zlib」但不带 Content-Encoding，需要手动解
        let decompressed = '';
        if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
          try { buf = zlib.gunzipSync(buf); decompressed = 'gzip'; } catch (e) { /* 保持原样 */ }
        } else if (buf.length > 2 && buf[0] === 0x78) {
          try {
            const out = zlib.inflateSync(buf);
            if (out.length > 0) { buf = out; decompressed = 'zlib'; }
          } catch (e) {
            try {
              const out = zlib.inflateRawSync(buf);
              if (out.length > 0) { buf = out; decompressed = 'deflate'; }
            } catch (e2) { /* 保持原样 */ }
          }
        }
        done({
          ok: true,
          status: res.statusCode,
          statusMessage: res.statusMessage || '',
          headers: res.headers || {},
          bodyBase64: buf.toString('base64'),
          size: size,
          rawSize: rawSize,
          decompressed: decompressed,
          truncated: truncated,
          finalUrl: finalUrl,
          ms: Date.now() - started
        });
      });
      res.on('error', (e) => done({ ok: false, error: '读取响应失败: ' + e.message, ms: Date.now() - started }));
    });

    req.on('error', (e) => done({ ok: false, error: e.message || String(e), ms: Date.now() - started }));

    try {
      req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36');
      req.setHeader('Accept', '*/*');
      req.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
    } catch (e) {}

    if (payload.body) {
      try { req.setHeader('Content-Type', payload.contentType || 'application/json'); } catch (e) {}
      try { req.write(payload.body); } catch (e) {
        done({ ok: false, error: '写入请求体失败: ' + e.message, ms: Date.now() - started });
        return;
      }
    }
    req.end();
  });
}

/* ---------------- 保存 ---------------- */
function saveToDesktop(name, bodyBase64) {
  try {
    const ext = (name.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
    const base = (name.replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'url-response').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    const file = base + '-' + stamp + (ext || '.bin');
    const full = path.join(app.getPath('desktop'), file);
    fs.writeFileSync(full, Buffer.from(bodyBase64 || '', 'base64'));
    return { ok: true, path: full };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- IPC ---------------- */
ipcMain.handle('url-tool:context', async () => {
  const c = getContext();
  const ses = currentSession();
  hookSession(ses);
  return enrichCtx(c, ses);
});

ipcMain.handle('url-tool:request', async (event, payload) => {
  const p = payload || {};
  if (!p.url) return { ok: false, error: 'URL 为空' };
  logMsg('[url-tool] ' + (p.method || 'GET') + ' ' + p.url);
  return doRequest(p);
});

ipcMain.handle('url-tool:save', (event, payload) => {
  const p = payload || {};
  return saveToDesktop(p.name, p.bodyBase64);
});

ipcMain.handle('url-tool:copy', (event, text) => {
  try { clipboard.writeText(String(text || '')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.on('url-tool:navigate', (event, url) => {
  try {
    if (callbacks && callbacks.navigate) callbacks.navigate(url);
  } catch (e) { logMsg('[url-tool] 导航失败: ' + e.message, 'WARN'); }
});

/* ---------------- 窗口 ---------------- */
function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 460,
    title: '网址调试',
    backgroundColor: '#0b1220',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  win.setMenu(null);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(renderHtml(getContext())));
  win.webContents.on('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('url-tool:ctx', getContext()); } catch (e) {}
  });
  win.on('focus', () => {
    if (!win || win.isDestroyed()) return;
    const c = getContext();
    const ses = currentSession();
    hookSession(ses);
    try { win.webContents.send('url-tool:ctx', c); } catch (e) {}
    enrichCtx(c, ses).then((c2) => {
      if (c2 !== c && win && !win.isDestroyed()) { try { win.webContents.send('url-tool:ctx', c2); } catch (e) {} }
    }).catch(() => {});
  });
  win.on('closed', () => { win = null; });
  return win;
}

function open() {
  const w = ensureWindow();
  const c = getContext();
  const ses = currentSession();
  hookSession(ses);
  try { w.webContents.send('url-tool:ctx', c); } catch (e) {}
  enrichCtx(c, ses).then((c2) => {
    if (c2 !== c && w && !w.isDestroyed()) { try { w.webContents.send('url-tool:ctx', c2); } catch (e) {} }
  }).catch(() => {});
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  return w;
}

function isOpen() { return !!(win && !win.isDestroyed()); }

// 游戏页跳转时由主进程调用：刷新窗口里的 URL / 账号 / 会话
function refreshContext() {
  if (!win || win.isDestroyed()) return;
  const c = getContext();
  const ses = currentSession();
  hookSession(ses);
  try { win.webContents.send('url-tool:ctx', c); } catch (e) { /* ignore */ }
  enrichCtx(c, ses).then((c2) => {
    if (c2 !== c && win && !win.isDestroyed()) {
      try { win.webContents.send('url-tool:ctx', c2); } catch (e) { /* ignore */ }
    }
  }).catch(() => {});
}

/* ---------------- 界面 ---------------- */
function renderHtml(ctx) {
  const initial = JSON.stringify(ctx || {});
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>网址调试</title><style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0b1220;--panel:#111a2b;--line:#1f2a3d;--text:#dbe4f0;--dim:#8b9ab0;--accent:#38bdf8;--ok:#22c55e;--bad:#ef4444}
html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:'Microsoft YaHei',Consolas,sans-serif;font-size:13px}
body{display:flex;flex-direction:column}
.head{flex:0 0 auto;padding:10px 12px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
.head .t{font-size:14px;font-weight:600}
.head .ctx{margin-left:auto;color:var(--dim);font-size:12px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.head .ctx b{color:var(--accent);font-weight:600}
.row{flex:0 0 auto;padding:10px 12px;display:flex;gap:8px;align-items:center}
select,input,textarea,button{font-family:inherit;font-size:13px;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:7px;outline:none}
select{height:32px;padding:0 8px}
input{height:32px;padding:0 10px;flex:1;min-width:120px}
input:focus,textarea:focus{border-color:var(--accent)}
input.bad{border-color:var(--bad)}
button{height:32px;padding:0 14px;cursor:pointer;background:var(--panel)}
button:hover{border-color:var(--accent);color:var(--accent)}
button.primary{background:var(--accent);color:#062033;border-color:var(--accent);font-weight:600}
button.primary:hover{filter:brightness(1.08);color:#062033}
button:disabled{opacity:.45;cursor:not-allowed}
#bodyWrap{display:none;padding:0 12px 8px}
#bodyWrap textarea{width:100%;height:74px;padding:8px 10px;resize:vertical;font-family:Consolas,monospace}
.bar{flex:0 0 auto;padding:8px 12px;display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:rgba(255,255,255,.02)}
.status{font-weight:600}
.status.ok{color:var(--ok)}.status.bad{color:var(--bad)}
.meta{color:var(--dim);font-size:12px}
.bar .sp{flex:1}
.out{flex:1 1 auto;min-height:80px;overflow:auto;padding:10px 12px;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.hint{padding:4px 12px 10px;color:var(--dim);font-size:12px;flex:0 0 auto}
.hist{flex:0 0 auto;max-height:150px;overflow:auto;border-top:1px solid var(--line)}
.hist .h{padding:6px 12px;color:var(--dim);font-size:12px;position:sticky;top:0;background:var(--bg)}
.hist .it{padding:5px 12px;display:flex;gap:8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden}
.hist .it:hover{background:rgba(56,189,248,.08)}
.hist .it .m{color:var(--accent);width:38px;flex:0 0 auto}
.hist .it .u{flex:1;overflow:hidden;text-overflow:ellipsis;color:var(--dim)}
.hist .it .s{width:42px;text-align:right;flex:0 0 auto}
.net{flex:0 0 auto;max-height:178px;overflow:auto;border-top:1px solid var(--line);background:rgba(255,255,255,.015)}
.net .h{position:sticky;top:0;background:var(--bg);padding:6px 12px;display:flex;gap:8px;align-items:center;color:var(--dim);font-size:12px;z-index:2}
.net .h input{height:24px;flex:1;font-size:12px}
.net .h button{height:24px;padding:0 8px;font-size:12px}
.net .it{padding:4px 12px;display:flex;gap:8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden}
.net .it:hover{background:rgba(56,189,248,.08)}
.net .it .m{color:var(--accent);width:42px;flex:0 0 auto}
.net .it .s{width:38px;text-align:right;flex:0 0 auto;color:var(--dim)}
.net .it .t{width:58px;flex:0 0 auto;color:var(--dim)}
.net .it .u{flex:1;overflow:hidden;text-overflow:ellipsis}
.net .empty{padding:8px 12px;color:var(--dim);font-size:12px;line-height:1.6}
.banner{display:none;padding:8px 12px;background:rgba(56,189,248,.10);border-bottom:1px solid var(--line);color:var(--accent);font-size:12px}
.banner.show{display:block}
</style></head><body>
<div class="head">
  <span class="t">网址调试</span>
  <button id="refreshCtx" style="height:26px;padding:0 10px;font-size:12px">刷新账号</button>
  <span class="ctx" id="ctx">—</span>
</div>
<div class="banner" id="banner">未检测到游戏标签：请先在游戏窗口登录，然后点「刷新账号」。</div>
<div class="row">
  <select id="method"><option value="GET">GET</option><option value="POST">POST</option></select>
  <input id="url" spellcheck="false" placeholder="https://...  （可直接改路径/参数后发送）">
  <button id="fill">取当前页</button>
  <button class="primary" id="send">发送</button>
  <button id="clear">清空</button>
</div>
<div id="bodyWrap"><textarea id="body" spellcheck="false" placeholder='POST 请求体，默认 application/json'></textarea></div>
<div class="bar">
  <span class="status" id="status">就绪</span>
  <span class="meta" id="meta"></span>
  <span class="sp"></span>
  <button id="copyUrl">复制 URL</button>
  <button id="copyRes">复制响应</button>
  <button id="save" disabled>保存到桌面</button>
  <button id="open" disabled>在游戏标签打开</button>
</div>
<div class="out" id="out"></div>
<div class="hint">只走 HTTP/HTTPS 并复用当前游戏会话（带登录态）；游戏 TCP（11096）不在其中，改这里是看不到的。</div>
<div class="net">
  <div class="h"><span>捕获的请求</span><span id="netCount">0</span><input id="netFilter" placeholder="过滤 URL"><button id="netClear">清空</button></div>
  <div id="netList"><div class="empty" id="netEmpty">先打开本窗口，再回游戏里点开对应面板（商城 / 活动 / 背包），这里会实时列出 HTTP 请求。点一条即可填入上面的输入框。若点开面板后这里仍然为空，说明那份数据走的是游戏 TCP，不是 HTTP。</div></div>
</div>
<div class="hist"><div class="h">历史（最近 50 条）</div><div id="histList"></div></div>

<script>
const { ipcRenderer } = require('electron');
const $ = (id) => document.getElementById(id);
let CTX = ${initial};
let LAST = null;
let NET = [];
let LAST_CUR = '';

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function applyCtx(c) {
  CTX = c || {};
  const el = $('ctx');
  const banner = $('banner');
  if (CTX.hasTab) {
    const parts = [];
    if (CTX.windowTitle) parts.push('窗口：' + esc(CTX.windowTitle));
    parts.push('账号：<b>' + esc(CTX.qq || '未识别') + '</b>' + (CTX.partition ? '（' + esc(CTX.partition) + '）' : ''));
    el.innerHTML = parts.join(' · ');
    banner.className = 'banner';
  } else {
    el.innerHTML = '无活动标签，使用<b>默认会话</b>';
    banner.className = 'banner show';
  }
  $('open').disabled = !CTX.hasTab;
  // 页面跳转时自动更新地址栏，但不覆盖用户已经手改过的内容
  const inp = $('url');
  const cur = CTX.currentUrl || '';
  if (cur && (!inp.value.trim() || inp.value === LAST_CUR)) inp.value = cur;
  LAST_CUR = cur;
}
function renderNet() {
  const kw = ($('netFilter').value || '').trim().toLowerCase();
  const list = NET.filter(function (x) { return !kw || x.url.toLowerCase().indexOf(kw) >= 0; });
  $('netCount').textContent = list.length + '/' + NET.length;
  const box = $('netList');
  box.innerHTML = '';
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = NET.length
      ? '没有匹配的 URL。'
      : '先打开本窗口，再回游戏里点开对应面板（商城 / 活动 / 背包），这里会实时列出 HTTP 请求。点一条即可填入上面的输入框。若点开面板后这里仍然为空，说明那份数据走的是游戏 TCP，不是 HTTP。';
    box.appendChild(d);
    return;
  }
  list.slice(0, 200).forEach(function (x) {
    const d = document.createElement('div');
    d.className = 'it';
    d.title = x.url;
    d.innerHTML = '<span class="m">' + esc(x.method) + '</span>' +
      '<span class="s">' + esc(x.status || '') + '</span>' +
      '<span class="t">' + esc(x.type || '') + '</span>' +
      '<span class="u">' + esc(x.url) + '</span>';
    d.onclick = function () { $('method').value = x.method === 'POST' ? 'POST' : 'GET'; $('url').value = x.url; syncBody(); };
    box.appendChild(d);
  });
}
function setStatus(text, cls, meta) {
  const s = $('status');
  s.textContent = text;
  s.className = 'status' + (cls ? ' ' + cls : '');
  $('meta').textContent = meta || '';
}
function hexDump(bytes) {
  const max = Math.min(bytes.length, 4096);
  let out = '';
  for (let i = 0; i < max; i += 16) {
    let hex = '', asc = '';
    for (let j = 0; j < 16; j++) {
      if (i + j < max) {
        const b = bytes[i + j];
        hex += (b < 16 ? '0' : '') + b.toString(16) + ' ';
        asc += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
      } else { hex += '   '; asc += ' '; }
    }
    out += ('0000000' + i.toString(16)).slice(-7) + '  ' + hex + ' ' + asc + '\\n';
  }
  if (bytes.length > max) out += '\\n… 仅显示前 4 KB，共 ' + fmtBytes(bytes.length) + '（可保存原文件）';
  return out;
}
function decodeB64(b64) {
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function isTextMime(m) {
  return /text\\/|json|xml|javascript|ecmascript|html|css|csv|x-www-form-urlencoded/i.test(m || '');
}
function looksText(bytes) {
  const n = Math.min(bytes.length, 2048);
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0xC0) printable++;
  }
  return n > 0 && printable / n > 0.92;
}
function renderResponse(res) {
  const out = $('out');
  if (!res.ok) {
    setStatus('请求失败', 'bad', res.ms + ' ms');
    out.textContent = res.error || '未知错误';
    LAST = null;
    $('save').disabled = true;
    $('copyRes').disabled = true;
    return;
  }
  const bytes = decodeB64(res.bodyBase64);
  const mime = (res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || '';
  const cls = res.status >= 200 && res.status < 400 ? 'ok' : 'bad';
  setStatus(res.status + ' ' + (res.statusMessage || ''), cls,
    res.ms + ' ms · ' + fmtBytes(bytes.length) + (res.decompressed ? ' · 已解压(' + res.decompressed + ')' : '') + (mime ? ' · ' + mime : '') + (res.truncated ? ' · 已截断' : ''));
  LAST = { res: res, bytes: bytes, mime: mime };

  let text;
  if (isTextMime(mime) || looksText(bytes)) {
    text = new TextDecoder('utf-8').decode(bytes);
    if (/json/i.test(mime)) {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
    }
    if (text.length > ${MAX_SHOW_CHARS}) text = text.slice(0, ${MAX_SHOW_CHARS}) + '\\n… 已省略（过长）';
    out.textContent = text;
  } else {
    out.textContent = hexDump(bytes);
  }
  $('save').disabled = false;
  $('copyRes').disabled = false;
}
function extOf(mime, url) {
  const m = (mime || '').toLowerCase();
  if (m.indexOf('json') >= 0) return '.json';
  if (m.indexOf('xml') >= 0) return '.xml';
  if (m.indexOf('html') >= 0) return '.html';
  if (m.indexOf('javascript') >= 0) return '.js';
  if (m.indexOf('css') >= 0) return '.css';
  if (m.indexOf('png') >= 0) return '.png';
  if (m.indexOf('jpeg') >= 0 || m.indexOf('jpg') >= 0) return '.jpg';
  if (m.indexOf('gif') >= 0) return '.gif';
  if (m.indexOf('flash') >= 0) return '.swf';
  const u = (url || '').split('?')[0];
  const mm = u.match(/\\.(cfg|pkg|xml|json|txt|swf|png|jpg|jpeg|gif|mp3|flv|dat)$/i);
  return mm ? '.' + mm[1].toLowerCase() : '.bin';
}
function loadHistory() {
  try { return JSON.parse(localStorage.getItem('url-tool-history') || '[]'); } catch (e) { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem('url-tool-history', JSON.stringify(list.slice(0, 50))); } catch (e) {}
}
function pushHistory(method, url, status) {
  const list = loadHistory();
  list.unshift({ t: Date.now(), m: method, u: url, s: status });
  saveHistory(list);
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  const box = $('histList');
  box.innerHTML = '';
  list.forEach((h) => {
    const d = document.createElement('div');
    d.className = 'it';
    d.title = h.u;
    d.innerHTML = '<span class="m">' + esc(h.m) + '</span><span class="u">' + esc(h.u) + '</span><span class="s">' + esc(h.s == null ? '' : h.s) + '</span>';
    d.onclick = () => { $('method').value = h.m; $('url').value = h.u; syncBody(); };
    box.appendChild(d);
  });
}
function syncBody() {
  $('bodyWrap').style.display = $('method').value === 'POST' ? 'block' : 'none';
}
function normalizeUrl(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\\/\\//i.test(s)) s = 'https://' + s;
  return s;
}
async function send() {
  const url = normalizeUrl($('url').value);
  if (!url) { $('url').classList.add('bad'); setStatus('URL 为空', 'bad'); return; }
  try { new URL(url); } catch (e) { $('url').classList.add('bad'); setStatus('URL 不合法', 'bad'); return; }
  $('url').classList.remove('bad');
  const method = $('method').value;
  const body = method === 'POST' ? $('body').value : '';
  $('send').disabled = true;
  setStatus('请求中…', '', url);
  $('out').textContent = '';
  try {
    const res = await ipcRenderer.invoke('url-tool:request', {
      url: url, method: method, body: body,
      partition: CTX.partition || '',
      contentType: 'application/json'
    });
    renderResponse(res);
    pushHistory(method, url, res.ok ? res.status : 'ERR');
  } catch (e) {
    renderResponse({ ok: false, error: e.message });
  }
  $('send').disabled = false;
}

$('send').onclick = send;
$('refreshCtx').onclick = async function () {
  try {
    const c = await ipcRenderer.invoke('url-tool:context');
    applyCtx(c);
    setStatus('已刷新账号上下文', 'ok', CTX.hasTab ? (CTX.qq || '') : '无活动标签');
  } catch (e) { setStatus('刷新失败', 'bad', e.message); }
};
$('fill').onclick = function () {
  if (CTX.currentUrl) { $('url').value = CTX.currentUrl; $('url').classList.remove('bad'); }
  else setStatus('当前标签还没有 URL', 'bad');
};
$('netFilter').oninput = renderNet;
$('netClear').onclick = function () { NET = []; renderNet(); };
ipcRenderer.on('url-tool:net', function (e, d) {
  NET.unshift(d);
  if (NET.length > 300) NET.length = 300;
  renderNet();
});
$('clear').onclick = () => { $('url').value = ''; $('body').value = ''; $('out').textContent = ''; setStatus('就绪', ''); $('url').classList.remove('bad'); };
$('method').onchange = syncBody;
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
$('copyUrl').onclick = () => { ipcRenderer.invoke('url-tool:copy', $('url').value); };
$('copyRes').onclick = () => {
  const t = $('out').textContent;
  ipcRenderer.invoke('url-tool:copy', t);
  setStatus('已复制响应到剪贴板', 'ok', $('meta').textContent);
};
$('save').onclick = async () => {
  if (!LAST) return;
  const name = 'url-response' + extOf(LAST.mime, LAST.res.finalUrl);
  const r = await ipcRenderer.invoke('url-tool:save', { name: name, bodyBase64: LAST.res.bodyBase64 });
  if (r && r.ok) { setStatus('已保存', 'ok', r.path); }
  else { setStatus('保存失败', 'bad', (r && r.error) || ''); }
};
$('open').onclick = () => {
  const url = normalizeUrl($('url').value);
  if (!url) return;
  ipcRenderer.send('url-tool:navigate', url);
};

ipcRenderer.on('url-tool:ctx', (e, c) => applyCtx(c));

applyCtx(CTX);
syncBody();
renderHistory();
renderNet();
if (CTX.currentUrl) $('url').value = CTX.currentUrl;
</script>
</body></html>`;
  return html;
}

module.exports = { init, open, isOpen, refreshContext };
