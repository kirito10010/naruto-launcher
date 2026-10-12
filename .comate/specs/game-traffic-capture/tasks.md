# 游戏流量抓包层实现计划（阶段一）

- [x] Task 1: 新增 `capture.js` 抓包层核心模块
    - 1.1: 定义模块状态（enabled / captureDir / jsonlStream / attached）与导出接口 `initCapture`、`isCaptureEnabled`、`getCaptureDir`
    - 1.2: 实现 `initCapture(opts)`：创建 `captures/` 目录、打开 `http-<时间戳>.jsonl` 写入流、注册 `app.on('web-contents-created')` 并遍历已有 webContents
    - 1.3: 实现 `shouldCapture(wc)`：按 webContents 类型（webview/browserView）与 URL 匹配过滤
    - 1.4: 实现 `writeLine(obj)`：JSONL 逐行写入，异常吞掉不影响主流程
    - 1.5: 实现 `attach(wc)`：`debugger.attach('1.3')`、`Network.enable`（100MB buffer）、`Page.enable`，失败记录 `attach-error`
    - 1.6: 实现 `handleCdp`：处理 `requestWillBeSent`/`responseReceived`/`loadingFinished`（取响应体）/`webSocketCreated`/`webSocketFrameSent`/`webSocketFrameReceived`

- [x] Task 2: 修改 `main.js` 顶部开关与 net-log 配置
    - 2.1: 顶部 `require('./capture')`
    - 2.2: 新增 `readConfigSync()` 同步读取 config.json
    - 2.3: 计算 `CAPTURE_ENABLED`（argv `--capture-traffic` / env `NARUTO_CAPTURE=1` / config `captureEnabled`）
    - 2.4: 在现有 Flash commandLine 开关区块后，按 `CAPTURE_ENABLED` 追加 `log-net-log` 与 `net-log-capture-mode=IncludeSensitive`

- [x] Task 3: 修改 `main.js` `whenReady` 初始化抓包
    - 3.1: 在 `app.whenReady()` 内、创建窗口前调用 `capture.initCapture({ enabled: CAPTURE_ENABLED })`
    - 3.2: 开启时输出 `[capture] 抓包已开启，输出目录: ...` 日志

- [x] Task 4: 新增 `tools/analyze-capture.js` 离线分析脚本
    - 4.1: 读取并解析 JSONL 文件（容错非法行）
    - 4.2: 按 host 聚合请求数量并打印
    - 4.3: 打印响应体体积 Top10
    - 4.4: 关键词检索（组织/成员/活动/member/guild/org/activity/rank）
    - 4.5: 打印 WebSocket 帧片段

- [x] Task 5: 验证抓包层
    - 5.1: `npm start -- --capture-traffic` 启动，确认日志与目录生成
    - 5.2: 关闭开关启动，确认零副作用（不生成文件、不影响游戏）
    - 5.3: 校验 `http-*.jsonl` 为合法逐行 JSON，`netlog-*.json` 可被 netlog-viewer 打开

- [x] Task 6: 修正 net-log 抓包模式（原始 TCP 载荷）
    - 6.1: 将 `net-log-capture-mode` 从无效的 `IncludeSensitive` 改为 `IncludeSocketBytes`
    - 6.2: 在 `doc.md` 记录合法取值与"devtools 看不到 ⇒ 原始 TCP"的判定依据

- [x] Task 7: 新增 `tools/extract-socket-bytes.js` net-log 字节提取工具
    - 7.1: 解析 net-log，从 `constants.logEventTypes` 反查事件名
    - 7.2: 提取 `TCP_CONNECT` 等事件的 `address`，定位游戏服务器
    - 7.3: 按 source.id + 方向聚合 `SOCKET_BYTES_*`，`Buffer.concat` 重建并输出 `.bin`
    - 7.4: 打印字节数、hex/ascii 预览；无字节事件时给出模式提示
    - 7.5: 合成 net-log 端到端验证（重建出 tx=Hello / rx=OK）

- [x] Task 8: 分析实测抓包，定位游戏协议
    - 8.1: 解析 57MB/53MB HTTP 抓包，确认只有资源+埋点，无业务数据
    - 8.2: 解析 69.8MB netlog，按 socket 归类，定位 `zone.huoying.qq.com:11096` 游戏连接
    - 8.3: 确认协议为 36 字节定长头 + Protobuf 载荷
    - 8.4: 确认登录后载荷加密（flag=2），握手/通知为明文（flag=3）

- [x] Task 9: 修正 `extract-socket-bytes.js`（base64 + 地址解析）
    - 9.1: `params.bytes` 由 hex 改为 base64 解码
    - 9.2: 支持 `TCP_CONNECT.address_list` 解析与 socket id 过滤
    - 9.3: 实测复现 socket 1406 全量字节（tx 6831B / rx 288179B）

- [x] Task 10: 新增 `tools/parse-frames.js` 分帧解析工具
    - 10.1: 按 36 字节头 + u16BE 长度拆分帧，含重同步兜底
    - 10.2: 输出序号/命令字段/flag/长度/明文 Protobuf 判定
    - 10.3: 支持 `--dump` 导出各帧载荷
    - 10.4: 实测解析 122 tx / 213 rx 帧，0 重同步

- [x] Task 11: 定位并获取游戏 SWF 与密钥文件
    - 11.1: 从 HTTP 抓包定位核心 SWF 与 `resource.cfg` 地址
    - 11.2: 从本地缓存 `Partitions/game-1/Cache` 抠出 264 个 SWF（`tools/carve-swf.js`）
    - 11.3: 下载 `naruto.core/ui/exui/include.swf` 与 `resource.cfg`
    - 11.4: 确认核心 SWF 为加密的 ZWS（LZMA 头非法），`resource.cfg` 整体加密
    - 11.5: 新增 `tools/swf_extract.py`、`tools/swf-strings.js`

- [ ] Task 12: 用 FFDec 反编译 `entry.swf`，提取 `decryptSWF` 算法
    - 12.1: 下载并解压 JPEXS FFDec
    - 12.2: 反编译 `entry.swf`（`_swf/CWS-v17-267888-abc6b74d.fws.swf`），导出 AS3 源码
    - 12.3: 定位 `decryptSWF` / `KeyFileLoader` 实现，理清算法与密钥来源

- [ ] Task 13: 解密核心 SWF 并反编译
    - 13.1: 实现解密脚本，还原 `naruto.core.swf` / `naruto.include.swf`
    - 13.2: FFDec 反编译核心 SWF，定位 TCP 协议的加解密/序列化代码

- [ ] Task 14: 解密网络载荷，提取业务数据
    - 14.1: 复现协议加解密，解密 4.3 中的加密载荷
    - 14.2: 按 4.2 分帧 + Protobuf 解码，定位组织成员/捐献/活动次数字段
    - 14.3: 产出结构化数据（CSV/JSON）
