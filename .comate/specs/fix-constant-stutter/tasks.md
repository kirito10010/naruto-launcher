# 修复游戏持续卡顿（负优化），恢复绝对流畅

- [x] Task 1: 移除 CanvasOopRasterization 开关
    - 1.1: 删除 main.js 中的 enable-features=CanvasOopRasterization

- [x] Task 2: applyFlashQuality 分支化处理 wmode
    - 2.1: 后台标签（low）设置 wmode=opaque 保证分层
    - 2.2: 激活标签（high）仅设 quality 并 removeAttribute wmode

- [x] Task 3: doStretch 跳过无变化的 transform 重设
    - 3.1: 在 doStretch 中缓存上次 scale 值
    - 3.2: scale 未变化时直接 return，避免每秒强制重绘

- [x] Task 4: 验证语法并打包
    - 4.1: node --check 校验 main.js 语法
    - 4.2: 打包为 3.2.0 验证流畅度
