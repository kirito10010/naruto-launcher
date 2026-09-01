# 工具栏内存状态显示提示

## 1. 需求场景与处理逻辑

**场景**：玩家单开长时间游玩，内存持续上涨（地图瓦片缓存 + Flash 位图）。之前只能靠后台自动重载或 2500MB 清缓存兜底，用户看不到实时状态，也无法自主决定。

**需求**：在工具栏加一个内存状态指示，让玩家看到当前游戏标签的内存占用与等级（正常/偏高/过高），自主决定是否点"刷新"释放。

**处理逻辑**：
- 主进程每次收到 `memory-check` 后，回传所有标签的内存值 `memory-status`（不仅限超限标签）。
- 渲染层取当前激活标签的内存，更新工具栏状态：
  - `< 1500MB` → 绿色圆点，文字「内存 XXXMB」
  - `1500~2500MB` → 橙色圆点，文字「内存 XXXMB 偏高」
  - `> 2500MB` → 红色圆点，文字「内存 XXXMB 过高」
- 纯展示、不自动执行动作，用户看到后自行点「刷新」（刷新已改为冷启动 Flash）。

## 2. 架构与技术方案

- 复用现有 `memory-check` IPC（每 60s 上报）与 `getMemoryMB()`。
- 主进程在 `memory-check` 处理器中新增 `statusList`，`event.sender.send('memory-status', statusList)` 始终回传。
- `game.html` 新增 `memory-status` 监听与 `updateMemStatus()`，用一个 DOM 状态元素展示。
- 状态元素放在工具栏中间（`toolbar-center`）末尾，紧跟 FPS 按钮，用 `separator` 分隔。

## 3. 受影响文件

### 3.1 `d:\Project\Naruto Online\main.js`（修改）
- 修改 `ipcMain.on('memory-check', ...)`：收集 `statusList` 并始终回传 `memory-status`。

### 3.2 `d:\Project\Naruto Online\game.html`（修改）
- 工具栏 HTML 新增 `#mem-status` 状态元素（game.html:549 附近）。
- 新增 `.mem-status` / `.mem-dot` / `.normal` / `.warn` / `.danger` CSS。
- 内存监控 `setInterval` 改为具名函数 `reportMemory()` 并立即执行一次 + 定时。
- 新增 `ipcRenderer.on('memory-status', ...)` 监听与 `updateMemStatus(mem)` 函数。

## 4. 实现细节

### 4.1 工具栏 HTML（FPS 按钮之后）

```html
<button class="btn" id="btn-fps" title="显示/隐藏游戏实时帧率">FPS</button>
<div class="separator"></div>
<div class="mem-status normal" id="mem-status" title="当前游戏标签内存占用，过高时建议点击「刷新」释放">
  <span class="mem-dot"></span>
  <span id="mem-text">内存 --</span>
</div>
```

### 4.2 CSS（`.separator` 之后）

```css
.mem-status {
  height: 24px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--btnBorder);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text);
  cursor: default;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.mem-dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; }
.mem-status.normal .mem-dot { background: #4caf50; }
.mem-status.warn { color: #ff9800; }
.mem-status.warn .mem-dot { background: #ff9800; }
.mem-status.danger { color: #f44336; }
.mem-status.danger .mem-dot { background: #f44336; }
```

### 4.3 main.js 修改 memory-check

```js
ipcMain.on('memory-check', (event, tabList) => {
  const highMem = [];
  const statusList = [];
  for (const t of (tabList || [])) {
    try {
      if (!t || !t.webContentsId) continue;
      const wc = webContents.fromId(t.webContentsId);
      if (!wc || wc.isDestroyed()) continue;
      const mem = getMemoryMB(wc.getOSProcessId());
      statusList.push({ id: t.id, mem });
      if (mem > 1500) highMem.push({ id: t.id, mem });
      if (mem > ACTIVE_MEM_CLEAR_THRESHOLD) { /* 清缓存逻辑保持不变 */ }
    } catch (e) {}
  }
  try { event.sender.send('memory-status', statusList); } catch (e) {}
  if (highMem.length) {
    try { event.sender.send('memory-alert', highMem); } catch (e) {}
  }
});
```

### 4.4 game.html 内存监控与状态更新

```js
function reportMemory() {
  try {
    const list = tabs.map(function(t) {
      return {
        id: t.id,
        webContentsId: t._webview ? t._webview.getWebContentsId() : null
      };
    }).filter(function(t) { return t.webContentsId; });
    if (list.length) ipcRenderer.send('memory-check', list);
  } catch (e) {}
}

reportMemory();
setInterval(reportMemory, 60000);

function updateMemStatus(mem) {
  const el = document.getElementById('mem-status');
  const text = document.getElementById('mem-text');
  if (!el || !text) return;
  if (!mem || mem <= 0) {
    el.className = 'mem-status normal';
    text.textContent = '内存 --';
  } else if (mem > 2500) {
    el.className = 'mem-status danger';
    text.textContent = '内存 ' + mem + 'MB 过高';
  } else if (mem > 1500) {
    el.className = 'mem-status warn';
    text.textContent = '内存 ' + mem + 'MB 偏高';
  } else {
    el.className = 'mem-status normal';
    text.textContent = '内存 ' + mem + 'MB';
  }
}

ipcRenderer.on('memory-status', function(event, statusList) {
  const tab = tabs.find(function(t) { return t.id === activeTabId; });
  if (!tab) return;
  const info = (statusList || []).find(function(s) { return s.id === tab.id; });
  updateMemStatus(info ? info.mem : 0);
});
```

## 5. 边界条件与异常处理

- **webview 未就绪**：启动时立即 `reportMemory()` 可能拿不到 `webContentsId`，`filter` 已过滤空值；状态先显示「内存 --」，60s 后自动更新。
- **激活标签不存在**：`tabs.find` 返回 undefined 时直接 return，不更新。
- **状态元素缺失**：`updateMemStatus` 里 `!el || !text` 提前返回。
- **阈值一致性**：状态等级 1500/2500 与后台重载（1500）、清缓存（2500）阈值一致，展示与实际行为对齐。
- **多标签**：只显示激活标签内存，后台标签照旧自动重载，不互相干扰。

## 6. 数据流路径

`game.html` `reportMemory()`（启动 + 每 60s）→ `memory-check` → 主进程计算各标签 `mem` → `memory-status` 回传 → `game.html` 取激活标签 → `updateMemStatus()` → 更新圆点颜色与文字。

## 7. 预期结果

- 工具栏实时（每 60s）显示激活标签内存占用与等级颜色（绿/橙/红）。
- 玩家看到橙色/红色时可自主点「刷新」冷启动释放内存。
- 不改变现有后台重载与清缓存逻辑，纯增量展示。
