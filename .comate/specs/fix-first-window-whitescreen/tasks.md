# 首次打开游戏窗口白屏修复任务计划

- [✓] Task 1: 修改 createGameWindow 显示时机
    - 1.1: `show: true` 改为 `show: false`
    - 1.2: 添加 `ready-to-show` 事件，首帧渲染后 `win.show()`
    - 1.3: 添加 5 秒超时兜底，避免窗口永远隐藏
    - 1.4: 调用 `show()` 前判断 `win.isDestroyed()`

- [✓] Task 2: 校验
    - 2.1: main.js 语法校验（node --check）
    - 2.2: 确认未影响其他窗口创建逻辑
