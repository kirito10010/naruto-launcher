# 流畅度优化任务计划

- [x] Task 1: 修正命令行启动参数（消除 FPS 无上限/画面撕裂）
    - 1.1: 删除 `app.commandLine.appendSwitch('ignore-gpu-blacklist')`
    - 1.2: 删除 `app.commandLine.appendSwitch('disable-frame-rate-limit')`
    - 1.3: 删除 `app.commandLine.appendSwitch('disable-gpu-vsync')`
    - 1.4: 删除 `app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')`
    - 1.5: 保留 `no-sandbox`、`ppapi-flash-*` 等必要开关，验证代码可正常启动

- [x] Task 2: 用 app.getAppMetrics() 替代 PowerShell 进程扫描
    - 2.1: 新增 `getAllRelevantChildPids()` 函数（过滤 Renderer/GPU/Plugin/Utility 等类型）
    - 2.2: 修改 `injectAllChildProcesses()` 调用新函数
    - 2.3: 修改 `secondPass()` 调用新函数
    - 2.4: 删除不再使用的 `getAllChildProcessesRecursive()`（含 powershell/exec 逻辑）
    - 2.5: 确认 `exec`/`spawn` 引用仍被其他功能使用，避免误删 import

- [x] Task 3: 启动清理延迟执行
    - 3.1: 将 `app.whenReady` 中的 `performStartupCleanup()` 改为 `setTimeout` 延迟 3 秒
    - 3.2: 增加 `gameWindows.length === 0` 判断，避免与游戏争抢 IO

- [x] Task 4: 后台标签页静音（game.html）
    - 4.1: `switchTab` 中对 `prevTab` 的 webview 统一 `setAudioMuted(true)`
    - 4.2: 验证切换回标签页时（非全局静音时）恢复音频
