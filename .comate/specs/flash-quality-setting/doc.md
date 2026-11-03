# Flash 画质设置（低 / 中 / 高）

## 需求场景

游戏内右键 Flash 画面可以打开「品质」菜单，手动选择低 / 中 / 高。调低后角色、场景贴图的抗锯齿与平滑度明显下降，但更省性能。用户希望把这项设置搬到启动器里，一次设置好，之后所有新开的游戏窗口 / 标签直接使用，不用每次进游戏手动调。

## 处理逻辑

1. 启动器设置面板新增「游戏画面」下拉框：高（默认）/ 中 / 低，写入 `config.flashQuality`。
2. 新开游戏窗口时，主进程把 `flashQuality` 随 `game-info` 下发给 `game.html`。
3. `game.html` 创建 webview 时按画质挂载对应的 preload：
   - `high`：不挂 preload，使用 Flash 默认画质。
   - `medium`：`flash-quality-medium-preload.js`
   - `low`：`flash-quality-low-preload.js`
4. preload 在页面脚本执行前 patch `Element.prototype.innerHTML / outerHTML / setAttribute`、`Document.prototype.write / writeln`、`insertAdjacentHTML`，把 swfobject / 页面写入的 `quality="high"` 或 `<param name="quality" value="high">` 改成目标值。
5. 主进程在 `did-attach-webview` 时再通过 CDP（`Page.addScriptToEvaluateOnNewDocument`）对 guest 注入同一段 patch，覆盖 QQ 游戏大厅入口把游戏放在 iframe 里的情况。为避免安全风险，不开启 `nodeIntegrationInSubFrames`。
6. 运行时切标签 / 失焦仍沿用原有策略：活跃标签使用用户配置的画质，后台标签固定 `low`；`wmode` 与画质解耦，活跃标签始终 `direct`，后台标签 `opaque`。
7. 修改设置后向已打开的游戏窗口广播 `flash-quality-update`：新标签立即使用新画质，当前活跃标签尝试运行时改属性。

## 架构与技术方案

- 画质必须在 Flash embed 创建前确定，挂载后再改属性不保证生效，因此核心手段是 preload / CDP 的「创建前注入」。
- 已有工程是 Electron 11 + `<webview>`，guest 渲染进程默认 `contextIsolation: false`，preload 可以直接 patch DOM 原型。
- CDP 注入用于补足 iframe 场景；Electron 11 未开启 site isolation，页面级注入可覆盖同进程 iframe。
- 画质值统一走 `normalizeFlashQuality`（主进程）与 `normalizeFlashQuality`（game.html），非法值回退 `high`。

## 受影响文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `main.js` | 修改 | 移除强制 high；设置面板新增「游戏画面」；新增设置 IPC；`did-attach-webview` CDP 注入；下发 `flashQuality`；HELP 文案 |
| `game.html` | 修改 | 新增 `flashQuality` 全局；创建 webview 挂 preload；`applyFlashQuality` 支持 medium 且 wmode 与画质解耦；活跃标签使用配置画质；监听 `flash-quality-update` |
| `flash-quality-low-preload.js` | 新增/完善 | 低画质注入补丁 |
| `flash-quality-medium-preload.js` | 新增 | 中画质注入补丁 |
| `package.json` | 修改 | `build.files` 加入两个 preload |

## 实现细节

### preload patch（low / medium 仅 QUALITY 不同）

```js
(function () {
  var QUALITY = 'low';
  function fixHtml(html) {
    if (typeof html !== 'string' || !/quality/i.test(html)) return html;
    html = html.replace(/quality\s*=\s*"(?:low|autolow|autohigh|medium|high|best)"/gi, 'quality="' + QUALITY + '"');
    html = html.replace(/quality\s*=\s*'(?:low|autolow|autohigh|medium|high|best)'/gi, "quality='" + QUALITY + "'");
    html = html.replace(/(<param\s+name=["']quality["']\s+value=["'])(?:low|autolow|autohigh|medium|high|best)(["'])/gi, '$1' + QUALITY + '$2');
    return html;
  }
  // patch innerHTML / outerHTML / setAttribute / write / writeln / insertAdjacentHTML
})();
```

### game.html 创建 webview

```js
const qualityPreload = flashQuality === 'low' ? 'flash-quality-low-preload.js'
  : (flashQuality === 'medium' ? 'flash-quality-medium-preload.js' : '');
if (qualityPreload) {
  webview.setAttribute('preload', new URL(qualityPreload, document.baseURI).href);
}
```

### 运行时画质

```js
function applyFlashQuality(webview, quality, active) {
  const wmode = active ? 'direct' : 'opaque';
  const q = (quality === 'low' || quality === 'medium') ? quality : 'high';
  ...
}
```

## 边界与异常

- `flashQuality` 非法值 → `high`。
- preload 文件缺失 / 加载失败 → 不挂 preload，Flash 按页面默认画质运行，不影响启动。
- CDP attach 失败（例如 DevTools 已占用）→ 静默忽略，preload 仍然生效。
- 修改设置不影响已存在的标签，只对新标签 / 新窗口生效；当前活跃标签尽力运行时刷新。
- 后台标签始终低画质，避免多开吃性能；窗口失焦整窗降为低，恢复聚焦后活跃标签回到配置画质。
- 高画质不挂 preload，避免无意义 patch。

## 数据流

启动器设置 → `set-flash-quality` IPC → `config.flashQuality` → `saveConfig()` → 新窗口 `game-info.flashQuality` → `game.html` 全局变量 → webview `preload` / 主进程 CDP → Flash embed `quality` 参数。

## 预期结果

- 启动器设置面板可选择低 / 中 / 高，重启启动器后仍保留。
- 选低后新开游戏窗口，角色与场景抗锯齿明显降低，与游戏内右键品质设为「低」效果一致。
- 选高时行为与当前版本一致。
- 多标签 / 多窗口 / QQ游戏大厅入口均能生效。
