# 抓包双模式实施 任务计划

- [x] Task 1: main.js 抓包模式三态化
    - 1.1: 新增 `normalizeCaptureMode(v)`（`off`/`stats`/`full`；兼容老 `captureEnabled: true` → `stats`）
    - 1.2: `CAPTURE_MODE` 计算：`--capture-full` → full；`--capture-traffic` / `NARUTO_CAPTURE=1` → stats；否则读 `EARLY_CONFIG.captureMode`
    - 1.3: net-log 开关改为 `CAPTURE_MODE !== 'off'` 时启用（两模式共用）
    - 1.4: CDP 初始化改为仅 `CAPTURE_MODE === 'full'` 时 `capture.initCapture`（加 `// [全量抓包]` 标记）
    - 1.5: `config` 增加 `captureMode`（默认 `off`）

- [x] Task 2: main.js 全量抓包子进程与退出分支
    - 2.1: 新增 `--dump-capture <pid>` 子进程入口（置于单实例锁之前，加 `// [全量抓包]` 标记）
    - 2.2: `before-quit` 按模式分派：`stats` → spawn `--export`；`full` → spawn `--dump-capture`
    - 2.3: IPC `set-capture`（布尔）改为 `set-capture-mode`（字符串），存 `config.captureMode` 并提示重启

- [x] Task 3: 新增 capture-dump.js（全量抓包专属）
    - 3.1: 等待主进程退出（复用 export.js 的 pid 等待思路）
    - 3.2: 从 `userData/captures` 收集本次会话文件（最新 `netlog-*.json` + mtime 不早于它的 `http-*.jsonl`）
    - 3.3: 复制到 `桌面/火影全量抓包/<yyyy-MM-dd_HHmmss>/`，写 `说明.txt`（文件说明 + 体积 + 分析提示）
    - 3.4: `shell.openPath` 打开目录；导出 `{ runDump }`

- [x] Task 4: 设置面板 UI 改为三选一
    - 4.1: 「抓包模式」开关 → 下拉三选一（关闭 / 组织统计（生成 Excel）/ 全量抓包（导出原始文件））
    - 4.2: 状态下发改为 `capture-mode-state`；`toggleCapture` 改为 `changeCaptureMode`
    - 4.3: 说明区标题改为「组织统计抓包说明」，并新增「全量抓包」一行说明

- [x] Task 5: package.json 打包清单
    - 5.1: `build.files` 增加 `"capture-dump.js"`

- [x] Task 6: 校验与打包
    - 6.1: `node --check` 全部 JS（含新增 capture-dump.js）+ game.html/browser.html 内联脚本
    - 6.2: 本地实测：三选一 UI 正常；`--dump-capture` 子进程能产出目录与说明.txt；组织统计模式下不再生成 jsonl
    - 6.3: 打包 1.2.0，确认 asar 内含 `capture-dump.js`，输出简短更新说明
