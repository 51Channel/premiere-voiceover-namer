// 启动：在 Premiere 里接上 Node 和 ExtendScript；在浏览器预览里用假数据。
(function () {
  'use strict';
  if (window.VNPreviewApi) {
    window.VNUI.mount(window.VNPreviewApi);
    return;
  }
  var cep = window.__adobe_cep__;
  var req = (window.cep_node && window.cep_node.require) || window.require;
  if (!cep || !req) {
    document.getElementById('heroTitle').textContent = '要在 Premiere 里打开';
    document.getElementById('heroSub').textContent = '窗口 → 扩展 → 录音改名';
    return;
  }
  var fs = req('fs');
  var crypto = req('crypto');
  var cp = req('child_process');
  var isMac = /Mac/i.test(navigator.platform || '');

  // 跟着 PR 的界面亮度走
  function theme() {
    try {
      var env = JSON.parse(cep.getHostEnvironment());
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

  var storage = {
    get: function (k) {
      try { var v = window.localStorage.getItem(k); return v === null ? null : JSON.parse(v); } catch (e) { return null; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    }
  };

  var host = window.VNHostBridge.createHost(function (script, cb) { cep.evalScript(script, cb); });
  var engine = new window.VNEngine.Engine({ host: host, fs: fs, crypto: crypto, storage: storage });

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
    fileUrl: fileUrl,
    reveal: function (p) {
      if (isMac) cp.execFile('open', ['-R', p]);
      else cp.execFile('explorer.exe', ['/select,', p]);
    }
  });
  engine.start();
})();
