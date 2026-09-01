# 极致流畅度调优（画质最低 + 非活跃标签冻结）

## 1. 需求场景与处理逻辑

**场景**：用户两种玩法——
1. 单开一个窗口。
2. 双开两个标签页，但一次只玩一个，很久才切换。

**痛点**：单开仍有不流畅感；双开时两个标签的 Flash 都在同时渲染，抢资源导致活跃标签卡顿。

**需求**：画质可降到最低，把流畅度拉到最高。

**处理逻辑**：
1. **画质最低**：激活标签 Flash 也从 `quality=high` 降为 `quality=low`（关闭抗锯齿，降低 CPU），保留 `wmode=direct`（GPU 直连）。
2. **非活跃标签冻结**：切换标签时，用 `setBackgroundThrottling` 把旧标签压到近乎暂停（帧率降到极低），新标签解除节流全速运行。这样双开时资源全部给当前玩的标签。

## 2. 架构与技术方案

- `applyFlashQuality`：激活分支 `quality` 改为 `low`。
- 新增 `set-tab-throttle` IPC：game.html 切换标签时上报 `{ webContentsId, throttled }`，主进程调用 `webContents.fromId(id).setBackgroundThrottling(throttled)`。
- 保留 webview `backgroundThrottling=no` 初始值；运行时对非活跃标签显式 `setBackgroundThrottling(true)` 覆盖。

## 3. 受影响文件

### 3.1 `d:\Project\Naruto Online\game.html`（修改）
- `applyFlashQuality` 激活分支 quality 改 low。
- `switchTab` 中对旧/新标签分别发送节流 IPC。
- 新增 `setTabThrottle(tab, throttled)` 辅助函数。
- 窗口 blur/focus 时同步节流状态（blur 全部节流，focus 恢复活跃标签）。

### 3.2 `d:\Project\Naruto Online\main.js`（修改）
- 新增 `set-tab-throttle` IPC 处理。

## 4. 实现细节

### 4.1 applyFlashQuality 激活分支画质最低

```js
} else {
  // 激活标签：画质最低 + GPU 直连，获得最佳流畅度
  js = '(function(){ var els = document.querySelectorAll("embed, object"); for (var i=0;i<els.length;i++){ try { els[i].setAttribute("quality", "low"); els[i].setAttribute("wmode", "direct"); } catch(e){} } })();';
}
```

### 4.2 setTabThrottle 辅助函数

```js
function setTabThrottle(tab, throttled) {
  if (!tab || !tab._webview) return;
  try {
    const id = tab._webview.getWebContentsId();
    if (id) ipcRenderer.send('set-tab-throttle', { webContentsId: id, throttled: !!throttled });
  } catch (e) {}
}
```

### 4.3 switchTab 节流切换

```js
if (prevTab && prevTab._webview) {
  ... // 原有 class/静音/quality 逻辑
  setTabThrottle(prevTab, true);   // 冻结旧标签
}
if (nextTab && nextTab._webview) {
  ... // 原有逻辑
  setTabThrottle(nextTab, false);  // 新标签全速
}
```

### 4.4 窗口 blur/focus

```js
ipcRenderer.on('window-blur', () => {
  ... // 原有逻辑
  tabs.forEach(tab => { if (tab.id !== activeTabId) setTabThrottle(tab, true); });
});
ipcRenderer.on('window-focus', () => {
  ... // 原有逻辑
  tabs.forEach(tab => { setTabThrottle(tab, tab.id !== activeTabId); });
});
```

### 4.5 main.js set-tab-throttle

```js
ipcMain.on('set-tab-throttle', (event, data) => {
  try {
    if (!data || !data.webContentsId) return;
    const wc = webContents.fromId(data.webContentsId);
    if (wc && !wc.isDestroyed()) {
      wc.setBackgroundThrottling(!!data.throttled);
    }
  } catch (e) {}
});
```

## 5. 边界条件与异常处理

- **白屏风险**：节流不隐藏表面，只降帧率，不会触发之前的白屏 bug。
- **切回标签**：解除节流后一帧内恢复，无白屏。
- **webContents 已销毁**：fromId 返回 null 或 isDestroyed 时跳过。
- **单开**：唯一标签始终全速（activeTabId 一致），无副作用。

## 6. 数据流路径

切换标签 → `setTabThrottle` → `set-tab-throttle` IPC → 主进程 `setBackgroundThrottling` → 旧标签节流/新标签全速。

## 7. 预期结果

- 单开：画质最低，CPU 开销进一步下降，流畅度提升。
- 双开：只玩的那个标签独占资源，卡顿明显减少；切换后自动冻结旧标签。
