# 凭证一键登录 + QQ游戏入口 · 完成总结

## 已实现

1. **凭证抓取（主进程）**
   - 监听每个游戏 webview 的 `did-navigate` / `did-navigate-in-page` / `did-frame-navigate`；
   - URL 命中 `game.huoying.qq.com/main.html` 且带 `sServerID=` 时，延迟 1.5s 从该分区读 cookie；
   - 用 `uin` 匹配账号，保存 `credential = { uin, skey, cookies[], login_url, zone_id, zone_name, expires_at }`；
   - 保存后广播 `accounts-changed`，账号栏自动刷新。

2. **凭证直连**
   - 打开账号标签时先 `apply-credential` 把 cookie 写回该账号分区（`ipcMain.handle`）；
   - 成功后 webview 直接打开 `credential.login_url`，跳过登录页；
   - 失败则回退到正常入口 + 自动填账号密码。

3. **失效回退**
   - 直连后若导航到登录页（`ptlogin2` / `login.qq.com` / `qlogin`），清除该账号凭证，重新加载官方入口。

4. **账号栏 UI**
   - 每个账号显示「凭证：有效 N 小时 / 已过期 / 无」；
   - 有凭证时多一个「清除凭证」按钮（⌫），走 `clear-credential` IPC。

5. **游戏入口切换**
   - 设置 →「游戏入口」：官网（默认）/ QQ游戏大厅（`minigame.qq.com/.../app_frame/?appid=10190`）；
   - `createGameWindow` 按设置选择入口；附带说明弹层。

## 验证

- `node --check main.js` 通过；game.html 内联脚本单独抽出来 `node --check` 也通过。
- 启动冒烟测试通过，配置正确写入 `gameEntry: "official"`。

## 需要真机验证（Task 6）

1. 用 QQ 游戏大厅入口登录一次 → 账号栏应出现「凭证：有效 N 小时」。
2. 关闭窗口重开该账号 → 直接进游戏，不出现登录页。
3. 点「清除凭证」→ 再开该账号回到登录页。
4. 切 app_frame 入口后：Flash 正常、抓包/变速注入仍可用、窗口自适应正常。

## 备注

- 旧账号没有 credential 时完全走原流程，不受影响。
- 凭证与现有账号数据一样明文存在 `accounts.json`（与 qqPwd 同级，未额外加密）。
