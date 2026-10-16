# 多窗口登录串号修复 完成总结

## 结果

根因定位并修复：多窗口共用同一个会话分区导致"登录 A 窗口、B 窗口自动登录"。已打包 **1.1.0** 并实测验证。

## 根因

`game.html` 的 `getPartition()` 用 **窗口内序号** `tab.index` 拼分区名：

```js
return 'persist:game-' + tab.index;   // 每个窗口都从 1 开始
```

两个窗口的第 1 个标签都得到 `persist:game-1` → 同一份 Cookie/localStorage → 同一个登录态。

## 改动

### main.js
- 新增模块级 `gameWindowSlotCounter`（本次运行内单调递增，1 起）
- `createGameWindow()` 内 `const windowSlot = ++gameWindowSlotCounter;`
- `game-info` 负载新增 `windowSlot`

### game.html
- 新增 `let windowSlot = 1;`，在 `game-info` 处理里于 `addTab()` 之前赋值
- 新增 `computePartition(tab, account)`：
  - 不落盘 → `tab-<id>`（内存分区，天然隔离）
  - 已知账号 → `persist:qq-<QQ>`（按账号固定，换窗口/重启都认同一个账号）
  - 手动登录 → `persist:game-<((windowSlot-1)*100 + tab._tabSlot)>`
- **槽位分配（实现时补强）**：新增 `allocTabSlot()` / `freeTabSlot()`，取窗口内最小空闲槽位；`addTab()` 里把 `tab._tabSlot` 与 `tab._partition` 一次定好；`removeTab()` 释放槽位。
  > 仅"创建时算一次"不够：关掉标签 1 后存活标签 2 的 `index` 会变成 1，此时新增标签拿到 `index=2`，会与存活标签 2 撞分区。用空闲槽位保证任意时刻存活标签分区互不相同。
- `createWebview()` 改用 `tab._partition`；`getPartition()` 保留为兜底

### 未改动
- 死代码 `createAccountWindow()` / `addTabToGameWindow()`（全项目无调用点）
- `browser.html`（4399 用默认会话，不涉及账号隔离）

## 实测结果（Electron 内实测分区名）

| 场景 | 分区名 |
|------|--------|
| 窗口1（槽位1）初始 | `persist:game-1` ← **与改动前一致，老登录态不丢** |
| 窗口1 新增标签 | `persist:game-1`, `persist:game-2` |
| 窗口1 关掉第1个标签后 | `persist:game-2`（存活标签分区不变） |
| 窗口1 再新增标签 | `persist:game-2`, `persist:game-1`（用释放的空闲槽位，**不撞车**） |
| 窗口2（槽位2）初始 | `persist:game-101` ← **与窗口1 不再冲突** ✅ |
| 窗口1 从账号启动（qq=123456789） | `persist:qq-123456789` |

## 对流畅性的影响

**零运行时开销**：分区名只在创建标签时算一次字符串拼接，不新增定时器/轮询/IPC；分区数量与改动前同量级。

## 行为说明（已知）

- **同一窗口内槽位会被复用**：关掉某标签后再新增标签，会拿到刚释放的槽位，因此会回到该槽位此前的登录态。若希望"新标签一律全新会话"，把 `allocTabSlot()` 改成单调递增即可。
- **同一 QQ 在两个窗口打开会共用会话**（按 QQ 命名）。如需"同一 QQ 开两份互不影响的会话"，改成 `账号+窗口槽位` 命名即可。

## 打包

- `release-v1.1.0/NarutoOnlineLauncher-Setup-1.1.0.exe`（67.45 MB）
- exe 元数据 FileVersion=1.1.0 / ProductVersion=1.1.0.0
- asar 含 `windowSlot` / `computePartition` / `allocTabSlot` / `freeTabSlot` / `persist:qq-`
- `latest.yml` version=1.1.0
- 打包后运行正常（5 进程，启动器窗口标题「火影忍者启动器」）
