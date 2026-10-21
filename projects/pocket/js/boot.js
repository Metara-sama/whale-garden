/* ============================================================
   POCKET · 引导层
   职责：把一枚 ROM(File) 交给自托管 EmulatorJS 4.2.3，并返回
         「已就绪 / 已开跑」的通知。
   约束（已逐行核对 data/src/loader.js 与 data/src/emulator.js）：
     - data/loader.js 只会加载 emulator.min.js / emulator.min.css，
       本项目 data/ 下并无这两个文件 → 必须置 EJS_DEBUG_XX = true
       走 8 个 src/*.js + emulator.css 的非压缩路径。
     - loader.js 全篇只在最后 new EmulatorJS(EJS_player, config)，
       EJS_player 必须是「页面里真实存在的选择器字符串」。
     - localization/ 下只有 zh-CN.json，语言只能给 "zh-CN"。
     - EJS_ready 由 createStartButton() 内 setTimeout(...,20) 触发；
       EJS_onGameStart 由 startGame() 末尾 callEvent("start") 触发。
     - pocket.css 把 .ejs_start_button 压成 display:none，
       所以 ready 之后必须手动 click 它才会真正开跑。
   ============================================================ */
(function () {
  'use strict';

  var DATA_PATH = 'data/';
  var LOADER_SRC = DATA_PATH + 'loader.js';

  var loaderPromise = null;
  var emulatorPromise = null;

  /* ---------- 小工具 ---------- */
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
      s.onerror = function () { reject(new Error('loader.js 载入失败')); };
      document.head.appendChild(s);
    });
    return loaderPromise;
  }

  /* ---------- 2. 把 File 塞进 EmulatorJS ---------- */
  // 说明：gameUrl 传 File 时，emulator.js 的 toData() 命中 Blob 分支，
  // downloadFile → data.then 直接拿到 arraybuffer，全程不发网络请求；
  // 随后 fileName = file.name，扩展名决定 getCore() → gb:gambatte / gba:mgba。
  function boot(opts) {
    opts = opts || {};
    if (emulatorPromise) return emulatorPromise;

    var rom = opts.rom || null;
    var onReady = onceCallback(opts.onReady);
    var onStart = onceCallback(opts.onStart);
    var onError = onceCallback(opts.onError);

    if (!rom) {
      return Promise.reject(new Error('缺少 ROM'));
    }

    var ext = (rom.name.split('.').pop() || '').toLowerCase();
    // .zip / .7z 由 compression.js 解压后再判定真实 rom 扩展名，
    // 这里只给「能确认」的做预填，其余交给 EmulatorJS 自己嗅探。
    var system = null;
    if (ext === 'gba') system = 'gba';
    else if (ext === 'gb' || ext === 'gbc') system = 'gb';

    emulatorPromise = loadLoader().then(function () {
      /* ---- 全局配置：必须在 loader.js 执行 new 之前全部就位 ---- */
      window.EJS_pathtodata = DATA_PATH;
      window.EJS_DEBUG_XX = true;          // data/ 下无 emulator.min.*，必须走 src/
      window.EJS_player = '#ejs-screen';
      window.EJS_core = system;            // 已知扩展名时直给；压缩包留空自动嗅探
      window.EJS_gameUrl = rom;            // ← File 对象，绝不落盘、绝不上传
      window.EJS_gameName = rom.name.replace(/\.[^.]+$/, '');
      window.EJS_language = 'zh-CN';       // localization/ 下唯一语言包
      window.EJS_disableAutoLang = true;
      window.EJS_startOnLoaded = false;    // 由我们自己的「插卡」流程决定何时开跑
      window.EJS_volume = (typeof opts.volume === 'number') ? opts.volume : 0.7;
      window.EJS_color = '#7fd4ff';
      window.EJS_backgroundColor = '#000';
      window.EJS_backgroundImage = undefined;
      window.EJS_threads = false;
      window.EJS_softLoad = false;
      window.EJS_noAutoFocus = true;
      window.EJS_disableCue = true;
      window.EJS_hideSettings = true;      // 自带设置面板我们不用，全部隐藏
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
        var btn = document.querySelector('#ejs-screen .ejs_start_button');
        if (btn) {
          // pocket.css 已把它隐藏，这里触发真正的开跑。
          try { btn.click(); } catch (e) { /* 忽略 */ }
        }
        onReady(window.EJS_emulator);
      };

      window.EJS_onGameStart = function () {
        var em = window.EJS_emulator;
        if (em) {
          // 与 #vol 的初始 70 对齐（EmulatorJS 默认 0.5）。
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

      /* ---- 真正拉起 loader ---- */
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = LOADER_SRC;
        s.async = false;
        s.onload = function () {
          // loader 是 async IIFE，window.EJS_emulator 会稍后出现。
          var tries = 0;
          (function poll() {
            if (window.EJS_emulator) return resolve(window.EJS_emulator);
            if (++tries > 200) return reject(new Error('模拟器初始化超时'));
            setTimeout(poll, 50);
          })();
        };
        s.onerror = function () { reject(new Error('loader.js 载入失败')); };
        document.head.appendChild(s);
      });
    }).catch(function (err) {
      emulatorPromise = null;   // 允许换一张卡带重试
      onError(err);
      throw err;
    });

    return emulatorPromise;
  }

  /* ---------- 3. 拆机 ---------- */
  // EmulatorJS 4.2.3 没有公开 destroy()，硬拆只能：
  //   ① 清掉 #ejs-screen 的 DOM（parent.innerHTML = ""）；
  //   ② 丢掉 loader 注入的 script 标记，把 EJS_emulator 置空；
  // 真正的 wasm 实例随页面存活，所以「弹卡」后换卡是刷新级操作 ——
  // app.js 会以 location.reload() 的方式落地，这里只做尽力而为的收尾。
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
