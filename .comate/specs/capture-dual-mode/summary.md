# 抓包双模式实施 完成总结

## 结果

把抓包拆成两个**互不耦合**的模式，并修复了导出子进程退出崩溃的隐患。已打包 **1.2.0** 并验证通过。

## 模式模型

`config.captureMode`：`off` / `stats` / `full`（老配置 `captureEnabled: true` 自动归一化为 `stats`）

| 模式 | 抓什么 | 退出时做什么 |
|------|--------|--------------|
| 关闭 | 不抓 | 无 |
| **组织统计**（stats） | net-log | `--export` → 桌面「火影组织数据/<日期>/」6 张 Excel |
| **全量抓包**（full） | net-log + CDP jsonl | `--dump-capture` → 桌面「火影全量抓包/<时间>/」原始文件 + 说明.txt |

## 解耦（为了以后能干净删掉全量抓包）

所有全量抓包的接入点都打了 `// [全量抓包]` 标记，删除时搜索该标记即可：

| 组成 | 删除时 |
|------|--------|
| `capture-dump.js`（新增，独立模块） | 整个文件删掉 |
| `main.js` 的 `--dump-capture` 分支 | 删掉该 if 块 |
| `main.js` `before-quit` 的 `full` 分支 | 删掉该 else-if 块 |
| 设置面板的 `full` option | 删掉该行 |
| `capture.js`（CDP 层，现在只有 full 用） | 可一并删掉 |
| net-log 开关（两模式共用） | 保留 |
| `export.js` / `xlsx.js` | **完全没动** |

额外收益：**组织统计模式不再跑 CDP**（`export.js` 只读 net-log），少一份 JSONL 落盘 + 少一套 CDP 缓冲。

## 顺带修复的缺陷

`--export` / `--dump-capture` 子进程**退出时会崩溃**（`0xC0000005`）。

定位过程：最小复现发现 **async 函数里 `await` 过定时器（`setTimeout`）后，再走 `app.quit()` / `app.exit()` 的 Electron 退出流程就会崩**。`export.js` 的 `waitForNetlog` 里有 `await sleep(500)`，所以它一直在崩（只是子进程 detached + stdio ignore，没人看见；失败路径不经过 sleep 才没崩）。

修复：两条子进程出口都改为 `setTimeout(() => process.exit(0), 200)`（`process.exit` 绕过 Electron teardown；延迟 200ms 让 `shell.openPath` 的打开请求先派发）。

实测：`--export` 与 `--dump-capture` 退出码均从 `-1073741819` 变为 **0**。

## 验证记录

- `node --check` 全部通过（main.js / capture-dump.js / capture.js / export.js / xlsx.js / updater.js + game.html / browser.html 内联脚本）
- **全量抓包链路实测**：`electron . --dump-capture 0` → 桌面生成 `火影全量抓包/<时间>/`，含 netlog、http jsonl、说明.txt；退出码 0
- **退出崩溃修复实测**：`--export 0` 与 `--dump-capture 0` 退出码均为 0
- **UI 实测**：设置面板「抓包模式」下拉三选项（关闭 / 组织统计（生成 Excel）/ 全量抓包（导出原始文件））渲染正常；下方「组织统计抓包说明」与「全量抓包说明」两段齐全
- 打包产物 `release-v1.2.0/NarutoOnlineLauncher-Setup-1.2.0.exe`（67.45 MB，FileVersion=1.2.0 / ProductVersion=1.2.0.0）
- asar 含 `capture-dump.js` / `runDump` / `set-capture-mode` / `captureModeSel` / `全量抓包` / `dump-capture`
- `latest.yml` version=1.2.0；打包后运行正常（5 进程，启动器窗口标题「火影忍者启动器」）
- 测试产生的假抓包文件与桌面测试目录已清理

## 说明

- 全量抓包的原始文件**只复制不移动**，`%APPDATA%\naruto-online-launcher\captures` 里的原文件仍在。
- 全量抓包模式**不做自动重置**（与统计模式保持一致），用完记得在设置里切回「关闭」。
