# 性能最大化实验：解除帧率限制与后台节流

## 1. 需求场景与处理逻辑

**背景**：对比 360 大厅（CEF + NPAPI Flash）后，我们卡顿且 CPU/内存占用极低，说明游戏被"限帧/节流"，未全力运行。

**目标**：单窗口极限流畅。解除帧率锁与后台节流，激活标签 Flash 强制 GPU 直连。

**处理逻辑**：
1. 恢复 `disable-frame-rate-limit` + `disable-gpu-vsync`（解除帧率锁，高刷屏跑更高帧）。
2. 加 `disable-background-timer-throttling` + `disable-renderer-backgrounding` + `disable-backgrounding`（禁止后台节流）。
3. 游戏窗口 `backgroundThrottling: false`，webview `backgroundThrottling=no`。
4. 激活标签 Flash `wmode=direct`（强制 GPU 直连）。

## 2. 架构与技术方案

- 主进程命令行开关追加四项（main.js 877-886 附近）。
- `createGameWindow` webPreferences `backgroundThrottling` 改 `false`。
- webview 的 `webpreferences` 追加 `backgroundThrottling=no`。
- `applyFlashQuality` 激活分支改为 `wmode=direct`。

## 3. 受影响文件

### 3.1 `d:\Project\Naruto Online\main.js`（修改）
- 命令行开关追加 4 项。
- `createGameWindow` 的 `backgroundThrottling: true` → `false`。

### 3.2 `d:\Project\Naruto Online\game.html`（修改）
- webview `webpreferences` 追加 `backgroundThrottling=no`。
- `applyFlashQuality` 激活分支 `wmode=direct`。

## 4. 实现细节

### 4.1 命令行开关追加

```js
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding');
```

### 4.2 backgroundThrottling 改 false

```js
backgroundThrottling: false,
```

### 4.3 webview webpreferences

```js
webview.setAttribute('webpreferences', 'allowRunningInsecureContent=yes,webSecurity=no,nativeWindowOpen=no,backgroundThrottling=no');
```

### 4.4 applyFlashQuality 激活分支 wmode=direct

```js
js = '(function(){ var els = document.querySelectorAll("embed, object"); for (var i=0;i<els.length;i++){ try { els[i].setAttribute("quality", "high"); els[i].setAttribute("wmode", "direct"); } catch(e){} } })();';
```

## 5. 边界条件与异常处理

- **单窗口取向**：此配置牺牲多开的资源效率，换取单窗口流畅；若多开卡顿需回退。
- **屏幕撕裂**：解 vsync 后高帧率可能出现轻微撕裂，属预期权衡。
- **后台标签**：仍 opaque 参与分层，不受 wmode=direct 影响。

## 6. 数据流路径

无新数据流，仅调整命令行开关、webPreferences 与 Flash wmode。

## 7. 预期结果

- 游戏帧率不再被锁，CPU/GPU 利用率上升，持续卡顿明显缓解。
- 高刷屏（240Hz）能跑更高帧；单窗口流畅度提升。
