// 面板和 Premiere 之间的那根线：把调用拼成 ExtendScript，交给 PR 执行，结果按 JSON 读回。
// evalScript(script, callback) 是 CEP 自带的；测试里换成在 Node 虚拟机里跑 host.jsx。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.VNHostBridge = factory(root.VNCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  function createHost(evalScript) {
    var queue = Promise.resolve();

    function call(fn, args) {
      var script = fn + '(' + (args || []).map(C.jsxString).join(',') + ')';
      var run = queue.then(function () {
        return new Promise(function (resolve, reject) {
          evalScript(script, function (text) {
            if (text === 'EvalScript error.' || text === undefined || text === null || text === '') {
              reject(new Error('Premiere 没回应'));
              return;
            }
            try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('Premiere 回的内容看不懂：' + String(text).slice(0, 80))); }
          });
        });
      });
      queue = run.catch(function () {});
      return run;
    }

    return {
      status: function () { return call('vnStatus'); },
      listMedia: function () { return call('vnListMedia'); },
      relink: function (ids, newPath, newName, renameClips) {
        return call('vnRelink', [ids.join(','), newPath, newName || '', renameClips ? '1' : '0']);
      },
      select: function (id) { return call('vnSelect', [id]); }
    };
  }

  return { createHost: createHost };
});
