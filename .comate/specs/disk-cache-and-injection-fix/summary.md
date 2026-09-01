# 磁盘缓存实验 + 变速注入排除 GPU 进程 — 总结

## 改动内容

### main.js
1. `getAllRelevantChildPids()`：注入目标精简为 renderer/tab/plugin/ppapi plugin/pepper plugin，去掉 gpu、utility、pepper plugin broker。
2. `config` 默认值增加 `diskCache: true`；`loadConfig()` 对旧配置补默认。
3. `game-info` 下发 `diskCache`。

### game.html
1. 新增 `diskCache` 变量。
2. `getPartition(tab)` 按 diskCache 返回 `persist:game-{index}`（稳定索引，磁盘缓存+登录态跨启动复用）或 `tab-{id}`。
3. `createWebview` 调用改为 `getPartition(tab)`。
4. `game-info` 处理器在 addTab 前读取 diskCache。

## 验证结果

- `node --check main.js` 通过。
- `npm run build` 成功，exit code 0。
- 产物：`release-v3.2.0\NarutoOnlineLauncher-Setup-3.2.0.exe`。

## 待用户验证

1. 磁盘缓存：二次进入同一地图/场景，网络飙高是否下降（走硬盘而非网络）。
2. Flash 是否正常加载（persist 分区有破坏 Flash 的风险，若异常需回退）。
3. 变速功能是否正常（注入目标精简后）。

## 回退方式

若 persist 分区导致 Flash 加载异常，将 `%APPDATA%\naruto-online-launcher\config.json` 中 `"diskCache"` 改为 `false` 即回退到内存分区。
