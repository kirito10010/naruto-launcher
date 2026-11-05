# 凭证安全存储与自动续期任务计划

- [x] Task 1: 在 main.js 实现 DPAPI 加解密基础能力
    - 1.1: 新增 `ACCOUNTS_ENC_FILE`、`ACCOUNTS_MAGIC` 常量，保留 `ACCOUNTS_FILE` 作为迁移来源
    - 1.2: 新增 `spawnSync` 所需的 PowerShell 脚本常量 `DPAPI_ENC_PS` / `DPAPI_DEC_PS`
    - 1.3: 实现 `dpapiRun(script, input)`：非 Windows 抛错、20s 超时、16MB maxBuffer、非 0 退出码抛错
    - 1.4: 实现 `dpapiProtect(text)` / `dpapiUnprotect(base64)` 两个封装
    - 1.5: 实现 `showAccountStorageErrorOnce(err)`，用 `dialog.showErrorBox` 只提示一次

- [x] Task 2: 改造账号加载与保存为加密文件（main.js）
    - 2.1: `saveAccounts()` 改为 JSON → DPAPI → `HYOL-ACC-1:` 前缀 → 临时文件写入 + `renameSync` 原子替换
    - 2.2: 加密失败时不写明文，只记录 ERROR 并调用一次性错误提示
    - 2.3: 重写 `loadAccounts()`：优先读 `accounts.dat` 解密解析，失败改名 `.corrupt` 并降级查找老文件
    - 2.4: 老 `accounts.json` 迁移：读取 → `migrateAccountsByZone()` → 写加密文件 → 回读解密校验 → 删除 `accounts.json` 与 `accounts.json.bak`
    - 2.5: 新增 `accountsLoaded` 标记，重复调用 `loadAccounts()` 时直接返回；`repair-accounts` 保持强制重读
    - 2.6: `migrateAccountsByZone()` 的备份从明文 `accounts.json.bak` 改为加密的 `accounts.dat.bak`

- [x] Task 3: 修正 get-accounts IPC 的重复解密
    - 3.1: `get-accounts` 只在未加载时调用 `loadAccounts()`
    - 3.2: 保留现有 `accounts-update` 回传逻辑不变

- [x] Task 4: 凭证有效期记录真实化（main.js）
    - 4.1: `captureCredentialFromGuest` 中按 `skey.expirationDate` 是否存在决定 `expires_at`，无到期时间写空字符串
    - 4.2: 新增 `expires_source`（`cookie` / `unknown`）、`last_ok_at`，抓取成功时清空 `expired_at`
    - 4.3: 删除 `CREDENTIAL_TTL_MS` 常量及 capture 中的 7 天兜底
    - 4.4: `apply-credential` 在无 `expires_at` 时写成会话 cookie，不再伪造 7 天有效期

- [x] Task 5: 凭证失效标记与自动续期（main.js）
    - 5.1: 新增 IPC `mark-credential-expired`，写入 `expired_at` 并保留 login_url / cookie / 区服
    - 5.2: `attachCredentialCapture` 增加 30 分钟定时重新抓取，仅当前 URL 匹配 `main.html?sServerID=` 时执行
    - 5.3: guest 销毁/关闭时清理定时器，避免泄漏

- [x] Task 6: 游戏端凭证状态展示与失效处理（game.html）
    - 6.1: 重写 `zoneCredStatus` 的五种状态文案，剩余时长 >48h 显示天、否则小时，未知到期显示"已保存（自动续期）"
    - 6.2: 状态行加 `title`，显示 `captured_at` 格式化的"上次续期"时间
    - 6.3: `gameAPI` 新增 `markCredentialExpired`
    - 6.4: `did-navigate` 跳登录页时改为标记失效而非 `clearCredential`
    - 6.5: `createWebview` 增加 `!credential.expired_at` 判断，失效时跳过 cookie 注入直接打开 `zoneLoginUrl`

- [x] Task 7: 修复账号管理页字段转义（main.js）
    - 7.1: 在账号管理窗口脚本内新增 `esc()` 转义函数
    - 7.2: `showModal` 中 `qq` / `qqPwd` / `windowName` 三个 value 使用 `esc()`
    - 7.3: 账号列表中的 `windowName` / `qq` 使用 `esc()`

- [x] Task 8: 验证与回归
    - 8.1: 用临时 userData 目录验证：无文件 → 新增账号 → 生成 `accounts.dat` 且无明文
    - 8.2: 验证老 `accounts.json` 迁移：生成加密文件、删除明文与 `.bak`、账号数量一致
    - 8.3: 验证 `accounts.dat` 被篡改时改名 `.corrupt` 且不崩溃
    - 8.4: 启动应用检查启动耗时、账号栏多区展示、一键启动参数不变
    - 8.5: 清理临时测试文件（`_dpapi_test.js` 等）
