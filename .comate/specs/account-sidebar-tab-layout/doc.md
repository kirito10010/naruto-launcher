# 账号卡片按钮与顶栏标签排版优化

## 需求场景

1. 账号侧边栏每个账号右侧有 4 个操作按钮（打开、清除凭证、编辑、删除），当前横排占掉过多宽度，左侧账号信息被挤压。希望改成两行两列，把横向空间还给左侧信息。
2. 一键启动后顶栏标签名过长（账号名 + 区服全名），顶栏标签受长度限制后观感差；标签拥挤时关闭按钮被挤出/裁掉，无法点击。

## 处理逻辑

### 账号卡片按钮

- `.account-sidebar-actions` 从横排 flex 改为 `grid`：2 列 × 2 行。
- 按钮尺寸缩小到 22×22，间距 4px，整体宽度约 48px。
- 账号信息区保持 `flex: 1; min-width: 0`，自动获得释放出来的宽度。
- 按钮仍在 hover 时显示，不改变原有交互。

### 顶栏标签

- 一键启动 / 账号启动的标签名中的区服只保留简名（优先提取 `1098区` 这类前缀），不再拼接完整区服名。
- `.tab` 允许收缩，设置合理的最小/最大宽度，并隐藏溢出。
- 标签名部分 `min-width: 0` + 省略号，关闭按钮 `flex-shrink: 0`，保证任何宽度下都可见。
- `.tabs-container` / `.tabs-list` 设置 `flex: 1; min-width: 0`，避免整体溢出把最后一个标签的关闭按钮裁掉。
- 标签增加 `title`，hover 可看完整名称。

## 受影响文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `game.html` | 修改 | 账号操作按钮网格布局；顶栏标签收缩/省略号/关闭按钮固定；区服简名 |

## 实现细节

### 账号操作按钮

```css
.account-sidebar-actions {
  display: grid;
  grid-template-columns: repeat(2, 22px);
  grid-auto-rows: 22px;
  gap: 4px;
  flex: 0 0 auto;
  margin-left: 8px;
  align-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.account-sidebar-action-btn { width: 22px; height: 22px; font-size: 11px; }
```

### 顶栏标签

```css
.tabs-container { flex: 1; min-width: 0; }
.tabs-list { flex: 1; min-width: 0; overflow: hidden; }
.tab { flex: 0 1 auto; min-width: 76px; max-width: 200px; overflow: hidden; }
.tab > span:first-child { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-close { flex: 0 0 auto; }
```

### 区服简名

```js
function shortZoneName(name) {
  const s = String(name || '').trim();
  const m = s.match(/(\d+\s*区)/);
  return m ? m[1].replace(/\s+/g, '') : s;
}
// 标签名：base + ' · ' + shortZoneName(zoneName)
```

## 边界与异常

- 没有区服或只有一个区服：标签名保持原样，不加后缀。
- 区服名不含「数字+区」：保留原名，由 CSS 省略号兜底。
- 账号没有清除凭证按钮（3 个按钮）时，网格自动排成 2 行（第一行 2 个，第二行 1 个）。
- 标签数量很多时，每个标签可收缩到最小宽度，名称省略，但关闭按钮始终可见。
- 侧边栏标签模式不受影响。

## 预期结果

- 账号卡片左侧信息宽度明显增加，区服下拉框和凭证状态不再被挤。
- 一键启动的顶栏标签名更短，多个标签并排时不拥挤，每个标签的 × 都能看到并点击。
