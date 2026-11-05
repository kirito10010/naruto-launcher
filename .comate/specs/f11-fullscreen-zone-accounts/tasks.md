# F11 全屏修复 + 账号按区服拆分任务计划

- [x] Task 1: 修复 F11 双触发
    - 1.1: 从 `matchShortcut` 移除 F11
    - 1.2: 全局 F11 监听增加 `isAutoRepeat` 保护

- [x] Task 2: 账号按区服拆分迁移
    - 2.1: 重写 `migrateAccountZones` 为按 credential 拆分账号
    - 2.2: 账号 ID 去重
    - 2.3: `resolveAccountZoneId` 兼容单凭证账号

- [x] Task 3: 凭证抓取与清除
    - 3.1: 按 QQ + zone_id 匹配账号，必要时新建
    - 3.2: 清除凭证只清当前条目
    - 3.3: 更新账号 QQ 时清空当前凭证

- [x] Task 4: 文案与校验
    - 4.1: 更新账号说明文案
    - 4.2: `node --check main.js`
    - 4.3: game.html 内联脚本语法检查
    - 4.4: 用 mock 数据验证拆分结果与一键启动条目数
