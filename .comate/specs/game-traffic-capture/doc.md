# 游戏流量抓包与解析（game-traffic-capture）

## 1. 背景与目标

### 1.1 需求
在 naruto-launcher 中，抓取并解析**游戏组织成员名单**与**本周参与的活动次数**，用于统计。

### 1.2 关键约束（已与用户确认）
- **协议未知**：游戏是 Flash 页游（`https://huoying.qq.com/`），通信方式（HTTP / WebSocket / 原始 TCP）尚未确定，必须先探测。
- **分阶段交付**：先做流量探测/抓包，确认协议后再做解析与展示。
- **字段待定**：具体字段先看能抓到什么再定。
- **环境**：有管理员权限，可安装第三方抓包工具（npcap/Fiddler/代理）作为备选。

### 1.3 技术现状（代码事实）
| 事实 | 位置 |
|---|---|
| 游戏运行在 `BrowserView` / `<webview>` 中，开启 Flash PPAPI（`plugins:true`） | `main.js:2302`、`game.html:924-1001` |
| 每个标签页使用独立 session 分区 | `main.js:2295`、`game.html:738-743` |
| Flash 相关命令行开关在**模块顶层**设置（app ready 之前） | `main.js:886-916` |
| 项目内**没有** `speedhook.dll` 的 C++ 源码，只有预编译二进制 | `resources/native/` |
| 已有 `app.getPath('userData')` 使用先例 | `main.js:9` |
| 存在两套标签机制：`<webview>`（game.html）与 `BrowserView`（`addTabToGameWindow`） | `main.js:2219/2251/2279` |

> 结论：抓包层必须**与标签机制解耦**，通过 `app.on('web-contents-created')` 统一挂载，避免依赖某一种实现。

---

## 2. 总体方案（三阶段）

| 阶段 | 目标 | 本次是否实现 |
|---|---|---|
| **阶段一：流量探测层** | 打开抓包开关后，无差别记录游戏窗口的全部网络活动（HTTP 请求/响应/响应体、WebSocket 帧、socket 级 net-log），产出可分析文件 | ✅ 本次实现 |
| **阶段二：协议解析** | 依据阶段一发现的协议，编写解码器，把"组织成员名单""本周活动次数"解成结构化数据 | ⏳ 待阶段一确认后补充 |
| **阶段三：导出与 UI** | 数据导出 CSV/JSON，并在启动器内加入统计面板 | ⏳ 待阶段一确认后补充 |

**为什么先做阶段一**：抓包方案完全取决于协议。若走 HTTP/WebSocket，用 Electron 内置能力即可；若走原始 TCP，需升级到 npcap 或 winsock hook（成本高、需管理员）。在协议确定前写解析器属于猜测，因此阶段一必须先行。

---

## 3. 阶段一：流量探测与抓包层（本次实现）

### 3.1 开关与触发

三种任一方式即可开启（默认关闭，不影响正常用户）：

1. 命令行参数：`naruto-launcher.exe --capture-traffic`
2. 环境变量：`NARUTO_CAPTURE=1`
3. 配置文件：`config.json` 中 `"captureEnabled": true`

判定在**模块顶层**完成（net-log 开关必须在 app ready 前设置）：

```js
// main.js 顶部（在 L8 常量之后、其他 commandLine 开关之前）
function readConfigSync() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { /* 忽略，使用默认 */ }
  return {};
}
const EARLY_CONFIG = readConfigSync();
const CAPTURE_ENABLED =
  process.argv.includes('--capture-traffic') ||
  process.env.NARUTO_CAPTURE === '1' ||
  EARLY_CONFIG.captureEnabled === true;
```

### 3.2 三条抓包通道（互补，同时开启）

| 通道 | 覆盖范围 | 实现 | 产出 |
|---|---|---|---|
| **A. Chromium net-log** | 网络栈全量事件，**含 socket 连接与原始收发字节**，是抓原始 TCP 载荷的唯一内置通道 | `--log-net-log=<file> --net-log-capture-mode=IncludeSocketBytes` | `netlog-<时间戳>.json` |
| **B. CDP Network 域** | HTTP 请求/响应/响应体、WebSocket 帧 | `webContents.debugger` + `Network.enable` | `http-<时间戳>.jsonl` |
| **C. webRequest（兜底）** | HTTP 请求元数据（CDP 挂载失败时的后备） | `session.webRequest.onBeforeRequest` | 追加进同一 jsonl |

- **A** 是判断"是否原始 TCP"的关键——即使 Flash 用 PPAPI 原始 socket，也会经过 Chromium 网络服务并出现在 net-log 中。
- **B** 能拿到响应体（`Network.getResponseBody`），这是 HTTP 协议下解包的主要数据源。
- **C** 作为保险，避免 debugger 附加失败导致零数据。

> **重要（易错点）**：`net-log-capture-mode` 的合法值只有 `Default` / `IncludeCookiesAndCredentials` / `IncludeSocketBytes`。**只有 `IncludeSocketBytes` 会记录 socket 原始收发字节**；`IncludeCookiesAndCredentials`（以及旧称 `IncludeSensitive`）**不含载荷**。
>
> **原始 TCP 场景（实测现象）**：在浏览器 devtools 的 Network 面板看不到任何请求，说明游戏走的是 Flash `flash.net.Socket` 原始 TCP，而非 HTTP/WebSocket。此时：
> - 通道 B（CDP Network）**完全无效**；
> - 通道 C 无效；
> - **只能靠通道 A 的 socket 字节**，或用 npcap/Wireshark 兜底。

### 3.3 输出位置与格式

统一输出到 `app.getPath('userData')/captures/`：

```
captures/
├── netlog-2026-10-12T08-30-00-000Z.json   # Chromium 原生 net-log
└── http-2026-10-12T08-30-00-000Z.jsonl    # 每行一条 JSON 事件
```

`http-*.jsonl` 事件类型：

| type | 字段 |
|---|---|
| `attach` / `attach-error` | `label`, `url` |
| `req` | `id`, `url`, `method`, `headers`, `postData`, `ts` |
| `res` | `id`, `url`, `status`, `mime`, `headers` |
| `body` | `id`, `base64`, `len`, `body` |
| `ws-open` / `ws-sent` / `ws-recv` | `id`, `url`/`opcode`, `payload` |

### 3.4 涉及文件

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `capture.js` | **新增** | 抓包层全部逻辑（net-log 目录、CDP 挂载、事件写入） |
| `main.js` | 修改 | 顶部：读取早配置 + net-log 开关；`whenReady` 内：`capture.initCapture()` |
| `tools/analyze-capture.js` | **新增** | 离线分析脚本：按 host 汇总、找可疑端点、关键词检索 |
| `tools/extract-socket-bytes.js` | **新增** | 从 net-log 提取 socket 原始收发字节，按连接重建二进制流（原始 TCP 场景的关键工具） |

### 3.5 实现细节

#### 3.5.1 新增 `capture.js`

```js
// capture.js —— 游戏流量探测/抓包层（阶段一）
const { app, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

let enabled = false;
let captureDir = '';
let jsonlStream = null;
const attached = new WeakSet();

function isCaptureEnabled() { return enabled; }
function getCaptureDir() { return captureDir; }

function initCapture(opts) {
  enabled = !!(opts && opts.enabled);
  if (!enabled) return;

  captureDir = path.join(app.getPath('userData'), 'captures');
  try { fs.mkdirSync(captureDir, { recursive: true }); } catch (e) {}

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  jsonlStream = fs.createWriteStream(path.join(captureDir, `http-${stamp}.jsonl`), { flags: 'a' });

  // 与标签机制解耦：任何新建的 webContents 都尝试挂载
  app.on('web-contents-created', (e, wc) => attach(wc));
  webContents.getAllWebContents().forEach(attach);
}

function shouldCapture(wc) {
  try {
    const t = wc.getType(); // 'webview' | 'browserView' | 'window' | 'backgroundPage' ...
    if (t === 'webview' || t === 'browserView') return true;
    return /huoying\.qq\.com|ptlogin2\.qq\.com/.test(wc.getURL() || '');
  } catch (e) { return false; }
}

function writeLine(obj) {
  if (!jsonlStream) return;
  try { jsonlStream.write(JSON.stringify(obj) + '\n'); } catch (e) {}
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
  wc.debugger.on('detach', () => { attached.delete(wc); });

  writeLine({ type: 'attach', label, url: safeUrl(wc) });
}

function safeUrl(wc) { try { return wc.getURL(); } catch (e) { return ''; } }

async function handleCdp(label, method, params, wc) {
  switch (method) {
    case 'Network.requestWillBeSent':
      writeLine({ type: 'req', label, id: params.requestId, url: params.request.url,
        method: params.request.method, headers: params.request.headers,
        postData: params.request.postData || null, ts: params.wallTime || params.timestamp });
      break;

    case 'Network.responseReceived':
      writeLine({ type: 'res', label, id: params.requestId, url: params.response.url,
        status: params.response.status, mime: params.response.mimeType,
        headers: params.response.headers });
      break;

    case 'Network.loadingFinished': {
      let body = null, base64 = false;
      try {
        const r = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        body = r.body; base64 = r.base64Encoded;
      } catch (e) { /* 响应体可能已被回收，忽略 */ }
      writeLine({ type: 'body', label, id: params.requestId, base64,
        len: body ? body.length : 0, body });
      break;
    }

    case 'Network.webSocketCreated':
      writeLine({ type: 'ws-open', label, id: params.requestId, url: params.url });
      break;
    case 'Network.webSocketFrameSent':
      writeLine({ type: 'ws-sent', label, id: params.requestId,
        opcode: params.response.opcode, payload: params.response.payloadData });
      break;
    case 'Network.webSocketFrameReceived':
      writeLine({ type: 'ws-recv', label, id: params.requestId,
        opcode: params.response.opcode, payload: params.response.payloadData });
      break;
  }
}

module.exports = { initCapture, isCaptureEnabled, getCaptureDir };
```

#### 3.5.2 `main.js` 修改点

**a) 顶部引入 + net-log 开关**（放在现有 Flash 开关区块之后，`main.js:916` 附近）：

```js
const capture = require('./capture');
// ... CAPTURE_ENABLED 判定见 3.1 ...

if (CAPTURE_ENABLED) {
  const capDir = path.join(app.getPath('userData'), 'captures');
  try { fs.mkdirSync(capDir, { recursive: true }); } catch (e) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  app.commandLine.appendSwitch('log-net-log', path.join(capDir, `netlog-${stamp}.json`));
  app.commandLine.appendSwitch('net-log-capture-mode', 'IncludeSensitive');
}
```

**b) `app.whenReady()` 内**（`main.js:2379` 之后、创建窗口之前）：

```js
capture.initCapture({ enabled: CAPTURE_ENABLED });
if (CAPTURE_ENABLED) log('[capture] 抓包已开启，输出目录: ' + capture.getCaptureDir());
```

> 注意：`--log-net-log` 是**全局**开关，会记录整个应用（含自动更新请求）。分析时需按 host 过滤，见 3.5.3。

#### 3.5.3 新增 `tools/analyze-capture.js`（离线分析）

Node 脚本，读取 `http-*.jsonl`，输出：
- 按 host 聚合的请求数量、方法分布
- 按 URL path 聚合，标出**响应体较大**或**含关键词**的端点
- 关键词检索：`组织`、`成员`、`活动`、`member`、`guild`、`org`、`activity`、`rank`
- 提取所有 WebSocket 帧并打印首尾片段

```js
// tools/analyze-capture.js  —— 用法: node tools/analyze-capture.js <captures/http-xxx.jsonl>
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const byHost = {};
const bodies = [];
for (const ev of lines) {
  if (ev.type === 'req') {
    let host = '?'; try { host = new URL(ev.url).host; } catch {}
    byHost[host] = byHost[host] || { count: 0, urls: new Set() };
    byHost[host].count++;
    byHost[host].urls.add(ev.url.split('?')[0]);
  }
  if (ev.type === 'body' && ev.body) bodies.push(ev);
  if (ev.type.startsWith('ws-')) console.log('[WS]', ev.type, String(ev.payload).slice(0, 200));
}

console.log('\n=== 按 Host 汇总 ===');
for (const [h, v] of Object.entries(byHost)) console.log(`${v.count}\t${h}`);

console.log('\n=== 大响应体 Top10（疑似业务数据）===');
bodies.sort((a, b) => b.len - a.len).slice(0, 10).forEach(b => {
  console.log(`len=${b.len} id=${b.id} head=${String(b.body).slice(0, 120)}`);
});

const KW = /组织|成员|活动|member|guild|org|activity|rank/i;
console.log('\n=== 关键词命中 ===');
for (const ev of lines) {
  const s = JSON.stringify(ev);
  if (KW.test(s)) console.log(ev.type, ev.url || ev.id, String(s).slice(0, 200));
}
```

#### 3.5.4 新增 `tools/extract-socket-bytes.js`（原始 TCP 字节提取）

net-log 是一大坨 JSON，手翻困难。该脚本解析 net-log，提取所有 socket 收发事件，按连接重建为二进制流：

- 从 `constants.logEventTypes` 反查事件名，识别 `SOCKET_BYTES_SENT/RECEIVED`、`SSL_SOCKET_BYTES_*`
- 从 `TCP_CONNECT` 等事件提取 `address`（定位游戏服务器 IP:端口）
- 按 `source.id` + 方向分组，`Buffer.concat` 重建，输出 `sockets/<srcId>-<rx|tx>.bin`
- 打印每条流的字节数、hex 预览、ascii 预览

```js
// tools/extract-socket-bytes.js —— 用法: node tools/extract-socket-bytes.js <captures/netlog-xxx.json> [输出目录]
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('用法: node tools/extract-socket-bytes.js <netlog.json> [输出目录]'); process.exit(1); }
const outDir = process.argv[3] || path.join(path.dirname(file), 'sockets');
const log = JSON.parse(fs.readFileSync(file, 'utf8'));

const nameOfType = {}, nameOfSource = {};
for (const [n, v] of Object.entries((log.constants && log.constants.logEventTypes) || {})) nameOfType[v] = n;
for (const [n, v] of Object.entries((log.constants && log.constants.logSourceType) || {})) nameOfSource[v] = n;

const BYTE_EVENTS = new Set(['SOCKET_BYTES_SENT', 'SOCKET_BYTES_RECEIVED', 'SSL_SOCKET_BYTES_SENT', 'SSL_SOCKET_BYTES_RECEIVED']);
const CONNECT_EVENTS = new Set(['TCP_CONNECT', 'SSL_CONNECT', 'SOCKET_CONNECT']);
const streams = {}, connInfo = {};

for (const ev of log.events || []) {
  const tname = nameOfType[ev.type];
  if (!tname) continue;
  const srcId = ev.source && ev.source.id;
  if (CONNECT_EVENTS.has(tname) && ev.params && ev.params.address) connInfo[srcId] = ev.params.address;
  if (BYTE_EVENTS.has(tname)) {
    const hexRaw = ev.params && ev.params.bytes;
    if (typeof hexRaw !== 'string') continue;
    const clean = hexRaw.replace(/[^0-9a-fA-F]/g, '');
    if (!clean.length || clean.length % 2) continue;
    const dir = tname.indexOf('RECEIVED') >= 0 ? 'rx' : 'tx';
    (streams[`${srcId}-${dir}`] = streams[`${srcId}-${dir}`] || []).push(Buffer.from(clean, 'hex'));
  }
}

if (!Object.keys(streams).length) {
  console.error('未发现 socket 字节事件，请确认使用 --net-log-capture-mode=IncludeSocketBytes');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
for (const key of Object.keys(streams)) {
  const buf = Buffer.concat(streams[key]);
  fs.writeFileSync(path.join(outDir, `${key}.bin`), buf);
  console.log(`${key}  ${buf.length} 字节  hex: ${buf.slice(0, 32).toString('hex')}`);
}
console.log('输出目录: ' + outDir);
```

**实测现象**：在 devtools Network 看不到请求 ⇒ 原始 TCP ⇒ 用本脚本提取字节后再判断是否加密/压缩。

### 3.6 边界条件与异常处理

| 场景 | 处理 |
|---|---|
| `--capture-traffic` 未开启 | `initCapture` 直接 return，`capture.js` 零副作用，不影响正常用户 |
| debugger 附加失败（已被占用/已附加） | 记录 `attach-error`，不抛出；webRequest 兜底通道仍可用 |
| `getResponseBody` 报错（响应体已回收） | try/catch 忽略，仅缺该条 body |
| net-log 文件过大 | 通过 host 过滤分析；文档提示仅在探测期开启 |
| 磁盘写入失败 | `writeLine` try/catch 吞掉，绝不影响游戏运行 |
| 多标签/多窗口 | 每个 webContents 独立 `label`，事件带 `label` 字段区分 |
| `new Date()` 时间戳 | 用于文件名，仅本地 |

### 3.7 数据流

```
游戏页(Flash) ──HTTP/WS──▶ Chromium 网络栈 ──┬─▶ CDP Network 域 ──▶ http-*.jsonl (req/res/body/ws)
                                              └─▶ net-log ─────────▶ netlog-*.json
                                                        │
                                          tools/analyze-capture.js ──▶ 端点清单 + 关键词命中
```

### 3.8 预期结果

开启抓包后正常游玩，在游戏内**打开组织成员列表**和**查看本周活动**，即可在 `captures/` 得到：
1. 一份能判定协议类型的 net-log；
2. 一份含请求/响应体/WS 帧的 jsonl；
3. 分析脚本输出的可疑端点列表。

据此可确定阶段二的解码目标。

---

## 4. 阶段二：协议解析（探测结果已确认）

### 4.1 阶段一探测结论（实测，2026-10-12）

| 项 | 结论 |
|---|---|
| 游戏服务器 | `zone.huoying.qq.com` → `101.226.142.64:11096`（**明文 TCP，无 TLS**） |
| 辅助连接 | `zone.huoying.qq.com:843`（Flash socket 策略文件端口，仅 23/207 字节） |
| HTTP 通道 | 只有资源（`res.huoying.qq.com`）+ 埋点（`pingfore`/`galileotelemetry`/`ams.game.qq.com`），**无业务数据**；WS 帧为 0 |
| 是否加密 | **握手/登录载荷是明文 Protobuf；登录后业务载荷被加密**（见 4.3） |

### 4.2 分帧协议（已完全解析）

`tools/parse-frames.js` 可无损拆分（122 tx 帧 / 213 rx 帧，0 重同步）：

```
[0..1]   09 01         magic
[2..3]   u16BE         载荷长度
[4..5]   u16BE         命令字段 A
[6..7]   u16BE         命令字段 B
[8..11]  u32BE         序号（客户端自增；服务端推送为 0）
[12..15] u32BE         标志：1=握手, 2=载荷加密, 3=载荷明文
[24..27]              连接/会话标识（整场固定，如 b45b035d）
[28..31] u32BE         常量（实测 1098）
[36..]                 载荷
```

**载荷为 Protobuf**（field number + wire type 结构可直接识别）。明文示例：
- `08 8a 95 06 12 05 31 30 30 30 31 1a 06 71 71 67 61 6d 65` → `{f1: 10001, f2: "10001", f3: "qqgame"}`
- `0a 0b 08 00 12 07 73 75 63 63 65 73 73` → `{f1: {f1: 0, f2: "success"}}`

### 4.3 加密（阶段二的核心障碍）

`flag=2` 的载荷为高熵密文，块长度为 8 的倍数（16/24/32/40/48…），**疑似分组密码（XXTEA/TEA 类）**，密钥来自握手阶段（seq 3-4 的 16 字节块）。
`flag=3` 的服务端推送（如聊天/系统通知）为明文 Protobuf。

**因此：要拿到组织成员/捐献/活动次数，必须先解密。** 可行路径：

| 路径 | 说明 | 成本 |
|---|---|---|
| **A. 反编译 SWF**（推荐） | 从 `res.huoying.qq.com/NarutoBeta6.38Build302/` 取主 SWF，用 JPEXS FFDec 反编译，定位 `flash.net.Socket` 的读写与加解密/密钥协商逻辑 | 中 |
| B. 网卡层全量抓包 | npcap + Wireshark 抓 `11096` 端口，作为 netlog 的交叉验证（netlog 已无截断，非必需） | 低 |
| C. Flash 层 hook | 改 SWF / 用 preloader 包裹 `flash.net.Socket`，直接拿明文 | 高 |

### 4.5 游戏 SWF 本身是加密的（新增障碍）

尝试反编译时发现：

- 游戏核心 SWF 来自 `res.huoying.qq.com/<版本>/flash/core/naruto.{core,ui,exui,include}.swf`。
- 它们以 `ZWS` 开头，但 **LZMA 头非法**（props 字节 `0xfa`、dict 极大），标准 LZMA 无法解压 → **说明内容被加密，不是纯 LZMA**。
- 加载器 **`entry.swf`**（`.../NarutoBeta11.33Build304/entry.swf`，CWS 明文，可解）包含关键符号：
  - `decryptSWF`、`KeyFileLoader` / `checkKeyFileLoader` / `initKeyFileLoader`
  - `CompressionAlgorithm`、`LZMA`、`uncompress`
  - `resource.cfg`（以 BINARY 加载）、`readUnsignedInt` / `readObject` / `readMultiByte`
  - `xmlsocket://` + `port` + `loadPolicyFile`（对应 843 策略端口）
  - `report.huoying.qq.com/fcgi-bin/oss_report.fcgi?uin=...&role_id=0&svr_id=...`
- 密钥文件：**`https://res.huoying.qq.com/NarutoBeta11.33Build304/resource.cfg`**（782724 B）。

**结论**：`entry.swf` 用 `resource.cfg` 里的信息 `decryptSWF` 解密核心 SWF，再 `LZMA uncompress` 加载。

### 4.6 下一步（阶段二续）

1. 下载 `resource.cfg`，解析其结构（SWF 清单 + 密钥/偏移）。
2. 用 **JPEXS FFDec** 反编译 `entry.swf`（已解出明文 CWS，见 `_swf/…fws.swf`），定位 `decryptSWF` 与 `KeyFileLoader` 的实现，得到解密算法与密钥。
3. 解密 `naruto.core.swf` / `naruto.include.swf` → 反编译 → 找到 TCP 协议的加密/序列化代码。
4. 用第 3 步的算法解密 4.3 中的业务载荷，提取组织成员/捐献/活动次数。

> 工具：`tools/swf_extract.py`（解 FWS/CWS/ZWS + 提取字符串）、`tools/carve-swf.js`（从缓存提取 SWF）、`tools/swf-strings.js`（Node 版字符串提取）。

### 4.4 目标产物

解密后按 4.2 分帧 + Protobuf 解码，提取为：

```json
{ "guildMembers": [{ "name": "", "level": 0, "power": 0, "title": "" }],
  "weeklyActivity": [{ "name": "", "count": 0 }] }
```

（字段名以解密后的实际内容为准；需先定位对应命令字段 A/B 与 Protobuf 字段号。）

### 4.7 反编译确认（2026-10-12 续，重大进展）

**1) SWF 加密已破解**

- `entry.swf` 的 `util.decryptSWF`（FFDec 反编译所得）是**字节重排**而非真加密：校验 `ZWS`+version0+len0xFFFFFFFF → 取其后 11 字节按奇偶拆成 A(6)/B(5) → 3 字节(A 两两低半字节拼)+B(5) → 再对后 128 字节按奇偶 `~` → 其余原样。
- 已实现 `tools/decrypt_swf.py`，实测**成功**解密并解压 4 个核心 SWF：
  - `naruto.core.swf` → 512805 B
  - `naruto.ui.swf` → 1251407 B
  - `naruto.exui.swf` → 2769990 B
  - `naruto.include.swf` → 9512503 B
- 真实格式：`ZWS` + version + 长度 + **4 字节压缩长度** + LZMA props(0x5D, dict 8MB) + 数据。

**2) 协议头已由 AS3 源码完全确认**（`include/scripts/server/SocketProtocol.as` 的 `data` getter，大端）：

| 偏移 | 类型 | 含义 |
|---|---|---|
| 0-1 | u16 | magic `2305` (0x0901) |
| 2-3 | u16 | 载荷长度 |
| 4-7 | u32 | **commandId 命令号** |
| 8-11 | u32 | index 序号 |
| 12-15 | u32 | type（客户端恒为 1；服务端 2/3） |
| 16-23 | double | 0 |
| 24-27 | u32 | selfuin（账号 uin，实测 `b45b035d`） |
| 28-29 | u16 | selfRole |
| 30-31 | u16 | ser_id（实测 1098） |
| 32-35 | u32 | 0 |
| 36- | bytes | Protobuf 载荷 |

**3) 关键命令号已定位**（`include/scripts/def/ProtocolCmdDef.as`）：

| 常量 | 值 | 含义 |
|---|---|---|
| `CMD_GUILD_MEMBER_LIST_QUERY` | 199179 | **组织成员名单**（wire `f4=3,f6=0x0A0B`，响应 10920/21312 字节） |
| `CMD_GUILD_DONATE_QUERY` | 199184 | **组织捐献查询**（响应 21312 字节） |
| `CMD_GUILD_DONATE` | 199185 | 组织捐献 |
| `CMD_GUILD_MEMBER_REMOVE` / `_IDENTITY` | 199180 / 199181 | 成员移除 / 身份 |

**4) 载荷确认加密**：`cmd 199179/199184` 载荷熵 ≈ 7.98–7.99（满值 8），zlib/LZMA 均解不开 → **真加密，非压缩**。协议内 `ProtoGetEncryptListResponse{ret, is_encrypt, exception_cmd[]}` 由服务端下发是否加密及例外命令号；`ISocketServer.addIgnoreEncryptProto(cmd)` 对应之。

**5) 剩余障碍与定位**：加密算法位于 socket server 实现（插件名 `server.INarutoServer`）。已反编译的 core/ui/exui/include/entry **均无** `flash.net.Socket` 用法，缓存 264 个插件 SWF 也未命中。

通过下载并解压 `flash/core/PluginConfig.xml`（zlib）得到**完整插件清单**，确认：
```xml
<autorun><plugin interface="server.INarutoServer"/> ...</autorun>
<plugin><name>通信插件</name><interface>server.INarutoServer</interface>
        <def>flash/server/ServerConfig.xml</def></plugin>
```
即网络插件由 **`flash/server/ServerConfig.xml`** 定义（该文件再指向真正的 server SWF）。该 ServerConfig.xml 与 server SWF **均未出现在本次抓包流量中**，且按已知版本目录探测均 404 → 需解析 `<def>` 的 URL 基准，或**从 App 启动即开始抓包**以捕获其加载。

**下一步候选**：① 解析 `<def>` 路径的基准（读 `NarutoAssetsLoader.as`/`NarutoStartUp.as` 的插件加载逻辑）；② 抓取 App 完整启动过程；③ 解密 `resource.cfg` 清单定位文件。

**下一步候选**：① 从 App 启动即开始抓包，覆盖完整插件加载序列；② 反编译 `GuildPlugin.swf`/`GvgPlugin.swf` 等业务插件，结合 `serverProto` 消息类确定字段；③ 分析握手阶段 16 字节密钥交换帧（TX seq3/4、RX seq2）。

## 5. 阶段三：导出与 UI（概要，待阶段一确认）

- 导出 `guild-members.csv` / `weekly-activity.csv`
- 启动器内嵌 HTML 增加"统计"入口，展示成员表格与活动次数排行
- 复用现有主题系统（`getThemeColors`）

---

## 6. 验证方法

1. `npm start -- --capture-traffic`（或设 `NARUTO_CAPTURE=1`）
2. 确认控制台出现 `[capture] 抓包已开启`
3. 进入游戏 → 打开组织成员名单 → 打开本周活动页面
4. 关闭应用，检查 `%APPDATA%/naruto-online-launcher/captures/` 下生成 `netlog-*.json` 与 `http-*.jsonl`
5. 运行 `node tools/analyze-capture.js <jsonl 路径>`，查看端点汇总与关键词命中
6. 运行 `node tools/extract-socket-bytes.js <netlog 路径>`，提取 socket 原始字节并查看连接地址与 hex 预览
7. net-log 可用 Chromium 官方 netlog-viewer 打开，确认是否存在 socket 级（原始 TCP）连接

## 7. 风险与备选方案

| 风险 | 备选 |
|---|---|
| net-log 未捕获到 Flash 原始 socket 载荷 | 安装 npcap + Wireshark 直接抓包（已有管理员权限）；或编写 winsock hook DLL（需 MSVC 工具链） |
| 协议加密/混淆 | 需结合 Flash 反编译（如 JPEXS）分析 AS 代码中的加解密逻辑 |
| 响应体被回收拿不到 | 增大 CDP buffer（已配置 100MB），或在 `loadingFinished` 前抓取 |
| 数据量过大 | 仅探测期开启；按 host 过滤 |

## 8. 合规提示

抓包/解包仅用于**用户本人账号**的游戏数据统计，不得用于自动化操作、篡改游戏数据或侵犯他人隐私。
