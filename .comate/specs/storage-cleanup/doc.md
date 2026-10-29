# 数据目录 12GB + 卸载不清理：抓包缓存上限策略 + 卸载钩子 + 一键清理

## 1. 现状实测（`%APPDATA%\naruto-online-launcher`）

| 目录/文件 | 占用 | 说明 |
| --- | --- | --- |
| **captures/** | **12044.9 MB（11.76 GB）** | 63 个文件，几乎全是 `netlog-*.json` |
| **Partitions/** | **428.6 MB** | `game-1` 389 MB、`game-101` 39.5 MB（游戏会话分区缓存，含 Flash 缓存） |
| Cache / GPUCache / Code Cache | 7.3 / 0.5 / 0.2 MB | 正常 |
| 其余（config.json、accounts.json、日志…） | < 1 MB | |

`captures/` 里的时间跨度是 10-16 ~ 10-29，说明**每个会话都在新增、从来没删过**。单个 netlog 从几百 KB 到几百 MB 不等（全量抓包时最大）。

## 2. 两个问题的根因

### 2.1 为什么会有 12GB

`main.js` 里已有 `performStartupCleanup()` + `CLEANUP_CONFIG`，但**只覆盖**：

1. `launcher.log` 轮转（5 MB / 7 天）
2. Electron 缓存目录（blob_storage、Session Storage、Service Worker、shared_proto_db）
3. 过期 Session 分区（3 天）
4. 更新临时文件

**`captures/` 完全没被纳入清理**。而且日志里的 INFO 不会落盘，用户也看不到任何提示。

### 2.2 为什么卸载不删

- electron-builder 的 NSIS 卸载器**默认不删除 `%APPDATA%` 下的用户数据**。
- 就算打开 `nsis.deleteAppDataOnUninstall`，它按 `productName / appId` 推导目录（本项目 productName 是 `NarutoOnlineLauncher`），而实际 userData 目录名来自 `package.json` 的 `name` = **`naruto-online-launcher`** —— 存在删错目录的风险。
- 另外 `accounts.json` 里 `qqPwd` 是**明文**保存的，卸载时清掉更安全。

## 3. 方案

### 3.1 抓包缓存纳入自动清理

在 `CLEANUP_CONFIG` 增加：

```js
captureKeepFiles: 3,                       // 最新 3 个 netlog / 3 个 jsonl
captureKeepDays: 7,                        // 超过 7 天删除
captureMaxTotal: 2 * 1024 * 1024 * 1024    // captures 总量上限 2 GB
```

新增 `cleanupCaptures()`（加入 `performStartupCleanup()` 的步骤列表）：

1. 列出 `captures/` 下 `netlog-*.json` 与 `http-*.jsonl`，按修改时间倒序；
2. **永远保留**最新 3 个 netlog + 最新 3 个 jsonl；
3. 其余：修改时间超过 7 天 → 删；
4. 若总量仍 > 2 GB → 从最旧的开始删，直到 ≤ 2 GB（始终保留最新 1 个 netlog）；
5. 写一条清理日志（文件数 / 释放 MB）。

> 安全性：清理在**启动 3 秒后、无游戏窗口时**执行；上一会话的导出子进程在退出时就已经读完 netlog 了，不会被抢删。

### 3.2 设置里加「抓包缓存」+ 一键清理

设置 → 性能 下方新增一行：

```
抓包缓存   12.0 GB · 63 个文件        [清理]
```

- 打开设置时通过 IPC 取一次占用（递归 stat，很快）；
- 点「清理」→ 删除 `captures/` 下的 netlog / jsonl → 刷新显示 → 提示「已释放 X GB」；
- 只删抓包文件，不动 `captures` 目录本身，也不影响正在进行的抓包（下次会话照常写）。

### 3.3 卸载钩子

新增 `build/installer.nsh`，在 `package.json` 里 `nsis.include` 指向它：

```nsh
!macro customUnInstall
  ; ① 可再生成的大文件：无条件删除
  RMDir /r "$APPDATA\naruto-online-launcher\captures"
  RMDir /r "$APPDATA\naruto-online-launcher\Partitions"
  RMDir /r "$APPDATA\naruto-online-launcher\Cache"
  RMDir /r "$APPDATA\naruto-online-launcher\GPUCache"
  RMDir /r "$APPDATA\naruto-online-launcher\Code Cache"
  RMDir /r "$APPDATA\naruto-online-launcher\Dictionaries"
  RMDir /r "$APPDATA\naruto-online-launcher\blob_storage"
  RMDir /r "$APPDATA\naruto-online-launcher\Session Storage"
  RMDir /r "$APPDATA\naruto-online-launcher\Local Storage"
  RMDir /r "$APPDATA\naruto-online-launcher\Service Worker"
  RMDir /r "$APPDATA\naruto-online-launcher\shared_proto_db"
  Delete "$APPDATA\naruto-online-launcher\*.log"

  ; ② 账号/设置：卸载时问一次
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除本地保存的账号与设置？$\r$\n$\r$\n选「否」会保留，方便以后重新安装继续使用。" IDNO done
  RMDir /r "$APPDATA\naruto-online-launcher"
  done:
!macroend
```

- 静默卸载（`/S`）不弹框，保留账号与设置（最安全）。
- 显式写死目录名，不依赖 electron-builder 的推导。

## 4. 影响文件

| 文件 | 改动 |
| --- | --- |
| `main.js` | `CLEANUP_CONFIG` 增加三项；新增 `cleanupCaptures()` 并加入启动清理步骤；新增 `get-storage-info` / `clear-captures` 两个 IPC；设置面板新增「抓包缓存」行与刷新逻辑 |
| `build/installer.nsh` | **新增**：卸载钩子 |
| `package.json` | `build.nsis.include` 指向 `build/installer.nsh`（`build.files` 不需要包含 `.nsh`，它只在打包时用） |

## 5. 边界与异常

| 场景 | 处理 |
| --- | --- |
| 一次会话的 netlog 就超过 2 GB | 始终保留最新 1 个，不会把当前会话删掉 |
| 用户想保留某份抓包做分析 | 最多保留 3 份 / 7 天；需要长期保留就自行复制走（文档现有说明已提到） |
| 清理时文件正被占用 | 逐个 `try/catch`，删不掉的跳过，不中断其它文件 |
| 静默卸载 | 不弹框，保留账号与设置，只删大缓存 |
| 非管理员用户安装（perMachine） | `$APPDATA` 仍是执行卸载的用户目录；删不到就跳过（NSIS 不报错） |
| 正在抓包时点「清理」 | 只删历史文件；当前会话的 netlog 由 Chromium 持有句柄，删不掉会被跳过 |

## 6. 预期结果

- 用户目录从 12 GB 回到 **≤ 2 GB**（保留最近 7 天内的抓包、总量不超过 2 GB，最新 3 份保底），且以后每次启动自动维持在限额内。
- 设置里能直接看到「抓包缓存 X GB」，一键清空。
- 卸载时大缓存无条件清掉，账号/设置按用户选择保留或删除。

## 7. 待确认

1. 保留策略：**3 份 / 7 天 / 总量 2 GB** 是否合适？（可以改成 5 份 / 1 GB 之类）
2. 卸载时弹「是否同时删除账号与设置」是否接受？（默认是；静默卸载不弹、保留账号）
3. 设置里的「抓包缓存 + 清理」按钮是否要做？（默认做；不做的话只能等启动时自动清）
