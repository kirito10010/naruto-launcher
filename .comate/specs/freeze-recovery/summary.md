# 修复总结：卡死治理（GPU 自动降级 + 看门狗 + 崩溃自愈 + 诊断 + 软件渲染兜底）

## 1. 改动（只改 `main.js`）

| 项 | 说明 |
| --- | --- |
| `child-process-gone` | GPU 进程 `crashed` / `oom` → 写 `[CRASH]` 日志，并自动把 `config.forceGpu` 置 `false`、记 `gpuCrashAt` 落盘；`killed` 只记日志 |
| 一次性提示 | 启动器启动后若存在 `gpuCrashAt`，弹窗说明「已自动关闭强制启用 GPU」，随后清除该字段 |
| `attachFreezeWatch()` | 监听 `unresponsive` / `responsive`：卡死写 `[HANG]` 快照（窗口、倍率、抓包模式、逐进程内存/CPU），并弹「继续等待 / 重新加载页面 / 本次不再提示」，默认「继续等待」；恢复后写 `[RECOVER]` 含卡顿时长 |
| `attachCrashRecovery()` | 监听 `render-process-gone`：写 `[CRASH]`；`crashed` / `oom` 自动 `reload()`，同窗口 60 秒内只自动恢复一次，再崩则提示 |
| 挂载范围 | 游戏窗口宿主 `win.webContents` + `did-attach-webview` 的每个 guest，日志带窗口槽位 |
| `collectPerf()` / `perfSummary()` | 逐进程 `type#pid rssMB cpu%`；启动时先写一条 `(startup)` 基线，之后每 60 秒一次 |
| `logPerfEvent()` | `[HANG]` / `[RECOVER]` / `[CRASH]` 事件固定写 `perf.log`，**不受「性能诊断日志」开关影响** |
| 软件渲染（兼容模式） | `softwareRender` 配置 → 启动加 `--disable-gpu` + `--disable-gpu-compositing`，且不再加 `--ignore-gpu-blacklist`；设置→性能新增开关 + 说明弹层 + `set-software-render` IPC（提示重启） |
| 说明文案 | 「强制启用 GPU 说明」补充「关掉仍卡死请改用软件渲染」；新增「软件渲染（兼容模式）说明」 |

## 2. 验证（真实运行）

| 验证项 | 结果 |
| --- | --- |
| `node --check main.js` | 通过 |
| 设置面板 | 出现「软件渲染（兼容模式）」开关，能从配置正确回填；说明弹层内容完整 |
| 软件渲染生效 | 开启后启动，`perf.log` 首行 `render=software`（关闭时为 `render=gpu-auto` / `gpu-forced`） |
| 逐进程采样 | `perf.log` 每 60 秒写出 `procs/rss/types/render` 汇总 + 每个进程的 `type#pid rss cpu%` |
| GPU 崩溃自动降级 | 外部强杀 GPU 进程 → 日志 `[CRASH] GPU 进程退出 reason=crashed exitCode=-1`；配置自动变为 `forceGpu=false`、写入 `gpuCrashAt` |
| 一次性提示 | 再次启动 → 弹出「上次运行检测到显卡进程崩溃。已在设置→性能里自动关闭…」，提示后 `gpuCrashAt` 被清除 |
| 卡死看门狗 | 未做真机卡死复现（难以稳定制造），逻辑为 `unresponsive`/`responsive` 标准事件，其余路径已实测 |

## 3. 用户侧怎么用

- 遇到「进战斗/开面板直接卡死」：先确认设置里「强制启用 GPU」是否为关；若已关仍卡死，打开「软件渲染（兼容模式）」并重启。
- 反馈卡死问题时：打开「性能诊断日志」，复现一次后把 `%APPDATA%\naruto-online-launcher\perf.log` 发来 —— 里面会有 `[HANG]` / `[CRASH]` / 逐进程内存与 CPU，能直接判断是 GPU、内存还是 CPU 问题。

## 4. 版本

改动归入 **1.5.0**；本次未打包。
