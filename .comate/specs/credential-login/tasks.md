# 凭证一键登录 + QQ游戏入口 · 实施任务

- [x] Task 1: 数据层与 IPC
    - 1.1: 账号结构扩展 credential（uin/skey/cookies/login_url/zone_id/zone_name/expires_at），旧数据无此字段照常
    - 1.2: 主进程新增 IPC：取账号凭证、写凭证、清凭证
    - 1.3: 凭证上限（每账号 1 条）与敏感字段只存必要 cookie

- [x] Task 2: 登录成功后抓取凭证
    - 2.1: 监听游戏窗口 did-navigate / did-navigate-in-page / did-frame-navigate
    - 2.2: URL 命中 game.huoying.qq.com/main.html 且带 sServerID= 时记录 login_url 与区服
    - 2.3: 延迟 1.5s 从该窗口 session 读取 cookie，抽取 skey/uin/p_skey/pt2gguin 等
    - 2.4: 按 uin 写回对应账号并通知页面刷新侧边栏

- [x] Task 3: 凭证直连与失效回退
    - 3.1: 打开账号标签时，凭证有效则先写 cookie 到分区，再直接加载 login_url
    - 3.2: 加载后落到登录页（ptlogin2 / web_login）判定失效：清凭证 + 重建干净分区回退官方登录
    - 3.3: 无凭证或已过期：保持现有官方登录 + 自动填账号密码
    - 3.4: 一键启动、单账号启动统一走这套逻辑

- [x] Task 4: 账号侧边栏凭证状态
    - 4.1: 每个账号显示「凭证：有效 N 小时 / 无」
    - 4.2: 增加「清除凭证」操作
    - 4.3: 登录后自动刷新状态（accounts-changed 事件）

- [x] Task 5: 游戏入口切换
    - 5.1: 设置新增「游戏入口」：官网（默认）/ QQ 游戏大厅（app_frame）
    - 5.2: createGameWindow 按设置选择入口 URL
    - 5.3: 帮助说明写清两种入口的区别与风险

- [ ] Task 6: 自测
    - 6.1: 首次登录 → 凭证抓取成功、侧边栏显示有效期
    - 6.2: 关窗重开 → 直接进游戏，不出现登录页
    - 6.3: 清除凭证 → 回到官方登录
    - 6.4: 切 app_frame 入口冒烟：Flash 正常、抓包/变速注入仍可用、窗口自适应正常
