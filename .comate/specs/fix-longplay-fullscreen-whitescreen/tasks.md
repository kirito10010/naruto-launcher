# 修复长时间全屏游玩后关闭/刷新白屏

- [x] Task 1: 在 main.js 新增 killFlashPluginProcesses() 清理函数
    - 1.1: 在 getMemoryMB() 之后新增 killFlashPluginProcesses() 函数
    - 1.2: 用 app.getAppMetrics() 过滤 pepper plugin / ppapi plugin / plugin 类型进程
    - 1.3: process.kill(pid) 强杀，并同步 injectedPids.delete(pid)
    - 1.4: 对 process.kill 与整体 try/catch 做异常保护，记录清理日志

- [x] Task 2: 关闭游戏窗口时清理残留 Flash 插件进程
    - 2.1: 在 win.on('closed') 的 gameWindows.length === 0 分支内调用 killFlashPluginProcesses()
    - 2.2: 确认仅在最后一个游戏窗口关闭时执行，避免误杀多窗口 Flash

- [x] Task 3: 让刷新按钮冷启动 Flash 而不是单纯 reload
    - 3.1: 将 main.js 的 addListener('refresh-page') 从空实现改为调用 killFlashPluginProcesses()
    - 3.2: 修改 game.html 的 refreshPage() 发送 refresh-page 并设置 tab._manualRefresh 标志
    - 3.3: 增加 2.5 秒兜底 reloadIgnoringCache 保证恢复

- [x] Task 4: 避免刷新时 plugin-crashed 自动重载与兜底重载双重执行
    - 4.1: 修改 game.html 的 plugin-crashed 处理器，tab._manualRefresh 为真时跳过自动 reload
    - 4.2: 确认兜底逻辑在异常/插件崩溃不触发时仍能冷启动恢复

- [x] Task 5: 验证改动与打包
    - 5.1: 检查 main.js / game.html 语法与引用无误
    - 5.2: 打包为 3.1.1 验证长时间全屏后关闭/刷新不再白屏
