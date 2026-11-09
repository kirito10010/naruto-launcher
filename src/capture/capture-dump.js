// capture-dump.js —— [全量抓包] 全量抓包导出（独立模块）
//
// 由 main.js 在退出时 spawn 的子进程调用：<electron> . --dump-capture <mainPid>
// 职责：等主进程退出 → 把本次会话的原始抓包文件复制到桌面「火影全量抓包/<时间>/」→ 打开目录
//
// 说明：本模块与组织统计导出（export.js）完全独立。
//       删除「全量抓包」功能时，直接删掉本文件 + main.js 里带 [全量抓包] 标记的接入点即可，
//       不会影响组织统计（net-log + export.js + xlsx.js）。
const path = require('path');
const fs = require('fs');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

// 等主进程退出（netlog / jsonl 才会写完整）
async function waitMainExit(mainPid) {
  for (let i = 0; i < 600; i++) {          // 最多等 5 分钟
    if (!mainPid || !isAlive(mainPid)) break;
    await sleep(500);
  }
}

function stampForFolder() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds());
}

function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

async function runDump(opts) {
  const { app, shell } = require('electron');
  const userData = app.getPath('userData');
  const capDir = path.join(userData, 'captures');

  await waitMainExit(opts && opts.mainPid);
  await sleep(800);   // 再等一会，确保文件句柄释放

  if (!fs.existsSync(capDir)) throw new Error('未找到抓包目录（' + capDir + '）');

  const all = fs.readdirSync(capDir).map((f) => path.join(capDir, f));
  const netlogs = all.filter((f) => /^netlog-.*\.json$/.test(path.basename(f)));
  const jsonls = all.filter((f) => /^http-.*\.jsonl$/.test(path.basename(f)));
  if (!netlogs.length && !jsonls.length) throw new Error('未找到任何抓包文件');

  // 本次会话的 netlog = 最新的一个
  netlogs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const netlog = netlogs[0] || null;

  // 本次会话的 jsonl：创建时间不早于 netlog 的创建时间（留 10 分钟余量）
  let sessionJsonls = [];
  if (jsonls.length) {
    let sessionStart = 0;
    if (netlog) {
      const st = fs.statSync(netlog);
      sessionStart = Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs) - 10 * 60 * 1000;
    }
    sessionJsonls = jsonls
      .filter((f) => fs.statSync(f).mtimeMs >= sessionStart)
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    if (!sessionJsonls.length) sessionJsonls = [jsonls.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]];
  }

  const folderName = stampForFolder();
  let outDir = path.join(app.getPath('desktop'), '火影全量抓包', folderName);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    outDir = path.join(userData, '全量抓包', folderName);
    fs.mkdirSync(outDir, { recursive: true });
  }

  const copied = [];
  const copyOne = (src) => {
    const name = path.basename(src);
    fs.copyFileSync(src, path.join(outDir, name));
    copied.push({ name: name, size: fs.statSync(src).size });
  };
  if (netlog) copyOne(netlog);
  sessionJsonls.forEach(copyOne);

  // ---------- 说明.txt ----------
  const L = [];
  L.push('火影忍者Online 启动器 · 全量抓包导出');
  L.push('导出时间：' + new Date().toLocaleString());
  L.push('');
  L.push('一、文件说明');
  L.push('  netlog-*.json   Chromium 网络栈全量日志：DNS / socket / HTTP 事件，');
  L.push('                  以及 socket 上实际收发的原始字节（base64）。游戏协议就藏在这里。');
  L.push('  http-*.jsonl    通过 CDP 抓的 HTTP 请求/响应与 WebSocket 帧（含请求头与响应体）。');
  L.push('');
  L.push('二、本次导出文件');
  if (!copied.length) L.push('  （无）');
  copied.forEach((c) => L.push('  ' + c.name + '  —  ' + mb(c.size)));
  L.push('');
  L.push('三、分析提示（给 AI 或自己看都够用）');
  L.push('  · 游戏数据走明文 TCP，连的是 zone.huoying.qq.com:11096；');
  L.push('    在 netlog 里搜 "11096" 找到对应 socket，取 params.bytes（base64）解码即原始字节流。');
  L.push('  · 帧格式：36 字节头 + Protobuf 载荷。');
  L.push('    头：magic(2)=0x0901  长度(2)  命令号(4)  序号(4)  类型(4,1=客户端/2=加密/3=明文)');
  L.push('        保留(8)  selfuin(4)  selfRole(2)  serId(2)  保留(4)');
  L.push('  · 载荷解密：腾讯 TEA（密钥 d796c2542916b456，QQ+CBC 链，SALT 2 字节 / ZERO 7 字节）。');
  L.push('  · 已知命令号：组织成员 199179 / 捐献 199184 / 叛忍 852147 / 献祭 199209 /');
  L.push('                忍战 852296(跨服)、852233(本服)');
  L.push('');
  L.push('四、备注');
  L.push('  · 原始文件仍保留在启动器数据目录 %APPDATA%\\naruto-online-launcher\\captures，这里只是副本。');
  L.push('  · 全量抓包文件可能较大（net-log 常达数十至数百 MB），分析完可自行删除。');
  fs.writeFileSync(path.join(outDir, '说明.txt'), L.join('\r\n'), 'utf8');

  try { const p = shell.openPath(outDir); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  return outDir;
}

module.exports = { runDump };
