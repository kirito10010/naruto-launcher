# Flash 版本选择器（内置国际版 ↔ 系统国内版）

- [x] Task 1: 主进程增加 flashChoice 配置与路径分支
    - 1.1: 初始 config 与 loadConfig 增加 flashChoice 默认值
    - 1.2: getFlashPath 按 flashChoice 分支选择路径并带兜底

- [x] Task 2: 新增 set-flash-choice IPC 处理
    - 2.1: 保存 config.flashChoice 并弹窗提示重启

- [x] Task 3: 启动器 UI 增加 Flash 下拉选择器
    - 3.1: 启动器 HTML 加 select 与样式
    - 3.2: 脚本处理 change 与 flash-choice 回显
    - 3.3: did-finish-load 下发当前 flashChoice

- [x] Task 4: 验证语法并打包
    - 4.1: node --check 校验 main.js 语法
    - 4.2: 打包为 3.2.0 验证切换 Flash 生效
