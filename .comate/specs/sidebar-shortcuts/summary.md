# 侧边栏关闭与全局快捷键 · 完成总结

## 已完成

1. **点击外部关闭侧边栏**
   - 新增 `#sidebarBackdrop`（工具栏以下、窗口以内的透明层，`z-index: 800`，高于 webview、低于两个侧边栏）。
   - 侧边栏统一由 `setSidebar('tabs' | 'accounts' | null)` 控制：互斥、同步遮罩、同步 `gameAPI.toggleSidebar`。
   - 点遮罩、点工具栏、点窗口任意非侧边栏区域都会关闭；点两个开关按钮则切换。
   - 全屏时遮罩从窗口顶部开始（`body.fullscreen`）。

2. **快捷键（主进程拦截，焦点在 Flash 里也生效）**
   - `matchShortcut(input)` + `attachShortcuts(wc, win)`，同时挂在宿主页和每个 webview 客进程上。
   - 命中后 `preventDefault()`，再通过 `'shortcut'` 发给页面执行。

   | 快捷键 | 功能 |
   | --- | --- |
   | Alt+1~9 | 切到第 N 个标签 |
   | Ctrl+Tab / Ctrl+Shift+Tab | 下一个 / 上一个标签 |
   | Ctrl+T / Ctrl+W | 新建 / 关闭当前标签 |
   | Ctrl+Alt+W | 关闭窗口 |
   | Alt+L / Alt+A | 标签栏 / 账号栏 |
   | Alt+M / Alt+S | 静音 / 更多菜单 |
   | F5 / Ctrl+R | 刷新（保留登录） |
   | F11 | 全屏 |
   | Esc | 依次关闭：弹层 → 菜单 → 侧边栏 |

3. **页面分发**
   - `ipcRenderer.on('shortcut')` 分发到 `addTab/removeTab/switchTab/cycleTab/refreshPage/toggleMute/openMoreMenu/toggle-fullscreen`。
   - `Esc` 分层处理：帮助弹层 → 添加账号弹窗（等同点取消）→ 更多菜单 → 侧边栏。

4. **操作说明重写**
   - 拆成「鼠标操作」和「快捷键」两块，补全侧边栏点击外部关闭、Esc 行为。

## 验证

- `node --check main.js` 通过；关键接线检查全部命中。
- 启动冒烟测试通过（配置正常写入，无启动报错）。

## 待用户验证（Task 5）

- 侧边栏外点击 / 工具栏点击 / 游戏区点击能否关闭。
- 焦点在游戏（Flash）里时 Alt+1..9、Ctrl+Tab、F5、Alt+M、F11、Esc 是否生效。
- 多开时快捷键是否只作用于当前窗口。

以上需要在真实游戏里操作，代码层面已就绪。
