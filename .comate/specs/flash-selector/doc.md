# Flash 版本选择器（内置国际版 ↔ 系统国内版）

## 1. 需求场景与处理逻辑

**场景**：系统已安装国内重橙版 Flash（`C:\Windows\System32\Macromed\Flash\pepflashplayer64_34_0_0_380.dll`，34.0.0.380，360/QQ 同款）。当前启动器固定用内置国际版 32.0.0.344。

**需求**：在启动器加一个选择器，让用户切换使用哪个 Flash：
- 内置国际版 32.0.0.344（默认，随包分发，稳定）。
- 系统国内版 34.0.0.380（重橙版，针对国内页游优化，可能更流畅）。

**处理逻辑**：
- 配置项 `flashChoice`（`bundled` / `system`）。
- 启动时 `getFlashPath()` 根据 `flashChoice` 选择 Flash 路径（`ppapi-flash-path` 在 app 启动前设置，故切换后需重启生效）。
- 启动器 UI 加下拉选择器，切换后保存配置并提示重启。

## 2. 架构与技术方案

- `getFlashPath()` 读取 `config.flashChoice`（同步读 CONFIG_FILE，因该函数在 config 加载前执行）。
- 新增 `set-flash-choice` IPC，保存配置并弹窗提示重启。
- 启动器 HTML 加 `<select>`，did-finish-load 时下发当前选择。

## 3. 受影响文件

### `d:\Project\Naruto Online\main.js`（修改）
- 初始 `config` 增加 `flashChoice: 'bundled'`；`loadConfig` 补默认。
- `getFlashPath()` 按 `flashChoice` 分支选择路径，并带兜底。
- `app.whenReady` 增加 `set-flash-choice` IPC。
- 启动器 HTML 模板增加 Flash 下拉框与脚本；did-finish-load 下发 `flash-choice`。

## 4. 实现细节

### 4.1 getFlashPath 分支

```js
function getFlashPath() {
  const arch = process.arch === 'x64' ? '64' : '32';
  const sysDir = process.arch === 'x64' ? 'System32' : 'SysWOW64';

  let flashChoice = 'bundled';
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      flashChoice = cfg.flashChoice || 'bundled';
    }
  } catch (e) {}

  const bundled = [
    getResourcePath('flash', `pepflashplayer${arch}_32_0_0_344.dll`),
    getResourcePath('flash', `pepflashplayer${arch}_34_0_0_380.dll`),
    getResourcePath('flash', 'pepflashplayer.dll'),
    `C:\\Windows\\${sysDir}\\Macromed\\Flash\\pepflashplayer${arch}_32_0_0_344.dll`,
    path.join(__dirname, 'flash', 'pepflashplayer.dll')
  ];
  const system = [
    `C:\\Windows\\${sysDir}\\Macromed\\Flash\\pepflashplayer${arch}_34_0_0_380.dll`,
    `C:\\Windows\\System32\\Macromed\\Flash\\pepflashplayer64_34_0_0_380.dll`,
    `C:\\Windows\\SysWOW64\\Macromed\\Flash\\pepflashplayer32_34_0_0_380.dll`
  ];

  const paths = (flashChoice === 'system') ? system.concat(bundled) : bundled.concat(system);
  for (const p of paths) {
    if (fs.existsSync(p)) { log('找到Flash插件: ' + p); return p; }
  }
  return null;
}
```

### 4.2 set-flash-choice IPC

```js
ipcMain.on('set-flash-choice', (event, choice) => {
  config.flashChoice = (choice === 'system') ? 'system' : 'bundled';
  saveConfig();
  dialog.showMessageBox({
    type: 'info',
    title: 'Flash 版本切换',
    message: '已切换 Flash 版本，重启启动器后生效。',
    buttons: ['知道了']
  });
});
```

### 4.3 启动器下拉框与脚本

HTML（footer 之前）：
```html
<div class="flash-selector">
  <label>Flash 版本</label>
  <select id="flashSelect" onchange="changeFlash(this.value)">
    <option value="bundled">内置国际版 32.0.0.344</option>
    <option value="system">系统国内版 34.0.0.380</option>
  </select>
</div>
```

脚本：
```js
function changeFlash(choice) { ipcRenderer.send('set-flash-choice', choice); }
ipcRenderer.on('flash-choice', (event, choice) => {
  const sel = document.getElementById('flashSelect');
  if (sel) sel.value = choice || 'bundled';
});
```

did-finish-load 下发：
```js
launcherWindow.webContents.send('flash-choice', config.flashChoice);
```

## 5. 边界条件与异常处理

- **系统 Flash 缺失**：paths 兜底回退到内置 Flash，不会无 Flash。
- **切换后生效时机**：`ppapi-flash-path` 在 app 启动前设置，切换需重启，已弹窗提示。
- **NPAPI 不提供**：NPAPI 在 Chromium 87 不可用，选择器只提供 PPAPI 两个版本。
- **架构匹配**：64 位 Electron 用 `System32\pepflashplayer64_34_0_0_380.dll`。

## 6. 数据流路径

启动器下拉 → `set-flash-choice` → 保存 `config.flashChoice` → 重启 → `getFlashPath()` 读配置选路径 → `ppapi-flash-path` 生效。

## 7. 预期结果

- 用户可切换内置/系统 Flash，选系统国内版后可能进一步接近 360 流畅度。
- 切换重启后按所选 Flash 加载游戏。
