# 修复长时间全屏游玩后关闭/刷新白屏 — 总结

## 问题根因

用户全屏玩火影忍者Online（Flash PPAPI 游戏）一段时间后，关闭窗口再打开或点"刷新"持续白屏，玩越久越易复现。根因确认：Flash 插件进程（`pepflashplayer` / PPAPI Plugin）长时间全屏后挂起/损坏，而关闭窗口和刷新都没有真正终止该进程，导致新实例拿不到干净的 GPU 渲染表面。

## 改动内容

### main.js
1. 新增 `killFlashPluginProcesses()`（main.js:1659）：用 `app.getAppMetrics()` 过滤 `pepper plugin` / `ppapi plugin` / `ppapi plugin broker` / `plugin` 类型进程并 `process.kill()`，同步清理 `injectedPids`。
2. `win.on('closed')` 的 `gameWindows.length === 0` 分支内调用 `killFlashPluginProcesses()`，关闭最后一个游戏窗口时清理僵尸 Flash 进程。
3. `refresh-page` IPC 通道从空实现改为调用 `killFlashPluginProcesses()`。

### game.html
1. `refreshPage()` 改为发送 `refresh-page`，并设置 `tab._manualRefresh` 标志 + 2.5 秒兜底 `reloadIgnoringCache()` 冷加载。
2. `plugin-crashed` 处理器在 `tab._manualRefresh` 为真时跳过自动 reload，避免双重重载。

## 验证结果

- `node --check main.js` 通过，无语法错误。
- `npm run build`（electron-builder）成功，exit code 0。
- 产物：`release-v3.1.1\NarutoOnlineLauncher-Setup-3.1.1.exe` 及对应 `.blockmap`。

## 待用户验证

需要实际长时间全屏游玩后复现原场景，确认：
1. 关闭再打开不再白屏；
2. 点击刷新能冷启动恢复；
3. 多开/多标签及变速功能不受影响。
