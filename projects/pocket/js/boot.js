/* ============================================================
   POCKET · 引导层
   职责：把一枚 ROM(File) 交给自托管 EmulatorJS 4.2.3，并返回
        「已就绪 / 已开跑」的通知。
   约束（已逐行核对 data/loader.js 与 data/src/emulator.js）：
     - loader.js 是一个 async IIFE，**一执行就读取 window.EJS_\*** 拼 config，
       并在末尾 new EmulatorJS(EJS_player, config)。
       => 所有 EJS_* 必须在注入 loader.js **之前**就位，否则会用空配置
          实例化出一个 gameName=undefined 的空模拟器（表现为黑色弹窗盖住屏幕）。
     - data/ 下无 emulator.min.*，必须置 EJS_DEBUG_XX = true 走 src/*.js。
     - EJS_player 必须是页面里真实存在的选择器字符串。
     - localization/ 下只有 zh-CN.json，语言只能给 "zh-CN"。
     - EJS_ready 由 createStartButton() 内 setTimeout(...,20) 触发；
       EJS_onGameStart 由 startGame() 末尾 callEvent("start") 触发。
     - 用 EJS_startOnLoaded = true 让 EJS 自己开跑，不依赖隐藏按钮的 click。
   ============================================================ */
(function () {
  'use strict';

  var DATA_PATH = 'data/';
  var LOADER_SRC = DATA_PATH + 'loader.js';

  var loaderPromise = null;
  var emulatorPromise = null;

  function onceCallback(fn) {
    var done = false;
    return function (arg) {
      if (done) return;
      done = true;
      if (typeof fn === 'function') fn(arg);
    };
  }

  // loader.js 里 `document.currentScript` 在动态注入的场景下不可靠，
  // 统一用 EJS_pathtodata 显式指定，彻底绕开路径推断。
  function dataUrl(file) {
    if (typeof window.EJS_paths === 'object' && window.EJS_paths &&
        typeof window.EJS_paths[file] === 'string') {
      return window.EJS_paths[file];
    }
    if (file.slice(-3) === '.js' && file.indexOf('emulator.min') === -1) {
      return DATA_PATH + 'src/' + file;
    }
    return DATA_PATH + file;
  }

  /* ---------- 1. 注入 loader.js（只注入一次） ---------- */
  function loadLoader() {
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LOADER_SRC;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        loaderPromise = null;
        reject(new Error('loader.js 载入失败'));
      };
      document.head.appendChild(s);
    });
    return loaderPromise;
  }

  /* ---------- 2. 全部 EJS_* 全局：必须在注入前写好 ---------- */
  function configure(rom, system, opts, onReady, onStart) {
    window.EJS_pathtodata = DATA_PATH;
    window.EJS_DEBUG_XX = true;          // data/ 下无 emulator.min.*，必须走 src/
    window.EJS_player = '#ejs-screen';
    window.EJS_core = system;            // 已知扩展名时直给；压缩包留空自动嗅探
    window.EJS_gameUrl = rom;            // ← File 对象，绝不落盘、绝不上传
    window.EJS_gameName = rom.name.replace(/\.[^.]+$/, '');
    window.EJS_language = 'zh-CN';       // localization/ 下唯一语言包
    window.EJS_disableAutoLang = true;
    window.EJS_startOnLoaded = true;     // 配置就位后立即开跑
    window.EJS_volume = (typeof opts.volume === 'number') ? opts.volume : 0.7;
    window.EJS_color = '#7fd4ff';
    window.EJS_backgroundColor = '#000';
    window.EJS_backgroundImage = undefined;
    window.EJS_threads = false;
    window.EJS_softLoad = false;
    window.EJS_noAutoFocus = true;
    window.EJS_disableCue = true;
    window.EJS_hideSettings = true;
    window.EJS_Buttons = {
      restart: false,
      playPause: false,
      saveState: false,
      loadState: false,
      saveSavFiles: false,
      loadSavFiles: false,
      quickSave: false,
      quickLoad: false,
      screenshot: false,
      cacheManager: false,
      exportSave: false,
      importSave: false,
      exitEmulation: false,
      settings: false,
      fullscreen: false,
      gamepad: false,
      cheat: false,
      volume: false,
      mute: false,
      contextMenu: false
    };
    // 虚拟手柄/广告/网络对战全部关掉——实体机身才是唯一的输入设备。
    window.EJS_VirtualGamepadSettings = undefined;
    window.EJS_AdUrl = undefined;
    window.EJS_netplayServer = undefined;
    window.EJS_defaultOptions = { 'save-state-location': 'browser' };

    window.EJS_ready = function () {
      // 注意：此时 rom 还在下载/解压，this.started 仍为 false，
      // 绝不能在这里补调 startGame()，否则会和 startOnLoad 抢跑。
      onReady(window.EJS_emulator);
    };
    window.EJS_onGameStart = function () {
      var em = window.EJS_emulator;
      if (em) {
        try { em.setVolume(window.EJS_volume); } catch (e) { /* 忽略 */ }
      }
      onStart(em);
    };
    window.EJS_onLoadState = function () {
      if (window.POCKET && window.POCKET.flashSlots) window.POCKET.flashSlots();
    };
    window.EJS_onSaveState = function () {
      if (window.POCKET && window.POCKET.flashSlots) window.POCKET.flashSlots();
    };
  }

  /* ---------- 3. 把 File 塞进 EmulatorJS ---------- */
  function boot(opts) {
    opts = opts || {};
    if (emulatorPromise) return emulatorPromise;

    var rom = opts.rom || null;
    var onReady = onceCallback(opts.onReady);
    var onStart = onceCallback(opts.onStart);
    var onError = onceCallback(opts.onError);

    if (!rom) return Promise.reject(new Error('缺少 ROM'));

    var ext = (rom.name.split('.').pop() || '').toLowerCase();
    // .zip / .7z 由 compression.js 解压后再判定真实 rom 扩展名，
    // 这里只给「能确认」的做预填，其余交给 EmulatorJS 自己嗅探。
    var system = null;
    if (ext === 'gba') system = 'gba';
    else if (ext === 'gb' || ext === 'gbc') system = 'gb';

    // ① 先把配置写全（loader.js 一执行就会读）
    configure(rom, system, opts, onReady, onStart);

    // ② 再注入 loader，等 window.EJS_emulator 出现
    emulatorPromise = loadLoader().then(function () {
      return new Promise(function (resolve, reject) {
        var tries = 0;
        (function poll() {
          if (window.EJS_emulator) return resolve(window.EJS_emulator);
          if (++tries > 300) return reject(new Error('模拟器初始化超时'));
          setTimeout(poll, 50);
        })();
      });
    }).catch(function (err) {
      emulatorPromise = null;   // 允许换一张卡带重试
      onError(err);
      throw err;
    });

    return emulatorPromise;
  }

  /* ---------- 4. 拆机 ---------- */
  function teardown() {
    try {
      var em = window.EJS_emulator;
      if (em) {
        if (!em.paused) { try { em.pause(); } catch (e) {} }
        if (em.gameManager && em.gameManager.saveSaveFiles) {
          try { em.gameManager.saveSaveFiles(); } catch (e) {}
        }
      }
    } catch (e) { /* 忽略 */ }
    var scr = document.getElementById('ejs-screen');
    if (scr) scr.innerHTML = '';
    window.EJS_emulator = null;
    emulatorPromise = null;
  }

  window.POCKET_BOOT = {
    boot: boot,
    teardown: teardown,
    dataUrl: dataUrl,
    get emulator() { return window.EJS_emulator || null; }
  };
})();