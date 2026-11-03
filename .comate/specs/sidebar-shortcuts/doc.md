# 侧边栏点击外部关闭 + 全局快捷键（游戏窗口）

## 一、需求

1. 左侧「标签栏」和右侧「账号栏」打开后，**点击窗口任意非侧边栏位置，优先关闭侧边栏**。
2. 给游戏窗口的每个功能都配快捷键，且**焦点在游戏画面里时也要生效**。
3. 「操作说明」弹层里把交互和快捷键写清楚。

## 二、交互设计

### 2.1 点击外部关闭

难点：游戏区域是 `<webview>`（内部是 Flash），点击事件不会冒泡到宿主页面，所以宿主收不到「点了游戏区」这件事。

方案：

- 侧边栏打开时，在**游戏区域上盖一层透明遮罩**（`#sidebarBackdrop`），点击遮罩 = 关闭侧边栏。这一下不会传给游戏（符合「优先关闭侧边栏」）。
- 遮罩只覆盖工具栏以下、窗口以内的区域，**不盖工具栏**，所以工具栏按钮仍然可点。
- 同时在 `document` 上加 `mousedown` 捕获监听：点击位置不在侧边栏内、也不是那两个开关按钮时，关闭侧边栏。这样点工具栏、点顶部区域也能关。
- 两个侧边栏**互斥**：开左边自动关右边，反之亦然。

### 2.2 快捷键

按键统一在主进程的 `before-input-event` 里拦截，命中后 `preventDefault()` 再通知页面执行。这样无论焦点在工具栏还是游戏画面（Flash）里都能生效。

| 快捷键 | 功能 |
| --- | --- |
| `Alt + 1` ~ `Alt + 9` | 切换到第 N 个标签页 |
| `Ctrl + Tab` / `Ctrl + Shift + Tab` | 下一个 / 上一个标签页 |
| `Ctrl + T` | 新建标签页 |
| `Ctrl + W` | 关闭当前标签页 |
| `Alt + L` | 显示/隐藏左侧标签栏 |
| `Alt + A` | 显示/隐藏右侧账号栏 |
| `F5` / `Ctrl + R` | 刷新当前标签（保留登录状态） |
| `Alt + M` | 静音 / 取消静音 |
| `Alt + S` | 打开「更多」菜单 |
| `F11` | 全屏 / 退出全屏（已有） |
| `Esc` | 先关侧边栏 / 菜单 / 弹层 |

说明：`Esc` 优先级——侧边栏和菜单都开着时，只关最上层的那个。

## 三、技术方案

### 3.1 main.js

```js
function attachShortcuts(wc, win) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const action = matchShortcut(input);   // 返回 'new-tab' / 'toggle-tabs' / 'fullscreen' ...
    if (!action) return;
    event.preventDefault();
    if (!win.isDestroyed()) win.webContents.send('shortcut', action);
  });
}
```

- 在 `createGameWindow()` 里给 `win.webContents` 挂一次。
- 在 `did-attach-webview` 里给每个 guest 挂一次（焦点在游戏里时的事件从这里来）。
- `matchShortcut(input)`：用 `input.key` + `input.control/shift/alt` 匹配上表。
- 全屏复用现有 `ipcMain.on('toggle-fullscreen')` 逻辑，直接发 `'shortcut'` → 页面再触发 `gameAPI`，或者主进程直接处理。

### 3.2 game.html

- 新增 `#sidebarBackdrop`（工具栏以下的透明层，`z-index` 高于 webview、低于侧边栏）。
- `openTabSidebar()/openAccountSidebar()` 统一走 `setSidebar('tabs' | 'accounts' | null)`：
  - 互斥、同步遮罩显示状态。
- `ipcRenderer.on('shortcut', (e, action) => ...)` 分发到现有函数：
  - `new-tab` → `addTab()`
  - `close-tab` → `removeTab(activeTabId)`
  - `next-tab` / `prev-tab` → 按顺序切换
  - `switch-tab:N` → `switchTab(第 N 个)`
  - `toggle-tabs` / `toggle-accounts` → `setSidebar(...)`
  - `refresh` → 现有刷新逻辑（保留登录）
  - `mute` → `toggleMute()`
  - `more` → `openMoreMenu()`
  - `fullscreen` → `ipcRenderer.send('toggle-fullscreen')`
  - `escape` → 依次关闭：帮助弹层 → 菜单 → 侧边栏
- 「操作说明」弹层重写：分「鼠标操作」「快捷键」两块，列出上表。

## 四、影响文件

| 文件 | 改动 |
| --- | --- |
| `main.js` | 新增 `attachShortcuts()`、`matchShortcut()`，在窗口和 guest 上挂载 |
| `game.html` | 侧边栏统一开关 + 遮罩 + 快捷键分发 + 帮助文案 |
| `package.json` | 无（版本号按发布节奏改） |

## 五、边界与异常

- 多开窗口：快捷键只作用于**当前焦点窗口**（事件来自该窗口的 webContents）。
- 侧边栏打开时点遮罩：只关闭侧边栏，不触发游戏点击（符合「优先关闭」）。
- 输入框聚焦时（添加账号弹窗）：`Ctrl+T` 等仍然拦截，避免误开标签；`Esc` 优先关弹窗。
- 全屏状态下：遮罩从窗口顶部开始（工具栏隐藏），快捷键逻辑不变。
- 按键冲突：都带 `Alt` 或 `Ctrl` 组合，不影响游戏内普通按键（数字、字母、方向键）。

## 六、预期结果

- 打开任一模板侧边栏后，点游戏画面、点工具栏任意空白处，侧边栏立即关闭。
- 焦点在游戏里（Flash 中）时按 `Alt+T`… 等快捷键依然生效。
- 「操作说明」里能看到完整的鼠标操作和快捷键表。
