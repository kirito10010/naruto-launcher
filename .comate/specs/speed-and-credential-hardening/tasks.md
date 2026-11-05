# 加速注入加固与凭证补强任务计划

- [x] Task 1: 移除 main.js 中的 HVCI 检测与提示
    - 1.1: 删除 `hvciStatus` 变量与 `checkHVCI()` / `showHVCIWarning()`
    - 1.2: `detectWindowsVersion()` 去掉 `isWindows11` 赋值与 HVCI 调用，只保留系统信息日志
    - 1.3: 删除 `launch-game` 与启动 3 秒延时中的两处弹窗调用

- [x] Task 2: 加固原生注入流程
    - 2.1: `injectSpeedHook` 去掉 `timeout: 10000`，删除 `-1073741510` 归因分支，失败日志降为 WARN
    - 2.2: 新增 `pruneInjectedPids()`，在 `injectAllChildProcesses()` 扫描前清理已退出 PID
    - 2.3: `getAllRelevantChildPids` 只保留 `renderer` / `tab` / `pepper plugin` / `ppapi plugin`
    - 2.4: 删除 `secondPass()` 及 Win11 二次注入逻辑
    - 2.5: `did-attach-webview` 中新增 `dom-ready`：倍率非 1 时直注 `guest.getOSProcessId()`，再扫描插件进程

- [x] Task 3: 凭证跨账号票据过滤（main.js）
    - 3.1: 抓取后收集其他账号的 skey 集合
    - 3.2: 丢弃 `skey` / `p_skey` 中值属于其他账号的 cookie，并记日志

- [x] Task 4: 凭证注入补全 pt2gguin（main.js）
    - 4.1: `apply-credential` 兜底写入 `skey` / `uin` 后，检查是否已有 `pt2gguin`
    - 4.2: 缺失时向 `.ptlogin2.qq.com` 写 `o` + 10 位 uin 的 `pt2gguin`

- [x] Task 5: 删除无效的 30 分钟定时抓取（main.js）
    - 5.1: 移除 `attachCredentialCapture` 中的 `setInterval` 与 `destroyed` 清理逻辑

- [x] Task 6: 修正账号栏凭证文案（game.html）
    - 6.1: 无真实到期时间时显示"已保存（通常 24 小时内有效）"，短文案"已保存 24h"
    - 6.2: 保留真实到期时间与已失效文案不变

- [x] Task 7: 验证
    - 7.1: `node --check main.js` 与 game.html 内联脚本语法检查
    - 7.2: 全仓库确认无 `hvci` / `HVCI` / `-1073741510` / `secondPass` 残留
    - 7.3: 临时 userData 启动一次，检查注入日志与账号加载不报错
    - 7.4: 清理临时文件
