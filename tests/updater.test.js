'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const U = require('../extension/com.hechao.voiceover-namer/js/updater.js');
const C = require('../extension/com.hechao.voiceover-namer/js/core.js');

const root = path.join(__dirname, '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function setup(remote) {
  const ext = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vn-up-')), 'com.hechao.voiceover-namer');
  fs.mkdirSync(path.join(ext, 'js'), { recursive: true });
  fs.writeFileSync(path.join(ext, 'js', 'core.js'), 'old core');
  fs.writeFileSync(path.join(ext, 'index.html'), 'old html');
  const hits = [];
  const get = (url) => {
    hits.push(url);
    if (url in remote) return remote[url] instanceof Error ? Promise.reject(remote[url]) : Promise.resolve(Buffer.from(remote[url]));
    return Promise.reject(new Error('HTTP 404'));
  };
  const up = new U.Updater({ get, fs, path, crypto, extDir: ext, repo: 'x/y', version: '1.1.0' });
  return { ext, up, hits };
}

const commit = 'a'.repeat(40);
const raw = (p) => `https://raw.githubusercontent.com/x/y/${commit}/extension/com.hechao.voiceover-namer/${p}`;
const cdn = (p) => `https://cdn.jsdelivr.net/gh/x/y@${commit}/extension/com.hechao.voiceover-namer/${p}`;

test('版本比较', () => {
  assert.ok(U.newer('1.10.0', '1.9.3'));
  assert.ok(!U.newer('1.1.0', '1.1.0'));
  assert.ok(!U.newer('1.0.9', '1.1.0'));
});

test('有新版本：全部下载核对后替换；GitHub 不通换 jsDelivr', async () => {
  const manifest = { version: '1.2.0', commit, files: [{ path: 'js/core.js', sha256: sha('new core') }, { path: 'jsx/host.jsx', sha256: sha('new jsx') }] };
  const { ext, up } = setup({
    'https://raw.githubusercontent.com/x/y/release/update.json': new Error('超时'),
    'https://cdn.jsdelivr.net/gh/x/y@release/update.json': JSON.stringify(manifest),
    [raw('js/core.js')]: 'new core',
    [cdn('jsx/host.jsx')]: 'new jsx',
  });
  const r = await up.check();
  assert.deepStrictEqual(r, { updated: true, version: '1.2.0' });
  assert.strictEqual(fs.readFileSync(path.join(ext, 'js', 'core.js'), 'utf8'), 'new core');
  assert.strictEqual(fs.readFileSync(path.join(ext, 'jsx', 'host.jsx'), 'utf8'), 'new jsx');
  assert.ok(!fs.existsSync(path.join(ext, 'js', 'core.js.vn-new')));
});

test('有一个文件对不上：一个都不换', async () => {
  const manifest = { version: '1.2.0', commit, files: [{ path: 'js/core.js', sha256: sha('new core') }, { path: 'index.html', sha256: sha('new html') }] };
  const { ext, up } = setup({
    'https://raw.githubusercontent.com/x/y/release/update.json': JSON.stringify(manifest),
    [raw('js/core.js')]: 'new core',
    [raw('index.html')]: 'tampered',
  });
  await assert.rejects(up.check(), /对不上/);
  assert.strictEqual(fs.readFileSync(path.join(ext, 'js', 'core.js'), 'utf8'), 'old core');
});

test('已是最新、可疑路径都不动', async () => {
  const a = setup({ 'https://raw.githubusercontent.com/x/y/release/update.json': JSON.stringify({ version: '1.1.0', commit, files: [] }) });
  assert.strictEqual((await a.up.check()).updated, false);
  const b = setup({ 'https://raw.githubusercontent.com/x/y/release/update.json': JSON.stringify({ version: '9.0.0', commit, files: [{ path: '../../evil.js', sha256: 'x' }] }) });
  await assert.rejects(b.up.check(), /可疑路径/);
});

test('源码仓库里直接跑（开发）不自动更新', async () => {
  const up = new U.Updater({ get: () => Promise.reject(new Error('不该联网')), fs, path, crypto, extDir: path.join(root, 'extension', 'com.hechao.voiceover-namer'), repo: 'x/y', version: '1.0.0' });
  assert.strictEqual((await up.check()).reason, '开发版不自动更新');
});

test('更新清单覆盖插件所有文件，版本号三处一致', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts', 'make-update.mjs'), commit]);
  const m = JSON.parse(out);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = fs.readFileSync(path.join(root, 'extension/com.hechao.voiceover-namer/CSXS/manifest.xml'), 'utf8');
  assert.strictEqual(m.version, pkg.version);
  assert.strictEqual(C.VERSION, pkg.version);
  assert.ok(manifest.includes(`ExtensionBundleVersion="${pkg.version}"`));
  for (const p of ['index.html', 'CSXS/manifest.xml', 'jsx/host.jsx', 'js/updater.js', 'js/log.js']) assert.ok(m.files.some((f) => f.path === p), p);
});
