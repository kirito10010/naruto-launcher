# 流畅度优化 —— 任务完成总结

## 完成情况

本次优化共 4 个任务，全部完成：

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 修正命令行启动参数（移除有害开关） | ✅ |
| Task 2 | 用 `app.getAppMetrics()` 替代 PowerShell 进程扫描 | ✅ |
| Task 3 | 启动清理延迟执行 | ✅ |
| Task 4 | 后台标签页静音（game.html） | ✅ |

## 具体改动

### main.js

1. **移除 4 个反向优化启动参数**（原 907-919 行）
   - 删除 `ignore-gpu-blacklist`、`disable-frame-rate-limit`、`disable-gpu-vsync`、`enable-features=CanvasOopRasterization`
   - 保留 `no-sandbox`（DLL 注入与 Flash 必需）、`ppapi-flash-*`（Flash 必需）等
   - 效果：FPS 有上限、画面不撕裂，CPU/GPU 占用下降，多开卡顿缓解

2. **替换进程扫描方式**
   - 删除 `getAllChildProcessesRecursive()`（原使用 `powershell.exe Get-CimInstance` 递归扫描）
   - 新增 `getAllRelevantChildPids()`，使用 `app.getAppMetrics()` 直接取进程 PID，过滤 Renderer/GPU/Plugin/Utility 等类型
   - 更新 `injectAllChildProcesses()` 与 `secondPass()` 调用新函数
   - 效果：加载/变速不再 spawn PowerShell，消除 CPU 尖峰

3. **启动清理延迟执行**
   - `app.whenReady` 中的 `performStartupCleanup()` 改为 `setTimeout` 延迟 3 秒，并增加 `gameWindows.length === 0` 判断
   - 效果：避免同步 IO 阻塞启动，且不与游戏争抢磁盘 IO

### game.html

4. **后台标签页静音**
   - `switchTab` 中对 `prevTab` 统一 `setAudioMuted(true)`，对 `nextTab` 用 `setAudioMuted(isMuted)` 恢复/保持静音
   - 效果：隐藏标签页不播放音频，切回时正确恢复

## 校验

- `node --check main.js` 语法校验通过（exit 0）
- `exec`（仍被 `checkHVCI` 使用）与 `spawn`（仍被 DLL 注入/变速使用）引用未受影响，import 无需调整

## 建议后续验证

1. 实际启动游戏，观察多开时 CPU/GPU 占用与画面流畅度是否改善
2. 确认变速功能（0.5x~20x）注入仍正常（`app.getAppMetrics()` 能覆盖到 Flash 插件进程）
3. 如在个别老旧显卡机器上出现画面异常，可单独恢复 `ignore-gpu-blacklist`（但不建议恢复另外三个开关）

## 未改动（本次范围外）

- 未升级 Electron 版本（受 Flash/PPAPI 兼容性约束，无法升级到 Electron 12+）
- 未统一 `webview` 与 `BrowserView` 两套并行架构（属较大重构，建议单独评估）
- `execFile` 导入未使用为历史遗留，本次未处理
