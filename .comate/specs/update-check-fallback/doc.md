# 更新检测在无法直连 GitHub 的机器上完全失效 —— 修复方案

## 1. 现象

| 机器 | 表现 |
| --- | --- |
| 能直连外网（github.com 可达） | 启动后正常弹出「发现新版本」 |
| 无法直连（国内网络） | 永远不弹；退出启动器重启后依然检测不到 |

## 2. 根因（已用真实请求实测确认）

### 2.1 当前实现

`updater.js` 用的是 electron-updater 的 **GitHubProvider**（`setFeedURL({ provider: 'github', owner, repo })`）。
GitHubProvider 的检测流程是**三步**，全部直连 github.com：

1. `GET https://github.com/kirito10010/naruto-launcher/releases.atom`（拿 feed XML）
2. `GET https://github.com/kirito10010/naruto-launcher/releases/latest`（拿 tag）
3. `GET https://github.com/.../releases/download/<tag>/latest.yml`（拿版本清单）

第 1 步是必经的第一步。只要第 1 步失败，整个检测直接抛错。

### 2.2 `patchProxy()` 从未生效（判定条件写错）

`patchProxy()` 想把这些请求改写到代理，但它判断的是：

```js
if (typeof options.url === 'string' && options.url.indexOf('https://github.com/') === 0) { ... }
else if (options.host === 'github.com' && typeof options.path === 'string') { ... }
```

而 electron-updater 的请求 options 由 `configureRequestUrl()` 生成（`builder-util-runtime/out/httpExecutor.js:302`）：

```js
options.protocol = url.protocol;
options.hostname = url.hostname;   // ← 是 hostname，不是 host
options.path = url.pathname + url.search;
// 全程没有 options.url
```

→ `options.url` 恒为 `undefined`，`options.host` 恒为 `undefined`。
**两个分支都永远不成立，代理从来没有被用上（下载也没有）。** 这是死代码。

### 2.3 即使修好判定条件也救不了「检测」

实测（2026-10-16，`curl`）：

| 源 | `releases.atom` | `releases/latest` | `latest/download/latest.yml` | 安装包（Range 请求） |
| --- | --- | --- | --- | --- |
| 直连 github.com | 200 | 302→tag | 302→tag | 200 |
| `https://ghfast.top/` | **403** | 302→自身 | **302→自身 → 200** | **206** |
| `https://gh-proxy.com/` | **404** | 403 | **200** | **206** |
| `https://ghproxy.net/` | **403** | 302→自身 | **302→自身 → 200** | **206** |
| `https://gh.llkk.cc/` | 不可达 | 不可达 | 不可达 | 不可达 |

结论：
- **没有任何代理支持 `releases.atom`** → 用 GitHubProvider 时，走代理的检测**必然失败**。这就是「等不到更新」的直接原因。
- 但代理**支持 `releases/latest/download/<asset>` 这个版本无关的稳定地址**，`latest.yml` 和安装包都能正常拿到。

### 2.4 失败后没有任何兜底

`checkForUpdates()` 失败只有一行 `log('检查更新失败: ...', 'WARN')`：无重试、无换源、无用户可见反馈 → 用户永远等不到。

---

## 3. 方案

核心：**把 GitHubProvider 换成 GenericProvider，并把代理前缀直接写进 feed URL**，再配合「候选源并发探测 + 失败回退」。

### 3.1 为什么换成 GenericProvider 就能解决

- GenericProvider **只需要** `GET <feedUrl>/latest.yml`，**不需要 atom feed** → 绕开 2.3 的死结。
- GitHub 提供版本无关的稳定地址：`https://github.com/<owner>/<repo>/releases/latest/download/<asset>`，实测通过代理可正常返回 `latest.yml` 与安装包。
- `latest.yml` 里 `files[].url` 是**相对路径**（如 `NarutoOnlineLauncher-Setup-1.3.0.exe`），electron-updater 会以 feedUrl 为 base 解析：
  - feed 带代理 → `https://ghfast.top/https://github.com/.../releases/latest/download/NarutoOnlineLauncher-Setup-1.3.0.exe`（实测 302→自身→206）
  - feed 直连 → 直连地址
  → **下载自动带上正确的源，不需要再改写任何请求。**
- 因此 `patchProxy()` **整体删除**（留着反而会造成双重代理）。

### 3.2 候选源与探测

```js
const FEEDS = [
  { name: '直连',        url: 'https://github.com/kirito10010/naruto-launcher/releases/latest/download' },
  { name: 'ghfast',      url: 'https://ghfast.top/https://github.com/kirito10010/naruto-launcher/releases/latest/download' },
  { name: 'gh-proxy',    url: 'https://gh-proxy.com/https://github.com/kirito10010/naruto-launcher/releases/latest/download' },
  { name: 'ghproxy.net', url: 'https://ghproxy.net/https://github.com/kirito10010/naruto-launcher/releases/latest/download' },
];
```
（删掉已失效的 `gh.llkk.cc`。直连放第一位：能直连的机器走直连最快；探测是并发的，所以顺序只影响择优，不影响耗时。）

**探测**：用 Electron 内置 `net.request`（`{ url, redirect: 'manual' }`）**并发**请求每个源的 `latest.yml`，每个 **4s 超时**（超时 `abort()`），按 FEEDS 顺序取第一个成功（HTTP 2xx/3xx）的源。

> 为什么要探测：被墙的直连/失效代理会让 electron-updater 内部 60s socket 超时才报错（`builder-util-runtime/out/httpExecutor.js:264`），串行尝试会「卡住半天还等不到」。并发 + 4s 超时把最坏情况压到约 4s。

- 全部失败 → 只写日志，**不弹错误框**（不打扰用户）。

### 3.3 检测流程

```
init():
  事件绑定（checking-for-update / update-available / download-progress /
           update-downloaded / error）保持不变
  setTimeout(() => runCheck(), 5000)

runCheck():
  notesPromise = fetchReleaseNotes()          // 与检测并行发起，见 3.4
  feedIdx = await probeFeeds()                // 并发探测，4s 超时
  if (feedIdx == null) { log('所有更新源均不可用'); return }
  autoUpdater.setFeedURL({ provider: 'generic', url: FEEDS[feedIdx].url })
  const r = await autoUpdater.checkForUpdates()
  // r.isUpdateAvailable === false → log('当前已是最新版本')，结束
  // 有更新 → 'update-available' → onUpdateAvailable → await notesPromise → 弹窗
```

### 3.4 更新说明（release notes）的来源

GenericProvider 不带 `releaseNotes`（`latest.yml` 里没有）。用 `net.request` 拉 GitHub API 的 release 正文：

```js
const NOTES_SOURCES = [
  'https://gh-proxy.com/https://api.github.com/repos/kirito10010/naruto-launcher/releases/latest', // 实测 200
  'https://api.github.com/repos/kirito10010/naruto-launcher/releases/latest',                        // 能直连时最快
];
```
- 在 `runCheck()` 开头就**与检测并行**发起（不增加弹窗延迟），取第一个成功响应的 `body`。
- 总超时 6s；两者都失败 → 用兜底文案：`有新版本可用，点击「立即更新」下载安装`。
- 好处：更新说明的唯一来源仍是 **GitHub Release 正文**，打包流程零改动、无需在 `package.json` 里重复维护。

### 3.5 下载与失败回退

- 用户点「立即更新」→ `autoUpdater.downloadUpdate()`，沿用探测到的源。
- 设置 `autoUpdater.disableDifferentialDownload = true`：代理对多段 Range 支持不确定，**全量下载更稳**（67MB）。
- 下载失败 → 换下一个候选源：`setFeedURL(下一个源)` + `checkForUpdates()`（重新解析文件 URL）+ `downloadUpdate()`，最多 3 次；仍失败才弹错误框（沿用现有 `errorHandled` 闸门，避免重复弹）。

### 3.6 让开发模式也能验证

现状 `if (!app.isPackaged) { log('开发模式，跳过自动更新检查'); return; }`，开发模式完全无法验证更新流程，而本次改的正是更新流程。

新增：环境变量 `NARUTO_UPDATE_TEST=1` 时，设置 `autoUpdater.forceDevUpdateConfig = true` 并继续执行检测。
因为我们总是先 `setFeedURL`（`clientPromise` 非空），electron-updater 不会去读 `app-update.yml`，dev 下可完整跑「探测 → 检测 → 弹窗」。

用法：`$env:NARUTO_UPDATE_TEST=1; npm start`

---

## 4. 影响文件

| 文件 | 改动 |
| --- | --- |
| `updater.js` | 删除 `patchProxy()`；新增 `FEEDS` / `probeFeeds()` / `netGet()` / `fetchReleaseNotes()` / `runCheck()`；`init()` 改为 generic feed + 探测；下载回退按源轮换；`disableDifferentialDownload = true`；dev 测试开关 |
| `main.js` | 无改动（`updater.init({ log, currentVersion })` 调用签名不变） |
| `package.json` | 无改动（本次不打包；下次打包时再改 1.4.0） |

## 5. 边界与异常

| 场景 | 处理 |
| --- | --- |
| 完全无网络 / 所有源不可用 | 仅日志，不弹窗，不阻塞启动 |
| 代理返回 403 / 404 / HTML | `parseUpdateInfo` 抛错 → 视为该源失败（探测阶段已过滤） |
| `latest.yml` 版本 == 当前版本 | `isUpdateAvailable=false` → 不弹窗 |
| 下载中断 / sha512 校验失败 | 换下一个源重试（最多 3 次） |
| 用户点「稍后提醒」 | `skipped=true`，本次会话不再弹（保持现有行为） |
| `checkForUpdates` 并发 | 探测并发；`checkForUpdates` 串行（其内部 `checkForUpdatesPromise` 复用 + 失败后置空，可安全重试） |
| 探测成功的源在下载时已失效 | 按 3.5 换源重试 |

## 6. 数据流

```
启动 → 5s
  ├─ 并发探测 4 个源的 latest.yml（各 4s 超时）→ 选中源
  ├─ 并行拉 release notes（gh-proxy API / 直连 API，6s）
  └─ setFeedURL(generic, 选中源) → checkForUpdates()
        └─ GET <选中源>/latest.yml → 解析 version / files / sha512
              ├─ 无更新 → 日志
              └─ 有更新 → update-available → await notes → 弹窗（更新内容）
                    └─ 点「立即更新」→ downloadUpdate()（全量，走选中源）
                          ├─ 失败 → 换源重试（≤3）
                          └─ 成功 → sha512 校验 → update-downloaded → 重启安装
```

## 7. 预期结果

- **无法直连 GitHub 的机器**：启动约 5~9s 内弹出更新窗（前提是至少一个代理可用）；此前是永远不弹。
- **能直连的机器**：行为不变，且因探测并发，速度不退化（走直连源）。
- **代理全挂 / 无网络**：只留日志，不弹错误框，不卡启动。
- 更新内容（Release 正文）照常显示；拉不到时用兜底文案。

## 8. 可选（待确认，默认不做）

1. 设置面板加「检查更新」按钮：手动触发一次检测，并反馈「正在检查 / 已是最新 / 检测失败」。
   - 价值：用户不用重启就能确认有没有更新；也让「检测失败」不再静默。
   - 成本：`main.js` 加 IPC + 设置面板加一项 + `updater.js` 暴露 `checkNow()`。
2. `README.md` 的「自动更新」一条补充说明「内置多线路自动择优」。
