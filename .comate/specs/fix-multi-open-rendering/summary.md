# 多开渲染回归修复 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 恢复被误删的 4 个命令行启动参数 | ✅ |
| Task 2 | 修复 webview 隐藏方式，避免 display:none | ✅ |
| Task 3 | 校验并确认改动 | ✅ |

## 根因

上次「流畅度优化」误删了自 v1.0.1 起就存在、且从未改动过的 4 个 Flash PPAPI 必需启动参数，导致多开时第二个及后续 Flash 实例无法正常合成渲染（“不显示、很久才显示”）。同时 `game.html` 用 `display:none` 隐藏 webview 触发了 Electron 已知的渲染异常。

## 具体改动

### main.js
- 恢复 `ignore-gpu-blacklist`、`disable-frame-rate-limit`、`disable-gpu-vsync`、`enable-features=CanvasOopRasterization`
- 命令行开关区现与 v2.2.8 基线一致

### game.html
- `.webview-wrap webview.hidden` / `.paused` 由 `display:none` 改为 `width:0; height:0; pointer-events:none`（遵循 Electron 官方推荐，避免隐藏 webview 的渲染/重载问题）

## 校验结果

- `node --check main.js` 通过（exit 0）
- 确认命令行开关区已恢复 4 个参数（grep 验证 15 处 appendSwitch，含 ppapi-flash 等）
- 确认保留的优化未被破坏：
  - `app.getAppMetrics()` 替代 PowerShell 扫描（`getAllRelevantChildPids`，main.js:793/796）
  - 启动清理延迟执行（`performStartupCleanup`，main.js:2266，位于 setTimeout 内）

## 说明

本次回归是我上一次「流畅度优化」中判断失误导致的，已完全恢复基线。建议重新打包为 3.0.0 后再验证多开（多标签页 + 多窗口）是否恢复正常。
