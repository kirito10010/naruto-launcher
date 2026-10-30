# 在线人数后台调整 · 完成总结（1.8.0）

## 完成内容

1. **浮动 10 分钟一换**：`virtualOffset()` 以 `floor(now/600000)` 为桶，MD5 派生随机数映射到 `[-float, +float]`。实测连续 60 秒上报，显示值保持不变。
2. **实际在线提速**：启动器上报 15s → 5s；服务端 TTL 20s、清理周期 5s。实测停止上报约 20 秒后客户端被剔除。
3. **时间段重叠校验**：`validateRules()` 支持跨天拆分；首尾相接放行；重叠时返回「火影忍者Online：第 1 条与第 2 条时间段重叠」，不写配置文件。已用 6 组样例回归通过（普通重叠 / 相接 / 跨天重叠 / 跨天相接 / 起止相同 / 不重叠）。
4. **时间选择器**：规则改为卡片式，时、分各自原生下拉（00–23 / 00–59），改动即标记 dirty，并自动隐藏上次错误提示。
5. **版本与产物**：
   - 后台 `HYOL-OnlineServer-1.0.1.zip`（72.19 MB），解压后根目录即 `HYOL-OnlineServer.exe`。
   - 启动器 `NarutoOnlineLauncher-Setup-1.8.0.exe`（67.47 MB）+ `.blockmap` + `latest.yml`（version 1.8.0）。
   - 校验 asar：`online.js` 为 `REPORT_EVERY = 5 * 1000`，`updater.js` 镜像地址正确。
   - 删除旧 `HYOL-OnlineServer-1.0.0.zip` 与全部临时测试文件。

## 说明

- 发布 GitHub 需要 3 个文件（latest.yml / exe / blockmap）；网站镜像只需 2 个（exe / blockmap），latest.yml 由发布页生成。
- 服务器端配置已重置为空规则，避免测试数据影响线上。
