# 标签显示方式切换任务计划

- [x] Task 1: 新增顶部横向标签样式与结构
    - 1.1: 重新加入横向标签 CSS（.tabs-container/.tabs-list/.tab/.tab-close/.tab-add，激活态用 var(--accent)）
    - 1.2: toolbar-left 重新加入 #tabs-container（含 #tabs-list + #tab-add-h），默认 display:none
    - 1.3: 把 btn-clear-cache 替换为 btn-tab-mode 切换按钮

- [x] Task 2: 实现双模式渲染与切换逻辑
    - 2.1: 新增 tabDisplayMode 状态与元素查找
    - 2.2: renderTabs() 同时渲染侧边栏列表与顶部列表
    - 2.3: setTabDisplayMode(mode) 切换显示/隐藏与激活态

- [x] Task 3: 绑定交互
    - 3.1: btnTabMode 点击切换模式
    - 3.2: tabAddH 新建标签、tabsList 点击切换/关闭
    - 3.3: 移除失效的 clearCache 逻辑

- [x] Task 4: 校验
    - 4.1: 校验 game.html 内联脚本语法
    - 4.2: 确认无残留 btn-clear-cache 引用
