// 模拟 CEP：在面板页面里放一个假的 __adobe_cep__，evalScript 交给假 Premiere（里面跑的是真正的 host.jsx）。
// Electron 开了 nodeIntegration、关了 contextIsolation，和 CEP 的 --enable-nodejs --mixed-context 一样：页面里能直接 require。
'use strict';
const path = require('path');
const { createPremiere, writeWav } = require('../tests/helpers/fake-premiere.js');

const arg = process.argv.find((a) => a.startsWith('--vn-project='));
const projectPath = arg ? arg.slice('--vn-project='.length) : '';
const pr = createPremiere(projectPath);

window.__adobe_cep__ = {
  evalScript(script, cb) { pr.evalScript(script, cb || (() => {})); },
  getHostEnvironment() {
    return JSON.stringify({ appName: 'PPRO', appVersion: '25.0.0', appSkinInfo: { panelBackgroundColor: { color: { red: 35, green: 35, blue: 35, alpha: 255 } } } });
  },
  addEventListener() {},
};

// 面板打开前工程里就有的素材（相当于打开一个已有工程）
const setupArg = process.argv.find((a) => a.startsWith('--vn-setup='));
if (setupArg) {
  const bins = {};
  JSON.parse(require('fs').readFileSync(setupArg.slice('--vn-setup='.length), 'utf8')).forEach((it) => {
    const bin = it.bin ? (bins[it.bin] = bins[it.bin] || pr.addBin(it.bin)) : null;
    if (it.kind === 'record') pr.record(it.name, it.path, bin);
    else pr.importFile(it.name, it.path, bin);
  });
}

// 给模拟脚本用：往假工程里录音、导入素材
window.__vnSim = { pr, writeWav, path };
