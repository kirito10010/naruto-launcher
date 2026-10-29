# 主题扩充到 10 套 + 主题体系统一（main.js / game.html / browser.html）

- [x] Task 1: 重写 main.js 的主题数据源为 10 套
    - 1.1: `THEMES` 优化现有 5 套（mint/sky/sakura/amber/night）：`bg` 改为有色相的渐变、`winBg` 对齐渐变起始色、panel/panelBorder/hover/shadow 按各自 accent 重新对齐
    - 1.2: 新增 5 套（violet/forest/crimson/mocha/graphite），按 doc.md 3.3 的调色板；顺序为 mint, sky, sakura, amber, night, violet, forest, crimson, mocha, graphite
    - 1.3: 把死字段 `toolbarBg` 替换为 `toolbarBg1` / `toolbarBg2`（取值等于现在 game.html 表里的 bg1/bg2，保证现有 5 套游戏窗口观感不变）
    - 1.4: `getThemeColors()` 补 `sub`、`border` 改用 `toolbarBorder`、`bg1/bg2` 改用 `toolbarBg1/toolbarBg2`

- [x] Task 2: 主进程统一推送主题颜色对象
    - 2.1: 游戏窗口加载完成处（`did-finish-load`）的 `theme-update` 改发 `getThemeColors()`
    - 2.2: `set-theme` 广播给所有游戏窗口处改发 `getThemeColors()`
    - 2.3: browser（4399）窗口发送处同步改发 `getThemeColors()`
    - 2.4: 游戏窗口 `backgroundColor: '#ffffff'` 改为当前主题的 `winBg`

- [x] Task 3: 启动器主题区适配 10 套
    - 3.1: `.theme-grid` 由单行 flex 改为 `display:grid; grid-template-columns:repeat(5,1fr); gap:8px`
    - 3.2: `.theme-card` 高度 52px → 46px
    - 3.3: 新增 `.theme-card.dark span`（浅色文字 + 深色阴影），`buildThemeGrid()` 按 `winBg` 相对亮度给暗色主题加 `dark` 类
    - 3.4: `.sheet-body` 的 `max-height` 62vh → 70vh，保证多一行主题后仍不出现滚动条

- [x] Task 4: game.html 去掉重复主题表
    - 4.1: 删除 `applyTheme()` 内联的 `themes` 表与 `themes.light/blue/orange/dark` 兼容行
    - 4.2: `applyTheme(colors)` 改为直接用传入的颜色对象写 `--bg1/--bg2/--border/--text/--sub/--btnBg/--btnHover/--btnBorder/--separator/--accent`，并对缺字段做兜底

- [x] Task 5: browser.html 去掉重复主题表
    - 5.1: 删除内联 `THEMES` 表
    - 5.2: `applyTheme(colors)` 改为直接用传入的颜色对象写 `--bg1/--bg2/--border/--text/--accent`，并对缺字段做兜底

- [x] Task 6: 验证
    - 6.1: `node --check main.js` 通过
    - 6.2: 开发模式启动，逐个点选 10 套主题并截图确认：启动器背景/面板/按钮颜色随主题变化、主题卡片 2×5 排列且暗色卡片文字清晰
    - 6.3: 打开火影游戏窗口与 4399 窗口，确认两处工具栏颜色跟随主题（切换主题后即时生效、无白色残留）
