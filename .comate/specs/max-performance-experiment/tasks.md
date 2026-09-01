# 性能最大化实验：解除帧率限制与后台节流

- [x] Task 1: 追加解除限帧与节流的命令行开关
    - 1.1: 追加 disable-frame-rate-limit / disable-gpu-vsync
    - 1.2: 追加 disable-background-timer-throttling / disable-renderer-backgrounding / disable-backgrounding

- [x] Task 2: 游戏窗口关闭后台节流
    - 2.1: createGameWindow 的 backgroundThrottling 改为 false
    - 2.2: webview webpreferences 追加 backgroundThrottling=no

- [x] Task 3: 激活标签 Flash 强制 wmode=direct
    - 3.1: applyFlashQuality 激活分支改为 setAttribute wmode=direct

- [x] Task 4: 验证语法并打包
    - 4.1: node --check 校验 main.js 语法
    - 4.2: 打包为 3.2.0 验证流畅度提升
