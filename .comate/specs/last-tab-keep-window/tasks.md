# 关闭最后一个标签时保留窗口任务计划

- [x] Task 1: 修改 removeTab 最后一个标签逻辑
    - 1.1: 移除 `closeWindow()` 调用
    - 1.2: 清空 activeTabId 并 `addTab()` 新建空白标签

- [x] Task 2: 校验
    - 2.1: game.html 内联脚本语法检查
    - 2.2: 确认非最后一个标签的切换逻辑不变
