# 标签栏模式持久化

## 需求

游戏窗口的标签栏支持「侧边 / 顶栏」切换，但切换后下次打开又恢复侧边。需要把用户选择保存到全局配置，下次打开游戏窗口继续使用。

## 方案

- `config.tabDisplayMode` 默认 `'sidebar'`，可选 `'sidebar' | 'taskbar'`。
- `game.html` 的 `setTabDisplayMode(mode, persist)`：
  - 应用 UI；
  - `persist !== false` 时调用 `window.gameAPI.setConfig('tabDisplayMode', mode)` 写入主进程配置。
- 主进程 `set-config` 对 `tabDisplayMode` 做白名单校验，只接受 `taskbar`，否则回退 `sidebar`，然后保存。
- `game-info` 下发 `tabDisplayMode`；游戏窗口加载时调用 `setTabDisplayMode(saved, false)` 恢复，不回写配置。
- 用户通过「更多 → 标签栏」切换时正常持久化。

## 受影响文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `main.js` | 修改 | 默认配置、loadConfig 归一化、game-info 下发、set-config 校验 |
| `game.html` | 修改 | 切换时保存、加载时恢复 |

## 边界

- 配置缺失或非法值 → 侧边模式。
- 恢复时不会重复写配置。
- 仅影响游戏窗口的标签栏模式；账号侧边栏不受影响。

## 预期结果

- 切到顶栏后关闭启动器，下次打开游戏窗口仍是顶栏模式。
- 切回侧边后同样保留。
