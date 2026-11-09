# AGENTS.md — 给 AI 编码代理的必读约束

> 在本仓库做任何修改前，先读完本文件。这里的规则优先级高于你的默认习惯。

## 0. 这是二次开发（fork）项目，必须保留原作者署名

- 原作者：**lijin**
- 邮箱：a3025863517@163.com
- QQ：3025863517
- Q 群：489455643

本仓库是在原作者启动器基础上的二次开发版本。任何修改、二次开发或分发都**必须保留**以下署名信息，不得删除、淡化、改写或替换成其他人：

1. 游戏窗口「更多 → 关于」弹窗（`src/ui/game.html` 的 `openAbout()`）。
2. 启动器底部「关于」弹窗（`main.js` 中启动器模板的 `HELP.about`）。
3. `README.md` 的「作者与署名」。
4. `package.json` 的 `author` 字段。
5. 本文件 `AGENTS.md`。

如需增加新的贡献者，**追加**在原作者信息之后，而不是替换。不要把本项目描述成"完全原创"或删除原作者的仓库来源说明。

## 1. 硬性技术约束

- **不要升级 Electron / Chromium**：当前为 Electron 11.5.0 / Chromium 87，PPAPI Flash 依赖该版本；升级会导致 Flash 不可用。
- **不要引入原生模块或需要编译的依赖**：目标使用机只有 Electron，项目要求零额外运行时。
- **Flash 资源**：`resources/flash/` 下的 PPAPI DLL 由主进程通过命令行开关加载，不要改成系统 Flash。
- **更新源只能是 HTTPS**：明文 HTTP 会让 `latest.yml` 与安装包同时可被替换，破坏 electron-updater 的 sha512 校验。
- **不要重新加入腾讯云 COS 更新源**（已按要求移除）。更新源顺序：最高版本优先；版本相同优先缤纷云 S4；其余源按探测速度。
- **账号数据安全**：账号文件使用 Windows DPAPI 加密（`accounts.dat`）；清理逻辑只允许删除过期且无账号归属的分区数据，禁止无差别清空。
- **版本号**：以 `package.json` 的 `version` 为准；打包输出目录为 `release-v<version>/`。发布由维护者手动执行，不要自动推送 git / 上传更新源。

## 2. 渲染与窗口不变量（改动前务必理解）

- 游戏画面逻辑视口由「页面缩放（webview.setZoomFactor）」控制，元素始终 100% 铺满窗口。
- 缩放倍率按 **1/8 步进向上取整**（`Math.ceil(raw * 8) / 8`），用于消除地图方块细黑线；不要改回原始倍率。
- webview 必须在加载真实页面前先挂 `about:blank`、设好缩放再 `loadURL`，否则 Flash 会按错误视口初始化。
- 逻辑视口不得超过所选渲染分辨率（防止超出游戏最大画面后出现黑边）。
- 窗口固定 16:9（工具栏 44px 参与高宽修正）；默认窗口约工作区 85%、最大 1728。
- 最大化 = 系统最大化（保留任务栏/工具栏）；全屏 = F11 / 菜单（隐藏工具栏）。两者不要混用。
- 老板键 F9（备用 Ctrl+Shift+B）通过 `globalShortcut` 实现；窗口透明度通过 `win.setOpacity`，范围 10%~100%。

## 3. 目录与职责

```
main.js                 主进程：窗口/工具栏、IPC、更新器接入、账号与加密、启动清理、抓包启动
src/ui/game.html        游戏窗口宿主页：标签/账号侧栏、更多抽屉、渲染缩放、快捷键、关于
src/ui/browser.html     非火影（4399 等）极简窗口
src/ui/*preload.js      Flash 画质（quality）改写
src/core/updater.js     多源更新：最高版本 → 缤纷云优先 → 其余按速度
src/core/online.js      在线人数上报
src/core/debug-console.js, url-tool.js, video-cache.js
src/capture/            CDP / net-log 抓包
src/export/             组织统计、全量、题库（忍者检测/喵问答）、商城特惠导出
resources/              flash / native / icons / videos
docs/数据解包说明.md     协议与字段说明（抓包/导出相关改动先读这个）
```

## 4. 修改与验证流程

1. 先定位相关代码，阅读现有实现与注释，不要凭猜测改。
2. 修改后至少运行：
   ```bash
   node --check main.js
   node -e "const fs=require('fs');const h=fs.readFileSync('src/ui/game.html','utf8');const m=h.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('ok')"
   ```
3. UI/渲染相关改动必须用 CDP 实测（`--remote-debugging-port` + 隔离 `userData`），覆盖：普通窗口、最大化、全屏、还原、分辨率切换、布局铺满、无接缝。
4. 抓包/导出相关改动，用现有抓包样本复跑导出（`electron . --export-shop 0` 等）核对 JSON/TXT 结果，不要只看代码。
5. 打包：`npm run build`，检查 `release-v<version>/` 产物与 `app.asar` 内包含最新代码。
6. 不要自动执行 git push、创建 GitHub Release 或上传 COS/缤纷云；这些由维护者手动完成。

## 5. 常见坑

- `force-device-scale-factor=1` 必须保留，否则高分屏会出现系统放大/尺寸错乱。
- `webview` 尺寸/缩放变化后需要重新应用缩放（`did-navigate`、`did-stop-loading`）。
- 页面滚动条会占掉视口宽度，guest 侧已注入隐藏滚动条 CSS，不要移除。
- 更多侧边栏的"点击外部关闭"判断使用 id `#moreSidebar`（不是 `.more-sidebar`）。
- 变速档位只保留 0.5/1/2/4/6/10；20x 已移除，旧配置会在加载时归到 10x。
- 渲染分辨率只保留 1920/1600/1440/1280；1024 已移除。
- 设置里的「界面缩放」已移除，固定跟随系统 DPI（`config.uiScale = 0`）。

## 6. 一旦发现署名被删除

如果发现任何署名/关于信息缺失，先恢复它，再继续其它改动；这是本项目的强制要求。
