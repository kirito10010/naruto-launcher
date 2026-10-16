# 多窗口登录串号修复 任务计划

- [x] Task 1: main.js 分配并下发窗口槽位
    - 1.1: 新增模块级 `gameWindowSlotCounter`（本次运行内单调递增，1 起）
    - 1.2: `createGameWindow()` 内取 `const windowSlot = ++gameWindowSlotCounter;`
    - 1.3: `did-finish-load` 的 `game-info` 负载增加 `windowSlot`

- [x] Task 2: game.html 分区改为「标签创建时确定」
    - 2.1: 新增 `let windowSlot = 1;`，在 `game-info` 处理里于 `addTab()` 之前赋值为 `data.windowSlot || 1`
    - 2.2: 新增 `computePartition(tab, account)`：不落盘用 `tab-<id>`；已知账号用 `persist:qq-<QQ>`；否则 `persist:game-<((windowSlot-1)*100 + tab.index)>`
    - 2.3: `addTab()` 里算出 `tab._partition` 并挂到标签对象上
    - 2.4: `createWebview()` 改用 `tab._partition`；`getPartition()` 保留为兜底（`tab._partition || computePartition(tab)`）

- [x] Task 3: 校验与打包
    - 3.1: `node --check main.js` + `game.html` 内联脚本语法检查
    - 3.2: 本地实测：开两个窗口确认分区名不同（`persist:game-1` / `persist:game-101`），单窗口多标签分区名与改动前一致
    - 3.3: 打包 1.1.0 并输出【新增】【优化】【修复】格式更新说明
