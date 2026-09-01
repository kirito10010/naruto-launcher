# 多开性能优化 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 恢复垂直同步，移除无上限渲染开关 | ✅ |
| Task 2 | 后台标签 Flash 画质降级 | ✅ |
| Task 3 | 内存监控 + 超限自动重载 | ✅ |
| Task 4 | Flash wmode=opaque | ✅ |
| Task 5 | 校验 | ✅ |

## 改动内容

### main.js
1. 移除 `disable-gpu-vsync` 与 `disable-frame-rate-limit`（保留 `ignore-gpu-blacklist`、`CanvasOopRasterization`），渲染锁回显示器刷新率，杜绝多开超频浪费。
2. 引入 `webContents`，新增 `memory-check` IPC：用 `app.getAppMetrics()` 计算各标签内存，超 1.5GB 回传 `memory-alert`。

### game.html
3. 新增 `applyFlashQuality(webview, quality)`：设置 Flash `quality` 属性 + `wmode=opaque`。
4. `switchTab` 对切走标签降为 `low`、切回标签恢复 `high`；`did-stop-loading` 按激活状态应用画质。
5. 内存监控：每 60s 上报各标签 `webContentsId`，收到 `memory-alert` 后自动重载后台标签、激活标签仅日志提示。

## 校验

- `node --check main.js` 通过。
- `game.html` 内联脚本语法通过。
- grep 确认 `disable-gpu-vsync` / `disable-frame-rate-limit` 已移除，`ignore-gpu-blacklist` / `CanvasOopRasterization` 保留。

## 说明

- 最大收益来自 Task 1（恢复垂直同步）。240Hz 高刷屏仍可跑满 240fps（垂直同步锁到显示器实际刷新率，不是锁 60）。
- 画质降级与 wmode 对动态创建的 Flash embed 效果可能有限，需实测；如无效可后续加周期重应用（新项目是 3s 重应用一次）。
- 内存阈值 1.5GB 可后续调整。
