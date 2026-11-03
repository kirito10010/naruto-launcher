# 账号卡片按钮与顶栏标签排版任务计划

- [x] Task 1: 账号操作按钮改为两行两列
    - 1.1: `.account-sidebar-actions` 改为 2 列 grid
    - 1.2: 缩小操作按钮尺寸与间距

- [x] Task 2: 顶栏标签收缩与关闭按钮
    - 2.1: `.tabs-container` / `.tabs-list` 增加 `flex: 1; min-width: 0`
    - 2.2: `.tab` 允许收缩并限制最小/最大宽度
    - 2.3: 标签名省略号显示，关闭按钮固定不收缩
    - 2.4: 标签增加 `title`

- [x] Task 3: 缩短标签区服后缀
    - 3.1: 新增 `shortZoneName`
    - 3.2: game-info 初始标签与 launch-account 新标签使用简名

- [x] Task 4: 校验
    - 4.1: game.html 内联脚本语法检查
    - 4.2: 检查按钮事件绑定未受影响
