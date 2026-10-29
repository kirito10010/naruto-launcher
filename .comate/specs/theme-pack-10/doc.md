# 主题扩充到 10 套 + 主题体系统一（优化现有 5 套）

## 1. 需求

1. **优化现有 5 套主题**（薄荷 / 天空 / 樱花 / 暖阳 / 暗夜）。
2. **新增 5 套主题**，共 **10 套**。

## 2. 现状

### 2.1 主题表被复制了三份（同一个 key，三处各自维护）

| 位置 | 内容 | 消费者 |
| --- | --- | --- |
| `main.js` `THEMES`（第 65–161 行） | 完整字段（name/bg/winBg/panel/panelBorder/text/sub/accent/accent2/accentText/hover/shadow/toolbarBg/toolbarBorder/toolbarBtn/toolbarBtnBorder/toolbarSep） | 启动器界面 |
| `game.html` `applyTheme()` 内联 `themes` 表（第 1650–1717 行） | 精简字段（bg1/bg2/border/text/sub/btnBg/btnHover/btnBorder/separator/accent） | 火影游戏窗口工具栏 |
| `browser.html` 内联 `THEMES` 表（第 54–60 行） | 更精简（bg1/bg2/border/text/accent） | 4399 极简窗口 |

主进程通过 `theme-update` 只发**主题 key**，两个窗口各自查自己的表 → 加主题要改三处，且已经出现漂移（见 2.3）。

### 2.2 现有 5 套的实际问题

1. **4 套浅色主题几乎分不出来**：`bg` 都是极浅的线性渐变（如 `#e8f9f5 → #eef4fd`），只有 accent 色不同，整体观感都是"白底 + 一点颜色"。
2. **暗色主题下主题卡片文字看不清**：`.theme-card span` 硬编码 `color:#333` + 白色文字阴影，在 `暗夜` 卡片上几乎不可读。
3. **游戏窗口在暗色主题下白闪**：游戏窗口 `backgroundColor: '#ffffff'` 硬编码。
4. **字段漂移**：`game.html` 里 mint 的 `border` 是 `#d7ece8`（= `toolbarBorder`），而 `main.js` 的 `getThemeColors().border` 给的是 `panelBorder`；`game.html` 还有自己的 `sub`，而 `getThemeColors()` **没有** `sub`。也就是两边对同一个 key 的颜色并不一致。
5. **死字段**：`THEMES` 里的 `toolbarBg` 全项目无任何使用（`toolbarBorder` 也只在 `getThemeColors()` 之外没被用到）。
6. **网格是单行 flex**：`.theme-grid { display:flex; gap:10px }` + `.theme-card { flex:1 }`，10 个卡片挤在一行每个只有约 29px 宽，放不下。

## 3. 方案

### 3.1 主题体系统一为「单一数据源」

- `THEMES` 保持唯一数据源；把 `toolbarBg`（死字段）拆成真正需要的 **`toolbarBg1` / `toolbarBg2`**（游戏窗口工具栏渐变的两个色标，取值等于现在 `game.html` 表里的 `bg1`/`bg2`，**保证现有 5 套观感不变**）。
- `getThemeColors()` 补齐 `sub`，并把 `border` 改为 `toolbarBorder`（= 现在 `game.html` 实际在用的值），同时返回 `toolbarBg1/2` 作为 `bg1/bg2`。
- 两个窗口的 `theme-update` **改发颜色对象**（`getThemeColors()` 的返回值）而不是主题 key：
  - `game.html`：删掉内联 `themes` 表，`applyTheme(colors)` 直接把对象写进 CSS 变量。
  - `browser.html`：删掉内联 `THEMES` 表，同上。
  - 主进程 3 个发送点（游戏窗口加载完、`set-theme` 广播、browser 窗口）统一发颜色对象。
- 结果：**以后加/改主题只改 `main.js` 一处**，三个界面自动同步。

### 3.2 优化现有 5 套

| key | 名称 | bg（启动器背景） | winBg | accent / accent2 |
| --- | --- | --- | --- | --- |
| `mint` | 薄荷 | `linear-gradient(160deg,#dff5ef 0%,#e7f1fb 100%)` | `#e3f4ef` | `#14b8a6` / `#2dd4bf` |
| `sky` | 天空 | `linear-gradient(160deg,#dceafd 0%,#eaf3ff 100%)` | `#dfeafc` | `#3b82f6` / `#60a5fa` |
| `sakura` | 樱花 | `linear-gradient(160deg,#ffe3ed 0%,#faeafd 100%)` | `#fde5ef` | `#ec4899` / `#f472b6` |
| `amber` | 暖阳 | `linear-gradient(160deg,#ffeed6 0%,#ffe3c9 100%)` | `#ffecd3` | `#f97316` / `#fb923c` |
| `night` | 暗夜 | `linear-gradient(160deg,#151b24 0%,#10141b 100%)` | `#151b24` | `#2dd4bf` / `#22d3ee` |

改动点：
- `bg` 由「几乎纯白」加深为**有明显色相的渐变**，5 套一眼可分；accent 保持原值，主题识别度不变。
- `winBg` 与渐变起始色对齐，消除窗口创建瞬间的色差。
- `panel` / `panelBorder` / `hover` / `shadow` / `toolbar*` 按各自 accent 重新对齐（浅色族：白色面板 + accent 色描边/光晕；暗色族：半透明白面板 + 浅色描边）。

### 3.3 新增 5 套

| key | 名称 | bg | winBg | accent / accent2 | accentText |
| --- | --- | --- | --- | --- | --- |
| `violet` | 紫罗兰 | `linear-gradient(160deg,#ebe5fd 0%,#f3ecff 100%)` | `#ece6fd` | `#7c3aed` / `#a78bfa` | `#ffffff` |
| `forest` | 森野 | `linear-gradient(160deg,#e1f5e5 0%,#eef8ea 100%)` | `#e4f5e6` | `#15803d` / `#4ade80` | `#ffffff` |
| `crimson` | 绯红 | `linear-gradient(160deg,#ffe3e9 0%,#fdeaf0 100%)` | `#ffe4ea` | `#e11d48` / `#fb7185` | `#ffffff` |
| `mocha` | 摩卡 | `linear-gradient(160deg,#f6ebd9 0%,#faf2e5 100%)` | `#f6ecdb` | `#a16207` / `#d97706` | `#ffffff` |
| `graphite` | 石墨（暗） | `linear-gradient(160deg,#1c1f26 0%,#14171c 100%)` | `#1c1f26` | `#94a3b8` / `#cbd5e1` | `#10151c` |

- 色相分布：青（薄荷）/ 蓝（天空）/ 粉（樱花）/ 橙（暖阳）/ 紫（紫罗兰）/ 绿（森野）/ 红（绯红）/ 棕（摩卡）+ 两套暗色（暗夜=藏青、石墨=中性灰）。
- 名称都 ≤ 3 字，能塞进卡片宽度。
- 数组顺序：`mint, sky, sakura, amber, night, violet, forest, crimson, mocha, graphite` → 两行各 5 个，且两行末位都是暗色，竖向相邻。

### 3.4 主题网格改成 2 行 × 5 列

```css
.theme-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; }
.theme-card { height:46px; }          /* 52px → 46px，省一行高度 */
```
- 卡片标签对比度：`buildThemeGrid()` 用 `winBg` 算相对亮度，暗色主题给卡片加 `dark` 类：
  ```css
  .theme-card.dark span { color:#e9eef5; text-shadow:0 1px 2px rgba(0,0,0,.65); }
  ```
  自动适配，新增暗色主题无需额外配置。
- 设置面板内容会多出一行（约 +54px），把 `.sheet-body` 的 `max-height` 从 `62vh` 提到 `70vh`，保持**不出现滚动条**。

### 3.5 消除游戏窗口白闪

游戏窗口的 `backgroundColor: '#ffffff'` 改为当前主题的 `winBg`（暗色主题下不再闪白）。

## 4. 影响文件

| 文件 | 改动 |
| --- | --- |
| `main.js` | `THEMES` 重写为 10 套（`toolbarBg` → `toolbarBg1/2`）；`getThemeColors()` 补 `sub`、`border` 用 `toolbarBorder`、`bg1/bg2` 用 `toolbarBg1/2`；3 处 `theme-update` 改发颜色对象；游戏窗口 `backgroundColor` 用主题底色；`.theme-grid` 改 2×5 网格、`.theme-card` 高度、新增 `.theme-card.dark span`、`.sheet-body` max-height；`buildThemeGrid()` 加亮度判断 |
| `game.html` | 删除内联 `themes` 表（约 68 行），`applyTheme(colors)` 直接用传入对象写 CSS 变量 |
| `browser.html` | 删除内联 `THEMES` 表，`applyTheme(colors)` 同上 |

## 5. 边界与异常

| 场景 | 处理 |
| --- | --- |
| 老配置里的主题 key | `THEME_ALIAS`（light/blue/orange/dark）与 `normalizeTheme()` 保持不变，非法 key 回落 `mint` |
| 主题切换时游戏窗口已打开 | `set-theme` 广播改发颜色对象，`game.html` / `browser.html` 同步更新 |
| 窗口加载完成时发主题 | 两个发送点（游戏窗口 `did-finish-load`、browser 窗口）都改发颜色对象，避免一个发 key 一个发对象 |
| 窗口收到颜色对象前的首帧 | `game.html` / `browser.html` 的 CSS 变量默认值保持现状（白色系），与 `backgroundColor` 一致，不会闪 |
| 暗色主题卡片文字 | 亮度自动判断，不再硬编码 `#333` |
| 10 个主题的持久化 | 仍只存 key 字符串，`config.json` 结构不变 |

## 6. 预期结果

- 设置面板主题区为 2 行 × 5 列，共 10 套，全部可点选并即时生效。
- 5 套原有主题观感更清爽、彼此可辨；暗色主题卡片文字清晰。
- 10 套主题在启动器、火影游戏窗口、4399 窗口三处表现一致（同一份数据源）。
- 以后新增主题只需改 `main.js` 的 `THEMES`。

## 7. 待确认

1. 新增 5 套的**命名与配色**（3.3 表格）是否满意？可整组替换（例如把「摩卡」换成「鎏金」、「绯红」换成「青柠」等）。
2. 是否接受**网格改为 2 行 × 5 列**（而不是横向滚动的一行）？
3. 是否接受顺手做**主题体系统一**（删掉 `game.html` / `browser.html` 的重复表）？这是让 5 套新主题在游戏窗口也能生效的最省事做法，但会改动这两个文件。
