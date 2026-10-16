/* ============================================================
   Whale's Garden —— 彩蛋小游戏「大鱼吃 AI」（懒加载）
   触发：连点首页吉祥物 10 次（见 app.js）
   游戏内无文字（只有一个退出键），结算页有文字 + 特效

   节奏：自动玩家 30 局通关时间中位数 ≈ 4 分钟（真人更慢）
   ============================================================ */
(function () {
  "use strict";
  if (window.WGGame) return;

  var BASE = "assets/game/";
  var MASCOT = "assets/mascot-right.webp";
  var REEF_BG = "assets/game/reef-bg.jpg";

  /* ---------- AI 实力榜：从小到大（改 r 或顺序即可调难度） ---------- */
  var AIS = [
    { id: "minimax", name: "MiniMax", r: 30 },
    { id: "glm",     name: "GLM",     r: 38 },
    { id: "kimi",    name: "Kimi",    r: 46 },
    { id: "qwen",    name: "Qwen",    r: 54 },
    { id: "grok",    name: "Grok",    r: 64 },
    { id: "claude",  name: "Claude",  r: 74 },
    { id: "gemini",  name: "Gemini",  r: 86 },
    { id: "gpt",     name: "ChatGPT", r: 100 }
  ];

  /* ---------- 数值平衡 ---------- */
  var TOKEN_GAIN = 0.45;         /* 吃一个 token 长多少体积 */
  var FISH_GAIN = 2.5;           /* 吃一条鱼长多少体积 */
  var START_R = 26;              /* 初始体积 */
  var TOKEN_SPAWN = [1.3, 2.6];  /* 每隔这么久冒一个 token */
  var TOKEN_LIFE = [9, 14];      /* token 停很久才散掉（看得见、来得及吃） */
  var TOKEN_SIZE = 26;           /* token 显示尺寸 */
  var TOKEN_MAX = 9;             /* 同时在场的上限 */
  var TOKEN_FADE = 0.8;          /* 渐显速度（越小越慢） */
  var FISH_GAP = [3, 6];         /* 出鱼间隔（比之前快一倍以上） */
  var INVULN = 2.5;              /* 开局无敌秒数 */
  var STARVE = 8;                /* 太久没出现「能吃的鱼」就放行一条 */
  var W_EAT = 0.12;              /* 场上已有能吃的鱼时，还派能吃鱼的权重（低=偏大鱼） */
  var W_HUN = 1.6;               /* 场上没有能吃的鱼时，派小鱼的权重 */

  var root = null, cvs = null, ctx = null;
  var W = 0, H = 0, DPR = 1;
  var imgs = { ai: {} };
  var player = null, fishes = [], tokens = [], sparks = [];
  var running = false, lastT = 0, eaten = 0, elapsed = 0;
  var invuln = 0, spawnT = 0, tokT = 0, starve = 0;
  var bgm = null, sfx = null, fadeT = null;

  function $(s) { return root.querySelector(s); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function maxFish() { return W < 520 ? 5 : 6; }
  function playerSpeed() { return clamp(Math.min(W, H) * 0.54, 190, 420); }

  function loadImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(im); };
      im.src = src;
    });
  }

  function fmtTime(s) {
    var m = Math.floor(s / 60), q = Math.floor(s % 60);
    return m + ":" + (q < 10 ? "0" : "") + q;
  }

  /* ============================================================
     转场：一颗颗看得见的气泡柱（三层混搭）
     ① A 层密铺（直径 1.55~2.15 倍格距，实测 5 种屏幕 100% 无缝）
     ② B 大泡 / C 小泡点缀，半透明叠出前后层次
     ③ 整层固定排布、一起匀速上推（不在屏幕上「生成」）；幕顶一排露头泡，边缘是圆的
     游戏层在气泡完全盖住屏幕之前是隐藏的，所以不会提前变蓝。
     ============================================================ */
  var cur = null, curCvs = null, curCtx = null;
  var curSprites = [[], [], []];
  var bubs = [], bubLayH = 0, bubCell = 60, curTop = 0, curOver = 0;
  var frontPop = [];
  var curMode = 0, curLevel = 1.2, curT = 0, curLast = 0, curRaf = 0;
  var curCb = null, curOutCb = null, curFail = 0, curTexT = 0;
  var curW = 0, curH = 0, curDPR = 1, texDPR = 1;
  var CUR_IN = 1.05, CUR_OUT = 0.80;   /* 涌上来 / 退下去 的时长 */

  /* 预渲染一颗气泡（不透明实心 + 泡壁 + 冷色反光 + 高光），tone 决定色调 */
  function bubbleSprite(size, tone) {
    var s = Math.max(10, Math.round(size));
    var c = document.createElement("canvas");
    c.width = s; c.height = s;
    var g = c.getContext("2d");
    if (!g || !g.createRadialGradient) return c;
    var R = s / 2 - 1;
    var pal = tone === 1
      ? ["#e8f2f9", "#d5e6f2", "#b3cde2", "#8db0cd"]
      : tone === 2
        ? ["#ebf4f7", "#d9ebf0", "#b7d6e0", "#91b9cb"]
        : ["#edf4f9", "#dbe8f2", "#b8cfe2", "#93b3cf"];

    var rg = g.createRadialGradient(R * 1.26, R * 1.3, R * 0.1, R, R, R * 1.46);
    rg.addColorStop(0, pal[0]);
    rg.addColorStop(0.40, pal[1]);
    rg.addColorStop(0.74, pal[2]);
    rg.addColorStop(1, pal[3]);
    g.beginPath(); g.arc(R, R, R, 0, 6.2832); g.fillStyle = rg; g.fill();

    /* 泡壁 */
    g.beginPath(); g.arc(R, R, R * 0.90, 0, 6.2832);
    g.strokeStyle = "rgba(255,255,255,.92)";
    g.lineWidth = Math.max(1, R * 0.10);
    g.stroke();

    /* 冷色反光 */
    g.beginPath(); g.arc(R * 1.03, R * 1.06, R * 0.76, 0.32, 1.82);
    g.strokeStyle = "rgba(122,170,222,.40)";
    g.lineWidth = Math.max(1, R * 0.13);
    g.stroke();

    /* 高光 */
    g.beginPath();
    g.ellipse(R * 0.66, R * 0.62, R * 0.26, R * 0.16, -0.6, 0, 6.2832);
    g.fillStyle = "rgba(255,255,255,.96)";
    g.fill();
    g.beginPath(); g.arc(R * 0.44, R * 0.42, R * 0.085, 0, 6.2832);
    g.fillStyle = "rgba(255,255,255,.85)";
    g.fill();
    return c;
  }

  function buildSprites() {
    if (curSprites[0].length) return;
    for (var t = 0; t < 3; t++) {
      for (var i = 0; i < 15; i++) curSprites[t].push(bubbleSprite(24 + i * 18, t));
    }
  }
  function pickSprite(dia, tone) {
    var idx = clamp(Math.round((dia - 24) / 18), 0, curSprites[0].length - 1);
    return curSprites[tone][idx];
  }

  function mkBub(x, y, dia, tone, a, bw) {
    return { x0: x, y0: y, r: dia / 2, sp: pickSprite(dia, tone), a: a, bw: bw, ph: rnd(0, 6.28) };
  }

  /* 铺一层气泡幕：A 层密铺（一颗颗看得清、负责无缝）＋B 大泡＋C 小泡点缀。
     层内每颗泡的位置是固定的，整层一起匀速上推 —— 不在屏幕上「生成」 */
  function buildBubbles() {
    bubs = [];
    if (!curW || !curH) return;
    var cell = clamp(Math.min(curW, curH) * 0.082, 44, 80);
    bubCell = cell;
    curOver = cell * 3;                       /* 层顶多升出屏幕这么多px，确保盖满 */
    bubLayH = curH + curOver * 2 + cell * 2;
    var cols = Math.ceil(curW / cell) + 2;
    var rows = Math.ceil(bubLayH / cell) + 2;

    for (var gy = -1; gy < rows; gy++) {
      for (var gx = -1; gx < cols; gx++) {
        var bx = gx * cell + (Math.random() - 0.5) * cell * 0.16 + (gy % 2 ? cell * 0.5 : 0);
        var by = gy * cell + (Math.random() - 0.5) * cell * 0.16;

        /* A：主角，密铺（直径 1.35~1.85 倍格距，抖动极小 → 叠满无缝隙） */
        var dA = cell * rnd(1.35, 1.85);
        bubs.push(mkBub(bx, by, dA, (Math.random() * 3) | 0, 1, cell * 0.05));

        /* B：大泡点缀 */
        if (Math.random() < 0.22) {
          var dB = cell * rnd(1.6, 2.6);
          bubs.push(mkBub(bx + rnd(-cell, cell), by + rnd(-cell, cell), dB,
            (Math.random() * 3) | 0, rnd(0.88, 1), cell * 0.07));
        }

        /* C：小泡点缀（半透明，打碎细节） */
        if (Math.random() < 0.85) {
          var dC = cell * rnd(0.28, 0.70);
          bubs.push(mkBub(bx + rnd(-cell, cell), by + rnd(-cell, cell), dC,
            (Math.random() * 3) | 0, rnd(0.32, 0.78), cell * 0.09));
        }
      }
    }
  }

  function buildCurtain() {
    if (cur) return true;
    try {
      cur = document.createElement("div");
      cur.id = "wg-transition";
      curCvs = document.createElement("canvas");
      curCvs.id = "wg-curtain";
      cur.appendChild(curCvs);
      document.body.appendChild(cur);
      curCtx = curCvs.getContext("2d") || null;
      buildSprites();
      return true;
    } catch (e) {
      cur = null; curCvs = null; curCtx = null;
      return false;
    }
  }

  function layoutCurtain() {
    if (!curCvs) return;
    curW = window.innerWidth || document.documentElement.clientWidth || 390;
    curH = window.innerHeight || document.documentElement.clientHeight || 780;
    curDPR = Math.min(window.devicePixelRatio || 1, 2);
    texDPR = Math.min(curDPR, 1.5);
    curCvs.width = Math.round(curW * curDPR);
    curCvs.height = Math.round(curH * curDPR);
    curCvs.style.width = curW + "px";
    curCvs.style.height = curH + "px";

    buildBubbles();

    /* 前沿露头的气泡（让泡沫顶不是一条直线） */
    frontPop = [];
    var n = Math.round(curW / (bubCell * 0.9)) + 2;
    for (var i = 0; i < n; i++) {
      var dia = bubCell * rnd(1.2, 2.2);
      frontPop.push({
        x: (i + 0.5) * curW / n + rnd(-16, 16),
        r: dia / 2,
        dy: rnd(-14, 34),
        bw: rnd(6, 20),
        ph: rnd(0, 6.28),
        sp: pickSprite(dia, 0)
      });
    }
  }

  function drawCurtain() {
    if (!curCtx || !curCvs) return;
    var c = curCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, curCvs.width, curCvs.height);
    c.setTransform(curDPR, 0, 0, curDPR, 0, 0);

    /* 气泡幕：整层固定排布，一起匀速向上推（泡相对层是不动的） */
    for (var i = 0; i < bubs.length; i++) {
      var b = bubs[i];
      var y = b.y0 + curTop;
      if (y + b.r < 0 || y - b.r > curH) continue;      /* 屏幕外不画 */
      var x = b.x0 + Math.sin(curT * 1.4 + b.ph) * b.bw;
      c.globalAlpha = b.a;
      c.drawImage(b.sp, x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    c.globalAlpha = 1;

    /* 幕顶那排露头的泡，边缘是圆的而不是一刀切 */
    for (var p = 0; p < frontPop.length; p++) {
      var f = frontPop[p];
      var fx = f.x + Math.sin(curT * 1.2 + f.ph) * f.bw;
      var fy = curTop + f.dy + Math.sin(curT * 1.8 + f.ph * 1.7) * 5;
      if (fy < -curH * 0.3 || fy > curH + curH * 0.3) continue;
      c.drawImage(f.sp, fx - f.r, fy - f.r, f.r * 2, f.r * 2);
    }
  }

  function curtainFrame(ts) {
    if (!curLast) curLast = ts;
    var dt = Math.min(0.05, (ts - curLast) / 1000);
    curLast = ts;
    curT += dt;

    var dur = curMode === 1 ? CUR_IN : CUR_OUT;
    var p = dur > 0 ? Math.min(1, curT / dur) : 1;
    var e = curMode === 1 ? 1 - Math.pow(1 - p, 3) : p * p;
    /* 幕顶位置：涌上来时从屏底升到屏幕上方（多升 curOver 保证盖满），退出时退回 */
    var travel = curH + curOver;
    curTop = curMode === 1 ? (curH - e * travel) : (-curOver + e * travel);

    drawCurtain();

    if (p < 1) { curRaf = requestAnimationFrame(curtainFrame); return; }

    curRaf = 0;
    if (curMode === 1) {
      curMode = 0;
      if (curCb) { var f = curCb; curCb = null; f(); }
    } else {
      curMode = 0;
      dropCurtain();
    }
  }

  /* 气泡把屏幕盖满的那一刻才切画面 */
  function curtainIn(cb) {
    var ok = buildCurtain();
    playSfx();                      /* 气泡声与气泡柱同拍响起 */
    curCb = cb || null;
    curMode = 1; curT = 0; curLast = 0; curTop = curH;
    if (curRaf) { cancelAnimationFrame(curRaf); curRaf = 0; }
    clearTimeout(curFail);

    if (ok && curCtx) {
      layoutCurtain();
      drawCurtain();
      curRaf = requestAnimationFrame(curtainFrame);
      /* 气泡位置整批生成，很便宜，不用延后 */
      curFail = setTimeout(finishIn, 1700);   /* 兜底：rAF 被节流也要能过场 */
    } else {
      curFail = setTimeout(finishIn, 900);    /* 没 canvas 就退化成延时切换 */
    }
  }

  function finishIn() {
    clearTimeout(curFail);
    if (curMode !== 1) return;
    if (curRaf) { cancelAnimationFrame(curRaf); curRaf = 0; }
    curMode = 0;
    if (curCb) { var f = curCb; curCb = null; f(); }
  }

  function curtainOut(cb) {
    if (!cur) { if (cb) cb(); return; }
    curOutCb = cb || null;
    curMode = 2; curT = 0; curLast = 0;
    if (curRaf) { cancelAnimationFrame(curRaf); curRaf = 0; }
    curRaf = requestAnimationFrame(curtainFrame);
  }

  function dropCurtain() {
    clearTimeout(curTexT);
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    cur = null; curCvs = null; curCtx = null;
    bubs = []; frontPop = [];
    if (curOutCb) { var f = curOutCb; curOutCb = null; f(); }
  }

  /* ---------- 声音 ---------- */
  function playSfx() {
    try {
      if (window.__wgSfx) sfx = window.__wgSfx;
      if (!sfx) sfx = new Audio(BASE + "bubble.mp3");
      sfx.volume = 1;
      /* 点击那一下已经由 app.js 起播了就别打断它（保证跟气泡柱同步） */
      if (!(sfx.currentTime > 0.04 && !sfx.paused)) {
        try { sfx.currentTime = 0; } catch (e1) {}
      }
      var p = sfx.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function fadeBgm(to, sec) {
    if (fadeT) { clearInterval(fadeT); fadeT = null; }
    if (!bgm) return;
    var from = bgm.volume || 0, t0 = Date.now();
    fadeT = setInterval(function () {
      if (!bgm) { clearInterval(fadeT); fadeT = null; return; }
      var k = Math.min(1, (Date.now() - t0) / (sec * 1000));
      try { bgm.volume = clamp(from + (to - from) * k, 0, 1); } catch (e) {}
      if (k >= 1) { clearInterval(fadeT); fadeT = null; }
    }, 60);
  }

  function bgmPlay() {
    try {
      if (window.__wgBgm) bgm = window.__wgBgm;
      if (!bgm) { bgm = new Audio(BASE + "bgm.mp3"); bgm.loop = true; }
      bgm.muted = false;
      try { bgm.volume = 0; } catch (e1) {}
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
      fadeBgm(0.55, 1.6);            /* 淡入，不留突兀 */
    } catch (e) {}
  }

  function bgmStop() {
    if (fadeT) { clearInterval(fadeT); fadeT = null; }
    try { if (bgm) { bgm.pause(); bgm.currentTime = 0; } } catch (e) {}
  }

  /* ---------- 界面 ---------- */
  function buildUI() {
    root = document.createElement("div");
    root.id = "wg-game";
    root.innerHTML =
      '<canvas id="wg-canvas"></canvas>' +
      '<div class="wg-bubbles" aria-hidden="true"></div>' +
      '<div class="wg-hud"><button class="wg-exit" id="wg-exit" aria-label="退出">&times;</button></div>' +

      '<div class="wg-over" id="wg-over" hidden>' +
        '<div class="wg-over-fx" aria-hidden="true"></div>' +
        '<img class="wg-over-img" id="wg-over-img" alt="">' +
        '<h2 class="wg-over-title" id="wg-over-title"></h2>' +
        '<p class="wg-over-sub" id="wg-over-sub"></p>' +
        '<div class="wg-over-stats">' +
          '<div class="wg-stat"><b id="wg-stat-eat">0</b><i>吃掉</i></div>' +
          '<div class="wg-stat"><b id="wg-stat-time">0:00</b><i>用时</i></div>' +
        '</div>' +
        '<div class="wg-over-btns">' +
          '<button class="wg-btn wg-btn-main" id="wg-again">再玩一次</button>' +
          '<button class="wg-btn" id="wg-quit">回到花园</button>' +
        '</div>' +
      '</div>' +

      '<div class="wg-loading" id="wg-loading"><i></i><i></i><i></i></div>';
    /* 注意：这里不显示，等气泡盖满屏幕后才 .on（否则原页面会先被染黑） */
    document.body.appendChild(root);

    cvs = $("#wg-canvas");
    ctx = cvs.getContext("2d");

    var bs = "";
    for (var i = 0; i < 26; i++) {
      var s = rnd(6, 26);
      bs += '<i style="width:' + s.toFixed(0) + 'px;height:' + s.toFixed(0) +
        'px;left:' + rnd(0, 100).toFixed(1) + '%;animation-duration:' + rnd(9, 18).toFixed(1) +
        's;animation-delay:-' + rnd(0, 14).toFixed(1) + 's"></i>';
    }
    $(".wg-bubbles").innerHTML = bs;

    $("#wg-exit").onclick = quit;
    $("#wg-quit").onclick = quit;
    $("#wg-again").onclick = function () {
      var ov = $("#wg-over");
      if (ov) { ov.hidden = true; ov.classList.remove("win", "lose"); }
      if (cvs) cvs.classList.remove("blur");
      reset();
      running = true; lastT = 0;
      bgmPlay();
      requestAnimationFrame(loop);
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    cvs.addEventListener("mousemove", onMove);
    cvs.addEventListener("touchstart", onTouch, { passive: false });
    cvs.addEventListener("touchmove", onTouch, { passive: false });
    cvs.addEventListener("touchcancel", onTouch, { passive: false });
  }

  function onKey(e) { if (e.key === "Escape") quit(); }
  function onMove(e) { if (player) { player.tx = e.clientX; player.ty = e.clientY; } }
  function onTouch(e) {
    e.preventDefault();
    var t = e.touches && e.touches[0];
    if (t && player) { player.tx = t.clientX; player.ty = t.clientY; }
  }

  function onResize() {
    if (!root) return;
    W = root.clientWidth;
    H = root.clientHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = Math.round(W * DPR);
    cvs.height = Math.round(H * DPR);
    if (ctx) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* ---------- 生成物 ---------- */
  /* 鱼一律从屏幕外游进来、横穿到另一侧后消失（过马路） */
  function makeFish(ai) {
    var dir = Math.random() < 0.5 ? -1 : 1;
    var y = rnd(96, Math.max(150, H - 130));
    if (player && Math.abs(y - player.y) < (player.r + ai.r) * 1.15) {
      y += (y > player.y ? 1 : -1) * Math.max(90, (player.r + ai.r) * 1.3);
      y = clamp(y, 96, Math.max(150, H - 130));
    }
    return {
      ai: ai,
      x: dir > 0 ? -rnd(70, 190) : W + rnd(70, 190),
      y: y,
      dir: dir,
      sp: Math.max(20, 54 - ai.r * 0.22) * rnd(0.85, 1.15),
      ph: rnd(0, 6.28),
      bob: rnd(6, 16)
    };
  }

  /* token：随机渐显出现、不会动，停一会儿自己散掉 */
  function makeToken() {
    return {
      x: rnd(30, Math.max(44, W - 30)),
      y: rnd(96, Math.max(140, H - 100)),
      a: 0,
      d: rnd(0, 1.0),
      age: 0,
      life: rnd(TOKEN_LIFE[0], TOKEN_LIFE[1])
    };
  }

  function eatable(ai) { return player.r >= ai.r; }

  /* 挑 AI：更大的鱼更常出现，玩家得等「能吃的那一条」游过来；
     要是实在等太久（STARVE 秒没出现能吃的鱼），就放行一条 */
  function pickAI() {
    var anyEatable = fishes.some(function (f) { return eatable(f.ai); });
    var hungry = !anyEatable && starve > STARVE;
    var w = AIS.map(function (a) {
      var d = a.r - player.r;             /* >0 表示吃不了 */
      if (hungry) return d <= 0 ? 4 : 0.15;
      if (anyEatable) return d <= 0 ? W_EAT : 1;
      return d <= 0 ? W_HUN / (1 + Math.abs(d) * 0.05) : 0.3;
    });
    var total = 0, i;
    for (i = 0; i < w.length; i++) total += w[i];
    var r = Math.random() * total;
    for (i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return AIS[i];
    }
    return AIS[AIS.length - 1];
  }

  function reset() {
    player = { x: W / 2, y: H * 0.68, tx: W / 2, ty: H * 0.68, vx: 0, vy: 0, r: START_R, flip: false };
    fishes = []; tokens = []; sparks = [];
    for (var i = 0; i < 3; i++) tokens.push(makeToken());
    eaten = 0; elapsed = 0;
    invuln = INVULN;
    spawnT = 1.5;
    tokT = 0.4;
    starve = 0;
  }

  /* ---------- 逻辑 ---------- */
  function update(dt) {
    if (!player) return;
    elapsed += dt;

    /* 玩家跟随指针：有最大速度 + 一点惯性，不再瞬移（这样躲大鱼才有余地） */
    var mdx = player.tx - player.x, mdy = player.ty - player.y;
    var tvx = 0, tvy = 0;
    if (mdx * mdx + mdy * mdy > 36) {
      var ang = Math.atan2(mdy, mdx), vmax = playerSpeed();
      tvx = Math.cos(ang) * vmax;
      tvy = Math.sin(ang) * vmax;
    }
    var k = Math.min(1, dt * 7);
    player.vx += (tvx - player.vx) * k;
    player.vy += (tvy - player.vy) * k;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    var pad = player.r * 0.5;
    player.x = clamp(player.x, pad, W - pad);
    player.y = clamp(player.y, pad, H - pad);
    if (player.vx > 12) player.flip = false;
    else if (player.vx < -12) player.flip = true;
    if (invuln > 0) invuln -= dt;

    /* 「等鱼」计时 */
    var hasEatable = false;
    for (var q = 0; q < fishes.length; q++) {
      if (eatable(fishes[q].ai)) { hasEatable = true; break; }
    }
    if (hasEatable) starve = 0; else starve += dt;

    /* 随机出鱼 */
    spawnT -= dt;
    if (spawnT <= 0) {
      if (fishes.length < maxFish()) {
        var ai = pickAI();
        var nf = makeFish(ai);
        var far = Math.hypot(nf.x - player.x, nf.y - player.y) > (player.r + ai.r) * 1.6;
        if (far || eatable(ai)) {
          fishes.push(nf);
          spawnT = rnd(FISH_GAP[0], FISH_GAP[1]);
        } else {
          spawnT = 0.6;              /* 这次位置太贴脸，等下一拍 */
        }
      } else {
        spawnT = 1.2;
      }
    }

    /* token：持续冒出来 → 渐显 → 停一会儿自己散掉 */
    tokT -= dt;
    if (tokT <= 0 && tokens.length < TOKEN_MAX) {
      tokens.push(makeToken());
      tokT = rnd(TOKEN_SPAWN[0], TOKEN_SPAWN[1]);
    }
    for (var i = tokens.length - 1; i >= 0; i--) {
      var t = tokens[i];
      if (t.d > 0) { t.d -= dt; continue; }
      t.age += dt;
      t.a = Math.min(1, t.a + dt * TOKEN_FADE);
      if (t.age >= t.life) { tokens.splice(i, 1); continue; }   /* 飘散了 */
      if (t.age > t.life - 1.1) t.a = Math.min(t.a, (t.life - t.age) / 1.1);
      if (t.a > 0.35) {
        var dx = t.x - player.x, dy = t.y - player.y;
        if (dx * dx + dy * dy < Math.pow(player.r * 1.05 + 11, 2)) {
          player.r += TOKEN_GAIN;
          sparks.push({ x: t.x, y: t.y, t: 0, life: 0.5 });
          tokens.splice(i, 1);
        }
      }
    }

    /* 鱼：横穿屏幕，游出边界就消失 */
    for (var j = fishes.length - 1; j >= 0; j--) {
      var f = fishes[j];
      f.x += f.dir * f.sp * dt;
      f.ph += dt * 1.15;
      if (f.x < -200 || f.x > W + 200) { fishes.splice(j, 1); continue; }

      var fy = f.y + Math.sin(f.ph) * f.bob * 0.35;
      var ddx = f.x - player.x, ddy = fy - player.y;
      var lim = (player.r + f.ai.r) * 0.62;
      if (ddx * ddx + ddy * ddy < lim * lim) {
        if (eatable(f.ai)) {
          player.r += FISH_GAIN;
          eaten++;
          sparks.push({ x: f.x, y: fy, t: 0, life: 0.9 });
          fishes.splice(j, 1);
          if (f.ai.id === "gpt") { gameOver(true, f.ai); return; }
        } else if (invuln <= 0) {
          gameOver(false, f.ai);
          return;
        }
      }
    }

    /* 涟漪 */
    for (var s = sparks.length - 1; s >= 0; s--) {
      sparks[s].t += dt;
      if (sparks[s].t > sparks[s].life) sparks.splice(s, 1);
    }
  }

  /* ---------- 绘制 ---------- */
  function drawSprite(im, cx, cy, r, flip) {
    if (!im || !im.width) return;
    var h = r * 1.9;
    var w = h * (im.width / im.height);
    ctx.save();
    ctx.translate(cx, cy);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function draw() {
    if (!ctx) return;
    /* 珊瑚礁背景铺满 */
    if (imgs.reefBg && imgs.reefBg.width) {
      var iw = imgs.reefBg.width, ih = imgs.reefBg.height;
      var sc = Math.max(W / iw, H / ih);
      var dw = iw * sc, dh = ih * sc;
      ctx.drawImage(imgs.reefBg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      var ov = ctx.createLinearGradient(0, 0, 0, H);
      ov.addColorStop(0, "rgba(6,28,48,.30)");
      ov.addColorStop(0.55, "rgba(4,20,36,.48)");
      ov.addColorStop(1, "rgba(2,12,22,.74)");
      ctx.fillStyle = ov;
      ctx.fillRect(0, 0, W, H);
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#0c3355"); g.addColorStop(0.5, "#062038"); g.addColorStop(1, "#03131f");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* token */
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.a <= 0.03 || !imgs.token) continue;
      var s = TOKEN_SIZE * (1 + (1 - t.a) * 0.4);
      ctx.globalAlpha = t.a;
      ctx.drawImage(imgs.token, t.x - s / 2, t.y - s / 2, s, s);
      ctx.globalAlpha = 1;
    }

    /* 鱼 */
    for (var j = 0; j < fishes.length; j++) {
      var f = fishes[j];
      var fy = f.y + Math.sin(f.ph) * f.bob * 0.35;
      var im = imgs.ai[f.ai.id];
      if (!eatable(f.ai) && im) {
        ctx.globalAlpha = 0.34 + 0.1 * Math.sin(f.ph * 1.6);
        ctx.strokeStyle = "#ff9aa6";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, fy + f.ai.r * 0.45, f.ai.r * 1.12, 0, 6.283);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      drawSprite(im, f.x, fy, f.ai.r, f.dir < 0);
    }

    /* 玩家（无敌期间闪烁） */
    if (invuln > 0) ctx.globalAlpha = (Math.floor(invuln * 8) % 2) ? 0.45 : 1;
    drawSprite(imgs.mascot, player.x, player.y, player.r, player.flip);
    ctx.globalAlpha = 1;

    /* 涟漪 */
    for (var s2 = 0; s2 < sparks.length; s2++) {
      var sp = sparks[s2];
      var p = sp.t / sp.life;
      ctx.globalAlpha = Math.max(0, 1 - p) * 0.85;
      ctx.strokeStyle = "#8fdcff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 8 + p * 38, 0, 6.283);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function loop(ts) {
    if (!running) return;
    if (!lastT) lastT = ts;
    var dt = Math.min(0.05, (ts - lastT) / 1000);
    lastT = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  /* ---------- 结算（有文字 + 特效） ---------- */
  function buildFx(box) {
    if (!box) return;
    var n = 28, html = "";
    for (var i = 0; i < n; i++) {
      html += '<i style="--a:' + (360 / n * i + rnd(-8, 8)).toFixed(1) + 'deg;' +
        '--d:' + rnd(90, 270).toFixed(0) + 'px;' +
        '--s:' + rnd(6, 20).toFixed(0) + 'px;' +
        '--dl:' + rnd(0, 0.55).toFixed(2) + 's;' +
        '--du:' + rnd(1.5, 2.9).toFixed(2) + 's"></i>';
    }
    box.innerHTML = html;
  }

  function gameOver(win, ai) {
    running = false;
    bgmStop();
    var ov = $("#wg-over");
    if (!ov) return;
    if (cvs) cvs.classList.add("blur");

    ov.classList.toggle("win", !!win);
    ov.classList.toggle("lose", !win);

    var img = $("#wg-over-img");
    if (img) img.src = win ? MASCOT : (BASE + "ai-" + ai.id + ".webp");

    var ttl = $("#wg-over-title");
    var sub = $("#wg-over-sub");
    var se = $("#wg-stat-eat");
    var st = $("#wg-stat-time");
    if (ttl) ttl.textContent = win ? "全部吃掉了！" : "被吃掉了…";
    if (sub) {
      sub.textContent = win
        ? "连 " + AIS[AIS.length - 1].name + " 都进了你的肚子"
        : ai.name + " 比你大，硬碰是会被吞的";
    }
    if (se) se.textContent = String(eaten);
    if (st) st.textContent = fmtTime(elapsed);

    buildFx(ov.querySelector(".wg-over-fx"));
    ov.hidden = false;
  }

  /* ---------- 收尾 ---------- */
  function teardown() {
    running = false;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; cvs = null; ctx = null;
    window.removeEventListener("resize", onResize);
    document.removeEventListener("keydown", onKey);
  }

  function quit() {
    if (!root) return;
    running = false;
    bgmStop();
    curtainIn(function () {
      teardown();
      curtainOut();
    });
  }

  /* ---------- 启动 ---------- */
  function loadAssets() {
    var jobs = AIS.map(function (ai) {
      return loadImg(BASE + "ai-" + ai.id + ".webp").then(function (im) { imgs.ai[ai.id] = im; });
    });
    jobs.push(loadImg(BASE + "token.webp").then(function (im) { imgs.token = im; }));
    jobs.push(loadImg(MASCOT).then(function (im) { imgs.mascot = im; }));
    jobs.push(loadImg(REEF_BG).then(function (im) { imgs.reefBg = im; }));
    return Promise.all(jobs);
  }

  function boot() {
    buildUI();
    /* 先让气泡涌上来盖满，盖满那一刻才露出游戏层 */
    curtainIn(function () {
      root.classList.add("on");
      onResize();
      loadAssets().then(function () {
        var ld = $("#wg-loading");
        if (ld) ld.classList.add("hide");
        if (!root) return;
        onResize();
        reset();
        running = true; lastT = 0;
        requestAnimationFrame(loop);
        /* BGM 等过场结束（气泡退干净）才响 */
        curtainOut(function () { bgmPlay(); });
      });
    });
  }

  window.WGGame = { boot: boot, quit: quit };
})();