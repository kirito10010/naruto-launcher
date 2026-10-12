// capture.js —— 游戏流量探测/抓包层（阶段一）
// 开关关闭时本模块零副作用，不影响正常使用。
const { app, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

let enabled = false;
let captureDir = '';
let jsonlStream = null;
const attached = new WeakSet();

function isCaptureEnabled() {
  return enabled;
}

function getCaptureDir() {
  return captureDir;
}

function initCapture(opts) {
  enabled = !!(opts && opts.enabled);
  if (!enabled) return;

  captureDir = path.join(app.getPath('userData'), 'captures');
  try {
    fs.mkdirSync(captureDir, { recursive: true });
  } catch (e) {
    // 目录创建失败则放弃抓包，不影响游戏
    enabled = false;
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    jsonlStream = fs.createWriteStream(path.join(captureDir, `http-${stamp}.jsonl`), { flags: 'a' });
  } catch (e) {
    enabled = false;
    return;
  }

  // 与标签机制解耦：任何新建的 webContents 都尝试挂载
  app.on('web-contents-created', (e, wc) => attach(wc));
  webContents.getAllWebContents().forEach(attach);
}

function shouldCapture(wc) {
  try {
    const t = wc.getType(); // 'webview' | 'browserView' | 'window' | 'backgroundPage' ...
    if (t === 'webview' || t === 'browserView') return true;
    return /huoying\.qq\.com|ptlogin2\.qq\.com/.test(wc.getURL() || '');
  } catch (e) {
    return false;
  }
}

function writeLine(obj) {
  if (!jsonlStream) return;
  try {
    jsonlStream.write(JSON.stringify(obj) + '\n');
  } catch (e) {
    // 磁盘写入失败绝不能影响主流程
  }
}

function safeUrl(wc) {
  try {
    return wc.getURL();
  } catch (e) {
    return '';
  }
}

function attach(wc) {
  if (!enabled || attached.has(wc) || !shouldCapture(wc)) return;
  attached.add(wc);

  const label = `${wc.getType()}#${wc.id}`;
  try {
    wc.debugger.attach('1.3');
    wc.debugger.sendCommand('Network.enable', {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: 50 * 1024 * 1024,
      maxPostDataSize: 10 * 1024 * 1024
    });
    wc.debugger.sendCommand('Page.enable');
  } catch (e) {
    writeLine({ type: 'attach-error', label, error: String(e) });
    return;
  }

  wc.debugger.on('message', (event, method, params) => {
    handleCdp(label, method, params, wc).catch(() => {});
  });
  wc.debugger.on('detach', () => {
    attached.delete(wc);
  });

  writeLine({ type: 'attach', label, url: safeUrl(wc) });
}

async function handleCdp(label, method, params, wc) {
  switch (method) {
    case 'Network.requestWillBeSent':
      writeLine({
        type: 'req',
        label,
        id: params.requestId,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData || null,
        ts: params.wallTime || params.timestamp
      });
      break;

    case 'Network.responseReceived':
      writeLine({
        type: 'res',
        label,
        id: params.requestId,
        url: params.response.url,
        status: params.response.status,
        mime: params.response.mimeType,
        headers: params.response.headers
      });
      break;

    case 'Network.loadingFinished': {
      let body = null;
      let base64 = false;
      try {
        const r = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        body = r.body;
        base64 = r.base64Encoded;
      } catch (e) {
        // 响应体可能已被回收，忽略
      }
      writeLine({
        type: 'body',
        label,
        id: params.requestId,
        base64,
        len: body ? body.length : 0,
        body
      });
      break;
    }

    case 'Network.webSocketCreated':
      writeLine({ type: 'ws-open', label, id: params.requestId, url: params.url });
      break;

    case 'Network.webSocketFrameSent':
      writeLine({
        type: 'ws-sent',
        label,
        id: params.requestId,
        opcode: params.response.opcode,
        payload: params.response.payloadData
      });
      break;

    case 'Network.webSocketFrameReceived':
      writeLine({
        type: 'ws-recv',
        label,
        id: params.requestId,
        opcode: params.response.opcode,
        payload: params.response.payloadData
      });
      break;
  }
}

module.exports = { initCapture, isCaptureEnabled, getCaptureDir };
