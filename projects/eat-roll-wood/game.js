/* ============================================================
   吃掉小滚木 · game.js
   玩法复刻 EatKano（吃掉小鹿乃）：4 列滚动、吃最底下的那根、
   键型倾向自己挑、图/音效/背景随便换。零依赖，纯原生。
   ============================================================ */
(function () {
  'use strict';

  var ROWS = 12;            // 每层行数（要 ≥ 可见行数，保证两层能接上）
  var COLS = 4;
  var TOTAL = ROWS * COLS;
  var LS_KEY = 'eat-roll-wood.v1';
  var LS_BEST = 'eat-roll-wood.best.';

  var DEFAULTS = {
    title: '吃掉小滚木',
    keys: 'dfjk',
    time: 20,
    pattern: 'random',
    sound: true,
    mode: 'normal',
    beforeImg: '',
    afterImg: '',
    bgImg: '',
    tapSnd: '',
    errSnd: '',
    endSnd: ''
  };

  /* ---------------- 配置 ---------------- */
  var cfg = (function () {
    var c = {}, k;
    for (k in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) c[k] = DEFAULTS[k]; }
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (k in o) { if (Object.prototype.hasOwnProperty.call(c, k)) c[k] = o[k]; }
      }
    } catch (e) { }
    return c;
  })();

  function saveCfg() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
      return true;
    } catch (e) {
      toast('存不下了，图片或音效太大了');
      return false;
    }
  }

  /* ---------------- 默认图（内联 SVG，不占额外请求） ---------------- */
  var SVG_ROLL =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<defs>' +
    '<linearGradient id="w" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#c98f52"/><stop offset="1" stop-color="#8a5a2b"/></linearGradient>' +
    '<linearGradient id="t" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#eec089"/><stop offset="1" stop-color="#c9905a"/></linearGradient>' +
    '</defs>' +
    '<path d="M32 40 h64 v52 a32 14 0 0 1 -64 0 z" fill="url(#w)"/>' +
    '<ellipse cx="64" cy="40" rx="32" ry="14" fill="url(#t)"/>' +
    '<ellipse cx="64" cy="40" rx="22" ry="9.5" fill="none" stroke="#a9703c" stroke-width="2.4" opacity=".65"/>' +
    '<ellipse cx="64" cy="40" rx="11" ry="4.6" fill="none" stroke="#a9703c" stroke-width="2.4" opacity=".65"/>' +
    '<path d="M44 64 q8 8 0 16" stroke="#7d5226" stroke-width="2.6" fill="none" opacity=".45"/>' +
    '<path d="M86 66 q-8 8 0 16" stroke="#7d5226" stroke-width="2.6" fill="none" opacity=".45"/>' +
    '<circle cx="52" cy="70" r="5.6" fill="#2b1a0e"/>' +
    '<circle cx="76" cy="70" r="5.6" fill="#2b1a0e"/>' +
    '<circle cx="53.8" cy="68" r="1.9" fill="#fff" opacity=".92"/>' +
    '<circle cx="77.8" cy="68" r="1.9" fill="#fff" opacity=".92"/>' +
    '<path d="M57 84 q7 8 14 0" stroke="#2b1a0e" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  var SVG_EATEN =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<rect x="34" y="54" width="60" height="34" rx="9" fill="#9a6634"/>' +
    '<path d="M34 63 h60" stroke="#7d5226" stroke-width="3" opacity=".5"/>' +
    '<path d="M64 54 l-9 34" stroke="#5e3a18" stroke-width="3.2" fill="none"/>' +
    '<path d="M76 56 l6 30" stroke="#5e3a18" stroke-width="2.2" fill="none" opacity=".7"/>' +
    '<circle cx="28" cy="48" r="4.6" fill="#c98f52"/>' +
    '<circle cx="98" cy="44" r="5.2" fill="#c98f52"/>' +
    '<circle cx="88" cy="96" r="3.6" fill="#c98f52"/>' +
    '<circle cx="44" cy="100" r="3" fill="#c98f52"/>' +
    '</svg>';

  function svgUrl(s) {
    return 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s) + '")';
  }
  var DEF_BEFORE = svgUrl(SVG_ROLL);
  var DEF_AFTER = svgUrl(SVG_EATEN);

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var stage, board, keybar, hud, hudText, bgLayer, titleEl, patternTipEl;
  var layers = [];
  var keyEls = [];

  /* ---------------- 状态 ---------------- */
  var state = 'home';     // home | playing | over
  var mode = 'normal';
  var started = false;
  var gameOver = false;
  var score = 0;
  var timeLeft = 0;
  var tickId = 0;
  var startTs = 0;
  var bs = 100;

  var noteList = [];
  var noteIdx = 0;
  var colQueue = [];

  /* ---------------- 音效 ---------------- */
  var actx = null;
  var tapBuf = null;
  var audioPool = {};

  function audio() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!actx) { try { actx = new C(); } catch (e) { return null; } }
    if (actx.state === 'suspended' && actx.resume) { actx.resume(); }
    return actx;
  }

  function getTapBuf(a) {
    if (!tapBuf) {
      var len = Math.floor(a.sampleRate * 0.055);
      tapBuf = a.createBuffer(1, len, a.sampleRate);
      var d = tapBuf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      }
    }
    return tapBuf;
  }

  function synthTap() {
    var a = audio(); if (!a) return;
    var t = a.currentTime;
    var src = a.createBufferSource(); src.buffer = getTapBuf(a);
    var bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1;
    var g = a.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(bp); bp.connect(g); g.connect(a.destination);
    src.start(t);

    var o = a.createOscillator(), og = a.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(460, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    og.gain.setValueAtTime(0.2, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og); og.connect(a.destination);
    o.start(t); o.stop(t + 0.12);
  }

  function synthErr() {
    var a = audio(); if (!a) return;
    var t = a.currentTime;
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(72, t + 0.32);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + 0.36);
  }

  function synthEnd() {
    var a = audio(); if (!a) return;
    var t = a.currentTime;
    var notes = [660, 520, 392, 262];
    for (var i = 0; i < notes.length; i++) {
      (function (f, d) {
        var o = a.createOscillator(), g = a.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        var s = t + d;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.18, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
        o.connect(g); g.connect(a.destination);
        o.start(s); o.stop(s + 0.24);
      })(notes[i], i * 0.1);
    }
  }

  function playCustom(key) {
    var src = cfg[key];
    if (!src) return false;
    var el = audioPool[key];
    if (!el) {
      el = new Audio(src);
      el.preload = 'auto';
      audioPool[key] = el;
    }
    try { el.currentTime = 0; } catch (e) { }
    var p = el.play();
    if (p && p.catch) p.catch(function () { });
    return true;
  }

  function sfx(kind) {
    if (!cfg.sound) return;
    if (kind === 'tap') { if (!playCustom('tapSnd')) synthTap(); return; }
    if (kind === 'err') { if (!playCustom('errSnd')) synthErr(); return; }
    if (kind === 'end') { if (!playCustom('endSnd')) synthEnd(); }
  }

  /* ---------------- 建棋盘 ---------------- */
  function makeLayer(el) {
    el.innerHTML = '';
    var cells = [];
    var frag = document.createDocumentFragment();
    for (var j = 0; j < TOTAL; j++) {
      var d = document.createElement('div');
      d.className = 'cell' + ((j % COLS) ? ' bl' : '');
      frag.appendChild(d);
      cells.push(d);
    }
    el.appendChild(frag);
    return { el: el, cells: cells, row: 0 };
  }

  function layout() {
    var w = board.clientWidth || 360;
    bs = w / COLS;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      L.el.style.height = (ROWS * bs) + 'px';
      for (var j = 0; j < TOTAL; j++) {
        var c = L.cells[j];
        c.style.left = ((j % COLS) * bs) + 'px';
        c.style.bottom = (Math.floor(j / COLS) * bs) + 'px';
        c.style.width = bs + 'px';
        c.style.height = bs + 'px';
      }
      setLayerY(L);
    }
  }

  function setLayerY(L) {
    L.el.style.transform = 'translate3d(0,' + (L.row * bs) + 'px,0)';
  }

  /* ---------------- 键型倾向 ---------------- */
  function makeSeries(n, style) {
    var a = [], i, cur, hand, hold, pool;

    if (style === 'mixed') {
      var subs = ['random', 'alternate', 'stair', 'jack', 'jump'];
      while (a.length < n) {
        var sub = subs[Math.floor(Math.random() * subs.length)];
        var len = 4 + Math.floor(Math.random() * 5);
        a = a.concat(makeSeries(len, sub));
      }
      return a.slice(0, n);
    }

    if (style === 'stair') {
      var seq = [0, 1, 2, 3, 2, 1];
      var p = Math.floor(Math.random() * seq.length);
      for (i = 0; i < n; i++) { a.push(seq[p]); p = (p + 1) % seq.length; }
      return a;
    }

    if (style === 'alternate') {
      hand = Math.random() < 0.5 ? 0 : 1;
      for (i = 0; i < n; i++) {
        a.push(hand === 0 ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2));
        hand = 1 - hand;
      }
      return a;
    }

    if (style === 'jack') {
      cur = Math.floor(Math.random() * 4);
      hold = 2;
      for (i = 0; i < n; i++) {
        if (hold <= 0) {
          pool = [];
          for (var q = 0; q < 4; q++) { if (q !== cur) pool.push(q); }
          cur = pool[Math.floor(Math.random() * pool.length)];
          hold = 2;
        }
        a.push(cur);
        hold--;
      }
      return a;
    }

    if (style === 'jump') {
      var pairs = [[0, 3], [2, 1]];
      var pr = pairs[Math.floor(Math.random() * 2)];
      var t = 0;
      for (i = 0; i < n; i++) {
        a.push(pr[t]);
        t = 1 - t;
        if (i % 6 === 5) pr = pairs[Math.floor(Math.random() * 2)];
      }
      return a;
    }

    /* random —— 原版手感：纯随机，只是不太爱连着同一列 */
    cur = Math.floor(Math.random() * 4);
    for (i = 0; i < n; i++) {
      if (i > 0) {
        var nxt = Math.floor(Math.random() * 4);
        if (nxt === cur && Math.random() < 0.75) {
          nxt = (cur + 1 + Math.floor(Math.random() * 3)) % 4;
        }
        cur = nxt;
      }
      a.push(cur);
    }
    return a;
  }

  function nextCol() {
    if (!colQueue.length) colQueue = makeSeries(64, cfg.pattern);
    return colQueue.shift();
  }

  /* ---------------- 填层 ---------------- */
  function fillLayer(L) {
    var i = nextCol();
    for (var j = 0; j < TOTAL; j++) {
      var c = L.cells[j];
      c.className = 'cell' + ((j % COLS) ? ' bl' : '');
      if (j === i) {
        c.classList.add('note');
        noteList.push({ cell: i % COLS, el: c });
        i = (Math.floor(j / COLS) + 1) * COLS + nextCol();
      }
    }
  }

  function resetAbove(L) {
    L.el.style.transitionDuration = '0ms';
    L.el.style.display = 'none';
    L.row = -(ROWS - 1);
    setLayerY(L);
    fillLayer(L);
    setTimeout(function () {
      L.el.style.display = 'block';
      void L.el.offsetWidth;
      L.el.style.transitionDuration = '';
    }, 110);
  }

  function advance() {
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      L.row++;
      if (L.row > ROWS) resetAbove(L);
      else setLayerY(L);
    }
    if (noteIdx > 240) {
      noteList = noteList.slice(noteIdx);
      noteIdx = 0;
    }
  }

  /* ---------------- 局 ---------------- */
  function resetGame() {
    if (tickId) { clearInterval(tickId); tickId = 0; }
    noteList = [];
    noteIdx = 0;
    colQueue = [];
    score = 0;
    started = false;
    gameOver = false;
    timeLeft = cfg.time;
    layers[0].row = 0;
    layers[1].row = -ROWS;
    layers[0].el.style.display = 'block';
    layers[1].el.style.display = 'block';
    layers[0].el.style.transitionDuration = '';
    layers[1].el.style.transitionDuration = '';
    fillLayer(layers[0]);
    fillLayer(layers[1]);
    setLayerY(layers[0]);
    setLayerY(layers[1]);
    updateHud();
  }

  function beginTimer() {
    if (started) return;
    started = true;
    startTs = Date.now();
    tickId = setInterval(tick, 100);
  }

  function tick() {
    if (mode === 'normal') {
      var passed = (Date.now() - startTs) / 1000;
      var left = cfg.time - passed;
      timeLeft = Math.max(0, left);
      if (left <= 0) {
        updateHud();
        endGame();
        return;
      }
    }
    updateHud();
  }

  function cps() {
    if (!started) return 0;
    var el = (Date.now() - startTs) / 1000;
    if (el < 1) return 0;
    return score / el;
  }

  function updateHud() {
    if (mode === 'normal') {
      hudText.textContent = 'TIME:' + Math.ceil(timeLeft);
    } else if (mode === 'endless') {
      var c = cps();
      hudText.textContent = 'CPS:' + (c > 0 ? c.toFixed(2) : '计算中');
    } else {
      hudText.textContent = 'SCORE:' + score;
    }
  }

  function startGame() {
    mode = cfg.mode;
    resetGame();
    state = 'playing';
    hideAll();
    document.body.classList.add('ingame');
    hud.classList.add('on');
    updateHud();
  }

  function hit(p) {
    if (!started) beginTimer();
    sfx('tap');
    p.el.classList.add('eaten');
    noteIdx++;
    score++;
    updateHud();
    advance();
  }

  function miss(col) {
    if (!started) return;
    sfx('err');
    var k = keyEls[col];
    if (k) {
      k.classList.add('hit');
      setTimeout(function () { k.classList.remove('hit'); }, 220);
    }
    if (mode === 'practice') return;
    endGame();
  }

  function tap(col) {
    if (state !== 'playing' || gameOver) return;
    var p = noteList[noteIdx];
    if (!p) return;
    if (col === p.cell) hit(p);
    else miss(col);
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    state = 'over';
    if (tickId) { clearInterval(tickId); tickId = 0; }
    sfx('end');
    document.body.classList.remove('ingame');
    hud.classList.remove('on');
    setTimeout(showResult, 620);
  }

  /* ---------------- 结算 ---------------- */
  function verdict(c) {
    if (c <= 3) return '滚木还没吃动？';
    if (c <= 5) return '试着好好练一下？';
    if (c <= 8) return 'TCL';
    if (c <= 10) return 'TQL';
    if (c <= 15) return '您';
    return '人？';
  }

  function bestKey() {
    return LS_BEST + (mode === 'endless' ? 'endless' : 'normal');
  }

  function getBest() {
    var v = 0;
    try { v = parseFloat(localStorage.getItem(bestKey()) || '0') || 0; } catch (e) { }
    return v;
  }

  function saveBest(v) {
    try { localStorage.setItem(bestKey(), String(v)); } catch (e) { }
  }

  function showResult() {
    var c = cps();
    var val = (mode === 'endless' ? c : score);
    var best = getBest();
    if (mode !== 'practice' && val > best) { best = val; saveBest(best); }

    $('rTitle').textContent = verdict(c);
    $('rCps').textContent = 'CPS ' + c.toFixed(2);
    $('rScore').textContent = (mode === 'endless') ? '' : ('吃掉 ' + score + ' 根');
    $('rScore').style.display = (mode === 'endless') ? 'none' : '';
    $('rBest').textContent = (mode === 'practice')
      ? '练习模式不计成绩'
      : ('最佳 ' + (mode === 'endless' ? best.toFixed(2) : best));
    showModal('result');
    var btn = $('btnReplay');
    if (btn && btn.focus) { try { btn.focus(); } catch (e) { } }
  }

  /* ---------------- 弹窗 ---------------- */
  function showModal(id) {
    hideAll();
    var m = $(id);
    if (m) m.classList.add('on');
  }

  function hideAll() {
    var ms = document.querySelectorAll('.modal');
    for (var i = 0; i < ms.length; i++) ms[i].classList.remove('on');
  }

  function showHome() {
    state = 'home';
    document.body.classList.remove('ingame');
    hud.classList.remove('on');
    var n = getBestSafe();
    if (n > 0) $('bestLine').textContent = '本地最佳 ' + n + ' 根';
    else $('bestLine').textContent = '按 D F J K，或者点下面的键位条';
    showModal('welcome');
    syncModeChips();
  }

  function getBestSafe() {
    var old = mode;
    mode = 'normal';
    var v = getBest();
    mode = old;
    return v;
  }

  function syncModeChips() {
    var chips = document.querySelectorAll('#modeRow .chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('active', chips[i].dataset.mode === cfg.mode);
    }
  }

  /* ---------------- 主题 ---------------- */
  function applyTheme() {
    board.style.setProperty('--before-img', cfg.beforeImg ? 'url("' + cfg.beforeImg + '")' : DEF_BEFORE);
    board.style.setProperty('--after-img', cfg.afterImg ? 'url("' + cfg.afterImg + '")' : DEF_AFTER);
    if (cfg.bgImg) {
      bgLayer.style.backgroundImage = 'url("' + cfg.bgImg + '")';
      bgLayer.classList.add('on');
    } else {
      bgLayer.style.backgroundImage = '';
      bgLayer.classList.remove('on');
    }
    titleEl.textContent = cfg.title || DEFAULTS.title;
    document.title = cfg.title || DEFAULTS.title;
    refreshKeyLabels();
  }

  function keyArr() {
    var k = String(cfg.keys || 'dfjk').toLowerCase().replace(/\s+/g, '');
    while (k.length < 4) k += 'dfjk'.charAt(k.length);
    return k.slice(0, 4).split('');
  }

  function refreshKeyLabels() {
    var ks = keyArr();
    for (var i = 0; i < keyEls.length; i++) {
      keyEls[i].textContent = ks[i].toUpperCase();
    }
  }

  /* ---------------- 提示 ---------------- */
  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1700);
  }

  /* ---------------- 图片 / 音频 ---------------- */
  function pickImage(file, maxSide, cb) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      var s = Math.min(1, maxSide / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * s));
      var ch = Math.max(1, Math.round(h * s));
      var cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      var out = cv.toDataURL('image/webp', 0.86);
      if (out.indexOf('data:image/webp') !== 0) {
        out = cv.toDataURL('image/png');
      }
      if (out.length > 2.4e6) {
        out = cv.toDataURL('image/webp', 0.7);
        if (out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/jpeg', 0.72);
      }
      if (out.length > 3.2e6) { toast('图片太大了，换张小点的'); return; }
      cb(out);
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('图片读不出来'); };
    img.src = url;
  }

  function pickAudio(file, cb) {
    if (!file) return;
    if (file.size > 1.6 * 1024 * 1024) { toast('音效太大了，控制在 1.5MB 内'); return; }
    var r = new FileReader();
    r.onload = function () { cb(String(r.result)); };
    r.onerror = function () { toast('音效读取失败'); };
    r.readAsDataURL(file);
  }

  /* ---------------- 设置面板 ---------------- */
  var PATTERN_TIP = {
    random: '完全随机，就是原版 EatKano 的手感。',
    alternate: '左手（前两列）右手（后两列）轮流来，练交替。',
    stair: '1234 再折回 321，像走楼梯，考验连指。',
    jack: '同一列连着吃两三下，练纵连。',
    jump: '只在 1↔4、2↔3 之间跳，跨度大，手要快。',
    mixed: '每隔几行换一种，最难预判。'
  };

  function updatePatternTip() {
    if (patternTipEl) patternTipEl.textContent = PATTERN_TIP[$('inPattern').value] || '';
  }

  function syncSettings() {
    $('inTitle').value = cfg.title;
    $('inTime').value = cfg.time;
    $('inKeys').value = cfg.keys;
    $('inPattern').value = cfg.pattern;
    $('btnSound').textContent = cfg.sound ? '开启' : '关闭';
    updatePatternTip();
  }

  function readSettings() {
    var t = String($('inTitle').value || '').trim();
    cfg.title = t ? t.slice(0, 14) : DEFAULTS.title;

    var n = parseInt($('inTime').value, 10);
    if (!isFinite(n)) n = DEFAULTS.time;
    cfg.time = Math.min(99, Math.max(5, n));

    var k = String($('inKeys').value || '').toLowerCase().replace(/\s+/g, '');
    while (k.length < 4) k += 'dfjk'.charAt(k.length);
    cfg.keys = k.slice(0, 4);

    cfg.pattern = $('inPattern').value || 'random';
    saveCfg();
    applyTheme();
    syncSettings();
  }

  /* ---------------- 绑定 ---------------- */
  function bindUI() {
    $('btnStart').addEventListener('click', function () {
      audio();
      startGame();
    });

    $('modeRow').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.chip') : null;
      if (!b) return;
      cfg.mode = b.dataset.mode;
      saveCfg();
      syncModeChips();
      mode = cfg.mode;
      updateHud();
    });

    $('btnSetting').addEventListener('click', function () {
      syncSettings();
      showModal('setting');
    });

    $('btnDone').addEventListener('click', function () {
      readSettings();
      showHome();
    });

    $('btnResetAll').addEventListener('click', function () {
      if (!window.confirm('恢复默认？自己设的图、音效、键型都会清掉。')) return;
      cfg = {};
      for (var k in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) cfg[k] = DEFAULTS[k]; }
      mode = cfg.mode;
      audioPool = {};
      saveCfg();
      applyTheme();
      syncSettings();
      toast('已恢复默认');
    });

    $('btnSound').addEventListener('click', function () {
      cfg.sound = !cfg.sound;
      $('btnSound').textContent = cfg.sound ? '开启' : '关闭';
      saveCfg();
    });

    $('inPattern').addEventListener('change', updatePatternTip);

    $('btnReplay').addEventListener('click', function () { startGame(); });
    $('btnHome').addEventListener('click', function () { resetGame(); showHome(); });

    $('quit').addEventListener('click', function () {
      if (state !== 'playing') return;
      resetGame();
      showHome();
    });

    /* 上传 */
    $('fBefore').addEventListener('change', function () {
      pickImage(this.files[0], 256, function (d) { cfg.beforeImg = d; saveCfg(); applyTheme(); toast('按键图已换'); });
      this.value = '';
    });
    $('fAfter').addEventListener('change', function () {
      pickImage(this.files[0], 256, function (d) { cfg.afterImg = d; saveCfg(); applyTheme(); toast('吃掉后的图已换'); });
      this.value = '';
    });
    $('fBg').addEventListener('change', function () {
      pickImage(this.files[0], 1280, function (d) { cfg.bgImg = d; saveCfg(); applyTheme(); toast('背景已换'); });
      this.value = '';
    });
    $('fTap').addEventListener('change', function () {
      var self = this;
      pickAudio(this.files[0], function (d) { cfg.tapSnd = d; delete audioPool.tapSnd; if (saveCfg()) toast('吃掉音效已换'); sfx('tap'); });
      self.value = '';
    });
    $('fErr').addEventListener('change', function () {
      var self = this;
      pickAudio(this.files[0], function (d) { cfg.errSnd = d; delete audioPool.errSnd; if (saveCfg()) toast('按错音效已换'); sfx('err'); });
      self.value = '';
    });
    $('fEnd').addEventListener('change', function () {
      var self = this;
      pickAudio(this.files[0], function (d) { cfg.endSnd = d; delete audioPool.endSnd; if (saveCfg()) toast('结束音效已换'); });
      self.value = '';
    });

    /* 还原单个 */
    var clears = document.querySelectorAll('[data-clear]');
    for (var i = 0; i < clears.length; i++) {
      clears[i].addEventListener('click', function () {
        var key = this.dataset.clear;
        cfg[key] = '';
        delete audioPool[key];
        saveCfg();
        applyTheme();
        toast('已还原');
      });
    }

    /* 键位条 */
    keybar.addEventListener('pointerdown', function (e) {
      var i = keyEls.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      tap(i);
    }, { passive: false });

    /* 棋盘点击：只认下半屏，免得随手一搭就判错 */
    board.addEventListener('pointerdown', function (e) {
      if (state !== 'playing') return;
      var r = board.getBoundingClientRect();
      if (e.clientY - r.top < r.height * 0.5) return;
      var col = Math.floor((e.clientX - r.left) / bs);
      if (col < 0) col = 0;
      if (col > 3) col = 3;
      e.preventDefault();
      tap(col);
    }, { passive: false });

    /* 键盘 */
    document.addEventListener('keydown', function (e) {
      if (state !== 'playing') return;
      var k = String(e.key || '').toLowerCase();
      var i = keyArr().indexOf(k);
      if (i >= 0) {
        e.preventDefault();
        tap(i);
      }
    });

    window.addEventListener('resize', function () { layout(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(layout, 220);
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    stage = $('stage');
    board = $('board');
    keybar = $('keybar');
    hud = $('hud');
    hudText = $('hudText');
    bgLayer = $('bgImg');
    titleEl = $('wTitle');
    patternTipEl = $('patternTip');

    layers = [makeLayer($('layerA')), makeLayer($('layerB'))];

    keyEls = [];
    for (var i = 0; i < COLS; i++) {
      var d = document.createElement('div');
      d.className = 'kb';
      keybar.appendChild(d);
      keyEls.push(d);
    }

    layout();
    mode = cfg.mode;
    applyTheme();
    syncSettings();
    bindUI();
    resetGame();
    showHome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();