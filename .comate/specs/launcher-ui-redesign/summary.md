# 启动器 UI 改版 + 图标更换 完成总结

## 结果

启动器完成整体 UI 改版：去掉 Electron 原生标题栏、自绘标题栏、清新配色、设置面板集中管理主题/Flash/抓包；应用图标换回用户指定的火影（木叶）图标。已打包 1.0.0 并验证通过。

## 各任务完成情况

| 任务 | 状态 | 说明 |
|------|------|------|
| Task 1 更换应用图标 | 完成 | Pillow LANCZOS 将 128×128 源图放大为 512×512 覆盖 `resources/icons/Naruto.png`（保留 alpha） |
| Task 2 统一主题数据源 | 完成 | `main.js` 顶部新增 `THEMES` / `THEME_ALIAS` / `normalizeTheme()`；`getThemeColors()` 改为派生；`loadConfig()` 旧值迁移 |
| Task 3 重写启动器窗口 | 完成 | `frame:false` + 自绘标题栏 + 全新主界面 + 设置面板 + 主题脚本 |
| Task 4 标题栏 IPC + 主题收口 | 完成 | 新增 `launcher-minimize` / `launcher-close`；`set-theme` 归一化 |
| Task 5 同步游戏窗口主题 | 完成 | `game.html` 的 `applyTheme()` 换为 5 套新 key（保留旧 key 兜底） |
| Task 6 校验与打包 | 完成 | `node --check` 通过；本地启动实测；打包 1.0.0 成功 |

## 主要改动

### 图标
- `resources/icons/Naruto.png`：128×128 → 512×512（Pillow LANCZOS，RGBA 保留透明）
- 打包图标、托盘图标、标题栏 logo 均复用该文件，`package.json` 无需改动

### 主题系统（单一数据源）
- 5 套主题：`mint`(薄荷，默认) / `sky`(天空) / `sakura`(樱花) / `amber`(暖阳) / `night`(暗夜)
- 旧 key 自动迁移：`light→mint`、`blue→sky`、`orange→amber`、`dark→night`（`normalizeTheme()`）
- `THEMES` 通过 `${JSON.stringify(THEMES)}` 注入启动器页面，前端 `applyTheme()` 只设置 CSS 变量
- 删除了死代码 `getThemeCSS()`（全项目无引用，游戏窗口实际走 `game.html` 自己的 `applyTheme`）

### 启动器窗口
- `frame:false`，窗口尺寸 360×640（按 dpr 缩放）
- 自绘标题栏（44px，`-webkit-app-region: drag`）：logo + 「火影忍者启动器」+ 最小化/关闭
- 主界面：游戏卡 ×2（火影 / 4399）+ 快捷胶囊按钮 ×2（QQ群 / 官网）+ 底栏（⚙设置 + 版本号）
- 设置面板：遮罩 + 底部上滑 sheet，含主题色卡网格、Flash 版本下拉、抓包开关（CSS 自定义开关）
- 关闭按钮沿用既有 `close→hide` 到托盘逻辑，行为与改造前一致

### IPC
- 新增 `launcher-minimize` → `launcherWindow.minimize()`
- 新增 `launcher-close` → `launcherWindow.close()`
- `set-theme` 先 `normalizeTheme()` 再保存/广播

## 验证记录

- `node --check main.js` → OK
- 本地启动（清空 `ELECTRON_RUN_AS_NODE` 后）无 stderr、进程稳定运行
- 屏幕截图确认：
  1. 无原生标题栏，自绘标题栏 + 清新薄荷界面渲染正常
  2. 点「设置」上滑面板正常，5 张主题色卡 / Flash 下拉 / 抓包开关均显示
  3. 配置中旧值 `"theme":"light"` 能正确迁移渲染为薄荷主题
- 打包产物 `release-v1.0.0/NarutoOnlineLauncher-Setup-1.0.0.exe`（约 81.2 MB）
- asar 内含 `火影忍者启动器` / `theme-card` / `launcher-minimize` / `launcher-close` / `sakura` / `sheetMask` 等新字符串
- `latest.yml` 已重新生成（version 1.0.0 + 新 sha512）
- exe 已内嵌图标（提取 32×32 成功）

## 偏差说明

- **`getThemeCSS()` 直接删除**（doc 原计划"重写"）：经全项目检索确认无任何调用点，属死代码，按"删除无用代码"原则移除，避免维护两份重复主题映射。
- 启动器窗口保持直角（未用透明窗口做圆角）：Electron 11 在 Windows 上透明无边框窗口不稳定，仅内部卡片/面板做圆角。

## 遗留 / 待确认

- 测试过程中鼠标点击误触发了「官方网站」按钮，在浏览器中打开了一个 `49.235.142.253/image-host` 标签页（用户自己的图床站点），非破坏性，可自行关闭。
- 启动器标题文字由「火影忍者Online启动器」改为「火影忍者启动器」（自绘标题栏更简洁）；如需保留原名可调整。
