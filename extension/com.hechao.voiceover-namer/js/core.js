// 命名规则和查重：纯函数，面板和 Node 测试共用。
// 录音文件名：<工程名>_配音<编号>[_<自己起的名字>]_<月日-时分>.wav，例如 318最终版_配音07_开场白_1119-1530.wav
// 素材箱和时间线上只显示短名：配音07 开场白
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VNCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Premiere 原生“画外音录制”默认生成的名字：音频 1.wav、音频 1_1.wav、Audio 3.wav……
  var DEFAULT_RECORDING = /^(?:音频|音訊|音声|オーディオ|Audio|Voice[- ]?over|画外音|旁白)\s*\d+(?:[_ ]\d+)*\.(?:wav|aiff?)$/i;
  var OUR_RECORDING = /^(.+)_配音(\d{2,})(?:_(.+?))?_(\d{4}-\d{4})(?:_(\d+))?\.(wav|aiff?)$/i;
  var FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

  function baseName(p) {
    var s = String(p || '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function dirName(p) {
    var s = String(p || '');
    var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(0, i) : '';
  }

  function joinPath(dir, name) {
    var sep = dir.indexOf('\\') >= 0 && dir.indexOf('/') < 0 ? '\\' : '/';
    return dir.replace(/[\\/]+$/, '') + sep + name;
  }

  function extName(p) {
    var b = baseName(p);
    var i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i + 1) : '';
  }

  function stem(p) {
    var b = baseName(p);
    var i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
  }

  // 比较路径时：Windows 路径不分大小写、斜杠统一
  function samePath(a, b) {
    return pathKey(a) === pathKey(b);
  }

  function pathKey(p) {
    var s = String(p || '').replace(/\\/g, '/');
    return /^[a-z]:\//i.test(s) || s.indexOf('//') === 0 ? s.toLowerCase() : s;
  }

  function cleanPart(text, max) {
    var s = String(text || '').replace(FORBIDDEN, '_').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
    var chars = Array.from ? Array.from(s) : s.split('');
    if (chars.length > max) s = chars.slice(0, max).join('').trim();
    return s;
  }

  function projectLabel(projectName) {
    var s = cleanPart(String(projectName || '').replace(/\.prproj$/i, ''), 40);
    return s || '未命名工程';
  }

  function cleanLabel(label) {
    return cleanPart(label, 24).replace(/_+/g, ' ').trim();
  }

  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function stampOf(date) {
    var d = date instanceof Date ? date : new Date(date);
    return two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes());
  }

  function padNumber(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function isDefaultRecording(fileName) {
    return DEFAULT_RECORDING.test(baseName(fileName));
  }

  function parseRecording(fileName) {
    var m = OUR_RECORDING.exec(baseName(fileName));
    if (!m) return null;
    return {
      project: m[1],
      number: parseInt(m[2], 10),
      label: m[3] || '',
      stamp: m[4],
      ext: m[6].toLowerCase()
    };
  }

  function recordingFileName(o) {
    var label = o.label ? cleanLabel(o.label) : '';
    var stamp = o.stamp || stampOf(o.date || new Date());
    var ext = (o.ext || 'wav').toLowerCase();
    var suffix = o.attempt > 1 ? '_' + o.attempt : '';
    return projectLabel(o.project) + '_配音' + padNumber(o.number) + (label ? '_' + label : '') + '_' + stamp + suffix + '.' + ext;
  }

  function displayName(number, label) {
    var l = label ? cleanLabel(label) : '';
    return '配音' + padNumber(number) + (l ? ' ' + l : '');
  }

  // 下一个编号：看这个工程里已经有的“配音NN”，取最大的加一。taken 是正在处理、还没进工程的编号。
  function nextNumber(paths, taken) {
    var max = 0;
    for (var i = 0; i < paths.length; i++) {
      var r = parseRecording(paths[i]);
      if (r && r.number > max) max = r.number;
    }
    (taken || []).forEach(function (n) { if (n > max) max = n; });
    return max + 1;
  }

  // 素材按文件分组：同一个文件可能在素材箱里有好几个素材项
  function groupByFile(items) {
    var map = {};
    var order = [];
    items.forEach(function (it) {
      if (!it.path) return;
      var k = pathKey(it.path);
      if (!map[k]) {
        map[k] = { path: it.path, ids: [], names: [] };
        order.push(k);
      }
      map[k].ids.push(it.id);
      map[k].names.push(it.name);
    });
    return order.map(function (k) { return map[k]; });
  }

  // 同名素材：不同文件夹里文件名一样的文件（不分大小写）。交接、收集工程时会互相覆盖。
  // 录音（默认名或我们的名字）不算，它们有专门的处理。
  function findDuplicates(items) {
    var files = groupByFile(items);
    var byName = {};
    var order = [];
    files.forEach(function (f) {
      var b = baseName(f.path);
      if (isDefaultRecording(b) || parseRecording(b)) return;
      var k = b.toLowerCase();
      if (!byName[k]) {
        byName[k] = [];
        order.push(k);
      }
      byName[k].push(f);
    });
    return order.filter(function (k) { return byName[k].length > 1; }).map(function (k) {
      return { fileName: baseName(byName[k][0].path), files: byName[k] };
    });
  }

  // 给同名素材排改名计划：每组第一个不动，其余在原文件夹里改成 原名_2.扩展名、原名_3……
  // exists(path) 判断磁盘上有没有这个文件。
  function planDuplicateRenames(groups, exists) {
    var planned = {};
    var plan = [];
    groups.forEach(function (g) {
      var n = 2;
      g.files.slice(1).forEach(function (f) {
        var dir = dirName(f.path);
        var ext = extName(f.path);
        var base = stem(f.path);
        var target;
        for (;;) {
          target = joinPath(dir, base + '_' + n + (ext ? '.' + ext : ''));
          n++;
          if (!planned[pathKey(target)] && !exists(target)) break;
        }
        planned[pathKey(target)] = true;
        plan.push({ from: f.path, to: target, ids: f.ids, names: f.names, fileName: g.fileName });
      });
    });
    return plan;
  }

  function formatDuration(seconds) {
    if (!(seconds >= 0)) return '';
    var s = Math.round(seconds);
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    if (h > 0) return h + ':' + two(m % 60) + ':' + two(s % 60);
    return m + ':' + two(s % 60);
  }

  // 把字符串拼进 evalScript：转义引号和反斜杠，所有非 ASCII 转成 \uXXXX（ExtendScript 对中文不可靠）
  function jsxString(value) {
    return '"' + String(value).replace(/[\\"]/g, function (c) { return '\\' + c; })
      .replace(/[^\x20-\x7e]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); }) + '"';
  }

  return {
    baseName: baseName,
    dirName: dirName,
    joinPath: joinPath,
    extName: extName,
    stem: stem,
    samePath: samePath,
    pathKey: pathKey,
    projectLabel: projectLabel,
    cleanLabel: cleanLabel,
    stampOf: stampOf,
    padNumber: padNumber,
    isDefaultRecording: isDefaultRecording,
    parseRecording: parseRecording,
    recordingFileName: recordingFileName,
    displayName: displayName,
    nextNumber: nextNumber,
    groupByFile: groupByFile,
    findDuplicates: findDuplicates,
    planDuplicateRenames: planDuplicateRenames,
    formatDuration: formatDuration,
    jsxString: jsxString
  };
});
