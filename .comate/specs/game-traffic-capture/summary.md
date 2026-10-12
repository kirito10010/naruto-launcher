# 实现总结：游戏流量抓包层（阶段一）

## 完成情况

`tasks.md` 中 5 个任务全部完成。

| 任务 | 状态 | 产物 |
|---|---|---|
| Task 1: 新增 `capture.js` 抓包层核心模块 | ✅ | `capture.js`（新增，~185 行） |
| Task 2: 修改 `main.js` 顶部开关与 net-log 配置 | ✅ | `main.js` 顶部新增 `readConfigSync()` / `CAPTURE_ENABLED` / net-log 开关 |
| Task 3: 修改 `main.js` `whenReady` 初始化抓包 | ✅ | `app.whenReady()` 内调用 `capture.initCapture()` |
| Task 4: 新增 `tools/analyze-capture.js` 离线分析脚本 | ✅ | `tools/analyze-capture.js`（新增） |
| Task 5: 验证抓包层 | ✅ | 见下方验证结果 |
| Task 6: 修正 net-log 抓包模式 | ✅ | `IncludeSensitive` → `IncludeSocketBytes` |
| Task 7: 新增 net-log 字节提取工具 | ✅ | `tools/extract-socket-bytes.js` |

## 改动清单

### 新增
- **`capture.js`** —— 抓包层全部逻辑：
  - `initCapture(opts)`：创建 `captures/` 目录、打开 `http-<时间戳>.jsonl`、注册 `app.on('web-contents-created')` 并挂载已有 webContents
  - `attach(wc)`：通过 `webContents.debugger` 附加 CDP，开启 `Network`（100MB buffer）与 `Page` 域
  - `handleCdp`：落盘 `req` / `res` / `body`（含响应体）/ `ws-open` / `ws-sent` / `ws-recv`
  - 全链路 try/catch，写入失败或附加失败均不影响游戏运行
- **`tools/analyze-capture.js`** —— 离线分析：按 host 汇总、端点频次 Top20、大响应体 Top10、关键词检索（组织/成员/活动/member/guild/org/activity/rank）、WebSocket 帧片段

### 修改
- **`main.js`**
  - 顶部：`require('./capture')`；`readConfigSync()` 同步读取 `config.json`；计算 `CAPTURE_ENABLED`（argv `--capture-traffic` / env `NARUTO_CAPTURE=1` / config `captureEnabled`）
  - 命令行开关区（`disk-cache-size` 之后）：按开关追加 `log-net-log` 与 `net-log-capture-mode=IncludeSensitive`
  - `app.whenReady()`：`initSpeedControl()`/`initAutoUpdater()` 之后调用 `capture.initCapture({ enabled: CAPTURE_ENABLED })`，开启时打印输出目录

## 验证结果

1. `node --check capture.js main.js tools/analyze-capture.js` —— 全部通过（exit 0）。
2. 用合成 JSONL 端到端跑通 `tools/analyze-capture.js`：host 汇总、端点统计、大响应体、关键词命中、WS 帧打印均正确输出。
3. 关闭开关路径经代码审查确认零副作用：`initCapture` 立即 return，不创建目录/文件、不附加 debugger。

> 注：Task 5.1/5.3 的「真实游戏抓包」需在有图形界面的环境实际运行 `npm start -- --capture-traffic` 并进入游戏操作，当前会话无法启动 GUI，已由语法校验 + 合成数据端到端验证替代，留待用户本地执行。

## 使用方式

```bash
# 方式一：命令行参数
npm start -- --capture-traffic

# 方式二：环境变量
#   PowerShell: $env:NARUTO_CAPTURE=1; npm start

# 方式三：config.json 加 "captureEnabled": true
```

操作步骤：
1. 开启抓包启动，确认控制台出现 `[capture] 抓包已开启，输出目录: ...`
2. 进入游戏 → 打开**组织成员名单** → 查看**本周活动**
3. 退出后到 `%APPDATA%/naruto-online-launcher/captures/` 取 `netlog-*.json` 与 `http-*.jsonl`
4. 运行 `node tools/analyze-capture.js <jsonl 路径>` 查看端点与关键词命中
5. net-log 用 Chromium 官方 netlog-viewer 打开，确认是否存在 socket 级（原始 TCP）连接

## 下一步（阶段二 / 三，待阶段一探测结果确认）

- 依据探测到的协议（HTTP+AMF / HTTP+JSON / WebSocket / 原始 TCP）编写解码器
- 产出 `guildMembers` / `weeklyActivity` 结构化数据
- 导出 CSV 并在启动器内加入统计面板

## 追加修正（识别为原始 TCP 后）

用户反馈：在浏览器 devtools 的 Network 面板打开组织成员/捐献/叛忍/通灵兽/忍战等面板时**看不到任何请求**。

**结论**：游戏走的是 Flash `flash.net.Socket` **原始 TCP**，不是 HTTP/WebSocket。因此：
- CDP Network 域（通道 B）与 webRequest（通道 C）对本场景**无效**；
- 唯一的内置途径是 **net-log 的 socket 字节**。

**发现并修复的 bug**：原实现用了 `net-log-capture-mode=IncludeSensitive`，该值**不包含 socket 载荷**。Chromium 合法值只有 `Default` / `IncludeCookiesAndCredentials` / `IncludeSocketBytes`，已改为 **`IncludeSocketBytes`**（`main.js`）。

**新增工具 `tools/extract-socket-bytes.js`**：解析 net-log，提取 `TCP_CONNECT` 地址与 `SOCKET_BYTES_SENT/RECEIVED` 原始字节，按连接重建为 `sockets/<srcId>-<rx|tx>.bin`，并打印 hex/ascii 预览。合成 net-log 端到端验证通过（重建出 tx=`Hello`、rx=`OK`，并识别连接地址）。

**兜底方案**：若 net-log 仍拿不到 Flash 原始 socket 载荷，用 npcap + Wireshark 在网卡层抓包（用户已有管理员权限）。

## 抓包实测结果（2026-10-12）

用户开启 `--capture-traffic` 游玩后，产出：
- `http-*.jsonl` 57MB + 53MB：**只有资源加载与埋点上报，无业务数据，WS 帧 0**
- `netlog-*.json` 69.8MB：**完整捕获游戏原始 TCP**

**定位游戏连接**：`zone.huoying.qq.com:11096`（`101.226.142.64:11096`），明文 TCP（无 TLS）。socket 1405 = 策略文件；socket 1406 = 游戏主连接（tx 6831B / rx 288179B）。

**协议结构**：36 字节定长头（`09 01` magic、u16BE 长度、命令字段、序号、`flag`、会话 id）+ **Protobuf 载荷**。

**加密状态**：`flag=3` 为明文（登录/握手/服务端通知，如 `{f2:"success"}`、`{f2:"10001", f3:"qqgame"}`）；`flag=2` 为**加密载荷**（8 字节块，疑似 XXTEA/TEA）。→ 阶段二需先破解加密，路径见 `doc.md` §4.3（推荐反编译 SWF）。

**修复的第二个 bug**：`net-log` 的 `params.bytes` 是 **base64** 而非 hex；原提取工具按 hex 解析导致输出全是伪影。已修正，并补上 `TCP_CONNECT.address_list` 解析与 socket id 过滤。

**新增工具**：
- `tools/parse-frames.js` — 分帧解析 + 载荷清单（122 tx / 213 rx 帧，0 重同步）+ `--dump`
- `tools/extract-socket-bytes.js` — 已修正 base64/地址解析，支持按 socket id 过滤

## 反编译尝试与 SWF 加密发现（2026-10-12 续）

- 从 HTTP 抓包定位核心 SWF：`res.huoying.qq.com/NarutoBeta11.18Build301/flash/core/naruto.core.swf` 等。
- 从本地缓存 `Partitions/game-1/Cache` 用 `tools/carve-swf.js` 抠出 **264 个 SWF**（含可解的 `entry.swf`）。
- 直接下载核心 SWF 后发现：它们以 `ZWS` 开头但 **LZMA 头非法**（props=0xfa），标准 LZMA/zlib 均无法解压 → **内容被加密**。
- 加载器 **`entry.swf`**（CWS 明文）含 `decryptSWF`、`KeyFileLoader`、`LZMA`、`uncompress`、`resource.cfg`、`xmlsocket://`、`loadPolicyFile` → 确认它用密钥文件解密核心 SWF。
- 密钥文件 = `https://res.huoying.qq.com/NarutoBeta11.33Build304/resource.cfg`（782KB）。
- 新增工具：`tools/swf_extract.py`（Python，支持 FWS/CWS/ZWS 解压 + 字符串提取）、`tools/carve-swf.js`、`tools/swf-strings.js`。

**结论**：要拿到业务数据，需先解密游戏 SWF（→ 找协议加密算法），路径见 `doc.md` §4.5/§4.6。

## SWF 破解与协议确认（2026-10-12 续 2）

- **破解 SWF 加密**：反编译 `entry.swf` 得到 `util.decryptSWF`（纯字节重排），实现 `tools/decrypt_swf.py`，成功解密解压 4 个核心 SWF（core 512KB / ui 1.25MB / exui 2.77MB / include 9.5MB）。
- **反编译**：FFDec 导出 `include.swf` **5325 个 AS3 脚本**、core 368 个、ui/exui 各约 300 个。
- **协议头 100% 确认**：来自 `server/SocketProtocol.as` 的 `data` getter（magic 2305、命令号@4、序号@8、type@12、uin@24、role@28、ser_id@30、载荷@36）——与抓包逆向完全一致。
- **命令号定位**：`CMD_GUILD_MEMBER_LIST_QUERY=199179`（组织成员）、`CMD_GUILD_DONATE_QUERY=199184`（组织捐献）。
- **载荷确认加密**：熵 7.98+，非压缩；`ProtoGetEncryptListResponse` 下发 `is_encrypt` 与例外命令号。
- **剩余障碍**：加密实现位于 socket server 插件 `server.INarutoServer`，已反编译的 SWF 与缓存插件中均未找到（无 `flash.net.Socket` 用法）。

新增工具：`tools/decrypt_swf.py`。产物目录：`_swf_decomp/`（反编译源码）、`_swf_dl/`（下载的 SWF+cfg）、`_cap_sockets/`（提取的游戏 TCP 流）。

## ✅ 全链路打通（2026-10-12 续 3，目标达成）

**最终成果：成功从抓包中解密并导出 109 名组织成员数据**（`_guild.json` / `_guild.csv`）。

关键突破：
1. **下载并解压 `flash/core/PluginConfig.xml`**（zlib）→ 插件清单，确认网络插件 = `server.INarutoServer`，`<def>flash/server/ServerConfig.xml</def>`。
2. **解密 `resource.cfg`**（实为标准 `.lzma` 流）→ 3.4MB 清单，末尾 XML 显示 `flash/server/NarutoServer.swf` 打包在 **`flash/archives/item2.pkg`** 内。
3. **解包 `item2.pkg`**（整体 zlib，格式 `readUTF名 + u32长度 + 内容`）→ 得到 `NarutoServer.swf`（18KB CWS）。
4. **反编译 `NarutoServer.swf`** → `encrypt/TEACrypto.as` + `TEALib.as` + `socket/KeyChain.as`：
   - 腾讯经典 TEA（ROUNDS=16, DELTA=0x9E3779B9, SALT_LEN=2, ZERO_LEN=7）
   - **硬编码静态密钥 `KeyChain.key = "d796c2542916b456"`**
   - 格式：`[头字节(低3位=pad)] [pad随机] [2 salt] [数据] [7×0]`，8 字节分组
   - 链式：`P_i = TEA_dec(P_{i-1} ^ C_i)`，输出 `P_i ^ C_{i-1}`
5. **解密并解析载荷**：`cmd 199179`（组织成员名单）→ Protobuf `ProtoGuildMemberListRsp`，每个成员 `ProtoGuildMemberInfo`。

导出字段：`playerNick`(昵称) / `playerLvl`(等级) / `playerCombat`(战力) / `playerCareer`(职业) / `identity`(职位) / `currentContri`(当前贡献) / `historyContri`(历史贡献) / `mapAttackWeeklyScore`(忍战本周积分)。

**新增工具**：
- `tools/decrypt_swf.py`（破解 ZWS SWF 混淆）
- `tools/unpack_pkg.js`（解包 .pkg）
- `tools/decrypt_game_stream.py`（TEA 解密 + Protobuf 树展示）
- `tools/extract_guild.py`（导出组织成员 JSON/CSV）

## ✅ 5 类数据导出完成（2026-10-12 续 4）

按用户要求，从同一份抓包导出 **5 个 Excel**（`tools/export_all.py`，自研无依赖 xlsx 写入）：

| 文件 | 数据来源命令 | 行数 |
|---|---|---|
| `1-组织成员.xlsx` | 199179 `CMD_GUILD_MEMBER_LIST_QUERY` | 109 |
| `2-组织捐献.xlsx` | 199184 `CMD_GUILD_DONATE_QUERY` | 109 |
| `3-叛忍数据.xlsx` | 852146(帮派排名 8) + 852147(成员排名 39) | 两个 sheet |
| `4-组织通灵兽.xlsx` | 199264 `CMD_ZONE_GUILD_BEAST_QUERY` | 4 + 主属性 24 |
| `5-忍战数据.xlsx` | 852296 `CMD_GUILD_KUAFU_GVG_PACKAGE_QUERY` | 55 |

注：852225(忍战主界面) 当时全为 0（忍战未开启），故忍战数据取自 852296。

## 5 个 Excel 按用户反馈修正（2026-10-12 续 5）

用户核对后修正：

| 文件 | 数据源命令 | 列 | 行数 |
|---|---|---|---|
| `1-组织成员.xlsx` | 199179 | 成员/职务/组织贡献度/职业/等级/战斗力/离线时间/组织战白名单 | 110 |
| `2-组织捐献.xlsx` | 199184（本周） | 排行/角色名字/捐献贡献 | 110 |
| `3-叛忍数据.xlsx` | 852147（成员排名） | 排名/玩家名/缉拿叛忍数/击杀数/杰出奖 | 39 |
| `4-组织通灵兽.xlsx` | **199209（本周献祭）** | 排行/角色名字/献祭通灵查克拉 | 110 |
| `5-忍战数据.xlsx` | 852296(跨服)/852233(本服) | 名称/职务/参战次数/战斗力/战力增幅/本周贡献 | 55 |

关键修正：
- **去重键 bug**：原按 `uin` 去重，跨区会撞 uin（1096区萨斯咕嘎 与 1098区织田恭衣 uin 同为 250147628），导致成员少 1。改为 **(serverId, uin)** → 110 人。
- 成员表改为**服务器原始顺序**（首行=馆长）。
- 职务/职业中文名取自 `GuildUtils.getGuildIdentityName` / `MajorNinjaDef.getMajorNinjaName`。
- 叛忍数值刻度为 **600**（缉拿=raw/600，击杀=raw/600）。
- 通灵兽表数据源从 199264 改为 **199209**（本周献祭）。
- 忍战同时支持跨服(852296)与本服(852233)两个命令。

## 合规








仅用于用户本人账号的数据统计，不用于自动化操作、篡改数据或侵犯隐私。
