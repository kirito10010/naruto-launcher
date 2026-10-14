# 游戏窗口工具栏重做 + F11 全屏 + 操作说明 + 4399 解耦

## 1. 需求

用户原文：

> 启动器启动火影忍者后上面那个标题栏+工具栏组合版的这个也是Electron原生的，不好看，去掉重做，上面的功能重新排版收纳，要和启动器一样简洁清新，点击全屏后标题栏还在，所以我们现在在加一个功能就是按F11全屏。这个全屏是不带标题栏的。再按一次恢复。然后还要有一个操作说明。说明启动这个火影的一些功能
> 然后4399启动，上面应该什么都没有，因为那些功能都是给火影忍者启动准备的。这两个解耦
> 对了，还漏掉一个，就是启动器设置里也要加操作说明，这个说明主要说明下抓包流程…（5 步流程）

拆解：

| # | 子需求 | 说明 |
|---|--------|------|
| R1 | 火影游戏窗口顶部重做 | 现有「标题栏+工具栏」观感陈旧，重做为与启动器一致的简洁清新风格，功能重新排版收纳 |
| R2 | F11 全屏 | 按 F11 进入全屏（隐藏工具栏，无标题栏），再按一次恢复 |
| R3 | 游戏窗口操作说明 | 说明火影窗口各项功能（账号/变速/标签/刷新/静音/拉伸/全屏） |
| R4 | 4399 与火影解耦 | 4399 窗口不显示任何火影功能；仅保留极简细条（拖动+最小化+关闭） |
| R5 | 启动器设置里加抓包操作说明 | 说明抓包导出的完整 5 步流程 |

---

## 2. 现状分析

### 2.1 游戏窗口 `main.js: createGameWindow()`（L1390-1650 附近）

- `new BrowserWindow({ frame:false, fullscreenable:true, ... })` → 无原生标题栏；用户看到的「标题栏+工具栏」其实是 `game.html` 里的 `.toolbar`（灰色线性渐变 + 方角小按钮），观感像系统原生栏
- `win.loadFile('game.html')`，`did-finish-load` 时下发 `game-info` / `theme-update` / `speed-update` / `mute-update`
- 每个窗口注册一组 IPC：`min-window` / `max-window` / `close-window` / `set-game-speed` / `refresh-page` / `toggle-mute` / `toggle-sidebar` / `get-accounts-window` …
- **火影与 4399 走同一条路径**：`ipcMain.on('launch-game')`（L1779）对两者都调用 `createGameWindow(data.url, data.name)` → 4399 也加载 game.html，于是也带上了整套火影工具栏（问题根因）

### 2.2 `game.html` 工具栏（L518-556 HTML，L204-288 CSS，L1236-1350 JS）

- 结构：`toolbar-left`(≡ + 标题 + tabs) · `toolbar-center`(刷新/标签栏/账号/变速/静音/拉伸) · `toolbar-right`(─ □ ×)
- 主题变量：`--bg1/--bg2/--border/--text/--btnBg/--btnHover/--btnBorder/--separator/--accent`，由 `applyTheme()`（L1461）设置，主进程通过 `theme-update` 下发
- 已有 `setTabDisplayMode`（侧栏/顶栏）、账号侧栏、变速 select、静音、拉伸

### 2.3 无全屏 / 无 F11

- 全局无 `app.on('web-contents-created')` 处理器；`game.html` 无 keydown 监听
- 窗口 `fullscreenable:true`，但只有 `□`（最大化），没有全屏入口；全屏后 `.toolbar` 仍显示（用户反馈的问题）
- 游戏内容在 `<webview>` 里（`game.html: createWebview()` L924），键盘事件由 webview 的 webContents 接收 → 宿主页面的 `keydown` 收不到 F11

### 2.4 现有主题数据

- 主进程 `THEMES`（5 套：mint/sky/sakura/amber/night），`game.html` 有一份对应的 `themes` 映射（L1462）

---

## 3. 方案设计

### 3.1 R1 火影工具栏重做（简洁清新 + 收纳）

**新布局（高度 44px）：**

```
┌────────────────────────────────────────────────────────────────────┐
│ [≡] 火影忍者Online   [窗口1][窗口2][+]     [变速 ▾] [👤] [⋯]  [─][□][✕] │
└────────────────────────────────────────────────────────────────────┘
```

- 左侧：`≡`（标签侧栏开关）+ 标题 + 内联标签（仅在「顶栏」显示模式下出现）
- 右侧：**变速 select**（高频，保留在外）· `👤`（账号侧栏）· `⋯`（更多菜单）· 窗口控制 `─ □ ✕`
- `⋯` 弹出菜单收纳低频项：**刷新 / 标签栏显示方式 / 静音 / 拉伸模式 / 操作说明 / 全屏(F11)**

**视觉（清新，与启动器一致）：**
- 工具栏背景 `linear-gradient(180deg, var(--bg1), var(--bg2))`，底边 1px `var(--border)`
- 按钮：透明底、圆角 8px、hover `rgba(accent,.12)`、active 用 `var(--accent)` 白字
- 标题 13.5px/600；标签为圆角胶囊，选中用 accent
- 弹层：白底/主题底、圆角 12px、轻投影

CSS 重写 `.toolbar / .btn / .tab / .select-container / .control-btn / .separator` 等，新增 `.menu-popover`。

### 3.2 R2 F11 全屏（隐藏标题栏）

**主进程：**
```js
// 全局捕获 webContents 的按键（含 webview guest）
app.on('web-contents-created', (e, wc) => {
  wc.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F11') return;
    const win = ownerGameWindow(wc);
    if (!win) return;
    ev.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  });
});

function ownerGameWindow(wc) {
  let w = BrowserWindow.fromWebContents(wc);
  if (!w && wc.hostWebContents) w = BrowserWindow.fromWebContents(wc.hostWebContents);
  if (!w || w.isDestroyed()) return null;
  return gameWindows.some(g => g && g.win === w) ? w : null;   // 仅游戏窗口响应 F11
}

// 全屏状态变化 → 通知渲染层隐藏/显示顶部栏
// 在 createGameWindow 内：
['enter-full-screen','leave-full-screen'].forEach(ev =>
  win.on(ev, () => win.webContents.send('fullscreen-changed', win.isFullScreen())));

// IPC（工具栏「全屏」菜单项）
ipcMain.on('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
});
```

**渲染层（game.html / browser.html）：**
```js
ipcRenderer.on('fullscreen-changed', (e, on) => {
  document.body.classList.toggle('fullscreen', !!on);
});
```
```css
body.fullscreen .toolbar { display: none; }   /* 全屏无顶部栏 */
```
> 关键：`before-input-event` 注册在 `web-contents-created` 上，因此 webview 内的 F11 也能被捕获（宿主页面 keydown 收不到）。

### 3.3 R3 游戏窗口操作说明

- 入口：`⋯` 菜单 → 「操作说明」→ 打开模态面板（复用现有 `.modal` 风格，重做为清新卡片）
- 内容（火影窗口功能）：
  - **账号管理**：点 `👤` 打开账号侧栏，添加/编辑账号，支持「一键启动」多开
  - **变速**：顶部「变速」下拉，`1x` 还原，`2x/4x/6x/10x/20x` 加速，`0.5x` 减速
  - **标签栏**：`≡` 打开标签侧栏；`⋯ → 标签栏显示方式` 切换 侧栏/顶栏
  - **刷新**：`⋯ → 刷新`（保留登录状态）
  - **静音**：`⋯ → 静音`
  - **拉伸**：`⋯ → 拉伸模式`（原生分辨率 / 跟随窗口）
  - **全屏**：`F11` 或 `⋯ → 全屏`（再按一次退出）
  - **多开**：每个标签独立登录，互不影响

### 3.4 R4 4399 解耦

**方案：新增极简页面 `browser.html`，4399 不再加载 game.html。**

- `createGameWindow(url, gameName, account, opts)` 增加 `opts.plain`
  - `plain === true` → `win.loadFile('browser.html')`
  - 否则 → `win.loadFile('game.html')`（不变）
  - `game-info` 负载增加 `plain` 字段
- `launch-game` 判定：URL 不含 `huoying.qq.com` → `plain = true`
  ```js
  const plain = !/huoying\.qq\.com/i.test(data.url || '');
  createGameWindow(data.url, data.name, null, { plain });
  ```
- 其余入口（`new-window`、账号启动、默认启动）都是火影 → `plain = false`

**`browser.html`（新增，约 120 行）：**
```
┌──────────────────────────────────────────────┐
│ 4399小游戏                        [─]  [✕]   │  ← 44px，可拖动
├──────────────────────────────────────────────┤
│                                              │
│            <webview src=4399>                │
│                                              │
└──────────────────────────────────────────────┘
```
- 细条：`-webkit-app-region: drag`，右侧仅 `─`/`✕`（`-webkit-app-region: no-drag`）
- 单个 `<webview>` 加载 URL，`plugins` + `webpreferences="allowRunningInsecureContent=yes,webSecurity=no,nativeWindowOpen=no,backgroundThrottling=no"`（4399 有 Flash 小游戏，需插件）
- 监听 `game-info` 设置 webview.src 与标题；监听 `theme-update` 应用主色；监听 `fullscreen-changed` 隐藏细条
- `min-window` / `close-window` IPC 复用 `createGameWindow` 已注册的处理器

**`package.json`**：`build.files` 增加 `"browser.html"`（否则打包后缺文件）。

### 3.5 R5 启动器设置里的抓包操作说明

在启动器设置面板（`main.js: createLauncherWindow()` 内联 HTML）新增一段「抓包导出说明」，整理用户给的流程：

```
抓包导出说明
开启「抓包模式」后应用会自动重启并进入游戏。依次打开以下 5 个界面（打开即会被记录）：
1. 组织成员：组织 → 组织成员
2. 本周捐献：组织 → 组织捐献 → 本周捐献
3. 叛忍数据：大和 → 叛忍再临 → 管理员 → 我的组织 → 查看详情
4. 通灵兽献祭：组织 → 组织基地 → 深作 → 组织通灵兽管理员 → 组织通灵兽 → 献祭 → 本周献祭
5. 忍战数据：忍界大战参谋（或 跨服忍界大战接引忍者）→ 参与忍界大战（或 参加跨服忍界大战）→ 礼包分配

完成后：
① 关闭「火影忍者」游戏窗口
② 托盘图标右键 → 关闭启动器
启动器退出后会自动在桌面「火影组织数据/<日期>/」生成 5 张 Excel
```

设置面板需可滚动（内容变长），`sheet-body` 加 `max-height` + `overflow-y:auto`（但整体仍保持不出现难看的滚动条 —— 面板高度自适应窗口，必要时内部滚动）。

### 3.6 数据流

```
F11（在游戏 webview 内或工具栏上）
  → main: before-input-event 捕获 → win.setFullScreen(!isFullScreen)
  → main: 'enter/leave-full-screen' → renderer 'fullscreen-changed'
  → renderer: body.classList.toggle('fullscreen') → .toolbar display:none

点「⋯」→ 前端弹出菜单（纯前端）
点「全屏」菜单项 → ipc 'toggle-fullscreen' → main 切换 → 回推 fullscreen-changed
点「操作说明」→ 前端模态（纯前端）
4399 启动 → main 判定 plain → loadFile('browser.html')
```

---

## 4. 受影响文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `browser.html` | **新增** | 4399 极简窗口（细条 + 单 webview） |
| `package.json` | 修改 | `build.files` 增加 `browser.html` |
| `main.js` | 修改 | `createGameWindow` 增 `opts.plain`；`launch-game` 判定 plain；新增 `app.on('web-contents-created')` + F11；新增 `toggle-fullscreen` IPC；窗口 `enter/leave-full-screen` 回推；`game-info` 增 `plain` |
| `main.js` | 修改 | 启动器设置面板 HTML 增加「抓包导出说明」 |
| `game.html` | 重写 | 工具栏 HTML/CSS（清新+收纳 ⋯ 菜单）、新增操作说明模态、`fullscreen-changed` 处理 |

---

## 5. 关键代码

### 5.1 game.html 新工具栏 HTML

```html
<div class="toolbar">
  <div class="tb-left">
    <button class="tbtn" id="btn-tab-sidebar" title="标签栏">&#9776;</button>
    <span class="ttl" id="windowTitle">火影忍者Online</span>
    <div class="tabs-container" id="tabs-container">
      <div class="tabs-list" id="tabs-list"></div>
      <div class="tab-add" id="tab-add-h">+</div>
    </div>
  </div>
  <div class="tb-right">
    <div class="select-container">
      <select id="speed-select">
        <option value="1" selected>1x 还原</option>
        <option value="2">2x</option><option value="4">4x</option>
        <option value="6">6x</option><option value="10">10x</option>
        <option value="20">20x</option><option value="0.5">0.5x 减速</option>
      </select>
    </div>
    <button class="tbtn" id="btn-accounts" title="账号管理">&#128100;</button>
    <button class="tbtn" id="btn-more" title="更多">&#8943;</button>
    <div class="menu-popover" id="moreMenu">
      <div class="mi" data-act="refresh">刷新（保留登录状态）</div>
      <div class="mi" data-act="tabmode">标签栏显示方式</div>
      <div class="mi" data-act="mute">静音</div>
      <div class="mi" data-act="stretch">拉伸模式</div>
      <div class="mi-sep"></div>
      <div class="mi" data-act="help">操作说明</div>
      <div class="mi" data-act="fullscreen">全屏（F11）</div>
    </div>
    <div class="win-ctrls">
      <button class="cbtn" id="btn-min">&#8211;</button>
      <button class="cbtn" id="btn-max">&#9744;</button>
      <button class="cbtn close" id="btn-close">&#10005;</button>
    </div>
  </div>
</div>
```

> 保留原有 id（`btn-tab-sidebar`/`tabs-container`/`speed-select`/`btn-accounts`/`btn-min`/`btn-max`/`btn-close`/`btn-refresh`）以尽量少改 JS；`btn-refresh`/`btn-mute`/`btn-stretch`/`btn-tab-mode` 移到菜单里，改为 `data-act` 分发。

### 5.2 game.html 新工具栏 CSS（要点）

```css
:root { --toolbarHeight: 44px; }
.toolbar {
  display:flex; align-items:center; justify-content:space-between;
  height:var(--toolbarHeight); padding:0 8px 0 10px;
  background:linear-gradient(180deg, var(--bg1), var(--bg2));
  border-bottom:1px solid var(--border);
  -webkit-app-region:drag; flex-shrink:0; position:relative; z-index:900;
}
.tb-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.tb-right{display:flex;align-items:center;gap:6px;-webkit-app-region:no-drag}
.ttl{font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap}
.tbtn{
  height:30px;min-width:30px;padding:0 9px;border:none;border-radius:8px;
  background:transparent;color:var(--text);font-size:14px;cursor:pointer;
  transition:background .15s,color .15s;-webkit-app-region:no-drag;
}
.tbtn:hover{background:rgba(0,0,0,.06)}
.tbtn.active{background:var(--accent);color:#fff}
.select-container select{
  height:30px;padding:0 26px 0 10px;border:1px solid var(--btnBorder);
  border-radius:8px;background:var(--btnBg);color:var(--text);font-size:12.5px;
  cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;
}
.menu-popover{
  position:absolute;top:calc(var(--toolbarHeight) - 4px);right:96px;
  min-width:190px;background:var(--bg1);border:1px solid var(--border);
  border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.16);padding:6px;
  display:none;z-index:1000;-webkit-app-region:no-drag;
}
.menu-popover.open{display:block}
.mi{padding:9px 12px;border-radius:8px;font-size:12.5px;color:var(--text);cursor:pointer}
.mi:hover{background:rgba(0,0,0,.06)}
.mi-sep{height:1px;background:var(--border);margin:5px 8px}
.win-ctrls{display:flex;gap:2px;margin-left:4px}
.cbtn{
  width:34px;height:30px;border:none;border-radius:8px;background:transparent;
  color:var(--text);font-size:13px;cursor:pointer;-webkit-app-region:no-drag;
}
.cbtn:hover{background:rgba(0,0,0,.06)}
.cbtn.close:hover{background:#ef4444;color:#fff}
body.fullscreen .toolbar{display:none}
```

### 5.3 game.html 菜单分发 JS

```js
const moreMenu = document.getElementById('moreMenu');
document.getElementById('btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  moreMenu.classList.toggle('open');
});
document.addEventListener('click', () => moreMenu.classList.remove('open'));

moreMenu.addEventListener('click', (e) => {
  const mi = e.target.closest('.mi');
  if (!mi) return;
  const act = mi.dataset.act;
  moreMenu.classList.remove('open');
  if (act === 'refresh') window.gameAPI.refreshPage();
  else if (act === 'tabmode') setTabDisplayMode(tabDisplayMode === 'sidebar' ? 'taskbar' : 'sidebar');
  else if (act === 'mute') toggleMute();
  else if (act === 'stretch') setStretchMode(!stretchMode);
  else if (act === 'help') openHelp();
  else if (act === 'fullscreen') ipcRenderer.send('toggle-fullscreen');
});
```

### 5.4 browser.html（新增，核心）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>4399小游戏</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{ --bg1:#fff; --bg2:#f0fdfa; --border:#d7ece8; --text:#1e2a37; --accent:#14b8a6; --h:44px; }
  html,body{height:100%;overflow:hidden}
  body{display:flex;flex-direction:column;font-family:'Microsoft YaHei',sans-serif;color:var(--text)}
  .bar{
    height:var(--h);flex:0 0 var(--h);display:flex;align-items:center;
    justify-content:space-between;padding:0 6px 0 14px;
    background:linear-gradient(180deg,var(--bg1),var(--bg2));
    border-bottom:1px solid var(--border);-webkit-app-region:drag;
  }
  .bar .ttl{font-size:13.5px;font-weight:600}
  .ctrls{display:flex;gap:2px;-webkit-app-region:no-drag}
  .cbtn{width:34px;height:30px;border:none;border-radius:8px;background:transparent;
    color:var(--text);font-size:13px;cursor:pointer}
  .cbtn:hover{background:rgba(0,0,0,.06)}
  .cbtn.close:hover{background:#ef4444;color:#fff}
  .wrap{flex:1;min-height:0;position:relative}
  webview{position:absolute;inset:0;width:100%;height:100%;background:#fff}
  body.fullscreen .bar{display:none}
</style>
</head>
<body>
  <div class="bar">
    <span class="ttl" id="ttl">4399小游戏</span>
    <div class="ctrls">
      <button class="cbtn" id="btnMin">&#8211;</button>
      <button class="cbtn close" id="btnClose">&#10005;</button>
    </div>
  </div>
  <div class="wrap" id="wrap"></div>
  <script>
    const { ipcRenderer } = require('electron');
    const THEMES = { mint:{bg1:'#fff',bg2:'#f0fdfa',border:'#d7ece8',text:'#1e2a37',accent:'#14b8a6'},
      sky:{bg1:'#fff',bg2:'#eff6ff',border:'#d7e6fb',text:'#1e2a3a',accent:'#3b82f6'},
      sakura:{bg1:'#fff',bg2:'#fff1f7',border:'#f7d7e6',text:'#3a1e2a',accent:'#ec4899'},
      amber:{bg1:'#fff',bg2:'#fff7ed',border:'#f7e0c8',text:'#3a2a1e',accent:'#f97316'},
      night:{bg1:'#1b2430',bg2:'#161b22',border:'#2a3442',text:'#e6edf3',accent:'#2dd4bf'} };
    function applyTheme(t){ const th=THEMES[t]||THEMES.mint, r=document.documentElement.style;
      r.setProperty('--bg1',th.bg1); r.setProperty('--bg2',th.bg2);
      r.setProperty('--border',th.border); r.setProperty('--text',th.text); r.setProperty('--accent',th.accent); }
    document.getElementById('btnMin').onclick = () => ipcRenderer.send('min-window');
    document.getElementById('btnClose').onclick = () => ipcRenderer.send('close-window');
    ipcRenderer.on('game-info', (e, data) => {
      document.getElementById('ttl').textContent = (data.game && data.game.name) || '4399小游戏';
      const wv = document.createElement('webview');
      wv.src = (data.game && data.game.url) || 'https://www.4399.com/';
      wv.setAttribute('plugins','');
      wv.setAttribute('webpreferences','allowRunningInsecureContent=yes,webSecurity=no,nativeWindowOpen=no,backgroundThrottling=no');
      wv.addEventListener('new-window', (ev)=>{ ev.preventDefault(); if(ev.url) wv.loadURL(ev.url); });
      document.getElementById('wrap').appendChild(wv);
    });
    ipcRenderer.on('theme-update', (e,t)=>applyTheme(t));
    ipcRenderer.on('fullscreen-changed', (e,on)=>document.body.classList.toggle('fullscreen', !!on));
  </script>
</body>
</html>
```

### 5.5 main.js 关键改动

```js
// createGameWindow 签名 + 加载分流
function createGameWindow(url, gameName, account, opts) {
  const plain = !!(opts && opts.plain);
  ...
  win.loadFile(plain ? 'browser.html' : 'game.html');
  ...
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('game-info', {
      game: { name: gameName, url: url },
      accounts: plain ? [] : accounts,
      account: plain ? null : account,
      diskCache: config.diskCache !== false,
      plain: plain
    });
    win.webContents.send('theme-update', currentTheme);
    ...
  });
  // 全屏状态回推
  win.on('enter-full-screen', () => { if (!win.isDestroyed()) win.webContents.send('fullscreen-changed', true); });
  win.on('leave-full-screen', () => { if (!win.isDestroyed()) win.webContents.send('fullscreen-changed', false); });
}

// launch-game 判定
ipcMain.on('launch-game', (event, data) => {
  ...
  const plain = !/huoying\.qq\.com/i.test(data.url || '');
  createGameWindow(data.url, data.name, null, { plain });
  ...
});

// F11 全局捕获（web-contents-created 覆盖 webview guest）
app.on('web-contents-created', (event, wc) => {
  wc.on('before-input-event', (event2, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F11') return;
    let w = BrowserWindow.fromWebContents(wc);
    if (!w && wc.hostWebContents) w = BrowserWindow.fromWebContents(wc.hostWebContents);
    if (!w || w.isDestroyed()) return;
    if (!gameWindows.some(g => g && g.win === w)) return;
    event2.preventDefault();
    w.setFullScreen(!w.isFullScreen());
  });
});

// 工具栏「全屏」菜单项
ipcMain.on('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
});
```

---

## 6. 边界与异常

| 场景 | 处理 |
|------|------|
| 焦点在 webview 内按 F11 | 用 `app.on('web-contents-created')` + `before-input-event`（覆盖 guest） |
| 启动器/其他窗口按 F11 | `ownerGameWindow` 校验必须在 `gameWindows` 中，否则忽略 |
| 全屏切换的窗口已销毁 | 回推前判 `isDestroyed()` |
| 全屏时点「关闭」 | 顶部栏已隐藏，用 Alt+F4 / 托盘；恢复窗口尺寸由 `leave-full-screen` 处理 |
| 4399 URL 判定 | `!/huoying\.qq\.com/i.test(url)` → plain；`new-window`/账号入口固定火影 → 非 plain |
| `browser.html` 打包缺失 | `package.json build.files` 显式加入（历史踩坑点） |
| 4399 需 Flash | browser.html 的 webview 带 `plugins` 属性；Flash 路径为全局 `app.commandLine`，无需额外处理 |
| 设置面板内容变长 | `.sheet-body` 设 `max-height` + `overflow-y:auto`，面板本身随窗口高度自适应 |
| 主题一致性 | game.html / browser.html 均监听 `theme-update`，与启动器同步 |
| 菜单点击穿透 | `moreMenu` 点击 `stopPropagation`，`document` 点击关闭 |

---

## 7. 验收标准

1. 火影窗口顶部为清新风格工具栏（与启动器一致），高频功能（变速/账号）在外，其余收进 `⋯` 菜单。
2. 按 F11 进入全屏，顶部工具栏消失；再按 F11 恢复，工具栏回来。菜单里也有「全屏（F11）」。
3. `⋯ → 操作说明` 打开说明面板，列出火影窗口各项功能。
4. 4399 窗口顶部只有极简细条（拖动 + 最小化 + 关闭），无任何火影功能；与火影完全解耦。
5. 启动器设置里新增「抓包导出说明」，完整描述 5 步流程与收尾步骤。
6. `node --check main.js` 通过；本地实测正常；打包 1.0.0 成功且 asar 内含 `browser.html`。

---

## 8. 不在本次范围

- 启动器主界面改动（上次已完成）
- 账号管理窗口（accountWindow）UI
- 变速/注入/抓包底层逻辑（仅复用）
