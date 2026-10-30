# 喵问答抓包模式（1.9.0）

## 一、需求与场景

在启动器「设置 → 抓包模式」里新增一个选项：**题库抓包（喵问答）**。

用户重启启动器 → 进入游戏 → 找 NPC 参加「喵问答」→ 答完题 → 关闭游戏窗口 → 托盘右键「退出」。退出时自动在桌面生成：

```
火影题库/
  喵问答_2026-10-30_193000/
    questions.json
    images/
      03_10082.png
      ...
```

`questions.json` 每条记录：

```json
{
  "question": "【1X提供】图中所示为哪一种咒印？",
  "options": ["三勾玉咒印", "虎咒印", "天之咒印", "地之咒印"],
  "answer": "天之咒印",
  "removed": "三勾玉咒印",
  "image": "images/03_10082.png"
}
```

- `answer`：正确选项**原文**（不是 A/B/C/D，因为选项顺序每次可能不同）；拿不到时为空字符串。
- `removed`：本题被「活动加成」排除掉的那个错误选项原文（协议里有，每题都能拿到）。
- `image`：图片文件相对路径；无图题为 `""`。
- 只保留这 5 个字段，题号已经体现在图片文件名里。

## 二、协议事实（已用 20 题抓包验证）

游戏连接：`zone.huoying.qq.com:11096`，36 字节头 + TEA 加密 Protobuf。

| 命令号 | 方向 | 结构 |
| --- | --- | --- |
| 199684 | 服务端→客户端 | `f1`=结果；`f3`=题目对象；`f5`=上一题是否答对（1 对 / 0 错）；`f6`=计分信息 |
| 199684 | 客户端→服务端 | `f1`=提交的选项下标（0–3） |
| 199685 | 服务端→客户端 | `f2`=题目对象（第 2–20 题） |

题目对象：

```
f1 = 题号
f2 = 题干
f3 × 4 = 四个选项（顺序即下发给本客户端的顺序）
f4 = 配图资源 ID（仅带图题，如 "10082"）
f8 = 活动加成「排除一项错误答案」排除的选项下标
```

**重要限制**：协议里没有「正确答案」字段，判分在服务端。只有答对时，才能用「我方提交的下标 + 对错标志」反推出正确选项；答错时正确选项不可知，只能拿到 `bonusRemoved`（一个确定错误的选项）。这与现有「忍者检测」抓包的行为一致。

配图：客户端按 `https://res.huoying.qq.com/<版本路径>/assets/knowledgeTest/<ID>.png` 拉取，走 Chromium 的网络栈，现有 CDP 抓包层（`capture.js`）能拿到 URL 与响应体。

## 三、架构与技术方案

完全复用现有「题库抓包（忍者检测）」的骨架：独立导出模块 + `before-quit` 拉起子进程 + netlog 解析。

1. 新增 `miao-export.js`，导出 `runMiaoExport({ mainPid })` 与 `parseMiao(rx, tx)`。
2. `main.js`：
   - 顶部新增 `--export-miao` 子进程分支（放在单实例锁之前）。
   - `normalizeCaptureMode()` 增加 `miao`；`CAPTURE_MODE` 支持 `--capture-miao` 调试参数。
   - 抓包模式下拉框增加 `<option value="miao">题库抓包（喵问答）</option>`。
   - `HELP.capture` 增加喵问答说明段。
   - `set-capture-mode` 的中文标签增加 `miao`。
   - `before-quit` 增加 `miao` 分支，spawn `--export-miao`。
   - `capture.initCapture({ enabled: ... })` 改为 `full` 或 `miao` 时启用（喵问答要拿配图必须开 CDP）。
3. `package.json`：`build.files` 加入 `miao-export.js`，`version` → `1.9.0`，输出目录 → `release-v1.9.0`。

## 四、实现细节

### 4.1 题目解析（miao-export.js）

```js
const Q_MAIN = 199684;   // 第 1 题 + 作答响应
const Q_PUSH = 199685;   // 第 2–20 题

function parseQuestion(buf) {
  const q = pb(buf);
  const no = one(q, 1);
  const text = toText(one(q, 2)).trim();
  const options = all(q, 3).map(v => toText(v).trim()).filter(Boolean);
  if (!text || options.length < 2) return null;
  return {
    no: typeof no === 'number' ? no : null,
    question: text,
    options,
    imageId: one(q, 4) ? toText(one(q, 4)).trim() : '',
    removedIdx: typeof one(q, 8) === 'number' ? one(q, 8) : -1
  };
}
```

- `199684` 响应：`f3` 取题，`f5`（0/1）作为该次作答的对错标志。
- `199685` 帧：`f2` 取题。
- 题目按 `no` 升序去重（缺 `no` 的按到达顺序追加）。
- 上行 `199684` 的 `f1` 按下标顺序收集为我方作答。

### 4.2 答案配对

沿用忍者检测的「按下标顺序配对」策略：

```js
for (let i = 0; i < questions.length; i++) {
  const chosen = choices[i];                 // 第 i 次提交
  const correct = flags[i] === true;         // 第 i 次作答的对错
  const answer = (correct && options[chosen]) ? options[chosen] : '';
  const myChoice = options[chosen] || '';
}
```

若提交次数与题目数不一致（中途退出、漏答），仍按顺序尽量配对，未配对的一侧留空。

### 4.3 配图提取

1. 从 CDP 的 `http-*.jsonl` 里按 `url` 匹配 `/assets\/knowledgeTest\/(\d+)\.(png|jpg|jpeg|gif|webp)/`，记录 `requestId → url`。
2. 用同 `requestId` 的 `body` 事件（`base64:true`）还原字节。
3. 保存为 `images/<序号两位>_<ID>.<ext>`；题号取该 ID 对应的题目 `no + 1`。
4. CDP 没拿到响应体时，用抓到的 URL 直接 `https.get` 下载一次（5 秒超时，失败忽略）。
5. 多个题目共用同一张图时只保存一份，JSON 里各自引用同一路径。

### 4.4 会话文件选择

导出发生在主进程退出之后，`captures/` 里可能有多份历史文件。选择逻辑：

- netlog：最新的 `netlog-*.json`（与现有模块一致，`waitForNetlog`）。
- jsonl：`mtime >= netlog 创建时间 - 10 分钟` 的 `http-*.jsonl`，取最新一份。

### 4.5 输出

```
桌面/火影题库/喵问答_<YYYY-MM-DD_HHmmss>/
  questions.json
  images/*.png
```

创建失败（桌面不可写）时回退到 `%APPDATA%/naruto-online-launcher/火影题库/`。导出完成后 `shell.showItemInFolder(questions.json)`。

## 五、边界与异常

- 没参加活动 / 没抓到任何题目：仍生成 `questions.json`（空数组），不弹错误，日志记录原因。
- 题目重复出现（同一题被多次下发）：按题干去重，优先保留 `answer` 非空的那条。
- 无图题：`image` 为空字符串。
- 图片下载失败：`image` 为空，不影响 JSON 导出。
- CDP 未启用（用户没重启就参加活动）：只导出文字，无图。
- 选项数不是 4：按实际数量导出（防御性处理，正常不会出现）。

## 六、数据流

```
游戏客户端 ──TCP 11096──▶ netlog(原始字节)
                              │ 退出时子进程
                              ▼
                        miao-export.js
                              │  TEA 解密 + Protobuf 解析
                              ├─▶ questions.json（题目/选项/答案/排除项）
游戏客户端 ──HTTPS──▶ CDP jsonl ──▶ images/*.png
```

## 七、预期结果

- 设置里能选「题库抓包（喵问答）」，说明弹层有对应说明。
- 完整答一轮后退出，桌面生成 `喵问答_时间` 文件夹，含 20 题 JSON 与配图。
- 第 20 题（野原琳）应为：选项 `3 / 5 / 4 / 2`，`bonusRemoved` = `4`；若我方答对，`answer` = `3`。
- 版本号 1.9.0，产物在 `release-v1.9.0/`。
