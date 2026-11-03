# 同一 QQ 多区服凭证实施计划
- [x] Task 1: 主进程多区凭证存储与迁移
    - 1.1: 账号加载时迁移 `credential` → `credentials[zone_id]` 并补 `lastZoneId`
    - 1.2: `captureCredentialFromGuest` 按 `zone_id` upsert，更新 `lastZoneId` 与兼容字段

- [x] Task 2: 主进程区服 IPC 与启动选凭证
    - 2.1: 新增 `set-account-zone`；`clear-credential` 支持按区清理
    - 2.2: `launch-account-window`、`launch-all-accounts-window` 按区/`lastZoneId` 选凭证并下发浅拷贝
    - 2.3: 无窗口时创建窗口/新标签的启动路径同样按区选凭证

- [x] Task 3: 游戏窗口账号栏区服选择
    - 3.1: 账号条目渲染区服下拉（多区）或文本（单区），状态按选中区显示
    - 3.2: 切换区服持久化并刷新；清除按钮按区清理
    - 3.3: 开窗按钮传区服；多区标签名带区服名

- [x] Task 4: 校验与总结
    - 4.1: 语法检查、关键路径 grep 校验
    - 4.2: 写 `summary.md`
