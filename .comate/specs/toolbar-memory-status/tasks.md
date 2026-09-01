# 工具栏内存状态显示提示

- [x] Task 1: 工具栏新增内存状态元素与样式
    - 1.1: 在 toolbar-center 的 FPS 按钮后新增 #mem-status 元素
    - 1.2: 新增 .mem-status / .mem-dot / .normal / .warn / .danger CSS

- [x] Task 2: 主进程回传内存状态
    - 2.1: memory-check 处理器新增 statusList 收集各标签内存
    - 2.2: 始终回传 memory-status 到渲染进程

- [x] Task 3: 渲染进程展示内存状态
    - 3.1: 内存监控 setInterval 改为具名函数 reportMemory() 并立即执行
    - 3.2: 新增 updateMemStatus(mem) 函数更新颜色与文字
    - 3.3: 新增 memory-status 监听，取激活标签内存并更新

- [x] Task 4: 验证语法并打包
    - 4.1: node --check 校验 main.js 语法
    - 4.2: 打包为 3.1.1 验证工具栏状态显示
