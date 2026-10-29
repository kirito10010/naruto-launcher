# 修复总结：自动更新多线路自动择优 + 失败回退

## 1. 问题

无法直连 github.com 的机器（国内网络）永远检测不到更新：不弹窗，退出重启也不弹。能直连的机器正常。

## 2. 根因（实测确认）

1. `updater.js` 用 electron-updater 的 **GitHubProvider**，其检测第一步必须请求 `releases.atom`，而所有加速代理都不支持 `.atom`（ghfast 403 / gh-proxy 404 / ghproxy.net 403）→ 走代理的检测必然失败。
2. 原有的 `patchProxy()` 是**死代码**：它判断 `options.url` / `options.host`，而 electron-updater 的请求 options 由 `configureRequestUrl()` 生成，字段是 `protocol / hostname / port / path` —— 两个分支恒不成立，代理从未生效。
3. 检测失败只写一行日志，无重试、无换源、无可见反馈。

## 3. 改动

只改了 `updater.js`（`main.js` / `package.json` 未动）。

| 项 | 说明 |
| --- | --- |
| 删除 `patchProxy()` | 死代码，且与新方案叠加会造成双重代理 |
| 新增 `FEEDS` 候选源表 | 直连 / ghfast.top / gh-proxy.com / ghproxy.net，地址统一用版本无关的 `releases/latest/download`；移除已失效的 `gh.llkk.cc` |
| 改用 generic provider | 只需 `GET <feed>/latest.yml`，不再需要 atom feed；`latest.yml` 里的相对文件路径以 feed URL 为 base 解析，**下载自动走同一个源**，无需改写任何请求 |
| 新增 `netGet()` / `probeFeeds()` | 用 Electron 内置 `net.request`（`manual` 重定向 + 超时 abort）**并发**探测各源，4s 超时，按序取第一个可用；200 时校验内容确为 `latest.yml`（防止代理返回 200 + HTML 错误页） |
| 新增 `fetchReleaseNotes()` | generic provider 不带 `releaseNotes`，改为与检测**并行**拉 GitHub API 的 Release 正文（gh-proxy 代理 → 直连），6s 超时，失败用兜底文案 |
| `disableDifferentialDownload = true` | 代理对多段 Range 支持不确定，全量下载更稳 |
| 下载失败换源重试 | `onError` 由「代理下标轮换」改为「候选源轮换」：`setFeedURL` → `checkForUpdates()`（重新解析文件 URL）→ `downloadUpdate()`，最多 3 次；保留 `errorHandled` 单次闸门 |
| 新增 `userUpdating` 标记 | 用户点过「立即更新」后不再重复弹提示窗（换源重试会再次触发 `update-available`） |
| 新增 `info()` | 生产仍只落盘 WARN/ERROR（沿用原设计），开发测试模式下额外打印到控制台 |
| 新增开发模式测试开关 | `NARUTO_UPDATE_TEST=1` → `forceDevUpdateConfig = true` 并跳过 `!app.isPackaged` 早退；`NARUTO_UPDATE_TEST_VERSION=x.y.z` 可临时压低当前版本号以便看到弹窗 |

## 4. 验证结果

### 4.1 开发模式完整链路（`NARUTO_UPDATE_TEST=1 NARUTO_UPDATE_TEST_VERSION=1.2.0`）

```
[update] 测试用当前版本: 1.2.0
[update] 开发模式测试开关已开启（NARUTO_UPDATE_TEST=1）
[update] 更新源可用: 直连 (HTTP 302)
[update] 正在检查更新…
Found version 1.3.0 (url: NarutoOnlineLauncher-Setup-1.3.0.exe)
[update] 发现新版本: 1.3.0
[update] 更新说明长度: 133
```
枚举可见窗口确认弹窗真实出现：
```
WINDOW: 发现新版本
WINDOW: 火影忍者启动器
```

### 4.2 代理线路（临时脚本验证，用完已删）

```
PROBE 直连: HTTP 302
PROBE ghfast.top: HTTP 302
PROBE gh-proxy.com: HTTP 200 version: 1.3.0
PROBE ghproxy.net: HTTP 302
CHECK via ghfast.top: isUpdateAvailable=true latest=1.3.0
CHECK via gh-proxy.com: isUpdateAvailable=true latest=1.3.0
CHECK via ghproxy.net: isUpdateAvailable=true latest=1.3.0
NOTES via gh-proxy: HTTP 200 bodyLen=133
NOTES via direct: HTTP 200
```
→ 三条代理线路都能独立完成「探测 + 检测 + 拿更新说明」，即**无法直连 GitHub 的机器现在也能收到更新**。

## 5. 行为对照

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 无法直连 GitHub | 永远不弹 | 启动约 5~9s 内弹窗（任一线路可用即可） |
| 能直连 GitHub | 正常 | 正常（探测并发，走直连源，速度不退化） |
| 代理全挂 / 无网络 | 静默 | 静默（只写日志，不弹错误框，不卡启动） |
| 下载中断 | 直接报错 | 自动换下一个源重试（≤3 次） |

## 6. 未做（doc.md 第 8 节「可选」，用户未确认）

1. 设置面板「检查更新」按钮（手动触发 + 状态反馈）
2. README 补充「内置多线路自动择优」说明

## 7. 版本与打包

改动归入 **1.4.0**；本次未打包，`package.json` 的 `version` 仍为 `1.3.0`，下次打包时需同步改为 `1.4.0` 并把 `build.directories.output` 改为 `release-v1.4.0`。
