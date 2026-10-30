# 在线人数后台调整任务

- [x] Task 1: 浮动改为 10 分钟一换
    - 1.1: `server-app/main.js` 新增 `FLOAT_INTERVAL = 10 * 60 * 1000`
    - 1.2: `virtualOffset()` 按时间桶生成 `[-float, +float]` 偏移
    - 1.3: 验证同一浮动值可稳定保持 60 秒

- [x] Task 2: 实际在线刷新提速
    - 2.1: `online.js` 的 `REPORT_EVERY` 改为 5 秒
    - 2.2: 服务端 `TTL` 设为 20 秒、`PRUNE_EVERY` 设为 5 秒
    - 2.3: 验证停止上报后约 20 秒从统计中剔除

- [x] Task 3: 时间段重叠校验
    - 3.1: 新增 `validateRules()`，支持跨天拆分与首尾相接
    - 3.2: `save-rules` 校验失败返回 `{ ok:false, error }` 且不落盘
    - 3.3: 错误文案带游戏名与规则序号

- [x] Task 4: 时间选择器改造
    - 4.1: 规则改为卡片式布局（时间一行、数值一行）
    - 4.2: 时/分改用 24/60 项原生下拉
    - 4.3: 新增 `#saveErr` 错误条与修改后自动隐藏

- [x] Task 5: 版本与打包
    - 5.1: `server-app/package.json` 升到 1.0.1
    - 5.2: 根 `package.json` 升到 1.8.0、输出 `release-v1.8.0`
    - 5.3: 构建后台 zip 与启动器安装包并校验 asar 内容
    - 5.4: 清理旧 1.0.0 zip 与临时测试文件
