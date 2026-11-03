# Flash 默认版本回退 · 完成总结（1.12.1）

- 默认 Flash 从国内版 34 改为国际版 32（`flashChoice='bundled'`）。
- 1.12.1 升级时一次性把所有用户重置为国际版 32（`flashMigrated='1.12.1'` 标记），含手动选过 34 的用户。
- 之后版本（1.13.0 起）不再强制修改用户选择；想用 34 的人自己切一次即可。
- 配置损坏时也写入迁移标记，避免每次启动重复重置。
- 设置面板下拉顺序、说明文案同步更新。
- 已打包：`release-v1.12.1\NarutoOnlineLauncher-Setup-1.12.1.exe`（67.47 MB）+ blockmap + latest.yml。
