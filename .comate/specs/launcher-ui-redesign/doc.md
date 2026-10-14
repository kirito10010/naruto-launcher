# 启动器 UI 改版 + 图标更换

## 1. 需求

用户反馈（原文）：

> 图标不好看，还是换回 `C:\Users\kirito\Downloads\火影忍者(Naruto)_爱给网_aigei_com.png` 吧，然后做一个大改动，就是把启动器改一下，要简单时尚颜色清新。你先把现有的严肃看一看，然后设计一个美观的方式。特别是设置主题，我觉得可以做一个设置建，点开进行换主题。这样收藏起来更简约美观。按钮颜色整体UI设计，一定要清新。然后还有标题栏，这个标题栏好像是Electron原生的，不好看。把他删了自己写。

拆解为 4 个子需求：

| # | 子需求 | 说明 |
|---|--------|------|
| R1 | 更换应用图标 | 换回用户指定的 128×128 火影（木叶）图标 |
| R2 | 启动器 UI 重设计 | 简单、时尚、配色清新；按钮/整体 UI 统一清新风格 |
| R3 | 设置面板 | 把「换主题」收进一个设置按钮点开的设置面板；顺带把 Flash 版本、抓包开关也收进去，主界面更简约 |
| R4 | 自绘标题栏 | 去掉 Electron 原生标题栏（`frame:false`），自己画标题栏 + 最小化/关闭按钮 |

---

## 2. 现状分析（改造前）

### 2.1 启动器窗口 `main.js: createLauncherWindow()`（L983-1337）

- `new BrowserWindow({ width, height, title:'火影忍者Online启动器', resizable:false, maximizable:false, minimizable:true, ... })`
  - **没有 `frame:false`** → 使用 Electron/Windows 原生标题栏（R4 要改的根因）
- 窗口尺寸：`baseWidth=350, baseHeight=600`，再按 `dpr*0.8` 放大（L990-995）
- 页面内容用 `data:text/html` 内联（L1015-1315），`loadURL(encodeURIComponent(html))`（L1317）
- 结构：`header`（标题 + 4 个圆形主题点）→ `game-list`（2 个 `.game-item`）→ `footer`（QQ群/网站按钮 + Flash 版本 select + 抓包 checkbox）
- 主题：4 套 `light/dark/blue/orange`，`applyTheme()` 在页面脚本里写死 CSS 变量，切换走 `ipcRenderer.send('set-theme', theme)`（L1233-1283）
- `did-finish-load` 时下发 `theme-changed / flash-choice / capture-state`（L1319-1323）

### 2.2 主进程主题数据（散落 3 处，需统一）

- `getThemeCSS()`（L297-305）：给 **游戏窗口** game.html 工具栏注入的 CSS 字符串，key 为 `light/dark/blue/orange`
- `getThemeColors()`（L307-359）：给窗口 `backgroundColor` 用，含 `bg1/bg2/border/text/btnBg/btnHover/btnBorder/separator/accent/gradient`
- `game.html: applyTheme()`（L1461-1520）：又一份同样的 `light/dark/blue/orange` 映射，应用 `--bg1/--bg2/.../--accent`
- `loadConfig()` L273：`currentTheme = config.theme || 'light'`
- `set-theme` IPC（L2250-2267）：写 config，向启动器发 `theme-changed`，向所有游戏窗口发 `theme-update`

> 主题数据三处重复且 key 写死。本次要引入新主题 key，必须同时改这 3 处并做旧值迁移。

### 2.3 图标

- `package.json build.icon = "resources/icons/Naruto.png"`，同时 `extraResources` 把 `resources/icons/` 拷到安装目录
- `createTray()`（L1635-1641）用 `getResourcePath('icons','Naruto.png')` 作为托盘图标
- 当前该 PNG 是上一版生成的 512×512 方形图（火影忍者免抠图 107）
- 新源图：`C:\Users\kirito\Downloads\火影忍者(Naruto)_爱给网_aigei_com.png`，**128×128, Format32bppArgb**（橙色圆角方块 + 白色木叶漩涡）
- **关键约束**：electron-builder 对 Windows 图标要求 ≥ 256×256，128×128 直接打包会报错 → 需放大到 512×512

### 2.4 可复用的既有模式

- `game.html` 已经是无边框窗口：`.toolbar { -webkit-app-region: drag }`（L36）、按钮 `no-drag`，`min-window/max-window/close-window` IPC（main.js L1451-1474）。R4 直接沿用该模式。

---

## 3. 方案设计

### 3.1 R1 图标

用 Pillow 以 LANCZOS 把 128×128 放大到 512×512（保留 alpha），覆盖 `resources/icons/Naruto.png`。

- 命令行（一次性）：
  ```
  python -c "from PIL import Image; im=Image.open(r'C:\Users\kirito\Downloads\火影忍者(Naruto)_爱给网_aigei_com.png').convert('RGBA'); im.resize((512,512), Image.LANCZOS).save(r'd:\Project\naruto-launcher\resources\icons\Naruto.png')"
  ```
- 打包图标、托盘图标均自动沿用（路径不变），无需改 `package.json`。

### 3.2 R2 + R3 启动器 UI 重设计

#### 视觉基调（清新）
- 背景：柔和的双色斜向渐变（薄荷绿→浅蓝）
- 卡片：半透明白 + 柔和边框 + 大圆角（14px）+ 轻投影
- 主色：**薄荷青 `#14b8a6`**，按钮为青→浅青渐变胶囊
- 字体：`Microsoft YaHei`，主色深灰 `#1e2a37`，次要 `#7c8794`
- 交互：卡片 hover 上浮、主题卡选中描边、设置面板上滑

#### 布局
```
┌───────────────────────────────┐
│ [logo] 火影忍者启动器    ─  ✕ │  ← 自绘标题栏（可拖动）
├───────────────────────────────┤
│  ┌─────────────────────────┐  │
│  │ 🔥  火影忍者Online      › │  │  ← 游戏卡
│  │     huoying.qq.com       │  │
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │ 🎮  4399小游戏          › │  │
│  │     www.4399.com         │  │
│  └─────────────────────────┘  │
│                               │
│      (弹性空白)               │
│                               │
│   [ 💬 加入QQ群 ] [ 🌐 官网 ]  │  ← 胶囊快捷按钮
│                               │
├───────────────────────────────┤
│  ⚙ 设置                v1.0.0 │  ← 底栏
└───────────────────────────────┘
```

#### 设置面板（点 ⚙ 上滑弹出，带半透明遮罩）
```
┌───────────────────────────────┐
│  设置                      ✕  │
│  主题                          │
│  [薄荷][天空][樱花][暖阳][暗夜] │  ← 色卡，选中描边
│  Flash 版本                    │
│  [内置国际版 32.0.0.344    ▾] │
│  抓包模式（每周导出）   [开关]  │
└───────────────────────────────┘
```

#### 主题集合（5 套，统一 key）
| key | 名称 | 背景 | 主色 |
|-----|------|------|------|
| `mint` | 薄荷（默认） | `linear-gradient(160deg,#e8f9f5,#eef4fd)` | `#14b8a6` |
| `sky` | 天空 | `linear-gradient(160deg,#e6f2ff,#eef6ff)` | `#3b82f6` |
| `sakura` | 樱花 | `linear-gradient(160deg,#ffeef4,#fdf0ff)` | `#ec4899` |
| `amber` | 暖阳 | `linear-gradient(160deg,#fff4e6,#ffe9d6)` | `#f97316` |
| `night` | 暗夜 | `linear-gradient(160deg,#151b24,#10141b)` | `#2dd4bf` |

**旧值迁移**：`light→mint`、`blue→sky`、`orange→amber`、`dark→night`。

#### 主题数据统一（消除三处重复）
在 `main.js` 顶部定义单一数据源 `THEMES`：

```js
const THEMES = {
  mint: {
    name: '薄荷',
    bg: 'linear-gradient(160deg,#e8f9f5 0%,#eef4fd 100%)',
    panel: 'rgba(255,255,255,0.88)',
    panelBorder: 'rgba(20,184,166,0.16)',
    text: '#1e2a37',
    sub: '#7c8794',
    accent: '#14b8a6',
    accent2: '#2dd4bf',
    accentText: '#ffffff',
    hover: 'rgba(20,184,166,0.10)',
    shadow: 'rgba(20,184,166,0.25)',
    toolbarBg: 'linear-gradient(180deg,#ffffff,#f0fdfa)',
    toolbarBorder: '#d7ece8',
    toolbarBtn: '#ffffff',
    toolbarBtnBorder: '#cfe3df',
    toolbarSep: '#dbe7e5'
  },
  sky:    { name:'天空', bg:'linear-gradient(160deg,#e6f2ff 0%,#eef6ff 100%)', panel:'rgba(255,255,255,0.88)', panelBorder:'rgba(59,130,246,0.16)', text:'#1e2a3a', sub:'#7d8899', accent:'#3b82f6', accent2:'#60a5fa', accentText:'#ffffff', hover:'rgba(59,130,246,0.10)', shadow:'rgba(59,130,246,0.25)', toolbarBg:'linear-gradient(180deg,#ffffff,#eff6ff)', toolbarBorder:'#d7e6fb', toolbarBtn:'#ffffff', toolbarBtnBorder:'#cfe0f7', toolbarSep:'#dbe7f7' },
  sakura: { name:'樱花', bg:'linear-gradient(160deg,#ffeef4 0%,#fdf0ff 100%)', panel:'rgba(255,255,255,0.88)', panelBorder:'rgba(236,72,153,0.16)', text:'#3a1e2a', sub:'#997d8a', accent:'#ec4899', accent2:'#f472b6', accentText:'#ffffff', hover:'rgba(236,72,153,0.10)', shadow:'rgba(236,72,153,0.25)', toolbarBg:'linear-gradient(180deg,#ffffff,#fff1f7)', toolbarBorder:'#f7d7e6', toolbarBtn:'#ffffff', toolbarBtnBorder:'#f0cfe0', toolbarSep:'#f3dbe8' },
  amber:  { name:'暖阳', bg:'linear-gradient(160deg,#fff4e6 0%,#ffe9d6 100%)', panel:'rgba(255,255,255,0.90)', panelBorder:'rgba(249,115,22,0.18)', text:'#3a2a1e', sub:'#9a8a7d', accent:'#f97316', accent2:'#fb923c', accentText:'#ffffff', hover:'rgba(249,115,22,0.10)', shadow:'rgba(249,115,22,0.25)', toolbarBg:'linear-gradient(180deg,#ffffff,#fff7ed)', toolbarBorder:'#f7e0c8', toolbarBtn:'#ffffff', toolbarBtnBorder:'#f0d7bd', toolbarSep:'#f3e2d0' },
  night:  { name:'暗夜', bg:'linear-gradient(160deg,#151b24 0%,#10141b 100%)', panel:'rgba(255,255,255,0.06)', panelBorder:'rgba(255,255,255,0.10)', text:'#e6edf3', sub:'#8b97a6', accent:'#2dd4bf', accent2:'#22d3ee', accentText:'#04231f', hover:'rgba(45,212,191,0.12)', shadow:'rgba(0,0,0,0.45)', toolbarBg:'linear-gradient(180deg,#1b2430,#161b22)', toolbarBorder:'#2a3442', toolbarBtn:'#222c38', toolbarBtnBorder:'#33404f', toolbarSep:'#2a3442' }
};
const THEME_ALIAS = { light:'mint', blue:'sky', orange:'amber', dark:'night' };
function normalizeTheme(t){ t = THEME_ALIAS[t] || t; return THEMES[t] ? t : 'mint'; }
```

- `getThemeColors()` → 改为从 `THEMES[currentTheme]` 派生（`bg1` 取 `panel` 之外的窗口底色，用一个 `winBg` 字段；这里直接用 `bg` 起始色，新增 `winBg` 字段）
- `getThemeCSS()` → 用 `THEMES[currentTheme]` 的 `toolbar*` 字段拼出工具栏 CSS
- 启动器 HTML 里注入 `const THEMES = ${JSON.stringify(THEMES)}`，`applyTheme` 读它设置 CSS 变量（不再手写重复 map）
- `game.html: applyTheme` → 更新为 5 个新 key（用 `toolbar*` 字段），保留旧 key 兜底

#### 启动器窗口选项
```js
launcherWindow = new BrowserWindow({
  width: scaledWidth, height: scaledHeight,
  title: '火影忍者启动器',
  frame: false,              // R4：去掉原生标题栏
  resizable: false,
  maximizable: false,
  minimizable: true,
  backgroundColor: THEMES[currentTheme].winBg,
  webPreferences: { nodeIntegration:true, contextIsolation:false, webSecurity:false, enableRemoteModule:true }
});
launcherWindow.setMenu(null);
```

#### 自绘标题栏（R4）
- 顶部 `.titlebar` 高 44px，`-webkit-app-region: drag`
- 左侧：logo（`nativeImage.createFromPath(icon).resize({width:34}).toDataURL()` 注入 `<img>`）+ 标题「火影忍者启动器」
- 右侧：`—`（最小化）、`✕`（关闭），`-webkit-app-region: no-drag`，hover 变色，关闭按钮 hover 变红
- IPC：新增 `launcher-minimize` → `launcherWindow.minimize()`；`launcher-close` → `launcherWindow.close()`（沿用既有 close→hide 到托盘逻辑，行为不变）

### 3.3 数据流

```
点击主题色卡
  → ipcRenderer.send('set-theme', 'sky')
  → main: currentTheme='sky'; saveConfig()
  → 启动器: send('theme-changed','sky') → applyTheme() 改 CSS 变量
  → 游戏窗口: send('theme-update','sky') → game.html applyTheme() 改工具栏

点击 ⚙ 设置 → 前端 slide-up 面板（纯前端，无需 IPC）
Flash 版本下拉 → send('set-flash-choice')（既有，不变）
抓包开关 → send('set-capture')（既有，不变）
标题栏 ─ → send('launcher-minimize')
标题栏 ✕ → send('launcher-close') → window.close() → 既有 close 拦截 → hide 到托盘
```

---

## 4. 受影响文件

| 文件 | 改动类型 | 位置 | 说明 |
|------|----------|------|------|
| `resources/icons/Naruto.png` | 替换 | — | 128×128 → 512×512（Pillow LANCZOS） |
| `main.js` | 新增/重写 | 顶部 | 新增 `THEMES`、`THEME_ALIAS`、`normalizeTheme()` |
| `main.js` | 重写 | L297-359 | `getThemeCSS()` / `getThemeColors()` 改为读 `THEMES` |
| `main.js` | 修改 | L273 | `loadConfig()` 主题旧值迁移 |
| `main.js` | 重写 | L983-1337 | `createLauncherWindow()`：窗口选项 + 全新 HTML/CSS/JS |
| `main.js` | 新增 | whenReady 内 | IPC `launcher-minimize` / `launcher-close` |
| `main.js` | 修改 | L2250-2267 | `set-theme` 用 `normalizeTheme()` |
| `game.html` | 修改 | L1461-1520 | `applyTheme` 主题 map 换成新 key（保持游戏工具栏同步） |
| `package.json` | 不变 | — | icon 路径不变；`files` 已含所需文件 |

---

## 5. 关键代码（启动器页面）

> 完整内联在 `createLauncherWindow()`，此处给出核心结构。

```html
<body>
  <!-- 自绘标题栏 -->
  <header class="titlebar">
    <div class="tb-left">
      <img class="tb-logo" src="${logoDataUrl}">
      <span class="tb-title">火影忍者启动器</span>
    </div>
    <div class="tb-actions">
      <button class="tb-btn" id="btnMin" title="最小化">&#8211;</button>
      <button class="tb-btn tb-close" id="btnClose" title="关闭">&#10005;</button>
    </div>
  </header>

  <main class="content">
    <div class="game-list">
      <div class="game-card" onclick="launchGame('https://huoying.qq.com/','火影忍者Online')">
        <div class="gc-emoji">🔥</div>
        <div class="gc-body">
          <div class="gc-title">火影忍者Online</div>
          <div class="gc-sub">huoying.qq.com</div>
        </div>
        <div class="gc-go">›</div>
      </div>
      <div class="game-card" onclick="launchGame('https://www.4399.com/','4399小游戏')">
        <div class="gc-emoji">🎮</div>
        <div class="gc-body">
          <div class="gc-title">4399小游戏</div>
          <div class="gc-sub">www.4399.com</div>
        </div>
        <div class="gc-go">›</div>
      </div>
    </div>

    <div class="quick">
      <button class="pill" onclick="joinQQGroup()">💬 加入QQ群</button>
      <button class="pill" onclick="openSite()">🌐 官方网站</button>
    </div>
  </main>

  <footer class="bottombar">
    <button class="settings-btn" id="btnSettings">⚙ 设置</button>
    <span class="ver">v${CURRENT_VERSION}</span>
  </footer>

  <!-- 设置面板 -->
  <div class="sheet-mask" id="sheetMask"></div>
  <section class="sheet" id="sheet">
    <div class="sheet-head">
      <span>设置</span>
      <button class="sheet-close" id="btnSheetClose">✕</button>
    </div>
    <div class="sheet-body">
      <div class="sec-title">主题</div>
      <div class="theme-grid" id="themeGrid"></div>

      <div class="sec-title">Flash 版本</div>
      <select class="sel" id="flashSelect" onchange="changeFlash(this.value)">
        <option value="bundled">内置国际版 32.0.0.344</option>
        <option value="system">内置国内版 34.0.0.380</option>
      </select>

      <div class="row">
        <span class="row-label">抓包模式<span class="row-hint">每周导出用，切换后需重启</span></span>
        <label class="switch">
          <input type="checkbox" id="captureChk" onchange="toggleCapture(this.checked)">
          <span class="track"></span>
        </label>
      </div>
    </div>
  </section>
</body>
```

CSS 要点：
```css
:root{ --bg:...; --panel:...; --border:...; --text:...; --sub:...; --accent:...; --accent2:...; --accentText:...; --hover:...; --shadow:...; }
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;font-family:'Microsoft YaHei',sans-serif;color:var(--text)}
body{background:var(--bg);display:flex;flex-direction:column}
.titlebar{height:44px;display:flex;align-items:center;justify-content:space-between;
  padding:0 6px 0 14px;-webkit-app-region:drag;user-select:none}
.tb-left{display:flex;align-items:center;gap:9px}
.tb-logo{width:24px;height:24px;border-radius:6px}
.tb-title{font-size:13.5px;font-weight:600;letter-spacing:.3px}
.tb-actions{display:flex;-webkit-app-region:no-drag}
.tb-btn{width:34px;height:30px;border:none;background:transparent;color:var(--sub);
  font-size:13px;border-radius:8px;cursor:pointer;transition:.18s}
.tb-btn:hover{background:var(--hover);color:var(--text)}
.tb-close:hover{background:#ef4444;color:#fff}
.content{flex:1;display:flex;flex-direction:column;padding:6px 16px 0;gap:14px;overflow:hidden}
.game-list{display:flex;flex-direction:column;gap:12px}
.game-card{display:flex;align-items:center;gap:13px;padding:15px 16px;
  background:var(--panel);border:1px solid var(--border);border-radius:15px;cursor:pointer;
  box-shadow:0 4px 14px var(--shadow);transition:transform .18s, box-shadow .18s}
.game-card:hover{transform:translateY(-2px);box-shadow:0 8px 22px var(--shadow)}
.gc-emoji{font-size:22px;width:40px;height:40px;display:grid;place-items:center;
  background:var(--hover);border-radius:12px}
.gc-body{flex:1;min-width:0}
.gc-title{font-size:15px;font-weight:600}
.gc-sub{font-size:11.5px;color:var(--sub);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gc-go{font-size:20px;color:var(--sub)}
.quick{margin-top:auto;display:flex;gap:10px;padding-bottom:6px}
.pill{flex:1;padding:10px;border:none;border-radius:12px;cursor:pointer;font-size:12.5px;
  font-weight:600;color:var(--accentText);background:linear-gradient(135deg,var(--accent),var(--accent2));
  box-shadow:0 5px 14px var(--shadow);transition:transform .16s,filter .16s}
.pill:hover{transform:translateY(-1px);filter:brightness(1.05)}
.bottombar{height:46px;display:flex;align-items:center;justify-content:space-between;
  padding:0 16px;border-top:1px solid var(--border);background:var(--panel)}
.settings-btn{border:none;background:transparent;color:var(--text);font-size:13px;
  font-weight:600;cursor:pointer;padding:8px 12px;border-radius:10px;transition:.18s}
.settings-btn:hover{background:var(--hover);color:var(--accent)}
.ver{font-size:11px;color:var(--sub)}
/* 设置面板 */
.sheet-mask{position:fixed;inset:0;background:rgba(0,0,0,.28);opacity:0;
  pointer-events:none;transition:.24s}
.sheet{position:fixed;left:0;right:0;bottom:0;background:var(--panel);backdrop-filter:blur(8px);
  border-top-left-radius:20px;border-top-right-radius:20px;padding:16px 18px 22px;
  transform:translateY(110%);transition:transform .28s cubic-bezier(.2,.8,.2,1);
  box-shadow:0 -8px 30px rgba(0,0,0,.18)}
.sheet.open{transform:translateY(0)}
.sheet-mask.open{opacity:1;pointer-events:auto}
.theme-grid{display:flex;gap:12px;margin:10px 0 18px}
.theme-card{flex:1;height:52px;border-radius:12px;cursor:pointer;position:relative;
  border:2px solid transparent;transition:.18s}
.theme-card.active{border-color:var(--accent);box-shadow:0 0 0 3px var(--shadow)}
.theme-card span{position:absolute;bottom:4px;left:0;right:0;text-align:center;
  font-size:10.5px;color:#333;text-shadow:0 1px 2px rgba(255,255,255,.6)}
```

主题色卡用内联 style 生成背景（每个主题一个渐变预览），点击 → `setTheme(key)`。

JS 要点：
```js
const THEMES = ${JSON.stringify(THEMES)};   // 主进程注入
let curTheme = '${currentTheme}';
function applyTheme(t){
  const th = THEMES[t] || THEMES.mint;
  const r = document.documentElement.style;
  r.setProperty('--bg', th.bg); r.setProperty('--panel', th.panel);
  r.setProperty('--border', th.panelBorder); r.setProperty('--text', th.text);
  r.setProperty('--sub', th.sub); r.setProperty('--accent', th.accent);
  r.setProperty('--accent2', th.accent2); r.setProperty('--accentText', th.accentText);
  r.setProperty('--hover', th.hover); r.setProperty('--shadow', th.shadow);
  document.querySelectorAll('.theme-card').forEach(c =>
    c.classList.toggle('active', c.dataset.theme === t));
  curTheme = t;
}
function setTheme(t){ ipcRenderer.send('set-theme', t); }
// 生成主题卡
(function buildThemeGrid(){
  const g = document.getElementById('themeGrid');
  Object.keys(THEMES).forEach(k=>{
    const c=document.createElement('div');
    c.className='theme-card'; c.dataset.theme=k;
    c.style.background=THEMES[k].bg;
    c.innerHTML='<span>'+THEMES[k].name+'</span>';
    c.onclick=()=>setTheme(k);
    g.appendChild(c);
  });
})();
// 标题栏
document.getElementById('btnMin').onclick = ()=>ipcRenderer.send('launcher-minimize');
document.getElementById('btnClose').onclick = ()=>ipcRenderer.send('launcher-close');
// 设置面板
const sheet=document.getElementById('sheet'), mask=document.getElementById('sheetMask');
document.getElementById('btnSettings').onclick=()=>{sheet.classList.add('open');mask.classList.add('open')};
const closeSheet=()=>{sheet.classList.remove('open');mask.classList.remove('open')};
document.getElementById('btnSheetClose').onclick=closeSheet;
mask.onclick=closeSheet;
ipcRenderer.on('theme-changed',(e,t)=>applyTheme(t));
ipcRenderer.on('flash-choice',(e,c)=>{const s=document.getElementById('flashSelect');if(s)s.value=c||'bundled'});
ipcRenderer.on('capture-state',(e,on)=>{const c=document.getElementById('captureChk');if(c)c.checked=!!on});
document.addEventListener('DOMContentLoaded',()=>applyTheme(curTheme));
```

---

## 6. 边界与异常

| 场景 | 处理 |
|------|------|
| 旧配置 `theme:'light'` 等 | `normalizeTheme()` 迁移；`loadConfig` 里 `currentTheme = normalizeTheme(config.theme)` |
| 未知主题 key | `normalizeTheme` 回退 `mint`；前端 `THEMES[t] || THEMES.mint` |
| 图标文件缺失 | `nativeImage.createFromPath` 失败 → `toDataURL()` 为空 → 标题栏 logo `onerror` 隐藏（加 `onerror="this.style.display='none'"`） |
| 图标 <256×256 | 打包前用 Pillow 放大到 512×512，避免 electron-builder 报错 |
| 设置面板与标题栏拖动冲突 | 面板/按钮全部 `-webkit-app-region: no-drag`（默认在 titlebar 外，无需重复；确保 `.tb-actions` 明确 no-drag） |
| 窗口不可缩放 | `resizable:false`，无最大化按钮 |
| 关闭按钮 | 沿用既有 `close→hide` 到托盘，不退出进程（行为与改造前一致） |
| 暗夜主题下的主题卡文字 | 主题卡文字用固定深色 + 浅色描边（卡片背景本身是浅色渐变预览，深色文字可读） |

---

## 7. 验收标准

1. 应用图标（桌面/任务栏/托盘）为新的木叶橙色图标；打包成功无图标报错。
2. 启动器无原生标题栏，顶部为自绘标题栏，可拖动窗口；`─` 最小化、`✕` 关闭（隐藏到托盘）生效。
3. 主界面仅保留：游戏卡 ×2、快捷按钮 ×2、底栏（设置 + 版本号）；整体清新。
4. 点「⚙ 设置」上滑弹出设置面板，内含主题色卡、Flash 版本、抓包开关。
5. 切换 5 套主题，启动器即时变色；游戏窗口工具栏同步变色。
6. 旧主题配置能正确迁移，不报错。
7. `node --check main.js` 通过；打包 1.0.0 成功。

---

## 8. 不在本次范围

- 游戏窗口（game.html）工具栏的重设计（仅同步主题色，不改布局）
- 启动器窗口圆角/阴影（Electron 11 透明窗口在 Windows 上不稳定，保持直角，仅内部做圆角卡片）
- 账号管理窗口（accountWindow）的 UI
