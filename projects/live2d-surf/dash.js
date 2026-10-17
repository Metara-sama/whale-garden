/* ==========================================================
   谁在冲浪 · DASH
   冲浪版无限跑酷（谷歌小恐龙玩法）
   ----------------------------------------------------------
   · 跳跃 / 下潜 躲不同障碍
   · 随时间随机切换天气（晴 / 多云 / 雨 / 雾 / 夜 / 风暴 / 黄昏）
   · 点 ▶ 开始，所有 UI 动画收起
   · 横竖屏自适应
   ========================================================== */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const TAU = Math.PI * 2;

  const stageEl = $('#stage');

  /* =========================================================
     天气
     ========================================================= */
  const WEATHER = {
    clear: {
      icon: '☀', name: '晴',
      sky: ['#3d9fe0', '#93d5ff', '#eafaff'],
      seaTint: 0xffffff, sun: '#ffffff', sunA: 0.95,
      rain: 0, fog: 0, dark: 0, wind: 0.06, star: 0
    },
    cloudy: {
      icon: '☁', name: '多云',
      sky: ['#5f86a8', '#9fc0d4', '#dbe9f0'],
      seaTint: 0xc9d8e2, sun: '#eef6ff', sunA: 0.28,
      rain: 0, fog: 0.10, dark: 0.10, wind: 0.22, star: 0
    },
    rain: {
      icon: '🌧', name: '下雨',
      sky: ['#3a5266', '#6b879c', '#9fb3c2'],
      seaTint: 0xb8cbd6, sun: '#dfeaf2', sunA: 0.12,
      rain: 0.75, fog: 0.16, dark: 0.20, wind: 0.38, star: 0
    },
    fog: {
      icon: '🌫', name: '起雾',
      sky: ['#8ea3b3', '#b9c9d4', '#dde7ee'],
      seaTint: 0xd7e2ea, sun: '#ffffff', sunA: 0.18,
      rain: 0, fog: 0.66, dark: 0.06, wind: 0.08, star: 0
    },
    night: {
      icon: '🌙', name: '夜晚',
      sky: ['#03080f', '#0d2340', '#20416b'],
      seaTint: 0x6f8fb0, sun: '#e6f2ff', sunA: 0.9,
      rain: 0, fog: 0.05, dark: 0.66, wind: 0.14, star: 1
    },
    storm: {
      icon: '⛈', name: '风暴',
      sky: ['#232d38', '#43525f', '#6b7a86'],
      seaTint: 0x9aaab6, sun: '#b9c6d0', sunA: 0.08,
      rain: 1.0, fog: 0.24, dark: 0.36, wind: 0.85, star: 0, bolt: true
    },
    dusk: {
      icon: '🌅', name: '黄昏',
      sky: ['#4b3560', '#c96a72', '#ffc98a'],
      seaTint: 0xe3c8d4, sun: '#ffcf72', sunA: 1.0,
      rain: 0, fog: 0.08, dark: 0.14, wind: 0.12, star: 0.25
    }
  };
  const WEATHER_KEYS = Object.keys(WEATHER);

  /* 当前天气插值状态（每帧向目标靠） */
  const sky = {
    tgt: 'clear',
    cur: { rain: 0, fog: 0, dark: 0, wind: 0.06, star: 0, sunA: 0.95, seaTint: 0xffffff },
    skyCols: ['#3d9fe0', '#93d5ff', '#eafaff'],
    sunCol: '#ffffff'
  };

  /* =========================================================
     游戏状态
     ========================================================= */
  const G = {
    state: 'loading',            // loading | ready | playing | over
    W: 1, H: 1,
    seaY: 0,
    dist: 0, score: 0, best: 0,
    speed: 1,
    time: 0,
    weatherTimer: 12,
    boltTimer: 0,
    flash: 0,
    shake: 0
  };
  try { G.best = parseInt(localStorage.getItem('surfdash.best') || '0', 10) || 0; } catch (e) { }

  /* =========================================================
     PIXI
     ========================================================= */
  const live2d = PIXI.live2d || {};
  const Live2DModel = live2d.Live2DModel;
  if (Live2DModel && Live2DModel.registerTicker) Live2DModel.registerTicker(PIXI.Ticker);

  const app = new PIXI.Application({
    antialias: true,
    autoDensity: true,
    backgroundColor: 0x0a1626,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: 'high-performance'
  });
  stageEl.appendChild(app.view);
  app.stage.sortableChildren = true;

  // 图层
  const L = {
    sky: new PIXI.Container(),
    far: new PIXI.Container(),
    mid: new PIXI.Container(),
    near: new PIXI.Container(),
    obstacle: new PIXI.Container(),
    player: new PIXI.Container(),
    fx: new PIXI.Container(),
    weather: new PIXI.Container(),
    overlay: new PIXI.Container()
  };
  ['sky', 'far', 'mid', 'near', 'obstacle', 'player', 'fx', 'weather', 'overlay']
    .forEach((k) => app.stage.addChild(L[k]));
  // 障碍物在近景浪后面一点点，看起来更贴水面
  app.stage.setChildIndex(L.near, 6);
  app.stage.setChildIndex(L.player, 5);

  /* =========================================================
     纹理工厂
     ========================================================= */
  const texCache = {};
  function canvasTex(key, w, h, draw) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    texCache[key] = PIXI.Texture.from(c);
    return texCache[key];
  }

  /* 水面细节（可横向平铺） */
  function waterTexture(seed, dots, alpha) {
    return canvasTex('water' + seed, 512, 128, (g, w, h) => {
      let s = seed;
      const rs = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      g.strokeStyle = '#ffffff';
      for (let k = 0; k < 8; k++) {
        const y0 = (k + 0.5) * h / 8;
        const amp = 1.2 + rs() * 2.4;
        const f = (0.5 + rs() * 1.5) * TAU / w;
        g.lineWidth = 1;
        g.globalAlpha = alpha * (0.3 + rs() * 0.6);
        g.beginPath();
        for (let x = 0; x <= w; x += 6) {
          const y = y0 + Math.sin(x * f + k * 1.7) * amp;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      for (let i = 0; i < dots; i++) {
        const x = rs() * w, y = rs() * h, r = 0.6 + rs() * 2;
        g.globalAlpha = alpha * (0.18 + rs() * 0.5);
        g.fillStyle = '#ffffff';
        for (let d = -1; d <= 1; d++) {
          g.beginPath(); g.arc(x + d * w, y, r, 0, TAU); g.fill();
        }
      }
      g.globalAlpha = 1;
    });
  }

  /* 雨 */
  const rainTex = () => canvasTex('rain', 64, 128, (g, w, h) => {
    g.strokeStyle = 'rgba(200,225,255,0.85)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.globalAlpha = 0.3 + Math.random() * 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y + 14); g.stroke();
    }
    g.globalAlpha = 1;
  });

  /* 雾 */
  const fogTex = () => canvasTex('fog', 128, 128, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, 'rgba(230,242,250,0.55)');
    rg.addColorStop(1, 'rgba(230,242,250,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  });

  /* 云 */
  const cloudTex = () => canvasTex('cloud', 512, 128, (g, w, h) => {
    g.fillStyle = '#ffffff';
    let s = 99;
    const rs = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 16; i++) {
      const x = rs() * w, y = 30 + rs() * 60, r = 12 + rs() * 26;
      g.globalAlpha = 0.1 + rs() * 0.16;
      for (let d = -1; d <= 1; d++) {
        g.beginPath(); g.arc(x + d * w, y, r, 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1;
  });

  /* 泡沫 */
  const foamTex = () => canvasTex('foam', 64, 64, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)');
    rg.addColorStop(0.55, 'rgba(240,252,255,0.4)');
    rg.addColorStop(1, 'rgba(230,248,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  });

  /* =========================================================
     背景（天空 / 海 / 云 / 太阳）
     ========================================================= */
  let bg = {};

  function buildBackground() {
    [L.sky, L.far, L.mid].forEach((l) => l.removeChildren());
    const W = G.W, H = G.H;
    const horizon = G.seaY - H * 0.02;

    /* --- 天空（每帧重绘的小纹理） --- */
    const sc = document.createElement('canvas');
    sc.width = 8; sc.height = 128;
    const sctx = sc.getContext('2d');
    const skySprite = new PIXI.Sprite(PIXI.Texture.from(sc));
    skySprite.width = W;
    skySprite.height = horizon + 2;
    L.sky.addChild(skySprite);

    /* --- 太阳 / 月亮 --- */
    const sunG = new PIXI.Graphics();
    sunG.beginFill(0xffffff, 1);
    sunG.drawCircle(0, 0, Math.min(W, H) * 0.055);
    sunG.endFill();
    sunG.position.set(W * 0.76, horizon * 0.3);
    const sunGlow = new PIXI.Sprite(foamTex());
    sunGlow.anchor.set(0.5);
    sunGlow.width = sunGlow.height = Math.min(W, H) * 0.46;
    sunGlow.alpha = 0.35;
    sunGlow.position.copyFrom(sunG.position);
    L.sky.addChild(sunGlow, sunG);

    /* --- 星星（夜间淡入） --- */
    const stars = new PIXI.Graphics();
    let ss = 7;
    const srs = () => { ss = (ss * 9301 + 49297) % 233280; return ss / 233280; };
    for (let i = 0; i < 60; i++) {
      stars.beginFill(0xffffff, 0.35 + srs() * 0.6);
      stars.drawCircle(srs() * W, srs() * horizon * 0.8, 0.6 + srs() * 1.4);
      stars.endFill();
    }
    stars.alpha = 0;
    L.sky.addChild(stars);

    /* --- 云层 --- */
    const clouds = new PIXI.TilingSprite(cloudTex(), W + 4, horizon * 0.7);
    clouds.y = horizon * 0.12;
    clouds.alpha = 0.85;
    L.sky.addChild(clouds);

    /* --- 远景海 --- */
    const farH = H * 0.22;
    const far = new PIXI.TilingSprite(waterTexture(11, 60, 0.28), W + 4, farH);
    far.y = horizon;
    L.far.addChild(far);

    /* --- 中景海 --- */
    const midY = horizon + farH * 0.55;
    const mid = new PIXI.TilingSprite(waterTexture(23, 90, 0.34), W + 4, G.H - midY + 4);
    mid.y = midY;
    L.mid.addChild(mid);

    bg = { skySprite, sctx, sunG, sunGlow, stars, clouds, far, mid, horizon };
    paintSky();
  }

  function paintSky() {
    if (!bg.sctx) return;
    const g = bg.sctx;
    const [c0, c1, c2] = sky.skyCols;
    const lg = g.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0, c0);
    lg.addColorStop(0.58, c1);
    lg.addColorStop(1, c2);
    g.fillStyle = lg;
    g.fillRect(0, 0, 8, 128);
    if (bg.skySprite && bg.skySprite.texture) bg.skySprite.texture.update();
  }

  /* =========================================================
     近景海（在玩家之前）+ 天气层
     ========================================================= */
  let nearSea = null, rainSpr = null, fogSpr = null, darkSpr = null, boltSpr = null;

  function buildNear() {
    [L.near, L.weather, L.overlay].forEach((l) => l.removeChildren());
    const W = G.W, H = G.H;
    const nearY = G.seaY + H * 0.10;
    nearSea = new PIXI.TilingSprite(waterTexture(37, 140, 0.42), W + 4, H - nearY + 4);
    nearSea.y = nearY;
    nearSea.alpha = 0.92;
    L.near.addChild(nearSea);

    /* 雨 */
    rainSpr = new PIXI.TilingSprite(rainTex(), W + 4, H + 4);
    rainSpr.tileScale.set(1.1, 1.5);
    rainSpr.alpha = 0;
    L.weather.addChild(rainSpr);

    /* 雾 */
    fogSpr = new PIXI.TilingSprite(fogTex(), W + 4, H + 4);
    fogSpr.tileScale.set(3, 3);
    fogSpr.alpha = 0;
    L.weather.addChild(fogSpr);

    /* 整体压暗 */
    darkSpr = new PIXI.Graphics();
    darkSpr.beginFill(0x02080f, 1).drawRect(0, 0, W, H).endFill();
    darkSpr.alpha = 0;
    L.overlay.addChild(darkSpr);

    /* 闪电 */
    boltSpr = new PIXI.Graphics();
    boltSpr.beginFill(0xffffff, 1).drawRect(0, 0, W, H).endFill();
    boltSpr.alpha = 0;
    L.overlay.addChild(boltSpr);
  }

  /* =========================================================
     颗粒（水花 / 气泡）
     ========================================================= */
  const PS = { live: [], free: [] };
  function spawnP(o) {
    let p = PS.free.pop();
    if (!p) {
      const sp = new PIXI.Sprite(foamTex());
      sp.anchor.set(0.5);
      L.fx.addChild(sp);
      p = { sp };
    }
    p.sp.visible = true;
    p.sp.texture = o.tex || foamTex();
    p.sp.position.set(o.x, o.y);
    p.sp.tint = o.tint === undefined ? 0xffffff : o.tint;
    p.s0 = o.s0 === undefined ? 0.2 : o.s0;
    p.s1 = o.s1 === undefined ? 0.7 : o.s1;
    p.sp.scale.set(p.s0);
    p.sp.alpha = o.a === undefined ? 0.8 : o.a;
    p.a0 = p.sp.alpha;
    p.vx = o.vx || 0;
    p.vy = o.vy || 0;
    p.grav = o.grav === undefined ? 900 : o.grav;
    p.life = 0;
    p.max = o.max || 0.6;
    PS.live.push(p);
  }
  function updateP(dt) {
    for (let i = PS.live.length - 1; i >= 0; i--) {
      const p = PS.live[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) {
        p.sp.visible = false;
        PS.live.splice(i, 1);
        PS.free.push(p);
        continue;
      }
      p.vy += p.grav * dt;
      p.sp.x += p.vx * dt;
      p.sp.y += p.vy * dt;
      p.sp.scale.set(p.s0 + (p.s1 - p.s0) * t);
      p.sp.alpha = p.a0 * (1 - t);
    }
  }

  /* =========================================================
     玩家
     ========================================================= */
  const player = {
    wrap: new PIXI.Container(),
    board: null,
    model: null,
    x: 0, y: 0, vy: 0,
    onGround: true,
    dive: 0,     // 0..1
    diving: false,
    dead: false,
    deadT: 0,
    w: 0, h: 0,
    k: 1
  };
  L.player.addChild(player.wrap);

  function buildBoard() {
    const g = new PIXI.Graphics();
    // 冲浪板（圆润尖头）
    g.beginFill(0x1e4a6b, 1);
    g.drawEllipse(0, 0, 74, 13);
    g.endFill();
    g.beginFill(0x5ad8ff, 0.9);
    g.drawEllipse(0, 0, 70, 10);
    g.endFill();
    g.beginFill(0xffffff, 0.5);
    g.drawEllipse(-12, -3, 40, 3);
    g.endFill();
    return g;
  }

  async function loadPlayer() {
    const idx = await (await fetch('models/index.json')).json();
    const item = idx[0];
    const url = 'models/' + item.slug + '/' + item.model3;
    const model = await Live2DModel.from(url, { autoInteract: false });
    const b = model.getLocalBounds();
    model.pivot.set(b.x + b.width / 2, b.y + b.height / 2);
    model.position.set(0, 0);
    player.model = model;
    player.rawH = Math.max(1, b.height);

    const board = buildBoard();
    player.board = board;

    player.wrap.addChild(model);
    player.wrap.addChild(board);
    layoutPlayer();
    L.player.addChild(player.wrap);
  }

  function layoutPlayer() {
    const W = G.W, H = G.H;
    const targetH = H * 0.34;                     // 模型显示高度
    const k = player.rawH ? targetH / player.rawH : 0.03;
    player.k = k;
    player.model.scale.set(k);
    // 板缩放到模型宽度附近
    const modelW = (player.rawH ? (player.rawH * 0.62) : 200) * k;
    const boardScale = clamp(modelW / 148, 0.4, 1.6);
    player.board.scale.set(boardScale);
    player.board.y = targetH * 0.46;              // 板在脚下

    player.x = W * 0.24;
    player.y = G.seaY;
    player.w = Math.max(24, modelW * 0.5);
    player.h = targetH * 0.55;
    syncPlayer();
  }

  function syncPlayer() {
    player.wrap.position.set(player.x, player.y);
  }

  /* =========================================================
     障碍物
     ========================================================= */
  const OBS_TEX = {};
  function obsTexture(kind) {
    if (OBS_TEX[kind]) return OBS_TEX[kind];
    let t = null;
    if (kind === 'rock') {
      t = canvasTex('obs_rock', 120, 120, (g, w, h) => {
        g.fillStyle = '#2b3540';
        g.beginPath();
        g.moveTo(10, h - 4); g.lineTo(28, 34); g.lineTo(56, 14);
        g.lineTo(88, 40); g.lineTo(106, h - 4); g.closePath();
        g.fill();
        g.fillStyle = '#43525f';
        g.beginPath();
        g.moveTo(28, 34); g.lineTo(56, 14); g.lineTo(62, 52); g.lineTo(40, 60); g.closePath();
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.beginPath();
        g.moveTo(10, h - 4); g.lineTo(28, 34); g.lineTo(34, h - 4); g.closePath();
        g.fill();
      });
    } else if (kind === 'log') {
      t = canvasTex('obs_log', 140, 60, (g, w, h) => {
        g.fillStyle = '#5a3b25';
        g.beginPath(); g.roundRect ? g.roundRect(4, 14, w - 8, h - 24, 10) : g.rect(4, 14, w - 8, h - 24);
        g.fill();
        g.fillStyle = '#7a5334';
        g.fillRect(10, 20, w - 20, 6);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(10, 16, w - 20, 3);
        g.fillStyle = '#3d2717';
        g.beginPath(); g.arc(w - 14, h / 2, 10, 0, TAU); g.fill();
      });
    } else if (kind === 'gull') {
      t = canvasTex('obs_gull', 120, 80, (g, w, h) => {
        g.fillStyle = '#f4f8ff';
        g.beginPath();
        g.moveTo(8, 52); g.quadraticCurveTo(38, 8, 60, 44);
        g.quadraticCurveTo(82, 8, 112, 52);
        g.quadraticCurveTo(82, 34, 60, 58);
        g.quadraticCurveTo(38, 34, 8, 52);
        g.fill();
        g.fillStyle = '#e0a83a';
        g.beginPath(); g.moveTo(56, 48); g.lineTo(66, 52); g.lineTo(56, 56); g.fill();
      });
    } else if (kind === 'jelly') {
      t = canvasTex('obs_jelly', 100, 120, (g, w, h) => {
        g.fillStyle = 'rgba(255,150,200,0.55)';
        g.beginPath();
        g.arc(50, 42, 34, Math.PI, 0);
        g.lineTo(84, 56); g.lineTo(16, 56);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,180,220,0.6)';
        g.lineWidth = 3;
        for (let i = 0; i < 5; i++) {
          const x = 22 + i * 14;
          g.beginPath();
          g.moveTo(x, 56);
          g.quadraticCurveTo(x + 8, 80, x - 4, 104);
          g.stroke();
        }
      });
    } else if (kind === 'buoy') {
      t = canvasTex('obs_buoy', 70, 130, (g, w, h) => {
        g.fillStyle = '#d94b4b';
        g.fillRect(18, 10, 34, h - 16);
        g.fillStyle = '#ffffff';
        g.fillRect(18, 44, 34, 22);
        g.fillStyle = '#8a2b2b';
        g.fillRect(18, h - 14, 34, 8);
        g.fillStyle = 'rgba(255,255,255,0.4)';
        g.fillRect(22, 12, 6, h - 20);
      });
    }
    OBS_TEX[kind] = t;
    return t;
  }

  /* 障碍定义：h/w 相对屏幕高宽，yOff 相对 seaY（负=在水面之上） */
  const OBS_DEF = {
    rock: { tex: 'rock', w: 0.10, h: 0.115, yOff: -0.02, need: 'jump' },
    log: { tex: 'log', w: 0.14, h: 0.055, yOff: -0.01, need: 'jump' },
    buoy: { tex: 'buoy', w: 0.055, h: 0.14, yOff: -0.03, need: 'jump' },
    // 空中障碍：底部要卡在"站着会撞、下潜能过"的高度
    gull: { tex: 'gull', w: 0.10, h: 0.066, yOff: -0.075, need: 'dive' },
    jelly: { tex: 'jelly', w: 0.075, h: 0.10, yOff: -0.088, need: 'dive' }
  };
  const JUMP_KINDS = ['rock', 'log', 'buoy'];
  const DIVE_KINDS = ['gull', 'jelly'];

  const obstacles = [];

  function spawnObstacle(forceKind) {
    const W = G.W, H = G.H;
    const kind = forceKind || (Math.random() < 0.62 ? pick(JUMP_KINDS) : pick(DIVE_KINDS));
    const def = OBS_DEF[kind];
    const ow = W * def.w;
    const oh = H * def.h;
    const sp = new PIXI.Sprite(obsTexture(def.tex));
    sp.anchor.set(0.5, 1);
    sp.width = ow;
    sp.height = oh;
    sp.x = W + ow;
    sp.y = G.seaY + H * def.yOff;
    const o = {
      kind, sp, need: def.need,
      w: ow * 0.84, h: oh * 0.92,
      x: sp.x, cy: sp.y - oh / 2,
      passed: false
    };
    L.obstacle.addChild(sp);
    obstacles.push(o);
    return o;
  }

  function clearObstacles() {
    obstacles.forEach((o) => o.sp.destroy());
    obstacles.length = 0;
  }

  function updateObstacles(dt) {
    // 用 min(W,H) 当世界尺度 —— 横屏竖屏的障碍速度才一致
    const px = G.speed * Math.min(G.W, G.H) * 0.55;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.sp.x -= px * dt;
      o.x = o.sp.x;
      if (o.sp.x < -o.w * 2) {
        o.sp.destroy();
        obstacles.splice(i, 1);
        continue;
      }
      // 计分
      if (!o.passed && o.sp.x < player.x) {
        o.passed = true;
        G.score += 12;
      }
    }
  }

  /* =========================================================
     输入 / 动作
     ========================================================= */
  const PHYS = {};
  function layoutPhys() {
    const H = G.H;
    PHYS.jumpH = H * 0.285;          // 跳跃高度（够跳过最高的浮标）
    PHYS.grav = H * 3.6;             // 重力（越小越飘，滞空更久好操作）
    PHYS.v0 = -Math.sqrt(2 * PHYS.grav * PHYS.jumpH);
    PHYS.diveDepth = H * 0.15;
  }

  function jump() {
    if (G.state !== 'playing' || player.dead) return;
    if (!player.onGround) return;
    player.vy = PHYS.v0;
    player.onGround = false;
    player.diving = false;
    splash(3, 0.6);
  }

  function diveStart() {
    if (G.state !== 'playing' || player.dead) return;
    player.diving = true;
    if (player.onGround) splash(2, 0.4);
  }
  function diveEnd() {
    player.diving = false;
  }

  function splash(n, power) {
    const W = G.W, H = G.H;
    for (let i = 0; i < n; i++) {
      spawnP({
        x: player.x + rnd(-W * 0.03, W * 0.03),
        y: player.y + H * 0.06,
        vx: rnd(-160, 60), vy: rnd(-260, -90) * power,
        grav: 1100,
        s0: rnd(0.15, 0.3), s1: rnd(0.4, 0.9),
        a: rnd(0.5, 0.9), max: rnd(0.4, 0.8)
      });
    }
  }

  function updatePlayer(dt) {
    const H = G.H;
    if (player.dead) {
      player.deadT += dt;
      player.wrap.rotation += dt * 3.2;
      player.wrap.y += dt * H * 0.55;
      player.wrap.alpha = Math.max(0, 1 - player.deadT * 1.4);
      return;
    }
    // 跳跃物理
    if (!player.onGround) {
      player.vy += PHYS.grav * dt;
      player.y += player.vy * dt;
      if (player.y >= G.seaY) {
        player.y = G.seaY;
        player.vy = 0;
        player.onGround = true;
        splash(4, 0.8);
        G.shake = Math.max(G.shake, 2.2);
      }
    }
    // 下潜
    const dtDive = player.diving ? 1 : 0;
    player.dive += (dtDive - player.dive) * Math.min(1, dt * 12);
    const diveY = PHYS.diveDepth * player.dive;
    const bob = Math.sin(G.time * 3) * H * 0.006;
    player.wrap.y = player.y + diveY + bob;

    // 板倾斜（跳起时上仰，下潜时下压）
    const tilt = clamp(player.vy / (H * -1.6), -0.35, 0.55) - player.dive * 0.42;
    player.wrap.rotation = tilt;
    player.wrap.alpha = 1 - player.dive * 0.25;

    // 视线跟随（看向前方）
    if (player.model && player.model.focus) {
      try { player.model.focus(G.W * 0.9, G.H * 0.5); } catch (e) { }
    }
  }

  function playerBox() {
    const diveY = PHYS.diveDepth * player.dive;
    const cy = player.y + diveY - player.h * 0.15;
    return {
      l: player.x - player.w * 0.34,
      r: player.x + player.w * 0.34,
      t: cy - player.h * 0.5,
      b: cy + player.h * 0.5
    };
  }

  function checkHit() {
    if (player.dead) return;
    const b = playerBox();
    for (const o of obstacles) {
      const ol = o.x - o.w / 2, or = o.x + o.w / 2;
      const ot = o.cy - o.h / 2, ob = o.cy + o.h / 2;
      // 收缩一点，手感更宽容
      const pad = o.w * 0.12;
      if (b.r > ol + pad && b.l < or - pad && b.b > ot + pad && b.t < ob - pad) {
        die(o);
        return;
      }
    }
  }

  function die(o) {
    player.dead = true;
    G.state = 'over';
    G.shake = 12;
    // 撞碎水花
    const W = G.W, H = G.H;
    for (let i = 0; i < 22; i++) {
      spawnP({
        x: player.x + rnd(-W * 0.04, W * 0.04),
        y: player.y + rnd(-H * 0.02, H * 0.06),
        vx: rnd(-260, 120), vy: rnd(-420, -120),
        grav: 1200,
        s0: rnd(0.2, 0.45), s1: rnd(0.6, 1.3),
        a: rnd(0.6, 0.95), max: rnd(0.6, 1.2)
      });
    }
    setTimeout(showOver, 620);
  }

  /* =========================================================
     天气切换
     ========================================================= */
  function pickWeather() {
    // 避免连续两次相同；夜晚/风暴概率降低
    const pool = WEATHER_KEYS.filter((k) => k !== sky.tgt);
    const w = [];
    pool.forEach((k) => {
      let n = 3;
      if (k === 'night') n = 2;
      if (k === 'storm') n = 2;
      if (k === 'fog') n = 2;
      for (let i = 0; i < n; i++) w.push(k);
    });
    return pick(w);
  }

  function setWeather(key, instant) {
    sky.tgt = key;
    const d = WEATHER[key];
    sky.skyCols = d.sky;
    sky.sunCol = d.sun;
    if (instant) {
      sky.cur.rain = d.rain;
      sky.cur.fog = d.fog;
      sky.cur.dark = d.dark;
      sky.cur.wind = d.wind;
      sky.cur.star = d.star;
      sky.cur.sunA = d.sunA;
      sky.cur.seaTint = d.seaTint;
      paintSky();
    }
    // HUD 图标
    const hw = $('#hud-weather');
    const sw = $('#start-weather');
    if (hw) {
      hw.textContent = d.icon;
      hw.classList.add('pop');
      setTimeout(() => hw.classList.remove('pop'), 420);
    }
    if (sw) sw.textContent = d.icon + ' ' + d.name;
  }

  function updateWeather(dt) {
    const d = WEATHER[sky.tgt];
    const k = Math.min(1, dt * 1.5);
    const c = sky.cur;
    c.rain += (d.rain - c.rain) * k;
    c.fog += (d.fog - c.fog) * k;
    c.dark += (d.dark - c.dark) * k;
    c.wind += (d.wind - c.wind) * k;
    c.star += (d.star - c.star) * k;
    c.sunA += (d.sunA - c.sunA) * k;

    // 海色 tint 插值
    const st = PIXI.utils.hex2rgb(c.seaTint);
    const tt = PIXI.utils.hex2rgb(d.seaTint);
    const r = st[0] + (tt[0] - st[0]) * k;
    const g2 = st[1] + (tt[1] - st[1]) * k;
    const b = st[2] + (tt[2] - st[2]) * k;
    c.seaTint = (Math.round(r * 255) << 16) | (Math.round(g2 * 255) << 8) | Math.round(b * 255);

    // 应用
    paintSky();
    if (bg.far) bg.far.tint = c.seaTint;
    if (bg.mid) bg.mid.tint = c.seaTint;
    if (nearSea) nearSea.tint = c.seaTint;
    if (bg.sunG) bg.sunG.alpha = c.sunA;
    if (bg.sunGlow) {
      bg.sunGlow.alpha = 0.32 * c.sunA;
      bg.sunGlow.tint = PIXI.utils.string2hex(sky.sunCol);
    }
    if (bg.sunG) bg.sunG.tint = PIXI.utils.string2hex(sky.sunCol);
    if (bg.stars) bg.stars.alpha = c.star;
    if (rainSpr) rainSpr.alpha = c.rain * 0.75;
    if (fogSpr) fogSpr.alpha = c.fog * 0.85;
    if (darkSpr) darkSpr.alpha = c.dark;

    // 计时切天气
    if (G.state === 'playing') {
      G.weatherTimer -= dt;
      if (G.weatherTimer <= 0) {
        G.weatherTimer = rnd(15, 28);
        setWeather(pickWeather(), false);
      }
    }

    // 闪电
    if (d.bolt && G.state === 'playing') {
      G.boltTimer -= dt;
      if (G.boltTimer <= 0) {
        G.boltTimer = rnd(1.6, 5.5);
        G.flash = 1;
        G.shake = Math.max(G.shake, 3);
      }
    }
    if (G.flash > 0) {
      G.flash = Math.max(0, G.flash - dt * 4.5);
      if (boltSpr) boltSpr.alpha = G.flash * 0.55;
    } else if (boltSpr) boltSpr.alpha = 0;
  }

  /* =========================================================
     主循环
     ========================================================= */
  let spawnTimer = 1.2;

  app.ticker.add(() => {
    const dt = Math.min(app.ticker.deltaMS, 50) / 1000;

    /* --- 背景滚动（始终动，即使在开始界面） --- */
    const idleSpeed = 0.35;
    const sp = G.state === 'playing' ? G.speed : idleSpeed;
    G.time += dt;

    const pxFar = G.W * 0.10 * sp;
    const pxMid = G.W * 0.32 * sp;
    const pxNear = G.W * 0.62 * sp;

    if (bg.far) bg.far.tilePosition.x -= pxFar * dt;
    if (bg.mid) bg.mid.tilePosition.x -= pxMid * dt;
    if (nearSea) nearSea.tilePosition.x -= pxNear * dt;
    if (bg.clouds) bg.clouds.tilePosition.x -= G.W * 0.02 * (1 + sky.cur.wind * 3) * dt;
    if (rainSpr) {
      rainSpr.tilePosition.x -= (G.W * 0.5 + sky.cur.wind * G.W) * dt;
      rainSpr.tilePosition.y += G.H * 1.5 * dt;
    }
    if (fogSpr) fogSpr.tilePosition.x -= G.W * 0.02 * dt;

    updateWeather(dt);

    /* --- 游戏逻辑 --- */
    if (G.state === 'playing') {
      G.speed = clamp(1 + G.dist / 7000, 1, 2.4);
      G.dist += G.speed * Math.min(G.W, G.H) * 0.55 * dt;
      G.score = Math.floor(G.dist / 14) + (G.bonus || 0);
      const scoreEl = $('#hud-score');
      if (scoreEl) scoreEl.textContent = G.score;

      // 生成障碍
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnObstacle();
        // 高速时偶尔来个连击
        const base = clamp(1.5 - (G.speed - 1) * 0.25, 1.05, 1.5);
        spawnTimer = base * rnd(1.0, 1.25);
      }
      updateObstacles(dt);
      updatePlayer(dt);
      checkHit();

      // 水面速度线（前进感）
      if (Math.random() < dt * 18 * G.speed) {
        const W = G.W, H = G.H;
        spawnP({
          x: W + 20, y: G.seaY + rnd(-H * 0.02, H * 0.14),
          vx: -G.W * (0.9 + G.speed * 0.5), vy: rnd(-10, 10),
          grav: 0,
          s0: rnd(0.1, 0.22), s1: rnd(0.25, 0.5),
          a: rnd(0.25, 0.55), max: 0.9
        });
      }
    } else {
      // 待机：模型轻轻起伏
      updatePlayer(dt);
      if (G.state === 'over') updateObstacles(dt * 0.15);
    }

    updateP(dt);

    /* --- 屏幕抖动 --- */
    if (G.shake > 0) {
      G.shake = Math.max(0, G.shake - dt * 26);
      app.stage.x = rnd(-G.shake, G.shake);
      app.stage.y = rnd(-G.shake, G.shake);
    } else {
      app.stage.x = 0;
      app.stage.y = 0;
    }
  });

  /* =========================================================
     UI 流程
     ========================================================= */
  function startGame() {
    if (G.state !== 'ready') return;
    G.state = 'playing';
    G.dist = 0; G.score = 0; G.bonus = 0; G.speed = 1;
    G.weatherTimer = rnd(14, 22);
    spawnTimer = 2.0;
    player.dead = false;
    player.deadT = 0;
    player.y = G.seaY;
    player.vy = 0;
    player.onGround = true;
    player.dive = 0;
    player.diving = false;
    player.wrap.alpha = 1;
    player.wrap.rotation = 0;
    clearObstacles();

    $('#ui-start').classList.add('hide');
    const bb = $('#btn-back'); if (bb) bb.classList.add('dim');
    setTimeout(() => { $('#ui-hud').classList.add('on'); }, 240);
    $('#ui-over').classList.remove('on');
    setTimeout(() => { $('#ui-start').style.visibility = 'hidden'; }, 700);
  }

  function showOver() {
    const hb = $('#hud-best');
    if (hb) hb.textContent = G.best;
    $('#hud-score') && ($('#hud-score').textContent = G.score);
    $('#over-score').textContent = G.score;
    $('#over-best').textContent = G.best;
    const isNew = G.score > G.best;
    if (isNew) {
      G.best = G.score;
      try { localStorage.setItem('surfdash.best', String(G.best)); } catch (e) { }
      $('#over-best').textContent = G.best;
      $('#over-new').classList.add('on');
      $('#over-title').textContent = '新纪录！';
    } else {
      $('#over-new').classList.remove('on');
      $('#over-title').textContent = pick(['被浪拍中了', '撞上礁石了', '这浪有点猛', '再来一次？']);
    }
    $('#ui-hud').classList.remove('on');
    $('#ui-over').classList.add('on');
    const bb = $('#btn-back'); if (bb) bb.classList.remove('dim');
  }

  function restart() {
    $('#ui-over').classList.remove('on');
    G.state = 'ready';
    $('#ui-start').style.visibility = 'visible';
    startGame();
  }

  $('#btn-start').onclick = (e) => { e.stopPropagation(); startGame(); };
  $('#btn-retry').onclick = (e) => { e.stopPropagation(); restart(); };

  /* =========================================================
     输入
     ========================================================= */
  let touch = null;

  function onDown(e) {
    if (G.state !== 'playing') return;
    touch = { y0: e.clientY, diving: false, id: e.pointerId };
  }
  function onMove(e) {
    if (!touch || G.state !== 'playing') return;
    if (!touch.diving && e.clientY - touch.y0 > 26) {
      touch.diving = true;
      diveStart();
    }
  }
  function onUp(e) {
    if (!touch) return;
    if (touch.diving) diveEnd();
    else jump();
    touch = null;
  }

  stageEl.addEventListener('pointerdown', onDown, { passive: true });
  stageEl.addEventListener('pointermove', onMove, { passive: true });
  stageEl.addEventListener('pointerup', onUp, { passive: true });
  stageEl.addEventListener('pointercancel', () => { touch = null; diveEnd(); }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      e.preventDefault();
      if (G.state === 'ready') startGame();
      else if (G.state === 'over') restart();
      else jump();
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      e.preventDefault();
      diveStart();
    } else if (k === 'Enter') {
      if (G.state === 'ready') startGame();
      else if (G.state === 'over') restart();
    }
  });
  document.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') diveEnd();
  });

  /* =========================================================
     尺寸
     ========================================================= */
  let rTimer = 0;
  function doLayout() {
    const W = Math.max(1, stageEl.clientWidth);
    const H = Math.max(1, stageEl.clientHeight);
    const changed = (W !== G.W || H !== G.H);
    G.W = W; G.H = H;
    app.renderer.resize(W, H);

    const landscape = W > H;
    G.seaY = H * (landscape ? 0.70 : 0.64);

    if (changed) {
      layoutPhys();
      buildBackground();
      buildNear();
      if (player.model) layoutPlayer();
      // 障碍物重新摆位（避免尺寸变化后浮空）
      obstacles.forEach((o) => {
        const def = OBS_DEF[o.kind];
        o.sp.x = Math.min(o.sp.x, W + 200);
        o.sp.y = G.seaY + H * def.yOff;
        o.cy = o.sp.y - o.sp.height / 2;
      });
    }
  }

  function onResize() {
    clearTimeout(rTimer);
    rTimer = setTimeout(doLayout, 100);
  }

  /* =========================================================
     启动
     ========================================================= */
  async function boot() {
    doLayout();
    try {
      await loadPlayer();
    } catch (e) {
      console.warn('模型加载失败', e);
      $('#loading-text').textContent = '模型加载失败，直接玩吧';
      // 没模型也能玩：用一个占位图形
      const g = new PIXI.Graphics();
      g.beginFill(0x5ad8ff, 1).drawRoundedRect(-24, -90, 48, 100, 16).endFill();
      player.model = g;
      player.rawH = 100;
      player.board = buildBoard();
      player.wrap.addChild(g, player.board);
      layoutPlayer();
    }
    setWeather('clear', true);
    G.weatherTimer = rnd(14, 22);

    $('#ui-loading').classList.add('off');
    setTimeout(() => { const el = $('#ui-loading'); if (el) el.style.display = 'none'; }, 600);
    G.state = 'ready';

    const hb = $('#hud-best');
    if (hb) hb.textContent = G.best;
    const sw = $('#start-weather');
    if (sw) sw.textContent = WEATHER[sky.tgt].icon + ' ' + WEATHER[sky.tgt].name;

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(stageEl);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (app.ticker.started) app.ticker.stop(); }
      else if (!app.ticker.started) app.ticker.start();
    });
  }

  // 调试口
  window.__dash = {
    G, player, obstacles, setWeather, startGame, restart,
    jump, diveStart, diveEnd, spawnObstacle, sky,
    app, checkHit, playerBox, PHYS, OBS_DEF
  };

  boot();
})();