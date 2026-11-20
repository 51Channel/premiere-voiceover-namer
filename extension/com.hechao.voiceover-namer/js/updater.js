// 自动更新：PR 开着时每 6 小时看一次 GitHub 上的 release 分支，有新版本就下载、核对、替换，面板自己刷新。
// release 分支只有在 Windows 和 Mac 测试都通过以后才会更新（见 .github/workflows/test.yml）。
// 先从 GitHub 下，下不动换 jsDelivr（国内通常快些）。任何一个文件对不上就整个放弃，不动现有文件。
(function (root, factory) {
  if (typeof window !== 'undefined' && window.document) root.VNUpdater = factory(root.VNCore);
  else module.exports = factory(require('./core.js'));
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var EXT = 'extension/com.hechao.voiceover-namer/';

  function manifestUrls(repo) {
    return [
      'https://raw.githubusercontent.com/' + repo + '/release/update.json',
      'https://cdn.jsdelivr.net/gh/' + repo + '@release/update.json'
    ];
  }

  function fileUrls(repo, commit, p) {
    return [
      'https://raw.githubusercontent.com/' + repo + '/' + commit + '/' + EXT + p,
      'https://cdn.jsdelivr.net/gh/' + repo + '@' + commit + '/' + EXT + p
    ];
  }

  // 1.10.0 > 1.9.3
  function newer(a, b) {
    var x = String(a).split('.').map(Number);
    var y = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  // Node 的 https：跟随跳转，20 秒超时
  function nodeGet(https, Buf) {
    return function get(url, hops) {
      hops = hops || 0;
      return new Promise(function (resolve, reject) {
        var req = https.get(url, { headers: { 'User-Agent': 'hechao-voiceover-namer' }, timeout: 20000 }, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
            res.resume();
            resolve(get(res.headers.location, hops + 1));
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error('HTTP ' + res.statusCode));
            return;
          }
          var chunks = [];
          res.on('data', function (c) { chunks.push(c); });
          res.on('end', function () { resolve(Buf.concat(chunks)); });
          res.on('error', reject);
        });
        req.on('timeout', function () { req.destroy(new Error('超时')); });
        req.on('error', reject);
      });
    };
  }

  function firstOk(get, urls) {
    var i = 0;
    var lastErr = null;
    function next() {
      if (i >= urls.length) return Promise.reject(lastErr || new Error('下载失败'));
      var u = urls[i++];
      return get(u).catch(function (e) { lastErr = e; return next(); });
    }
    return next();
  }

  // deps: { get, fs, path, crypto, extDir, repo, version, log }
  function Updater(deps) {
    this.d = deps;
  }

  Updater.prototype.canUpdate = function () {
    var d = this.d;
    if (!d.extDir) return '找不到插件文件夹';
    try {
      // 在源码仓库里直接跑（开发）就不自动更新
      if (d.fs.existsSync(d.path.join(d.extDir, '..', '..', '.git'))) return '开发版不自动更新';
      d.fs.accessSync(d.extDir, (d.fs.constants || {}).W_OK || 2);
    } catch (e) {
      return '插件文件夹不能写';
    }
    return '';
  };

  // 返回 { updated: bool, version, reason }
  Updater.prototype.check = function () {
    var d = this.d;
    var why = this.canUpdate();
    if (why) return Promise.resolve({ updated: false, reason: why });
    var info;
    return firstOk(d.get, manifestUrls(d.repo)).then(function (buf) {
      info = JSON.parse(String(buf));
      if (!info || !info.version || !info.commit || !Array.isArray(info.files)) throw new Error('更新清单格式不对');
      if (!newer(info.version, d.version)) return { updated: false, version: info.version, reason: '已是最新' };
      // 先全部下载到内存并核对，一个不对就放弃
      var got = [];
      var chain = Promise.resolve();
      info.files.forEach(function (f) {
        if (!/^[\w.\-\/]+$/.test(f.path) || f.path.indexOf('..') >= 0) throw new Error('更新清单里有可疑路径：' + f.path);
        chain = chain.then(function () {
          return firstOk(d.get, fileUrls(d.repo, info.commit, f.path)).then(function (buf) {
            var sum = d.crypto.createHash('sha256').update(buf).digest('hex');
            if (sum !== f.sha256) throw new Error(f.path + ' 下载下来对不上');
            got.push({ path: f.path, data: buf });
          });
        });
      });
      return chain.then(function () {
        // 先写成 .vn-new，全部写好再一个个换上
        got.forEach(function (g) {
          var target = d.path.join(d.extDir, g.path);
          d.fs.mkdirSync(d.path.dirname(target), { recursive: true });
          d.fs.writeFileSync(target + '.vn-new', g.data);
        });
        got.forEach(function (g) {
          var target = d.path.join(d.extDir, g.path);
          d.fs.renameSync(target + '.vn-new', target);
        });
        if (d.log) d.log.info('自动更新：' + d.version + ' → ' + info.version + '（' + got.length + ' 个文件）');
        return { updated: true, version: info.version };
      });
    });
  };

  return { Updater: Updater, newer: newer, nodeGet: nodeGet, manifestUrls: manifestUrls, fileUrls: fileUrls, EXT: EXT };
});
