# 修复多开标签切换白屏任务计划

- [x] Task 1: 改为 z-index 层叠，不再隐藏 webview
    - 1.1: `.webview-wrap webview` 增加 `z-index: 1` 与 `background: #fff`
    - 1.2: `.webview-wrap webview.hidden` 改为 `z-index: 0; pointer-events: none`
    - 1.3: `.webview-wrap webview.paused` 改为 `z-index: 0; pointer-events: none`

- [x] Task 2: 校验
    - 2.1: 校验 game.html CSS/脚本结构正确
    - 2.2: 确认 `.hidden`/`.paused` class 切换逻辑未改动、仍正常配合
