// 浏览器预览用的假数据：?state=ready|empty|waiting|working|done|error|unsaved|paused|old|dup|connecting
(function () {
  'use strict';
  var C = window.VNCore;
  var q = new URLSearchParams(location.search);
  var which = q.get('state') || 'ready';
  var dir = '/Users/hehe/剪辑/318最终版/Adobe Premiere Pro Captured and Generated';

  function peaks(seed, n) {
    var out = [];
    var r = seed;
    for (var i = 0; i < (n || 96); i++) {
      r = (r * 9301 + 49297) % 233280;
      var noise = r / 233280;
      var phrase = Math.abs(Math.sin(i / (5 + seed % 4)));
      out.push(Math.min(1, 0.08 + phrase * (0.35 + noise * 0.65) * (i % 23 < 3 ? 0.15 : 1)));
    }
    return out;
  }

  var labels = ['', '开场白', '', '规则说明', '', '结尾'];
  var now = Date.now();
  var recordings = [];
  for (var n = 6; n >= 1; n--) {
    var label = labels[n - 1];
    var t = now - (6 - n) * 7 * 60000 - 60000;
    var stamp = C.stampOf(new Date(t));
    var file = C.recordingFileName({ project: '318最终版', number: n, label: label, stamp: stamp });
    recordings.push({
      path: dir + '/' + file, ids: ['id' + n], fileName: file, mtime: t,
      duration: [12.4, 41.2, 8.9, 73.5, 22.1, 5.6][n - 1], peaks: peaks(n * 7),
      number: n, label: label, stamp: stamp, display: C.displayName(n, label)
    });
  }

  var base = {
    phase: 'ready', auto: true,
    project: { name: '318最终版', sequence: '正片 v3' },
    current: null, lastDone: null, error: null,
    nextDisplay: '配音07', recordings: recordings, oldRecordings: [], duplicates: [],
    busy: false, waitingDeletes: 0, connectFails: 0, log: []
  };

  var old = [1, 2, 3].map(function (i) {
    return { path: '/Users/hehe/剪辑/318最终版/音频 ' + i + '.wav', ids: ['o' + i], fileName: '音频 ' + i + '.wav', mtime: now - 86400000 + i * 60000, duration: 9 + i * 7, peaks: peaks(i * 13) };
  });
  var dups = [
    { fileName: '片头.mp4', files: [
      { path: '/Users/hehe/素材/通用/片头.mp4', ids: ['d1'], names: ['片头.mp4'] },
      { path: '/Volumes/外置盘/第11期/片头.mp4', ids: ['d2'], names: ['片头.mp4'] }] },
    { fileName: 'bgm_轻快.mp3', files: [
      { path: '/Users/hehe/素材/BGM/bgm_轻快.mp3', ids: ['d3'], names: ['bgm_轻快.mp3'] },
      { path: '/Users/hehe/Downloads/bgm_轻快.mp3', ids: ['d4'], names: ['bgm_轻快.mp3'] }] }
  ];

  var patch = {
    ready: {},
    empty: { recordings: [], nextDisplay: '配音01' },
    waiting: { phase: 'waiting', current: { from: '音频 7.wav' } },
    working: { phase: 'working', current: { from: '音频 7.wav', to: '配音07' }, busy: true },
    done: { phase: 'done', lastDone: { from: '音频 7.wav', to: '配音06', fileName: recordings[0].fileName, at: now }, nextDisplay: '配音07' },
    error: { phase: 'error', error: { text: '音频 7.wav：这条素材不能换文件（可能是合并片段或代理）', retry: '/x', sticky: true } },
    unsaved: { phase: 'unsaved', project: { name: '未命名项目', sequence: '序列 01' }, recordings: [] },
    paused: { phase: 'paused', auto: false },
    old: { oldRecordings: old, duplicates: dups },
    dup: { oldRecordings: old, duplicates: dups },
    connecting: { phase: 'connecting', project: null, recordings: [] }
  }[which] || {};

  var state = Object.assign({}, base, patch);
  var listeners = [];
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  window.VNPreviewApi = {
    subscribe: function (fn) { listeners.push(fn); fn(state); },
    setAuto: function (on) { state.auto = on; state.phase = on ? 'ready' : 'paused'; emit(); },
    fixOld: function () {}, fixDuplicates: function () {},
    duplicatePlan: function () { return C.planDuplicateRenames(state.duplicates, function () { return false; }); },
    label: function () {}, select: function () {}, retry: function () {}, dismissError: function () {},
    fileUrl: function () { return ''; }, reveal: function () {}
  };
  if (which === 'old' || which === 'dup') {
    setTimeout(function () {
      var btns = document.querySelectorAll('.notice button');
      btns[which === 'old' ? 0 : 1].click();
    }, 50);
  }
})();
