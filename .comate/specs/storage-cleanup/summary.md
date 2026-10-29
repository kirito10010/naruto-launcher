# 修复总结：存储治理（抓包缓存上限 + 一键清理 + 卸载钩子）

## 1. 问题与根因

| 问题 | 根因 |
| --- | --- |
| 数据目录 12 GB | `captures/` 占 11.76 GB（63 个文件，全是每次抓包新增的 netlog）；启动清理只覆盖日志 / Electron 缓存 / Partitions / 更新临时文件，**从未清理 captures** |
| 卸载后数据还在 | electron-builder 的 NSIS 卸载器默认不删 `%APPDATA%`；而 userData 目录名（`naruto-online-launcher`）与 productName（`NarutoOnlineLauncher`）不一致，不能用 `deleteAppDataOnUninstall` 盲删 |

## 2. 改动

### 2.1 抓包缓存自动清理（`main.js`）

- `CLEANUP_CONFIG` 新增：`captureKeepFiles: 3`、`captureKeepDays: 7`、`captureMaxTotal: 2GB`
- 新增 `listCaptureFiles()` / `captureStorageInfo()` / `cleanupCaptures()`
- `cleanupCaptures()` 加入 `performStartupCleanup()` 步骤：
  1. 最新 3 个 netlog + 3 个 jsonl 永远保留；
  2. 其余超过 7 天的删除；
  3. 总量仍超 2 GB 时从最旧的删到 ≤ 2 GB（始终保留最新 1 个 netlog）；
  4. 单个文件删不掉（被占用）跳过，不中断。

### 2.2 设置内「抓包缓存 + 清理」（`main.js`）

- 新增 IPC：`get-storage-info` → `storage-info`；`clear-captures` → `storage-cleared`
- 设置 → 性能 下方新增一行：`抓包缓存  12.0 GB · 63 个文件  [清理]`
- 打开设置时自动刷新；点清理后显示「已释放 X · 现在 Y」

### 2.3 卸载钩子（`build/installer.nsh` + `package.json`）

- `!macro customUnInstall`：
  1. 无条件删除可再生成的大缓存（captures / Partitions / Cache / GPUCache / Code Cache / 各种 Storage / *.log）；
  2. 弹框询问「是否同时删除本地保存的账号与设置」，选否就保留；
  3. `IfSilent` 静默卸载不弹框、保留账号与设置。
- `package.json` 的 `build.nsis` 增加 `"include": "build/installer.nsh"`。
- `build/` 目录不会被打进 asar（构建日志确认 `!build{,/**/*}` 已排除）。

## 3. 验证（真实数据）

| 验证项 | 结果 |
| --- | --- |
| `node --check main.js` | 通过 |
| 启动清理（真实 12 GB 数据） | `63 个文件 / 11.76 GB` → **`20 个文件 / 1.25 GB`**，7 天前的全部清掉，最新 3 份与近期抓包保留 |
| 设置面板显示 | 显示 `1.25 GB · 20 个文件`，与磁盘实际一致 |
| 一键清理 | 用 3 个测试文件（3.1 MB）验证：点击后显示「已释放 3.1 MB · 现在 434 KB」，测试文件全删；当前会话被 Chromium 占用的 netlog 自动跳过 |
| 重新打包 1.5.0 | 带 `nsis.include` 构建成功（exit 0），`build/installer.nsh` 编译通过，安装包/blockmap/latest.yml 正常产出 |
| 回归 | `build.files` 与 asar 内容未受影响（`quiz-export.js` 等 12 个文件仍在） |

## 4. 用户侧变化

- 首次运行新版启动器时，12 GB 会**自动降到 ≤ 2 GB**（无需手动操作）。
- 设置里能直接看到抓包缓存占用，随时一键清空。
- 卸载时大缓存无条件删除；账号与设置按弹窗选择保留或删除（静默卸载保留）。

## 5. 版本

改动归入 **1.5.0**，已重新打包：`release-v1.5.0/NarutoOnlineLauncher-Setup-1.5.0.exe`。
