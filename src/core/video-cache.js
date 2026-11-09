// 奥义视频 H.264 本地缓存
//
// 奥义原片是 FLV/H.263（Sorenson Spark），Flash 只能软解，1080p/120fps 全靠 CPU；
// 换成 H.264 后，flash.media.Video 可以把解码交给 GPU。
//
// 做法：随包预置一批已转好的 H.264 FLV（resources/videos/），起一个只监听 127.0.0.1
// 的静态服务，把 res.huoying.qq.com 的 assets/battle/video/*.flv 重定向过去。
//
// 边界：
//   1. 只碰视频，不动主 SWF —— 避免预加载停在 0%。
//   2. 命中条件 = 文件名在清单里；构建目录不一致只告警，不阻断。
//   3. 未命中（新视频、.f4v、服务没起来）一律原样放行，回 CDN 拉原片。
//
// 清单来自每个视频旁边的 <名>.flv.cache.json（原 URL / 字节数 / 编码）。
// 实现参考 GameLauncher 1.5.1 的 video-cache 设计。
const fs = require('fs');
const http = require('http');
const path = require('path');

const VIDEO_HOST = 'res.huoying.qq.com';
const VIDEO_PATH_RE = /^\/([^/]+)\/assets\/battle\/video\/([^/]+\.flv)$/i;
const CACHE_SUFFIX = '.cache.json';

let logFn = null;
let onLogFn = null;
let videoDir = '';
let server = null;
let serverUrl = '';
let started = false;
let entries = new Map();
let buildHint = '';

const attachedSessions = new WeakSet();
const hitLogged = new Set();
const missLogged = new Set();
let buildWarned = false;

function log(level, message) {
  const lv = level === 'warn' ? 'WARN' : (level === 'error' ? 'ERROR' : 'INFO');
  // 调试控制台存在时只走 onLog（它自己会写文件 + 实时显示），不再往 launcher.log 里留一份
  if (typeof onLogFn === 'function') {
    try { onLogFn(lv, message); } catch (e) { /* ignore */ }
    return;
  }
  try {
    if (typeof logFn === 'function') logFn('[video] ' + message, lv);
  } catch (e) { /* 日志失败不影响请求链路 */ }
}

function init(opts) {
  logFn = opts && opts.log ? opts.log : null;
  onLogFn = opts && opts.onLog ? opts.onLog : null;
  videoDir = opts && opts.videoDir ? opts.videoDir : '';
}

function formatSize(bytes) {
  if (!bytes) return '未知大小';
  return (bytes / 1048576).toFixed(1) + 'MB';
}

// 读取 <名>.flv.cache.json 建立清单；任何一项不合法就跳过
function loadManifest(dir) {
  const map = new Map();
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    log('warn', '视频目录不可读 ' + dir + ': ' + e.message);
    return map;
  }

  const builds = new Set();
  for (let i = 0; i < files.length; i++) {
    const metaName = files[i];
    if (!metaName.toLowerCase().endsWith('.flv' + CACHE_SUFFIX)) continue;

    const videoName = metaName.slice(0, -CACHE_SUFFIX.length);
    const videoFile = path.join(dir, videoName);

    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, metaName), 'utf8'));
    } catch (e) {
      log('warn', '缓存元数据损坏，跳过 ' + metaName);
      continue;
    }
    if (!meta || !meta.url) continue;

    let source;
    try {
      source = new URL(meta.url);
    } catch (e) {
      continue;
    }

    const m = VIDEO_PATH_RE.exec(source.pathname);
    if (!m || m[2].toLowerCase() !== videoName.toLowerCase()) continue;
    if (!fs.existsSync(videoFile)) continue;

    builds.add(m[1]);
    map.set(videoName.toLowerCase(), {
      name: videoName,
      file: videoFile,
      build: m[1],
      url: meta.url,
      bytes: meta.bytes || 0,
      sourceBytes: meta.sourceBytes || 0
    });
  }

  buildHint = builds.size > 0 ? String(builds.size) : '';
  return map;
}

// 判断一个请求是否该重定向到本地
function matchVideoUrl(urlString, map) {
  const table = map || entries;

  let u;
  try {
    u = new URL(urlString);
  } catch (e) {
    return null;
  }

  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== VIDEO_HOST) return null;

  const m = VIDEO_PATH_RE.exec(u.pathname);
  if (!m) return null;

  const entry = table.get(m[2].toLowerCase());
  if (!entry) return null;

  if (entry.build.toLowerCase() !== m[1].toLowerCase() && !buildWarned) {
    buildWarned = true;
    log('warn', '构建不一致：请求 ' + m[1] + '，缓存 ' + entry.build + '（仍按文件名命中）');
  }

  return entry;
}

function videoNameFromUrl(urlString) {
  try {
    const u = new URL(urlString);
    const m = VIDEO_PATH_RE.exec(u.pathname);
    return m ? m[2] : '';
  } catch (e) {
    return '';
  }
}

// null = 无 Range；'invalid' = 416；其余返回闭区间
function parseRange(header, size) {
  if (!header) return null;

  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return null;

  let start;
  let end;
  if (m[1] === '') {
    const suffix = parseInt(m[2], 10);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }

  if (!isFinite(start) || !isFinite(end) || start > end || start >= size) return 'invalid';
  return { start: start, end: end };
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function countHit(entry) {
  if (hitLogged.has(entry.name)) return;
  hitLogged.add(entry.name);
  log('info', 'H.264 命中 ' + entry.name + '（' + formatSize(entry.bytes) + '）');
}

function serveVideo(req, res, entry) {
  let size;
  try {
    size = fs.statSync(entry.file).size;
  } catch (e) {
    send(res, 404, { 'Cache-Control': 'no-store' }, 'not found');
    return;
  }

  const range = parseRange(req.headers.range, size);
  const headers = {
    'Content-Type': 'video/x-flv',
    'Accept-Ranges': 'bytes',
    // 不让 Chromium 把本地响应写进各账号分区，否则 78MB 会被复制 N 份
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  };

  if (range === 'invalid') {
    headers['Content-Range'] = 'bytes */' + size;
    send(res, 416, headers);
    return;
  }

  if (range) {
    headers['Content-Length'] = range.end - range.start + 1;
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + size;
  } else {
    headers['Content-Length'] = size;
  }

  if (req.method === 'HEAD') {
    res.writeHead(range ? 206 : 200, headers);
    res.end();
    return;
  }

  res.writeHead(range ? 206 : 200, headers);
  countHit(entry);

  const stream = range
    ? fs.createReadStream(entry.file, { start: range.start, end: range.end })
    : fs.createReadStream(entry.file);
  stream.on('error', function () {
    try { res.destroy(); } catch (e) { /* ignore */ }
  });
  res.on('close', function () {
    stream.destroy();
  });
  stream.pipe(res);
}

function handleRequest(req, res) {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');

    if (u.pathname === '/crossdomain.xml') {
      const body =
        '<?xml version="1.0"?>\n' +
        '<!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">\n' +
        '<cross-domain-policy><allow-access-from domain="*" /></cross-domain-policy>\n';
      send(res, 200, {
        'Content-Type': 'text/x-cross-domain-policy',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
      }, body);
      return;
    }

    if (u.pathname.indexOf('/v/') === 0) {
      const name = decodeURIComponent(u.pathname.slice(3));
      const entry = entries.get(name.toLowerCase());
      if (!entry) {
        send(res, 404, { 'Cache-Control': 'no-store' }, 'not found');
        return;
      }
      serveVideo(req, res, entry);
      return;
    }

    send(res, 404, { 'Cache-Control': 'no-store' }, 'not found');
  } catch (e) {
    try { send(res, 500, { 'Cache-Control': 'no-store' }, 'error'); } catch (e2) { /* ignore */ }
  }
}

function start() {
  if (started) return Promise.resolve(serverUrl);

  entries = loadManifest(videoDir);
  if (entries.size === 0) {
    log('warn', '没有可用的 H.264 视频，视频缓存不启用');
    return Promise.resolve('');
  }

  return new Promise(function (resolve) {
    server = http.createServer(handleRequest);
    server.on('error', function (e) {
      log('error', '本地视频服务启动失败: ' + e.message);
      server = null;
      resolve('');
    });
    server.listen(0, '127.0.0.1', function () {
      serverUrl = 'http://127.0.0.1:' + server.address().port;
      started = true;
      const suffix = buildHint ? '，来自 ' + buildHint + ' 个构建' : '';
      log('info', '奥义 H.264 本地服务已启动 ' + serverUrl + '（' + entries.size + ' 部' + suffix + '）');
      resolve(serverUrl);
    });
  });
}

// 每个 session 只能有一个 onBeforeRequest，这里按 session 去重
function attach(session) {
  if (!started || !session || !session.webRequest) return;
  if (attachedSessions.has(session)) return;
  attachedSessions.add(session);

  try {
    session.webRequest.onBeforeRequest(
      { urls: ['https://' + VIDEO_HOST + '/*'] },
      function (details, callback) {
        let redirect = '';
        try {
          const entry = matchVideoUrl(details.url);
          if (entry) {
            redirect = serverUrl + '/v/' + encodeURIComponent(entry.name);
          } else {
            const name = videoNameFromUrl(details.url);
            if (name && !missLogged.has(name)) {
              missLogged.add(name);
              log('info', '未收录，走原片: ' + name + ' ' + details.url);
            }
          }
        } catch (e) {
          log('warn', '视频重定向判定失败: ' + e.message);
        }
        callback(redirect ? { redirectURL: redirect } : {});
      }
    );
    log('info', '已挂载视频缓存重定向');
  } catch (e) {
    log('error', '挂载视频缓存失败: ' + e.message);
  }
}

function stop() {
  if (!server) return;
  try { server.close(); } catch (e) { /* ignore */ }
  server = null;
  serverUrl = '';
  started = false;
}

module.exports = {
  init,
  start,
  attach,
  stop,
  // 测试用
  _loadManifest: loadManifest,
  _matchVideoUrl: matchVideoUrl,
  _parseRange: parseRange
};
