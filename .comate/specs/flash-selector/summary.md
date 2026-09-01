# Flash 版本选择器 — 总结

## 改动内容

### main.js
1. `config` 增加 `flashChoice: 'bundled'` 默认值；`loadConfig` 补默认。
2. `getFlashPath()` 按 `flashChoice` 分支：`bundled` 优先内置 32.0.0.344，`system` 优先系统国内版 34.0.0.380，均带兜底（缺失时回退）。
3. 新增 `set-flash-choice` IPC：保存配置并弹窗提示重启生效。
4. 启动器 HTML 增加 Flash 下拉选择器（内置国际版 / 系统国内版），`did-finish-load` 下发当前选择。

## 验证结果

- `node --check main.js` 通过。
- `npm run build` 成功（exit code 0）。
- 产物：`release-v3.2.0\NarutoOnlineLauncher-Setup-3.2.0.exe`。

## 待用户验证

1. 启动器底部出现「Flash 版本」下拉框。
2. 切到「系统国内版 34.0.0.380」→ 弹窗提示重启 → 重启后游戏用国内版 Flash 加载，流畅度是否进一步接近 360。
3. 切回「内置国际版」能否正常回退。

## 说明

- NPAPI 版不可用（Chromium 87 不支持），故选择器只提供两个 PPAPI 版本。
- 64 位 Electron 使用 `C:\Windows\System32\Macromed\Flash\pepflashplayer64_34_0_0_380.dll`。
