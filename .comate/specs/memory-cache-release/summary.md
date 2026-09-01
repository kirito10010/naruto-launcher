# 激活标签内存超限时清缓存释放（不重载）— 总结

## 需求

玩家单开一个号长时间游玩，地图瓦片持续加载，内存只增不减导致卡顿/白屏。按用户选择，激活标签内存超过 2500MB 时**只清缓存、不重载**，避免中断游戏。

## 改动内容

### main.js（仅此一处）
1. 新增常量 `ACTIVE_MEM_CLEAR_THRESHOLD = 2500`、`CACHE_CLEAR_COOLDOWN = 3 * 60 * 1000`，以及 `lastCacheClear` 记录对象（webContentsId -> 上次清缓存时间戳）。
2. 修改 `ipcMain.on('memory-check', ...)`：在原有 1500MB 后台重载判断之外，追加 2500MB 清缓存分支，调用 `wc.session.clearCache()` 释放该标签内存分区的 HTTP 缓存，并用冷却时间限制频率（同一标签 3 分钟内只清一次）。

## 验证结果

- `node --check main.js` 通过，无语法错误。
- `npm run build`（electron-builder）成功，exit code 0。
- 产物：`release-v3.1.1\NarutoOnlineLauncher-Setup-3.1.1.exe`（含 `.blockmap`）。

## 待用户验证

实际长时间游玩观察：
1. 激活标签内存超过 2500MB 时，日志出现"已清理缓存（不重载）"；
2. 清理缓存后游戏不中断、不断线；
3. 长时间卡顿/白屏是否有缓解。

## 说明

`clearCache()` 只释放 Chromium 内存缓存里的地图瓦片，Flash 自己持有的位图内存放不掉；若效果仍不理想，再考虑"超限弹窗确认重载"作为补充手段。
