# 借鉴 GameLauncher：QQ游戏入口 + 凭证一键登录

## 一、全面分析结论（反编译 GameLauncher 1.5.0 源码）

### 1.1 登录页为什么不一样

| | 他们 | 我们 |
| --- | --- | --- |
| 入口 URL | `https://minigame.qq.com/plat/social_hall/app_frame/?appid=10190` | `https://huoying.qq.com/` |
| 页面性质 | QQ 游戏大厅内嵌页（app_frame），登录在 iframe `huoying.qq.com/webgame_login` | 官方网站首页 |
| 登录页外观 | QQ 游戏 branding | 官网登录页 |

这是登录页显示「QQ游戏」的直接原因。

### 1.2 他们的一键登录（凭证直连）原理

1. 登录成功后，从**该窗口分区的 session** 里抓 cookie（`skey`、`uin`、`p_uin`、`p_skey`、`pt2gguin`、`pf`、`pfkey` 等）。
2. 同时记录当前**真实进入游戏**的地址：`game.huoying.qq.com/main.html?...&sServerID=数字`（带区服和凭据参数）。
3. 存进账号：`credential = { uin, skey, cookies[], login_url, zone_id, zone_name, expires_at }`。
4. 下次点这个账号：
   - 先把 cookie 原样写回该账号独立分区的 session（`skey`/`uin` 顺带写成持久 cookie）；
   - 再让 webview 直接打开 `login_url` → **跳过登录页直接进游戏**。
5. 如果打开后被重定向到登录页 → 判定凭证失效，清掉 credential，并**重建一个干净分区**回退到官方登录（避免扫码头像串号）。

补充：他们每次打开「官方登录」窗口都会清掉该分区的 cookie，防止上一个账号残留。

### 1.3 关于画面清晰度

已知：

- 他们的 `quality` 默认也是 `high`（和我们一样），所以不是画质参数；
- 他们内置 Flash 是 **34.0.0.242**（第三方纯净版），我们是 34.0.0.376 / 32.0.0.344；
- 他们的游戏窗口是 **1280×800**（最小 960×600），入口是 app_frame；
- 你已经验证过：换窗口大小、换我们内置的 32/34、改 quality 都没变化。

剩下两个高概率原因：

1. **入口不同**：app_frame 对内部 iframe 的尺寸/缩放处理与官网直开不同，可能让游戏页拿到不同的 `sFrom/qqgame` 参数（游戏里 `if (web.source == "qqgame")` 会走另一条 resize 分支）。
2. **Flash 构建不同**：34.0.0.242 与 376 的文本渲染可能存在差异。

这两点都需要实测，不适合瞎猜。方案是先提供入口切换，用同一套代码 A/B 对比。

## 二、实施方案（分两步，可独立上线）

### 第一步：凭证一键登录（收益最高，不依赖入口）

- 新增 `credential` 字段（加密存储在各账号里，复用现有 accounts.json）。
- **抓取**：主进程监听游戏窗口 `did-navigate` / `did-navigate-in-page` / `did-frame-navigate`：
  - URL 命中 `game.huoying.qq.com/main.html` 且带 `sServerID=` → 记为本次登录的 `login_url` 和区服；
  - 延迟 1.5 秒后从该 webContents 的 session 读 cookie，抓到 `skey` 就写入账号。
- **应用**：打开账号窗口时，如果 credential 有效（未过期）：
  - 先 `session.cookies.set` 把 cookie 写回分区；
  - 再 `webview.src = login_url`；
  - 标记 `tab._usingCredential = true`。
- **失效回退**：加载后若落到登录页（`ptlogin2` 或 `web_login`），清 credential、重建分区、走官方登录。
- **UI**：账号侧边栏显示「凭证：有效 N 小时 / 无」，并提供「清除凭证」按钮。

### 第二步：入口切换（默认仍官网，可选 QQ游戏）

- 设置里加「游戏入口」：官网（默认）/ QQ 游戏大厅（app_frame）。
- 选择 app_frame 时，新开窗口使用 `https://minigame.qq.com/plat/social_hall/app_frame/?appid=10190`。
- 保留官网入口作为兜底（app_frame 若改版或验证失败可随时切回）。
- 实测 app_frame 下：Flash 是否正常、抓包/变速注入是否仍工作、窗口尺寸行为是否正常。

## 三、影响文件

| 文件 | 改动 |
| --- | --- |
| `main.js` | 入口 URL 常量、账号 credential 读写（IPC）、cookie 注入、页面导航监听 |
| `game.html` | 打开账号时先应用凭证再导航、登录页检测回退、侧边栏显示凭证状态 |
| `accounts.json` | 账号新增 `credential` 字段（向后兼容，旧数据无此字段照常走官方登录） |

## 四、边界与异常

- 旧账号（无 credential）：完全走现有官方登录 + 自动填账号密码，不受影响。
- 凭证过期 / 被踢下线：自动回退登录页，并清掉失效凭证，不会反复尝试。
- 多开串号：每个账号独立分区；回退时重建分区（webview 的 partition 创建后不可改）。
- cookie 只在 `qq.com` / `huoying.qq.com` / `ptlogin2.qq.com` 域内保存，不落其他域。
- 抓取时机：只在进入 `main.html?sServerID=` 后抓，避免把大厅阶段的临时 cookie 存成凭证。

## 五、预期结果

1. 登录一次后，账号侧边栏能看到「凭证有效」；下次点该账号直接进游戏，不再出现登录页。
2. 凭证失效自动回退，不影响正常登录。
3. 入口切到 QQ 游戏大厅后，登录页与对方一致；再 A/B 对比文字清晰度，确认是否由入口/Flash 构建导致。
