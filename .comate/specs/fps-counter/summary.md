# FPS 实时显示 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 工具栏新增「FPS」开关 | ✅ |
| Task 2 | FPS 注入与移除逻辑 | ✅ |
| Task 3 | 交互绑定 + 导航适配 | ✅ |
| Task 4 | 校验 | ✅ |

## 实现内容（仅 game.html）

1. 工具栏新增 `#btn-fps`，复用 `.btn.active` 高亮态，默认关闭、不持久化。
2. `FPS_ENABLE_JS` / `FPS_DISABLE_JS`：注入 JS 在页面右上角创建浮层，用 `requestAnimationFrame` 每秒统计帧数并更新文本（如 `60 FPS`）。
3. `applyFpsToWebview` / `setFpsMode`：遍历所有标签应用/移除；`did-stop-loading` 时若开启则重新注入。
4. 关闭时 `cancelAnimationFrame` 并移除 DOM，零残留。

## 校验

- 内联脚本语法校验通过（`SYNTAX OK`）。
- grep 确认 15 处关键引用均就位。

## 说明

- 该 FPS 显示的是**实际显示/合成帧率**（requestAnimationFrame 驱动的合成速率，通常受显示器刷新率上限，如 60Hz），反映「画面是否流畅」；而游戏 Flash 内部原生帧率一般 24~30。二者不同属正常。
- 对性能几乎零影响，不影响流畅度。
