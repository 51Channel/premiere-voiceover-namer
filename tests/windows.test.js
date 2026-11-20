'use strict';
// Windows 才有的情况：Premiere 占着旧文件时删不掉。只在 Windows 上跑（GitHub 的 Windows 测试机）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Engine } = require('../extension/com.hechao.voiceover-namer/js/engine.js');
const { createHost } = require('../extension/com.hechao.voiceover-namer/js/host-bridge.js');
const { createPremiere, writeWav } = require('./helpers/fake-premiere.js');

const onWindows = process.platform === 'win32';

// 用 PowerShell 像 Premiere 一样打开文件：别人能读，但不能删、不能改名
function holdFile(file, seconds) {
  const ps = `$f=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','Read','Read'); Write-Output locked; Start-Sleep -Seconds ${seconds}; $f.Close()`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', ps]);
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('locked')) resolve(child); });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error('PowerShell 提前退出：' + code)));
  });
}

test('Premiere 占着旧文件：照样改好，旧文件等松手后再删', { skip: !onWindows && '只在 Windows 上跑' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-win-'));
  const projDir = path.join(dir, '赫朝 第12期');
  fs.mkdirSync(projDir, { recursive: true });
  const projPath = path.join(projDir, '318最终版.prproj');
  fs.writeFileSync(projPath, 'x');
  const pr = createPremiere(projPath);
  let clock = Date.now();
  const store = {};
  const engine = new Engine({
    host: createHost(pr.evalScript), fs, crypto, now: () => clock, schedule: () => 0,
    storage: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
  });
  await engine.tick();
  const raw = path.join(projDir, '音频 1.wav');
  writeWav(raw, 2);
  const item = pr.record('音频 1.wav', raw);
  const holder = await holdFile(raw, 6);
  holder.removeAllListeners('exit');
  await engine.tick();
  await engine.tick();
  assert.match(path.basename(item.getMediaPath()), /^318最终版_配音01_/);
  assert.strictEqual(engine.state.phase, 'done', engine.state.error && engine.state.error.text);
  assert.ok(fs.existsSync(raw), '占用时旧文件应该还在');
  assert.strictEqual(engine.state.waitingDeletes, 1);
  await new Promise((r) => holder.on('exit', r));
  clock += 11000;
  await engine.tick();
  assert.ok(!fs.existsSync(raw), '松手后旧文件应该删掉');
  assert.strictEqual(engine.state.waitingDeletes, 0);
});

test('Windows 路径：盘符大小写、反斜杠不影响认出同一个文件', { skip: !onWindows && '只在 Windows 上跑' }, () => {
  const C = require('../extension/com.hechao.voiceover-namer/js/core.js');
  const p = path.join(os.tmpdir(), 'a.wav');
  assert.ok(C.samePath(p, p.toUpperCase().replace(/\\/g, '/')));
});
