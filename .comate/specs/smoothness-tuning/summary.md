# 极致流畅度调优 — 总结

## 改动内容

### game.html
1. `applyFlashQuality` 激活分支 `quality` 从 `high` 改为 `low`（画质最低），保留 `wmode=direct`（GPU 直连）。
2. 新增 `setTabThrottle(tab, throttled)` 辅助函数，上报 `set-tab-throttle` IPC。
3. `switchTab`：旧标签冻结（`setTabThrottle(prevTab, true)`），新标签全速（`setTabThrottle(nextTab, false)`）。
4. `window-blur`/`window-focus`：同步节流状态（blur 冻结非活跃标签，focus 恢复活跃标签、冻结非活跃）。

### main.js
- 新增 `set-tab-throttle` IPC：`webContents.fromId(id).setBackgroundThrottling(throttled)`。

## 验证结果

- `node --check main.js` 通过。
- `npm run build` 成功（exit code 0）。
- 产物：`release-v3.2.0\NarutoOnlineLauncher-Setup-3.2.0.exe`。

## 待用户验证

1. 单开：画质降到最低后，流畅度是否提升。
2. 双开：只玩一个标签时，另一标签被冻结，活跃标签是否明显更流畅；切换标签后能否正常恢复（无白屏）。
