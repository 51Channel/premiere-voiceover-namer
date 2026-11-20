// 日志和问题报告：出了错不用描述，点“复制问题报告”粘贴发过来就行。
// 日志位置：Mac ~/Library/Logs/赫朝录音改名/log.txt；Windows %APPDATA%\赫朝录音改名\log.txt
// 这个文件最先加载：页面里任何没接住的错误都会记下来，面板没起来时也会把错误显示在状态栏上。
(function (root) {
  'use strict';
  var req = (root.cep_node && root.cep_node.require) || root.require;
  var fs = null;
  var file = null;
  var dir = null;
  var memory = [];

  try {
    fs = req('fs');
    var path = req('path');
    var os = req('os');
    var proc = (root.cep_node && root.cep_node.process) || root.process;
    dir = os.platform() === 'win32'
      ? path.join((proc && proc.env.APPDATA) || os.homedir(), '赫朝录音改名')
      : path.join(os.homedir(), 'Library', 'Logs', '赫朝录音改名');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'log.txt');
    try {
      if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
    } catch (e) {}
  } catch (e) {
    fs = null;
  }

  function stamp() {
    var d = new Date();
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }

  function write(level, text) {
    var line = stamp() + ' [' + level + '] ' + String(text).replace(/\s+/g, ' ').slice(0, 2000);
    memory.push(line);
    if (memory.length > 300) memory.shift();
    if (fs && file) {
      try { fs.appendFileSync(file, line + '\n', 'utf8'); } catch (e) {}
    }
  }

  function tail(n) {
    if (fs && file) {
      try {
        var lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-n);
      } catch (e) {}
    }
    return memory.slice(-n);
  }

  var context = {};

  var log = {
    info: function (t) { write('信息', t); },
    warn: function (t) { write('注意', t); },
    error: function (t) { write('出错', t); },
    setContext: function (k, v) { context[k] = v; },
    dir: function () { return dir; },
    file: function () { return file; },
    report: function () {
      var head = ['赫朝录音改名 问题报告', '时间：' + stamp()];
      for (var k in context) head.push(k + '：' + context[k]);
      head.push('浏览器：' + navigator.userAgent);
      return head.join('\n') + '\n\n最近的日志：\n' + tail(150).join('\n');
    },
    // 复制问题报告，返回给用户看的一句话。
    // 先用页面复制；不行就用系统命令（Mac pbcopy、Windows PowerShell）；再不行存到桌面。
    copyReport: function () {
      var text = log.report();
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      if (ok) return Promise.resolve('已复制，粘贴发过来');
      return systemCopy(text).then(function () { return '已复制，粘贴发过来'; }, function () {
        return saveToDesktop(text);
      });
    }
  };

  function systemCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var cp = req('child_process');
        var os = req('os');
        var child = os.platform() === 'win32'
          ? cp.spawn('powershell.exe', ['-NoProfile', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'])
          : cp.spawn('pbcopy', [], { env: { LANG: 'en_US.UTF-8', PATH: '/usr/bin:/bin' } });
        child.on('error', reject);
        child.on('exit', function (code) { if (code === 0) resolve(); else reject(new Error('退出码 ' + code)); });
        child.stdin.end(text, 'utf8');
      } catch (e) {
        reject(e);
      }
    });
  }

  function saveToDesktop(text) {
    try {
      var p = req('path').join(req('os').homedir(), 'Desktop', '赫朝录音改名-问题报告.txt');
      fs.writeFileSync(p, text, 'utf8');
      return Promise.resolve('复制不了，已存到桌面：赫朝录音改名-问题报告.txt');
    } catch (e) {
      return Promise.resolve('复制失败，日志在 ' + (file || '（没有日志文件）'));
    }
  }

  function showCrash(text) {
    var t = document.getElementById('heroTitle');
    var s = document.getElementById('heroSub');
    var a = document.getElementById('heroActions');
    if (!t || root.VN_MOUNTED) return;
    document.getElementById('hero').dataset.phase = 'error';
    t.textContent = '插件出错了';
    s.textContent = text;
    a.innerHTML = '<button class="btn btn-primary" type="button">复制问题报告</button>';
    a.firstChild.onclick = function () {
      log.copyReport().then(function (msg) { a.firstChild.textContent = msg; });
    };
  }

  root.addEventListener('error', function (e) {
    var where = e.filename ? '（' + String(e.filename).split('/').pop() + ':' + e.lineno + '）' : '';
    log.error('页面错误：' + e.message + where);
    showCrash(e.message + where);
  });
  root.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    log.error('没接住的错误：' + (r && r.stack ? r.stack : r));
  });

  root.VNLog = log;
})(typeof self !== 'undefined' ? self : this);
