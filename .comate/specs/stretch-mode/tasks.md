# 拉伸模式功能任务计划

- [x] Task 1: 在工具栏新增「拉伸」开关按钮
    - 1.1: 在 toolbar-center 中新增 `btn-stretch` 按钮及分隔符
    - 1.2: 复用 `.btn.active` 高亮样式，设置 title 提示

- [x] Task 2: 实现拉伸注入与移除逻辑
    - 2.1: 定义拉伸/移除的注入 JS 脚本常量
    - 2.2: 实现 `applyStretchToWebview(webview, enable)`
    - 2.3: 实现 `setStretchMode(enabled)`（遍历所有标签并持久化）

- [x] Task 3: 绑定交互与导航/新标签适配
    - 3.1: 绑定 `btn-stretch` 点击事件切换状态
    - 3.2: `did-stop-loading` 时若开启则重新注入
    - 3.3: 启动时读取 `stretchMode` 配置恢复状态

- [x] Task 4: 校验
    - 4.1: 检查 game.html 脚本语法/结构正确
    - 4.2: 确认未破坏既有工具栏/标签切换逻辑
