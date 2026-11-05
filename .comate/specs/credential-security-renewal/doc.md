# 凭证安全存储与自动续期

版本目标：2.1.1（本次不打包、不改版本号，除非后续明确要求）
影响范围：`main.js`（主进程）、`game.html`（游戏窗口 UI）
不涉及：游戏加速 / speedhook / HVCI 相关逻辑（本次明确不动）

---

## 一、需求背景

用户反馈两点：

1. `accounts.json` 里 QQ 密码和登录凭证是明文，任何同用户程序都能直接读走。
2. 账号栏显示的"凭证剩余时间"是否真实？会不会出现 24 小时内就失效？每天登录同一个账号同一个区，怎么保证凭证一直有效？

调查结论：

- `%APPDATA%\naruto-launcher\accounts.json` 中 `qqPwd` 明文；`credential.skey`、整组 cookie（含 `p_skey`、`openkey`）同样明文。skey 的敏感度高于密码。
- 到期时间来源：`skey.expirationDate`。QQ 的 skey 经常是会话型 cookie（无 `expirationDate`），此时 `main.js` 用 `Date.now() + 7 天` 兜底（`CREDENTIAL_TTL_MS`，main.js:613、717-719），账号栏就会显示"有效 168 小时"——这个数字是编的。
- 服务端失效与本地过期时间无关：即使 cookie 写着 7 天后过期，腾讯侧也可能几小时到 24 小时就作废。因此"显示还有 6 天、实际不到 24 小时就跳登录页"是真实存在的。
- 续期现状：`captureCredentialFromGuest` 在每次进入 `game.huoying.qq.com/main.html?sServerID=` 后 1.5 秒抓取并覆盖（main.js:705-793），所以"每天登录一次"本身就会续期。问题在于：凭证失效时会直接 `clearCredential` 清空（game.html:1174-1187），UI 只能显示"无"；游戏连续挂机超过一天时不会重新抓取；失效后下次启动仍会先注入旧 cookie，可能覆盖掉分区里仍有效的会话。

---

## 二、需求拆分

### 需求 1：账号文件加密存储（DPAPI）

**目标**：磁盘上不再出现明文密码 / skey / cookie；一键启动行为完全不变。

**技术方案**

- Electron 11 无 `safeStorage`（15+ 才有），且项目约束零依赖、无原生模块，因此使用 Windows 自带 DPAPI，通过 `powershell.exe` 调用 `System.Security.Cryptography.ProtectedData`（`CurrentUser` 作用域）。
- 实测：12 KB 明文加密约 275 ms、解密约 556 ms。启动时解密一次、保存时加密一次，可接受，采用同步 `spawnSync`，避免异步队列与退出竞态。
- 文件：`%APPDATA%\naruto-launcher\accounts.dat`
- 格式：`HYOL-ACC-1:` + base64(DPAPI 密文)，密文内容为 UTF-8 的 accounts JSON。

**接口设计（main.js）**

```js
const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');
const ACCOUNTS_ENC_FILE = path.join(app.getPath('userData'), 'accounts.dat');
const ACCOUNTS_MAGIC = 'HYOL-ACC-1:';

const DPAPI_ENC_PS = [
  'Add-Type -AssemblyName System.Security',
  '$in = [Console]::In.ReadToEnd()',
  '$b = [Text.Encoding]::UTF8.GetBytes($in)',
  "$e = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser')",
  '[Console]::Out.Write([Convert]::ToBase64String($e))'
].join('; ');

const DPAPI_DEC_PS = [
  'Add-Type -AssemblyName System.Security',
  '$s = [Console]::In.ReadToEnd().Trim()',
  '$e = [Convert]::FromBase64String($s)',
  "$b = [Security.Cryptography.ProtectedData]::Unprotect($e, $null, 'CurrentUser')",
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))'
].join('; ');

function dpapiRun(script, input) {
  if (process.platform !== 'win32') throw new Error('DPAPI 仅支持 Windows');
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { input, encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || '').trim() || ('powershell 退出码 ' + r.status));
  return r.stdout || '';
}
function dpapiProtect(text) { return dpapiRun(DPAPI_ENC_PS, text); }
function dpapiUnprotect(b64) { return dpapiRun(DPAPI_DEC_PS, b64); }
```

**加载流程 `loadAccounts()`**

```
1. accounts.dat 存在：
   - 读取、去掉 magic 前缀、dpapiUnprotect、JSON.parse
   - 失败：重命名为 accounts.dat.corrupt，log ERROR，accounts = []
     （再尝试 accounts.json 迁移，若存在）
2. accounts.dat 不存在、accounts.json 存在（老用户首次升级）：
   - parse → migrateAccountsByZone()（现有逻辑）
   - saveAccounts() 写出 accounts.dat
   - 回读 accounts.dat 解密校验内容一致
   - 校验通过后删除 accounts.json 与 accounts.json.bak（明文备份含凭证，必须删除）
3. 都不存在：accounts = []
```

**保存流程 `saveAccounts()`**

```js
function saveAccounts() {
  try {
    const plain = JSON.stringify(accounts, null, 2);
    const data = ACCOUNTS_MAGIC + dpapiProtect(plain);
    const tmp = ACCOUNTS_ENC_FILE + '.tmp';
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, ACCOUNTS_ENC_FILE);
    log(`账号已加密保存: ${accounts.length} 个`);
  } catch (e) {
    log('加密保存账号失败: ' + e.message, 'ERROR');
    showAccountStorageErrorOnce(e);   // 只弹一次，避免反复打扰
  }
}
```

- 加密失败**不降级写明文**（否则安全改造失去意义）：本次会话内账号仍在内存可用，弹一次提示"账号无法加密写入，本次修改仅在当前会话生效"。
- `migrateAccountsByZone()` 里的备份改为加密文件备份：`accounts.dat` → `accounts.dat.bak`（在 `saveAccounts()` 之后复制，或写前复制已有 `.dat`），不再产生 `accounts.json.bak`。
- `accountsLoaded` 标记：`get-accounts` IPC 不再每次调用 `loadAccounts()`（main.js:3638-3649），已加载则直接回内存数据，避免每次打开账号栏都解密 0.5 秒；`repair-accounts` 仍强制重读。

**边界与异常**

| 场景 | 处理 |
| --- | --- |
| PowerShell 被组策略禁用 | DPAPI 抛错 → 不写明文，弹一次错误提示，内存数据可用 |
| `accounts.dat` 损坏 | 改名 `.corrupt`，提示，按老文件迁移或空列表 |
| 换 Windows 用户 / 换机器 | DPAPI 解不开 → 视作损坏，走上述流程（这正是加密目的） |
| 应用崩溃在写 tmp 阶段 | 原 `accounts.dat` 不受影响，tmp 文件下次覆盖 |
| 降级回 2.1.0 | 老版本读不到 `accounts.json`，账号为空。接受此代价，不做兼容层 |

**一键启动影响**：无。解密仍在 `app.whenReady()` 里 `loadAccounts()` 完成（main.js:3879），之后内存对象结构不变，`credential` / `credential.login_url` / `cookies` 字段完全一致。

### 需求 2：凭证有效期展示真实化

**抓取侧改动（`captureCredentialFromGuest`）**

```js
const hasExpiry = !!skey.expirationDate;
const credential = {
  ...
  expires_at: hasExpiry ? new Date(expiresAt).toISOString() : '',
  expires_source: hasExpiry ? 'cookie' : 'unknown',
  captured_at: new Date().toISOString(),
  last_ok_at: new Date().toISOString(),
  expired_at: ''
};
```

- 删除 `CREDENTIAL_TTL_MS` 兜底常量及其在 capture / apply-credential 中的使用。
- `isCredentialUsable` 保持不变：无 `expires_at` 时视为"可尝试"。
- 抓取成功时清空 `expired_at`（自动恢复）。

**注入侧改动（`apply-credential`）**

- 无 `expires_at` 时不再伪造 7 天：不传 `expirationDate`，写成会话 cookie（与腾讯返回一致）。
- 有 `expires_at` 时按原逻辑写。

**展示侧改动（game.html `zoneCredStatus`）**

| 条件 | 文案 |
| --- | --- |
| 无 `login_url` | `凭证：无` |
| `expired_at` | `凭证：已失效（登录一次自动恢复）` / 短文案 `已失效` |
| 有 `expires_at` 且已过期 | 同上 |
| 有 `expires_at` 未过期 | `有效 3 天` / `有效 12 小时`（>48h 显示天，否则小时） |
| 无 `expires_at` | `已保存（进入游戏自动续期）` / 短文案 `已保存`（不再出现"168 小时"这种假数字） |

状态文字加 `title`：`上次续期：YYYY-MM-DD HH:mm`（取 `captured_at`）。

### 需求 3：失效标记 + 自动续期

1. **失效不再清空**：新增 IPC `mark-credential-expired(accountId, zoneId)`，把当前 `credential.expired_at` 设为当前时间，保留 `login_url` / cookie / 区服信息；`clear-credential` 保留给"⌫ 手动清除"。
2. **game.html 跳登录页处理**：`did-navigate` 命中 `isLoginPage` 时调用 `markCredentialExpired`，不再 `clearCredential`；UI 显示"已失效"，卡片不消失。
3. **不再注入失效 cookie**：`createWebview` 中凭证可注入的条件加上 `!credential.expired_at`；失效时直接打开 `zoneLoginUrl`（沿用分区里已有 session，若 session 仍有效可直接进入，否则走登录页）。
4. **长时间挂机续期**：`attachCredentialCapture` 增加 30 分钟定时器，若 guest 当前 URL 仍匹配 `main.html?sServerID=`，重新抓取一次；guest 销毁或窗口关闭时 `clearInterval`（监听 `destroyed` / `close`）。
5. **每次成功进区即续期**：现有 did-navigate 抓取逻辑保留，作为主续期路径。

效果：只要每天正常登录一次（或持续挂机），凭证会被最新 skey 覆盖；只有真正需要重新登录时，才显示"已失效"，登录成功后自动恢复为"有效"。

### 需求 4（顺带修复）：设置页账号字段转义

`main.js` 账号管理窗口模板把 `qq` / `qqPwd` / `windowName` 直接拼进 `value="..."`（main.js:3580-3582），密码带 `"` 会破坏 DOM。新增局部 `esc()` 并用于这三处及列表中的 `windowName` / `qq`。

---

## 三、数据流

```
启动 → loadAccounts
        ├─ accounts.dat → DPAPI 解密 → JSON.parse → migrateAccountsByZone → 内存
        └─ accounts.json → parse → migrate → DPAPI 加密写 accounts.dat → 校验 → 删明文

登录成功 → main.html?sServerID → 1.5s 后 capture
        → 读分区 cookie → 组装 credential(expires_source/last_ok_at)
        → 覆盖对应 QQ+区 账号 → saveAccounts → DPAPI 加密落盘 → 广播 UI

一键启动 → 内存 credential
        ├─ 未失效 → apply-credential 写 cookie → 打开 login_url → 成功后 capture 续期
        └─ 已失效 → 跳过注入 → 打开 zoneLoginUrl → 登录页 → 登录成功后 capture 恢复

30 分钟定时 → 当前仍在 main.html → capture → 覆盖凭证（挂机场景续期）
```

---

## 四、预期结果

- `%APPDATA%\naruto-launcher\` 下不再存在含明文密码 / skey 的文件；`accounts.dat` 换用户 / 换机器无法解密。
- 一键启动、多区拆分、账号面板行为不变。
- 账号栏不再显示虚假的"有效 168 小时"：有真实 cookie 到期时间就显示剩余时长，否则显示"已保存（自动续期）"。
- 凭证失效时清晰显示"已失效（登录一次自动恢复）"，而不是消失成"无"。
- 每天登录 / 持续挂机都会自动刷新凭证；30 分钟定时兜底长会话。
- 设置页密码含特殊字符不会再撑坏页面。

---

## 五、不做的事

- 不动 speedhook / HVCI / 加速提示（用户明确要求先不处理）。
- 不做"每日本地定时静默登录"：需要用户密码且会被腾讯风控，收益低于风险。
- 不引入任何 npm 依赖或原生模块。
