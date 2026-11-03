# 顶栏空白拖动与标签短名任务计划

- [x] Task 1: 顶栏空白可拖动
    - 1.1: `.tabs-list` 末尾追加 `.tabs-drag-fill`
    - 1.2: 填充区设置 `-webkit-app-region: drag`，标签保持 `no-drag`
    - 1.3: 确认填充不参与标签排序计算

- [x] Task 2: 标签短名
    - 2.1: 新增 `accountTabName`
    - 2.2: game-info 初始标签与 launch-account 新标签改用短名
    - 2.3: `shortZoneName` 无「数字+区」时截断

- [x] Task 3: 校验
    - 3.1: game.html 内联脚本语法检查
    - 3.2: 确认标签拖拽/drop 区域未被 drag 区域覆盖
