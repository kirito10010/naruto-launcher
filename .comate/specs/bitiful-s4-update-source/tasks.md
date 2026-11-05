# 缤纷云 S4 更新源接入任务计划

- [x] Task 1: updater.js 接入 S4
    - 1.1: 新增 `S4_MIRROR`（支持 `HYOL_UPDATE_S4` 覆盖）
    - 1.2: `FEEDS` 增加「缤纷云 S4」并放在国内镜像首位
    - 1.3: 更新源优先级注释同步

- [x] Task 2: 校验
    - 2.1: `node --check updater.js`
    - 2.2: 确认 S4 未上传时自动回退其它源
    - 2.3: 确认公开读取 URL 返回 404 而不是 403（桶可匿名访问）
