# 存储治理：抓包缓存上限 + 设置内一键清理 + 卸载钩子

- [x] Task 1: 抓包缓存纳入自动清理
    - 1.1: `CLEANUP_CONFIG` 增加 `captureKeepFiles: 3` / `captureKeepDays: 7` / `captureMaxTotal: 2GB`
    - 1.2: 新增 `cleanupCaptures()`：按修改时间倒序；永远保留最新 3 个 `netlog-*` + 3 个 `http-*`；超过 7 天删除；总量超 2GB 从最旧删到 ≤2GB（至少保留最新 1 个 netlog）
    - 1.3: 单个文件删除失败（被占用）逐个 `try/catch` 跳过，不中断
    - 1.4: 把 `cleanupCaptures` 加入 `performStartupCleanup()` 的步骤列表
    - 1.5: 清理后写一条日志（删除文件数 / 释放 MB）

- [x] Task 2: 设置面板「抓包缓存」+ 一键清理
    - 2.1: 主进程新增 `get-storage-info` IPC：返回 `{ bytes, files }`（统计 `captures/` 下 netlog / jsonl）
    - 2.2: 主进程新增 `clear-captures` IPC：删除这些文件并返回 `{ freed, files }`
    - 2.3: 设置 → 性能 下方新增一行：`抓包缓存 <大小> · <数量> 个文件` + 「清理」按钮
    - 2.4: 打开设置面板时请求一次占用；点「清理」后刷新显示并提示释放了多少

- [x] Task 3: 卸载时清理用户数据
    - 3.1: 新增 `build/installer.nsh`，实现 `!macro customUnInstall`：无条件删除可再生成的大缓存目录与日志
    - 3.2: 卸载时弹「是否同时删除本地保存的账号与设置」：是 → 删整个目录；否 → 保留；`IfSilent` 静默卸载直接保留
    - 3.3: `package.json` 的 `build.nsis` 增加 `"include": "build/installer.nsh"`

- [x] Task 4: 验证
    - 4.1: `node --check main.js` 通过
    - 4.2: 开发模式启动：设置里显示当前抓包缓存大小与文件数；点「清理」后数字归零并提示释放量
    - 4.3: 构造超限数据验证 `cleanupCaptures()`：保留最新 3 份、删掉超 7 天与超 2GB 的部分（用临时目录 + 真实函数调用验证）
    - 4.4: 打包 1.5.0 现有配置不受影响（`nsis.include` 生效、安装包仍能正常生成）
