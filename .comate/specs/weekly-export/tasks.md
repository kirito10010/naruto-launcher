# 每周一键导出实现计划（weekly-export）

- [x] Task 1: 新增 `xlsx.js` 最小 xlsx 生成器（零依赖）
    - 1.1: 实现 CRC32 表与 `deflateRawSync` 打包
    - 1.2: 实现 `writeXlsx(path, sheets)`：生成 `[Content_Types].xml` / `_rels/.rels` / `xl/workbook.xml` / `xl/worksheets/sheetN.xml`
    - 1.3: 单元格写入：数字用 `<v>`，文本用 `inlineStr`（XML 转义）
    - 1.4: 校验生成的 xlsx 能被 Excel/Python zipfile 正常打开

- [x] Task 2: 新增 `export.js` 抓包解析与数据导出
    - 2.1: `waitForNetlog()`：等主进程退出 + 轮询 netlog 直到 JSON 完整
    - 2.2: `extractGameStream()`：解析 netlog 事件，按 `TCP_CONNECT*` 地址找连到 **11096** 端口的 socket，base64 解码拼出 tx/rx
    - 2.3: `teaDecrypt()`：腾讯 TEA（ROUNDS16/DELTA/SALT2/ZERO7，密钥 `d796c2542916b456`，链式 QQ+CBC）
    - 2.4: `frames()` + `pb()`：36 字节分帧 + 最小 protobuf reader（varint/length-delimited）
    - 2.5: 5 个数据集函数：成员(199179)/捐献(199184)/叛忍(852147)/献祭(199209)/忍战(852296+852233)，含 (serverId,uin) 去重、职务职业中文名、数值刻度/600
    - 2.6: `runExport({mainPid})`：写 5 个 xlsx 到 `桌面/火影组织数据/<日期>/`，失败回退 `userData/导出/`，成功后 `shell.openPath`
    - 2.7: 异常写 `export-error.log`，不抛给用户

- [x] Task 3: 修改 `main.js` 接入导出与抓包开关
    - 3.1: 顶部最前：`--export <pid>` 分支 → 调 `runExport` → `app.quit()`，不建窗口
    - 3.2: `before-quit`：抓包开启时 spawn detached `--export <pid>` 子进程（用 `process.execPath`）
    - 3.3: 启动器内嵌 HTML 加「抓包模式」勾选框，回显 `config.captureEnabled`
    - 3.4: 新增 IPC `set-capture` → 存 `config.captureEnabled` 并 `saveConfig()`
    - 3.5: `config` 默认值加 `captureEnabled: false`

- [x] Task 4: 验证
    - 4.1: 用现有抓包 `_cap_sockets` + netlog 直接调 `export.js`，与 Python 版 `_excel` 输出逐行比对
    - 4.2: `node --check` 三个文件语法
    - 4.3: 验证未开抓包时退出不产生文件
