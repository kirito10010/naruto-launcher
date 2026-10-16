# 抓包双模式：组织统计（Excel） / 全量抓包（原始文件）

> 需求：把抓包拆成两个**互不耦合**的模式——
> ① 组织统计抓包（现有功能，退出后生成 6 张 Excel）
> ② 全量数据抓包（导出原始抓包文件，供以后深度分析；**这个功能以后可能会删掉**）

---

## 一、现状

| 环节 | 位置 | 说明 |
|------|------|------|
| 开关 | `config.captureEnabled`（布尔） | 单一开关 |
| net-log | `main.js:1048` 设置 `log-net-log` + `net-log-capture-mode=IncludeSocketBytes` | Chromium 原始网络日志（含 socket 原始字节） |
| CDP 抓包 | `capture.js` → `userData/captures/http-*.jsonl` | HTTP 请求/响应/响应体 + WebSocket 帧 |
| 退出导出 | `before-quit` → spawn `--export <pid>` → `export.js` | 解析 **net-log** → 生成 6 张 Excel 到桌面 |

**关键发现**：`export.js` 只解析 **net-log**，**完全不依赖 CDP 的 jsonl**。也就是说：
- "组织统计"其实只需要 net-log；
- CDP 的 jsonl 目前是"顺手抓的"，只有分析用途。

→ 这正好可以把两个模式干净地切开。

---

## 二、模式模型

把布尔开关换成三态 `config.captureMode`：

| 值 | 含义 | 抓什么 | 退出时做什么 |
|----|------|--------|--------------|
| `off` | 关闭（默认） | 不抓 | 无 |
| `stats` | **组织统计** | net-log | `--export` → 生成 6 张 Excel（现有行为） |
| `full` | **全量抓包** | net-log + CDP jsonl | `--dump-capture` → 导出原始文件（新功能） |

**向后兼容**：老配置只有 `captureEnabled: true` 时，归一化为 `stats`。

### 为什么 stats 不再跑 CDP

`export.js` 不读 jsonl，所以 stats 模式下关掉 CDP 层：
- 少一份 JSONL 落盘 + 少一套 CDP 缓冲 → **开销更低**（与之前的性能优化方向一致）；
- 让"CDP 抓包"完全归属 `full` 模式 → **两个模式彻底解耦**。

---

## 三、解耦设计（为了"以后能干净删掉全量抓包"）

**全量抓包 = 一个独立模块 + 少量带标记的接入点。**

| 组成 | 归属 | 删除时 |
|------|------|--------|
| `capture-dump.js`（新增） | 全量抓包专属 | 整个文件删掉 |
| `main.js` 里 `--dump-capture` 分支 | 全量抓包专属 | 删掉该 if 块 |
| `main.js` 里 `before-quit` 的 `full` 分支 | 全量抓包专属 | 删掉该 if 块 |
| 设置面板的 `full` 选项 | 全量抓包专属 | 删掉该 option |
| `capture.js`（CDP 层） | 只有 full 模式用 | 可一并删掉 |
| net-log 开关 | **两者共用** | 保留（stats 还要用） |
| `export.js` / `xlsx.js` | stats 专属 | 不动 |

> 所有全量抓包相关的接入点都会加 `// [全量抓包]` 注释标记，方便日后一次搜出来删干净。
> `export.js` / `xlsx.js` **完全不碰**，所以删全量抓包不会影响组织统计。

---

## 四、具体设计

### 4.1 `main.js`

```js
// 抓包模式：off / stats（组织统计）/ full（全量抓包）
function normalizeCaptureMode(v) {
  if (v === 'full' || v === 'stats' || v === 'off') return v;
  return v === true ? 'stats' : 'off';          // 兼容老的 captureEnabled: true
}
const CAPTURE_MODE =
  process.argv.includes('--capture-full') ? 'full' :
  (process.argv.includes('--capture-traffic') || process.env.NARUTO_CAPTURE === '1') ? 'stats' :
  normalizeCaptureMode(EARLY_CONFIG.captureMode !== undefined
    ? EARLY_CONFIG.captureMode
    : EARLY_CONFIG.captureEnabled);
```

- net-log 开关：`if (CAPTURE_MODE !== 'off') { ... }`（**共用**，不变）
- CDP 初始化：`if (CAPTURE_MODE === 'full') capture.initCapture({ enabled: true })`  // [全量抓包]
- `before-quit`：
  ```js
  if (CAPTURE_MODE === 'stats') { spawn(process.execPath, ['--export', String(process.pid)], {...}) }
  // [全量抓包]
  else if (CAPTURE_MODE === 'full') { spawn(process.execPath, ['--dump-capture', String(process.pid)], {...}) }
  ```
- 子进程入口（必须在单实例锁之前）：
  ```js
  // [全量抓包]
  if (process.argv.includes('--dump-capture')) {
    const pid = parseInt(process.argv[process.argv.indexOf('--dump-capture') + 1], 10) || 0;
    app.whenReady()
      .then(() => require('./capture-dump').runDump({ mainPid: pid }))
      .catch((e) => { /* 写 capture-dump-error.log */ })
      .finally(() => app.quit());
    return;
  }
  ```
- IPC：`set-capture`（布尔）→ `set-capture-mode`（字符串），存 `config.captureMode`，提示重启
- `did-finish-load` 下发 `capture-mode-state`

### 4.2 `capture-dump.js`（新增，全量抓包专属）

```js
async function runDump({ mainPid }) {
  // 1) 等主进程退出（netlog/jsonl 写完整）
  // 2) 从 userData/captures 取本次会话的文件：
  //    - 最新的 netlog-*.json
  //    - mtime >= netlog 创建时间的 http-*.jsonl（本次会话的）
  // 3) 复制到 桌面/火影全量抓包/<yyyy-MM-dd_HHmmss>/
  // 4) 写 说明.txt（各文件是什么、怎么分析、命令号参考）
  // 5) shell.openPath 打开目录
}
module.exports = { runDump };
```

输出目录结构：
```
桌面\火影全量抓包\2026-10-16_11-30-00\
├── netlog-2026-10-16T03-30-00-000Z.json     ← Chromium 全量网络日志（含 socket 原始字节，base64）
├── http-2026-10-16T03-30-00-000Z.jsonl      ← CDP 抓的 HTTP/WS 事件（含请求/响应/响应体）
└── 说明.txt                                  ← 两个文件是什么、怎么用
```

### 4.3 设置面板 UI

把现在的「抓包模式」开关换成三选一：

```
抓包模式
[ 关闭 ▾ ]        ← 关闭 / 组织统计（生成 Excel）/ 全量抓包（导出原始文件）
切换后需重启
```

- 选「组织统计」→ 下方显示现有的「组织统计抓包说明」（5 步流程）
- 选「全量抓包」→ 显示一行说明：**记录全部网络数据（含原始字节）到文件，不生成 Excel；退出后导出到桌面「火影全量抓包」**

### 4.4 `package.json`

`build.files` 增加 `"capture-dump.js"`（否则打包后缺文件——历史踩坑点）。

---

## 五、边界与异常

| 场景 | 处理 |
|------|------|
| 老配置 `captureEnabled: true` | 归一化为 `stats`，行为不变 |
| 全量抓包未产生 jsonl（没开过游戏） | 只导出 net-log，说明里注明 |
| 主进程被强杀 | 与现有导出一样：子进程等 pid 退出（最多 5 分钟），文件可能不完整 |
| 抓包文件很大（net-log 可能上百 MB） | 只做**复制**不移动，保留原文件；说明里标注体积 |
| 全量抓包模式下忘了关 | 设置面板会明确显示当前模式；不做自动重置（与统计模式保持一致） |
| 两个模式同时选 | 不可能（单选） |
| `capture-dump.js` 缺失（老包） | 子进程 require 失败 → 写 `capture-dump-error.log`，不影响主流程 |

---

## 六、验收

1. 设置面板显示三选一；选「组织统计」并重启 → 退出后仍生成 6 张 Excel（行为与之前一致）。
2. 选「全量抓包」并重启 → 退出后在桌面「火影全量抓包/<时间>/」拿到 net-log + jsonl + 说明.txt，**不生成 Excel**。
3. 切回「关闭」并重启 → 不抓包，无导出。
4. 全量抓包模式下 `captures/http-*.jsonl` 有内容；组织统计模式下**不再产生** jsonl（CDP 未启用）。
5. `node --check` 通过；打包 1.2.0 成功且 asar 内含 `capture-dump.js`。

---

## 七、不做的事

- 不改 `export.js` / `xlsx.js`（组织统计链路完全不动）
- 不做自动重置模式（保持一致；需要的话再加）
- 不在主界面加"两个一键启动按钮"（保持启动器简约）。如果你希望点一下就"切模式+重启+进游戏"，告诉我，我再加。
