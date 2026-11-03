# Flash 画质设置任务计划

- [x] Task 1: 完善画质注入脚本
    - 1.1: 更新 `flash-quality-low-preload.js`，patch innerHTML / outerHTML / setAttribute / write / writeln / insertAdjacentHTML
    - 1.2: 新建 `flash-quality-medium-preload.js`
    - 1.3: 在 `package.json` 的 `build.files` 中加入两个 preload

- [x] Task 2: 主进程设置与 IPC
    - 2.1: 移除 `loadConfig` 中强制 `flashQuality = 'high'` 的逻辑
    - 2.2: 设置面板「游戏入口」前新增「游戏画面」下拉框与说明按钮
    - 2.3: 新增 `changeFlashQuality`、`flash-quality-state` 监听与 `set-flash-quality` IPC
    - 2.4: 启动器加载完成时下发当前画质
    - 2.5: 新增 `HELP.quality` 说明文案

- [x] Task 3: game.html 画质接线
    - 3.1: 新增 `flashQuality` 全局与 `game-info` 赋值
    - 3.2: `createWebview` 按画质挂载 preload
    - 3.3: 重构 `applyFlashQuality(webview, quality, active)`，支持 medium，wmode 与画质解耦
    - 3.4: 所有调用点活跃标签使用配置画质
    - 3.5: 监听 `flash-quality-update`，更新新标签画质并刷新活跃标签

- [x] Task 4: 主进程 iframe 兜底注入
    - 4.1: 生成 CDP 注入源码
    - 4.2: `did-attach-webview` 时 attach debugger 并注入，失败静默

- [x] Task 5: 校验
    - 5.1: `node --check main.js`
    - 5.2: 抽取 game.html 内联脚本做语法检查
    - 5.3: 检查 webPreferences / preload 路径 / 设置项状态同步
