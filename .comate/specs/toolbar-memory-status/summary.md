# 工具栏内存状态显示提示 — 总结

## 需求

在工具栏加一个内存状态指示，让玩家看到当前游戏标签内存占用与等级（正常/偏高/过高），自主决定是否点「刷新」释放。

## 改动内容

### game.html
1. 工具栏 `toolbar-center` 的 FPS 按钮后新增 `#mem-status` 状态元素（圆点 + `内存 --` 文字）。
2. 新增 `.mem-status` / `.mem-dot` / `.normal` / `.warn` / `.danger` CSS（绿/橙/红三色）。
3. 内存监控 `setInterval` 改为具名函数 `reportMemory()`，启动即上报一次 + 每 60s 定时。
4. 新增 `updateMemStatus(mem)` 与 `ipcRenderer.on('memory-status', ...)`，取激活标签内存更新颜色与文字。

### main.js
- `memory-check` 处理器新增 `statusList` 收集各标签内存，并始终回传 `memory-status`。

## 状态等级

- `< 1500MB` → 绿色「内存 XXXMB」
- `1500~2500MB` → 橙色「内存 XXXMB 偏高」
- `> 2500MB` → 红色「内存 XXXMB 过高」

## 验证结果

- `node --check main.js` 通过。
- `npm run build` 成功，exit code 0。
- 产物：`release-v3.1.1\NarutoOnlineLauncher-Setup-3.1.1.exe`。

## 待用户验证

启动游戏后观察工具栏：初始显示「内存 --」，约 60s 后显示实际内存；长时间游玩应能看到颜色随内存上涨从绿→橙→红变化，玩家可据此自主点「刷新」。
