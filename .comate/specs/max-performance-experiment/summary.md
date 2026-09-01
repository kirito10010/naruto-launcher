# 性能最大化实验 — 总结

## 改动内容

### main.js
1. 追加命令行开关：`disable-frame-rate-limit`、`disable-gpu-vsync`、`disable-background-timer-throttling`、`disable-renderer-backgrounding`、`disable-backgrounding`。
2. `createGameWindow` 的 `backgroundThrottling` 改为 `false`。

### game.html
1. webview `webpreferences` 追加 `backgroundThrottling=no`。
2. `applyFlashQuality` 激活分支改为 `wmode=direct`（强制 GPU 直连）。

## 验证结果

- `node --check main.js` 通过。
- `npm run build` 成功（exit code 0）。首次因启动器进程占用 win-unpacked 目录失败，关闭进程后重打包成功。
- 产物：`release-v3.2.0\NarutoOnlineLauncher-Setup-3.2.0.exe`。

## 待用户验证

1. 单窗口流畅度是否提升（CPU/GPU 占用应上升、卡顿减少）。
2. 高刷屏（240Hz）帧率是否更高。
3. 多开时是否变卡（此配置牺牲多开效率换单窗口流畅）。
4. 是否出现屏幕撕裂（解 vsync 的代价）。

## 回退方式

若效果不理想，恢复原配置即可（去掉新增的 5 个开关、backgroundThrottling 改回 true、wmode 改回不强制 direct）。
