# 修复游戏持续卡顿（负优化），恢复绝对流畅 — 总结

## 问题

游戏时时刻刻卡顿，出现负优化，用户要求绝对流畅。

## 排查结论

结合 config.json 实测（stretchMode=false、lastSpeed=1），排除拉伸定时器和变速注入，定位到三个长期存在的拖慢点：

1. `CanvasOopRasterization` 实验性开关（把 canvas 光栅化搬到独立进程，对 PPAPI Flash 是纯负优化）。
2. `wmode=opaque` 强加在激活标签上（让 Flash 放弃 GPU 直连走软件合成）。
3. 拉伸 `doStretch` 每秒强制重设 `transform`（数值未变也触发重绘）。

## 改动内容

### main.js
- 删除 `app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')`。

### game.html
- `applyFlashQuality` 分支化：后台标签（low）设 `wmode=opaque` 保证分层；激活标签（high）仅设 quality 并 `removeAttribute("wmode")`，保持默认 GPU 直连。
- `STRETCH_ENABLE_JS` 的 `doStretch` 增加 scale 缓存比较，数值未变直接 return，避免每秒强制重绘。

## 验证结果

- `node --check main.js` 通过。
- `npm run build` 成功，exit code 0。
- 产物：`release-v3.2.0\NarutoOnlineLauncher-Setup-3.2.0.exe`。

## 待用户验证

安装 3.2.0 后实测游戏流畅度，重点确认：
1. 持续卡顿是否缓解；
2. 多标签切换仍正常（不白屏、后台画质降级生效）。
