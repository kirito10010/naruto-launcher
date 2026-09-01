# 极致流畅度调优（画质最低 + 非活跃标签冻结）

- [x] Task 1: 激活标签画质降到最低
    - 1.1: applyFlashQuality 激活分支 quality 改为 low

- [x] Task 2: 主进程新增 set-tab-throttle IPC
    - 2.1: 用 webContents.fromId 对目标 webview 调用 setBackgroundThrottling

- [x] Task 3: 渲染进程节流切换逻辑
    - 3.1: 新增 setTabThrottle(tab, throttled) 辅助函数
    - 3.2: switchTab 中旧标签冻结、新标签全速
    - 3.3: window-blur/focus 同步节流状态

- [x] Task 4: 验证语法并打包
    - 4.1: node --check 校验 main.js 语法
    - 4.2: 打包为 3.2.0 验证流畅度
