# 加速注入加固与凭证补强 - 完成总结

## 一、加速

### 移除 HVCI 相关逻辑
- 删除 `hvciStatus`、`checkHVCI()`、`showHVCIWarning()`、`isWindows11`。
- 删除启动 3 秒弹窗与 `launch-game` 前弹窗。
- 删除 `-1073741510`（STATUS_CONTROL_C_EXIT）被当成 HVCI 拦截的两处错误归因。
- `detectWindowsVersion()` 只保留系统版本日志。

### 注入流程对齐 GameLauncher
- `speedctl` 的 `inject` / `rate` 调用去掉 10 秒 / 5 秒超时，不再强杀子进程。
- 游戏渲染进程在 `dom-ready` 时按 `getOSProcessId()` 直注；1x 时也装 hook（不改变速度），之后切倍率立即生效。
- Flash 插件进程扫描只针对 `ppapi plugin` / `pepper plugin`，不再扫描所有渲染进程，启动器与账号窗口不会被注入。
- 新增 `pruneInjectedPids()`：每次扫描前清理已退出的 PID。
- 删除 5 秒注入冷却与 Win11 二次注入（`secondPass`）。
- 注入失败日志降为 WARN，并删除 PID 记录允许下次重试。

**实现偏离说明**：doc 原本写"扫描 renderer + 插件"，实现时改为"渲染进程由 dom-ready 按 PID 直注 + 扫描只覆盖插件"。这样既能保证插件进程不漏，又不会误注入启动器窗口。

## 二、凭证

- **跨账号票据过滤**：抓取 skey 后，丢弃 `skey` / `p_skey` 中属于其他账号的残留值。
- **pt2gguin 补全**：`apply-credential` 现在无论 cookie 列表是否完整，都保证 `.huoying.qq.com` 有 `skey` / `uin`，并补 `.ptlogin2.qq.com` 的 `pt2gguin`（`o` + 10 位 uin），充值页不再退回扫码。
- **删除 30 分钟定时抓取**：GameLauncher 源码实测 skey 在有效期内复用、不重发，定时抓取没有续期作用。
- **文案修正**：无真实到期时间时显示"已保存（通常 24 小时内有效）"，短文案"已保存 24h"，不再暗示自动续期。

## 三、验证

- `node --check main.js`、game.html 内联脚本语法检查通过。
- 全仓库扫描：无 `isWindows11` / `hvciStatus` / `showHVCIWarning` / `checkHVCI` / `secondPass` / `-1073741510` / 旧超时残留。
- 临时 userData 启动两次（含 `lastSpeed: 2` 配置）：进程正常存活，stderr 为空，账号迁移到 `accounts.dat` 正常。
- 未能在无头环境实际进游戏验证注入命中，需要真机开一次游戏确认加速生效。

## 四、说明

- GameLauncher 与我们的 `speedctl.exe` / `speedhook.dll` SHA256 完全一致，本次只改调用方式，不替换二进制。
- 未打包、未改版本号（仍为 2.1.0）。

---

## 五、评审后修复（问题 1-4）

1. **1x 不再注入**：新增 `gameContents` 记录游戏 webContents；`dom-ready` 仅在倍率≠1 时注入，切换倍率时通过 `injectIntoGameContents()` 给已打开的游戏页面补注。
2. **迁移失败不丢账号**：`loadAccounts()` 明文分支先保留内存数据，加密迁移单独 try；失败只提示，继续使用明文文件。
3. **保存失败有明文兜底**：`saveAccounts()` 加密失败时，先把旧 `accounts.dat` 改名为 `.stale`，再写 `accounts.json`，保证本次改动落盘且下次启动不会读到旧加密文件。
4. **保护状态可解除**：`loadAccounts(force)` 开始时复位 `accountsStorageLocked`，用户删除损坏的 `accounts.dat` 后可以正常保存。

验证：脚本覆盖正常迁移、加密不可用、已有加密文件后加密失效、解密锁死后删除文件四组场景，全部通过；`node --check main.js` 通过。

---

## 六、中低优先级遗留项处理

5. **插件晚创建补扫**：新增 `scheduleSpeedRescan()`，在 dom-ready 和切换倍率后 3s / 8s / 15s 各补扫一次 Flash 插件进程。
6. **明文残留清理**：`loadAccounts()` 成功加载加密文件后调用 `removePlaintextAccounts()`，残留的 `accounts.json` / `.bak` 会被删除。
7. **pt2gguin 按域名判重**：`uin` 只认 `.huoying.qq.com`，`pt2gguin` 只认 `.ptlogin2.qq.com`，避免别的域上的同名 cookie 阻断补写。
8. **保存改为异步**：
   - `saveAccounts()` 现在只更新快照并 250ms 合并写入，不再同步阻塞主进程。
   - 新增 `dpapiProtectAsync()` 走异步 PowerShell，写入仍是临时文件 + 原子替换。
   - 退出前 `flushAccountSaveSync()` 同步补一次，异步结果在退出流程中直接丢弃，避免覆盖更新的数据。
   - 失败仍保留明文兜底与 `.stale` 迁移逻辑。

验证：四组异步保存场景全部通过（正常落盘、加密失败降级明文、退出前同步 flush、加载后清理明文残留）；`node --check main.js` 通过。
