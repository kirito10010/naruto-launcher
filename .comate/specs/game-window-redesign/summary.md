# 游戏窗口工具栏重做 + F11 全屏 + 操作说明 + 4399 解耦 完成总结

## 结果

火影游戏窗口顶部工具栏重做为与启动器一致的清新风格并收纳低频功能；新增 F11 全屏（全屏隐藏顶部栏）；新增游戏窗口「操作说明」；4399 与火影完全解耦（4399 只保留极简细条）；启动器设置面板新增「抓包导出说明」。已打包 1.0.0 并验证通过。

## 各任务完成情况

| 任务 | 状态 | 说明 |
|------|------|------|
| Task 1 主进程窗口分流 + F11 | 完成 | `createGameWindow` 增 `opts.plain`；`launch-game` 按 URL 判定；F11 全局捕获；`toggle-fullscreen` IPC；全屏状态回推 |
| Task 2 新增 browser.html | 完成 | 4399 极简窗口（细条 + 单 webview）；`package.json` files 已加入 |
| Task 3 重做 game.html 工具栏 | 完成 | 新布局 + `⋯` 收纳菜单 + 操作说明模态 + 全屏处理 |
| Task 4 启动器设置抓包说明 | 完成 | 设置面板新增 5 步流程说明，面板内部可滚动 |
| Task 5 校验与打包 | 完成 | 语法检查 + 渲染实测 + 打包 1.0.0 |

## 主要改动

### main.js
- `createGameWindow(url, gameName, account, opts)`：`opts.plain` 决定加载 `browser.html` 还是 `game.html`；`game-info` 增加 `plain` 字段（plain 时 accounts 传 `[]`）
- `launch-game`：`plain = !/huoying\.qq\.com/i.test(url)` → 4399 走极简窗口
- 新增 `ipcMain.on('toggle-fullscreen')`
- 新增 `app.on('web-contents-created')` + `before-input-event` 捕获 F11（覆盖 webview guest），仅对 `gameWindows` 生效
- `createGameWindow` 内监听 `enter-full-screen` / `leave-full-screen` → 回推 `fullscreen-changed`
- 启动器设置面板：内容包进 `.sheet-body`（`max-height:62vh` + 滚动），新增「抓包导出说明」区块

### browser.html（新增）
- 44px 细条（drag）+ 仅 `─` / `✕`；单 webview（带 `plugins`，支持 4399 Flash 小游戏）
- 监听 `game-info` / `theme-update` / `fullscreen-changed`

### game.html
- 工具栏 HTML 重构：左 `≡`+标题+标签；右 `变速` select / `👤` / `⋯` / `─ □ ✕`
- 新增 `.menu-popover` 收纳菜单：刷新 / 标签栏显示方式 / 静音 / 拉伸模式 / 操作说明 / 全屏（F11）
- CSS 重写为清新风格（圆角、主题色、hover/active、弹层），`--toolbarHeight` 36→44px
- 新增「操作说明」模态（`.help-mask` / `.help-card`）
- 移除旧按钮 id 与其监听，改为 `data-act` 菜单分发；`btnMute` 逻辑抽为 `toggleMute()` + `syncMuteLabel()`
- `body.fullscreen` 隐藏工具栏（并修正全屏下侧栏定位）

## 验证记录

- `node --check main.js` → OK；`game.html` / `browser.html` 内联脚本均通过 `node --check`
- 用 Electron `capturePage()` 离屏渲染实测：
  1. 火影新工具栏（薄荷主题）渲染正常，`≡`/标题/变速/👤/⋯/窗口控制齐全
  2. `⋯` 菜单弹出正常，6 个菜单项齐全
  3. 「操作说明」模态渲染正常，8 项功能说明齐全
  4. 暗夜主题下工具栏正常（深色底 + 白字）
  5. 4399 极简窗口渲染正常（仅细条 + ─ ✕，无任何火影功能）
  6. 启动器设置面板新增「抓包导出说明」，5 步流程完整显示且可滚动
- 打包产物 `release-v1.0.0/NarutoOnlineLauncher-Setup-1.0.0.exe`（约 81.2 MB）
- asar 内含 `browser.html` / `4399小游戏` / `menu-popover` / `toggle-fullscreen` / `fullscreen-changed` / `抓包导出说明` / `通灵兽献祭` / `操作说明` / `help-mask`
- `latest.yml` 已重新生成（version 1.0.0）

## 偏差说明

- 4399 窗口按用户确认采用「极简细条（拖动+最小化+关闭）」，而非完全无边框（无边框无法拖动/关闭）。
- 删除 game.html 中已无引用的 `.btn` / `.separator` / `.window-controls` / `.control-btn` 样式（改用 `.tbtn` / `.cbtn`）。

## 遗留 / 待确认

- 打包前发现 `release-v1.0.0\win-unpacked\NarutoOnlineLauncher.exe` 有 5 个残留进程在运行（占用了构建输出文件导致首次构建失败），已结束这些进程后重新构建成功。若那是你正在测试的实例，请重新启动即可。

---

## 后续修复（第二轮）

用户反馈 4 项问题，已修复并重新打包 1.0.0：

| # | 问题 | 修复 |
|---|------|------|
| 1 | 账号管理图标不好看 | `&#128100;`(👤 emoji) → 内联 SVG「users」矢量图标（`stroke: currentColor`，随主题变色，无 emoji 字体依赖）；`.tbtn` 改为 `inline-flex` 居中 |
| 2 | 账号侧边栏 / 账号弹窗未适配主题 | 把硬编码深色（`#1a1a2e`/`#00d4ff`/`#4a4a6a` 等）全部替换为主题变量（`var(--bg1/--bg2/--border/--text/--accent)`）；新增 `--sub` 变量并给 5 套主题补 `sub` 字段；`.add-account-box` 也一并主题化 |
| 3 | 「更多」菜单只能再点一次「更多」才关闭 | 新增 `.menu-backdrop`（`position:fixed; inset:0; z-index:999`，菜单为 1000），菜单打开时显示，点击即关闭。根因：游戏内容在 `<webview>` 内，宿主 `document` 收不到点击事件，原 `document.addEventListener('click')` 对 webview 区域无效 |
| 4 | 4399 窗口缺少最大化按钮 | `browser.html` 增加 `□`（`id="btnMax"` → `ipcRenderer.send('max-window')`）；`createGameWindow` 已注册 `max-window`，无需主进程改动 |

顺带把 `--toolbarHeight` 由 36px 调整为 44px（与启动器标题栏一致，按钮不再局促），`:root` 默认值同步为 mint 主题色避免首帧闪白。

验证：
- 菜单开合断言 `{"opened":true,"closedByBackdrop":true,"reopened":true,"toggled":true}`（点弹窗外可关闭）
- 离屏渲染确认：账号侧栏在薄荷/暗夜两套主题下均正确着色；4399 窗口含 `─ □ ✕`
- 重新打包：exe 元数据（FileVersion=1.0.0 / ProductVersion=1.0.0.0）、图标、asar 内容均校验通过

---

## 后续修复（第三轮）

**问题**：4399 窗口右上角有个去不掉的黄色激活框。

**根因**：Chromium 的默认焦点环（`outline: auto`），其颜色取自 Windows 系统强调色（本机为橙黄 `rgb(229,151,0)`）。窗口控制按钮没有显式声明 focus 样式，因此按钮获得焦点后（键盘 Tab、或窗口重新获得焦点）会残留这个黄框。

诊断证据：`getComputedStyle(btnMax)` → `outlineStyle:"auto", outlineColor:"rgb(229, 151, 0)"`。

**修复**：在 `browser.html`、`game.html`、启动器（`main.js` 内联样式）各加一条：

```css
button:focus, button:focus-visible { outline: none; }
```

**验证**：聚焦后 `outlineStyle` 变为 `none`（两个页面均验证），离屏截图确认 `□` 不再有黄框。


