# 账号侧边栏卡片改版任务计划

- [x] Task 1: 重写侧边栏卡片样式（game.html）
    - 1.1: 替换 `.account-sidebar-list` / `.account-sidebar-item` 为块级卡片布局（圆角、边框、hover 高亮）
    - 1.2: 新增 `.account-sidebar-head` / `.account-sidebar-tag` / `.account-sidebar-status` 及三种状态颜色
    - 1.3: 把 2×2 图标网格改为单行文字按钮，常驻显示，"进入"用强调色
    - 1.4: 删除旧的 `.account-sidebar-zone` 区块样式和 hover 才显示 actions 的规则
    - 1.5: `.account-zone-select` 改为无边框标题样式

- [x] Task 2: 重写状态函数 `zoneCredStatus`
    - 2.1: 返回 `{ text, cls, title }`，文案缩短并去掉"凭证："前缀
    - 2.2: 区分未保存 / 已保存（约 24 小时）/ 有效 N 天或小时 / 已失效
    - 2.3: `title` 保留"上次续期：YYYY-MM-DD HH:mm"

- [x] Task 3: 重写卡片渲染 `renderAccountSidebar`
    - 3.1: 标题优先区服名，其次窗口名，最后"未选区服"
    - 3.2: 自定义窗口名与 QQ / 区服不同时显示小标签
    - 3.3: QQ 只出现一次，作为副标题
    - 3.4: 多区老账号在标题位置渲染下拉，选项保留短状态
    - 3.5: 操作按钮改为 进入 / 清理 / 编辑 / 删除，无凭证时不渲染"清理"
    - 3.6: 保留原有 `data-*` 属性，确保点击、切区、编辑、删除逻辑不变

- [x] Task 4: 验证
    - 4.1: 语法检查 game.html 内联脚本
    - 4.2: 用临时 Electron 启动并截图，检查浅色/深色主题下的卡片布局
    - 4.3: 确认无凭证、单区、多区三种卡片渲染正常
    - 4.4: 清理临时文件
