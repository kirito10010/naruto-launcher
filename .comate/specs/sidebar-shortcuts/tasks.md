# 侧边栏关闭与快捷键 · 实施任务

- [x] Task 1: 侧边栏点击外部关闭
    - 1.1: 新增 #sidebarBackdrop（工具栏以下、窗口以内的透明层）与样式
    - 1.2: 统一 setSidebar('tabs' | 'accounts' | null)，两个侧边栏互斥并同步遮罩
    - 1.3: 遮罩点击关闭；document mousedown 捕获，点侧边栏和两个开关按钮以外区域也关闭
    - 1.4: 全屏模式下遮罩定位、工具栏点击正常

- [x] Task 2: 主进程快捷键拦截
    - 2.1: matchShortcut(input) 映射表（Alt+1..9、Ctrl+Tab、Ctrl+T/W、Alt+L/A/M/S、F5、F11、Esc）
    - 2.2: attachShortcuts(wc, win) 挂到 win.webContents 和每个 webview guest
    - 2.3: 命中后 preventDefault 并发送 'shortcut' 到页面，多窗口只影响当前窗口

- [x] Task 3: 页面快捷键分发
    - 3.1: ipcRenderer.on('shortcut') 分发到 addTab/removeTab/switchTab/刷新/静音/更多菜单
    - 3.2: next-tab / prev-tab / switch-tab:N 的顺序切换实现
    - 3.3: Esc 分层关闭：帮助弹层 → 更多菜单 → 侧边栏

- [x] Task 4: 操作说明更新
    - 4.1: 弹层拆成「鼠标操作」「快捷键」两块
    - 4.2: 补全侧边栏点击外部关闭、Esc 行为说明

- [ ] Task 5: 自测与收尾
    - 5.1: 开发模式验证：侧边栏外点击/工具栏点击/游戏区点击均能关闭
    - 5.2: 焦点在 Flash 内验证 Alt+1..9、Ctrl+Tab、F5、Alt+M、F11、Esc
    - 5.3: 多开窗口验证快捷键只作用于当前窗口
