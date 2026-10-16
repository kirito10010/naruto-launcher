# 卡顿优化全量实施 完成总结

## 结果

按「能修的全修」完成 13 项改动（P0 4 项 + P1 3 项 + P2 5 项 + 1 项无效配置清理），2 项经评估不做。已打包 1.0.0 并验证通过。

## 各任务完成情况

| 任务 | 状态 |
|------|------|
| Task 1 game.html 隐藏标签停画 + 拉伸模式 | 完成 |
| Task 2 game.html 刷新/释放/后台降画质 | 完成 |
| Task 3 main.js 启动清理与后台注入优化 | 完成 |
| Task 4 main.js 启动器窗口生命周期与全局回收 | 完成 |
| Task 5 main.js 设置面板新增性能开关与提示 | 完成 |
| Task 6 capture.js 抓包开销降级 | 完成 |
| Task 7 校验与打包 | 完成 |

## 具体改动

### game.html
1. **隐藏标签停画**：`.webview-wrap webview.hidden` 增加 `visibility:hidden`（布局与尺寸不变，只让合成器跳过该层）。
2. **拉伸模式去轮询**：删除 `setInterval(doStretch,1000)`，改为「立即执行 + 300/1000/2500/5000ms 补跑 + resize(rAF 防抖)」；`STRETCH_DISABLE_JS` 相应清理 rAF 与 resize 监听。→ 消除每秒一次强制 reflow。
3. **修 wmode 冲突**：`applyFlashQuality()` 改为 `wmode = (stretchMode || quality==='low') ? 'opaque' : 'direct'`；`setStretchMode()` 切换后重刷所有标签画质。
4. **刷新只影响当前标签**：`refreshPage()` 立即 `reloadIgnoringCache()`（不再等 2.5s），`_manualRefresh` 守卫 4s。
5. **关标签显式释放**：`removeTab()` 在 `removeChild` 前执行 `stop()` + `removeAllListeners()` + `src='about:blank'`。
6. **后台窗口降画质**：`window-blur` 时全部标签 Flash 降为 `low`，`window-focus` 时活跃标签恢复 `high`（只降画质，不停逻辑）。

### main.js
7. **启动清理**：`cleanupElectronCache()` 不再删 `GPUCache` / `Code Cache`（保住 GPU 着色器缓存与 V8 字节码缓存）；`performStartupCleanup()` 改为分步链式（每步间 `setTimeout(50)`）。
8. **1x 跳过注入**：`injectAllChildProcesses()` 在当前速率为 1 时直接返回。
9. **刷新不再全局杀插件**：`refresh-page` 处理器改为空实现；全局回收保留在最后一个游戏窗口关闭时。
10. **启动器窗口关闭即销毁**：新增 `showLauncherWindow()`（不存在则重建），替换全部 4 处调用；`window-all-closed` 不再退出应用（托盘常驻）。
11. **`ignore-gpu-blacklist` 改开关**：新增配置 `forceGpu`（默认 true = 原行为），设置面板可关。
12. **性能诊断日志**：新增配置 `perfDiag`（默认 false），开启后每 60s 往 `userData/perf.log` 记录进程数/总内存/各类型进程数/窗口数。
13. **移除无效开关** `enable-fast-startup`；设置面板新增「性能」区（两个开关）与抓包提示「抓包期间会略微卡顿，属正常现象」；说明里的 Excel 数量 5→6 修正。

### capture.js
14. CDP 缓冲 100MB/50MB/10MB → 16MB/8MB/2MB。

## 不做项

- **P1-8 收紧分区/缓存保留期、把 `disk-cache-size` 从 1GB 降到 256MB**：磁盘缓存越大越省网络、对流畅度有利，收紧反而变慢；缩短分区保留期会导致"每周玩一次就丢登录态"，属产品行为变更。
- **后台标签"限帧"**：Flash 帧率由 SWF 内部 `stage.frameRate` 决定，外部无法可靠限制，不做假实现。

## 验证记录

- `node --check` 全部通过（main.js / updater.js / capture.js / export.js / xlsx.js + game.html / browser.html 内联脚本）
- **生命周期实测**：启动应用 → 向启动器窗口发 `WM_CLOSE` → 窗口消失但应用仍驻留（`electronProcs=4`）→ **PASS**
- 代码核对：4 处 `launcherWindow.show()` 已全部改为 `showLauncherWindow()`，唯一直接 `.show()` 在 helper 内部
- 设置面板离屏渲染确认：新增「性能」区两个开关 + 抓包提示 + 6 张 Excel 文案均正常
- 打包产物 `release-v1.0.0/NarutoOnlineLauncher-Setup-1.0.0.exe`（67.45 MB，exe 元数据 1.0.0）
- asar 含 `showLauncherWindow` / `perfDiag` / `forceGpu` / `set-perf-diag` / `visibility: hidden` / `__narutoStretchSchedule` / `perf.log` / 抓包提示
- 打包后运行正常（5 进程，启动器窗口标题「火影忍者启动器」）

## 待真机验证（需要实际游戏环境）

以下 3 项依赖真实 Flash 游戏内容，代码层面已就绪，但**建议在真机确认**：

1. **隐藏标签 `visibility:hidden`** 后切回标签，Flash 是否正常继续（预期正常，元素尺寸未变）。
2. **拉伸模式** 视觉结果是否与之前一致（缩放方式未变，只去掉了轮询与改了 wmode）。
3. **wmode=opaque** 的实际生效情况：`wmode` 是 Flash 初始化时读取的参数，运行时改属性可能要到下次加载才生效——这是**原有机制**的固有限制，本次只是让取值随拉伸模式变化。
