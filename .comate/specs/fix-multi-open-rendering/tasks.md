# 多开渲染回归修复任务计划

- [x] Task 1: 恢复被误删的 4 个命令行启动参数（main.js）
    - 1.1: 恢复 `app.commandLine.appendSwitch('ignore-gpu-blacklist')`
    - 1.2: 恢复 `app.commandLine.appendSwitch('disable-frame-rate-limit')`
    - 1.3: 恢复 `app.commandLine.appendSwitch('disable-gpu-vsync')`
    - 1.4: 恢复 `app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')`
    - 1.5: 校验命令行开关区与 v2.2.8 基线一致

- [x] Task 2: 修复 webview 隐藏方式，避免 display:none（game.html）
    - 2.1: 将 `.webview-wrap webview.hidden` 改为 `width:0; height:0`
    - 2.2: 将 `.webview-wrap webview.paused` 改为 `width:0; height:0`
    - 2.3: 校验切换标签/失焦/最小化时隐藏与恢复逻辑正常

- [x] Task 3: 校验并确认改动
    - 3.1: 对 main.js 做语法校验（node --check）
    - 3.2: 确认保留的优化（app.getAppMetrics、启动清理延迟、后台静音）未被破坏
