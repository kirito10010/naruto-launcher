# 火影忍者Online启动器 —— 流畅度优化方案

## 1. 背景与目标

用户反馈启动器运行“不够流畅”，希望找到优化办法。

本项目是基于 **Electron 11.5.0 + PPAPI Flash** 的页游启动器：
- 启动器窗口（内联 HTML）
- 游戏窗口加载 `game.html`，用 `<webview>` 嵌入 `https://huoying.qq.com/`（Flash 页游）
- 通过 `speedctl.exe` / `speedhook.dll` 做 DLL 注入实现游戏变速（0.5x~20x）
- 支持多开（多窗口 + 多账号标签页）

**关键约束**：Flash（PPAPI 插件）在 Chromium 88 / Electron 12 起被移除，因此**无法升级 Electron 版本**，所有优化必须在 Electron 11 内完成。

优化目标（按优先级）：
1. 消除导致 CPU/GPU 满载、画面撕裂的“反向优化”启动参数（流畅度最大头）
2. 消除每次加载/变速时的 PowerShell 进程扫描开销（CPU 尖峰）
3. 消除启动时的同步阻塞清理
4. 降低多开/后台标签页的无谓资源占用

---

## 2. 需求场景与处理逻辑

### 需求 A：修正命令行启动参数（核心，低风险高收益）

**场景**：当前 `main.js` 启动时附加了 4 个对流畅度有害的开关，导致渲染进程无上限帧率渲染。

**问题定位**（`main.js:907-919`）：
- `ignore-gpu-blacklist`：强制在驱动不支持的机器上启用 GPU，可能引发渲染异常/卡顿
- `disable-frame-rate-limit`：取消帧率上限，FPS 无限制
- `disable-gpu-vsync`：关闭垂直同步，画面撕裂 + GPU 满载
- `enable-features=CanvasOopRasterization`：实验性 OOP 光栅化，增加进程开销

Flash 页游原生帧率仅约 24~30 帧，以上开关导致渲染进程“无上限渲染”，多开时互相抢 CPU/GPU，是卡顿的直接来源。

**处理逻辑**：删除这 4 个有害开关，保留其余必要开关（`no-sandbox` 是 DLL 注入所必需，`ppapi-flash-*` 是 Flash 所必需，均保留）。

### 需求 B：用 `app.getAppMetrics()` 替代 PowerShell 进程扫描（消除 CPU 尖峰）

**场景**：`getAllChildProcessesRecursive()` 每次 spawn `powershell.exe Get-CimInstance` 递归扫描子进程，成本极高（数百 ms~数秒）。它在以下时机被触发：
- 每个 tab 的 `did-finish-load`
- 每次变速（`setSpeedRate` → `injectAllChildProcesses`）
- Win11 的二次注入 `secondPass`

多开（多账号）时被调用 N 次，是运行期 CPU 尖峰的主要来源。

**处理逻辑**：Electron 自带 `app.getAppMetrics()` 直接返回本应用全部进程的 `{ pid, type }` 列表（`type` 含 `Renderer` / `GPU` / `Plugin` / `Utility` 等），无需 spawn 外部进程。用它替换 `getAllChildProcessesRecursive`。

### 需求 C：启动清理异步化 / 延迟执行（消除启动阻塞）

**场景**：`performStartupCleanup()` 用大量同步 IO（`readdirSync`/`statSync`/`unlinkSync`）在启动时阻塞主进程，导致启动卡顿。

**处理逻辑**：将 `performStartupCleanup()` 改为 `setTimeout` 延迟执行（如 3 秒后），且仅当没有游戏窗口在运行时执行，避免与游戏抢占 IO。

### 需求 D：后台标签页降低资源占用

**场景**：多开时隐藏的标签页仍以 `display:none` 方式保留 Flash 实例，可能继续渲染。

**处理逻辑**：保持现有 `backgroundThrottling: true`，在窗口失焦/最小化/切换标签时对非活动 webview 静音（已有部分逻辑），并确保切换隐藏标签时统一调用静音。此需求为次要，低风险小改。

---

## 3. 架构与技术方案

### 3.1 受影响文件

| 文件 | 修改类型 | 涉及函数/位置 |
|------|----------|----------------|
| `main.js` | 修改 | 命令行开关区（907-919 行） |
| `main.js` | 修改 | `getAllChildProcessesRecursive`（793-837 行） |
| `main.js` | 修改 | `injectAllChildProcesses` / `secondPass`（842-881 行） |
| `main.js` | 修改 | `performStartupCleanup`（573-583 行）及 `app.whenReady` 调用处（2294 行） |
| `game.html` | 修改（次要） | `switchTab` / `window-blur` / `window-minimized` 静音逻辑 |

### 3.2 详细实现

#### A. 命令行开关

当前代码（`main.js:907-919`）：

```js
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('no-sandbox');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-fast-startup');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
```

改为（删除 4 个有害开关）：

```js
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('no-sandbox');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('enable-fast-startup');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
```

> `no-sandbox` 必须保留：DLL 注入（speedhook）与 Flash PPAPI 都需要关闭沙箱。

#### B. 进程扫描替换

新增函数，替换 `getAllChildProcessesRecursive`：

```js
function getAllRelevantChildPids() {
  try {
    const metrics = app.getAppMetrics(); // 返回 [{ pid, type, ... }]
    const relevantTypes = new Set([
      'renderer', 'tab', 'gpu', 'plugin', 'utility',
      'ppapi plugin', 'pepper plugin', 'pepper plugin broker'
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
```

`injectAllChildProcesses` 与 `secondPass` 改为调用 `getAllRelevantChildPids()`（不再 `await`，因为它是同步的）：

```js
async function injectAllChildProcesses() {
  const now = Date.now();
  if (now - lastInjectTime < INJECT_COOLDOWN) return;
  lastInjectTime = now;

  try {
    const childPids = getAllRelevantChildPids();
    for (const pid of childPids) {
      if (!injectedPids.has(pid)) injectSpeedHook(pid);
    }
    if (isWindows11) setTimeout(secondPass, 2000);
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
```

删除不再使用的 `getAllChildProcessesRecursive`（含其中的 `exec`/`powershell` 逻辑）。

#### C. 启动清理延迟执行

`app.whenReady` 内（`main.js:2294`）将：

```js
performStartupCleanup();
```

改为：

```js
setTimeout(() => {
  if (gameWindows.length === 0) {
    performStartupCleanup();
  }
}, 3000);
```

#### D. 后台标签页静音（次要，game.html）

`switchTab` 中切换标签时，对隐藏的 webview 统一静音（当前仅在新标签激活时对 `nextTab` 处理静音，`prevTab` 未处理）：

```js
if (prevTab && prevTab._webview) {
  prevTab._webview.classList.add('hidden');
  try { prevTab._webview.setAudioMuted(true); } catch (e) {}
}
```

---

## 4. 数据流路径

- 游戏加载完成 → `did-finish-load` → `injectAllChildProcesses` → `app.getAppMetrics()` 取 PID → `injectSpeedHook`（原 PowerShell 扫描路径被替换）
- 变速 → `setSpeedRate` → `updateNativeRate` + `injectAllChildProcesses`（同上）
- 启动 → `setTimeout(performStartupCleanup)`（延迟 3s，且无游戏窗口才执行）

---

## 5. 边界条件与异常处理

- `app.getAppMetrics()` 在打包/开发环境均可用；若返回空或抛异常，`getAllRelevantChildPids` 返回 `[]`，行为退化为“本轮不注入”，不影响启动器正常运行。
- `injectedPids` 已按 PID 去重，`INJECT_COOLDOWN=5000` 冷却保留，避免频繁注入。
- 删除 `ignore-gpu-blacklist` 后，部分老旧驱动机器可能回退到软件渲染，Flash 画面可能略微变慢；这是“避免崩溃/卡顿”的正确取舍，绝大多数现代机器 GPU 加速默认开启。
- `no-sandbox`、`ppapi-flash-*` 保留，确保 Flash 与变速 DLL 注入不受影响。
- 启动清理延迟执行需判断 `gameWindows.length === 0`，避免清理与游戏争抢磁盘 IO。

---

## 6. 预期结果

- 画面不再撕裂、FPS 有上限，CPU/GPU 占用明显下降，多开时卡顿显著缓解（需求 A）
- 加载/变速不再产生 PowerShell 进程尖峰（需求 B）
- 启动更顺滑（需求 C）
- 后台标签页不再播放音频、减少资源占用（需求 D）
