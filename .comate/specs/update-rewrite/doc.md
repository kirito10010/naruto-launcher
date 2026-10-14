# 更新逻辑重写 + 国内加速（update-rewrite）

## 1. 需求

1. **弹窗提示更新**，弹窗里显示**本次更新内容**（取自 GitHub release 的发布说明）
2. 点击更新后有**下载进度**
3. 更新弹窗 / 进度弹窗**不能出现滚动条**，排版要好看，内容不能放不下
4. **更新要快**：GitHub 在国内慢，要解决
5. 版本从 **1.0.0** 重新开始（GitHub 上的旧 release 已全部删除）

## 2. 技术方案

### 2.1 现状问题
| 问题 | 现状 |
|---|---|
| 弹窗排版 | 用系统原生 `dialog.showMessageBox`，更新说明长了会挤/出现滚动条 |
| 更新内容 | 有传 `releaseNotes`，但混着 HTML，排版不可控 |
| 下载速度 | 直连 `github.com/.../releases/download/...`，国内极慢 |
| 进度 | `autoDownload` 默认 true，弹窗前就偷偷下载 → 进度事件丢失 |

### 2.2 下载加速（核心）
`electron-updater` 的 `ElectronHttpExecutor.createRequest(options, callback)` 是所有网络请求（含**文件本体**和 **blockmap**）的唯一出口，且 `autoUpdater.httpExecutor` 是公开字段。

**做法**：覆写 `createRequest`，把 `https://github.com/` 开头的 URL 加代理前缀：

```js
const ex = autoUpdater.httpExecutor;
const origCreate = ex.createRequest.bind(ex);
ex.createRequest = (options, callback) => {
  if (options && typeof options.url === 'string' && options.url.startsWith('https://github.com/')) {
    options = { ...options, url: PROXIES[proxyIdx] + options.url };   // 如 https://ghfast.top/https://github.com/...
  }
  return origCreate(options, callback);
};
```

- 版本检查仍走 `api.github.com`（快、通）
- 只代理**下载**流量
- 代理列表按序尝试，失败自动换下一个，最后回退直连：
  ```js
  const PROXIES = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/', 'https://gh.llkk.cc/', ''];
  ```

### 2.3 自定义更新窗口（替代原生弹窗）
新增 `update.html`（或内嵌 HTML）作为更新提示窗口：

```
┌────────────────────────────────┐
│  发现新版本  v1.0.0             │
│  当前版本: v1.0.0 → 最新: v1.0.1 │
│  ─────────────────────────────  │
│  更新说明                        │
│  <发布说明，纯文本，自动换行>     │
│  ─────────────────────────────  │
│         [稍后提醒]  [立即更新]    │
└────────────────────────────────┘
```

**无滚动条 + 不裁切**的实现：
- 窗口 `show:false`，渲染完成后由渲染进程测量内容高度 → IPC 通知主进程 `setContentSize` 自适应
- 高度上限 = 屏幕工作区 80%；超过时**更新说明区用 CSS `-webkit-line-clamp` 截断加省略号**（不是滚动条）
- `body { overflow: hidden }` 全局禁滚动条
- 更新说明：HTML 标签清洗为纯文本，`white-space: pre-wrap; word-break: break-word`

### 2.4 进度窗口
复用现有进度窗口，同样加 `overflow:hidden` + 自适应，显示：进度条 / 百分比 / 已下载MB / 速度。

### 2.5 流程（确定性）
```
启动 5s 后 checkForUpdates()
  └─ update-available → 解析 releaseNotes → 弹【自定义更新窗口】
        └─ 点「立即更新」→ 弹【进度窗口】→ downloadUpdate()（走代理）
              ├─ download-progress → 刷新进度条
              ├─ 失败 → 换下一个代理重试（最多 3 次）→ 仍失败弹错误框
              └─ update-downloaded → 弹「下载完成，立即重启？」→ quitAndInstall()
```
- `autoUpdater.autoDownload = false`（必须，否则进度丢失）

## 3. 涉及文件

| 文件 | 改动 |
|---|---|
| `updater.js` | **新增**：更新检查、自定义窗口、代理下载、安装（从 main.js 抽出） |
| `main.js` | 移除原 `initAutoUpdater` 及其窗口代码，改为调用 `require('./updater').init({ log, currentVersion })` |
| `package.json` | 版本 → `1.0.0`；`build.files` 加 `updater.js`；输出目录 `release-v1.0.0` |

## 4. 边界条件

| 场景 | 处理 |
|---|---|
| 无 release / 网络不通 | 只写日志，不弹窗（避免启动噪音） |
| 发布说明为空 | 显示"暂无更新说明" |
| 发布说明极长 | 窗口自适应到 80% 屏高，超出部分 `line-clamp` 截断 + 省略号（无滚动条） |
| 代理全部失败 | 回退直连 github.com |
| 用户点「稍后提醒」 | 本次不再提示（不重复弹） |
| 下载中断网 | 报错 + 提示（不静默） |

## 5. 验证
1. 发一个 `1.0.1` 的测试 release（含 `latest.yml`）
2. 装 `1.0.0` → 启动 → 弹更新窗口，说明文字完整、**无滚动条**
3. 点「立即更新」→ 进度条实时走、速度显示正常、下载明显快于直连
4. 完成后重启 → 版本变 1.0.1
