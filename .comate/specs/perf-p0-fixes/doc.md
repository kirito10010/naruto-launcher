# 卡顿优化全量实施设计（P0 + P1 + P2）

> 依据：`.comate/specs/perf-analysis/report.md`
> 范围：用户要求"能修的全修"。逐项评估后，**能做且值得做的 12 项全做**；有 2 项经评估**不做**（附理由）。

---

## 一、总览

| 编号 | 项 | 结论 |
|------|----|------|
| P0-1 | 隐藏标签页真停画 | ✅ 做 |
| P0-2 | 拉伸模式去轮询 + 修 wmode 冲突 | ✅ 做 |
| P0-3 | 刷新只影响当前标签 | ✅ 做 |
| P0-4 | 启动清理不删 GPU/Code Cache + 非阻塞 | ✅ 做 |
| P1-5 | 后台**窗口**失焦降画质 | ✅ 做（限帧部分不做，见下） |
| P1-6 | 关标签显式释放 webview | ✅ 做 |
| P1-7 | 抓包 CDP 缓冲降级 + 提示 | ✅ 做 |
| P1-8 | 分区/缓存回收策略收紧 | ❌ 不做（会变慢/丢登录态） |
| P2-9 | `ignore-gpu-blacklist` 改为设置开关 | ✅ 做 |
| P2-10 | 1x 时跳过 DLL 注入 | ✅ 做 |
| P2-11 | 启动器窗口关闭即销毁、按需重建 | ✅ 做 |
| P2-12 | 性能诊断日志（设置开关） | ✅ 做 |
| P2-13 | 移除无效开关 `enable-fast-startup` | ✅ 做 |
| P1-5b | 后台标签"限帧" | ❌ 不做（Flash 帧率由 SWF 内部控制，外部无法可靠限帧，不做假实现） |

---

## 二、逐项设计

### P0-1 隐藏标签页真停画（`game.html`）

`.hidden` 增加 `visibility:hidden`（保留布局与尺寸，合成器跳过该层）：

```css
.webview-wrap webview.hidden { z-index:0; pointer-events:none; visibility:hidden; }
```

不用 `display:none`（会让 webview 尺寸归零 → 游戏内分辨率跳变）。`setAudioMuted` / `setTabThrottle` 保持不变。

### P0-2 拉伸模式（`game.html`）

**A. 去掉 1 秒轮询**：`STRETCH_ENABLE_JS` 改为事件驱动——立即执行一次，之后 300/1000/2500/5000ms 各补一次（覆盖 embed 晚出现），`resize` 用 rAF 防抖；不再 `setInterval`。

**B. 修 wmode 冲突**：`applyFlashQuality()` 感知 `stretchMode`：

```js
const wmode = stretchMode ? 'opaque' : (quality === 'low' ? 'opaque' : 'direct');
```

`setStretchMode()` 切换后对所有标签重新应用画质。

### P0-3 刷新只影响当前标签

- `main.js`：`refresh-page` 处理器不再 `killFlashPluginProcesses()`（改为空实现 + 注释）。
- `game.html`：`refreshPage()` 立即 `reloadIgnoringCache()`（不再等 2.5s），`_manualRefresh` 守卫 4s 防 `plugin-crashed` 重复 reload。
- 全局回收保留在「最后一个游戏窗口关闭」。

### P0-4 启动清理（`main.js`）

- `cleanupElectronCache()` 删除列表移除 `GPUCache`、`Code Cache`（保留 GPU 着色器缓存 + V8 字节码缓存）。
- `performStartupCleanup()` 改成分步链式（每步间 `setTimeout(50)`），不再长时间阻塞主进程。

### P1-5 后台窗口降画质（`game.html` + `main.js`）

现状：只有"非活跃**标签**"降画质；"失焦的**窗口**"没有。
新增：监听窗口 `blur`/`focus`（主进程已有 `window-blur`/`window-focus` 事件）→ 失焦时把该窗口所有标签的 Flash 设为 `quality=low`，聚焦时把活跃标签恢复 `high`。
> 不降逻辑速率（不影响挂机），只降画质。

### P1-6 关标签显式释放 webview（`game.html`）

`removeTab()` 里在 `removeChild` 之前：`webview.stop()` + `removeAllListeners()` + `src='about:blank'`，促使 guest 与 Flash 插件进程及时回收（原来只 `removeChild`）。

### P1-7 抓包降级（`capture.js` + `main.js` 设置文案）

- CDP 缓冲：`maxTotalBufferSize` 100MB→16MB、`maxResourceBufferSize` 50MB→8MB、`maxPostDataSize` 10MB→2MB。
  > 导出依赖的是 net-log 文件，不是这个 JSONL，缩小缓冲不影响导出结果。
- 启动器设置面板的「抓包导出说明」里加一句：**抓包期间会略微卡顿，属正常现象**。

### P2-9 `ignore-gpu-blacklist` 改为设置开关（`main.js`）

- 新增配置 `forceGpu`，**默认 `true`**（保持当前行为，零回归）。
- `app.commandLine.appendSwitch('ignore-gpu-blacklist')` 仅在 `forceGpu` 为真时追加。
- 启动器设置新增开关「强制启用 GPU（黑名单设备，可能花屏/掉帧）」，切换后提示重启（复用现有重启弹窗模式）。

### P2-10 1x 时跳过 DLL 注入（`main.js`）

`injectAllChildProcesses()` 开头加：当前速率 == 1 时直接返回。
> 速率从 1 改为非 1 时 `setSpeedRate` 仍会注入；`injectSpeedHook` 成功后仍会 `updateNativeRate(currentSpeedRate)` 补速率。`useNativeInjectionSuccess` 只写不读，跳过安全。

### P2-11 启动器窗口关闭即销毁（`main.js`）

- `launcherWindow.on('close')` 不再 `hide()`，直接销毁（`closed` 里已置 null）。
- 新增 `showLauncherWindow()`：存在则 `show()+focus()`，否则 `createLauncherWindow()`。
- 替换全部 4 处 `launcherWindow.show()`：second-instance、游戏窗口全关、托盘菜单「显示启动器」、托盘左键。
- 收益：玩游戏时启动器不再常驻一个渲染进程（省 ~70MB）。

### P2-12 性能诊断日志（`main.js` + 启动器设置）

- 配置 `perfDiag`（默认 `false`）。
- 开启后每 60s 往 `userData/perf.log` 追加一行：进程数、总工作集、各类型进程数、当前标签/窗口数。
- 启动器设置新增开关「性能诊断日志」。

### P2-13 移除无效开关

删除 `app.commandLine.appendSwitch('enable-fast-startup')`（非 Chromium 有效开关）。

---

## 三、不做项与理由

| 项 | 理由 |
|----|------|
| P1-8 收紧分区/缓存保留期、`disk-cache-size` 1GB→256MB | **磁盘缓存越大越省网络、对流畅度有利**，收紧反而变慢；把分区保留期从 3 天缩短会导致"每周玩一次就丢登录态"，属产品行为变更，不在性能范畴 |
| P1-5b 后台标签"限帧" | Flash 的帧率由 SWF 内部 `stage.frameRate` 决定，外部（JS/CSS/Electron API）无法可靠限制；写一个"看起来限了但实际没限"的实现没有意义 |

---

## 四、受影响文件

| 文件 | 改动 |
|------|------|
| `game.html` | `.hidden` 加 `visibility`；拉伸 JS 去轮询；`applyFlashQuality` 感知 stretch；`setStretchMode` 重刷；`refreshPage` 立即重载；`removeTab` 显式释放；窗口失焦/聚焦降画质 |
| `main.js` | `refresh-page` 不再全局杀插件；清理不删 GPU/Code Cache + 分步；`forceGpu`/`perfDiag` 配置与开关；1x 跳过注入；启动器窗口关闭即销毁 + `showLauncherWindow()`；移除无效开关；设置面板加两个开关与抓包提示；性能诊断定时器 |
| `capture.js` | CDP 缓冲降级 |

## 五、验收

1. `node --check` 通过（main.js / updater.js / capture.js / export.js / xlsx.js + 两个 html 的内联脚本）。
2. 多标签切换、刷新单标签、拉伸模式开关、后台窗口失焦降画质均正常。
3. 关闭启动器窗口后托盘能重新打开；`GPUCache`/`Code Cache` 不再被清。
4. 设置面板新增两个开关可正常切换并持久化。
5. 打包 1.0.0 成功。
