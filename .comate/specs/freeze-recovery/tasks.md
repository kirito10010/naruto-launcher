# 卡死治理：GPU 自动降级 + 卡死看门狗 + 崩溃自愈 + 诊断增强 + 软件渲染兜底

- [x] Task 1: GPU 进程崩溃监听与自动降级
    - 1.1: 新增 `app.on('child-process-gone')`：`type === 'GPU'` 且 `reason` 为 `crashed` / `oom` 时写 ERROR 日志，并把 `config.forceGpu` 置为 `false`、写 `config.gpuCrashAt` 后落盘
    - 1.2: `reason === 'killed'`（Chromium 主动杀，多为 TDR 恢复）只记日志，不降级
    - 1.3: 启动参数确认：`forceGpu === false` 时不加 `--ignore-gpu-blacklist`（沿用现有逻辑，补充注释说明来源可能是自动降级）
    - 1.4: 启动器创建后若 `config.gpuCrashAt` 存在 → 弹一次提示「上次运行检测到显卡进程崩溃，已自动关闭『强制启用 GPU』」，提示后清除该字段并落盘

- [x] Task 2: 卡死看门狗（unresponsive / responsive）
    - 2.1: 新增 `attachFreezeWatch(wc, label)`：记录开始时间，绑定 `unresponsive` / `responsive`
    - 2.2: `unresponsive` → 写 `[HANG]` 日志快照（窗口标签、当前倍率、抓包模式、`app.getAppMetrics()` 的进程数/内存/CPU），并弹窗：「继续等待 / 重新加载页面 / 本次不再提示」，默认按钮为「继续等待」
    - 2.3: 选择「重新加载页面」→ `wc.reload()`；选择「本次不再提示」→ 本次运行内该窗口不再弹
    - 2.4: `responsive` → 写 `[RECOVER]` 日志（含卡顿时长），并解除本次提示闸门
    - 2.5: 挂载范围：游戏窗口宿主 `win.webContents` + `did-attach-webview` 的每个 guest；多开时日志带窗口槽位

- [x] Task 3: 渲染进程崩溃自动恢复
    - 3.1: 宿主与 guest 都监听 `render-process-gone`，写 `[CRASH]` ERROR 日志（reason / exitCode / 窗口标签）
    - 3.2: `reason` 为 `crashed` / `oom` 时自动 `reload()`，同一窗口 60 秒内只自动恢复一次（避免崩溃循环）
    - 3.3: 超过一次仍崩溃 → 弹提示「游戏页面反复崩溃，请关闭其他多开窗口后重试」

- [x] Task 4: perf.log 诊断增强
    - 4.1: 新增 `logPerfEvent(tag, detail)`：写 `[时间戳(毫秒)] [HANG]/[RECOVER]/[CRASH] ...` 一行到 `perf.log`，**不受「性能诊断日志」开关影响**
    - 4.2: 每 60 秒的常规采样改为逐进程记录 `type/pid/rssMB/cpu%`（`app.getAppMetrics()`），并保留总览行
    - 4.3: 时间戳统一到毫秒

- [x] Task 5: 软件渲染「兼容模式」
    - 5.1: 启动参数：`EARLY_CONFIG.softwareRender === true` 时加 `--disable-gpu` + `--disable-gpu-compositing`，且不再加 `--ignore-gpu-blacklist`
    - 5.2: 设置 → 性能 新增「软件渲染（兼容模式）」开关 + `set-software-render` IPC（提示需重启生效）+ 状态回填
    - 5.3: 设置项说明弹层新增该开关的优缺点与适用场景（与「强制启用 GPU」互斥的说明）

- [x] Task 6: 验证
    - 6.1: `node --check main.js` 通过
    - 6.2: 开发模式启动：设置面板出现「软件渲染（兼容模式）」且状态能回填；说明弹层内容正确；启动器与游戏窗口正常
    - 6.3: 检查 `perf.log`：开启性能诊断时常规采样含逐进程 CPU/内存；关闭时 `[HANG]`/`[CRASH]` 类事件仍能写入
    - 6.4: 回归：组织统计 / 全量抓包 / 题库抓包三种模式的退出子进程逻辑未被影响

