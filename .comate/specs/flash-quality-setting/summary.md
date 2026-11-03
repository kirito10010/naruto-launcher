# Flash 画质设置完成总结

## 已完成

- 启动器设置面板新增「游戏画面」下拉框（高 / 中 / 低），写入 `config.flashQuality`，重启后保留。
- 移除 `loadConfig` 中强制画质为 `high` 的逻辑。
- 新增 `flash-quality-low-preload.js`、`flash-quality-medium-preload.js`，在 Flash embed 创建前改写 `quality`：
  - `innerHTML` / `outerHTML`
  - `setAttribute('quality')`
  - `document.write` / `writeln`
  - `insertAdjacentHTML`
- `game.html` 创建 webview 时按当前画质挂载 preload；`game-info` 下发画质。
- 主进程在 `did-attach-webview` 时通过 CDP `Page.addScriptToEvaluateOnNewDocument` 向 guest 注入同一份补丁，覆盖 QQ 游戏大厅入口的内嵌 iframe。
  - 已确认 `app_frame` 页面确实是 `#iframe_app` 内嵌游戏，因此默认入口必须依赖这条 CDP 兜底。
- 运行时策略：
  - 活跃标签使用启动器配置的画质。
  - 后台标签、窗口失焦时固定低画质。
  - `wmode` 与画质解耦：活跃标签 `direct`，后台标签 `opaque`。
- 修改设置后广播 `flash-quality-update`，新标签立即使用新画质，当前活跃标签尝试运行时切换。
- 新增设置项说明文案 `HELP.quality`。
- `package.json` 的 `build.files` 已加入两个 preload。

## 校验

- `node --check main.js` 通过。
- 两个 preload `node --check` 通过。
- `game.html` 内联脚本语法检查通过（1 个 script，0 失败）。
- 画质替换正则已单独验证：双引号 / 单引号 / param 三种写法均能正确替换。

## 需要手动验证

Flash 实际渲染效果只能进游戏确认：

1. 启动器设置 → 游戏画面选「低」→ 新开游戏窗口。
2. 对比角色、场景边缘锯齿，应与游戏内右键 → 品质 → 低一致。
3. 切到「中」「高」分别新开窗口确认。
4. 重点测试默认的 QQ游戏大厅入口（游戏在内嵌 iframe 中）。
5. 多标签切换：后台标签应自动降为低画质，切回后恢复配置画质。

## 说明

- 画质设置对**新开的窗口 / 标签**完全生效；已加载的旧标签可能保持原画质。
- 未打包，未改版本号。
