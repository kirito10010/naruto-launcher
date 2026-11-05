# 凭证安全存储与自动续期 - 完成总结

## 一、完成的改动

### main.js
- 新增 DPAPI 加解密：通过 `powershell.exe` + `System.Security.Cryptography.ProtectedData`（CurrentUser），零依赖、无原生模块。
- 账号文件从明文 `accounts.json` 改为加密 `accounts.dat`（`HYOL-ACC-1:` + base64），临时文件 + `renameSync` 原子替换。
- 启动加载顺序：`accounts.dat` 解密 → 失败则保留原文件、复制 `.corrupt`、锁住写入并提示 → 再尝试迁移老 `accounts.json`。
- 老用户首次启动自动迁移：读取明文 → 多区拆分 → 写加密文件 → 回读解密校验 → 删除 `accounts.json` 与 `accounts.json.bak`。
- 多区拆分备份改为加密文件 `accounts.dat.bak`，不再生成明文备份。
- `loadAccounts()` 增加加载缓存，`get-accounts` 不再每次重新解密；手动"整理旧账号"仍强制重读。
- 凭证到期时间只取 `skey.expirationDate`，会话型 cookie 不再编造 7 天有效期；新增 `expires_source`、`last_ok_at`、`expired_at`。
- `apply-credential` 无真实到期时间时写会话 cookie，不再伪造 `expirationDate`。
- 新增 `mark-credential-expired` IPC：失效只打标记，保留区服与登录地址。
- 凭证捕获增加 30 分钟定时续期（仅当页面仍在 `main.html?sServerID=`），guest 销毁时清理定时器。
- 账号管理窗口新增 `esc()`，`qq` / `qqPwd` / `windowName` 不再直接拼进 `value="..."`。

### game.html
- `zoneCredStatus` 改为五种真实状态：无 / 已保存（自动续期）/ 有效 N 天或 N 小时 / 已失效（登录一次自动恢复）。
- 状态文字附带 `title`，显示"上次续期"时间。
- `gameAPI` 新增 `markCredentialExpired`。
- 凭证直连被重定向到登录页时改为标记失效，不再清空凭证。
- 已标记失效的凭证不再注入旧 cookie，直接打开区服地址（避免覆盖分区里仍有效的会话）。

## 二、验证结果

用临时 userData 目录做了真实启动测试：

- 老 `accounts.json`（含 1 个多区账号）迁移后得到 3 条账号，加密文件解密内容正确。
- `accounts.json`、`accounts.json.bak` 均被删除；`accounts.dat` 中 grep 不到 skey 和中文明文。
- 损坏 `accounts.dat`：不崩溃、生成 `.corrupt` 副本、保护状态下不覆盖原文件；文件恢复后可正常解密。
- 加密/解密中文内容无乱码（PowerShell stdin/stdout 改为原始字节读写后修复）。
- `node --check main.js`、game.html 内联脚本语法检查通过。

实测耗时：12 KB 账号数据加密约 275 ms、解密约 556 ms；首次启动多一次"加密 + 回读校验"，约 1 秒，之后走内存缓存。

## 三、对用户问题的回答

- 显示的剩余时间不一定真实：以前 cookie 没有到期时间时会编一个"7 天"，现在不会了。
- 24 小时内失效是可能的：本地到期时间只是 cookie 的，腾讯服务端可以提前作废，两者无关。
- 续期：每次成功进入区服都会重新抓取并覆盖凭证，所以每天登录一次就是续期；长时间挂机由 30 分钟定时兜底；失效后登录一次自动恢复，不用手动删除。

## 四、已知限制

- DPAPI 只能防文件被拷走、换 Windows 账号、换机器；同用户下运行的恶意程序仍可调用 DPAPI 解密。
- 降级回 2.1.0 会读不到账号（老版本只认 `accounts.json`），按计划不做兼容层。
- 若 PowerShell 被组策略禁用，账号无法落盘，会提示"本次修改只在当前会话生效"，不会降级写明文。

## 五、未做

- 游戏加速 / HVCI 相关逻辑未改动。
- 未打包、未改版本号（当前仍是 2.1.0，改动归入 2.1.1）。
