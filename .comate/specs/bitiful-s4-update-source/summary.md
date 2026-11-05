# 缤纷云 S4 更新源接入总结

## 代码改动

`updater.js`：

- 新增 `S4_MIRROR = process.env.HYOL_UPDATE_S4 || 'https://naruto-launcher.s3.bitiful.net'`。
- `FEEDS` 增加「缤纷云 S4」，位于国内镜像第一位。
- 优先级变为：`S4 → 腾讯云 COS → 网站镜像 → GitHub/代理`。
- 选源仍按「版本号最高者优先，版本相同按上述顺序」，S4 未上传新版时自动跳过并回退。

## 校验

- `node --check updater.js` 通过。
- 访问 `https://naruto-launcher.s3.bitiful.net/latest.yml` 返回 **404**（不是 403），说明公开读取已生效；上传文件后即可正常返回。
- 桶内暂无文件，因此当前会回退 COS/网站/GitHub，不影响现有更新。

## 用户需要做的操作

1. 把 `release-v2.0.0` 下 3 个文件上传到 S4 桶根目录：exe、blockmap、latest.yml。
2. 保持「公开读取」开启；Referer/User-Agent/IP 黑名单保持为空。
3. CORS 不用配（更新走 Electron 主进程，不是浏览器跨域）。
4. HTTP/3 可选；`s3.bitiful.net` / `cn-east-1` 只用于上传。
5. 上传后用 `Range: bytes=0-0` 测一下 exe 是否返回 206。

## 重要提醒

- 当前已打的 `release-v2.0.0` 包是在这次改动之前生成的，**不包含 S4 更新源**。
- 如果希望 2.0.0 用户也能走 S4，需要重新打包 2.0.0。
- 无论是否重打包，本次 2.0.0 发布仍需照旧上传 COS/GitHub/网站，因为 1.14.0 用户不认识 S4。
