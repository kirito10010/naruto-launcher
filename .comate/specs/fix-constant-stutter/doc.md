# 修复游戏持续卡顿（负优化），恢复绝对流畅

## 1. 需求场景与处理逻辑

**场景**：游戏时时刻刻都在卡顿，出现负优化。用户要求绝对流畅。

**排查结论**（结合 config.json 实测 stretchMode=false、lastSpeed=1）：
- 非拉伸定时器、非变速注入导致。
- 主因是三个长期存在的"优化"开关/写法在拖慢 Flash：

1. `CanvasOopRasterization`（main.js:886）——实验性 flag，把 canvas 光栅化搬到独立进程，对 PPAPI Flash 是纯负优化。
2. `wmode=opaque` 强加在**激活标签**上（game.html `applyFlashQuality`）——opaque 让 Flash 放弃 GPU 直连、走软件合成；它只对后台/隐藏标签的 z-index 分层是必需的，激活标签应该用默认快模式。
3. 拉伸模式 `doStretch` 定时器每秒强制重设 `transform`，数值未变也触发重绘（潜在卡点）。

**处理逻辑**：
- 移除 `CanvasOopRasterization`。
- 激活标签不再强制 `wmode=opaque`（仅后台标签保留 opaque）。
- `doStretch` 只在缩放值变化时才重设 transform。

## 2. 架构与技术方案

- 主进程命令行开关（main.js 866-887）去掉 `enable-features=CanvasOopRasterization`。
- `applyFlashQuality(webview, quality)`（game.html:897）按 quality 分支：`low`（后台）设 `wmode=opaque`，`high`（激活）只设 `quality` 并 `removeAttribute("wmode")`。
- `STRETCH_ENABLE_JS` 的 `doStretch` 增加缓存比较，scale 未变则跳过。

## 3. 受影响文件

### 3.1 `d:\Project\Naruto Online\main.js`（修改）
- 删除 `app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');`（main.js:886）。

### 3.2 `d:\Project\Naruto Online\game.html`（修改）
- 修改 `applyFlashQuality()`（game.html:897）。
- 修改 `STRETCH_ENABLE_JS` 的 `doStretch`（game.html:770-800 附近）。

## 4. 实现细节

### 4.1 移除 CanvasOopRasterization

删除：
```js
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');
```

### 4.2 applyFlashQuality 分支化

```js
function applyFlashQuality(webview, quality) {
  if (!webview) return;
  let js;
  if (quality === 'low') {
    // 后台/隐藏标签：需要 opaque 参与 z-index 分层
    js = '(function(){ var els = document.querySelectorAll("embed, object"); for (var i=0;i<els.length;i++){ try { els[i].setAttribute("quality", "low"); els[i].setAttribute("wmode", "opaque"); } catch(e){} } })();';
  } else {
    // 激活标签：不强制 wmode，保持默认（GPU 直连）以获得最佳流畅度
    js = '(function(){ var els = document.querySelectorAll("embed, object"); for (var i=0;i<els.length;i++){ try { els[i].setAttribute("quality", "high"); els[i].removeAttribute("wmode"); } catch(e){} } })();';
  }
  try {
    webview.executeJavaScript(js).catch(function() {});
  } catch (e) {}
}
```

### 4.3 doStretch 跳过无变化

在 `doStretch` 内增加缓存比较：

```js
'  function doStretch() {',
...
'    var key = sx.toFixed(4) + "x" + sy.toFixed(4);',
'    if (el.__narutoLastScale === key) return;',
'    el.__narutoLastScale = key;',
'    el.style.transform = "scale(" + sx + "," + sy + ")";',
'  }',
```

## 5. 边界条件与异常处理

- **单标签（主场景）**：激活标签不再被 opaque 拖慢，直接受益。
- **多标签**：后台标签仍 opaque 保证 z-index 分层不白屏；切到激活时移除 wmode 恢复快模式。
- **拉伸模式关闭时**：`doStretch` 逻辑不执行，无影响。
- **Flash 已加载后 removeAttribute 可能不立即生效**：属尽力而为，不影响正确性。

## 6. 数据流路径

无新数据流，仅调整主进程开关与渲染层 Flash 属性设置。

## 7. 预期结果

- 激活标签 Flash 恢复 GPU 直连/默认渲染模式，配合移除 CanvasOopRasterization，持续卡顿明显缓解，达到更流畅的体验。
- 多标签白屏修复、后台画质降级等既有能力不受影响。
