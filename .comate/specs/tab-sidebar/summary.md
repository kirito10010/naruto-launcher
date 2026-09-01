# 标签页侧栏改造 + 切换白屏修复 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 修复切换标签白屏（CSS） | ✅ |
| Task 2 | 新增左侧标签侧栏样式与结构 | ✅ |
| Task 3 | 改造标签渲染与事件绑定逻辑 | ✅ |
| Task 4 | 校验 | ✅ |

## 改动内容（仅 game.html）

1. **白屏修复**：`.webview-wrap webview.hidden / .paused` 由 `width:0; height:0` 改为 `visibility: hidden`，保留元素尺寸与 Flash 渲染表面，切回立即绘制，不再白屏。

2. **左侧标签侧栏**：
   - 移除顶部横向 `.tabs-container`，toolbar-left 改为「≡ 展开按钮 + 标题」。
   - 新增左侧 `.tab-sidebar`（`position: fixed`，`left:-220px` 收起 / `left:0` 展开，带过渡动画），头部含「+ 新建标签」，主体为竖向标签列表。
   - `renderTabs()` 渲染到侧栏列表；点击项切换、点击 × 关闭；「≡」切换展开收起；「+」新建标签。
   - 复用 `addTab/switchTab/removeTab` 逻辑，仅改渲染与事件绑定位置。

## 校验

- 内联脚本语法校验通过（`SYNTAX OK`）。
- 已确认无残留 `tabBar` / `tab-add` / `tabs-container` 引用。
- `.hidden` / `.paused` 的 class 切换逻辑保持不变（现映射到 `visibility: hidden`）。

## 说明

- 侧栏默认收起，点工具栏左侧「≡」展开。
- 标签激活态用红色高亮（与主题 `.btn.active` 一致）。
- 白屏修复对 Flash 最有效；若个别机器仍偶发白屏，可考虑改为「离屏定位保持渲染」的兜底方案（当前先按 `visibility: hidden` 实测）。
