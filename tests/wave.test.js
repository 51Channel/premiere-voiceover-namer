'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../extension/com.hechao.voiceover-namer/js/wave.js');
const { writeWav } = require('./helpers/fake-premiere.js');

test('读出时长和波形', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-wave-'));
  const f = path.join(dir, 'a.wav');
  writeWav(f, 3);
  const info = W.readInfo(fs, f, 48);
  assert.ok(Math.abs(info.duration - 3) < 0.01);
  assert.strictEqual(info.peaks.length, 48);
  // 两头轻、中间响
  assert.ok(info.peaks[24] > 0.5 && info.peaks[0] < 0.1);
});

test('不是 WAV 就返回空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-wave-'));
  const f = path.join(dir, 'b.wav');
  fs.writeFileSync(f, 'hello');
  assert.strictEqual(W.readInfo(fs, f), null);
});
