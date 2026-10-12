# 每周一键导出组织数据（weekly-export）

## 1. 需求与场景

用户每周日抓一次数据，得到 5 个 Excel（组织成员 / 组织捐献 / 叛忍 / 通灵兽献祭 / 忍战）。

**约束**：抓包在**另一台只装了 exe 安装包的电脑**上，那台机器**没有 Node/Python**。
→ 导出逻辑必须**内置进启动器**（Electron/Node，零外部依赖）。

**目标体验**（每周 3 步）：
1. 启动器勾选「抓包模式」（存 config，一次长期有效）
2. 进游戏打开 5 个面板
3. 退出启动器 → **5 个 Excel 自动生成到桌面并弹出文件夹**

## 2. 技术方案

### 2.1 为什么必须「退出后」导出
Chromium 的 `--log-net-log` 在进程退出时才 flush（实测：强杀 → 只有 constants 无 events；正常退出 → 完整）。因此导出必须在主进程退出后由**独立进程**执行。

### 2.2 进程模型（关键）
```
主进程(启动器)
  └─ 退出前 spawn detached 子进程: NarutoOnlineLauncher.exe --export <mainPid>
        └─ 等 mainPid 结束 → netlog 完整 → 解析 → 生成 5 个 xlsx → 打开文件夹 → 退出
```
- 启动器**没有** `requestSingleInstanceLock`（已确认），子进程不会被单实例锁拦截。
- `--export` 模式在 `main.js` **最顶部**判定并直接执行导出逻辑后 `app.quit()`，不创建任何窗口。

### 2.3 抓包数据来源
沿用现有 netlog 方案（`capture.js` + `--log-net-log`）。导出时从 netlog 中：
1. 按 `TCP_CONNECT`/`TCP_CONNECT_ATTEMPT` 的地址找到**连到 11096 端口**的 socket（不再硬编码 1406）
2. 取该 socket 的 `SOCKET_BYTES_SENT/RECEIVED`（base64 解码）拼成 tx/rx 流

### 2.4 解密与解析（Node 重写）
- **TEA**：`ROUNDS=16 DELTA=0x9E3779B9 SALT_LEN=2 ZERO_LEN=7`，密钥 `d796c2542916b456`，
  链 `P_i = TEA_dec(P_{i-1} ^ C_i)`，输出 `P_i ^ C_{i-1}`。
- **分帧**：36 字节头（magic 0x0901 / len(u16BE) / cmdId(u32BE) / index / type / …）
- **Protobuf**：最小 reader（varint + length-delimited）
- **5 类数据集**（命令号 → 字段映射，均已在阶段一/二验证）：
  | 表 | 命令 | 列 |
  |---|---|---|
  | 组织成员 | 199179 | 成员(区服-昵称)/职务/组织贡献度(当前/历史)/职业/等级/战斗力/离线时间/组织战白名单 |
  | 组织捐献 | 199184 | 排行/角色名字/捐献贡献 |
  | 叛忍数据 | 852147 | 排名/玩家名/缉拿叛忍数(值/600)/击杀数(值/600)/杰出奖 |
  | 组织通灵兽 | 199209 | 排行/角色名字/献祭通灵查克拉 |
  | 忍战数据 | 852296(跨服)/852233(本服) | 名称/职务/参战次数/战斗力/战力增幅/本周贡献 |
- 职务/职业中文名映射：`GuildMemberIdentity` / `MajorNinjaDef`（已验证）。

### 2.5 xlsx 生成（零依赖）
Node 无内置 zip 写入，手写最小 xlsx：`[Content_Types].xml` + `_rels/.rels` + `xl/workbook.xml` + `xl/worksheets/sheetN.xml`，用 `zlib.deflateRawSync` + 自写 CRC32 打包。

## 3. 涉及文件

| 文件 | 改动 |
|---|---|
| `export.js` | **新增**：netlog 解析 + TEA + protobuf + 5 类数据集 + xlsx 写入 |
| `xlsx.js` | **新增**：最小 xlsx 生成器（zip + XML） |
| `main.js` | 顶部：`--export` 模式分支；启动器 UI 加「抓包模式」勾选框 + IPC；`before-quit` spawn detached 导出进程 |
| `config.json` | 新增 `captureEnabled`（已有 CAPTURE_ENABLED 逻辑复用） |

## 4. 实现细节（关键片段）

### 4.1 main.js 顶部：导出模式分支
```js
if (process.argv.includes('--export')) {
  const pidIdx = process.argv.indexOf('--export');
  const mainPid = parseInt(process.argv[pidIdx + 1], 10) || 0;
  require('./export').runExport({ mainPid })
    .catch((e) => { try { require('fs').appendFileSync(require('path').join(require('electron').app.getPath('userData'), 'export-error.log'), String(e && e.stack || e) + '\n'); } catch (_) {} })
    .finally(() => require('electron').app.quit());
  return; // 不继续执行正常启动流程
}
```

### 4.2 main.js：退出前 spawn
```js
app.on('before-quit', () => {
  if (capture.isCaptureEnabled()) {
    try {
      const { spawn } = require('child_process');
      spawn(process.execPath, ['--export', String(process.pid)], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {}
  }
  // ...原有逻辑
});
```

### 4.3 export.js 骨架
```js
async function runExport({ mainPid }) {
  const netlog = await waitForNetlog();          // 等主进程退出 + netlog 完整
  const { tx, rx } = extractGameStream(netlog);  // 找 11096 端口 socket
  const data = { members: dsMembers(rx), donate: dsDonate(rx), rebel: dsRebel(rx), beast: dsBeast(rx), gvg: dsGvg(rx) };
  const dir = path.join(app.getPath('desktop'), '火影组织数据', today());
  writeXlsx(path.join(dir, '1-组织成员.xlsx'), [{name:'组织成员', rows:data.members}]);
  /* … 2~5 … */
  shell.openPath(dir);
}
```

### 4.4 抓包开关（UI + config）
- 启动器内嵌 HTML 加一个 checkbox「抓包模式（导出用）」
- `ipcMain.on('set-capture', (e, on) => { config.captureEnabled = !!on; saveConfig(); })`
- 重启生效（因 net-log 开关需在 ready 前设置）

## 5. 边界条件

| 场景 | 处理 |
|---|---|
| 未开抓包 | 不 spawn 导出进程 |
| netlog 不存在/为空 | 导出失败，写 `export-error.log`，不弹窗 |
| 未找到 11096 socket | 报错日志提示"未捕获到游戏连接" |
| 某类数据本次未抓（如忍战未开） | 该表只有表头（不报错） |
| 桌面路径不可写 | 回退到 `userData/导出/` |
| 子进程被安全软件拦 | 主进程退出不受影响；用户可手动跑 `--export` |
| 多次导出同名日期 | 覆盖当日目录 |

## 6. 数据流
```
勾选抓包 → 启动器(net-log) → 玩游戏 → 退出
   → spawn --export 子进程 → 等 netlog 完整
   → 解析 netlog → 找 11096 socket → tx/rx
   → TEA 解密 + Protobuf → 5 类数据集
   → 写 5 个 xlsx 到 桌面/火影组织数据/<日期>/ → 打开文件夹
```

## 7. 预期结果
每周：勾选抓包 → 玩 → 退出 → 桌面自动出现 `火影组织数据/2026-10-12/` 含 5 个 xlsx。

## 8. 验证
1. `npm start -- --capture-traffic`，玩，退出 → 桌面出现 5 个表
2. 与已验证的 Python 版输出逐行比对（同一次抓包）
3. 未开抓包时退出 → 不产生任何文件
