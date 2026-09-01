# 修复多开标签切换白屏（Flash 表面保持）方案

## 1. 背景与问题

多开标签后，切回某个后台标签出现全白画面。触发场景：默认标签开了「拉伸」，再用「一键启动」多开账号，玩一会切回默认标签 → 白屏。

## 2. 根因分析

火影忍者Online 是 Flash（PPAPI）游戏。Flash 插件有一个由浏览器进程管理的「渲染表面」。

只要 webview 被 CSS 隐藏，Chromium 就停止合成该 webview，Flash 表面随之被释放。之前依次尝试的 `display:none`、`width:0/height:0`、`visibility:hidden` 都会触发表面释放；切回时表面未重建，表现为白屏。

因此问题的本质是「隐藏 Flash webview 导致表面丢失」，与是否开启拉伸无关。

## 3. 解决方案：z-index 层叠替代隐藏

- 所有 webview 保持全尺寸、始终渲染，**永不隐藏**，Flash 表面不被释放。
- 激活标签 `z-index: 1` 置顶；非激活标签 `z-index: 0` + `pointer-events: none` 被盖在下面。
- webview 加 `background`，避免激活标签加载期间露出下层标签。

### CSS 改动（game.html）

```css
.webview-wrap webview {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  background: #fff;
}
.webview-wrap webview.hidden {
  z-index: 0;
  pointer-events: none;
}
.webview-wrap webview.paused {
  z-index: 0;
  pointer-events: none;
}
```

> `.hidden` / `.paused` 的 class 切换逻辑（switchTab、window-blur/minimized）保持不变，仅改 CSS 表现。

## 4. 受影响文件

| 文件 | 修改类型 | 位置 |
|------|----------|------|
| `game.html` | 修改 | `.webview-wrap webview` / `.hidden` / `.paused` CSS |

## 5. 权衡与边界

- 后台标签仍渲染（占 CPU/GPU），多开较多时资源占用上升；这是「消除白屏」的必然代价。
- 若后续资源占用过高，可在此基础上加「后台手动节流」优化。
- 激活标签加载期间用 `background` 遮挡下层，避免闪现旧标签内容。

## 6. 预期结果

- 切换任意标签立即显示，不再白屏。
- 拉伸 + 多开 + 切回场景恢复正常。
