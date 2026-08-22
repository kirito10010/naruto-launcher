# 首次打开游戏窗口白屏修复 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 修改 createGameWindow 显示时机 | ✅ |
| Task 2 | 校验 | ✅ |

## 根因

`createGameWindow` 用 `show: true` 立即显示窗口（`backgroundColor: '#ffffff'`），首次启动时 GPU/渲染进程冷启动慢，窗口在 game.html 首帧渲染前就以白色显示，造成整窗白屏。

## 改动（main.js）

- `show: true` → `show: false`。
- 新增 `ready-to-show` 监听：首帧渲染完成后 `win.show()`。
- 新增 5 秒超时兜底：未触发 `ready-to-show` 时强制显示，并判断 `win.isDestroyed()` / `win.isVisible()`。

## 校验

- `node --check main.js` 通过。
- 改动仅限 `createGameWindow`，不影响其他窗口与既有功能。
