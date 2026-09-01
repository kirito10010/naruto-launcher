# 修复多开标签切换白屏 —— 完成总结

## 完成情况

| 任务 | 内容 | 状态 |
|------|------|------|
| Task 1 | 改为 z-index 层叠，不再隐藏 webview | ✅ |
| Task 2 | 校验 | ✅ |

## 根因

Flash（PPAPI）的渲染表面在 webview 被 CSS 隐藏（display:none / width:0 / visibility:hidden）时会被 Chromium 释放，切回时未重建 → 白屏。之前三种隐藏方式都未能解决。

## 改动（game.html CSS）

- `.webview-wrap webview` 增加 `z-index: 1` 与 `background: #fff`。
- `.webview-wrap webview.hidden` / `.paused` 由 `visibility: hidden` 改为 `z-index: 0; pointer-events: none`。

核心：不再隐藏 webview，改为层叠——所有标签保持全尺寸、始终渲染，激活标签置顶显示，非激活标签被盖在下面。Flash 表面永不释放。

## 校验

- 内联脚本语法校验通过（`SYNTAX OK`）。
- `.hidden`/`.paused` class 切换逻辑（switchTab、window-blur/minimized）未改动，仅改 CSS 表现。

## 权衡

后台标签仍渲染（占 CPU/GPU），多开较多时资源占用上升，换取「切回无白屏」。如需优化资源，可后续加「后台手动节流」。
