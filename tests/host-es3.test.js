'use strict';
// Premiere 里的 ExtendScript 是很老的 JavaScript（ES3）：新语法在 PR 里直接报错，Node 里却能跑，所以单独查。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'com.hechao.voiceover-namer', 'jsx', 'host.jsx'), 'utf8')
  .replace(/\/\/.*$/gm, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');

test('host.jsx 只用 ExtendScript 认识的写法', () => {
  const banned = [
    [/\b(let|const|class)\s/, 'let / const / class'],
    [/=>/, '箭头函数'],
    [/`/, '模板字符串'],
    [/\.(forEach|map|filter|reduce|indexOf|some|every|trim|includes|startsWith|endsWith)\s*\(/, '数组 / 字符串的新方法'],
    [/\bJSON\./, 'JSON（PR 里不一定有）'],
    [/\.\.\./, '展开语法'],
    [/\bObject\.(keys|assign|entries)/, 'Object 新方法'],
  ];
  for (const [re, what] of banned) {
    const m = src.match(re);
    assert.ok(!m, `用了 ${what}：${m && m[0]}`);
  }
});
