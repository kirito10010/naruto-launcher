# 高分辨率界面缩放与托盘菜单任务计划

- [x] Task 1: 新增界面缩放配置与计算
    - 1.1: `DEFAULT_SETTINGS` 增加 `uiScale: 0`（0=自动）
    - 1.2: 新增 `readSystemDpi()`，同步读取注册表 AppliedDPI 并缓存，失败回退 96
    - 1.3: 新增 `getUiScale()`，按固定比例或 `max(DPI/96, 屏宽/1920)` 向上取预设档位
    - 1.4: `loadConfig` / `set-config` 对 `uiScale` 做数值校验

- [x] Task 2: 启动器与账号窗口缩放
    - 2.1: 新增 `applyUiScaleToWindow(win, baseW, baseH)`，设置 zoomFactor 与内容尺寸，并按工作区高度回退
    - 2.2: 启动器创建时按 `360×640×scale` 计算窗口尺寸并应用缩放
    - 2.3: 账号管理窗口创建后应用 `360×500` 缩放
    - 2.4: 设置变更时对已打开的启动器/账号窗口重新应用

- [x] Task 3: 设置面板新增"界面缩放"
    - 3.1: 在"性能模式"下方加入下拉（自动 / 100% / 125% / 150% / 200%）
    - 3.2: 新增 `changeUiScale()` 发送 `set-ui-scale`
    - 3.3: 新增 `ui-scale-state` 回填，并在窗口加载时下发当前值

- [x] Task 4: 托盘菜单改为自绘窗口
    - 4.1: 把原退出逻辑抽成 `quitFromTray()`
    - 4.2: 新增 `buildTrayMenuHtml()`，按当前主题生成三项菜单与分割线
    - 4.3: 新增 `showTrayMenu()` / `closeTrayMenu()`，按 `getUiScale()` 放大并按任务栏位置定位
    - 4.4: 菜单窗口 blur、Esc、点击项后关闭
    - 4.5: 新增 `tray-menu-action` / `tray-menu-close` IPC，校验 sender
    - 4.6: 移除 `tray.setContextMenu`，改为右键弹出；左键仍显示启动器

- [x] Task 5: 验证
    - 5.1: `node --check main.js`
    - 5.2: 用临时 userData 分别以 uiScale=1 / 1.5 启动，确认窗口尺寸与缩放变化
    - 5.3: 单独渲染托盘菜单 HTML 截图，确认字号、间距、主题
    - 5.4: 确认游戏窗口创建参数未变
    - 5.5: 清理临时文件
