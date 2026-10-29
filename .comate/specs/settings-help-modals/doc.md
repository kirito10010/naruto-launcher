# 启动器设置面板：下拉项右侧「说明」入口 + GPU 开关说明

## 1. 需求

1. 设置面板里两个下拉框（**Flash 版本**、**抓包模式**）右侧各留一个位置，分别放该选项的**说明入口**，点一下打开说明窗口。
2. 抓包说明从设置面板底部（现在的「组织统计抓包说明」「全量抓包说明」两段）**移走**，改由「抓包模式」的说明窗口承载 → 设置面板更短更清爽。
3. **强制启用 GPU** 现在只有一句「无视驱动黑名单；可能花屏/掉帧」，用户不知道开关的优缺点、什么情况该开/该关 → 补一份说明。

## 2. 现状

`main.js` 的 `createLauncherWindow()` 里，设置面板是页面底部的上滑 sheet（`<section class="sheet">`），结构：

```
设置
├─ 主题（theme-grid）
├─ Flash 版本   → <select id="flashSelect">
├─ 抓包模式     → <select id="captureModeSel">
│                 <div class="row-hint">切换后需重启应用生效</div>
├─ 性能
│   ├─ 强制启用 GPU   → <span class="row-label">…<span class="row-hint">无视驱动黑名单；可能花屏/掉帧，切换后需重启</span></span> + switch
│   └─ 性能诊断日志   → label + switch
├─ 组织统计抓包说明（5 步流程 + 注意事项）
└─ 全量抓包说明
```

相关样式：`.sel`、`.row`、`.row-label`、`.row-hint`、`.guide`（含 `.step-name` / `.done`）、`.sheet-mask` / `.sheet`。

## 3. 方案

只改 `main.js`（启动器页面的内联 HTML/CSS/JS），不新增文件。

### 3.1 下拉框右侧加「说明」按钮

两个下拉框各自包一层 flex 行，右侧放一个紧凑按钮：

```html
<div class="sec-title">Flash 版本</div>
<div class="sel-row">
  <select class="sel" id="flashSelect" onchange="changeFlash(this.value)">…</select>
  <button class="info-btn" onclick="openHelp('flash')" title="Flash 版本说明">说明</button>
</div>

<div class="sec-title">抓包模式</div>
<div class="sel-row">
  <select class="sel" id="captureModeSel" onchange="changeCaptureMode(this.value)">…</select>
  <button class="info-btn" onclick="openHelp('capture')" title="抓包模式说明">说明</button>
</div>
```

新增样式（沿用主题变量，自动跟随主题）：

```css
.sel-row { display:flex; gap:8px; align-items:stretch; }
.sel-row .sel { flex:1; min-width:0; }
.info-btn {
  flex:0 0 auto; padding:0 12px; border-radius:10px; cursor:pointer;
  font-size:12px; font-weight:600; white-space:nowrap;
  color:var(--accent); background:var(--hover);
  border:1px solid var(--border); transition:background .18s, color .18s;
}
.info-btn:hover { background:var(--accent); color:var(--accentText); border-color:transparent; }
```

### 3.2 说明窗口（主题化模态弹层）

在页面底部（`.sheet` 之外，作为 `body` 直接子元素）新增一个模态弹层，避免被 `.sheet-body` 的滚动裁切：

```html
<div class="help-mask" id="helpMask"></div>
<section class="help-card" id="helpCard">
  <div class="help-head">
    <span id="helpTitle"></span>
    <button class="sheet-close" id="btnHelpClose">&#10005;</button>
  </div>
  <div class="help-body guide" id="helpBody"></div>
</section>
```

- 居中卡片，宽 `min(320px, 88vw)`，`max-height:70vh`，正文可滚（复用现有细滚动条样式）。
- 打开时给 `.help-mask` / `.help-card` 加 `.open`；点击遮罩、点关闭按钮、按 `Esc` 均可关闭。
- `z-index` 显式分层：`.sheet-mask` 30 < `.sheet` 40 < `.help-mask` 50 < `.help-card` 60，保证说明层盖在设置层之上、点击说明遮罩不会误关设置面板。

JS：

```js
const HELP = { flash: { title: '…', html: '…' }, capture: {…}, gpu: {…} };
function openHelp(key) { … 填充 title/body，加 .open … }
function closeHelp() { … 移除 .open … }
```

### 3.3 GPU 行加「说明」按钮

`性能 → 强制启用 GPU` 行改为三段：标签（占满剩余宽度）+ 说明按钮 + 开关。

```html
<div class="row">
  <span class="row-label">强制启用 GPU<span class="row-hint">无视驱动黑名单；可能花屏/掉帧，切换后需重启</span></span>
  <button class="info-btn" onclick="openHelp('gpu')" title="强制启用 GPU 说明">说明</button>
  <label class="switch">…</label>
</div>
```

`.row` 增加 `gap:10px`，`.row-label` 增加 `flex:1; min-width:0`（「性能诊断日志」行只有两个子元素，布局不受影响）。

### 3.4 移除底部两段说明

删掉「组织统计抓包说明」与「全量抓包说明」两个 `sec-title` + `.guide` 块，其内容搬进「抓包模式」说明窗口。

## 4. 说明文案

### 4.1 Flash 版本（`help('flash')`）

> **内置国内版 34.0.0.376（纯净版）— 默认**
> - 由国内正式版 34 制作，已去除广告与检测组件；版本号与国内最新版一致，兼容性最好。
> - 无需另外安装 Flash。
> - 少数机器可能提示「必要组件缺失 / 地区不相容」，这是国内 Flash 依赖后台服务（Flash Helper Service）导致的，一般不影响在本启动器里使用。
>
> **内置国际版 32.0.0.344**
> - Adobe 官方国际版，不依赖任何后台服务，最干净。
> - 版本较旧（国际版 32.0.0.371 之后的版本已被 Adobe 远程停用），个别新内容可能不兼容。
>
> **怎么选**：默认用国内版 34 即可；如果出现画面异常、进不去游戏、卡在加载，切换到国际版 32 再试。
> 两个版本都已内置，**切换后需重启启动器生效**。

### 4.2 抓包模式（`help('capture')`）

> **关闭**：不抓包，性能最好（默认）。
>
> **组织统计（生成 Excel）**：重启后进入游戏，依次打开下面 5 个界面（打开即会被记录）：
> 1. **组织成员**：组织 → 组织成员
> 2. **本周捐献**：组织 → 组织捐献 → 本周捐献
> 3. **叛忍数据**：大和 → 叛忍再临 → 管理员 → 我的组织 → 查看详情
> 4. **通灵兽献祭**：组织 → 组织基地 → 深作 → 组织通灵兽管理员 → 组织通灵兽 → 献祭 → 本周献祭
> 5. **忍战数据**：忍界大战参谋（或 跨服忍界大战接引忍者）→ 参与忍界大战（或 参加跨服忍界大战）→ 礼包分配
>
> 抓包期间会略微卡顿，属正常现象。
> 完成后：① 关闭「火影忍者」游戏窗口 ② 托盘图标右键 → 关闭启动器。
> 退出后会自动在桌面「火影组织数据/<日期>/」生成 6 张 Excel。
>
> **全量抓包（导出原始文件）**：重启后正常玩游戏即可，**不会生成 Excel**。
> 退出启动器时把本次会话的全部原始网络数据导出到桌面「火影全量抓包/<时间>/」，含 net-log（socket 原始字节）、http jsonl 与一份说明.txt。用于以后做更深入的数据分析；文件可能较大，分析完可自行删除。
>
> **通用**：切换模式后需重启启动器生效；导出必须走托盘「退出」，直接关窗口会导致数据写不完、导不出。

### 4.3 强制启用 GPU（`help('gpu')`）

> 这个开关决定启动时是否加 `--ignore-gpu-blacklist`（无视显卡驱动的黑名单，强制启用硬件加速）。
>
> **开启（默认）**
> - 优点：页面/Flash 由显卡渲染，更流畅，CPU 占用更低，多开时更省资源。
> - 缺点：驱动本身有问题的机器可能出现花屏、闪烁、黑屏、掉帧，甚至启动失败。
>
> **关闭**
> - 优点：交给 Chromium 按官方黑名单判断，稳定性更好，驱动异常的机器不容易花屏/崩溃。
> - 缺点：可能回退到软件渲染，渲染压力转到 CPU，多开或长时间玩更容易卡顿、发热。
>
> **什么时候开**：默认开着就行。显卡驱动较新、以前没出现过花屏/闪烁 → 保持开启。
> **什么时候关**：出现花屏、闪烁、黑屏、画面撕裂，或启动即崩溃 → 关掉再试。
>
> 切换后需重启启动器生效。

## 5. 影响文件

| 文件 | 改动 |
| --- | --- |
| `main.js` | 仅 `createLauncherWindow()` 的内联 HTML/CSS/JS：新增 `.sel-row` / `.info-btn` / `.help-mask` / `.help-card` 样式、`HELP` 文案表、`openHelp()` / `closeHelp()`、两个下拉框与 GPU 行的说明按钮、删除底部两段说明。IPC 与配置读写**不变** |

## 6. 边界与异常

| 场景 | 处理 |
| --- | --- |
| 说明弹层与设置面板同时打开 | 说明层 z-index 更高，只盖住不关闭设置面板；关掉说明后回到设置面板 |
| 点说明遮罩 | 只关说明层，不关设置面板 |
| `Esc` | 说明层打开时只关说明层；未打开时不处理 |
| 文案含 `$` / 反引号 | 文案放在独立对象里，避免与模板字符串冲突（不出现 `</script>`） |
| 小窗口宽度 | 说明卡片宽 `min(320px, 88vw)`，正文可滚，不撑破窗口 |
| 主题切换 | 弹层只用主题 CSS 变量，切主题自动跟随 |

## 7. 预期结果

- 两个下拉框右侧各有「说明」按钮，点击弹出主题化说明窗口。
- 设置面板底部不再有冗长的抓包说明，面板更短。
- 强制启用 GPU 有完整的优缺点与适用场景说明。
- 不改任何配置项、IPC 与抓包/Flash 行为，仅 UI 与文案。

## 8. 待确认

1. 说明入口的按钮文案用 **「说明」**（约 46px 宽）。若想更短可用圆形 **`?`**，若想更明确可用 **「版本说明」「模式说明」**（更宽，360px 窗口下略挤）。
2. 说明窗口用**页面内模态弹层**（推荐：自动跟随主题、无需新文件）。若更希望是**独立小窗口**（像更新弹窗那样），需要新增一个 HTML 文件 + 主题同步，成本更高。
3. 「性能诊断日志」是否也加一个说明入口？（本次默认**不加**，其提示已写明「每 60 秒记录一次进程/内存到 perf.log」）
