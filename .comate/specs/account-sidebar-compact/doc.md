# 账号侧边栏卡片改版

版本：2.1.0（未发布，沿用）
范围：`game.html`（仅样式与渲染结构，不动 IPC / 登录逻辑）

---

## 一、现状问题

当前卡片信息层级乱、重复多：

- 第一行是窗口名（默认等于 QQ），第二行又是 QQ，QQ 出现两次；
- "区服" 单独一行，凭证状态又是完整长句，四行信息抢注意力；
- 4 个操作按钮是 2×2 图标网格，平时半透明、hover 才出现，可发现性差；
- 图标（⊞ ⌫ ✏ ✕）含义不直观。

参考 GameLauncher 的卡片：区服名做标题、QQ 做副标题、一行文字按钮，信息少一半但更清楚。

---

## 二、目标结构

```
┌──────────────────────────────────┐
│ 1098区 影·起爆粘土      [主号]   │  ← 区服名（无区服时退回窗口名/未选区服）
│ 3025863517                       │  ← QQ
│ ● 有效 141 小时                  │  ← 状态点 + 短文案（悬停显示上次续期）
│ [ 进入 ] [ 清理 ] [ 编辑 ] [ 删除 ] │  ← 单行文字按钮，常驻
└──────────────────────────────────┘
```

- 多区老账号（`zones.length > 1`）时，标题位置换成同款区服下拉，不额外占行。
- 未设置自定义窗口名时不显示标签；设置了且与 QQ/区服不同，才在标题后显示小标签。
- "清理"只在当前区服有凭证时显示；没有凭证时是 3 个按钮。

### 状态文案（短）

| 情况 | 文案 | 颜色 |
| --- | --- | --- |
| 无凭证 | 未保存凭证 | 灰 `--sub` |
| 无到期时间 | 已保存（约 24 小时） | 黄 `#eab308` |
| 未过期 | 有效 141 小时 / 有效 3 天 | 绿 `#10b981` |
| 已失效 | 已失效，需重新登录 | 红 `#ef4444` |

悬停 `title`：`上次续期：YYYY-MM-DD HH:mm`（取 `captured_at`），再附完整状态。

---

## 三、实现细节

### CSS（替换 game.html 中 `.account-sidebar-item` 到 `.account-sidebar-action-btn.delete`）

```css
.account-sidebar-list { flex:1; overflow-y:auto; padding:10px; }

.account-sidebar-item {
  display: block;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(128,128,128,.08);
  margin-bottom: 8px;
  cursor: pointer;
  transition: background .18s, border-color .18s;
}
.account-sidebar-item:hover {
  background: rgba(128,128,128,.14);
  border-color: var(--border);
}

.account-sidebar-head { display:flex; align-items:center; gap:6px; min-width:0; }
.account-sidebar-win-name {
  flex: 1; min-width: 0;
  color: var(--text); font-size: 13px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.account-sidebar-tag {
  flex: 0 0 auto; padding: 1px 6px; border: 1px solid var(--border);
  border-radius: 999px; font-size: 10px; color: var(--sub);
  white-space: nowrap;
}
.account-sidebar-qq { margin-top: 2px; color: var(--sub); font-size: 11px; }

.account-sidebar-status {
  display: flex; align-items: center; gap: 5px;
  margin-top: 6px; font-size: 11px; color: var(--sub);
}
.account-sidebar-status::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%;
  background: currentColor; flex: 0 0 auto;
}
.account-sidebar-status.valid { color: #10b981; }
.account-sidebar-status.saved { color: #eab308; }
.account-sidebar-status.invalid { color: #ef4444; }

.account-sidebar-actions { display: flex; gap: 6px; margin-top: 10px; }
.account-sidebar-action-btn {
  flex: 1; height: 26px; padding: 0 6px;
  border: none; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; white-space: nowrap;
  background: rgba(128,128,128,.16); color: var(--text);
  transition: background .18s, filter .18s;
}
.account-sidebar-action-btn:hover { background: rgba(128,128,128,.28); }
.account-sidebar-action-btn.open {
  flex: 1.2; background: var(--accent); color: #fff; font-weight: 600;
}
.account-sidebar-action-btn.open:hover { filter: brightness(1.08); }
.account-sidebar-action-btn.delete:hover { background: rgba(239,68,68,.18); color: #ef4444; }

/* 兼容老账号的多区下拉：做成无边框标题 */
.account-zone-select {
  flex: 1; min-width: 0; padding: 0; border: none; outline: none;
  background: transparent; color: var(--text);
  font-size: 13px; font-weight: 600;
}
```

删除旧的 2×2 网格、hover 才显示 actions、以及 `.account-sidebar-zone` 区块样式（下拉复用新样式）。

### 渲染结构（`renderAccountSidebar`）

```js
const zoneName = selected ? accountZoneName(selected) : '';
const title = zoneName || a.windowName || '未选区服';
const tag = (a.windowName && a.windowName !== a.qq && a.windowName !== zoneName) ? a.windowName : '';
const st = zoneCredStatus(selected);

html += '<div class="account-sidebar-item" data-account-id="' + a.id + '">' +
  '<div class="account-sidebar-head">' +
    (zones.length > 1
      ? '<select class="account-zone-select" data-account-id="' + a.id + '">…</select>'
      : '<span class="account-sidebar-win-name">' + escapeHtml(title) + '</span>') +
    (tag ? '<span class="account-sidebar-tag">' + escapeHtml(tag) + '</span>' : '') +
  '</div>' +
  '<div class="account-sidebar-qq">' + escapeHtml(a.qq) + '</div>' +
  '<div class="account-sidebar-status ' + st.cls + '"' + (st.title ? ' title="' + escapeHtml(st.title) + '"' : '') + '>' +
    escapeHtml(st.text) + '</div>' +
  '<div class="account-sidebar-actions">' +
    '<button class="account-sidebar-action-btn open" data-open-id="' + a.id + '" data-open-zone="' + escapeHtml(selectedKey) + '">进入</button>' +
    (selected && selected.login_url
      ? '<button class="account-sidebar-action-btn" data-clear-cred-id="' + a.id + '" data-clear-zone="' + escapeHtml(selectedKey) + '">清理</button>'
      : '') +
    '<button class="account-sidebar-action-btn edit" data-edit-id="' + a.id + '">编辑</button>' +
    '<button class="account-sidebar-action-btn delete" data-delete-id="' + a.id + '">删除</button>' +
  '</div>' +
'</div>';
```

`zoneCredStatus` 改为返回 `{ text, cls, title }`：

```js
function zoneCredStatus(cred) {
  const title = cred && cred.captured_at ? '上次续期：' + formatCredTime(cred.captured_at) : '';
  if (!cred || !cred.login_url) return { text: '未保存凭证', cls: '', title: '' };
  const exp = cred.expires_at ? new Date(cred.expires_at).getTime() : 0;
  if (cred.expired_at || (exp && exp <= Date.now())) {
    return { text: '已失效，需重新登录', cls: 'invalid', title };
  }
  if (!exp) return { text: '已保存（约 24 小时）', cls: 'saved', title };
  const ms = exp - Date.now();
  const days = Math.floor(ms / 86400000);
  const hours = Math.max(1, Math.round(ms / 3600000));
  return { text: '有效 ' + (days >= 2 ? days + ' 天' : hours + ' 小时'), cls: 'valid', title };
}
```

下拉选项继续用 `accountZoneName(z)`，后缀状态改为短文案（`st.text` 去掉"凭证："前缀即可）。

---

## 四、边界

| 场景 | 处理 |
| --- | --- |
| 老账号仍有多区 | 标题位置显示下拉，选中项决定进入/编辑/删除目标 |
| 没有区服（刚添加未登录） | 标题显示窗口名，没有则"未选区服" |
| 窗口名等于 QQ | 不显示标签，避免重复 |
| 凭证失效 | 红色状态 + "清理"仍显示（可手动清除） |
| 窄侧边栏 280px | 四个按钮 flex 自适应；文字过长省略 |
| 10 套主题 | 只用 `--text/--sub/--accent/--border` 与灰阶叠加，不写死背景色 |

## 五、预期结果

- QQ 不再重复出现，标题一眼看出区服；
- 状态用颜色点区分，扫一眼知道哪个号能用；
- 操作全部常驻、文字直白，不用记图标含义；
- 登录、一键启动、多区切换等行为完全不变。
