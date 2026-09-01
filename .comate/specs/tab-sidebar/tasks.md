# 标签页侧栏改造任务计划

- [x] Task 1: 修复切换标签白屏（CSS）
    - 1.1: `.webview-wrap webview.hidden` 改为 `visibility: hidden`
    - 1.2: `.webview-wrap webview.paused` 改为 `visibility: hidden`

- [x] Task 2: 新增左侧标签侧栏样式与结构
    - 2.1: 新增 `.tab-sidebar` 及其子元素 CSS（收起/展开、竖向列表、激活高亮）
    - 2.2: 移除 toolbar-left 中的 `.tabs-container`，改为「≡ 展开按钮 + 标题」
    - 2.3: 新增左侧侧栏 HTML（头部「+」按钮 + 列表容器）

- [x] Task 3: 改造标签渲染与事件绑定逻辑
    - 3.1: 更新元素查找（tabSidebar / tabSidebarList / 开关按钮 / 新建按钮）
    - 3.2: `renderTabs()` 渲染到侧栏列表，竖向排列
    - 3.3: 绑定侧栏列表点击（切换/关闭）、「≡」展开收起、「+」新建标签

- [x] Task 4: 校验
    - 4.1: 校验 game.html 内联脚本语法
    - 4.2: 确认移除旧 `tabBar`/`tab-add` 引用，无残留报错
