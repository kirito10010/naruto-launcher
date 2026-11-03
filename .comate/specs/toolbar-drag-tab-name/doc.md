# 顶栏空白拖动与标签短名

## 需求场景

1. 切到顶栏标签模式后，标签只占左侧一小段，右侧空白区域无法拖动窗口。明明只有两个标签，空白处却点不动，移动窗口很别扭。
2. 标签名希望更紧凑：QQ 前四位 + `-` + 区服，例如 `3025-1098区`；不再显示完整账号名和完整区服名。

## 处理逻辑

### 顶栏空白拖动

- 在 `.tabs-list` 末尾追加一个不可见的 `.tabs-drag-fill`，占满标签后的剩余宽度，设为 `-webkit-app-region: drag`。
- 标签本身保持 `no-drag`，拖拽排序、点击关闭、drop 逻辑都走原来的 `.tabs-list`，不受影响。
- 标签很多、填充被压缩到 8px 时，仍可通过左侧标题区和工具栏其他空白拖动窗口。

### 标签短名

- 账号标签名改为：`QQ 前四位 + '-' + 区服短名`。
- 区服短名优先提取 `1098区`；没有「数字+区」时截断到 6 个字符。
- 没有 QQ 时回退 `windowName`。
- 没有区服时只显示 QQ 前四位。

示例：
- `3025863517` + `1098区 影·起爆` → `3025-1098区`
- 无区服 → `3025`

## 受影响文件

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `game.html` | 修改 | 顶栏空白可拖动；标签名生成规则 |

## 实现细节

```css
.tabs-list { flex: 1; min-width: 0; }
.tabs-drag-fill {
  flex: 1 1 0;
  min-width: 8px;
  align-self: stretch;
  -webkit-app-region: drag;
}
.tab { -webkit-app-region: no-drag; }
```

```js
function accountTabName(account, zoneName) {
  const qq = String((account && account.qq) || '').trim();
  const prefix = qq ? qq.slice(0, 4) : ((account && account.windowName) || '窗口');
  const zone = shortZoneName(zoneName);
  return zone ? (prefix + '-' + zone) : prefix;
}
```

## 边界与异常

- 标签拖拽排序依赖 `.tabs-list` 的 dragover，保持 no-drag 不影响。
- 空白区域可拖动窗口后，双击空白不会最大化（Electron 拖拽区行为），符合预期。
- QQ 少于 4 位时取全部。
- 区服名过长时截断，避免再次撑爆标签。

## 预期结果

- 顶栏标签右侧空白处按住即可移动窗口。
- 标签显示为 `3025-1098区` 这类短名，两个标签占用更少宽度。
