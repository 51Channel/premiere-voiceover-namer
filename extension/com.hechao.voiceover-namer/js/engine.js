// 面板的大脑：盯着工程，发现新录音就改名；也负责老录音、同名素材和手动起名。
// 依赖都从外面传进来（Premiere、文件系统、时间、存储），这样 Node 里能整套测。
(function (root, factory) {
  if (typeof window !== 'undefined' && window.document) root.VNEngine = factory(root.VNCore, root.VNWave);
  else module.exports = factory(require('./core.js'), require('./wave.js'));
})(typeof self !== 'undefined' ? self : this, function (C, W) {
  'use strict';

  var TICK_MS = 1200;
  var FULL_LIST_MS = 15000;
  var STABLE_MS = 1500;
  var DONE_SHOW_MS = 6000;
  var RETRY_DELETE_MS = 10000;
  var FRESH_MS = 120000;

  function Engine(deps) {
    this.host = deps.host;
    this.fs = deps.fs;
    this.crypto = deps.crypto || null;
    this.now = deps.now || function () { return Date.now(); };
    this.storage = deps.storage || { get: function () { return null; }, set: function () {} };
    this.schedule = deps.schedule || function (fn, ms) { return setTimeout(fn, ms); };
    this.log = deps.log || null;
    this.listeners = [];
    this.timer = null;
    this.running = false;
    this.queue = Promise.resolve();
    this.waveCache = {};
    this.observed = {};
    this.projectKey = null;
    this.sessionStart = this.now();
    this.baseline = null;
    this.items = [];
    this.lastSig = null;
    this.lastList = 0;
    this.lastDeleteTry = 0;
    this.takenNumbers = [];
    this.failed = {};
    var saved = this.storage.get('vn.pendingDeletes');
    this.pendingDeletes = Array.isArray(saved) ? saved : [];
    var auto = this.storage.get('vn.auto');
    this.state = {
      phase: 'connecting',
      auto: auto === null || auto === undefined ? true : !!auto,
      project: null,
      current: null,
      lastDone: null,
      error: null,
      nextDisplay: C.displayName(1),
      recordings: [],
      oldRecordings: [],
      duplicates: [],
      busy: false,
      connectFails: 0,
      waitingDeletes: this.pendingDeletes.length,
      log: []
    };
  }

  Engine.prototype.subscribe = function (fn) {
    this.listeners.push(fn);
    fn(this.state);
  };

  Engine.prototype.emit = function () {
    var s = this.state;
    this.listeners.forEach(function (fn) { try { fn(s); } catch (e) {} });
  };

  Engine.prototype.set = function (patch) {
    for (var k in patch) this.state[k] = patch[k];
    this.emit();
  };

  Engine.prototype.note = function (text, kind) {
    if (this.log) this.log[kind === 'error' ? 'error' : 'info'](text);
    var log = [{ text: text, kind: kind || 'info', at: this.now() }].concat(this.state.log).slice(0, 30);
    this.set({ log: log });
  };

  Engine.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.loop();
  };

  Engine.prototype.stop = function () {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  };

  Engine.prototype.loop = function () {
    var self = this;
    if (!this.running) return;
    this.tick().catch(function () {}).then(function () {
      if (self.running) self.timer = self.schedule(function () { self.loop(); }, TICK_MS);
    });
  };

  Engine.prototype.setAuto = function (on) {
    this.storage.set('vn.auto', !!on);
    this.set({ auto: !!on, phase: this.idlePhase(!!on) });
    if (on) this.lastSig = null;
  };

  Engine.prototype.idlePhase = function (auto) {
    var s = this.state;
    if (!s.project) return s.phase;
    return (auto === undefined ? s.auto : auto) ? 'ready' : 'paused';
  };

  // 串行：同一时间只做一件改文件的事
  Engine.prototype.serial = function (fn) {
    var self = this;
    var run = this.queue.then(function () {
      self.set({ busy: true });
      return fn();
    });
    this.queue = run.catch(function () {}).then(function () { self.set({ busy: false }); });
    return run;
  };

  Engine.prototype.tick = function () {
    var self = this;
    return this.host.status().then(function (st) {
      if (!st || !st.ok) {
        self.set({ phase: 'connecting', project: null, connectFails: self.state.connectFails + 1 });
        return;
      }
      if (self.state.connectFails) self.state.connectFails = 0;
      if (!st.open) {
        self.resetProject(null);
        self.set({ phase: 'noProject', project: null });
        return;
      }
      if (!st.saved) {
        self.resetProject(null);
        self.set({ phase: 'unsaved', project: { name: C.projectLabel(st.name), sequence: st.sequence } });
        return;
      }
      if (self.projectKey !== C.pathKey(st.path)) self.resetProject(C.pathKey(st.path));
      var project = { name: C.projectLabel(st.name), sequence: st.sequence, path: st.path };
      var changed = !self.state.project || self.state.project.name !== project.name || self.state.project.sequence !== project.sequence;
      if (changed) self.set({ project: project });
      var due = st.sig !== self.lastSig || self.now() - self.lastList > FULL_LIST_MS;
      var p = due ? self.refresh(st.sig) : Promise.resolve();
      return p.then(function () {
        if (self.state.busy) return;
        var keep = self.state.phase === 'done' && self.now() - (self.state.lastDone ? self.state.lastDone.at : 0) < DONE_SHOW_MS;
        if (self.state.phase === 'error' && self.state.error && self.state.error.sticky) keep = true;
        if (!keep && self.state.phase !== 'waiting') self.set({ phase: self.idlePhase() });
        return self.watchNew().then(function () { return self.retryDeletes(); });
      });
    }, function () {
      self.set({ phase: 'connecting', connectFails: self.state.connectFails + 1 });
    });
  };

  Engine.prototype.resetProject = function (key) {
    if (this.projectKey === key) return;
    this.projectKey = key;
    this.sessionStart = this.now();
    this.baseline = null;
    this.items = [];
    this.lastSig = null;
    this.observed = {};
    this.takenNumbers = [];
    this.failed = {};
    this.state.recordings = [];
    this.state.oldRecordings = [];
    this.state.duplicates = [];
    this.state.error = null;
  };

  Engine.prototype.refresh = function (sig) {
    var self = this;
    return this.host.listMedia().then(function (res) {
      if (!res || !res.ok) return;
      self.lastSig = sig === undefined ? self.lastSig : sig;
      self.lastList = self.now();
      self.items = res.items || [];
      self.analyze();
    });
  };

  Engine.prototype.exists = function (p) {
    try { return this.fs.existsSync(p); } catch (e) { return false; }
  };

  Engine.prototype.statOf = function (p) {
    try { return this.fs.statSync(p); } catch (e) { return null; }
  };

  Engine.prototype.waveOf = function (p, st) {
    var key = C.pathKey(p) + '|' + st.size + '|' + st.mtimeMs;
    if (this.waveCache[key] !== undefined) return this.waveCache[key];
    var info = null;
    try { info = W.readInfo(this.fs, p, 96); } catch (e) {}
    this.waveCache[key] = info;
    return info;
  };

  Engine.prototype.describe = function (f) {
    var st = this.statOf(f.path);
    if (!st) return null;
    var info = this.waveOf(f.path, st);
    return {
      path: f.path,
      ids: f.ids,
      names: f.names,
      fileName: C.baseName(f.path),
      mtime: st.mtimeMs,
      size: st.size,
      duration: info ? info.duration : null,
      peaks: info ? info.peaks : null
    };
  };

  Engine.prototype.analyze = function () {
    var self = this;
    var files = C.groupByFile(this.items);
    var recordings = [];
    var defaults = [];
    files.forEach(function (f) {
      var b = C.baseName(f.path);
      var r = C.parseRecording(b);
      if (r) {
        var d = self.describe(f);
        if (!d) return;
        d.number = r.number;
        d.label = r.label;
        d.stamp = r.stamp;
        d.display = C.displayName(r.number, r.label);
        recordings.push(d);
      } else if (C.isDefaultRecording(b)) {
        defaults.push(f);
      }
    });
    recordings.sort(function (a, b) { return b.number - a.number || b.mtime - a.mtime; });
    if (this.baseline === null) {
      this.baseline = {};
      defaults.forEach(function (f) { self.baseline[C.pathKey(f.path)] = true; });
    }
    var old = [];
    this.candidates = [];
    // 只有这次打开工程以后才写出来的“音频 N”才自动改；更早的文件就算刚出现在工程里（比如工程加载慢）也只提示
    defaults.forEach(function (f) {
      var st = self.statOf(f.path);
      var fresh = st && st.mtimeMs >= self.sessionStart - FRESH_MS;
      if (self.baseline[C.pathKey(f.path)] || (st && !fresh)) {
        var d = self.describe(f);
        if (d) old.push(d);
      } else {
        self.candidates.push(f);
      }
    });
    old.sort(function (a, b) { return a.mtime - b.mtime; });
    var next = C.nextNumber(files.map(function (f) { return f.path; }), this.takenNumbers);
    this.state.recordings = recordings;
    this.state.oldRecordings = old;
    this.state.duplicates = C.findDuplicates(this.items);
    this.state.nextDisplay = C.displayName(next);
    this.emit();
  };

  // 新录音：等文件写完（大小和修改时间连续不变、最后一次写入已过 1.5 秒）再改名
  Engine.prototype.watchNew = function () {
    var self = this;
    if (!this.candidates || !this.candidates.length) return Promise.resolve();
    var ready = [];
    var waiting = null;
    this.candidates.forEach(function (f) {
      var key = C.pathKey(f.path);
      if (self.failed[key]) return;
      var st = self.statOf(f.path);
      if (!st) return;
      var prev = self.observed[key];
      var now = self.now();
      self.observed[key] = { size: st.size, mtime: st.mtimeMs };
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs && now - st.mtimeMs >= STABLE_MS) ready.push(f);
      else waiting = f;
    });
    if (!this.state.auto) return Promise.resolve();
    if (!ready.length) {
      if (waiting) this.set({ phase: 'waiting', current: { from: C.baseName(waiting.path) } });
      return Promise.resolve();
    }
    return this.serial(function () {
      var chain = Promise.resolve();
      ready.forEach(function (f) {
        chain = chain.then(function () {
          return self.renameRecording(f, {}).catch(function (e) {
            self.failed[C.pathKey(f.path)] = true;
            self.fail(C.baseName(f.path) + '：' + e.message, f);
          });
        });
      });
      return chain;
    }).then(function () { return self.refresh(); });
  };

  Engine.prototype.fail = function (text, file) {
    this.note(text, 'error');
    this.set({ phase: 'error', error: { text: text, sticky: true, retry: file ? file.path : null } });
  };

  Engine.prototype.dismissError = function () {
    this.set({ error: null, phase: this.idlePhase() });
  };

  Engine.prototype.retry = function () {
    var e = this.state.error;
    this.failed = {};
    this.observed = {};
    this.dismissError();
    if (e && e.retry) this.lastSig = null;
  };

  Engine.prototype.hashOf = function (p) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var h = self.crypto.createHash('md5');
      var s = self.fs.createReadStream(p);
      s.on('data', function (d) { h.update(d); });
      s.on('error', reject);
      s.on('end', function () { resolve(h.digest('hex')); });
    });
  };

  // 把 src 放到 dst，不覆盖任何已有文件。先试硬链接（瞬间完成、Premiere 不会看到文件消失），
  // 不支持硬链接的盘（exFAT、网络盘）就复制一份再核对内容；allowMove 时（大视频）改用原地改名。
  Engine.prototype.place = function (src, dst, allowMove) {
    var fs = this.fs;
    var self = this;
    try {
      fs.linkSync(src, dst);
      return Promise.resolve('link');
    } catch (e) {
      if (e && e.code === 'EEXIST') return Promise.reject(e);
    }
    if (allowMove) {
      if (this.exists(dst)) return Promise.reject(Object.assign(new Error('目标已存在'), { code: 'EEXIST' }));
      fs.renameSync(src, dst);
      return Promise.resolve('move');
    }
    fs.copyFileSync(src, dst, fs.constants ? fs.constants.COPYFILE_EXCL : 1);
    if (!this.crypto) return Promise.resolve('copy');
    return Promise.all([this.hashOf(src), this.hashOf(dst)]).then(function (h) {
      if (h[0] !== h[1]) {
        try { fs.unlinkSync(dst); } catch (e2) {}
        throw new Error('复制出来的文件和原文件对不上');
      }
      return 'copy';
    }, function (err) {
      try { fs.unlinkSync(dst); } catch (e3) {}
      throw err;
    });
  };

  Engine.prototype.removeOld = function (src, keep) {
    try {
      this.fs.unlinkSync(src);
    } catch (e) {
      if (e && e.code === 'ENOENT') return;
      this.pendingDeletes.push({ path: src, keep: keep });
      this.storage.set('vn.pendingDeletes', this.pendingDeletes);
      this.set({ waitingDeletes: this.pendingDeletes.length });
    }
  };

  // Windows 上 Premiere 可能还占着旧文件，删不掉就过一会儿再删；工程里还有素材在用就不删
  Engine.prototype.retryDeletes = function () {
    if (!this.pendingDeletes.length || this.now() - this.lastDeleteTry < RETRY_DELETE_MS) return Promise.resolve();
    this.lastDeleteTry = this.now();
    var self = this;
    var used = {};
    this.items.forEach(function (it) { used[C.pathKey(it.path)] = true; });
    this.pendingDeletes = this.pendingDeletes.filter(function (d) {
      if (used[C.pathKey(d.path)]) return true;
      if (!self.exists(d.keep)) return false;
      try {
        self.fs.unlinkSync(d.path);
        return false;
      } catch (e) {
        return e && e.code !== 'ENOENT';
      }
    });
    this.storage.set('vn.pendingDeletes', this.pendingDeletes);
    this.set({ waitingDeletes: this.pendingDeletes.length });
    return Promise.resolve();
  };

  // 改一条录音：f = { path, ids }，o = { number?, label?, stamp? }
  Engine.prototype.renameRecording = function (f, o) {
    var self = this;
    var st = this.statOf(f.path);
    if (!st) return Promise.reject(new Error('文件找不到了'));
    var number = o.number || C.nextNumber(this.items.map(function (it) { return it.path; }), this.takenNumbers);
    this.takenNumbers.push(number);
    var project = this.state.project ? this.state.project.name : '未命名工程';
    var dir = C.dirName(f.path);
    var ext = C.extName(f.path) || 'wav';
    var stamp = o.stamp || C.stampOf(new Date(st.mtimeMs));
    var display = C.displayName(number, o.label);
    var from = C.baseName(f.path);
    var was = C.parseRecording(from);
    if (was) from = C.displayName(was.number, was.label);
    this.set({ phase: 'working', current: { from: from, to: display } });

    function attempt(n) {
      var name = C.recordingFileName({ project: project, number: number, label: o.label, stamp: stamp, ext: ext, attempt: n });
      var dst = C.joinPath(dir, name);
      if (C.samePath(dst, f.path)) return Promise.resolve({ dst: dst, mode: 'same' });
      if (self.exists(dst)) return attempt(n + 1);
      return self.place(f.path, dst, false).then(function (mode) { return { dst: dst, mode: mode }; }, function (e) {
        if (e && e.code === 'EEXIST' && n < 20) return attempt(n + 1);
        throw e;
      });
    }

    return attempt(1).then(function (r) {
      return self.host.relink(f.ids, r.dst, display, true).then(function (res) {
        if (!res || !res.ok) {
          if (r.mode !== 'same') { try { self.fs.unlinkSync(r.dst); } catch (e) {} }
          throw new Error(res && res.errors && res.errors.length ? res.errors.join('；') : 'Premiere 没换成新文件');
        }
        if (r.mode !== 'same') self.removeOld(f.path, r.dst);
        self.items.forEach(function (it) {
          if (f.ids.indexOf(it.id) >= 0) {
            it.path = r.dst;
            it.name = display;
          }
        });
        var done = { from: from, to: display, fileName: C.baseName(r.dst), at: self.now() };
        self.note(from + ' → ' + display, 'ok');
        self.set({ phase: 'done', lastDone: done, current: null, error: null });
        return done;
      });
    }).catch(function (e) {
      // 没改成就把编号还回去
      var at = self.takenNumbers.lastIndexOf(number);
      if (at >= 0 && !o.number) self.takenNumbers.splice(at, 1);
      throw e;
    });
  };

  // 给已经改过名的录音起个名字（“开场白”），编号和时间不变
  Engine.prototype.label = function (rec, label) {
    var self = this;
    return this.serial(function () {
      return self.renameRecording({ path: rec.path, ids: rec.ids }, { number: rec.number, stamp: rec.stamp, label: label });
    }).catch(function (e) {
      self.fail('起名没成功：' + e.message, null);
    }).then(function () { return self.refresh(); });
  };

  // 老录音：工程里本来就有、还叫“音频 N”的，按录制时间先后一条条编号
  Engine.prototype.fixOld = function () {
    var self = this;
    var list = this.state.oldRecordings.slice();
    if (!list.length) return Promise.resolve();
    return this.serial(function () {
      var chain = Promise.resolve();
      var ok = 0;
      var bad = [];
      list.forEach(function (rec) {
        chain = chain.then(function () {
          return self.renameRecording(rec, {}).then(function () {
            ok++;
            delete self.baseline[C.pathKey(rec.path)];
          }, function (e) {
            bad.push(rec.fileName + '：' + e.message);
          });
        });
      });
      return chain.then(function () {
        if (bad.length) self.fail('改好 ' + ok + ' 条，' + bad.length + ' 条没改成：' + bad.join('；'), null);
        else self.set({ phase: 'done', lastDone: { from: list.length + ' 条老录音', to: '全部编好号', at: self.now() } });
      });
    }).then(function () { return self.refresh(); });
  };

  // 同名素材：每组留第一个，其余在原文件夹改成 原名_2 …；素材名跟着文件名走（用户自己改过的素材名不动）
  Engine.prototype.duplicatePlan = function () {
    var self = this;
    return C.planDuplicateRenames(this.state.duplicates, function (p) { return self.exists(p); });
  };

  Engine.prototype.fixDuplicates = function () {
    var self = this;
    var plan = this.duplicatePlan();
    if (!plan.length) return Promise.resolve();
    return this.serial(function () {
      var chain = Promise.resolve();
      var ok = 0;
      var bad = [];
      self.set({ phase: 'working', current: { from: plan.length + ' 个同名文件', to: '改成不重名' } });
      plan.forEach(function (step) {
        chain = chain.then(function () {
          return self.place(step.from, step.to, true).then(function (mode) {
            var oldBase = C.baseName(step.from);
            var rename = step.names.every(function (n) { return n === oldBase || n === C.stem(oldBase); });
            var newName = rename ? (step.names[0] === oldBase ? C.baseName(step.to) : C.stem(step.to)) : '';
            return self.host.relink(step.ids, step.to, newName, false).then(function (res) {
              if (!res || !res.ok) {
                if (mode === 'move') { try { self.fs.renameSync(step.to, step.from); } catch (e) {} }
                else { try { self.fs.unlinkSync(step.to); } catch (e2) {} }
                throw new Error(res && res.errors ? res.errors.join('；') : 'Premiere 没换成新文件');
              }
              if (mode === 'link') self.removeOld(step.from, step.to);
              ok++;
            });
          }).catch(function (e) {
            var why = e && (e.code === 'EBUSY' || e.code === 'EPERM') ? '文件被占用' : e.message;
            bad.push(C.baseName(step.from) + '：' + why);
          });
        });
      });
      return chain.then(function () {
        if (bad.length) self.fail('改好 ' + ok + ' 个，' + bad.length + ' 个没改成：' + bad.join('；'), null);
        else {
          self.note('同名素材改好 ' + ok + ' 个', 'ok');
          self.set({ phase: 'done', current: null, lastDone: { from: ok + ' 个同名文件', to: '都不重名了', at: self.now() } });
        }
      });
    }).then(function () { return self.refresh(); });
  };

  Engine.prototype.select = function (ids) {
    return this.host.select(ids[0]);
  };

  return { Engine: Engine, TICK_MS: TICK_MS, STABLE_MS: STABLE_MS };
});
