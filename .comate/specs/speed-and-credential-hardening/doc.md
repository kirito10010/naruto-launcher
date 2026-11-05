# 加速注入加固与凭证补强

版本：2.1.0（未发布，沿用）
范围：`main.js`、`game.html`
依据：解包 `D:\Programs\GameLauncher`（1.5.0）源码对比；用户实测「内存完整性开启不影响加速」

---

## 一、背景与结论

GameLauncher 与我们的 `speedctl.exe` / `speedhook.dll` 二进制完全一致（SHA256 相同），但它的实现有三点不同：

1. 不检测 HVCI，不弹窗，不引导用户关闭内存完整性；注入失败只记日志。
2. `dom-ready` 时直接注入当前 webContents 的渲染进程 PID，再扫描 Pepper Plugin；我们只在 `did-finish-load` 扫描，且会注入启动器/账号窗口等无关渲染进程。
3. 不给 `speedctl` 设 10 秒超时；我们的 `timeout: 10000` 会强杀子进程，产生 `-1073741510`，又被错误归因为 HVCI。

凭证方面，GameLauncher 有两个我们缺的处理：

- 跨账号票据过滤：同一分区先后登录 A、B 时，丢弃残留的、属于别的账号的 `skey` / `p_skey`。
- `pt2gguin` 兜底：充值/支付页走 `xui.ptlogin2.qq.com`，缺它会被要求重新登录。
- 其源码注释明确：同一张 skey 在有效期内复用，进页面/刷新不重发；兜底 TTL 为 24 小时。因此我们上一版加的 30 分钟定时抓取没有续期意义。

---

## 二、改动内容

### 1. 移除 HVCI 相关逻辑（main.js）

- 删除 `hvciStatus`、`checkHVCI()`、`showHVCIWarning()`。
- 删除启动 3 秒弹窗（main.js:4381-4385）与 `launch-game` 前弹窗（3538-3540）。
- `detectWindowsVersion()` 只保留系统信息日志，不再设置 `isWindows11`（仅被 HVCI / 二次注入使用）。
- 删除 `secondPass()` 与 `-1073741510` 的 HVCI 归因。

### 2. 注入流程对齐 GameLauncher（main.js）

- `injectSpeedHook(pid)` 去掉 `timeout: 10000`，避免超时强杀被误判为失败。
- 新增 `pruneInjectedPids()`：每次扫描前清理已退出 PID，防止误以为已注入。
- `getAllRelevantChildPids()` 只保留 `renderer` / `tab` / `pepper plugin` / `ppapi plugin`，去掉泛化的 `plugin`。
- `did-attach-webview` 中新增 `guest.on('dom-ready')`：对 `guest.getOSProcessId()` 直注（倍率非 1 时），再调 `injectAllChildProcesses()` 覆盖 PPAPI 进程。
- 注入失败：`injectedPids` 删除、允许下次重试；日志级别 WARN，不打断用户。

### 3. 凭证过滤与补全（main.js）

- `captureCredentialFromGuest` 组装 cookie 后，用其他账号的 skey 集合过滤掉 `skey` / `p_skey` 中属于别人的值。
- `apply-credential` 兜底：保证 `.huoying.qq.com` 上有 `skey`、`uin`，并补 `.ptlogin2.qq.com` 的 `pt2gguin`（`o` + 10 位 uin）。
- 删除 `attachCredentialCapture` 的 30 分钟定时器（skey 不重发，抓取无续期作用）。

### 4. 文案修正（game.html）

- 无真实到期时间时，不再写"进入游戏自动续期"，改为"已保存（通常 24 小时内有效）"，短文案 `已保存 24h`。
- 其余状态不变。

---

## 三、边界

| 场景 | 行为 |
| --- | --- |
| HVCI 开启 | 不做任何检测/提示，正常注入 |
| `speedctl` 卡住 | 不再 10s 强杀；由用户切换倍率或重启客户端恢复 |
| 注入失败 | 记录 WARN，倍率仍保存在配置里；下次 dom-ready / 切倍率重试 |
| 同 QQ 多区 | 凭证过滤只影响"别的账号"的票据，不影响本账号多区 |
| 老凭证无 pt2gguin | 注入时自动补，不修改磁盘凭证结构 |

---

## 四、预期结果

- 开启内存完整性也能正常加速，且客户端不再出现"请关闭内存完整性"的提示。
- 启动器/账号窗口不再被注入 hook，减少无谓开销。
- Flash 插件进程在页面就绪后能更早注入，减少"进游戏后要切一次倍率才生效"。
- 充值页不再因缺 `pt2gguin` 退回扫码登录。
- 账号栏不再暗示凭证可以自动续期。
