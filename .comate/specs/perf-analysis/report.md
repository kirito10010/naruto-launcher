# 卡顿深度分析报告

> 对象：naruto-launcher 1.0.0（Electron 11.5.0 / Chromium 87 / Adobe Flash PPAPI）
> 现象：玩游戏时间越久越卡，多开时更明显
> 方法：全量代码走查 + 进程/内存实测

---

## 一、结论速览

按「对长时间卡顿的影响程度」排序：

| # | 问题 | 位置 | 性质 | 可解性 |
|---|------|------|------|--------|
| 1 | **所有窗口/标签都不节流**，N 个游戏 = N 份满速 CPU/GPU → 发热降频 | `main.js:1013-1015`、`main.js:1460`、`game.html:1008` | 结构性 | ✅ 可解（改降级策略） |
| 2 | **隐藏标签页仍在绘制**（只改了 z-index，没停画） | `game.html:373` | 结构性 | ✅ 可解 |
| 3 | **每个标签 = 独立渲染进程 + Flash 插件进程**，线性增长且不回收 | `game.html:1001-1078`、`main.js:1910` | 结构性 | ⚠️ 部分可解 |
| 4 | **拉伸模式的 1 秒轮询 + `transform:scale()` 与 `wmode=direct` 冲突** | `game.html:850` | 明确缺陷 | ✅ 可解（收益可能很大） |
| 5 | **Flash 插件进程僵尸堆积**，且「刷新」会一刀切杀掉全部插件 | `main.js:1594-1596`、`main.js:1910` | 明确缺陷 | ✅ 可解 |
| 6 | **每次启动同步删除 GPUCache/Code Cache** → 着色器/字节码缓存反复重建 | `main.js:590-613`、`704` | 明确缺陷 | ✅ 可解 |
| 7 | **抓包模式自身开销大**（CDP 缓冲 150MB/webContents + 全量响应体落盘） | `capture.js:80-84` | 预期内 | ✅ 可降级 |
| 8 | 磁盘缓存 1GB + 每标签一个持久化分区，随标签数累积 | `main.js:1026`、`game.html:815` | 渐进式 | ✅ 可解 |
| 9 | 变速 DLL 注入到**每一个**渲染/插件进程（1x 也在跑 hook） | `main.js:944` | 常量开销 | ⚠️ 可优化 |
| 10 | `ignore-gpu-blacklist` 强制启用 GPU（坏驱动上会抖动/掉帧） | `main.js:1009` | 风险开关 | ✅ 可改为可选 |
| 11 | 平台约束：Electron 11 / Chromium 87（2020 年），内存与合成器优化远落后于现代版本 | `package.json` | 不可解 | ❌ 受 Flash 限制 |

---

## 二、实测数据（本机 x64 / 1080p）

用与启动器相同的窗口结构（1 个 BrowserWindow 宿主 + N 个 `<webview>`，宿主 `backgroundThrottling:false`、webview `backgroundThrottling=no`）测得：

| 场景 | 进程数 | 总工作集 |
|------|--------|----------|
| 仅 Electron 外壳（启动器未开） | 1 | 74 MB |
| 1 窗口 / 1 标签 | 6 | 392 MB |
| 1 窗口 / 2 标签 | 7 | 464 MB |
| 2 窗口 / 2 标签 | 9 | 612 MB |
| 2 窗口 / 4 标签 | 10 | **695 MB** |

**结论**：
- **每多开一个游戏标签页，大约 +70~75 MB 内存 + 1 个渲染进程**；接入真实 Flash 游戏内容后这个数字只会更高（Flash 插件本身还有独立进程）。
- 2 窗口 / 4 标签 ≈ **700MB**；实际挂 3~4 个账号长时间挂机，很容易到 **1.2~2GB**。
- 进程数线性增长意味着**调度开销、GPU 上下文、合成器负担都线性增长**，而 `disable-renderer-backgrounding` 又保证它们都满速跑 → 直接推高整机功耗与温度。

> 注：本测试页含 `requestAnimationFrame` 持续重绘与定时增长的 DOM，用来模拟游戏页的持续负载。

---

## 三、逐项分析

### 3.1 全局禁用后台节流 —— 满速运行，发热降频

```js
// main.js:1013-1015
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding');
```
```js
// main.js:1460  游戏窗口自身渲染进程
backgroundThrottling: false,
```
```html
<!-- game.html:1008 每个 webview -->
webpreferences = "... ,backgroundThrottling=no"
```

这三处叠加的效果是：**无论窗口是否可见、标签是否激活，所有渲染进程与 Flash 都不降速**。

这是"多开挂机"功能的必要前提（后台账号要继续跑），但它同时意味着：
- 被遮挡的窗口、隐藏的标签**照样满速绘制**；
- GPU/CPU 长期满载 → **发热 → 降频 → 越玩越卡**（这正是"长时间玩变卡"的典型曲线）。

> 补充：`game.html:912 setTabThrottle()` 会给非活跃标签调 `setBackgroundThrottling(true)`，但全局开关 `disable-background-timer-throttling` 是进程级、优先级更高，**大概率被覆盖**（需实测确认）。

**这是结构性根因，不是 bug。** 解决方向不是"关掉后台运行"，而是**让后台只跑逻辑、不跑绘制**。

---

### 3.2 隐藏标签页并没有"停画"

```css
/* game.html:373 */
.webview-wrap webview.hidden { z-index: 0; pointer-events: none; }
```

`switchTab()`（`game.html:1143`）切走标签时只加 `.hidden`：元素**仍在布局树里、仍被合成器绘制**，只是被盖住了。配合 3.1 的满速策略，隐藏标签的 Flash 依然每帧出图。

`applyFlashQuality(webview,'low')`（`game.html:896`）只是把 `quality` 设为 low、`wmode` 设为 opaque，**降的是画质，不是"要不要画"**。

→ 正确做法是让隐藏的 webview 退出绘制（如 `display:none` / 从合成层摘除），保留定时器与网络（这样后台账号逻辑照常跑）。

---

### 3.3 每个标签 = 独立渲染进程 + Flash 插件进程

```js
// game.html:1001 createWebview() —— 每个标签 new 一个 <webview>
// main.js:1416 createGameWindow() —— 每个窗口一套 game.html + 若干 webview
```

- 1 个标签 = 1 个渲染进程；Flash 内容还会拉起 PPAPI 插件进程；
- 关标签时（`game.html:1102 removeTab`）只是 `removeChild(webview)`，**没有 `killFlashPluginProcesses()`**；
- 插件进程回收只在「刷新」和「最后一个游戏窗口关闭」时发生（`main.js:1594` / `1693`）。

→ 长时间反复开关标签，**有概率残留插件进程**（Electron 对 `<webview>` 的插件进程回收并不总是及时），越积越多。

---

### 3.4 拉伸模式的 1 秒轮询 + `transform` 缩放（重点怀疑）

```js
// game.html:847-852（注入到游戏页里执行）
window.addEventListener("resize", doStretch);
window.__narutoStretchTimer = setInterval(doStretch, 1000);
```

`doStretch()` 每秒做一次：
1. `document.querySelectorAll("embed, object")`
2. 逐个读 `offsetWidth/offsetHeight` → **强制同步布局（reflow）**
3. 命中后给 Flash 元素写 `position:fixed` + `transform: scale(sx, sy)`

两个问题：
- **每秒一次强制 reflow**，在 Flash 页面上会打断渲染管线；
- **`transform:scale()` 与 `wmode=direct` 语义冲突**：`direct` 表示插件直接画到屏幕、绕过浏览器合成器；而 CSS transform 要求由合成器重新栅格化该元素。二者叠加时 Chromium 往往**退化为软件路径或每帧重新合成**，代价极高。

→ 若用户开着「拉伸模式」长时间玩，这**很可能是最大的单点卡顿源**。而定时器只要不关拉伸就永不停止。

---

### 3.5 「刷新」会杀掉所有插件进程

```js
// main.js:1594-1596
addListener('refresh-page', (event) => {
  killFlashPluginProcesses();   // 杀掉 metrics 里所有 plugin 类型进程
});
```

`killFlashPluginProcesses()`（`main.js:1910`）按进程类型匹配，**无法区分属于哪个标签**，所以刷新一个标签会把**所有窗口所有标签**的 Flash 一起杀掉 → 其它账号的 Flash 全部重启 → 明显卡顿与白屏。

---

### 3.6 每次启动都同步清掉 GPUCache / Code Cache

```js
// main.js:590-613 cleanupElectronCache()：删除 GPUCache / Code Cache / Session Storage ...
// main.js:704     performStartupCleanup()：启动后 3s 触发，全程同步 IO
```

- 删 `GPUCache` = 丢掉 **GPU 着色器缓存** → 之后要重新编译着色器（首几分钟更吃 CPU/GPU）；
- 删 `Code Cache` = 丢掉 **V8 字节码缓存** → 页面 JS 重新编译；
- 全部是 **`fs.readdirSync/statSync/rmdirSync` 同步递归**，在主进程执行 → 期间 UI 卡住（缓存越大卡得越久）。

→ 这解释了「刚打开的一小段时间也不顺」。

---

### 3.7 抓包模式自身开销

```js
// capture.js:80-84
Network.enable({ maxTotalBufferSize: 100MB, maxResourceBufferSize: 50MB, maxPostDataSize: 10MB })
// capture.js:128-147 对每个完成的请求调用 Network.getResponseBody 并写 JSONL
```

- 每个 webContents 最多 **150MB** 的 CDP 缓冲；
- 每个请求的响应体都要序列化 + 落盘；
- net-log（`main.js:1029-1040`）在 `IncludeSocketBytes` 模式下把 socket 原始字节全量写文件。

→ **抓包期间必然更卡**（每周导出时开一次，可接受），但需要让用户知道原因，并尽量降低开销。

---

### 3.8 磁盘缓存 1GB + 每标签一个持久化分区

```js
// main.js:1026
app.commandLine.appendSwitch('disk-cache-size', '1073741824');
```
```js
// game.html:815 getPartition()
if (diskCache) return 'persist:game-' + tab.index;   // 每个标签一个持久化分区
```

- 1GB 磁盘缓存 + 分区随标签索引增长 → 磁盘索引与目录数量累积；
- 清理策略是「超过 3 天」才删（`main.js:619 cleanupUnusedSessions`），短期不回收。

---

### 3.9 变速 DLL 注入到每个进程

```js
// main.js:944 injectAllChildProcesses() —— 把 speedhook.dll 注入所有 renderer / plugin
```

- 注入时机：改速率、标签加载完成；
- **即使倍率是 1x，hook 依然在每个渲染/插件进程里常驻**；若 hook 挂在时间 API（`QueryPerformanceCounter`/`GetTickCount`/`Sleep`）上，Flash 每帧都会经过它 → 恒定的小额开销；
- `injectedPids` 只增不减，PID 复用后可能漏注入（正确性小问题，非性能）。

---

### 3.10 GPU 相关开关

```js
// main.js:1009-1010
app.commandLine.appendSwitch('ignore-gpu-blacklist');  // 无视驱动黑名单强制启用 GPU
app.commandLine.appendSwitch('no-sandbox');            // 关沙箱（安全，非性能）
```

- `ignore-gpu-blacklist` 在驱动有问题的机器上会**强制走 GPU 路径**，表现为花屏/掉帧/卡死；建议改为**可选开关**（默认关闭）。
- `no-sandbox` 是安全权衡（更快，但隔离变弱），不影响卡顿。

> 顺带：`enable-fast-startup`（`main.js:1020`）不是 Chromium 的有效开关，属无效配置。

---

### 3.11 平台约束

Electron 11.5.0 / Chromium 87 发布于 2020 年。现代 Chromium 在：
- 内存压缩（PartitionAlloc / Oilpan）、
- 合成器与光栅化调度、
- 后台标签页冻结（freeze / discard）

上都有数量级的改进。**但 Flash PPAPI 只能跑在老 Chromium 上**，这是硬约束，无法通过升级解决。

---

## 四、解决方案（按优先级）

### P0 — 建议立即做（低风险、收益大）

#### P0-1 隐藏标签页真正停画（对应 3.2）
- **改法**：`switchTab()` 里把非活跃 webview 从 `classList.add('hidden')` 改为 `style.display='none'`（保留定时器/网络，只停绘制）；切回时恢复。
- **预期**：多标签时 GPU/CPU 显著下降，发热降低 → 长时间不再降频。
- **风险**：中。部分 Electron 版本切换 `display` 会触发 webview 重新布局（切回瞬间可能闪一下）。**需实测**：切回后 Flash 是否继续、有无白屏。
- **回退**：保留 `.hidden` 方案作为降级。

#### P0-2 拉伸模式去掉 1 秒轮询、改掉缩放方式（对应 3.4）
- **改法**：
  1. 删掉 `setInterval(doStretch, 1000)`，只在 `resize` + 首次延迟触发（用 `ResizeObserver` 或 100ms 防抖）；
  2. 缩放改用 `zoom` 或直接改 embed 的 `width/height`，**不要用 `transform: scale()`**；
  3. 若保留 transform，则拉伸模式下把 `wmode` 从 `direct` 改为 `opaque`（走合成器），避免语义冲突。
- **预期**：开拉伸时的卡顿明显缓解。
- **风险**：低。

#### P0-3 「刷新」只重启当前标签的 Flash（对应 3.5）
- **改法**：`refresh-page` 不再调用全局 `killFlashPluginProcesses()`，改为让**当前标签自己** `webview.reloadIgnoringCache()`；全局清理只保留在「最后一个游戏窗口关闭」时。
- **预期**：刷新不再波及其它账号。
- **风险**：低（需确认「杀插件进程」原本是为了绕开 Flash 卡死，若确有必要，可只杀当前 webview 对应的插件——但 Electron 未暴露该映射，退而求其次：先 reload，失败再全局清）。

#### P0-4 启动清理不再删 GPU/Code Cache（对应 3.6）
- **改法**：`cleanupElectronCache()` 移除 `GPUCache`、`Code Cache`；其余保留；并把清理改为 `setImmediate` 分片 / 空闲时执行，避免主进程同步阻塞。
- **预期**：启动更顺，前几分钟不再因着色器重编译而掉帧。
- **风险**：低。

### P1 — 建议做（收益中等，需一点验证）

#### P1-1 后台标签/窗口「降画质 + 限帧」而非满速（对应 3.1、3.3）
- **改法**：非活跃标签除 `quality=low` 外，再注入限帧（如把 Flash 的 `stage.frameRate` 降到 12fps，或对 canvas/embed 做 `requestAnimationFrame` 节流）；失焦的游戏窗口同样降级。
- **注意**：不能停逻辑，否则挂机账号会掉线/不产出。
- **风险**：中（可能影响挂机收益，需用户确认接受度）。

#### P1-2 定期回收僵尸插件进程（对应 3.3）
- **改法**：主进程每 5~10 分钟比对一次 `app.getAppMetrics()` 中 plugin 进程数与当前存活 webContents 数，超出即回收；关标签时也触发一次。
- **风险**：低。

#### P1-3 抓包模式降级（对应 3.7）
- **改法**：CDP 缓冲 100MB→16MB / 50MB→8MB；`Network.getResponseBody` 只对必要 MIME 抓；抓包开启时在启动器上给明确提示「抓包期间会卡顿，属正常」。
- **风险**：低（要确认缩小缓冲不影响导出结果——导出依赖的是 net-log，不是这个 JSONL，可安全缩小）。

#### P1-4 分区与缓存回收（对应 3.8）
- **改法**：`persist:game-N` 分区按「每个游戏保留最近 N 个」回收，而不是只按 3 天；`disk-cache-size` 从 1GB 降到 256MB。
- **风险**：低（可能影响登录态缓存命中，需回归）。

### P2 — 可选 / 需要权衡

- **P2-1** `ignore-gpu-blacklist` 改为可选开关，默认关闭（对应 3.10）。
- **P2-2** 1x 时跳过 DLL 注入，仅在倍率≠1 时注入（对应 3.9）。
- **P2-3** 启动器窗口隐藏后销毁渲染进程（改为按需重建），省一份常驻内存。
- **P2-4** 增加「性能诊断」面板：定时记录 `app.getAppMetrics()` 到日志，方便复现与量化。

---

## 五、怎么量化验证（建议按此顺序）

1. **基线**：任务管理器记录「1 窗口 1 标签」挂机 30 分钟的 CPU%、内存、GPU 占用曲线。
2. **多开**：同样的曲线，2 窗口 / 4 标签。看内存是否持续爬升（判断泄漏）与 CPU 是否长期 >80%（判断降频）。
3. **单项对照**：分别开关「拉伸模式」「抓包模式」，对比 CPU/GPU。
4. **改后回归**：每做一项 P0，重复 1~3，对比曲线。重点看**内存斜率**（是否还在爬）与**30 分钟后的帧率**（是否掉档）。

> 内置手段：可用 `app.getAppMetrics()` 每 60s 打一条日志（P2-4），比外部工具更贴近真实进程归属。

---

## 六、一句话总结

**这不是单一 bug，而是"多开 + 全部不节流 + 隐藏标签仍绘制 + 老版 Chromium"叠加出的结构性发热降频**；其中 **3.4（拉伸模式轮询与 transform 冲突）** 和 **3.6（每次启动删 GPU 缓存）** 是两处明确的、低风险高收益的缺陷，建议先修这两处 + 3.2（隐藏标签停画），再评估后台限帧策略。
