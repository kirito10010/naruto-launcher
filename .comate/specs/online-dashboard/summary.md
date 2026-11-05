# 在线人数数据可视化平台完成总结

## 已完成

### 服务端（server-app 1.1.0）
- `/report` 新增 `version` 字段，按客户端统计版本分布。
- 每 10 分钟一个快照桶：
  - 唯一活跃客户端数 / 版本分布；
  - 快照时刻在线客户端 / 版本分布；
  - 火影、4399 的显示人数与实际人数。
- 数据按月分文件：
  - 当前月 + 前两个月：`%APPDATA%\hyol-online-server\stats\YYYY-MM.json`，启动时加载；
  - 更早月份：自动移到 `stats\archive\YYYY-MM.json`，默认不加载；
  - 旧版 `stats.json` 首次启动自动迁移，成功后备份为 `stats.json.migrated`。
- 「全部历史」按需读取 active + archive，读完不常驻内存。
- 新增 API：
  - `GET /api/overview`：当前在线、版本分布、最近快照、10 分钟活跃。
  - `GET /api/history?hours=24`：当前 3 个月内的历史点，最多抽稀到 720 点。
  - `GET /api/history?all=1`：按需读取全部历史。
  - `GET /` / `/dashboard`：数据面板 HTML。
  - `GET /health`：健康检查。
- 端口只监听 10001：`POST /report` 上报和 `GET /` 数据面板共用；10001 被占用时提示先退出旧后台，不自动切 10002。
- 桌面面板增加数据面板地址，可点击用浏览器打开。

### 数据面板 `dashboard.html`
- 清新浅色 UI：统一圆角、细边框、轻阴影、青绿/蓝色强调色。
- 顶部品牌区 + 运行状态/端口/更新时间/刷新。
- 4 张概览卡：当前在线、火影显示、4399 显示、启动器版本。
- 版本分布 + 统计说明双面板，右侧最近快照表。
- 24 小时 / 7 天 / 30 天趋势图 + 「全部历史」按需加载。
- 已用 1440 / 800 / 420 三档宽度实际截图检查：无重叠，窄屏卡片单列、表格横向滚动。
- 每 10 秒刷新概览、每 60 秒刷新当前 3 个月历史；无登录、可直接远程访问。

### 启动器
- `online.js` 上报增加 `version`。
- `main.js` 传入 `CURRENT_VERSION`。
- 2.1.0 已重新打包，包含版本上报。

## 产物
- 后台：`release-server/HYOL-OnlineServer-1.1.0.zip`（72.20 MB）
- 启动器：`release-v2.1.0/NarutoOnlineLauncher-Setup-2.1.0.exe`（67.49 MB）+ blockmap + latest.yml

## 校验
- `node --check server-app/main.js`、`online.js`、`main.js` 通过。
- dashboard / index / game 内联脚本语法检查通过。
- HTTP 冒烟测试：
  - `POST /report` 带 version=2.1.0 → 返回 `versions: {"2.1.0":1}`；
  - `/api/overview` 返回 clients=1、versions 正确、active10m=1；
  - `/` 返回 200 且包含「火影OL 数据面板」；
  - `/api/history?hours=24` 返回 ok。
- 月度存储迁移测试：旧 `stats.json`（2026-08/09/10/11 四个月）→ 09/10/11 留在 `stats/`，08 移入 `stats/archive/`，旧文件改名 `.migrated`，标记写入；`/api/overview` 只加载 3 条 active，`/api/history?all=1` 返回 4 个月。
- 端口测试：10001 被占用时，新服务不会启动 10002，而是返回「先退出旧版在线人数后台」错误（避免启动器上报到旧服务）。
- 后台 asar 已确认包含 dashboard.html、快照逻辑、API、端口回退。

## 部署说明
1. 停掉旧的后台（1.0.1），解压 `HYOL-OnlineServer-1.1.0.zip`，运行 `HYOL-OnlineServer.exe`。
2. 放行防火墙端口 10001（或 10002）。
3. 浏览器访问 `http://服务器公网IP:10001/`。
4. 启动器和面板共用 10001；如果提示 10001 被占用，先退出旧后台再启动 1.1.0。
5. 2.1.0 之前的启动器没有 version 字段，版本分布里显示为「旧版/未知」；2.1.0 起正常显示。
