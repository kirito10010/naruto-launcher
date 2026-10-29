# 启动器设置面板：说明入口 + 说明弹层 + GPU 说明（main.js）

- [x] Task 1: 在启动器页面样式里新增「说明」按钮与说明弹层
    - 1.1: 新增 `.sel-row`（flex 行）与 `.sel-row .sel { flex:1; min-width:0 }`
    - 1.2: 新增 `.info-btn` 及 hover 态（沿用主题变量 `--accent` / `--hover` / `--accentText` / `--border`）
    - 1.3: 新增 `.help-mask` / `.help-card` / `.help-head` / `.help-body`（居中卡片、`min(320px,88vw)`、`max-height:70vh`、正文可滚）
    - 1.4: `.row` 加 `gap:10px`，`.row-label` 加 `flex:1; min-width:0`；给 `.sheet-mask` / `.sheet` 补显式 `z-index`（30 / 40），说明层用 50 / 60

- [x] Task 2: 在页面结构里加入说明入口与说明弹层
    - 2.1: Flash 版本下拉框包进 `.sel-row`，右侧加「说明」按钮，`onclick="openHelp('flash')"`
    - 2.2: 抓包模式下拉框包进 `.sel-row`，右侧加「说明」按钮，`onclick="openHelp('capture')"`
    - 2.3: 「强制启用 GPU」行加「说明」按钮，`onclick="openHelp('gpu')"`
    - 2.4: 在 `.sheet` 之后新增 `.help-mask` + `.help-card`（标题 + 关闭按钮 + 正文容器）

- [x] Task 3: 实现说明文案表与弹层开关逻辑
    - 3.1: 定义 `HELP` 文案表（`flash` / `capture` / `gpu`，各含 `title` 与 `html`，按 doc.md 第 4 节）
    - 3.2: 实现 `openHelp(key)`（填充标题与正文、加 `.open`）与 `closeHelp()`（去 `.open`）
    - 3.3: 绑定三种关闭方式：点遮罩、点关闭按钮、按 `Esc`

- [x] Task 4: 移除设置面板底部的两段抓包说明
    - 4.1: 删除「组织统计抓包说明」的 `sec-title` + `.guide` 块（内容已并入 `capture` 文案）
    - 4.2: 删除「全量抓包说明」的 `sec-title` + `.guide` 块

- [x] Task 5: 验证
    - 5.1: `node --check main.js` 通过
    - 5.2: 启动开发模式实测：两个下拉框与 GPU 行右侧都有「说明」按钮；分别点开弹层确认标题与内容正确；点遮罩 / 点关闭 / 按 `Esc` 均能关闭且不会误关设置面板；设置面板底部已无抓包说明
