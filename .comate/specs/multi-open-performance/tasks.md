# 多开性能优化任务计划

- [x] Task 1: 恢复垂直同步，移除无上限渲染开关
    - 1.1: 移除 `app.commandLine.appendSwitch('disable-gpu-vsync')`
    - 1.2: 移除 `app.commandLine.appendSwitch('disable-frame-rate-limit')`
    - 1.3: 保留 `ignore-gpu-blacklist` 与 `CanvasOopRasterization`

- [x] Task 2: 后台标签 Flash 画质降级
    - 2.1: 定义画质降级/恢复注入 JS（设置 Flash quality 属性）
    - 2.2: `switchTab` 时对切走标签降为 low、切回标签恢复 high
    - 2.3: 新标签加载完成后按激活状态应用画质

- [x] Task 3: 内存监控 + 超限自动重载
    - 3.1: 在 game.html 定时上报各标签 webContentsId 与内存
    - 3.2: main.js 用 app.getAppMetrics() 计算内存，超阈值提示重载
    - 3.3: 仅对后台标签自动重载，激活标签仅提示

- [x] Task 4: Flash wmode=opaque（次要）
    - 4.1: 注入 JS 给 Flash embed 设置 wmode="opaque"

- [x] Task 5: 校验
    - 5.1: main.js 语法校验（node --check）
    - 5.2: game.html 内联脚本语法校验
