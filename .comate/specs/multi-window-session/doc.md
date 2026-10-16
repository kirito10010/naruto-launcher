# 多窗口登录串号问题 · 根因与修改方案

> 现象：用托盘「新建游戏窗口」开两个窗口，在窗口 A 登录后，窗口 B 也自动变成同一个账号，无法各登各的。
> 目标：不同窗口 / 不同标签能独立登录不同账号；且**不影响游戏流畅性**。

---

## 一、根因（已定位）

会话隔离靠 `<webview>` 的 `partition` 属性。`game.html` 的取法：

```js
// game.html:812
function getPartition(tab) {
  // diskCache 开启时用持久化分区（稳定索引命名…）
  if (diskCache) return 'persist:game-' + tab.index;
  return 'tab-' + tab.id;
}
```

而 `tab.index` 是**窗口内**的序号：

```js
// game.html addTab()
index: tabs.length + 1          // 每个窗口各自从 1 开始
// removeTab() 里还会重新编号 t.index = i + 1
```

每个游戏窗口是一个独立渲染进程，各有自己的 `tabs` 数组。于是：

| | 窗口 A | 窗口 B |
|---|---|---|
| 第 1 个标签 | `persist:game-1` | `persist:game-1` ← **同一个分区** |
| 第 2 个标签 | `persist:game-2` | `persist:game-2` ← 同一个分区 |

**两个窗口的第 1 个标签用了同一个 partition → 同一份 Cookie / localStorage → 同一个登录态。** 这就是"登录 A 窗口、B 窗口自动登录"的原因。

### 附带发现（同一处的两个隐患）

1. **重新编号会改分区名**：`removeTab()` 会把剩余标签重新编号，但分区的名字来自 `tab.index`。例如关掉标签 1 后，原标签 2 的 `index` 从 2 变成 1 —— 它下次刷新时会用 `persist:game-1`（原本是标签 1 的会话），登录态被换掉。
2. **主进程里其实有一份"正确写法"但已废弃**：`main.js:2284` 的 BrowserView 旧路径用的是
   `persist:qq-${qq}` 或 `persist:game-session-${win.id}-${tabIndex}`（带窗口维度）。
   但该路径的入口 `createAccountWindow()` **全项目没有任何调用点**，属死代码；现在真正在跑的是 `game.html` 的 webview 路径。

> 结论：**只需修 `game.html` 的分区命名**，让它带上"窗口"维度（并在已知账号时按账号固定）。

---

## 二、修改方案

### 2.1 分区命名规则（新）

```
已知账号(从账号管理启动) → persist:qq-<QQ>
未知账号(手动登录)       → persist:game-<窗口槽位*100 + 标签序号>
```

- **窗口槽位（windowSlot）**：由主进程按窗口创建顺序分配（1、2、3…，本次运行内单调递增），随 `game-info` 下发。
- 窗口 1 的第 1、2 个标签 → `persist:game-1`、`persist:game-2` —— **与现在完全一致（老用户登录态不丢）**。
- 窗口 2 的第 1 个标签 → `persist:game-101` —— 与窗口 1 不再撞车。
- 每个窗口最多 100 个标签（实际远达不到），用 `*100` 分块，简单且不重叠。

### 2.2 分区在"标签创建时"定好，之后不再变

把分区算好后存到标签对象上（`tab._partition`），`createWebview()` 直接用它。这样 `removeTab()` 的重新编号**不会再影响分区**，顺带修掉上面隐患 1。

> **实现时补强（比原设计更稳）**：标签不再用 `tab.index` 参与分区命名，改为一个**窗口内独立分配的空闲槽位** `tab._tabSlot`（`allocTabSlot()` 取最小空闲号，`removeTab` 时 `freeTabSlot()` 释放）。
> 原因：仅"创建时算一次"还不够——关掉标签 1 后，存活标签 2 的 `index` 会变成 1，此时新增的标签会拿到 `index = 2`，与存活标签 2 的分区**撞车**。用空闲槽位可保证任意时刻存活标签的分区互不相同。

### 2.3 具体改动

**`main.js`**
```js
let gameWindowSlotCounter = 0;      // 本次运行内的窗口槽位（1 起）

// createGameWindow() 内：
const windowSlot = ++gameWindowSlotCounter;
// did-finish-load 的 game-info 里增加：
win.webContents.send('game-info', { ..., windowSlot });
```

**`game.html`**
```js
let windowSlot = 1;                 // 由 game-info 下发

// game-info 处理里：windowSlot = data.windowSlot || 1;  （在 addTab 之前）

// 新增：创建标签时算一次分区
function computePartition(tab, account) {
  if (!diskCache) return 'tab-' + tab.id;              // 不落盘：内存分区，天然互不影响
  const acc = account || tab._pendingAccount;
  if (acc && acc.qq) return 'persist:qq-' + acc.qq;    // 已知账号：按账号固定，跨启动稳定
  return 'persist:game-' + (((windowSlot - 1) * 100) + tab.index);
}

// addTab() 内：tab._partition = computePartition(tab, account);
// createWebview() 内：webview.setAttribute('partition', tab._partition);
// getPartition() 保留为兜底：return tab._partition || computePartition(tab);
```

### 2.4 为什么"不影响游戏流畅性"

- 分区名只在**创建标签时**算一次（一次字符串拼接），与帧率、渲染、网络完全无关。
- 不新增定时器、不新增轮询、不新增 IPC（`windowSlot` 随已有的 `game-info` 一起下发）。
- 分区数量与现在同量级（每个标签一个），不会额外增加磁盘或内存开销。

---

## 三、影响与兼容性

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 单窗口多标签 | `game-1, game-2, …` | **完全相同**（登录态不丢） |
| 多窗口（本次问题） | 两窗口都 `game-1` → 串号 | 窗口1 `game-1…`、窗口2 `game-101…` → 各自独立 ✅ |
| 从账号管理启动 | `game-<序号>` | `qq-<QQ>`（按账号固定，换窗口也认这个账号） |
| 关闭标签后重新编号 | 分区名被改 → 登录态错乱 | 分区名不变 ✅ |
| 关掉窗口再开新窗口 | 新窗口仍用 `game-1` | 新窗口拿下一个槽位（如 `game-201`），不复用旧会话 |

**需要你知道的两点**：

1. **账号管理启动的标签，分区名从 `game-<序号>` 变成 `qq-<QQ>`** → 首次使用需要重新登录一次，之后长期稳定。
2. **同一个 QQ 在两个窗口打开会共用会话**（因为按 QQ 命名）——这符合"一个账号一份登录态"的直觉；如果你需要"同一个 QQ 同时开两份互不影响的会话"，告诉我，我改成按 账号+窗口槽位 命名。

---

## 四、不做的事

- 不改动死代码 `createAccountWindow()` / `addTabToGameWindow()`（无调用点，改动无收益且有风险）。
- 不改 `browser.html`（4399 用默认会话即可，不涉及账号隔离）。

---

## 五、验收

1. 托盘「新建游戏窗口」开两个窗口，分别登录两个不同 QQ，互不干扰；重启后再按同样顺序开两个窗口，登录态各自保留。
2. 单窗口多标签行为与 1.0.0 一致（分区名不变）。
3. 关掉一个标签后再新建标签，已登录标签的登录态不受影响。
4. `node --check` 通过；打包 1.1.0 成功。
