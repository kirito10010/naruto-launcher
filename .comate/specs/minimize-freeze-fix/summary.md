# 最大化/最小化后游戏卡死 · 修复说明（1.12.2）

## 现象

游戏窗口点右上角最大化，再最小化，之后恢复窗口，游戏画面一动不动。

## 原因

Chromium 会把最小化/被遮挡的窗口判定为「不可见」，暂停渲染。Flash 窗口化插件被暂停后，恢复时经常不重绘，表现就是卡死。

## 处理

1. 关闭原生窗口遮挡检测：`disable-features` 增加 `CalculateNativeWinOcclusion`。
2. 增加 `disable-backgrounding-occluded-windows`，窗口被遮挡时不再后台化。
3. 窗口尺寸变化结束（220ms 防抖）后，强制宿主页 + 所有 webview 客进程 `invalidate()` 重绘一次。
4. 最小化→还原时补两次重绘（150ms / 700ms）。

## 涉及文件

- `main.js`：命令行开关、`createGameWindow()` 内 guest 列表与重绘逻辑、`restore` / `resize` 事件。

## 验证

- 打包 1.12.2，asar 校验：`CalculateNativeWinOcclusion`、`disable-backgrounding-occluded-windows`、`repaintWindow`、还原补绘均在。
- 启动冒烟测试通过。

## 备注

`perf.log` 里的 `[CRASH] Pepper Plugin 进程退出 reason=killed` 是关窗时主动清理插件进程产生的，不是崩溃，与本次问题无关。
