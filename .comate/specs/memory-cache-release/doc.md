# 激活标签内存超限时清缓存释放（不重载）

## 1. 需求场景与处理逻辑

**场景**：玩家单开一个号长时间游玩，地图瓦片（方形地图片段）持续加载，Chromium 内存缓存 + Flash 位图内存只增不减，激活标签内存一路上涨，最终导致卡顿甚至白屏。

**用户选择**：
- 处理方式：**只清缓存、不重载**（避免中断游戏）。
- 触发阈值：激活标签内存 > **2500MB**。

**处理逻辑**：
- 内存监控（已有，每 60s 上报一次）检测到某标签内存 > 2500MB 时，主进程直接对该标签的 session 调用 `clearCache()` 释放 HTTP 缓存，不触发 reload。
- 现有的 1500MB → 后台标签自动 reload 逻辑保持不变。

## 2. 架构与技术方案

- 复用 `memory-check` IPC（main.js:1654），`game.html` 已每 60s 上报各标签 `webContentsId`。
- `webContents.fromId(id).session.clearCache()` 可直接清空该 webview 分区（`tab-xxx`，内存分区）的 HTTP 缓存，释放地图瓦片在 Chromium 内存缓存中占用的内存。
- 纯主进程改动，`game.html` 无需修改（后台标签 reload 逻辑不受影响）。
- 加冷却时间（3 分钟/标签），避免内存长期超限时每 60s 反复清缓存导致瓦片反复重下载。

## 3. 受影响文件

### `d:\Project\Naruto Online\main.js`（修改）
- 在 `getMemoryMB` 之后新增常量 `ACTIVE_MEM_CLEAR_THRESHOLD = 2500`、`CACHE_CLEAR_COOLDOWN` 和 `lastCacheClear` 记录对象。
- 修改 `ipcMain.on('memory-check', ...)`（main.js:1654），在现有 1500MB 判断之外，追加 2500MB 清缓存分支。

## 4. 实现细节

### 4.1 新增常量与记录对象（getMemoryMB 之后）

```js
// 激活标签内存超过该值（MB）时清缓存释放，不重载
const ACTIVE_MEM_CLEAR_THRESHOLD = 2500;
// 清缓存冷却时间（毫秒），避免反复清理导致瓦片频繁重下载
const CACHE_CLEAR_COOLDOWN = 3 * 60 * 1000;
// 记录每个标签上次清缓存时间：webContentsId -> timestamp
const lastCacheClear = {};
```

### 4.2 修改 memory-check 处理器

```js
ipcMain.on('memory-check', (event, tabList) => {
  const highMem = [];
  for (const t of (tabList || [])) {
    try {
      if (!t || !t.webContentsId) continue;
      const wc = webContents.fromId(t.webContentsId);
      if (!wc || wc.isDestroyed()) continue;
      const mem = getMemoryMB(wc.getOSProcessId());
      if (mem > 1500) highMem.push({ id: t.id, mem });

      // 内存超过 2500MB：只清缓存不重载，避免中断游戏
      if (mem > ACTIVE_MEM_CLEAR_THRESHOLD) {
        const now = Date.now();
        const last = lastCacheClear[t.webContentsId] || 0;
        if (now - last > CACHE_CLEAR_COOLDOWN) {
          lastCacheClear[t.webContentsId] = now;
          wc.session.clearCache().then(function() {
            log('标签 ' + t.id + ' 内存 ' + mem + 'MB 超限，已清理缓存（不重载）');
          }).catch(function(err) {
            log('清理标签缓存失败: ' + err.message, 'WARN');
          });
        }
      }
    } catch (e) {}
  }
  if (highMem.length) {
    try { event.sender.send('memory-alert', highMem); } catch (e) {}
  }
});
```

## 5. 边界条件与异常处理

- **只清缓存不重载**：`clearCache()` 不触发页面重载，游戏不中断，但 Flash 自持的位图内存不会被释放（用户已接受此权衡）。
- **冷却时间**：同一标签 3 分钟内只清一次，防止长期超限时每 60s 反复清理。
- **webContents 已销毁**：`fromId` 返回 null 或 `isDestroyed()` 时跳过，已有判断。
- **clearCache 异常**：Promise catch 记录 WARN，不影响主流程。
- **内存分区**：`clearCache()` 清的是内存分区 HTTP 缓存，不影响登录 cookie（`clearCache()` 不动 cookies）。
- **后台标签**：1500MB 仍走原有 `memory-alert` → game.html 自动 reload；若同时 > 2500MB 会额外清一次缓存，冗余但无害。

## 6. 数据流路径

`game.html` 每 60s → `memory-check` → 主进程逐个取 `getOSProcessId()` → `getMemoryMB()` → 若 > 2500MB 且过冷却 → `wc.session.clearCache()` → 释放该标签内存缓存。

## 7. 预期结果

- 长时间单号游玩，激活标签内存超过 2500MB 时自动清理缓存，缓解内存上涨导致的卡顿/白屏。
- 游戏过程不中断（无 reload）。
- 后台标签 1500MB 自动重载、登录状态均不受影响。
