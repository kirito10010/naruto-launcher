# FPS 实时显示任务计划

- [x] Task 1: 在工具栏新增「FPS」开关按钮
    - 1.1: 在 toolbar-center 中新增 `btn-fps` 按钮及分隔符
    - 1.2: 复用 `.btn.active` 高亮样式，设置 title 提示

- [x] Task 2: 实现 FPS 注入与移除逻辑
    - 2.1: 定义 FPS 开启/关闭的注入 JS 脚本常量
    - 2.2: 实现 `applyFpsToWebview(webview, enable)`
    - 2.3: 实现 `setFpsMode(enabled)`（遍历所有标签）

- [x] Task 3: 绑定交互与导航适配
    - 3.1: 绑定 `btn-fps` 点击事件切换状态
    - 3.2: `did-stop-loading` 时若开启则重新注入

- [x] Task 4: 校验
    - 4.1: 校验 game.html 内联脚本语法
    - 4.2: 确认关闭 FPS 无残留监听/DOM
