# 更新逻辑重写实现计划（update-rewrite）

- [x] Task 1: 新增 `updater.js` 更新模块
    - 1.1: `init({ log, currentVersion })`：`autoDownload=false` + `setFeedURL(github)` + 启动 5s 后 `checkForUpdates()`
    - 1.2: **代理下载**：覆写 `autoUpdater.httpExecutor.createRequest`，把 `https://github.com/` 前缀替换为代理 URL（列表 `ghfast.top / gh-proxy.com / ghproxy.net / gh.llkk.cc / 直连`）
    - 1.3: 代理轮换重试：下载失败自动切下一个代理（最多 3 次），全失败则报错提示
    - 1.4: `releaseNotes` 清洗：HTML 标签→纯文本、压缩空行、去空白（兼容 string / 数组两种返回）
    - 1.5: **更新提示窗口**：`BrowserWindow` 加载 `update.html`，传 `{current, latest, notes}`；渲染进程测量内容高度后经 IPC 自适应窗口高度（上限=屏幕工作区 80%），全程无滚动条
    - 1.6: **进度窗口**：加载 `progress.html`，`download-progress` 事件实时推送 百分比/已下载/总量/速度
    - 1.7: 完成流程：`update-downloaded` → 询问重启 → `quitAndInstall()`；`error` → 弹错误框（仅用户主动更新时）
    - 1.8: 用户点「稍后提醒」→ 本次会话不再弹

- [x] Task 2: 新增 `update.html` 更新提示页
    - 2.1: 布局：标题（发现新版本 vX）/ 版本行（当前 → 最新）/ 更新说明区 / 底部按钮（稍后提醒、立即更新）
    - 2.2: `body{overflow:hidden}` 全局禁滚动条；说明区 `white-space:pre-wrap; word-break:break-word`
    - 2.3: 说明区超出可用高度时用 `-webkit-line-clamp` 截断 + 省略号（不出现滚动条）
    - 2.4: 渲染完成后 `ipcRenderer.send('update-window-height', 实测高度)`；按钮点击发 `update-action`(update/later)

- [x] Task 3: 新增 `progress.html` 进度页
    - 3.1: 布局：标题「正在下载更新…」+ 进度条 + 百分比(已下载/总量) + 速度
    - 3.2: `body{overflow:hidden}`，固定尺寸，无滚动条
    - 3.3: 监听 `update-progress` 刷新进度条与文案

- [x] Task 4: 修改 `main.js` 接入新更新模块
    - 4.1: 删除旧的 `initAutoUpdater()` 及其 `createProgressWindow`/原生 dialog 代码
    - 4.2: 改为 `require('./updater').init({ log, currentVersion: CURRENT_VERSION })`

- [x] Task 5: 修改 `package.json` 重新起步
    - 5.1: 版本 `3.4.3` → `1.0.0`，输出目录 → `release-v1.0.0`
    - 5.2: `build.files` 加入 `updater.js` / `update.html` / `progress.html`

- [x] Task 6: 验证
    - 6.1: `node --check` 语法校验
    - 6.2: 用本地静态页面模拟 `update-window-height` 自适应逻辑（无滚动条、长文本截断）
    - 6.3: 打包 `1.0.0`，校验 asar 内含 `updater.js` / `update.html` / `progress.html` / `latest.yml`
