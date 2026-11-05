# 缤纷云 S4 更新源接入

## 需求场景

用户已创建缤纷云 S4 桶 `naruto-launcher`（公开读取已开启，地址 `https://naruto-launcher.s3.bitiful.net`），希望把启动器更新源接到 S4，利用 50GB 免费存储和每月 10GB 免费流量降低更新分发成本。

## 处理逻辑

1. `updater.js` 新增 `S4_MIRROR`，默认 `https://naruto-launcher.s3.bitiful.net`，支持 `HYOL_UPDATE_S4` 环境变量覆盖。
2. 更新源候选表 `FEEDS` 增加「缤纷云 S4」，放在国内镜像第一位；原 COS、网站镜像、GitHub/代理全部保留为兜底。
3. 选源逻辑不变：并发拉取各源 `latest.yml`，取版本号最高者；版本相同时按国内镜像优先级 `S4 → COS → 网站` 选择。
4. 下载失败换源重试逻辑不变。

## 受影响文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `updater.js` | 修改 | 新增 S4 feed、更新源优先级注释 |

## 需要用户完成的操作

1. 把 `release-v2.0.0` 下的 3 个文件上传到 S4 桶**根目录**（控制台显示为 `s3://naruto-launcher/`，对应公开地址 `https://naruto-launcher.s3.bitiful.net/`）：
   - `NarutoOnlineLauncher-Setup-2.0.0.exe`
   - `NarutoOnlineLauncher-Setup-2.0.0.exe.blockmap`
   - `latest.yml`
2. 保持「公开读取」开启；防盗链/Referer/User-Agent 黑名单保持为空（Electron 请求没有 Referer）。
3. CORS 不需要配置：更新由主进程 `net`/electron-updater 发起，不走浏览器跨域。
4. HTTP/3 可不开启；S3 服务端点 `s3.bitiful.net`、可用区 `cn-east-1` 只用于上传（S3 客户端/SDK）。
5. 上传后验证：
   - `https://naruto-launcher.s3.bitiful.net/latest.yml` 返回 200 且 `version: 2.0.0`；
   - 用 `Range: bytes=0-0` 请求 exe，应返回 206（增量更新依赖）。

## 边界与异常

- S4 尚未上传新版时，`latest.yml` 404，选源会自动跳过 S4，回退 COS/网站/GitHub。
- S4 与其它源版本相同：优先 S4。
- S4 版本落后：仍选其它源的最高版本，避免旧版本覆盖新版本。
- 2.0.0 之前的用户不认识 S4 这个源：本次 2.0.0 发布仍需照旧上传 COS/GitHub/网站；S4 从 2.0.0 之后的版本开始发挥作用。
- 如果 S4 下载失败，自动按 `S4 → COS → 网站 → GitHub/代理` 换源重试。

## 预期结果

- 新版启动器优先从 S4 检查/下载更新。
- 流量在每月 10GB 免费额度内时基本零成本；超出后仍比 COS 便宜。
- S4 不可用或未上传时不影响现有更新链路。
