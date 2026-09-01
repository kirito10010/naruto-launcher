# 修复长时间全屏游玩后关闭/刷新白屏

## 1. 需求场景与处理逻辑

**场景**：用户全屏玩火影忍者Online（Flash PPAPI 游戏）一段时间后，关闭游戏窗口再打开，或者点击"刷新"，页面持续白屏，无法恢复。玩的时间越久越容易复现。

**用户判断**：怀疑是某个进程没被关掉（僵尸进程）。

**结论**：用户判断正确。根因是 Flash 插件进程（`pepflashplayer` / PPAPI Plugin 进程）在长时间全屏后挂起/损坏，而关闭窗口和刷新都没有真正终止该进程，导致新实例拿不到干净的渲染表面。

**处理逻辑**：
- 关闭游戏窗口 → 强杀残留的 Flash 插件进程，保证下次开窗口是全新 Flash。
- 刷新 → 先杀掉 Flash 插件进程触发冷启动，再用兜底重载保证恢复。

## 2. 架构与技术方案

复用现有架构：
- `app.getAppMetrics()` 已在 `getAllRelevantChildPids()`（main.js:793）和 `getMemoryMB()`（main.js:1647）中使用，用于扫描 Electron 子进程（含 `pepper plugin` 类型），无需 spawn PowerShell。
- `win.on('closed')`（main.js:1417）是关闭窗口后的清理入口，已有 `gameWindows.length === 0` 分支用于重置变速。
- `<webview>` 已有 `plugin-crashed` 事件（game.html:1006）用于插件崩溃后自动 reload。
- `refresh-page` IPC 通道已注册但当前是空实现（main.js:1338）。

**方案**：
1. 新增 `killFlashPluginProcesses()`：用 `app.getAppMetrics()` 找出所有 `pepper plugin` / `ppapi plugin` / `plugin` 类型进程并 `process.kill(pid)`。
2. 在 `win.on('closed')` 的 `gameWindows.length === 0` 分支中调用它，清理僵尸 Flash 进程。
3. 把 `refresh-page` 从空实现改为真正调用 `killFlashPluginProcesses()`；`game.html` 的 `refreshPage()` 改为发送该 IPC，并增加兜底重载。

## 3. 受影响文件

### 3.1 `d:\Project\Naruto Online\main.js`（修改）
- 新增函数 `killFlashPluginProcesses()`（放在 `getMemoryMB` 附近或 `injectAllChildProcesses` 之后）。
- 修改 `win.on('closed')` 内 `if (gameWindows.length === 0) { ... }` 分支，追加清理调用。
- 修改 `addListener('refresh-page', ...)`（main.js:1338）空实现。

### 3.2 `d:\Project\Naruto Online\game.html`（修改）
- 修改 `refreshPage()`（game.html:674）。
- 修改 `createWebview()` 内的 `plugin-crashed` 处理器（game.html:1006），增加"手动刷新接管"标志判断，避免双重 reload。

## 4. 实现细节

### 4.1 新增 `killFlashPluginProcesses()`

```js
function killFlashPluginProcesses() {
  try {
    const metrics = app.getAppMetrics();
    const pluginTypes = ['pepper plugin', 'ppapi plugin', 'ppapi plugin broker', 'plugin'];
    let killed = 0;
    for (const m of metrics) {
      const t = String(m.type || '').toLowerCase();
      if (pluginTypes.includes(t) && m.pid && m.pid !== process.pid) {
        try {
          process.kill(m.pid);
          injectedPids.delete(m.pid);
          killed++;
        } catch (e) {}
      }
    }
    if (killed > 0) log('已清理残留 Flash 插件进程: ' + killed + ' 个');
  } catch (e) {
    log('清理 Flash 插件进程失败: ' + e.message, 'WARN');
  }
}
```

### 4.2 关闭窗口时清理（main.js:1430 分支）

在 `if (gameWindows.length === 0) {` 内、`currentSpeedRate = 1` 之前或之后追加：

```js
killFlashPluginProcesses();
```

### 4.3 刷新通道改为真正杀进程（main.js:1338）

```js
addListener('refresh-page', (event) => {
  // 杀掉残留 Flash 插件进程，触发 plugin-crashed 自动冷启动恢复
  killFlashPluginProcesses();
});
```

### 4.4 刷新按钮逻辑（game.html:674）

```js
refreshPage: function() {
  var tab = tabs.find(function(t) { return t.id === activeTabId; });
  if (tab && tab._webview) {
    tab._manualRefresh = true;
    ipcRenderer.send('refresh-page');
    // 兜底：2.5 秒后若插件崩溃事件未触发自动重载，则强制冷加载
    setTimeout(function() {
      if (tab && tab._webview && tab._manualRefresh) {
        tab._manualRefresh = false;
        try { tab._webview.reloadIgnoringCache(); } catch (e) {
          try { tab._webview.reload(); } catch (e2) {}
        }
      }
    }, 2500);
  }
}
```

### 4.5 `plugin-crashed` 增加手动刷新接管（game.html:1006）

```js
webview.addEventListener('plugin-crashed', (e) => {
  window.gameAPI.debugLog('error', 'webview', '插件崩溃: ' + (e.name || 'unknown'));
  if (tab._manualRefresh) return; // 手动刷新已接管，避免双重 reload
  setTimeout(function() {
    if (tab._webview && !tab._webview.isCrashed()) {
      tab._webview.reload();
    }
  }, 1000);
});
```

## 5. 边界条件与异常处理

- **多窗口/多标签**：`killFlashPluginProcesses()` 会杀掉所有 Flash 插件进程。若存在其他标签，它们会触发各自的 `plugin-crashed` 自动 reload（已存在），因此能自愈；仅手动刷新所在标签因 `_manualRefresh` 标志走兜底重载。启动器窗口不加载 Flash，杀掉所有插件进程对启动器无影响。
- **插件进程已死（白屏态）**：`process.kill` 可能抛异常（ESRCH），已 try/catch 吞掉，不影响主流程。
- **`_manualRefresh` 标志残留**：兜底 setTimeout 会将其复位为 `false`；若 webview 已销毁，`tab._webview` 为空则不执行，无副作用。
- **injectedPids 清理**：杀掉插件进程时同步 `injectedPids.delete(pid)`，下次新插件进程 PID 不同会重新注入，避免变速失效。
- **`gameWindows.length === 0` 才清理**：避免在多窗口场景下关闭其中一个窗口时误杀其它窗口的 Flash。

## 6. 数据流路径

1. 关闭窗口：`win.on('closed')` → `gameWindows.length === 0` → `killFlashPluginProcesses()` → `app.getAppMetrics()` → `process.kill(插件PID)`。
2. 刷新：`btn-refresh` click → `gameAPI.refreshPage()` → 设 `_manualRefresh` + `ipcRenderer.send('refresh-page')` → main `killFlashPluginProcesses()` → 插件进程被杀 → webview 触发 `plugin-crashed`（被 `_manualRefresh` 拦截）→ 2.5s 兜底 `reloadIgnoringCache()` → 全新 Flash 冷启动。

## 7. 预期结果

- 长时间全屏游玩后关闭再打开：不再持续白屏，新窗口正常加载 Flash。
- 长时间游玩后点"刷新"：页面冷启动恢复，不再白屏。
- 正常多开/多标签使用不受影响；变速功能在新进程上自动重注入。
