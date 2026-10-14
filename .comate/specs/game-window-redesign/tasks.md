# 游戏窗口工具栏重做 + F11 全屏 + 操作说明 + 4399 解耦 任务计划

- [x] Task 1: 主进程支持窗口分流与 F11 全屏
    - 1.1: `createGameWindow(url, gameName, account, opts)` 增加 `opts.plain`，`loadFile(plain ? 'browser.html' : 'game.html')`
    - 1.2: `did-finish-load` 下发的 `game-info` 增加 `plain` 字段；plain 时 accounts 传 `[]`、account 传 `null`
    - 1.3: `launch-game` 处理器按 URL 判定 `plain = !/huoying\.qq\.com/i.test(url)`
    - 1.4: 新增 `app.on('web-contents-created')` + `before-input-event` 捕获 F11（覆盖 webview guest），仅对 `gameWindows` 中的窗口生效
    - 1.5: 新增 IPC `toggle-fullscreen`（工具栏菜单用）
    - 1.6: `createGameWindow` 内监听 `enter-full-screen` / `leave-full-screen`，向渲染层回推 `fullscreen-changed`

- [x] Task 2: 新增 4399 极简窗口页面 browser.html
    - 2.1: 创建 `browser.html`：顶部 44px 细条（`-webkit-app-region: drag`）+ 最小化/关闭按钮 + 单个 webview 容器
    - 2.2: webview 带 `plugins` 与 `webpreferences`（4399 有 Flash 小游戏）
    - 2.3: 监听 `game-info` 设置 webview.src 与标题、`theme-update` 应用主题、`fullscreen-changed` 切换 `body.fullscreen` 隐藏细条
    - 2.4: `package.json` 的 `build.files` 加入 `"browser.html"`

- [x] Task 3: 重做 game.html 顶部工具栏
    - 3.1: HTML 重构：左侧 `≡`+标题+标签；右侧 变速 select / `👤`账号 / `⋯`更多 / `─ □ ✕`
    - 3.2: 新增 `⋯` 弹出菜单（刷新 / 标签栏显示方式 / 静音 / 拉伸模式 / 操作说明 / 全屏）
    - 3.3: 重写工具栏 CSS 为清新风格（圆角按钮、主题色、hover/active、`menu-popover` 弹层）
    - 3.4: JS 改为菜单分发（`data-act`），复用既有 `refreshPage`/`setTabDisplayMode`/`setStretchMode` 等
    - 3.5: 新增「操作说明」模态，列出火影窗口各项功能（账号/变速/标签/刷新/静音/拉伸/全屏/多开）
    - 3.6: 监听 `fullscreen-changed`，`body.fullscreen` 时隐藏工具栏

- [x] Task 4: 启动器设置面板新增抓包导出说明
    - 4.1: 设置面板加入「抓包导出说明」区块（开启抓包自动重启 → 5 步操作 → 关闭游戏窗口 → 托盘退出 → 生成 Excel）
    - 4.2: 调整 `.sheet-body` 支持内容变长时内部滚动，避免出现难看的滚动条

- [x] Task 5: 校验与打包
    - 5.1: `node --check main.js` 通过
    - 5.2: 本地实测：火影窗口新工具栏、`⋯` 菜单、F11 全屏切换、操作说明、4399 极简窗口、启动器设置说明
    - 5.3: 打包 1.0.0，确认 asar 内含 `browser.html`，输出【新增】【优化】【修复】格式更新说明
