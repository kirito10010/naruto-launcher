# 大屏固定 1080p 渲染 + 性能模式任务计划

- [x] Task 1: 启动器配置与设置面板
    - 1.1: 增加 `renderSize` 默认值与归一化
    - 1.2: 设置面板新增「性能模式」四档下拉
    - 1.3: 大屏适配关闭时禁用下拉

- [x] Task 2: IPC 与下发
    - 2.1: `set-render-size` 保存并广播
    - 2.2: `set-fit-large-screen` 广播
    - 2.3: `game-info` 下发 `renderSize`

- [x] Task 3: game.html 缩放
    - 3.1: 用 CSS transform 替代 setZoomFactor
    - 3.2: 按所选尺寸计算 baseW/baseH/scale
    - 3.3: 监听 render-size / fit-large-screen 更新
    - 3.4: 窗口 resize、标签创建时重新应用

- [x] Task 4: 校验与打包
    - 4.1: 语法检查
    - 4.2: 缩放公式验证
    - 4.3: 重新打包 2.1.0
