# 游戏优先（进程高优先级）

## 需求

打开启动器开始游戏后，希望系统资源更偏向启动器和游戏，减少其它程序抢占。默认开启。

## 方案

- 新增 `config.highPriority`，默认 `true`。
- 主进程定时/事件触发 `applyProcessPriority()`：
  - 取 `process.pid` 和 `app.getAppMetrics()` 里本应用的所有进程（Browser / 渲染 / GPU / Utility / Flash 插件）；
  - 设置为 Windows `HIGH_PRIORITY_CLASS`（Node `PRIORITY_HIGH`，约 -14）；
  - **不使用 Realtime**，避免抢占输入/音频导致系统假死。
- 触发时机：
  - 应用 ready、创建游戏窗口、webview attach；
  - 每个 webContents / webview 的 `did-finish-load`、`did-stop-loading`；
  - 每 15 秒补设一次，覆盖后启动的 Flash 插件进程。
- 设置面板「性能」新增「游戏优先」开关：
  - 默认开；
  - 关闭时把本应用进程恢复普通优先级，之后新进程也走普通；
  - 开启时立即重新设为高优先级。
- 仅 Windows 生效；非 Windows 直接跳过。

## 受影响文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `main.js` | 修改 | 默认配置、applyProcessPriority、触发点、IPC、设置面板 |

## 边界

- 不使用实时优先级。
- 无权限/进程已退出时静默忽略。
- 高优先级只改变调度权重，不改变 Flash 单线程渲染上限。
- 不影响账号、画质、缩放等其他设置。

## 预期结果

- 启动器/游戏/Flash 进程默认高优先级，和浏览器、下载、录屏等程序竞争时更不容易卡顿。
- 用户可在设置里关闭，关闭后恢复普通优先级。
