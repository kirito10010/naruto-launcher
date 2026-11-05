# 标签栏模式持久化完成总结

## 已完成
- 新增 `config.tabDisplayMode`，默认 `sidebar`，可选 `sidebar` / `taskbar`。
- 用户通过「更多 → 标签栏」切换时写入全局配置并保存。
- 新开游戏窗口时由 `game-info` 下发保存值，加载时恢复顶栏/侧边模式，且不会重复写配置。
- 主进程对 `tabDisplayMode` 做白名单校验，非法值回退侧边。
- 旧的标签栏模式恢复逻辑不会影响账号侧边栏。

## 涉及文件
- `main.js`
- `game.html`

## 校验
- `main.js` 语法检查通过。
- `game.html` 内联脚本语法检查通过。
- asar 校验：默认配置、game-info 下发、持久化写入、加载恢复均存在。

## 产物
- 已重新打包 `release-v2.1.0/NarutoOnlineLauncher-Setup-2.1.0.exe` + blockmap + latest.yml。
- 如果已上传旧 2.1.0，exe / blockmap / latest.yml 需要用新包覆盖。
