// 启动：在 Premiere 里接上 Node 和 ExtendScript；在浏览器预览里用假数据。
(function () {
  'use strict';
  var log = window.VNLog;
  var C = window.VNCore;
  if (window.VNPreviewApi) {
    window.VN_MOUNTED = true;
    window.VNUI.mount(window.VNPreviewApi);
    return;
  }
  var cep = window.__adobe_cep__;
  var req = (window.cep_node && window.cep_node.require) || window.require;
  if (!cep || !req) {
    document.getElementById('heroTitle').textContent = '要在 Premiere 里打开';
    document.getElementById('heroSub').textContent = '窗口 → 扩展 → 赫朝录音改名';
    return;
  }
  var fs = req('fs');
  var path = req('path');
  var os = req('os');
  var crypto = req('crypto');
  var cp = req('child_process');
  var isMac = os.platform() === 'darwin';

  log.setContext('插件版本', C.VERSION);
  log.setContext('系统', os.platform() + ' ' + os.release());
  log.info('面板启动 ' + C.VERSION + '，' + os.platform() + ' ' + os.release());

  // 跟着 PR 的界面亮度走
  function theme() {
    try {
      var env = JSON.parse(cep.getHostEnvironment());
      log.setContext('Premiere', (env.appName || '') + ' ' + (env.appVersion || ''));
      var c = env.appSkinInfo.panelBackgroundColor.color;
      var rgb = function (d) {
        return 'rgb(' + [c.red, c.green, c.blue].map(function (v) { return Math.max(0, Math.min(255, Math.round(v + d))); }).join(',') + ')';
      };
      var s = document.documentElement.style;
      s.setProperty('--bg', rgb(0));
      s.setProperty('--card', rgb(9));
      s.setProperty('--card-hover', rgb(15));
    } catch (e) {}
  }
  theme();
  try { cep.addEventListener('com.adobe.csxs.events.ThemeColorChanged', theme); } catch (e) {}

  // 老版 PR（CEP 9 带的 Node 8）没有 url.pathToFileURL，自己拼
  function fileUrl(p) {
    var s = String(p).replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(s)) s = '/' + s;
    return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  // 插件自己的文件夹（从页面地址推出来）
  function extDir() {
    var p = decodeURIComponent(location.pathname);
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
    return path.dirname(p);
  }

  var storage = {
    get: function (k) {
      try { var v = window.localStorage.getItem(k); return v === null ? null : JSON.parse(v); } catch (e) { return null; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    }
  };

  var host = window.VNHostBridge.createHost(function (script, cb) { cep.evalScript(script, cb); });
  var engine = new window.VNEngine.Engine({ host: host, fs: fs, crypto: crypto, storage: storage, log: log });

  var lastPhase = '';
  engine.subscribe(function (s) {
    if (s.project) log.setContext('工程', s.project.name + (s.project.path ? '（' + s.project.path + '）' : ''));
    if (s.phase !== lastPhase && (s.phase === 'unsaved' || s.phase === 'noProject' || (s.phase === 'connecting' && s.connectFails === 9))) {
      log.warn('状态：' + s.phase + (s.connectFails ? '，连不上 ' + s.connectFails + ' 次' : ''));
    }
    lastPhase = s.phase;
  });

  // 自动更新：启动 30 秒后看一次，之后每 6 小时；正在改名时不换
  var updateInfo = { text: '' };
  var updater = new window.VNUpdater.Updater({
    get: window.VNUpdater.nodeGet(req('https'), req('buffer').Buffer),
    fs: fs, path: path, crypto: crypto, extDir: extDir(), repo: C.REPO, version: C.VERSION, log: log
  });
  function checkUpdate() {
    if (engine.state.busy) { setTimeout(checkUpdate, 60000); return; }
    updater.check().then(function (r) {
      if (!r.updated) {
        if (r.reason && r.reason !== '已是最新') log.info('自动更新跳过：' + r.reason);
        return;
      }
      // 新的 host.jsx 重新载入 Premiere，再刷新面板
      var jsx = path.join(extDir(), 'jsx', 'host.jsx').replace(/\\/g, '/');
      cep.evalScript('$.evalFile(new File(' + C.jsxString(jsx) + '))', function () {
        storage.set('vn.updatedTo', r.version);
        location.reload();
      });
    }, function (e) {
      log.warn('自动更新没成功：' + e.message);
    });
  }
  setTimeout(checkUpdate, 30000);
  setInterval(checkUpdate, 6 * 3600 * 1000);
  var updatedTo = storage.get('vn.updatedTo');
  if (updatedTo) {
    storage.set('vn.updatedTo', null);
    if (updatedTo === C.VERSION) {
      updateInfo.text = '刚自动更新到 ' + C.VERSION;
      engine.note('自动更新到 ' + C.VERSION, 'ok');
    }
  }

  window.VN_MOUNTED = true;
  window.VNUI.mount({
    subscribe: function (fn) { engine.subscribe(fn); },
    setAuto: function (on) { engine.setAuto(on); },
    fixOld: function () { return engine.fixOld(); },
    fixDuplicates: function () { return engine.fixDuplicates(); },
    duplicatePlan: function () { return engine.duplicatePlan(); },
    label: function (rec, text) { return engine.label(rec, text); },
    select: function (ids) { return engine.select(ids); },
    retry: function () { engine.retry(); },
    dismissError: function () { engine.dismissError(); },
    copyReport: function () { return log.copyReport(); },
    version: C.VERSION,
    updateInfo: updateInfo,
    fileUrl: fileUrl,
    reveal: function (p) {
      if (isMac) cp.execFile('open', ['-R', p]);
      else cp.execFile('explorer.exe', ['/select,', p]);
    }
  });
  engine.start();
})();
