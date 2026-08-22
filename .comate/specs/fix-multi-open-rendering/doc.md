# 多开渲染回归修复方案

## 1. 背景与问题

用户反馈（v3.0.0 打包后）：
1. 启动器打开一个窗口，登录进入游戏正常。
2. 此时再「多开一个标签页」，新标签页**不显示页面，很久很久才显示**。
3. 用启动器「再开一个窗口」，新窗口同样**不显示**。

### 根因分析

上次「流畅度优化」中，我误删了 4 个命令行启动参数：

| 参数 | 作用 | 误删后果 |
|------|------|----------|
| `ignore-gpu-blacklist` | 强制启用 GPU 硬件加速（即使 GPU 在黑名单） | 回退软件渲染，多实例渲染极慢/不显示 |
| `disable-gpu-vsync` | 关闭 GPU 垂直同步 | Flash 画面合成异常 |
| `disable-frame-rate-limit` | 取消帧率限制 | Flash 被节流、渲染停顿 |
| `enable-features=CanvasOopRasterization` | 启用 OOP 光栅化 | 进程/合成行为改变 |

这 4 个参数**自 v1.0.1 初始提交起就存在，且从未改动**，是 Flash PPAPI 在 Electron 中正常渲染（尤其多开/多实例）所必需的基线参数。删除后，第一个 Flash 实例还能渲染，但第二个实例（新标签页或新窗口）无法正常合成显示，表现为“很久才显示/不显示”。

此外，Electron 官方文档明确指出：`<webview>` 使用 `display:none`（或 `hidden` 属性）隐藏会导致**不寻常的渲染行为、页面在取消隐藏时被重新加载、甚至空白**。`game.html` 中切换标签正是用 `.hidden { display: none }` 与 `.paused { display: none }` 实现，这会加剧“多开标签页不显示”的问题。

---

## 2. 修复方案

### 方案 A（核心）：恢复被误删的 4 个启动参数

在 `main.js` 命令行开关区，恢复为 v2.2.8 的原始内容：

```js
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('no-sandbox');

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-fast-startup');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
```

### 方案 B（次要）：修复 webview 隐藏方式，避免 `display:none`

将 `game.html` 中隐藏 webview 的方式从 `display:none` 改为「宽高置零」，遵循 Electron 官方推荐做法。

当前 CSS：
```css
.webview-wrap webview.hidden { display: none; pointer-events: none; }
.webview-wrap webview.paused { display: none; pointer-events: none; }
```

改为：
```css
.webview-wrap webview.hidden { width: 0; height: 0; pointer-events: none; }
.webview-wrap webview.paused { width: 0; height: 0; pointer-events: none; }
```

> 说明：`.webview-wrap webview` 基础样式为 `position:absolute; width:100%; height:100%`，`.hidden/.paused` 的类选择器优先级更高，可正确覆盖为 0，实现隐藏但不触发 webview 的 `display:none` 渲染问题。

---

## 3. 受影响文件

| 文件 | 修改类型 | 位置/函数 |
|------|----------|-----------|
| `main.js` | 修改 | 命令行开关区（约 905-917 行） |
| `game.html` | 修改 | `.webview-wrap webview.hidden` / `.paused` 样式（196-203 行） |

---

## 4. 边界条件与异常处理

- 恢复参数后与 v2.2.8 基线一致，Flash 多实例渲染恢复；这些参数是 Flash PPAPI 必需项，不应再删除。
- 保留上次优化中「真正有益」的改动，不受影响：
  - `app.getAppMetrics()` 替代 PowerShell 进程扫描（消除 CPU 尖峰）
  - 启动清理延迟执行（消除启动阻塞）
  - 后台标签页静音
- `no-sandbox`、`ppapi-flash-*` 保持不动（DLL 注入与 Flash 必需）。
- webview 宽高置零隐藏时，`pointer-events:none` 保证不拦截点击；切换回标签时移除类即可恢复 100% 宽高。

---

## 5. 预期结果

- 多开标签页、多开窗口时，第二个及后续 Flash 实例能正常、及时渲染显示。
- 画面渲染恢复正常，不再“很久才显示”。
- 保留上次优化中的 CPU 尖峰消除与启动加速收益。
