// online.js —— 在线人数：客户端定时上报 + 接收汇总
//
// 计数口径（由 main.js 的 getCounts 提供）：
//   fire = 所有火影窗口里已加载的标签页（webview）总数
//   mini = 所有 4399 等极简窗口里已加载的标签页总数
//
// 服务端不可达时静默失败：保留上次数字，超过 60 秒仍失败则清空（界面显示 --）。
const http = require('http');

const DEFAULT_URL = 'http://49.235.142.253:10001';
const SERVER_URL = process.env.HYOL_ONLINE_URL || DEFAULT_URL;   // 本地联调可覆盖
const REPORT_EVERY = 5 * 1000;   // 5 秒上报一次，实际人数变化更快
const REQUEST_TIMEOUT = 3000;
const STALE_AFTER = 60 * 1000;

let log = () => {};
let getCounts = () => ({ fire: 0, mini: 0 });
let onUpdate = () => {};
let clientId = '';

let last = null;          // { fire, mini }
let lastOkAt = 0;
let timer = null;

function postReport(body) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    let payload;
    let url;
    try {
      payload = Buffer.from(JSON.stringify(body), 'utf8');
      url = new URL(SERVER_URL);
    } catch (e) {
      done(null);
      return;
    }

    let req;
    try {
      req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: '/report',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length
        }
      }, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return done(null);
          try { done(JSON.parse(raw)); } catch (e) { done(null); }
        });
        res.on('error', () => done(null));
      });
      req.on('error', () => done(null));
      req.setTimeout(REQUEST_TIMEOUT, () => {
        try { req.destroy(); } catch (e) { /* ignore */ }
        done(null);
      });
      req.end(payload);
    } catch (e) {
      done(null);
    }
  });
}

async function tick() {
  if (!clientId) return;
  const c = getCounts() || { fire: 0, mini: 0 };
  const data = await postReport({ id: clientId, fire: c.fire, mini: c.mini });

  if (data && typeof data.fire === 'number' && typeof data.mini === 'number') {
    lastOkAt = Date.now();
    const changed = !last || last.fire !== data.fire || last.mini !== data.mini;
    last = { fire: data.fire, mini: data.mini };
    if (changed) onUpdate(last);
    return;
  }

  // 失败：超过 60 秒没成功过就清空，让界面显示 --
  if (last && Date.now() - lastOkAt > STALE_AFTER) {
    last = null;
    onUpdate({ fire: null, mini: null });
  }
}

function init(opts) {
  log = (opts && opts.log) || (() => {});
  clientId = (opts && opts.clientId) || '';
  getCounts = (opts && opts.getCounts) || (() => ({ fire: 0, mini: 0 }));
  onUpdate = (opts && opts.onUpdate) || (() => {});

  if (!clientId) {
    log('[online] 缺少 clientId，跳过上报', 'WARN');
    return;
  }

  log('[online] 上报地址: ' + SERVER_URL);
  tick();
  timer = setInterval(tick, REPORT_EVERY);
  if (timer.unref) timer.unref();
}

function getLast() {
  return last;
}

module.exports = { init, getLast };
