# 喵问答抓包模式实施任务

- [x] Task 1: 新建 miao-export.js 解析层
    - 1.1: 复用 export.js 的 extractGameStream / frames / dec / pb
    - 1.2: parseQuestion() 解析题号、题干、4 选项、配图 ID、排除项下标
    - 1.3: 收集 199684 响应题目与 199685 推送题目，按题号排序去重
    - 1.4: 收集上行 199684 的作答下标与下行 f5 对错标志，按下标配对
    - 1.5: 组装 answer / myChoice / bonusRemoved 字段

- [x] Task 2: 配图提取
    - 2.1: 定位本次会话的 http-*.jsonl（以 netlog 创建时间为基准）
    - 2.2: 解析 jsonl，建立 knowledgeTest 图片 requestId → url 映射
    - 2.3: 从 body 事件还原 base64 图片字节
    - 2.4: 响应体缺失时按 URL 直接下载（5 秒超时）
    - 2.5: 保存为 images/<两位题号>_<图片ID>.<ext> 并回填相对路径

- [x] Task 3: 导出流程
    - 3.1: runMiaoExport() 等待主进程退出并读取 netlog
    - 3.2: 创建 桌面/火影题库/喵问答_<时间>/ 与 images/
    - 3.3: 写入 questions.json 并 showItemInFolder
    - 3.4: 桌面不可写时回退到 userData/火影题库

- [x] Task 4: 接入启动器
    - 4.1: main.js 顶部新增 --export-miao 子进程分支
    - 4.2: normalizeCaptureMode 与 CAPTURE_MODE 支持 miao 和 --capture-miao
    - 4.3: 设置面板下拉框新增「题库抓包（喵问答）」
    - 4.4: HELP.capture 增加喵问答说明段
    - 4.5: set-capture-mode 中文标签增加 miao
    - 4.6: before-quit 增加 miao 分支 spawn 导出子进程
    - 4.7: capture.initCapture 在 full 或 miao 时启用

- [x] Task 5: 版本与打包
    - 5.1: package.json 版本 1.9.0、输出 release-v1.9.0、files 加 miao-export.js
    - 5.2: 用历史抓包做离线自测（parseMiao 输出 20 题 + 10082.png）
    - 5.3: 构建 1.9.0 安装包并校验 asar 内含 miao-export.js
    - 5.4: 输出 1.9.0 更新说明
