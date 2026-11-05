# 在线人数数据可视化平台任务计划

- [x] Task 1: 服务端数据层
    - 1.1: 增加版本字段与当前版本分布
    - 1.2: 增加 10 分钟桶与快照
    - 1.3: 按月分文件存储 + 当前月/前两个月加载 + archive 归档
    - 1.4: 旧 stats.json 自动迁移
    - 1.5: 「全部历史」按需读取 archive

- [x] Task 2: HTTP API 与端口回退
    - 2.1: `/report` 接收 version
    - 2.2: `/api/overview`、`/api/history`
    - 2.3: `/` 托管 dashboard.html
    - 2.4: 只监听 10001；被占用时提示先退出旧后台（不自动切 10002）

- [x] Task 3: 数据可视化页面
    - 3.1: 当前人数/版本分布卡片
    - 3.2: 10 分钟快照表
    - 3.3: SVG 趋势图（24h/7d/30d + 全部历史按需加载）
    - 3.4: 自动刷新、无登录

- [x] Task 4: 启动器上报版本
    - 4.1: `online.js` payload 增加 version
    - 4.2: `main.js` 传入 CURRENT_VERSION

- [x] Task 5: 面板入口与校验
    - 5.1: server-app 面板显示 dashboard 地址
    - 5.2: 语法检查
    - 5.3: HTTP 冒烟测试（上报、overview、dashboard、history）
