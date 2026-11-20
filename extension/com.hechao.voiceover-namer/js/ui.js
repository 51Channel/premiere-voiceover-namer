// 面板界面：只管把引擎的状态画出来、把点击交回引擎。
(function (root) {
  'use strict';
  var C = root.VNCore;

  var I = {
    mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5M12 18v3.5"/>',
    spin: '<path d="M21 12a9 9 0 1 1-6.2-8.56"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.3"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    find: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    copies: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    wave: '<path d="M3 12h1.5M7 8v8M11 4.5v15M15 8.5v7M19 10.5v3"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + I[name] + '</svg>';
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function $(id) { return document.getElementById(id); }

  function timeText(ms) {
    var d = new Date(ms);
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    var today = new Date();
    var day = d.toDateString() === today.toDateString() ? '今天' : (d.getMonth() + 1) + '/' + d.getDate();
    return day + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  // 波形：竖条，played 是 0–1 的播放进度
  function drawWave(canvas, peaks, played, color) {
    var dpr = root.devicePixelRatio || 1;
    var w = canvas.clientWidth || 200;
    var h = canvas.clientHeight || 24;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!peaks || !peaks.length) {
      ctx.fillStyle = '#3c3c3c';
      ctx.fillRect(0, h / 2 - 0.5, w, 1);
      return;
    }
    var bar = 2;
    var gap = 1;
    var n = Math.max(1, Math.floor((w + gap) / (bar + gap)));
    var maxPeak = 0;
    peaks.forEach(function (p) { if (p > maxPeak) maxPeak = p; });
    var scale = maxPeak > 0 ? 1 / maxPeak : 1;
    for (var i = 0; i < n; i++) {
      var p = peaks[Math.floor(i * peaks.length / n)] * scale;
      var bh = Math.max(1.5, Math.pow(p, 0.8) * (h - 2));
      var x = i * (bar + gap);
      ctx.fillStyle = played !== null && played !== undefined && x / w <= played ? '#ff5a4f' : (color || '#7d7d7d');
      ctx.fillRect(x, (h - bh) / 2, bar, bh);
    }
  }

  function mount(api) {
    var app = $('app');
    var state = null;
    var listKey = '';
    var editing = null;
    var sheetMode = null;
    var audio = new Audio();
    var playing = null;
    var isMac = /Mac/i.test(navigator.platform || '');

    $('autoToggle').addEventListener('change', function (e) { api.setAuto(e.target.checked); });
    $('sheetCancel').addEventListener('click', closeSheet);
    $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) closeSheet(); });
    $('sheetOk').addEventListener('click', function () {
      var mode = sheetMode;
      closeSheet();
      if (mode === 'old') api.fixOld();
      if (mode === 'dup') api.fixDuplicates();
    });

    audio.addEventListener('ended', stopPlaying);
    audio.addEventListener('error', stopPlaying);

    function stopPlaying() {
      if (!playing) return;
      var card = playing.card;
      playing = null;
      audio.pause();
      card.classList.remove('playing');
      card.querySelector('.play').innerHTML = icon('play');
      var rec = card._rec;
      drawWave(card.querySelector('canvas'), rec.peaks, null);
    }

    function togglePlay(card) {
      if (playing && playing.card === card) { stopPlaying(); return; }
      stopPlaying();
      audio.src = api.fileUrl(card._rec.path);
      audio.currentTime = 0;
      var p = audio.play();
      if (p && p.catch) p.catch(stopPlaying);
      playing = { card: card };
      card.classList.add('playing');
      card.querySelector('.play').innerHTML = icon('stop');
      (function frame() {
        if (!playing || playing.card !== card) return;
        var d = audio.duration || card._rec.duration || 1;
        drawWave(card.querySelector('canvas'), card._rec.peaks, audio.currentTime / d);
        requestAnimationFrame(frame);
      })();
    }

    function hero(s) {
      var h = $('hero');
      var title = '';
      var sub = '';
      var ic = 'spin';
      var actions = '';
      var save = isMac ? '⌘S' : 'Ctrl+S';
      switch (s.phase) {
        case 'noProject':
          title = '先打开一个工程'; sub = '打开以后就会开始盯着录音'; ic = 'film'; break;
        case 'unsaved':
          title = '先把工程存一下'; sub = '按 ' + save + ' 存好，录音才能用工程名起名'; ic = 'save'; break;
        case 'paused':
          title = '自动改名关着'; sub = '这会儿录的音不会改名，右上角打开就会补上'; ic = 'pause'; break;
        case 'ready':
          title = '点音轨上的麦克风直接录';
          sub = '录完 2 秒内改成 <span class="name">' + esc(s.nextDisplay) + '</span>'; ic = 'mic'; break;
        case 'waiting':
          title = '等录音写完';
          sub = '<span class="name">' + esc(s.current && s.current.from) + '</span>'; break;
        case 'working':
          title = '正在改名';
          sub = '<span class="name">' + esc(s.current && s.current.from) + '</span><span class="arrow">→</span><span class="name">' + esc(s.current && s.current.to) + '</span>'; break;
        case 'done':
          title = '改好了';
          sub = esc(s.lastDone && s.lastDone.from) + '<span class="arrow">→</span><span class="name">' + esc(s.lastDone && s.lastDone.to) + '</span>';
          ic = 'check'; break;
        case 'error':
          title = '没改成'; sub = esc(s.error && s.error.text); ic = 'alert';
          actions = (s.error && s.error.retry ? '<button class="btn btn-primary" data-act="retry">重试</button>' : '') +
            '<button class="btn" data-act="report">复制问题报告</button>' +
            '<button class="btn btn-ghost" data-act="dismiss">知道了</button>';
          break;
        default:
          title = '正在连接 Premiere';
          sub = s.connectFails > 8 ? '一直连不上：关掉这个面板再从“窗口 → 扩展”打开一次' : '';
          if (s.connectFails > 8) ic = 'alert';
      }
      h.dataset.phase = s.phase;
      $('heroIcon').innerHTML = icon(ic);
      $('heroTitle').textContent = title;
      $('heroSub').innerHTML = sub;
      if ($('heroActions').innerHTML !== actions) $('heroActions').innerHTML = actions;
    }

    $('heroActions').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'retry') api.retry();
      if (b.dataset.act === 'dismiss') api.dismissError();
      if (b.dataset.act === 'report') Promise.resolve(api.copyReport()).then(function (msg) { b.textContent = msg; });
    });

    function notices(s) {
      var html = '';
      if (s.oldRecordings.length) {
        html += '<div class="notice"><span class="notice-icon">' + icon('wave') + '</span><div class="notice-text">还有 ' + s.oldRecordings.length +
          ' 条录音叫“' + esc(C.stem(s.oldRecordings[0].fileName)) + '”这种默认名<small>是之前录的，改了才不会和别的工程撞名</small></div>' +
          '<button class="btn btn-warn" data-act="old"' + (s.busy ? ' disabled' : '') + '>改名</button></div>';
      }
      if (s.duplicates.length) {
        var files = 0;
        s.duplicates.forEach(function (g) { files += g.files.length; });
        html += '<div class="notice"><span class="notice-icon">' + icon('copies') + '</span><div class="notice-text">' + files +
          ' 个素材文件名字撞了<small>比如“' + esc(s.duplicates[0].fileName) + '”，打包或交接工程时会互相覆盖</small></div>' +
          '<button class="btn btn-warn" data-act="dup"' + (s.busy ? ' disabled' : '') + '>看看</button></div>';
      }
      if ($('notices').innerHTML !== html) $('notices').innerHTML = html;
    }

    $('notices').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      openSheet(b.dataset.act);
    });

    function openSheet(mode) {
      var s = state;
      var body = '';
      sheetMode = mode;
      if (mode === 'old') {
        $('sheetTitle').textContent = '给 ' + s.oldRecordings.length + ' 条老录音编号';
        $('sheetSub').textContent = '按录制先后排，在原来的文件夹里改名，素材箱和时间线一起换';
        var start = parseInt(String(s.nextDisplay).replace(/\D/g, ''), 10) || 1;
        s.oldRecordings.forEach(function (r, i) {
          body += '<div class="change"><div class="change-from">' + esc(r.fileName) + ' · ' + esc(C.formatDuration(r.duration)) + '</div>' +
            '<canvas class="rec-wave" data-i="' + i + '"></canvas>' +
            '<div class="change-to">' + esc(C.displayName(start + i)) + '</div>' +
            '<div class="change-where">' + esc(C.dirName(r.path)) + '</div></div>';
        });
        $('sheetOk').textContent = '全部改名';
      } else {
        var plan = api.duplicatePlan();
        var moving = {};
        plan.forEach(function (p) { moving[C.pathKey(p.from)] = p.to; });
        $('sheetTitle').textContent = '把撞名的素材改开';
        $('sheetSub').textContent = '每组第一个不动，其余在原文件夹里加个编号；大文件不会复制';
        s.duplicates.forEach(function (g) {
          body += '<div class="group-title">' + esc(g.fileName) + '<small>' + g.files.length + ' 个文件</small></div>';
          g.files.forEach(function (f) {
            var to = moving[C.pathKey(f.path)];
            body += '<div class="change"><div class="change-where">' + esc(C.dirName(f.path)) + '</div>' +
              (to ? '<div class="change-to">' + esc(C.baseName(to)) + '</div>' : '<div class="keep">保持原名</div>') + '</div>';
          });
        });
        $('sheetOk').textContent = '改 ' + plan.length + ' 个';
      }
      $('sheetBody').innerHTML = body;
      $('sheet').hidden = false;
      if (mode === 'old') {
        Array.prototype.forEach.call($('sheetBody').querySelectorAll('canvas'), function (cv) {
          drawWave(cv, s.oldRecordings[+cv.dataset.i].peaks, null, '#9a8550');
        });
      }
    }

    function closeSheet() {
      $('sheet').hidden = true;
      sheetMode = null;
    }

    function list(s) {
      var key = s.recordings.map(function (r) { return r.path + '|' + r.display + '|' + r.duration; }).join('\n') + '#' + (s.phase === 'paused') + '#' + !!s.project;
      $('listCount').textContent = s.recordings.length ? s.recordings.length + ' 条' : '';
      if (key === listKey && !s._force) return;
      listKey = key;
      stopPlaying();
      var box = $('list');
      box.innerHTML = '';
      if (!s.recordings.length) {
        var tip = s.project ? '点时间线音轨头上的麦克风按钮，录完这里就会出现' : '打开工程以后，录过的音会列在这里';
        box.innerHTML = '<div class="empty"><svg viewBox="0 0 120 34" fill="currentColor">' + fakeBars() +
          '</svg><div class="empty-title">还没有录音</div><div>' + tip + '</div></div>';
        return;
      }
      var freshName = s.lastDone && Date.now() - s.lastDone.at < 3000 ? s.lastDone.fileName : null;
      s.recordings.forEach(function (r) {
        var card = document.createElement('div');
        card.className = 'rec' + (freshName && r.fileName === freshName ? ' fresh' : '');
        card._rec = r;
        var num = C.displayName(r.number);
        card.innerHTML =
          '<button class="play" title="试听">' + icon('play') + '</button>' +
          '<div class="rec-top"><span class="rec-name"><span class="num">' + esc(num) + '</span>' +
          (r.label ? '<span class="label">' + esc(r.label) + '</span>' : '') + '</span>' +
          '<span class="rec-dur">' + esc(C.formatDuration(r.duration)) + '</span></div>' +
          '<canvas class="rec-wave"></canvas>' +
          '<div class="rec-meta"><span class="rec-file" title="' + esc(r.path) + '">' + esc(timeText(r.mtime)) + ' · ' + esc(r.fileName) + '</span>' +
          '<span class="rec-tools">' +
          '<button class="tool" data-act="label" title="起个名字（比如：开场白）">' + icon('pen') + '</button>' +
          '<button class="tool" data-act="find" title="在项目面板里选中">' + icon('find') + '</button>' +
          '<button class="tool" data-act="reveal" title="' + (isMac ? '在访达中显示' : '在资源管理器中显示') + '">' + icon('folder') + '</button>' +
          '</span></div>';
        box.appendChild(card);
        drawWave(card.querySelector('canvas'), r.peaks, null);
      });
    }

    function fakeBars() {
      var out = '';
      for (var i = 0; i < 40; i++) {
        var h = 4 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 26;
        out += '<rect x="' + (i * 3) + '" y="' + ((34 - h) / 2) + '" width="2" height="' + h + '" rx="1"/>';
      }
      return out;
    }

    var reportCopied = false;
    $('foot').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.dataset.act !== 'report') return;
      Promise.resolve(api.copyReport()).then(function (msg) {
        reportCopied = msg;
        foot(state);
        setTimeout(function () { reportCopied = false; foot(state); }, 5000);
      });
    });

    $('list').addEventListener('click', function (e) {
      var card = e.target.closest('.rec');
      if (!card) return;
      var b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('play')) togglePlay(card);
      else if (b.dataset.act === 'find') api.select(card._rec.ids);
      else if (b.dataset.act === 'reveal') api.reveal(card._rec.path);
      else if (b.dataset.act === 'label') startEdit(card);
    });

    function startEdit(card) {
      if (state.busy) return;
      var r = card._rec;
      var nameEl = card.querySelector('.rec-name');
      var input = document.createElement('input');
      input.className = 'rec-edit';
      input.value = r.label || '';
      input.placeholder = C.displayName(r.number) + ' 叫什么？比如：开场白';
      nameEl.replaceWith(input);
      editing = card;
      input.focus();
      var done = false;
      function finish(save) {
        if (done) return;
        done = true;
        editing = null;
        var v = C.cleanLabel(input.value);
        if (save && v !== (r.label || '')) api.label(r, v);
        listKey = '';
        render(state);
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', function () { finish(true); });
    }

    function foot(s) {
      var html = '';
      if (s.project && s.phase !== 'unsaved') {
        var sample = C.recordingFileName({ project: s.project.name, number: parseInt(String(s.nextDisplay).replace(/\D/g, ''), 10) || 1, date: new Date() });
        html = '文件名：<code>' + esc(sample) + '</code>';
      }
      if (s.waitingDeletes) html += '<div>' + s.waitingDeletes + ' 个旧文件 Premiere 还占着，松手后自动删</div>';
      html += '<div class="foot-row"><span>' + esc(api.version ? '版本 ' + api.version : '') +
        (api.updateInfo && api.updateInfo.text ? ' · ' + esc(api.updateInfo.text) : '') + '</span>' +
        (api.copyReport ? '<button class="link" data-act="report">' + esc(reportCopied || '复制问题报告') + '</button>' : '') + '</div>';
      if ($('foot').innerHTML !== html) $('foot').innerHTML = html;
    }

    function render(s) {
      state = s;
      app.dataset.phase = s.phase;
      app.dataset.auto = s.auto ? 'on' : 'off';
      $('autoToggle').checked = !!s.auto;
      $('autoText').textContent = s.auto ? '自动' : '已暂停';
      $('where').innerHTML = s.project
        ? '<b>' + esc(s.project.name) + '</b>' + (s.project.sequence ? ' · ' + esc(s.project.sequence) : ' · 没有打开序列')
        : (s.phase === 'connecting' ? '正在连接 Premiere' : '没有打开的工程');
      hero(s);
      notices(s);
      if (!editing) list(s);
      foot(s);
    }

    api.subscribe(render);
    root.addEventListener('resize', function () { listKey = ''; if (state && !editing) list(state); });
  }

  root.VNUI = { mount: mount, drawWave: drawWave };
})(typeof self !== 'undefined' ? self : this);
