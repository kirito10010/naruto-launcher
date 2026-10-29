# 新增「题库抓包（忍者检测）」模式，导出题目 JSON

- [x] Task 1: export.js 补充内部工具导出
    - 1.1: `module.exports` 追加 `waitForNetlog`、`frames`、`dec`、`pb`（供题库解析复用，不改动任何现有逻辑）

- [x] Task 2: 新增 quiz-export.js：解析忍者检测题目并导出 JSON
    - 2.1: `parseQuiz(rx, tx)`：从 rx 的 `251905.field2` / `251906.field3` 取题目对象（题面 + 4 个选项）
    - 2.2: `parseQuiz` 收集 rx `251906.field2` 的对错标志与 tx `251906` 的 `{1:题号, 2:选项下标}`，按出现顺序配对
    - 2.3: 生成记录 `{ question, options, answer }`：答对时 `answer = options[选项下标]`，答错 / 无标志 / 越界时为 `""`
    - 2.4: 按题面去重（优先保留有 `answer` 的记录）
    - 2.5: `runQuizExport({ mainPid })`：等主进程退出 → 取最新 netlog → 提取 11096 流 → 解析 → 写桌面 `火影题库/忍者检测_<yyyy-MM-dd_HHmmss>.json`（UTF-8、2 空格缩进）→ `shell.showItemInFolder`
    - 2.6: 无数据时写出 `[]`，不抛错中断

- [x] Task 3: main.js 接入 quiz 抓包模式
    - 3.1: `normalizeCaptureMode()` 允许 `'quiz'`
    - 3.2: 设置面板「抓包模式」下拉新增 `题库抓包（忍者检测）`
    - 3.3: 抓包模式说明弹层补充题库抓包的步骤与输出说明
    - 3.4: `set-capture-mode` 的提示文案支持 `quiz`
    - 3.5: 顶部新增 `--export-quiz` 子进程分支（放在单实例锁之前，调用 `quiz-export.runQuizExport`，结束 `process.exit(0)`）
    - 3.6: `before-quit` 中 `CAPTURE_MODE === 'quiz'` 时拉起 `--export-quiz` 子进程（复用 `_spawnAppArgs`）

- [x] Task 4: package.json 打包白名单加入 quiz-export.js

- [x] Task 5: 验证
    - 5.1: `node --check main.js` / `node --check quiz-export.js` 通过
    - 5.2: 用仓库里已有的真实抓包 `火影全量抓包/2026-10-29_12-40-50/netlog-*.json` 直接跑 `parseQuiz`，核对：10 道题、每题 4 个选项、第 3 题「忍者修行系统多少级开放」的 `answer` 为空、其余 9 题 `answer` 为选项原文
    - 5.3: 开发模式启动确认设置面板多出「题库抓包（忍者检测）」选项、说明弹层内容正确
