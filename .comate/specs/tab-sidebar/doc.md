# 标签页侧栏改造 + 切换白屏修复方案

## 1. 背景与问题

1. **切换标签白屏**：一个窗口内多开标签，切到后台标签一段时间后再切回，该标签出现白屏。
2. **标签栏 UI 改造**：把顶部横向标签栏，改成**窗口左侧可展开/收起的竖向标签侧栏**，每个标签竖着排列。

## 2. 根因分析

### 白屏
`.webview-wrap webview.hidden / .paused` 当前用 `width:0; height:0` 隐藏 webview。Flash（PPAPI 插件）在元素尺寸被压到 0 时，渲染表面被销毁/挂起；切回时表面需重建，期间白屏。

**修复**：改用 `visibility: hidden`。元素保持原尺寸（渲染表面不销毁），仅停止绘制；切回时立即绘制，不再白屏。

### 标签栏
顶部 `.tabs-container` 横向排列，改为左侧固定侧栏 + 展开/收起开关。

## 3. 技术方案

### A. 白屏修复（game.html CSS）
```css
.webview-wrap webview.hidden { visibility: hidden; pointer-events: none; }
.webview-wrap webview.paused { visibility: hidden; pointer-events: none; }
```
（不再用 `width:0; height:0`）

### B. 左侧标签侧栏

**HTML**：
- 移除 toolbar-left 里的 `.tabs-container`，改为「≡ 展开按钮 + 标题」。
- 新增左侧侧栏（`.tab-sidebar`）：头部含「新建标签 +」按钮，主体为竖向标签列表。

**CSS**：侧栏 `position: fixed; left: -220px`（收起）→ `left: 0`（展开），带过渡动画；标签项竖向排列，激活项高亮。

**JS**：
- `renderTabs()` 渲染到侧栏列表（`.tab-sidebar-item`，含名称 + 关闭 ×）。
- 点击标签项切换、点击 × 关闭。
- 「≡」按钮切换侧栏 `.visible`。
- 「+」按钮新建标签。
- 复用现有 `addTab/switchTab/removeTab` 逻辑，仅改渲染与事件绑定位置。

## 4. 受影响文件

| 文件 | 修改类型 | 位置 |
|------|----------|------|
| `game.html` | 修改 | CSS（webview 隐藏方式 + 新增侧栏样式） |
| `game.html` | 修改 | HTML（toolbar + 新增侧栏） |
| `game.html` | 修改 | JS（元素查找、renderTabs、事件绑定） |

## 5. 边界条件与异常处理

- `visibility: hidden` 保持元素占位，多个 webview 重叠时由 `pointer-events: none` 避免拦截点击。
- 侧栏默认收起，用「≡」展开；「+」新建标签在侧栏头部。
- 关闭标签后若只剩 0 个，沿用现有 `closeWindow()` 逻辑。
- 后台标签静音逻辑保持不变（切走静音、切回按全局静音状态恢复）。

## 6. 预期结果

- 切换标签不再白屏。
- 标签以左侧竖向侧栏呈现，可展开/收起；新建、切换、关闭标签正常。
