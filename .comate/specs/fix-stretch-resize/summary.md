# 拉伸跳动修复 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 修正拉伸测量的反馈回路 | ✅ |
| Task 2 | 用定时重算兜底替代原轮询 | ✅ |
| Task 3 | 校验 | ✅ |

## 根因

`doStretch()` 用 `getBoundingClientRect()` 测量 Flash 元素尺寸，该 API 返回包含 transform 后的包围盒，导致 resize 时测量值被上次缩放污染，画面在「铺满/原生」之间反复跳动。

## 改动（game.html）

- `STRETCH_ENABLE_JS`：
  - 测量改用 `offsetWidth`/`offsetHeight`（布局尺寸，不受 transform 影响），消除反馈回路。
  - 用 `setInterval(doStretch, 1000)` 常驻重算，替代原「仅元素缺失时轮询」。
- `STRETCH_DISABLE_JS`：新增 `clearInterval(window.__narutoStretchTimer)`，关闭时清理定时器，避免残留。

## 校验

- game.html 内联脚本语法校验通过（`SYNTAX OK`）。
- 关闭逻辑已同步清理 `resize` 监听与 `setInterval` 定时器。
