# 游戏优先（进程高优先级）任务计划

- [x] Task 1: 主进程优先级
    - 1.1: 增加 `highPriority` 默认配置
    - 1.2: `applyProcessPriority()` 设置本应用所有进程高优先级
    - 1.3: ready / 创建窗口 / webview attach / 加载完成 / 15 秒补设触发

- [x] Task 2: 设置开关
    - 2.1: 性能区新增「游戏优先」开关
    - 2.2: IPC `set-high-priority` 即时应用并保存
    - 2.3: 启动器加载时下发当前状态

- [x] Task 3: 校验与打包
    - 3.1: 语法检查
    - 3.2: Node 优先级 API 验证
    - 3.3: 重新打包 2.1.0
