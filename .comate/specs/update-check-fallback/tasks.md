# 修复自动更新：多线路自动择优 + 失败回退（updater.js）

- [x] Task 1: 在 updater.js 中建立更新源候选表与网络探测能力
    - 1.1: 定义 `FEEDS` 候选源表（直连 / ghfast / gh-proxy / ghproxy.net，地址统一为 `…/releases/latest/download`），移除已失效的 `gh.llkk.cc`
    - 1.2: 新增 `netGet(url, timeoutMs)`：基于 Electron 内置 `net.request`（`redirect: 'manual'`）的 GET，超时 `abort()`，返回 `{ status, body }`，失败 resolve 为 null
    - 1.3: 新增 `probeFeeds()`：并发探测各源的 `latest.yml`，按 `FEEDS` 顺序取第一个 2xx/3xx 的源下标，全部失败返回 null

- [x] Task 2: 把更新检测从 GitHubProvider 切换为 generic provider + 探测选源
    - 2.1: 删除 `patchProxy()` 函数及其调用（判定 `options.url`/`options.host` 恒不成立，且与新的 feed 方案叠加会造成双重代理）
    - 2.2: 新增 `runCheck()`：探测选源 → `setFeedURL({ provider: 'generic', url })` → `checkForUpdates()`；无更新/失败只写日志，不弹框
    - 2.3: `init()` 中设置 `autoUpdater.disableDifferentialDownload = true`，并把 5s 定时回调改为 `runCheck()`
    - 2.4: 记录当前选中源下标 `feedIdx`，供下载回退使用

- [x] Task 3: 获取更新说明（release notes）
    - 3.1: 定义 `NOTES_SOURCES`（gh-proxy 代理的 GitHub API / 直连 GitHub API，均为 `/repos/<owner>/<repo>/releases/latest`）
    - 3.2: 新增 `fetchReleaseNotes()`：在 `runCheck()` 开头与检测并行发起，取第一个成功响应的 `body`
    - 3.3: `onUpdateAvailable` 改为先 `await` 更新说明（6s 内），拉到就写入 `info.releaseNotes`，拉不到用兜底文案「有新版本可用，点击「立即更新」下载安装」，再弹窗

- [x] Task 4: 下载失败按候选源轮换重试
    - 4.1: `onError` 中把「代理下标轮换」改为「候选源轮换」：`setFeedURL(下一个源)` → `checkForUpdates()`（重新解析文件 URL）→ `downloadUpdate()`
    - 4.2: 保持 `errorHandled` 单次闸门与 `MAX_RETRY` 上限，重试用尽后才弹错误框

- [x] Task 5: 让开发模式也能验证更新流程
    - 5.1: 环境变量 `NARUTO_UPDATE_TEST=1` 时设置 `autoUpdater.forceDevUpdateConfig = true` 并跳过 `!app.isPackaged` 早退
    - 5.2: `node --check updater.js` 通过，并以 `NARUTO_UPDATE_TEST=1 npm start` 实测「探测 → 检测 → 弹窗」链路，确认日志与弹窗符合预期
