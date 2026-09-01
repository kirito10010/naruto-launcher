# 磁盘缓存实验 + 变速注入排除 GPU 进程

- [x] Task 1: 精简变速注入目标进程
    - 1.1: getAllRelevantChildPids 去掉 gpu / utility / pepper plugin broker
    - 1.2: 保留 renderer / tab / plugin / ppapi plugin / pepper plugin

- [x] Task 2: 主进程增加 diskCache 配置与下发
    - 2.1: loadConfig 补默认 config.diskCache = true
    - 2.2: createGameWindow 的 game-info 下发增加 diskCache

- [x] Task 3: 渲染进程改造分区逻辑
    - 3.1: 新增 let diskCache = true 变量
    - 3.2: getPartition 改为接收 tab 对象，按 diskCache 返回 persist:game-{index} 或 tab-{id}
    - 3.3: createWebview 调用改为 getPartition(tab)
    - 3.4: game-info 处理器在 addTab 前读取 diskCache

- [x] Task 4: 验证语法并打包
    - 4.1: node --check 校验 main.js 语法
    - 4.2: 打包为 3.2.0 验证磁盘缓存与注入效果
