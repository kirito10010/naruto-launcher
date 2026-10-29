# 修复总结：主题扩充到 10 套 + 主题体系统一

## 1. 改动

| 文件 | 改动 |
| --- | --- |
| `main.js` | `THEMES` 扩到 10 套并优化原 5 套；死字段 `toolbarBg` → `toolbarBg1`/`toolbarBg2`；`getThemeColors()` 补 `sub`、`border` 用 `toolbarBorder`、`bg1/2` 用 `toolbarBg1/2`；2 处 `theme-update` 改发颜色对象；启动器/游戏窗口 `backgroundColor` 用主题底色；主题网格改 2×5、卡片高度 46px、新增 `.theme-card.dark span`、`.sheet-body` max-height 70vh；`buildThemeGrid()` 加亮度判断 |
| `game.html` | 删除内联 68 行 `themes` 表，`applyTheme(colors)` 直接用主进程下发的对象 |
| `browser.html` | 删除内联 `THEMES` 表，同上；`.cbtn:hover` 由硬编码 `rgba(0,0,0,.06)` 改为 `var(--btnHover)`（暗色主题下 hover 才可见） |

## 2. 10 套主题

| 行 | 主题 |
| --- | --- |
| 1 | 薄荷（青）/ 天空（蓝）/ 樱花（粉）/ 暖阳（橙）/ 暗夜（藏青·暗） |
| 2 | 紫罗兰（紫）/ 森野（绿）/ 绯红（红）/ 摩卡（棕）/ 石墨（中性灰·暗） |

- 原 5 套的 `bg` 由「几乎纯白」加深为有明显色相的渐变，accent 保持原值；`winBg` 与渐变起始色对齐。
- 新增 5 套的完整字段（含 toolbar* 系）见 `.comate/specs/theme-pack-10/doc.md` 3.3。

## 3. 主题体系统一（本次的「优化」核心）

改前同一个主题 key 被复制在三处：`main.js`、`game.html`、`browser.html`，各自维护、且已经出现漂移（`game.html` 的 `border` 实际是 `toolbarBorder`，而 `getThemeColors().border` 给的是 `panelBorder`；`getThemeColors()` 还缺 `sub`）。

现在：**`main.js` 的 `THEMES` 是唯一数据源**，主进程通过 `theme-update` 下发解析好的颜色对象，两个窗口直接写 CSS 变量。以后加/改主题只改一处。

顺带修掉的：
- 主题卡片标签原为硬编码 `color:#333` + 白色阴影，暗色卡片上不可读 → 按 `winBg` 亮度自动切浅色。
- 游戏窗口 `backgroundColor` 原硬编码 `#ffffff`，暗色主题下开窗闪白 → 改为主题底色。

## 4. 验证

- `node --check main.js` 通过；`game.html` / `browser.html` 内联脚本解析通过。
- 开发模式截图确认：
  - 主题区 2 行 × 5 列共 10 套，全部可点选并即时生效；暗色卡片（暗夜/石墨）标签清晰可读。
  - 薄荷 / 暖阳 / 紫罗兰 / 石墨 逐一实测，启动器背景、面板、下拉框、说明按钮、开关均随主题变化。
  - 4399 窗口（browser.html）与火影游戏窗口（game.html）工具栏均随主题变化。
- 工具栏颜色用像素采样复核（缩略图肉眼易误判）：
  - 石墨主题：4399 工具栏 `rgb(32,36,43)`、游戏窗口工具栏 `rgb(30,33,40)`，与 `toolbarBg1 #22262e`(34,38,46) / `toolbarBg2 #1a1d23`(26,29,35) 一致。
  - 暖阳主题：4399 工具栏 `rgb(255,253,250)` / `rgb(255,250,244)`，与 `#ffffff → #fff7ed` 一致。

## 5. 版本

改动归入 **1.4.0**；本次未打包。
