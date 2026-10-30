# 在线人数后台调整（1.8.0）

## 需求

1. 虚拟人数的随机浮动改为每 **10 分钟（600 秒）** 变化一次。
2. 实际在线人数刷新尽可能快（启动器上报间隔缩短到 5 秒）。
3. 同一游戏内的虚拟时间段禁止重叠（跨天按两段计算）。
4. 时间段选择器操作更顺畅（原生时/分下拉替代 `input[type=time]`）。
5. 浮动语义为 ±float：显示人数 = 实际 + 虚拟 + offset，offset ∈ [-float, +float]，结果不为负。

## 处理逻辑

- 服务端 `virtualOffset(game, float, nowMs)`：`bucket = floor(nowMs / 600000)`，用 `md5(game + ':' + bucket)` 生成 0~1 随机数，映射到 `[-float, +float]`。同一 10 分钟窗口内结果恒定。
- `displayTotals()`：`max(0, min(99999, actual + virtual))`，因此实际 0 / 虚拟 0 / 浮动 2 时显示落在 0、1、2。
- `validateRules(rules)`：把每条规则展开为分钟区间（start > end 视为跨天，拆成 [start,1440] + [0,end]），两两求交；`start === end` 直接报错。保存时先校验火影、再校验 4399，任一失败返回 `{ ok:false, error }` 且不写配置文件。
- 客户端 `online.js`：`REPORT_EVERY = 5000`；服务端 `TTL = 20s`（容忍 3 次丢包），`PRUNE_EVERY = 5s`。

## 涉及文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `server-app/main.js` | 修改 | `FLOAT_INTERVAL`、`validateRules()`、`save-rules` 校验分支 |
| `server-app/index.html` | 重写规则区 | 规则卡片 + 时/分下拉 + `#saveErr` 错误条 |
| `server-app/package.json` | 版本号 | 1.0.0 → 1.0.1 |
| `online.js` | 修改 | 上报间隔 15s → 5s |
| `package.json` | 版本号 | 1.7.0 → 1.8.0，输出目录 `release-v1.8.0` |

## 边界与异常

- 浮动 0：offset 恒为 0。
- 时间段首尾相接（09:00 结束 / 09:00 开始）不算重叠。
- 跨天规则 22:00–02:00 与 01:00–03:00 判为重叠；与 03:00–05:00 不重叠。
- 保存失败仅提示，编辑状态保留，不清空输入。
- 配置损坏时备份为 `config.json.bad` 并回退默认。

## 数据流

启动器 `getOnlineCounts()`（按已加载标签页计数）→ 每 5s `POST /report` → 服务端 `clients` 表 + TTL 剔除 → `displayTotals()` 叠加虚拟与浮动 → 响应返回显示人数 → 启动器两张卡片刷新。

## 预期结果

- 浮动值 10 分钟内不变。
- 实际人数变化最迟 5~20 秒反映到显示。
- 重叠时间段无法保存并给出中文错误。
- 时间选择只需点两下，无输入法/滚动卡顿。

## 发布物

- 启动器：`release-v1.8.0/` 下 `latest.yml`、`NarutoOnlineLauncher-Setup-1.8.0.exe`、`.blockmap`（GitHub 三件套）。
- 网站镜像：`.../naruto-launcher/` 上传 exe + blockmap；`latest.yml` 由网站发布页生成。
- 后台：`release-server/HYOL-OnlineServer-1.0.1.zip`（解压后双击 `HYOL-OnlineServer.exe`）。
