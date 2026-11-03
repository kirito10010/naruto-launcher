# Flash 默认版本回退到国际版 32（1.12.1 紧急修复）

## 问题

1.12.0 及以前默认使用「内置国内版 34.0.0.376」。部分玩家反馈用默认版本会卡在进游戏（国内 Flash 依赖 Flash Helper Service 后台组件，机器环境不一致）。

## 处理

1. 默认 Flash 改为 **内置国际版 32.0.0.344**（`flashChoice = 'bundled'`）。
2. 升级到 1.12.1 时**一次性强制重置**所有用户的 Flash 选择为国际版 32，包括之前手动选过国内版 34 的。
3. 重置只发生一次：配置里写 `flashMigrated = '1.12.1'`，之后（含 1.13.0）不再强制改用户的选项。
4. 想继续用国内版 34 的用户，在设置里重新选一次即可，之后不会被改回去。

## 实现位置

| 位置 | 改动 |
| --- | --- |
| `main.js` 常量区 | 新增 `FLASH_MIGRATION_ID = '1.12.1'`、`FLASH_DEFAULT_CHOICE = 'bundled'` |
| `getFlashPath()` | 启动早期直接读配置：`flashMigrated !== '1.12.1'` 时按国际版 32 解析 |
| `loadConfig()` | 迁移逻辑写入 `flashChoice` / `flashMigrated` 并落盘；配置损坏时也写标记，避免反复重置 |
| 配置默认值 | `flashChoice: 'bundled'`、`flashMigrated: ''` |
| 设置面板 | 下拉顺序改为国际版 32（默认）在前 |
| `HELP.flash` | 说明改写：国际版 32 为默认、国内版 34 的问题、1.12.1 一次性重置 |

## 验证

- 全新配置（无 config.json）：生成 `flashChoice=bundled`、`flashMigrated=1.12.1`。
- 已有配置 `flashChoice=system`（无标记）：启动后变为 `bundled`，写入 `flashMigrated=1.12.1`。
- 已迁移（标记存在）后再改选项：不会被再次强制。
- 打包：`release-v1.12.1\NarutoOnlineLauncher-Setup-1.12.1.exe`，asar 校验版本号与迁移逻辑均在。

## 注意

`FLASH_MIGRATION_ID` 不要再改。改成新版本号会导致下次升级时又强制重置一遍。
