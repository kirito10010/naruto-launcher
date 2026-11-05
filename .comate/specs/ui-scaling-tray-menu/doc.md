# 高分辨率界面缩放与托盘菜单

版本：2.1.0（未发布，沿用）
范围：`main.js`（启动器/账号窗口缩放、托盘菜单）
不涉及：游戏窗口与 Flash 渲染逻辑（保持现有 `force-device-scale-factor=1` 不变，避免影响已验证的清晰/性能模式）

---

## 一、原因

`main.js:2293` 写死了：

```js
app.commandLine.appendSwitch('force-device-scale-factor', '1');
```

这会让 Chromium 忽略 Windows 的缩放比例，所有界面按 100% 绘制。高分辨率屏（2K/4K）上启动器只有 360×640 物理像素，文字自然很小。托盘菜单是系统原生菜单，同样受系统缩放影响；如果系统缩放也是 100%，它也会很小，且原生菜单无法单独调大。

---

## 二、方案

### 1. 启动器 / 账号管理窗口缩放

不改全局缩放开关（游戏渲染已验证，不冒险），只给非游戏窗口加缩放：

- 新增 `getUiScale()`：
  - 用户在设置里选了固定比例（100/125/150/200%）就用它；
  - 选"自动"时按 `max(系统DPI/96, 屏幕宽度/1920)` 计算，向上取到 `1 / 1.25 / 1.5 / 1.75 / 2`，上限 2。
- 对启动器窗口（基准 360×640）和账号管理窗口（基准 360×500）：
  - `webContents.setZoomFactor(scale)`；
  - `setContentSize(基准宽 × scale, 基准高 × scale)`；
  - 按工作区高度兜底，避免放大后超出屏幕。
- 设置面板新增"界面缩放"下拉：`自动 / 100% / 125% / 150% / 200%`，改动立即生效并保存到配置 `uiScale`（0 表示自动）。

系统 DPI 读取：`reg query "HKCU\Control Panel\Desktop\WindowMetrics" /v AppliedDPI`，同步执行一次并缓存，失败按 96 处理。

### 2. 托盘菜单改为自绘窗口

原生 `Menu` 无法调字号，改成小型无边框 `BrowserWindow`：

- 右键托盘：在托盘图标上方（任务栏在顶部时放下方）弹出 180×116 的菜单，按 `getUiScale()` 同步放大。
- 菜单项：显示启动器 / 新建游戏窗口 / 分割线 / 退出。
- 交互：
  - 点击菜单外（blur）自动关闭；
  - Esc 关闭；
  - 点击项后先关菜单再执行。
- 样式跟随当前主题（背景、文字、边框、强调色），字体 13px，菜单项高 34px。
- 安全：主进程校验 `event.sender` 必须是托盘菜单窗口，其他窗口伪造 IPC 无效。

菜单 HTML 内联在 `main.js` 中，通过 `data:text/html` 加载；`nodeIntegration: true` 仅用于发送 3 个固定 IPC 动作。

---

## 三、影响文件与关键代码

### `DEFAULT_SETTINGS`

```js
uiScale: 0,   // 0 = 自动
```

### `getUiScale()`

```js
const UI_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2];
let systemDpiCache = 0;

function readSystemDpi() {
  if (systemDpiCache) return systemDpiCache;
  systemDpiCache = 96;
  if (process.platform !== 'win32') return systemDpiCache;
  try {
    const r = spawnSync('reg', ['query', 'HKCU\\Control Panel\\Desktop\\WindowMetrics', '/v', 'AppliedDPI'],
      { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    const m = /AppliedDPI\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.stdout || '');
    if (m) systemDpiCache = parseInt(m[1], 16) || 96;
  } catch (e) { /* ignore */ }
  return systemDpiCache;
}

function getUiScale() {
  const fixed = Number(config.uiScale);
  if (fixed >= 1 && fixed <= 2) return Math.min(2, Math.max(1, fixed));
  const d = screen.getPrimaryDisplay();
  const width = (d.size && d.size.width) || (d.bounds && d.bounds.width) || 1920;
  const raw = Math.max(1, readSystemDpi() / 96, width / 1920);
  return UI_SCALE_STEPS.find(s => s >= raw - 0.01) || 2;
}
```

### 应用缩放

```js
function applyUiScaleToWindow(win, baseW, baseH) {
  if (!win || win.isDestroyed()) return;
  const scale = getUiScale();
  const d = screen.getDisplayMatching(win.getBounds());
  const maxH = Math.max(1, d.workAreaSize.height - 40);
  const effective = Math.min(scale, Math.max(1, Math.floor((maxH / baseH) * 20) / 20));
  try { win.webContents.setZoomFactor(effective); } catch (e) {}
  try { win.setContentSize(Math.round(baseW * effective), Math.round(baseH * effective)); } catch (e) {}
}
```

- 启动器创建时：宽高直接用 `360 × scale`、`640 × scale`，创建后调用 `applyUiScaleToWindow`。
- 账号窗口创建时：`applyUiScaleToWindow(accountWindow, 360, 500)`。
- 设置改变时：对已存在的两个窗口重新应用。

### 托盘菜单

- 删除 `Menu.buildFromTemplate` 用法，改为：

```js
tray.on('right-click', () => showTrayMenu());
tray.on('click', () => showLauncherWindow());
```

- `showTrayMenu()` 创建 180×116（乘 scale）的窗口，位置基于 `tray.getBounds()` / 光标点 + 工作区限制。
- 退出逻辑从原来的菜单回调抽成 `quitFromTray()`，自绘菜单复用。

### 设置项

在"性能模式"下面新增：

```html
<div class="row">
  <span class="row-label">界面缩放<span class="row-hint">启动器与账号窗口大小；自动按屏幕分辨率/系统缩放计算</span></span>
  <select class="sel" id="uiScaleSel" onchange="changeUiScale(this.value)">
    <option value="0">自动</option>
    <option value="1">100%</option>
    <option value="1.25">125%</option>
    <option value="1.5">150%</option>
    <option value="2">200%</option>
  </select>
</div>
```

- 打开设置时下发 `ui-scale-state` 回填。
- `set-ui-scale` IPC：校验取值 → 保存 → 重新应用启动器/账号窗口。

---

## 四、边界

| 场景 | 处理 |
| --- | --- |
| 1920×1080 @100% | 自动 = 100%，与现在一致 |
| 2560×1600 @100% | 自动 = 150%，启动器约 540×960 |
| 3840×2160 @100% | 自动 = 200% |
| 系统缩放 150% | 自动 = 150%（DPI 换算），不会叠加 |
| 放大后超出工作区 | 按工作区高度回退到可容纳的比例 |
| 多显示器 | 启动器按所在显示器工作区计算高度；托盘菜单按光标所在显示器定位 |
| 游戏窗口 | 不缩放，保持现有渲染逻辑 |
| 托盘菜单点击外部 | blur 自动关闭 |
| 菜单未打开时退出 | 走原托盘退出流程或设置退出 |

## 五、预期结果

- 2K/4K 屏上启动器、账号管理窗口、托盘菜单都按比例放大，文字清晰可读。
- 设置里可手动覆盖自动值，改完立即生效。
- 游戏窗口、Flash 渲染、加速、凭证逻辑完全不受影响。
- 不再显示 Windows 原生的细小托盘菜单。
