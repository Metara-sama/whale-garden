/* ============================================================
   POCKET · 交互层
   职责：把机身按键 / 卡带架 / 设置抽屉接到 EmulatorJS 真实 API。
   全部契约来自 data/src/{emulator.js,GameManager.js} 与 css/pocket.css：
     - 机身按键 → gameManager.simulateInput(0, key, 1|0)
     - 暂停     → emulator.togglePlaying()（唯一真正切换主循环的方法）
     - 重启     → gameManager.restart()
     - 音量     → emulator.setVolume(0..1)
     - 存档槽   → gameManager.quickSave/quickLoad(n)，落盘在 FS 的 n-quick.state
     - 状态类   → body[data-state="idle|boot|live"]（决定抽屉分组显隐 + LED）
     - 卡带类   → .cart / .cart.filled / .cart.active
   卡带 ROM 存进本机 IndexedDB，绝不出网络。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var SLOTS = 8;

  /* ============================================================
     内置卡带：0..4 号槽预置，首次点击从 roms/ 拉取并缓存在 IndexedDB，
     之后完全离线（和用户自己插的 ROM 走同一条路径）。
     ============================================================ */
  var BUILTIN = [
    { name: '恶魔城 晓月圆舞曲', file: 'roms/castlevania-aria.gba', bytes: 8388608 },
    { name: '恶魔城 白夜协奏曲', file: 'roms/castlevania-harmony.gba', bytes: 8388608 },
    { name: '逆转裁判', file: 'roms/ace-attorney-1.gba', bytes: 8705280 },
    { name: '逆转裁判 2', file: 'roms/ace-attorney-2.gba', bytes: 10144316 },
    { name: '逆转裁判 3', file: 'roms/ace-attorney-3.gba', bytes: 9128669 }
  ];
  var BODIES = ['graphite', 'cream', 'indigo', 'moss', 'rose'];
  var BGS = ['deep', 'abyss', 'dusk', 'sand'];
  var STORE_META = 'meta';
  var STORE_BLOB = 'blob';
  var PREF_KEY = 'pocket.prefs';

  /* ---------- 元素 ---------- */
  var els = {
    body: document.body,
    console: $('#console'),
    led: $('#led'),
    standby: $('#standby'),
    hint: $('#standby-hint'),
    grid: $('#cart-grid'),
    cartNote: $('#cart-note'),
    romInput: $('#rom-input'),
    slots: $('#slots'),
    vol: $('#vol'),
    volVal: $('#vol-val'),
    btnPause: $('#btn-pause'),
    btnRestart: $('#btn-restart'),
    btnDlState: $('#btn-dl-state'),
    btnDlSav: $('#btn-dl-sav'),
    btnEject: $('#btn-eject'),
    segLayout: $('#seg-layout'),
    swBody: $('#sw-body'),
    swBg: $('#sw-bg'),
    drawer: $('#drawer'),
    scrim: $('#scrim'),
    openSettings: $('#open-settings'),
    closeSettings: $('#close-settings'),
    power: $('#power'),
    glass: $('#glass'),
    btnFs: $('#btn-fs'),
    btnFs2: $('#btn-fs-2'),
    btnFs3: $('#btn-fs-3'),
    fsExit: $('#fs-exit'),
    toast: $('#toast')
  };

  /* ---------- 状态 ---------- */
  var state = { slot: -1, phase: 'idle', rom: null, paused: false };
  var metaCache = {};
  var prefs = { body: 'graphite', bg: 'deep', layout: 'gba', vol: 70 };
  var toastTimer = null;

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (BODIES.indexOf(o.body) > -1) prefs.body = o.body;
      if (BGS.indexOf(o.bg) > -1) prefs.bg = o.bg;
      if (o.layout === 'gba' || o.layout === 'gbc') prefs.layout = o.layout;
      var v = parseInt(o.vol, 10);
      if (!isNaN(v) && v >= 0 && v <= 100) prefs.vol = v;
    } catch (e) { /* 忽略 */ }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 小而稳的工具 ---------- */
  function toast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2000);
  }

  function em() {
    var b = window.POCKET_BOOT;
    return (b && b.emulator) || null;
  }

  function setPhase(p) {
    state.phase = p;
    els.body.dataset.state = p === 'live' ? 'live' : (p === 'boot' ? 'boot' : 'idle');
    if (els.led) {
      els.led.classList.toggle('is-on', p === 'live');
      els.led.classList.toggle('is-boot', p === 'boot');
    }
    if (p !== 'live') {
      state.paused = false;
      updatePauseBtn();
    }
  }

  function updatePauseBtn() {
    if (!els.btnPause) return;
    els.btnPause.textContent = state.paused ? '继续' : '暂停';
    els.btnPause.classList.toggle('on', !!state.paused);
  }

  function download(data, name) {
    var blob = (data instanceof Blob) ? data : new Blob([data], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 4000);
  }

  function baseName() {
    var m = metaCache[state.slot];
    var n = m && m.name ? m.name : 'pocket';
    return n.replace(/\.[^.]+$/, '');
  }

  /* ---------- IndexedDB：卡带架 = 本机存储 ---------- */
  var dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('无 IndexedDB')); return; }
      var req = indexedDB.open('pocket-roms', 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE_META)) d.createObjectStore(STORE_META);
        if (!d.objectStoreNames.contains(STORE_BLOB)) d.createObjectStore(STORE_BLOB);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
    });
    return dbPromise;
  }

  function idb(store, mode, run) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode);
        var s = t.objectStore(store);
        var r = run(s);
        t.oncomplete = function () { resolve(r && r.result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('事务中断')); };
      });
    });
  }
  var idbGet = function (s, k) { return idb(s, 'readonly', function (o) { return o.get(k); }); };
  var idbPut = function (s, k, v) { return idb(s, 'readwrite', function (o) { return o.put(v, k); }); };
  var idbDel = function (s, k) { return idb(s, 'readwrite', function (o) { return o.delete(k); }); };
  var idbAll = function (s) { return idb(s, 'readonly', function (o) { return o.getAll(); }); };

  /* ---------- 卡带架 ---------- */
  function paintCarts() {
    if (!els.grid) return;
    els.grid.innerHTML = '';
    for (var i = 0; i < SLOTS; i++) {
      var m = metaCache[i];
      var preset = BUILTIN[i];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cart';
      b.dataset.slot = String(i);
      var plus = document.createElement('span');
      plus.className = 'cart-plus';
      plus.textContent = '+';
      var lab = document.createElement('span');
      lab.className = 'cart-label';
      lab.textContent = (m && m.name) ? m.name : (preset ? preset.name : '空卡');
      b.appendChild(plus);
      b.appendChild(lab);
      if (m && m.name) b.classList.add('filled');
      else if (preset) {
        b.classList.add('preset');
        var badge = document.createElement('span');
        badge.className = 'cart-badge';
        badge.textContent = '内置';
        b.appendChild(badge);
        var prog = document.createElement('span');
        prog.className = 'cart-prog';
        b.appendChild(prog);
      }
      if (state.slot === i && (state.phase === 'live' || state.phase === 'boot')) b.classList.add('active');
      els.grid.appendChild(b);
    }
    if (els.cartNote) {
      var cur = metaCache[state.slot];
      if (state.phase === 'live' && cur) els.cartNote.textContent = '正在运行 · ' + cur.name;
      else if (state.phase === 'boot' && cur) els.cartNote.textContent = '载入中 · ' + cur.name;
      else {
        var n = 0, p = 0;
        for (var k = 0; k < SLOTS; k++) {
          if (metaCache[k] && metaCache[k].name) n++;
          else if (BUILTIN[k]) p++;
        }
        if (n) els.cartNote.textContent = '未插入 · 架上有 ' + n + ' 张卡带' + (p ? '（还有 ' + p + ' 张内置未读取）' : '');
        else els.cartNote.textContent = '未插入 · ' + p + ' 张内置卡带 + ' + (SLOTS - p) + ' 个空槽';
      }
    }
  }

  function scanCarts() {
    idbAll(STORE_META).then(function (list) {
      metaCache = {};
      (list || []).forEach(function (m) {
        if (!m) return;
        if (m.name) metaCache[m.slot] = m;
      });
      paintCarts();
    }).catch(function () { paintCarts(); });
  }

  /* ---------- 内置卡带：流式读取 + 进度 + 缓存 ---------- */
  function fmtSize(n) {
    if (!n) return '';
    return (n / 1048576).toFixed(1) + 'MB';
  }

  /* 内置 ROM 多源竞速：jsDelivr（GitHub 镜像，速度快）+ 站点同源，谁先回谁赢 */
  var CDN_BASE = 'https://cdn.jsdelivr.net/gh/Metara-sama/whale-garden@main/projects/pocket/';

  function romUrls(file) {
    return [CDN_BASE + file, file];
  }

  function raceRom(file) {
    var urls = romUrls(file);
    var ctrls = urls.map(function () {
      return (typeof AbortController === 'function') ? new AbortController() : null;
    });
    var tasks = urls.map(function (u, i) {
      var opt = ctrls[i] ? { signal: ctrls[i].signal } : undefined;
      return fetch(u, opt).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' @' + u);
        return { res: res, i: i };
      });
    });
    var pick = Promise.any
      ? Promise.any(tasks)
      : new Promise(function (resolve, reject) {
          var left = tasks.length;
          tasks.forEach(function (t) {
            t.then(resolve, function () { if (--left === 0) reject(new Error('多源均失败')); });
          });
        });
    return pick.then(function (win) {
      ctrls.forEach(function (c, i) {
        if (i !== win.i && c) { try { c.abort(); } catch (e) { /* 忽略 */ } }
      });
      return win.res;
    });
  }

  function fetchBuiltin(slot) {
    var p = BUILTIN[slot];
    if (!p) return;
    if (state.phase === 'live' || state.phase === 'boot') { toast('先弹出当前卡带'); return; }
    var card = els.grid ? els.grid.querySelector('.cart[data-slot="' + slot + '"]') : null;
    var prog = card ? card.querySelector('.cart-prog') : null;
    var label = card ? card.querySelector('.cart-label') : null;
    var done = 0;
    var total = p.bytes || 0;
    toast('正在读取「' + p.name + '」' + fmtSize(total));

    raceRom(p.file).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var len = parseInt(res.headers.get('content-length') || '0', 10);
      if (len > 0) total = len;
      if (!res.body || typeof res.body.getReader !== 'function') return res.arrayBuffer();
      var reader = res.body.getReader();
      var chunks = [];
      var pump = function () {
        return reader.read().then(function (r) {
          if (r.done) {
            var all = new Uint8Array(done);
            var off = 0;
            for (var i = 0; i < chunks.length; i++) { all.set(chunks[i], off); off += chunks[i].length; }
            return all.buffer;
          }
          chunks.push(r.value);
          done += r.value.length;
          var pct = total ? Math.min(99, Math.round(done / total * 100)) : 0;
          if (prog) prog.style.width = pct + '%';
          if (label) label.textContent = p.name + ' ' + pct + '%';
          return pump();
        });
      };
      return pump();
    }).then(function (buf) {
      var rec = { slot: slot, name: p.name + '.gba', size: buf.byteLength, builtin: p.file };
      return idbPut(STORE_BLOB, slot, buf)
        .then(function () { return idbPut(STORE_META, slot, rec); })
        .then(function () {
          metaCache[slot] = rec;
          toast('卡带已就位 · ' + fmtSize(buf.byteLength));
          insert(slot);
        });
    }).catch(function (err) {
      paintCarts();
      toast('读取失败：' + ((err && err.message) || err));
    });
  }

  /* ---------- 插卡 / 载入 ---------- */
  function insert(slot) {
    if (!window.POCKET_BOOT) { toast('引导层还没就绪'); return; }
    var meta = metaCache[slot];
    if (!meta || !meta.name) { toast('这张卡带是空的'); return; }
    idbGet(STORE_BLOB, slot).then(function (buf) {
      if (!buf) { toast('卡带数据丢了，请重新选择 ROM'); return; }
      var file = new File([buf], meta.name, { type: 'application/octet-stream' });
      state.slot = slot;
      state.rom = file;
      setPhase('boot');
      if (els.standby) els.standby.hidden = false;
      if (els.hint) els.hint.textContent = '载入卡带中…';
      paintCarts();

      var p = window.POCKET_BOOT.boot({
        rom: file,
        volume: prefs.vol / 100,
        onReady: function () {
          if (els.hint) els.hint.textContent = '启动中…';
        },
        onStart: function (emulator) {
          setPhase('live');
          if (els.standby) els.standby.hidden = true;
          applyVolume(emulator);
          flashSlots();
          paintCarts();
          toast('已插入 ' + meta.name);
        },
        onError: function (err) {
          setPhase('idle');
          state.slot = -1;
          state.rom = null;
          if (els.standby) els.standby.hidden = false;
          if (els.hint) els.hint.textContent = '载入失败 · 再点一次卡带';
          paintCarts();
          toast('载入失败：' + ((err && err.message) || err || '未知错误'));
        }
      });
      if (p && p.catch) p.catch(function () { /* onError 已处理 */ });
    }).catch(function (err) {
      toast('读取卡带失败：' + ((err && err.message) || err));
    });
  }

  function pickRom(slot) {
    if (!els.romInput) return;
    els.romInput.dataset.slot = String(slot);
    els.romInput.value = '';
    els.romInput.click();
  }

  function onRomPicked() {
    var f = els.romInput.files && els.romInput.files[0];
    var slot = parseInt(els.romInput.dataset.slot, 10);
    if (isNaN(slot)) slot = 0;
    if (!f) return;
    if (state.phase === 'live' || state.phase === 'boot') { toast('先弹出当前卡带'); return; }
    var rec = { slot: slot, name: f.name, size: f.size };
    toast('正在写入卡带…');
    f.arrayBuffer().then(function (buf) {
      return idbPut(STORE_BLOB, slot, buf).then(function () {
        return idbPut(STORE_META, slot, rec);
      });
    }).then(function () {
      metaCache[slot] = rec;
      paintCarts();
      insert(slot);
    }).catch(function (err) {
      toast('写入失败：' + ((err && err.message) || err));
    });
  }

  function removeCart(slot) {
    delete metaCache[slot];
    Promise.all([idbDel(STORE_META, slot), idbDel(STORE_BLOB, slot)])
      .catch(function () { /* 忽略 */ })
      .then(function () { paintCarts(); toast('卡带已从架上取走'); });
  }

  /* ---------- 机身按键 → simulateInput ---------- */
  function keyIndex(el) {
    var k = parseInt(el.dataset.key, 10);
    return isNaN(k) ? -1 : k;
  }

  function press(el, down) {
    var idx = keyIndex(el);
    if (idx < 0) return;
    if (down) el.classList.add('down'); else el.classList.remove('down');
    var e = em();
    if (!e || !e.gameManager) return;
    try { e.gameManager.simulateInput(0, idx, down ? 1 : 0); } catch (err) { /* 忽略 */ }
  }

  function bindKeys() {
    var nodes = $$('[data-key]');
    nodes.forEach(function (el) {
      el.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (el.setPointerCapture) { try { el.setPointerCapture(ev.pointerId); } catch (e) {} }
        press(el, true);
      });
      var up = function (ev) {
        if (ev) ev.preventDefault();
        press(el, false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', function () { press(el, false); });
      // 键盘可达性
      el.addEventListener('keydown', function (ev) {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); press(el, true); }
      });
      el.addEventListener('keyup', function (ev) {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); press(el, false); }
      });
    });
    // 失焦时全部松手，避免按键卡住
    window.addEventListener('blur', function () {
      nodes.forEach(function (el) { press(el, false); });
    });
  }

  /* ---------- 音量 ---------- */
  function applyVolume(emulator) {
    if (els.vol) els.vol.value = String(prefs.vol);
    if (els.volVal) els.volVal.textContent = String(prefs.vol);
    var e = emulator || em();
    if (!e) return;
    try {
      if (typeof e.setVolume === 'function') e.setVolume(prefs.vol / 100);
      e.volume = prefs.vol / 100;
    } catch (err) { /* 忽略 */ }
  }

  /* ---------- 暂停 / 重启 ---------- */
  function togglePause() {
    var e = em();
    if (!e || typeof e.togglePlaying !== 'function') { toast('还没开始运行'); return; }
    try { e.togglePlaying(); } catch (err) { toast('切换失败'); return; }
    state.paused = !!e.paused;
    updatePauseBtn();
  }

  function restartGame() {
    var e = em();
    if (!e || !e.gameManager || typeof e.gameManager.restart !== 'function') { toast('还没开始运行'); return; }
    try { e.gameManager.restart(); } catch (err) { toast('重启失败'); return; }
    state.paused = false;
    updatePauseBtn();
    flashSlots();
    toast('已重启');
  }

  /* ---------- 存档槽 ---------- */
  function hasState(n) {
    var e = em();
    if (!e || !e.gameManager || !e.gameManager.FS) return false;
    try { return !!e.gameManager.FS.analyzePath('/' + n + '-quick.state').exists; } catch (err) { return false; }
  }

  function buildSlots() {
    if (!els.slots) return;
    els.slots.innerHTML = '';
    for (var n = 1; n <= 3; n++) {
      var box = document.createElement('div');
      box.className = 'slot';
      var load = document.createElement('button');
      load.type = 'button';
      load.className = 'slot-load';
      load.dataset.n = String(n);
      load.textContent = String(n);
      load.disabled = true;
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'slot-save';
      save.dataset.n = String(n);
      save.textContent = '存';
      box.appendChild(load);
      box.appendChild(save);
      els.slots.appendChild(box);
    }
    els.slots.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('button[data-n]') : null;
      if (!b) return;
      var n = parseInt(b.dataset.n, 10);
      var e = em();
      if (!e || !e.gameManager) { toast('还没开始运行'); return; }
      if (b.classList.contains('slot-save')) {
        var ok = false;
        try { ok = e.gameManager.quickSave(n); } catch (err) { ok = false; }
        if (ok) { toast('已存到槽 ' + n); flashSlots(); }
        else toast('存档失败（这一帧抓不到状态）');
      } else {
        if (b.disabled) { toast('槽 ' + n + ' 还是空的'); return; }
        try { e.gameManager.quickLoad(n); } catch (err) { toast('读档失败'); return; }
        state.paused = false;
        updatePauseBtn();
        toast('已读取槽 ' + n);
      }
    });
  }

  function flashSlots() {
    if (!els.slots) return;
    $$('.slot-load', els.slots).forEach(function (b) {
      var n = parseInt(b.dataset.n, 10);
      var has = hasState(n);
      b.classList.toggle('has', has);
      b.disabled = !has;
    });
  }

  /* ---------- 导出 ---------- */
  function downloadState() {
    var e = em();
    if (!e || !e.gameManager) { toast('还没开始运行'); return; }
    var data = null;
    try { data = e.gameManager.getState(); } catch (err) { data = null; }
    if (!data) { toast('抓不到当前状态'); return; }
    download(data, baseName() + '.state');
    toast('即时存档已导出');
  }

  function downloadSav() {
    var e = em();
    if (!e || !e.gameManager) { toast('还没开始运行'); return; }
    var data = null;
    try { data = e.gameManager.getSaveFile(true); } catch (err) { data = null; }
    if (!data) { toast('还没有电池存档（先在游戏里存一次）'); return; }
    download(data, baseName() + '.sav');
    toast('.sav 已导出');
  }

  /* ---------- 抽屉 / 外观 ---------- */
  function openDrawer() {
    if (!els.drawer) return;
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    if (els.scrim) {
      els.scrim.hidden = false;
      requestAnimationFrame(function () { els.scrim.classList.add('show'); });
    }
  }
  function closeDrawer() {
    if (!els.drawer) return;
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    if (els.scrim) {
      els.scrim.classList.remove('show');
      setTimeout(function () { if (!els.scrim.classList.contains('show')) els.scrim.hidden = true; }, 240);
    }
  }

  function applyBody(id) {
    prefs.body = id;
    els.body.dataset.body = id;
    $$('.sw', els.swBody).forEach(function (b) { b.classList.toggle('on', b.dataset.id === id); });
    savePrefs();
  }
  function applyBg(id) {
    prefs.bg = id;
    els.body.dataset.bg = id;
    $$('.sw', els.swBg).forEach(function (b) { b.classList.toggle('on', b.dataset.id === id); });
    savePrefs();
  }
  function applyLayout(v) {
    prefs.layout = v;
    if (els.console) els.console.dataset.layout = v;
    $$('button[data-v]', els.segLayout).forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    savePrefs();
    var e = em();
    if (e && typeof e.handleResize === 'function') {
      try { e.handleResize(); } catch (err) { /* 忽略 */ }
    }
    // 全屏状态下换布局：按新比例重新撑屏
    if (fsOn) settleFs();
  }

  function buildSwatches() {
    if (els.swBody) {
      els.swBody.innerHTML = '';
      BODIES.forEach(function (id) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw';
        b.dataset.id = id;
        b.setAttribute('aria-label', id);
        b.addEventListener('click', function () { applyBody(id); });
        els.swBody.appendChild(b);
      });
    }
    if (els.swBg) {
      els.swBg.innerHTML = '';
      BGS.forEach(function (id) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw';
        b.dataset.id = id;
        b.setAttribute('aria-label', id);
        b.addEventListener('click', function () { applyBg(id); });
        els.swBg.appendChild(b);
      });
    }
  }

  /* ---------- 电源 / 弹卡 ---------- */
  var ejectArmed = false, ejectTimer = null;

  function disarmEject() {
    ejectArmed = false;
    clearTimeout(ejectTimer);
    if (els.btnEject) {
      els.btnEject.textContent = '⏏ 弹出卡带';
      els.btnEject.classList.remove('on');
    }
  }

  function armEject() {
    if (state.phase !== 'live' && state.phase !== 'boot') { toast('现在没插卡带'); return; }
    if (!ejectArmed) {
      ejectArmed = true;
      if (els.btnEject) {
        els.btnEject.textContent = '⏏ 再点一次确认';
        els.btnEject.classList.add('on');
      }
      ejectTimer = setTimeout(disarmEject, 3200);
      return;
    }
    disarmEject();
    doEject();
  }

  var ejecting = false;
  function doEject() {
    if (ejecting) return;
    ejecting = true;
    var e = em();
    toast('正在弹出卡带…');
    var fire = function () {
      // EmulatorJS 4.2.3 无 destroy()，wasm 实例随页面存活 → 弹卡后刷新归位，
      // 卡带仍留在架上（IndexedDB），随时可以再插。
      setTimeout(function () { location.reload(); }, 260);
    };
    if (!e) { fire(); return; }
    try { if (!e.paused) e.pause(); } catch (err) { /* 忽略 */ }
    try {
      if (e.gameManager && e.gameManager.saveSaveFiles) e.gameManager.saveSaveFiles();
    } catch (err) { /* 忽略 */ }
    try {
      if (e.gameManager && e.gameManager.FS && typeof e.gameManager.FS.syncfs === 'function') {
        e.gameManager.FS.syncfs(false, fire);
      } else fire();
    } catch (err) { fire(); }
    setTimeout(function () { if (ejecting) fire(); }, 1200); // 兜底
  }

  function toggleStandby() {
    var e = em();
    if (!e || (state.phase !== 'live')) { toast('先插入一张卡带'); return; }
    state.paused = !e.paused;
    try { e.togglePlaying(); } catch (err) { /* 忽略 */ }
    state.paused = !!e.paused;
    updatePauseBtn();
    if (els.standby) els.standby.hidden = !state.paused;
    if (els.hint && state.paused) els.hint.textContent = '已待机 · 按电源键唤醒';
  }

  function bindPower() {
    if (!els.power) return;
    var timer = null, longPressed = false;
    els.power.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      longPressed = false;
      timer = setTimeout(function () {
        longPressed = true;
        armEject();
      }, 620);
    });
    var clear = function () { clearTimeout(timer); };
    els.power.addEventListener('pointerup', function (ev) {
      ev.preventDefault();
      clear();
      if (!longPressed) toggleStandby();
    });
    els.power.addEventListener('pointercancel', clear);
    els.power.addEventListener('pointerleave', clear);
    els.power.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggleStandby(); }
    });
  }

  /* ---------- 全屏：只放大掌机，实体按键照留，屏幕按比例适配 ---------- */
  var fsOn = false;
  var fsTimer = null;

  function screenRatio() {
    return prefs.layout === 'gbc' ? (10 / 9) : (3 / 2);
  }

  function resizeEmu() {
    var e = em();
    if (e && typeof e.handleResize === 'function') {
      try { e.handleResize(); } catch (err) { /* 忽略 */ }
    }
  }

  /* 在 .bezel 里按真实可用空间等比撑满屏幕（不裁切、不变形） */
  function fitGlass() {
    if (!els.glass) return;
    if (!fsOn) {
      els.glass.style.width = '';
      els.glass.style.height = '';
      return;
    }
    var host = els.glass.parentNode;
    if (!host) return;
    var pad = 20;
    var availW = Math.max(0, host.clientWidth - pad);
    var availH = Math.max(0, host.clientHeight - pad);
    if (availW < 80 || availH < 60) return;
    var r = screenRatio();
    var w = availW;
    var h = w / r;
    if (h > availH) { h = availH; w = h * r; }
    els.glass.style.width = Math.round(w) + 'px';
    els.glass.style.height = Math.round(h) + 'px';
  }

  function syncFsUi() {
    if (els.body && els.body.classList) els.body.classList.toggle('pocket-fs', fsOn);
    if (els.btnFs) els.btnFs.textContent = fsOn ? '⤢ 退出全屏' : '⛶ 全屏';
    var t = fsOn ? '退出全屏' : '全屏';
    if (els.btnFs2) els.btnFs2.textContent = fsOn ? '退出全屏' : '全屏玩';
    if (els.btnFs3) els.btnFs3.textContent = t;
  }

  function settleFs() {
    clearTimeout(fsTimer);
    requestAnimationFrame(function () { fitGlass(); resizeEmu(); });
    fsTimer = setTimeout(function () { fitGlass(); resizeEmu(); }, 280);
  }

  function enterFs() {
    if (fsOn) return;
    fsOn = true;
    syncFsUi();
    closeDrawer();
    try {
      var el = els.console;
      if (el && typeof el.requestFullscreen === 'function') {
        var p = el.requestFullscreen({ navigationUI: 'hide' });
        if (p && p.catch) p.catch(function () { /* 不支持就用 CSS 全屏兜底 */ });
      }
    } catch (err) { /* 忽略 */ }
    settleFs();
  }

  function exitFs() {
    if (!fsOn) return;
    fsOn = false;
    syncFsUi();
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(function () { /* 忽略 */ });
      }
    } catch (err) { /* 忽略 */ }
    if (els.glass) { els.glass.style.width = ''; els.glass.style.height = ''; }
    settleFs();
  }

  function toggleFs() { if (fsOn) exitFs(); else enterFs(); }

  function bindFullscreen() {
    if (els.btnFs) els.btnFs.addEventListener('click', toggleFs);
    if (els.btnFs2) els.btnFs2.addEventListener('click', toggleFs);
    if (els.btnFs3) els.btnFs3.addEventListener('click', toggleFs);
    if (els.fsExit) els.fsExit.addEventListener('click', exitFs);
    document.addEventListener('fullscreenchange', function () {
      // 用户按系统返回键 / Esc 退出系统全屏时同步内部状态
      if (!document.fullscreenElement && fsOn) exitFs();
    });
    window.addEventListener('resize', function () { fitGlass(); resizeEmu(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { fitGlass(); resizeEmu(); }, 320);
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); toggleFs(); }
      else if (ev.key === 'Escape' && fsOn) exitFs();
    });
  }

  /* ---------- 全局导出（boot.js 会调 POCKET.flashSlots） ---------- */
  window.POCKET = {
    flashSlots: flashSlots,
    toast: toast,
    reloadCarts: scanCarts,
    toggleFullscreen: toggleFs,
    get fullscreen() { return fsOn; },
    get state() { return state; }
  };

  /* ---------- 启动 ---------- */
  function init() {
    loadPrefs();

    // 首屏：index.html 没写 data-state，这里补 idle
    setPhase('idle');
    if (els.standby) els.standby.hidden = false;
    if (els.hint) els.hint.textContent = '选择下方卡带插入';

    buildSwatches();
    applyBody(prefs.body);
    applyBg(prefs.bg);
    applyLayout(prefs.layout);
    applyVolume(null);

    buildSlots();
    scanCarts();
    bindKeys();
    bindPower();
    bindFullscreen();

    // 卡带架：点击插入 / 长按移除
    if (els.grid) {
      var pressTimer = null, longDone = false;
      els.grid.addEventListener('pointerdown', function (ev) {
        var cart = ev.target.closest ? ev.target.closest('.cart') : null;
        if (!cart) return;
        longDone = false;
        var slot = parseInt(cart.dataset.slot, 10);
        var filled = cart.classList.contains('filled');
        if (!filled) return;
        pressTimer = setTimeout(function () {
          longDone = true;
          if (state.slot === slot && state.phase !== 'idle') { toast('先弹出正在运行的卡带'); return; }
          removeCart(slot);
        }, 680);
      });
      var cancelPress = function () { clearTimeout(pressTimer); };
      els.grid.addEventListener('pointerup', cancelPress);
      els.grid.addEventListener('pointercancel', cancelPress);
      els.grid.addEventListener('pointerleave', cancelPress);
      els.grid.addEventListener('click', function (ev) {
        if (longDone) { longDone = false; return; }
        var cart = ev.target.closest ? ev.target.closest('.cart') : null;
        if (!cart) return;
        var slot = parseInt(cart.dataset.slot, 10);
        if (state.phase === 'live' || state.phase === 'boot') {
          toast(state.slot === slot ? '这张卡带正在运行' : '先弹出当前卡带');
          return;
        }
        if (metaCache[slot] && metaCache[slot].name) insert(slot);
        else if (BUILTIN[slot]) fetchBuiltin(slot);
        else pickRom(slot);
      });
    }

    if (els.romInput) els.romInput.addEventListener('change', onRomPicked);

    if (els.openSettings) els.openSettings.addEventListener('click', openDrawer);
    if (els.closeSettings) els.closeSettings.addEventListener('click', closeDrawer);
    if (els.scrim) els.scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeDrawer();
    });

    if (els.btnPause) els.btnPause.addEventListener('click', togglePause);
    if (els.btnRestart) els.btnRestart.addEventListener('click', restartGame);
    if (els.btnDlState) els.btnDlState.addEventListener('click', downloadState);
    if (els.btnDlSav) els.btnDlSav.addEventListener('click', downloadSav);
    if (els.btnEject) els.btnEject.addEventListener('click', armEject);

    if (els.segLayout) {
      els.segLayout.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('button[data-v]') : null;
        if (!b) return;
        applyLayout(b.dataset.v);
      });
    }

    if (els.vol) {
      els.vol.addEventListener('input', function () {
        var v = parseInt(els.vol.value, 10);
        if (isNaN(v)) v = 0;
        prefs.vol = v;
        if (els.volVal) els.volVal.textContent = String(v);
        var e = em();
        if (e) {
          try {
            if (typeof e.setVolume === 'function') e.setVolume(v / 100);
            e.volume = v / 100;
          } catch (err) { /* 忽略 */ }
        }
        savePrefs();
      });
    }

    updatePauseBtn();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
