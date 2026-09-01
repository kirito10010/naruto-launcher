# 标签显示方式切换（侧边栏 / 顶部任务栏）方案

## 1. 背景与目标

当前标签固定显示在左侧侧栏，用户希望少一步操作：在「标签少」时用顶部横向任务栏更直观。把原「清空缓存」按钮（本身已失效）改为**标签显示方式切换**按钮：

- **默认：侧边栏模式**（左侧竖向标签，现状）
- **激活按钮：顶部任务栏模式**（标签横排在窗口顶部）

## 2. 技术方案（仅 game.html）

### HTML
1. 把 `btn-clear-cache` 按钮替换为 `btn-tab-mode`（切换按钮，带 title）。
2. 在 `toolbar-left` 中重新加入顶部横向标签容器 `#tabs-container`（默认隐藏），内含 `#tabs-list` 列表 + `#tab-add-h` 新建按钮。

### CSS
1. 重新加入横向标签样式：`.tabs-container` / `.tabs-list` / `.tab` / `.tab-close` / `.tab-add`，激活态用 `var(--accent)`。
2. `#tabs-container` 默认 `display:none`（侧边栏模式隐藏）。

### JS
1. 新增状态 `tabDisplayMode`（`'sidebar'` 默认 / `'taskbar'`）。
2. 新增元素查找：`tabsContainer` / `tabsList` / `tabAddH` / `btnTabMode`。
3. `renderTabs()` 同时渲染到**侧边栏列表**与**顶部列表**，两处都带激活高亮与关闭 ×。
4. `setTabDisplayMode(mode)`：切换两个容器的显示/隐藏，并切换 `btnTabMode` 激活态、隐藏/显示「≡」侧栏开关。
5. 绑定：`btnTabMode` 点击切换模式；`tabAddH` 新建标签；`tabsList` 点击切换/关闭。
6. 移除原 `btn-clear-cache` 点击逻辑与失效的 `gameAPI.clearCache`。

## 3. 受影响文件

| 文件 | 修改类型 | 位置 |
|------|----------|------|
| `game.html` | 修改 | 工具栏 HTML + 横向标签 CSS + 标签渲染/事件 JS |

## 4. 边界条件

- 顶部任务栏模式下「≡」按钮隐藏；侧边栏模式下顶部容器隐藏。
- 两个容器共用同一 `tabs` 数据与 `switchTab/removeTab` 逻辑，状态一致。
- 顶部标签多到放不下时超出部分隐藏（`overflow: hidden`）。
- 默认每次启动都是侧边栏模式，不持久化。

## 5. 预期结果

- 工具栏「标签栏」按钮可切换两种显示方式。
- 默认左侧侧栏；激活后顶部横向标签，少标签时切换更直观。
