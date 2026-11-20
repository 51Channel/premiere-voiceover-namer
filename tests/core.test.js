'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../extension/com.hechao.voiceover-namer/js/core.js');

test('认得 Premiere 默认录音名', () => {
  for (const n of ['音频 1.wav', '音频 12_3.wav', 'Audio 4.wav', 'Audio 1_1.WAV', 'オーディオ 2.wav', '/a/b/音频 7.wav', 'C:\\x\\Audio 2.wav']) {
    assert.ok(C.isDefaultRecording(n), n);
  }
  for (const n of ['music.wav', '音频素材.wav', 'Audio 1.mp3', '318_配音01_1119-1530.wav', '我的音频 1.wav']) {
    assert.ok(!C.isDefaultRecording(n), n);
  }
});

test('录音文件名能来回解析', () => {
  const d = new Date(2026, 10, 19, 15, 30);
  const name = C.recordingFileName({ project: '318最终版.prproj', number: 7, date: d });
  assert.strictEqual(name, '318最终版_配音07_1119-1530.wav');
  assert.deepStrictEqual(C.parseRecording(name), { project: '318最终版', number: 7, label: '', stamp: '1119-1530', ext: 'wav' });
  const labeled = C.recordingFileName({ project: '318最终版', number: 123, label: '开场 白/啊', stamp: '1119-1530', attempt: 2 });
  assert.strictEqual(labeled, '318最终版_配音123_开场 白 啊_1119-1530_2.wav');
  const p = C.parseRecording(labeled);
  assert.strictEqual(p.number, 123);
  assert.strictEqual(p.label, '开场 白 啊');
  assert.strictEqual(C.displayName(7, '开场白'), '配音07 开场白');
});

test('工程名里的怪字符会换掉，空名有兜底', () => {
  assert.strictEqual(C.projectLabel('a:b*c?.prproj'), 'a_b_c_');
  assert.strictEqual(C.projectLabel(''), '未命名工程');
});

test('编号取最大的加一', () => {
  assert.strictEqual(C.nextNumber(['/x/音频 1.wav'], []), 1);
  assert.strictEqual(C.nextNumber(['/x/p_配音03_1119-1530.wav', '/y/p_配音09_开场_1119-1530.wav'], [10]), 11);
});

test('同名素材：不同文件夹同名才算，录音不算', () => {
  const items = [
    { id: '1', name: '片头.mp4', path: '/a/片头.mp4' },
    { id: '2', name: '片头.mp4', path: '/a/片头.mp4' },
    { id: '3', name: '片头', path: '/b/片头.MP4' },
    { id: '4', name: 'bgm', path: '/b/bgm.mp3' },
    { id: '5', name: '音频 1.wav', path: '/a/音频 1.wav' },
    { id: '6', name: '音频 1.wav', path: '/b/音频 1.wav' },
  ];
  const groups = C.findDuplicates(items);
  assert.strictEqual(groups.length, 1);
  assert.deepStrictEqual(groups[0].files.map((f) => f.ids), [['1', '2'], ['3']]);
  const plan = C.planDuplicateRenames(groups, (p) => p === '/b/片头_2.MP4');
  assert.deepStrictEqual(plan.map((s) => [s.from, s.to]), [['/b/片头.MP4', '/b/片头_3.MP4']]);
});

test('Windows 路径比较不分大小写', () => {
  assert.ok(C.samePath('C:\\A\\b.wav', 'c:/a/B.wav'));
  assert.ok(!C.samePath('/A/b.wav', '/a/b.wav'));
  assert.strictEqual(C.joinPath('C:\\a\\', 'x.wav'), 'C:\\a\\x.wav');
});

test('中文能安全拼进 ExtendScript', () => {
  assert.strictEqual(C.jsxString('音"\\'), '"\\u97f3\\"\\\\"');
  assert.strictEqual(C.formatDuration(65.4), '1:05');
  assert.strictEqual(C.formatDuration(3725), '1:02:05');
});
