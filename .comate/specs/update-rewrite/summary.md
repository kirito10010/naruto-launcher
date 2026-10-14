# 实现总结：更新逻辑重写 + 国内加速（update-rewrite）

## 完成情况

`tasks.md` 6 个任务全部完成，打包产物 **`release-v1.0.0/NarutoOnlineLauncher-Setup-1.0.0.exe`**（77.35MB）。

## 改动清单

### 新增
- **`updater.js`** —— 更新模块（从 main.js 抽出重写）
  - `init({ log, currentVersion })`：`autoDownload=false` + GitHub feed + 启动 5s 后检查
  - **代理下载**：覆写 `autoUpdater.httpExecutor.createRequest`，`github.com` 下载请求加代理前缀
    - 代理列表：`ghfast.top` → `gh-proxy.com` → `ghproxy.net` → `gh.llkk.cc` → 直连
    - 失败自动换源重试（最多 3 次），全失败弹错误框
  - `cleanNotes()`：HTML→纯文本（兼容 string / 数组两种 releaseNotes）
  - 更新提示窗口 / 进度窗口 / 完成重启 / 错误提示
- **`update.html`** —— 更新提示页（标题 + 版本行 + 更新内容 + 两个按钮）
  - `body{overflow:hidden}`，**永不出现滚动条**
  - 渲染后测量内容高度 → IPC 自适应窗口；超出上限用 `-webkit-line-clamp` 截断 + 省略号
  - 支持直接用浏览器打开预览（填示例数据）
- **`progress.html`** —— 进度页（进度条 + 百分比 + 已下载/总量 + 速度），固定尺寸无滚动条

### 修改
- **`main.js`**：删除旧 `initAutoUpdater()`（约 260 行）及 `autoUpdater` 导入，改为 `updater.init({ log, currentVersion: CURRENT_VERSION })`
- **`package.json`**：版本 `3.4.3` → **`1.0.0`**，输出目录 `release-v1.0.0`，`build.files` 补 `updater.js` / `update.html` / `progress.html`

## 验证结果

1. `node --check main.js updater.js export.js xlsx.js capture.js` → 全部通过
2. `main.js` 无残留（`initAutoUpdater` / `autoUpdater` / `createProgressWindow` 均为空）
3. 打包后 asar 内容校验：`updater.js` / `update.html` / `progress.html` / `ghfast.top` / `autoDownload = false` / `requestSingleInstanceLock` **全部 OK**
4. `latest.yml` 已生成（version: 1.0.0）

> 未做：更新弹窗的**视觉**验证（需在 Windows 上实际跑起来看）。`update.html` 支持浏览器直接打开预览，可自行确认排版。

## 发版 / 测试步骤

1. 新建 **v1.0.0** release，上传：
   ```
   release-v1.0.0\latest.yml
   release-v1.0.0\NarutoOnlineLauncher-Setup-1.0.0.exe
   release-v1.0.0\NarutoOnlineLauncher-Setup-1.0.0.exe.blockmap
   ```
2. 装 1.0.0 → 正常使用
3. 之后发 **1.0.1** 测试更新：弹窗应显示发布说明、无滚动条；点更新 → 进度条实时走、下载走代理明显更快
4. 完成后重启 → 版本变 1.0.1

## 注意

- 版本已归零到 `1.0.0`，**旧版（3.4.x）不会被提示更新到 1.0.0**（版本号更小），需手动安装
- 代理可用性会变化，失效时自动降级到下一个或直连

---

## 后续修复（发布 1.0.0 前复查）

复查更新链路时发现并修复 3 个问题：

1. **更新装不上（关键）**：`main.js` 的 `app.on('before-quit')` 里没有把 `isQuitting` 置为 true，而启动器窗口的 `close` 事件在 `!isQuitting` 时会 `preventDefault()` 拦截关闭 —— 导致 `autoUpdater.quitAndInstall()` 内部的 `app.quit()` 被取消，更新包下载完却永远不会安装。修复：在 `before-quit` 开头 `isQuitting = true`。
2. **并发重试**：`downloadUpdate()` 的 promise reject 与 `autoUpdater` 的 `'error'` 事件会对同一次失败各触发一次 `onError`，导致 `retries`/`proxyIdx` 一次跳两格、同时发起两个下载。修复：新增 `errorHandled` 一次性闸门（每次 `startDownload()` 重置）。
3. **弹窗闪一下/内容显示不全**：更新窗口初始高度 200px，`ready-to-show` 就显示了，而自适应高度要等 `did-finish-load` 之后才回传。修复：改为收到首个 `update-window-height` 后再 `show()`，`ready-to-show` 只留 1.5s 兜底。

验证（离屏渲染 + IPC 实测）：
- 传入 14 条真实发布说明 → 内容高度 648px、`hasVScroll:false`、`notesFullyVisible:true`（完整显示、无滚动条）；短文本 → 208px
- 打包后运行正常（进程数 5）
