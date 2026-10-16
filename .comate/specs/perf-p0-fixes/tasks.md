# 卡顿优化全量实施 任务计划

- [x] Task 1: game.html 隐藏标签停画与拉伸模式修复
    - 1.1: `.webview-wrap webview.hidden` 增加 `visibility:hidden`
    - 1.2: `STRETCH_ENABLE_JS` 去掉 `setInterval(doStretch,1000)`，改为立即执行 + 300/1000/2500/5000ms 延迟补跑 + resize(rAF 防抖)
    - 1.3: `applyFlashQuality()` 感知 `stretchMode`（拉伸开启时统一 `wmode=opaque`）
    - 1.4: `setStretchMode()` 切换后对所有标签重新应用画质

- [x] Task 2: game.html 刷新、标签释放与后台窗口降画质
    - 2.1: `refreshPage()` 改为立即 `reloadIgnoringCache()`，`_manualRefresh` 守卫延长到 4s
    - 2.2: `removeTab()` 移除前 `stop()` + `removeAllListeners()` + `src='about:blank'`
    - 2.3: 监听 `window-blur` / `window-focus`，失焦时全部标签 Flash 降为 `quality=low`，聚焦时活跃标签恢复 `high`

- [x] Task 3: main.js 启动清理与后台注入优化
    - 3.1: `cleanupElectronCache()` 删除列表移除 `GPUCache`、`Code Cache`
    - 3.2: `performStartupCleanup()` 改为分步链式执行（每步间 `setTimeout(50)`）
    - 3.3: `injectAllChildProcesses()` 在当前速率为 1 时直接返回
    - 3.4: 移除无效开关 `enable-fast-startup`

- [x] Task 4: main.js 启动器窗口生命周期与全局回收
    - 4.1: 新增 `showLauncherWindow()`（存在则 show+focus，否则重建）
    - 4.2: `launcherWindow.on('close')` 改为直接销毁，替换全部 4 处 `launcherWindow.show()`
    - 4.3: `refresh-page` 处理器不再全局 `killFlashPluginProcesses()`

- [x] Task 5: main.js 设置面板新增性能开关与提示
    - 5.1: 新增配置 `forceGpu`（默认 true）与 `perfDiag`（默认 false），`ignore-gpu-blacklist` 按 `forceGpu` 决定是否追加
    - 5.2: 设置面板新增「强制启用 GPU」「性能诊断日志」两个开关，并接 IPC 持久化（GPU 项提示重启）
    - 5.3: 「抓包导出说明」补一句"抓包期间会略微卡顿，属正常现象"
    - 5.4: `perfDiag` 开启时每 60s 向 `userData/perf.log` 追加进程/内存汇总

- [x] Task 6: capture.js 抓包开销降级
    - 6.1: CDP 缓冲 100MB/50MB/10MB 降为 16MB/8MB/2MB

- [x] Task 7: 校验与打包
    - 7.1: `node --check` 全部 JS + 两个 html 内联脚本语法检查
    - 7.2: 本地实测：多标签切换、单标签刷新、拉伸开关、关启动器窗口后托盘重开、设置开关持久化
    - 7.3: 打包 1.0.0 并输出【新增】【优化】【修复】格式更新说明
