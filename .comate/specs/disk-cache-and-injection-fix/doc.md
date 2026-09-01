# 磁盘缓存实验 + 变速注入排除 GPU 进程

## 1. 需求场景与处理逻辑

**背景**：实测 GPU 4~8%（硬件加速正常）、CPU 10~15%（均未跑满），进入战斗瞬间以太网飙高。结论：卡顿主因是**网络资源加载**（地图瓦片/战斗资源下载瞬间卡顿），而非算力不足。

**两项改动**：

### A. 磁盘缓存（针对网络加载卡顿）
当前 webview 用内存分区（`tab-{id}`），瓦片每次重开都重新联网下载。改为可持久化磁盘分区，瓦片落盘、二次进入走硬盘。

- 配置项 `diskCache`（默认 true）。
- 分区名用**稳定索引**（`persist:game-{index}`）而非时间戳，否则每次启动分区名都变、磁盘缓存无法复用。
- 风险：原注释指出 persist 分区可能破坏 Flash，需实测验证，若破坏则回退（`diskCache:false`）。

### B. 变速注入排除 GPU 进程
`getAllRelevantChildPids()` 当前把 GPU/utility/plugin broker 都纳入 DLL 注入目标，挂 GPU 进程计时函数是稳定性/卡顿隐患。改为只注入 Flash 游戏真正运行所在的 renderer/plugin 进程。

## 2. 架构与技术方案

- 磁盘缓存：`game.html` 的 `getPartition()` 按 `diskCache` 返回 `persist:game-{index}` 或 `tab-{id}`；`diskCache` 由主进程 config 经 `game-info` 下发。
- 注入范围：`main.js` 的 `getAllRelevantChildPids()` 精简 `relevantTypes`。

## 3. 受影响文件

### 3.1 `d:\Project\Naruto Online\main.js`（修改）
- `getAllRelevantChildPids()`：relevantTypes 去掉 `gpu`、`utility`、`pepper plugin broker`。
- `loadConfig()`：补默认 `config.diskCache = true`。
- `createGameWindow()` 的 `game-info` 下发增加 `diskCache`。

### 3.2 `d:\Project\Naruto Online\game.html`（修改）
- 新增 `let diskCache = true;`。
- `getPartition()` 改为接收 tab 对象并按 diskCache 返回分区。
- `createWebview()` 的调用改为 `getPartition(tab)`。
- `game-info` 处理器在 addTab 前读取 `diskCache`。

## 4. 实现细节

### 4.1 getAllRelevantChildPids 精简

```js
const relevantTypes = new Set([
  'renderer', 'tab', 'plugin', 'ppapi plugin', 'pepper plugin'
]);
```

### 4.2 loadConfig 补默认值

```js
if (config.diskCache === undefined) config.diskCache = true;
```

### 4.3 game-info 下发 diskCache

```js
win.webContents.send('game-info', {
  game: gameInfo,
  accounts: accounts,
  account: account,
  diskCache: config.diskCache !== false
});
```

### 4.4 getPartition 与调用改造

```js
function getPartition(tab) {
  if (diskCache) return 'persist:game-' + tab.index;
  return 'tab-' + tab.id;
}
```

调用处：`webview.setAttribute('partition', getPartition(tab));`

### 4.5 game-info 处理器

```js
ipcRenderer.on('game-info', (event, data) => {
  diskCache = (data.diskCache !== false);
  currentGame = data.game;
  ...
  addTab('窗口1', initialAccount);
});
```

## 5. 边界条件与异常处理

- **persist 破坏 Flash**：若实测 Flash 加载异常，将 config.json 中 `diskCache` 置 `false` 即回退到内存分区（我会提供回退方式）。
- **稳定分区名**：`persist:game-{index}` 跨启动复用，登录态也会保留（可能表现为自动登录），属预期附带效果。
- **多标签**：每个标签索引独立分区，互不干扰。
- **变速未启用时**：注入改动无行为变化（lastSpeed=1 不注入），不影响现有功能。

## 6. 数据流路径

`config.json` → `loadConfig()` 补默认 → `game-info` 下发 `diskCache` → `getPartition()` 决定 `persist:` 前缀 → webview 用磁盘分区缓存瓦片。

## 7. 预期结果

- 二次进入同一地图/场景时瓦片走磁盘缓存，网络飙高/加载卡顿减少。
- 变速时不再向 GPU 进程注入，降低卡顿与崩溃风险。
- 游戏固有低帧率抖动不受影响（引擎层面）。
