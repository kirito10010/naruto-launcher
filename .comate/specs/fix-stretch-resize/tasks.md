# 拉伸跳动修复任务计划

- [x] Task 1: 修正拉伸测量的反馈回路
    - 1.1: `doStretch` 中 `getBoundingClientRect()` 改为 `offsetWidth`/`offsetHeight`
    - 1.2: 保留「取面积最大 embed/object」的选取逻辑

- [x] Task 2: 用定时重算兜底替代原轮询
    - 2.1: 开启时 `setInterval(doStretch, 1000)` 常驻重算
    - 2.2: 关闭时 `clearInterval` 清理定时器

- [x] Task 3: 校验
    - 3.1: 校验 game.html 内联脚本语法
    - 3.2: 确认关闭拉伸无残留定时器/监听
