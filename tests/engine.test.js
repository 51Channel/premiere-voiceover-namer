'use strict';
// 整条链路：真正的 host.jsx 跑在假 Premiere 里，面板引擎读写真文件。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Engine } = require('../extension/com.hechao.voiceover-namer/js/engine.js');
const { createHost } = require('../extension/com.hechao.voiceover-namer/js/host-bridge.js');
const { createPremiere, writeWav } = require('./helpers/fake-premiere.js');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-e2e-'));
  const projDir = path.join(dir, '赫朝 第12期');
  fs.mkdirSync(projDir, { recursive: true });
  const projPath = path.join(projDir, '318最终版.prproj');
  fs.writeFileSync(projPath, 'x');
  const pr = createPremiere(projPath);
  const store = {};
  const engine = new Engine({
    host: createHost(pr.evalScript),
    fs,
    crypto,
    storage: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
    schedule: () => 0,
  });
  return { dir, projDir, projPath, pr, engine, store };
}

async function ticks(engine, n) {
  for (let i = 0; i < n; i++) await engine.tick();
}

test('新录音：录完自动改名，文件、素材箱、时间线都换掉，老文件删掉', async () => {
  const { projDir, pr, engine } = setup();
  const cap = path.join(projDir, 'Adobe Premiere Pro Captured and Generated');
  await ticks(engine, 1);
  assert.strictEqual(engine.state.phase, 'ready');
  assert.strictEqual(engine.state.project.name, '318最终版');

  const raw = path.join(cap, '音频 1.wav');
  writeWav(raw, 2);
  const before = fs.readFileSync(raw);
  const item = pr.record('音频 1.wav', raw);
  await ticks(engine, 1); // 第一次看到：记下大小
  assert.ok(fs.existsSync(raw));
  await ticks(engine, 1); // 第二次没变：改名
  const files = fs.readdirSync(cap);
  assert.strictEqual(files.length, 1, files.join(','));
  assert.match(files[0], /^318最终版_配音01_\d{4}-\d{4}\.wav$/);
  assert.deepStrictEqual(fs.readFileSync(path.join(cap, files[0])), before);
  assert.strictEqual(item.getMediaPath(), path.join(cap, files[0]));
  assert.strictEqual(item.name, '配音01');
  assert.strictEqual(pr.clips()[0].name, '配音01');
  assert.strictEqual(engine.state.phase, 'done');
  assert.strictEqual(engine.state.recordings.length, 1);
  assert.ok(engine.state.recordings[0].peaks.length === 96);
  assert.strictEqual(engine.state.nextDisplay, '配音02');

  // 第二条接着编号
  const raw2 = path.join(cap, '音频 2.wav');
  writeWav(raw2, 1);
  pr.record('音频 2.wav', raw2);
  await ticks(engine, 2);
  assert.deepStrictEqual(engine.state.recordings.map((r) => r.display), ['配音02', '配音01']);
});

test('还在写的文件不动', async () => {
  const { projDir, pr, engine } = setup();
  await ticks(engine, 1);
  const raw = path.join(projDir, '音频 1.wav');
  writeWav(raw, 1);
  const now = new Date();
  fs.utimesSync(raw, now, now); // 刚写过
  pr.record('音频 1.wav', raw);
  await ticks(engine, 3);
  assert.ok(fs.existsSync(raw));
  assert.strictEqual(engine.state.phase, 'waiting');
});

test('自动关掉就不改；打开后补上', async () => {
  const { projDir, pr, engine } = setup();
  await ticks(engine, 1);
  engine.setAuto(false);
  const raw = path.join(projDir, '音频 1.wav');
  writeWav(raw, 1);
  pr.record('音频 1.wav', raw);
  await ticks(engine, 3);
  assert.ok(fs.existsSync(raw));
  assert.strictEqual(engine.state.phase, 'paused');
  engine.setAuto(true);
  await ticks(engine, 2);
  assert.ok(!fs.existsSync(raw));
});

test('打开工程时就有的老录音只提示，点了才改；按录制先后编号', async () => {
  const { projDir, pr, engine } = setup();
  const a = path.join(projDir, '音频 1.wav');
  const b = path.join(projDir, 'sub', '音频 1.wav');
  writeWav(a, 1);
  writeWav(b, 1);
  fs.utimesSync(b, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  const ia = pr.record('音频 1.wav', a);
  const ib = pr.record('音频 1.wav', b);
  await ticks(engine, 3);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
  assert.strictEqual(engine.state.oldRecordings.length, 2);
  await engine.fixOld();
  assert.strictEqual(ib.name, '配音01');
  assert.strictEqual(ia.name, '配音02');
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
  assert.strictEqual(engine.state.oldRecordings.length, 0);
  assert.strictEqual(engine.state.recordings.length, 2);
});

test('起名：编号和时间不变，只加名字', async () => {
  const { projDir, pr, engine } = setup();
  await ticks(engine, 1);
  const raw = path.join(projDir, '音频 1.wav');
  writeWav(raw, 1);
  const item = pr.record('音频 1.wav', raw);
  await ticks(engine, 2);
  const rec = engine.state.recordings[0];
  await engine.label(rec, '开场白');
  const after = engine.state.recordings[0];
  assert.strictEqual(after.display, '配音01 开场白');
  assert.strictEqual(after.stamp, rec.stamp);
  assert.strictEqual(path.basename(item.getMediaPath()), `318最终版_配音01_开场白_${rec.stamp}.wav`);
  assert.strictEqual(pr.clips()[0].name, '配音01 开场白');
  assert.ok(!fs.existsSync(rec.path));
});

test('同名素材：第二个改成 _2，素材名跟着改，自己起的素材名不动', async () => {
  const { projDir, pr, engine } = setup();
  const a = path.join(projDir, 'A', '片头.mp4');
  const b = path.join(projDir, 'B', '片头.mp4');
  const c = path.join(projDir, 'C', '片头.mp4');
  for (const f of [a, b, c]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, f); }
  pr.importFile('片头.mp4', a);
  const bin = pr.addBin('素材');
  const ib = pr.importFile('片头.mp4', b, bin);
  const ic = pr.importFile('C版开头', c, bin);
  await ticks(engine, 1);
  assert.strictEqual(engine.state.duplicates.length, 1);
  await engine.fixDuplicates();
  assert.strictEqual(ib.getMediaPath(), path.join(projDir, 'B', '片头_2.mp4'));
  assert.strictEqual(ib.name, '片头_2.mp4');
  assert.strictEqual(ic.getMediaPath(), path.join(projDir, 'C', '片头_3.mp4'));
  assert.strictEqual(ic.name, 'C版开头');
  assert.strictEqual(fs.readFileSync(ic.getMediaPath(), 'utf8'), c);
  assert.ok(!fs.existsSync(b) && !fs.existsSync(c));
  assert.strictEqual(engine.state.duplicates.length, 0);
});

test('Premiere 换不了文件时不删原文件、把新文件收回', async () => {
  const { projDir, pr, engine } = setup();
  await ticks(engine, 1);
  const raw = path.join(projDir, '音频 1.wav');
  writeWav(raw, 1);
  const item = pr.record('音频 1.wav', raw);
  item.canChangeMediaPath = () => false;
  await ticks(engine, 2);
  assert.ok(fs.existsSync(raw));
  assert.deepStrictEqual(fs.readdirSync(projDir).sort(), ['318最终版.prproj', '音频 1.wav']);
  assert.strictEqual(engine.state.phase, 'error');
  assert.match(engine.state.error.text, /不能换文件/);
});

test('工程没保存：提示先保存，什么都不动', async () => {
  const { pr, engine } = setup();
  pr.app.project.path = '';
  await ticks(engine, 1);
  assert.strictEqual(engine.state.phase, 'unsaved');
  pr.app.project = null;
  await ticks(engine, 1);
  assert.strictEqual(engine.state.phase, 'noProject');
});

test('同一文件夹已有同名文件时绝不覆盖', async () => {
  const { projDir, pr, engine } = setup();
  await ticks(engine, 1);
  const raw = path.join(projDir, '音频 1.wav');
  writeWav(raw, 1);
  const st = fs.statSync(raw);
  const d = new Date(st.mtimeMs);
  const two = (n) => String(n).padStart(2, '0');
  const stamp = `${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  const blocker = path.join(projDir, `318最终版_配音01_${stamp}.wav`);
  fs.writeFileSync(blocker, 'someone else');
  const item = pr.record('音频 1.wav', raw);
  await ticks(engine, 2);
  assert.strictEqual(fs.readFileSync(blocker, 'utf8'), 'someone else');
  assert.strictEqual(path.basename(item.getMediaPath()), `318最终版_配音01_${stamp}_2.wav`);
});
