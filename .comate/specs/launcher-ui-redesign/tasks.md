# 启动器 UI 改版 + 图标更换 任务计划

- [x] Task 1: 更换应用图标
    - 1.1: 用 Pillow（LANCZOS）把 `C:\Users\kirito\Downloads\火影忍者(Naruto)_爱给网_aigei_com.png`（128×128）放大为 512×512，覆盖 `resources/icons/Naruto.png`
    - 1.2: 校验输出 PNG 为 512×512、保留 alpha（供打包图标与托盘图标复用）

- [x] Task 2: 在 main.js 建立统一主题数据源
    - 2.1: 顶部新增 `THEMES`（mint/sky/sakura/amber/night，含 name/bg/panel/panelBorder/text/sub/accent/accent2/accentText/hover/shadow/winBg/toolbar* 字段）
    - 2.2: 新增 `THEME_ALIAS`（light→mint、blue→sky、orange→amber、dark→night）与 `normalizeTheme()`
    - 2.3: 重写 `getThemeColors()`，从 `THEMES[currentTheme]` 派生窗口底色
    - 2.4: 重写 `getThemeCSS()`，用 `THEMES[currentTheme]` 的 `toolbar*` 字段拼出游戏窗口工具栏 CSS
    - 2.5: `loadConfig()` 里 `currentTheme = normalizeTheme(config.theme)`

- [x] Task 3: 重写启动器窗口 `createLauncherWindow()`
    - 3.1: 窗口选项改为 `frame:false` + `title:'火影忍者启动器'` + `backgroundColor: THEMES[currentTheme].winBg`
    - 3.2: 生成标题栏 logo（`nativeImage.createFromPath(icon).resize({width:34}).toDataURL()`）并注入 HTML
    - 3.3: 自绘标题栏 HTML/CSS（drag 区域、logo、标题、`─`/`✕` 按钮，`no-drag`、hover 变色、关闭变红）
    - 3.4: 主界面：游戏卡 ×2（火影/4399）+ 快捷胶囊按钮 ×2（QQ群/官网）+ 底栏（⚙设置 + 版本号）
    - 3.5: 设置面板：遮罩 + 上滑 sheet，含主题色卡网格、Flash 版本 select、抓包开关 switch
    - 3.6: 主题脚本：注入 `THEMES`/`currentTheme`，实现 `applyTheme()`、`buildThemeGrid()`、面板开关、标题栏/Flash/抓包事件绑定
    - 3.7: 整体清新配色 CSS（薄荷青主色、渐变背景、圆角卡片、hover 上浮、过渡动画）

- [x] Task 4: 新增标题栏 IPC 并收口主题切换
    - 4.1: 新增 `launcher-minimize` → `launcherWindow.minimize()`
    - 4.2: 新增 `launcher-close` → `launcherWindow.close()`（沿用既有 close→hide 到托盘逻辑）
    - 4.3: `set-theme` IPC 用 `normalizeTheme()` 归一化后再保存/广播

- [x] Task 5: 同步游戏窗口主题（game.html）
    - 5.1: 更新 `applyTheme()` 的主题 map 为 5 个新 key（用 `toolbar*` 字段），保留旧 key 兜底

- [x] Task 6: 校验与打包
    - 6.1: `node --check main.js` 通过
    - 6.2: 本地 `npm start` 目视验证：无原生标题栏、可拖动、最小化/关闭、5 套主题切换、设置面板
    - 6.3: 打包 1.0.0，确认无图标报错，输出【新增】【优化】【修复】格式的更新说明
