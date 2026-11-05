# 游戏优先（进程高优先级）完成总结

## 已完成
- 新增 `config.highPriority`，默认开启。
- `applyProcessPriority()` 把本应用的 Browser / 渲染 / GPU / Utility / Flash 插件进程设为 Windows 高优先级（`HIGH_PRIORITY_CLASS`，Node `PRIORITY_HIGH`），不使用 Realtime。
- 触发时机：
  - 应用 ready；
  - 创建游戏窗口；
  - webview attach；
  - webContents / webview 的 `did-finish-load`、`did-stop-loading`；
  - 每 15 秒补设一次，覆盖后启动的 Flash 插件进程。
- 设置 → 性能新增「游戏优先」开关，默认开；关闭后立即恢复普通优先级。
- 仅 Windows 生效；无权限/进程已退出时静默忽略。

## 校验
- `main.js` 语法检查通过。
- 已在本机验证 Node `os.setPriority`：普通 0 可切到 `PRIORITY_HIGH`（-14）。
- asar 校验：默认配置、applyProcessPriority、set-high-priority IPC、设置 UI 均存在。

## 产物
- 已重新打包 `release-v2.1.0/NarutoOnlineLauncher-Setup-2.1.0.exe` + blockmap + latest.yml。
- 如果已上传旧 2.1.0，需要用新包覆盖。

## 说明
- 高优先级只改变调度权重，不改变 Flash 单线程渲染上限；对同时开浏览器/下载/录屏的机器帮助更明显。
- 没有使用实时优先级，避免系统输入/音频被抢占。
