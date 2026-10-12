# 实现总结：每周一键导出组织数据（weekly-export）

## 完成情况

`tasks.md` 4 个任务全部完成。

| 任务 | 状态 | 产物 |
|---|---|---|
| Task 1: 最小 xlsx 生成器 | ✅ | `xlsx.js`（手写 ZIP + SpreadsheetML，零依赖） |
| Task 2: 抓包解析与数据导出 | ✅ | `export.js`（netlog + TEA + protobuf + 5 数据集 + 写盘） |
| Task 3: 接入 main.js | ✅ | `--export` 分支 + 退出自动 spawn + 抓包开关 UI/IPC |
| Task 4: 验证 | ✅ | 与 Python 版输出逐行一致；xlsx 结构校验通过 |

## 改动清单

**新增**
- **`xlsx.js`** —— 手写最小 xlsx（CRC32 + `deflateRawSync` + 本地文件头/中央目录/EOCD），`writeXlsx(path, sheets)`
- **`export.js`** —— 全部导出逻辑，可脱离 Electron 测试：
  - `extractGameStream(netlog)`：解析 netlog 事件，找连到 **11096** 端口的 socket（多个时取数据量最大，避开 843/策略文件 socket），base64 解码拼 tx/rx
  - `teaDecrypt`：腾讯 TEA（ROUNDS16/DELTA/SALT2/ZERO7，密钥 `d796c2542916b456`，链式 QQ+CBC）
  - `frames` + `pb`：36 字节分帧 + 最小 protobuf reader
  - 5 个数据集：成员(199179)/捐献(199184)/叛忍(852147)/献祭(199209)/忍战(852296+852233)
  - `buildSheets(rx)`：纯函数，返回 5 个工作簿定义
  - `runExport({mainPid})`：等主进程退出 + netlog 完整 → 写 5 个 xlsx 到 `桌面/火影组织数据/<日期>/`（失败回退 `userData/导出/`）→ `shell.openPath`
- **`tools/test_export.js`** —— 不开游戏，用已有 netlog 直接验证导出

**修改**
- **`main.js`**
  - 顶部：`--export <pid>` 分支（不建窗口，导出后 `app.quit()`）
  - `before-quit`：抓包开启时 `spawn(process.execPath, ['--export', pid], {detached:true}).unref()`
  - 启动器界面加「抓包模式」勾选框 + `set-capture` IPC + `capture-state` 回显
  - `config` 默认值加 `captureEnabled: false`

## 验证结果

1. `node --check main.js export.js xlsx.js` → 通过
2. `node tools/test_export.js <真实netlog>` → 提取游戏流 tx=6831B / rx=288179B，5 表行数与 Python 版**完全一致**：
   - 组织成员 110 / 组织捐献 110 / 叛忍 39 / 献祭 110 / 忍战 55
   - 首行内容与 Python 版逐字相同（馆长、八神 850、ROSC 15、东大叮咚 150、汐月滢 800）
3. 5 个 xlsx 经 `zipfile.testzip()` 校验通过（5~6 parts，无损坏）
4. 未开抓包时：`before-quit` 仅在 `capture.isCaptureEnabled()` 为真时 spawn，故不产生文件（代码路径确认）

## 使用方式（每周 3 步）

1. 启动器勾选「抓包模式（每周导出用，重启生效）」，**重启一次**
2. 进游戏，打开 5 个面板（组织成员 / 捐献 / 叛忍 / 通灵兽献祭 / 忍战）
3. **退出启动器** → 桌面自动出现 `火影组织数据/2026-10-12/` 含 5 个 xlsx，并自动打开文件夹

## 追加：合并总表（2026-10-12 续）

按用户要求，导出时额外生成一张**合并总表** `火影忍者数据统计表<日期>.xlsx`：把 5 个表按 `成员名` 并成一行，7 列：

| 成员 | 职务 | 战斗力 | 捐献贡献 | 缉拿叛忍数 | 献祭通灵查克拉 | 参战次数 |
|---|---|---|---|---|---|---|

- 数据来源：成员/职务/战斗力←组织成员；捐献贡献←组织捐献；缉拿叛忍数←叛忍；献祭通灵查克拉←通灵兽；参战次数←忍战
- **数值列为空时补 `0`**，不留空值
- 实现：`export.js` 的 `mergeRows()` + `buildSheets(rx, stamp)`；独立脚本 `tools/merge_excel.py`（含列对齐修复）

> 修复：xlsx 写入器会跳过空单元格，读回时必须按**单元格坐标**(A1/C1)对齐，否则列错位。

## 打包修正（重要）


`package.json` 的 `build.files` 原先只列了 `main.js / preload.js / launcher.html / game.html`，**缺少 `capture.js` / `export.js` / `xlsx.js`** —— 打包后抓包与导出功能会完全失效。已修正：

```json
"files": ["main.js", "preload.js", "game.html", "capture.js", "export.js", "xlsx.js"]
```

同时：
- 版本 `3.3.0` → **`3.4.0`**，输出目录 `release-v3.3.0` → `release-v3.4.0`
- 移除已废弃的 `launcher.html`（及其在 files 中的引用）
- 清理项目内临时产物（`_swf` / `_swf_dl` / `_tools` / `_cap_sockets` 等 ~314MB + 旧 `release-v3.3.0`），保留 `_swf_decomp` 反编译源码

## 注意事项


- 抓包开关**重启生效**（net-log 开关必须在 app ready 前设置）
- 必须**完全退出**启动器（托盘退出），否则 netlog 不完整
- 导出异常会写 `%APPDATA%/naruto-online-launcher/export-error.log`
- 需要**重新打包发版**（`npm run build`）才能装到目标机器
