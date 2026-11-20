// 插件模拟环境：不装 Premiere，在 Electron（和 CEP 同样是 Chromium + Node）里打开真正的面板，
// 接一个假的 Premiere 工程，按真实用法走一遍：打开面板 → 录一条 → 起名 → 改老录音 → 改撞名素材 → 暂停。
// 每一步截图到 out/sim/<系统>/，检查结果写进 result.json；有一步不对就以失败退出。
// 用法：npx electron sim/main.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeWav } = require('../tests/helpers/fake-premiere.js');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'out', 'sim', process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : process.platform);
const checks = [];
const consoleErrors = [];
let shotNo = 0;

function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '通过  ' : '失败  ') + name + (detail ? '  ' + detail : ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 假工程：中文路径、带空格；一条装插件前录的老录音；两个撞名的片头
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-sim-'));
  const projDir = path.join(base, '赫朝 第12期');
  const cap = path.join(projDir, 'Adobe Premiere Pro Captured and Generated');
  fs.mkdirSync(cap, { recursive: true });
  const projPath = path.join(projDir, '318最终版.prproj');
  fs.writeFileSync(projPath, 'x');
  const oldRec = path.join(cap, '音频 1.wav');
  writeWav(oldRec, 3);
  for (const d of ['A', 'B']) {
    fs.mkdirSync(path.join(projDir, d), { recursive: true });
    fs.writeFileSync(path.join(projDir, d, '片头.mp4'), d);
  }

  const setupFile = path.join(base, 'setup.json');
  fs.writeFileSync(setupFile, JSON.stringify([
    { kind: 'record', name: '音频 1.wav', path: oldRec },
    { kind: 'import', name: '片头.mp4', path: path.join(projDir, 'A', '片头.mp4') },
    { kind: 'import', name: '片头.mp4', path: path.join(projDir, 'B', '片头.mp4'), bin: '素材' },
  ]));
  const win = new BrowserWindow({
    width: 340, height: 600, x: -3000, y: 0,
    show: false, paintWhenInitiallyHidden: true, backgroundColor: '#232323',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true, contextIsolation: false, sandbox: false,
      additionalArguments: ['--vn-project=' + projPath, '--vn-setup=' + setupFile],
    },
  });
  // Windows 上藏起来的窗口不重画，截图会慢一拍：放到屏幕外显示（不抢前台）
  if (process.platform === 'win32') win.showInactive();
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) consoleErrors.push(`${message}（${path.basename(source || '')}:${line}）`);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const text = (sel) => js(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
  async function shot(name) {
    win.webContents.invalidate();
    await sleep(500);
    const img = await win.webContents.capturePage();
    const file = path.join(outDir, String(++shotNo).padStart(2, '0') + '-' + name + '.png');
    fs.writeFileSync(file, img.toPNG());
  }
  async function waitFor(desc, fn, ms) {
    const end = Date.now() + (ms || 12000);
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(250);
    }
    const hero = await js(`document.getElementById('heroTitle').textContent + '｜' + document.getElementById('heroSub').textContent`);
    check(desc, false, '等了 ' + Math.round((ms || 12000) / 1000) + ' 秒，面板显示：' + hero);
    await shot('卡住-' + desc);
    return false;
  }

  await win.loadFile(path.join(root, 'extension', 'com.hechao.voiceover-namer', 'index.html'));

  // 1. 打开面板
  if (await waitFor('打开面板后进入待命', async () => (await text('#heroTitle')) === '点音轨上的麦克风直接录')) check('打开面板后进入待命', true);
  check('空列表提示跟着工程走', (await text('.empty')).includes('点时间线音轨'), await text('.empty'));
  check('显示工程名和序列', (await text('#where')).includes('318最终版'), await text('#where'));
  check('提示老录音和撞名素材', (await js(`document.querySelectorAll('.notice').length`)) === 2);
  await shot('打开面板');

  // 2. 录一条：文件先“正在写”，过一会儿写完
  const newRec = path.join(cap, '音频 2.wav');
  writeWav(newRec, 5);
  const now = new Date();
  fs.utimesSync(newRec, now, now);
  await js(`window.__vnSim.pr.record('音频 2.wav', ${JSON.stringify(newRec)}); 0`);
  await sleep(600);
  await shot('刚录完-等写完');
  if (await waitFor('录完自动改名', async () => (await text('#heroTitle')) === '改好了')) check('录完自动改名', true, await text('#heroSub'));
  const capFiles = fs.readdirSync(cap);
  const renamed = capFiles.find((f) => /^318最终版_配音01_\d{4}-\d{4}\.wav$/.test(f));
  check('磁盘上改成 318最终版_配音01_时间.wav', !!renamed, capFiles.join(' | '));
  check('原来的 音频 2.wav 删掉了', !fs.existsSync(newRec));
  check('时间线片段改名为 配音01', (await js(`window.__vnSim.pr.clips()[1].name`)) === '配音01');
  check('列表里出现这条录音', (await js(`document.querySelectorAll('.rec').length`)) === 1);
  check('画面上显示“改好了”', (await text('#heroTitle')) === '改好了');
  await shot('录完自动改名');

  // 3. 起名
  await js(`document.querySelector('.rec [data-act="label"]').click()`);
  await sleep(200);
  await js(`(() => { const i = document.querySelector('.rec-edit'); i.value = '开场白'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
  await waitFor('起名生效', async () => fs.readdirSync(cap).some((f) => f.includes('_开场白_')));
  check('起名后文件带上“开场白”', fs.readdirSync(cap).some((f) => /^318最终版_配音01_开场白_\d{4}-\d{4}\.wav$/.test(f)), fs.readdirSync(cap).join(' | '));
  await sleep(1500);
  check('列表显示 配音01 开场白', (await text('.rec .rec-name')).replace(/\s/g, '') === '配音01开场白', await text('.rec .rec-name'));
  await shot('起名');

  // 4. 老录音
  await js(`document.querySelector('.notice [data-act="old"]').click()`);
  await shot('老录音-确认');
  await js(`document.getElementById('sheetOk').click()`);
  await waitFor('老录音改好', async () => !fs.existsSync(oldRec));
  await sleep(1500);
  check('老录音改成 配音02', fs.readdirSync(cap).some((f) => /^318最终版_配音02_\d{4}-\d{4}\.wav$/.test(f)), fs.readdirSync(cap).join(' | '));
  await shot('老录音-改好');

  // 5. 撞名素材
  await js(`document.querySelector('.notice [data-act="dup"]').click()`);
  await shot('撞名素材-确认');
  await js(`document.getElementById('sheetOk').click()`);
  await waitFor('撞名素材改好', async () => fs.existsSync(path.join(projDir, 'A', '片头_2.mp4')) || fs.existsSync(path.join(projDir, 'B', '片头_2.mp4')));
  await sleep(1500);
  check('提示条都消失了', (await js(`document.querySelectorAll('.notice').length`)) === 0);
  await shot('撞名素材-改好');

  // 6. 暂停
  await js(`document.getElementById('autoToggle').click()`);
  await sleep(500);
  check('暂停后显示“自动改名关着”', (await text('#heroTitle')) === '自动改名关着');
  await shot('暂停');

  // 7. 出错：这条素材 Premiere 不让换文件（比如合并片段）
  await js(`document.getElementById('autoToggle').click()`);
  const badRec = path.join(cap, '音频 3.wav');
  writeWav(badRec, 2);
  await js(`(() => { const it = window.__vnSim.pr.record('音频 3.wav', ${JSON.stringify(badRec)}); it.canChangeMediaPath = () => false; })(); 0`);
  if (await waitFor('出错时显示“没改成”', async () => (await text('#heroTitle')) === '没改成')) check('出错时显示“没改成”', true, await text('#heroSub'));
  check('出错时原文件不动', fs.existsSync(badRec));
  check('出错画面有“复制问题报告”', (await text('#heroActions')).includes('复制问题报告'));
  await shot('出错');
  if (process.env.CI) {
    await win.webContents.executeJavaScript(`document.querySelector('#heroActions [data-act="report"]').click()`, true);
    await sleep(1500);
    const copied = require('electron').clipboard.readText();
    check('问题报告复制到剪贴板', copied.includes('赫朝录音改名 问题报告') && copied.includes('音频 3.wav'), copied.slice(0, 80));
  }

  check('页面没有报错', consoleErrors.length === 0, consoleErrors.join(' / '));
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ platform: process.platform, electron: process.versions.electron, ok: failed.length === 0, checks, consoleErrors }, null, 2));
  console.log(failed.length ? `\n${failed.length} 项失败` : '\n全部通过');
  console.log('截图：' + outDir);
  fs.rmSync(base, { recursive: true, force: true });
  return failed.length ? 1 : 0;
}

// 每次都用全新的设置（像刚装好插件），不受上一次模拟影响
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'vn-sim-profile-')));

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  return main();
}).then((code) => app.exit(code), (e) => {
  console.error(e);
  app.exit(2);
});
