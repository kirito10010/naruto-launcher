# 同一 QQ 多区服凭证（multi-zone-credentials）

## 目标
一个 QQ 在多个区服都有角色时，账号栏可以切换区服，一键启动用对应区服的凭证直接进游戏，不再只记住最后一次进入的区。

## 数据模型
账号对象新增：

- `credentials`: `{ [zone_id]: credential }`，按区服保存凭证；同一个区反复登录只更新。
- `lastZoneId`: 最后一次进入/选择的区服；一键启动默认用它。
- 保留 `credential`: 最后一次凭证，兼容旧代码和旧数据。

`credential` 结构不变（`uin/skey/cookies/login_url/zone_id/zone_name/expires_at/captured_at`）。

旧数据迁移：加载 `accounts.json` 时，如果账号只有 `credential`、没有 `credentials`，把 `credential` 放进 `credentials[zone_id]`，并补 `lastZoneId`。不强制立即写盘，下一次保存时落盘。

## 自动保存
`captureCredentialFromGuest` 抓到凭证后：

1. `account.credentials[zone_id || 'default'] = credential`
2. `account.lastZoneId = zone_id || 'default'`
3. `account.credential = credential`（兼容）
4. 保存并广播刷新账号栏。

## 账号栏 UI
多区账号在条目里多一行区服选择：

```
区服 [1098区 影·起爆粘土 ▼]   凭证：有效 119 小时
```

- `zones.length > 1`：渲染 `<select class="account-zone-select" data-account-id>`，选项带区服名和有效期。
- 单区：显示一行文本 `区服：1098区 ...`，不显示下拉。
- 选中区服变化：更新本地 `lastZoneId`，IPC `set-account-zone` 持久化，并刷新凭证状态。
- 清除按钮只清当前选中区的凭证（`data-clear-zone`）；全部区都清掉后显示“凭证：无”。
- 开窗按钮用当前选中区的凭证。

## 启动逻辑
- 渲染层 `launchAccount(accountId, zoneId)` → 主进程 `launch-account-window`。
- 主进程按 `zoneId`（缺省 `lastZoneId`）从 `account.credentials` 取凭证，做账号浅拷贝，把 `credential` 替换为该区凭证，再下发。
- 游戏窗口 `addTab` 使用该凭证；分区仍为 `persist:qq-<qq>`。
- 多区账号的标签名：`窗口名/QQ · 区服名`；单区保持原名。
- 一键启动全部账号：每个账号用各自 `lastZoneId`。

## 清理
`clear-credential(accountId, zoneId)`：

- 有 `zoneId`：清空该区凭证但保留区服项（下拉里显示“凭证：无”），不会误回退到其它区；重新登录一次自动补回。
- 无 `zoneId`：清空全部区凭证（兼容旧行为）。

## 边界
- 凭证过期：区服仍然保留，标记“已过期”；启动时回退正常登录页，重新登录后自动刷新该区。
- 没进过的区不显示；官网登录一次后自动加入。
- 同一 QQ 多区同时在线是否允许由游戏服务端决定，客户端只负责用对应区凭证登录。
- 多区共用 `persist:qq-<qq>` 分区，不新增分区。

## 影响文件
- `main.js`：账号加载迁移、凭证抓取、区服选择/清理 IPC、启动时选凭证、多区标签名。
- `game.html`：账号栏区服下拉/状态/清除、启动传区服、标签名。
- 规格与总结：`.comate/specs/multi-zone-credentials/`。

## 预期
- 老用户升级后无感，单区账号 UI 基本不变。
- 多区账号可明确选择区服并一键进入对应区。
- 同一区重复登录不会产生重复项。
