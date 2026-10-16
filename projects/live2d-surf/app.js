/* ==========================================================
   谁在冲浪 · Live2D 冲浪测试器  v4
   ----------------------------------------------------------
   · 底层（slot）只负责"站哪儿"，模型（actor）带着自己的
     大小 / 旋转 / 镜像搬家 —— 所以人和板对调后外观不变
   · 动画走轻量 tween 系统，10 个动作全部有时间线 + 粒子
   · 海面是每帧重绘的多层波形（带波峰高光、泡沫、波光倒影），
     不再是三张平移贴图
   ========================================================== */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  const stageEl = $('#stage');
  const statusEl = $('#status');
  const toastEl = $('#toast');

  /* ================= 缓动 ================= */

  const E = {
    lin: (p) => p,
    out: (p) => 1 - (1 - p) * (1 - p),
    in: (p) => p * p,
    inOut: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    cOut: (p) => 1 - Math.pow(1 - p, 3),
    cIn: (p) => p * p * p,
    cInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: (p) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },
    backIn: (p) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return c3 * p * p * p - c1 * p * p;
    },
    elastic: (p) =>
      p === 0 ? 0 : p === 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (TAU / 3)) + 1
  };

  /* ================= 主题 ================= */

  const SEAS = {
    dawn: {
      sky: ['#2c4c74', '#8fb9dc', '#ffd9a4'],
      sun: '#fff3cf', sunSize: 0.075, sunY: 0.34, sunX: 0.72,
      sea: [['#5aa8c8', '#16506e'], ['#4bb6d4', '#0e5b7e'], ['#8fe0f2', '#2f9dc4'], ['#d8f6ff', '#63cfe8']],
      foam: '#ffffff', refl: '#ffe8b8', mist: '#ffe6c4'
    },
    day: {
      sky: ['#3d9fe0', '#93d5ff', '#eafaff'],
      sun: '#ffffff', sunSize: 0.07, sunY: 0.26, sunX: 0.76,
      sea: [['#54bcdd', '#0d5f86'], ['#43c2e0', '#0e6f96'], ['#7fdcf0', '#2aa8cc'], ['#dffaff', '#5ad0ea']],
      foam: '#ffffff', refl: '#ffffff', mist: '#eafaff'
    },
    dusk: {
      sky: ['#4b3560', '#c96a72', '#ffc98a'],
      sun: '#ffcf72', sunSize: 0.09, sunY: 0.42, sunX: 0.68,
      sea: [['#a97fa8', '#3a2c4e'], ['#a86f8b', '#463a60'], ['#c98fa8', '#6a4d6e'], ['#ffd9c9', '#c98fa8']],
      foam: '#fff0e2', refl: '#ffcf9a', mist: '#ffd2b0'
    },
    night: {
      sky: ['#03060f', '#0d2340', '#2c4a75'],
      sun: '#e8f2ff', sunSize: 0.055, sunY: 0.22, sunX: 0.8,
      sea: [['#2a5a80', '#061426'], ['#285f82', '#08202f'], ['#3d7ea8', '#0e3350'], ['#8fc4e6', '#2a5f85']],
      foam: '#dceeff', refl: '#cfe8ff', mist: '#8fb6d8'
    },
    storm: {
      sky: ['#2f3b49', '#5f6d7c', '#9aa8b6'],
      sun: '#c9d3de', sunSize: 0.05, sunY: 0.18, sunX: 0.3,
      sea: [['#6b8496', '#1c313c'], ['#5f8296', '#223c47'], ['#6d90a4', '#2b4652'], ['#cfe3ec', '#7fa3b5']],
      foam: '#ffffff', refl: '#dfeaf2', mist: '#b9ccd8'
    }
  };

  const SCENE_DEFAULT = {
    wave: 46, speed: 50, sway: 30, gap: 0, sea: 'day',
    scroll: true, lines: true, spray: true, trail: true, reflect: true, lowRes: false
  };

  const scene = Object.assign({}, SCENE_DEFAULT, readHashScene());

  function readHashScene() {
    try {
      const h = location.hash.replace(/^#/, '');
      if (!h) return {};
      const d = JSON.parse(decodeURIComponent(escape(atob(h))));
      return d && d.scene ? d.scene : {};
    } catch (e) { return {}; }
  }

  let presetList = [];
  const DEFAULTS = {
    rider: '001_adv_tomori_001_casual_spring_01',
    mount: '002_adv_anon_002_casual_spring_01'
  };

  /* ================= pixi ================= */

  const live2d = PIXI.live2d || {};
  const Live2DModel = live2d.Live2DModel;
  if (Live2DModel && Live2DModel.registerTicker) Live2DModel.registerTicker(PIXI.Ticker);

  const view = { W: 1, H: 1 };
  function measure() {
    view.W = Math.max(1, stageEl.clientWidth);
    view.H = Math.max(1, stageEl.clientHeight);
  }

  const app = new PIXI.Application({
    antialias: true,
    autoDensity: true,
    backgroundColor: 0x0a0f1c,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });
  measure();
  app.renderer.resize(view.W, view.H);
  stageEl.insertBefore(app.view, stageEl.firstChild);
  app.stage.sortableChildren = true;

  // 图层自下而上
  const skyLayer = new PIXI.Container();
  const waterFar = new PIXI.Container();
  const waterMid = new PIXI.Container();
  const fxBack = new PIXI.Container();
  const world = new PIXI.Container();
  const waterNear = new PIXI.Container();
  const fxFront = new PIXI.Container();
  const overlay = new PIXI.Container();
  world.sortableChildren = true;
  app.stage.addChild(skyLayer, waterFar, waterMid, fxBack, world, waterNear, fxFront, overlay);

  const darkMask = new PIXI.Graphics();
  const spotLight = new PIXI.Sprite();
  darkMask.beginFill(0x000814, 1).drawRect(0, 0, 1, 1).endFill();
  darkMask.alpha = 0;
  spotLight.anchor.set(0.5);
  spotLight.blendMode = PIXI.BLEND_MODES.ADD;
  spotLight.alpha = 0;
  overlay.addChild(darkMask, spotLight);

  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.55 };
  stageEl.addEventListener('pointermove', (e) => {
    const r = stageEl.getBoundingClientRect();
    pointer.tx = clamp((e.clientX - r.left) / r.width, 0, 1);
    pointer.ty = clamp((e.clientY - r.top) / r.height, 0, 1);
  }, { passive: true });
  stageEl.addEventListener('pointerleave', () => { pointer.tx = 0.5; pointer.ty = 0.55; });

  /* ================= 程序纹理 ================= */

  const texCache = {};
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function tex(key, builder) {
    if (!texCache[key]) texCache[key] = PIXI.Texture.from(builder());
    return texCache[key];
  }

  // 竖向渐变（任意色标）
  function gradCanvas(stops, w, h) {
    const c = makeCanvas(w || 8, h || 256);
    const g = c.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 0, c.height);
    stops.forEach((s) => lg.addColorStop(s[0], s[1]));
    g.fillStyle = lg;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // 水面细节纹理（细波纹 + 泡沫点），可横向平铺
  function waterDetail(seed, bright, dots, alpha) {
    const w = 512, h = 128;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    let s = seed;
    const rs = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

    g.strokeStyle = bright;
    g.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      const y0 = (k + 0.5) * h / 7;
      const amp = 1.4 + rs() * 2.6;
      const f = (0.6 + rs() * 1.4) * TAU / w;
      g.globalAlpha = alpha * (0.35 + rs() * 0.5);
      g.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = y0 + Math.sin(x * f + k * 1.7) * amp;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < dots; i++) {
      const x = rs() * w, y = rs() * h, r = 0.6 + rs() * 1.8;
      g.globalAlpha = alpha * (0.2 + rs() * 0.5);
      g.fillStyle = bright;
      for (let k = -1; k <= 1; k++) {
        g.beginPath(); g.arc(x + k * w, y, r, 0, TAU); g.fill();
      }
    }
    g.globalAlpha = 1;
    return c;
  }

  function radialCanvas(size, stops) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach((s) => rg.addColorStop(s[0], s[1]));
    g.fillStyle = rg;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function sprayCanvas() {
    const size = 128, c = makeCanvas(size, size), g = c.getContext('2d');
    let s = 20250;
    const rs = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 16; i++) {
      const x = size / 2 + (rs() - 0.5) * size * 0.72;
      const y = size / 2 + (rs() - 0.5) * size * 0.72;
      const r = size * (0.06 + rs() * 0.16);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,0.95)');
      rg.addColorStop(0.5, 'rgba(228,247,255,0.55)');
      rg.addColorStop(1, 'rgba(200,235,255,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    return c;
  }

  function lineCanvas() {
    const c = makeCanvas(256, 64), g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 30, 120, 2);
    g.fillRect(150, 12, 70, 1.6);
    g.fillRect(180, 50, 50, 1.4);
    return c;
  }

  function emojiCanvas(ch) {
    const size = 96, c = makeCanvas(size, size), g = c.getContext('2d');
    g.font = (size * 0.78) + 'px "Noto Color Emoji", "Apple Color Emoji", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, size / 2, size / 2 + 4);
    return c;
  }

  const T = {
    spray: () => tex('spray', sprayCanvas),
    drop: () => tex('drop', () => radialCanvas(48, [[0, 'rgba(255,255,255,0.95)'], [0.5, 'rgba(215,242,255,0.5)'], [1, 'rgba(180,225,255,0)']])),
    foam: () => tex('foam', () => radialCanvas(64, [[0, 'rgba(255,255,255,0.92)'], [0.6, 'rgba(240,252,255,0.36)'], [1, 'rgba(230,248,255,0)']])),
    glow: () => tex('glow', () => radialCanvas(128, [[0, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']])),
    bubble: () => tex('bubble', () => radialCanvas(48, [[0, 'rgba(255,255,255,0.05)'], [0.62, 'rgba(255,255,255,0.06)'], [0.75, 'rgba(235,250,255,0.7)'], [0.92, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']])),
    line: () => tex('line', lineCanvas),
    fish: () => tex('fish', () => emojiCanvas('🐟')),
    bird: () => tex('bird', () => emojiCanvas('🕊'))
  };

  function detailTex(layer) {
    return tex('det' + layer + scene.sea, () => {
      const th = SEAS[scene.sea] || SEAS.day;
      return waterDetail(101 + layer * 37, th.foam, 70 + layer * 70, 0.55 + layer * 0.14);
    });
  }

  /* ================= 波浪系统 =================
     每个水层 = 一张滚动的细节贴图 + 一个每帧重绘的波形面（填充 + 高光 + 泡沫）
     ============================================ */

  const LAYERS = [
    { id: 0, horizonMix: 0.00, amp: 0.010, freq: 0.0125, spd: 0.55, scrollK: 0.55, foamN: 10, hl: 0.45, maxY: 0.62 },
    { id: 1, horizonMix: 0.18, amp: 0.018, freq: 0.0095, spd: 0.80, scrollK: 0.95, foamN: 16, hl: 0.60, maxY: 0.80 },
    { id: 2, horizonMix: 0.42, amp: 0.030, freq: 0.0072, spd: 1.15, scrollK: 1.45, foamN: 26, hl: 0.85, maxY: 1.05 }
  ];

  const water = { containers: [waterFar, waterMid, waterNear], tiling: [], g: [], horizon: 0 };
  let bg = { lines: null };

  function buildScene() {
    [skyLayer, waterFar, waterMid, waterNear, fxFront].forEach((l) => l.removeChildren());
    const W = view.W, H = view.H;
    const th = SEAS[scene.sea] || SEAS.day;
    const horizon = Math.round(H * 0.34);
    water.horizon = horizon;

    /* --- 天空 --- */
    const skyH = horizon + H * 0.1 + 2;
    const sky = new PIXI.Sprite(PIXI.Texture.from(gradCanvas([
      [0, th.sky[0]], [0.55, th.sky[1]], [1, th.sky[2]]
    ])));
    sky.width = W; sky.height = skyH;
    skyLayer.addChild(sky);

    /* --- 太阳 + 光晕 --- */
    const sun = new PIXI.Graphics();
    sun.beginFill(PIXI.utils.string2hex(th.sun), 1);
    sun.drawCircle(0, 0, Math.min(W, H) * th.sunSize);
    sun.endFill();
    sun.position.set(W * th.sunX, horizon * th.sunY);
    skyLayer.addChild(sun);

    const glow = new PIXI.Sprite(T.glow());
    glow.anchor.set(0.5);
    glow.width = glow.height = Math.min(W, H) * 0.62;
    glow.tint = PIXI.utils.string2hex(th.sun);
    glow.alpha = 0.4;
    glow.position.copyFrom(sun.position);
    skyLayer.addChild(glow);

    /* --- 云 --- */
    const clouds = new PIXI.Graphics();
    clouds.beginFill(0xffffff, 0.42);
    for (let i = 0; i < 6; i++) {
      const cx = (i * 0.22 + 0.05) * W;
      const cy = horizon * (0.12 + 0.15 * ((i * 5) % 5));
      const r = Math.min(W, H) * (0.045 + ((i * 7) % 5) * 0.011);
      clouds.drawCircle(cx, cy, r);
      clouds.drawCircle(cx + r * 0.95, cy + r * 0.18, r * 0.7);
      clouds.drawCircle(cx - r * 0.9, cy + r * 0.26, r * 0.58);
    }
    clouds.endFill();
    skyLayer.addChild(clouds);

    /* --- 海平线雾带 --- */
    const mist = new PIXI.Sprite(PIXI.Texture.from(gradCanvas([
      [0, 'rgba(255,255,255,0)'], [0.5, th.mist], [1, 'rgba(255,255,255,0)']
    ], 8, 64)));
    mist.width = W; mist.height = Math.max(8, H * 0.05);
    mist.y = horizon - H * 0.025;
    mist.alpha = 0.5;
    skyLayer.addChild(mist);

    /* --- 波光倒影（太阳在水面的光柱） --- */
    const refl = new PIXI.Sprite(T.glow());
    refl.anchor.set(0.5, 0);
    refl.tint = PIXI.utils.string2hex(th.refl);
    refl.x = W * th.sunX;
    refl.y = horizon;
    refl.width = W * 0.3;
    refl.height = (H - horizon) * 0.75;
    refl.alpha = 0.32;
    waterFar.addChild(refl);
    water.refl = refl;

    /* --- 三层水 --- */
    water.tiling = [];
    water.g = [];
    water.horizon = horizon;
    water.baseY = [];
    for (let i = 0; i < 3; i++) water.baseY.push(horizon + (H - horizon) * (0.02 + i * 0.30));
    if (waveMesh.length) {
      waveMesh.forEach((r) => {
        if (!r) return;
        try { r.body.geometry.destroy(); r.body.destroy(); } catch (e) { }
        if (r.foam) { try { r.foam.geometry.destroy(); r.foam.destroy(); } catch (e) { } }
      });
      waveMesh.length = 0;
    }
    for (let i = 0; i < 3; i++) {
      const L = LAYERS[i];
      L.topF = 0.34 + i * 0.02;
      // 先放水面色块（mesh），再把细节贴图叠在上面
      makeWaveMesh(i);
      const t = new PIXI.TilingSprite(detailTex(i + 1), W + 4, H - horizon + 4);
      t.position.set(0, horizon);
      t.alpha = 0.42 + i * 0.14;
      t.tileScale.set(0.9 + i * 0.45, 1.2 + i * 0.8);
      water.containers[i].addChild(t);
      water.tiling.push(t);
      water.g.push(null);
    }

    /* --- 前景速度线 --- */
    const lines = new PIXI.TilingSprite(T.line(), W * 1.25, H);
    lines.alpha = 0.14;
    lines.rotation = 0.03;
    fxFront.addChild(lines);
    bg = { lines: lines };

    refl.parent.setChildIndex(refl, 0);
  }

  // 多层正弦叠加，返回相对基线的像素偏移
  function waveY(x, L, t, H, tide) {
    const a = L.amp * H * (0.55 + scene.wave / 100 * 1.5);
    const k = L.freq / Math.max(0.6, view.W / 420);
    return (
      Math.sin(x * k + t * L.spd) * 0.62 +
      Math.sin(x * k * 2.17 - t * L.spd * 1.55 + 1.7) * 0.27 +
      Math.sin(x * k * 4.31 + t * L.spd * 2.35 + 3.1) * 0.16 +
      Math.sin(x * k * 7.9 - t * L.spd * 3.2 + 5.2) * 0.08
    ) * a + tide;
  }

  /* ---- 波浪用 Mesh 做顶点位移（比 Graphics 每帧重绘快一个数量级） ---- */

  const waveMesh = [];   // 每层 { mesh, buf, cols, baseY, foamMesh, foamBuf }

  function makeWaveMesh(i) {
    const W = view.W, H = view.H;
    const L = LAYERS[i];
    const cols = scene.lowRes ? 18 : Math.max(22, Math.min(44, Math.round(W / 14)));
    const n = (cols + 1) * 2;
    const pos = new Float32Array(n * 2);
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let c = 0; c <= cols; c++) {
      const x = c / cols * W * 1.02;
      const a = (c * 2) * 2, b = (c * 2 + 1) * 2;
      pos[a] = x; pos[a + 1] = 0;
      pos[b] = x; pos[b + 1] = H + 24;
      uv[a] = c / cols * 1.6; uv[a + 1] = 0;
      uv[b] = c / cols * 1.6; uv[b + 1] = 1;
    }
    for (let c = 0; c < cols; c++) {
      const t0 = c * 2, b0 = c * 2 + 1, t1 = (c + 1) * 2, b1 = (c + 1) * 2 + 1;
      idx.push(t0, b0, b1, t0, b1, t1);
    }
    function buildMesh(texture, alpha, topY, botY) {
      const p = pos.slice();
      for (let c = 0; c <= cols; c++) {
        p[(c * 2) * 2 + 1] = topY;
        p[(c * 2 + 1) * 2 + 1] = botY;
      }
      const geo = new PIXI.Geometry()
        .addAttribute('aVertexPosition', p, 2)
        .addAttribute('aUv', uv, 2)
        .addIndex(idx);
      const m = new PIXI.Mesh(geo, new PIXI.MeshMaterial(texture));
      m.alpha = alpha;
      return m;
    }

    const B = water.baseY[i] || H * 0.5;
    const bodyTex = tex('wave' + i + scene.sea, () => {
      const th = SEAS[scene.sea] || SEAS.day;
      const [cTop, cBot] = th.sea[i];
      return gradCanvas([
        [0, cTop], [0.07, cTop], [0.28, cBot], [1, cBot]
      ], 16, 128);
    });
    const body = buildMesh(bodyTex, 0.92, B, H + 24);
    water.containers[i].addChild(body);

    let foam = null, foamBuf = null;
    if (i >= 0) {
      const foamTex = tex('foam2_' + i + scene.sea, () => {
        const th = SEAS[scene.sea] || SEAS.day;
        const c = makeCanvas(512, 96);
        const g = c.getContext('2d');
        let s = 777 + i * 131;
        const rs = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        for (let k = 0; k < 130; k++) {
          const x = rs() * 512;
          const y = Math.pow(rs(), 2.0) * 96;
          const r = 1.2 + rs() * 5.5;
          g.globalAlpha = 0.85 * (1 - y / 96) * (0.4 + rs() * 0.6);
          g.fillStyle = th.foam;
          for (let d = -1; d <= 1; d++) {
            g.beginPath(); g.arc(x + d * 512, y, r, 0, TAU); g.fill();
          }
        }
        // 泡沫带顶部的连续白边（压低，只做点缀）
        g.globalAlpha = 0.3;
        g.beginPath();
        for (let x = 0; x <= 512; x += 6) g.lineTo(x, 2 + Math.sin(x * 0.09) * 3 + rs() * 5);
        g.lineTo(512, 9); g.lineTo(0, 9); g.closePath();
        g.fillStyle = th.foam;
        g.fill();
        return c;
      });
      foam = buildMesh(foamTex, i === 2 ? 0.9 : 0.5, B, B + H * (0.036 + i * 0.016));
      water.containers[i].addChild(foam);
    }

    // 波峰高光线（贴着波形的一条亮线，最能体现"浪"的形状）
    const whiteTex = tex('white1x1', () => {
      const c = makeCanvas(4, 4), g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 4, 4);
      return c;
    });
    const slickH = Math.max(1.6, H * (0.0026 + i * 0.0012));
    const slick = buildMesh(whiteTex, 0.34 + i * 0.14, B, B + slickH);
    water.containers[i].addChild(slick);

    waveMesh[i] = {
      cols: cols,
      body: body, bodyBuf: body.geometry.getBuffer('aVertexPosition'),
      foam: foam, foamBuf: foam ? foam.geometry.getBuffer('aVertexPosition') : null,
      slick: slick, slickBuf: slick.geometry.getBuffer('aVertexPosition'),
      slickH: slickH, baseY: 0, tide: 0
    };
    return waveMesh[i];
  }

  function updateWaveMeshes(t) {
    const W = view.W, H = view.H;
    for (let i = 0; i < 3; i++) {
      const rec = waveMesh[i];
      if (!rec) continue;
      const L = LAYERS[i];
      const coast = L.topF;
      const baseY = water.baseY[i] || H * 0.5;
      const tide = Math.sin(t * (0.35 + i * 0.12) + i * 2.1) * H * 0.007 * (0.4 + scene.wave / 100);
      const cols = rec.cols;
      const bd = rec.bodyBuf.data;
      const fd = rec.foamBuf ? rec.foamBuf.data : null;
      const sd = rec.slickBuf ? rec.slickBuf.data : null;
      const foamH = H * (0.036 + i * 0.016) * (0.7 + scene.wave / 90);
      for (let c = 0; c <= cols; c++) {
        const x = c / cols * W * 1.02;
        const y = baseY + waveY(x, L, t, H, tide);
        bd[(c * 2) * 2 + 1] = y;
        if (fd) {
          fd[(c * 2) * 2 + 1] = y;
          fd[(c * 2 + 1) * 2 + 1] = y + foamH;
        }
        if (sd) {
          sd[(c * 2) * 2 + 1] = y - rec.slickH * 0.35;
          sd[(c * 2 + 1) * 2 + 1] = y + rec.slickH * 0.65;
        }
      }
      rec.bodyBuf.update();
      if (rec.foamBuf) rec.foamBuf.update();
      if (rec.slickBuf) rec.slickBuf.update();
    }
  }

  /* ================= 粒子池 ================= */

  const P = { live: [], free: [], max: 200 };
  function newParticle(tx) {
    const sp = new PIXI.Sprite(tx || T.drop());
    sp.anchor.set(0.5);
    sp.visible = false;
    fxBack.addChild(sp);
    return { sp: sp, life: 0, max: 1, vx: 0, vy: 0, grav: 0, s0: 1, s1: 1, a0: 1, a1: 0, vr: 0, fadeIn: 0, front: false };
  }
  for (let i = 0; i < 70; i++) P.free.push(newParticle());

  function spawn(o) {
    let p = null;
    if (P.free.length) p = P.free.pop();
    else if (P.live.length < P.max) p = newParticle(o.tex);
    else return null;

    p.sp.texture = o.tex || T.drop();
    p.sp.visible = true;
    p.sp.position.set(o.x, o.y);
    p.sp.tint = o.tint === undefined ? 0xffffff : o.tint;
    p.sp.rotation = o.rot || 0;
    p.s0 = o.s0 === undefined ? 0.4 : o.s0;
    p.s1 = o.s1 === undefined ? 1.6 : o.s1;
    p.sp.scale.set(p.s0);
    p.vx = o.vx || 0;
    p.vy = o.vy || 0;
    p.grav = o.grav === undefined ? 380 : o.grav;
    p.vr = o.vr || 0;
    p.a0 = o.a0 === undefined ? 0.9 : o.a0;
    p.a1 = o.a1 === undefined ? 0 : o.a1;
    p.fadeIn = o.fadeIn || 0;
    p.sp.alpha = p.fadeIn > 0 ? 0 : p.a0;
    p.life = 0;
    p.max = o.max || 1;

    if (o.front) {
      if (p.front !== true) { fxBack.removeChild(p.sp); fxFront.addChild(p.sp); p.front = true; }
    } else if (p.front === true) {
      fxFront.removeChild(p.sp); fxBack.addChild(p.sp); p.front = false;
    }
    P.live.push(p);
    return p;
  }

  function updateParticles(dt) {
    const arr = P.live;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) {
        p.sp.visible = false;
        arr.splice(i, 1);
        P.free.push(p);
        continue;
      }
      p.vy += p.grav * dt;
      const sp = p.sp;
      sp.x += p.vx * dt;
      sp.y += p.vy * dt;
      if (p.vr) sp.rotation += p.vr * dt;
      sp.scale.set(p.s0 + (p.s1 - p.s0) * t);
      let a;
      if (p.fadeIn > 0 && t < p.fadeIn) a = p.a0 * (t / p.fadeIn);
      else a = p.a0 + (p.a1 - p.a0) * t;
      sp.alpha = a;
    }
  }

  /* ================= actor / slot =================
     slot  = 位置（上下层，不参与交换）
     actor = 模型 + 它的外观参数（跟着模型走）
     ============================================== */

  const SLOT_POS = {
    rider: { yRatio: 0.41, baseRot: -8, fit: 0.55 },
    mount: { yRatio: 0.63, baseRot: 88, fit: 0.6 }
  };

  function makeActor(kind) {
    const mount = kind === 'mount';
    return {
      model: null, rawW: 1, rawH: 1,
      name: '', preset: '', url: '', loading: false,
      sc: mount ? 100 : 80,
      rot: mount ? 88 : -8,
      ox: 0, oy: 0,
      flip: false, follow: true,
      expression: '', motion: ''
    };
  }

  function makeSlot(key) {
    const wrap = new PIXI.Container();
    wrap.zIndex = key === 'mount' ? 1 : 2;
    world.addChild(wrap);
    return { key: key, wrap: wrap, actor: makeActor(key), baseX: 0, baseY: 0, baseRot: 0, k: 1 };
  }

  const slots = { rider: makeSlot('rider'), mount: makeSlot('mount') };

  function layoutSlot(slot) {
    const a = slot.actor;
    if (!a.model) return;
    const W = view.W, H = view.H;
    const pos = SLOT_POS[slot.key];
    const fit = Math.min(H * pos.fit / a.rawH, W * 0.95 / a.rawW);
    const k = fit * (a.sc / 100);

    slot.k = k;
    slot.wrap.scale.set(k);
    const gapShift = slot.key === 'rider' ? -(scene.gap / 100) : 0;
    slot.baseX = W * (0.5 + a.ox / 100);
    slot.baseY = H * (pos.yRatio + a.oy / 100 + gapShift);
    slot.baseRot = a.rot * Math.PI / 180;
    slot.wrap.position.set(slot.baseX, slot.baseY);
    slot.wrap.rotation = slot.baseRot;
    a.model.scale.x = a.flip ? -1 : 1;
  }

  function setStatus(text, isErr) {
    if (!text) { statusEl.classList.remove('on', 'err'); statusEl.textContent = ''; return; }
    statusEl.textContent = text;
    statusEl.classList.add('on');
    statusEl.classList.toggle('err', !!isErr);
  }

  let toastTimer = 0;
  function toast(text, ms) {
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms || 1900);
  }

  /* ================= 模型加载 ================= */

  async function loadInto(slot, source, label, fromPreset) {
    const a = slot.actor;
    if (a.loading) return;
    a.loading = true;
    setStatus('加载中… ' + (label || ''));
    let model = null;
    try {
      model = await Live2DModel.from(source, { autoInteract: false });
    } catch (err) {
      a.loading = false;
      setStatus('加载失败：' + (err && err.message ? err.message : err), true);
      console.warn(err);
      setTimeout(() => setStatus(''), 4000);
      return;
    }
    const old = a.model;
    if (old) {
      slot.wrap.removeChild(old);
      try { old.destroy({ children: true, texture: false, baseTexture: false }); } catch (e) { }
    }
    a.model = model;
    slot.wrap.addChild(model);
    const b = model.getLocalBounds();
    a.rawW = Math.max(1, b.width);
    a.rawH = Math.max(1, b.height);
    model.pivot.set(b.x + b.width / 2, b.y + b.height / 2);
    model.position.set(0, 0);
    a.name = label || '';
    if (!fromPreset) a.preset = '';
    a.loading = false;
    setStatus('');
    layoutSlot(slot);
    refreshName(slot);
    refreshActionOptions();
    return model;
  }

  function refreshName(slot) {
    const pane = $(`[data-pane="${slot.key}"]`);
    if (!pane) return;
    const el = $('.model-name', pane);
    if (!el) return;
    el.textContent = slot.actor.name || '（未加载）';
    el.classList.toggle('dim', !slot.actor.model);
  }

  async function loadPreset(key, slug) {
    const item = presetList.find((x) => x.slug === slug);
    if (!item) return;
    const slot = slots[key];
    slot.actor.preset = slug;
    slot.actor.url = '';
    let source;
    if (window.__EMBED__ && window.__EMBED__.models && window.__EMBED__.models[slug]) {
      source = await unpackEmbedded(slug);
    } else {
      source = 'models/' + slug + '/' + item.model3;
    }
    const m = await loadInto(slot, source, item.name, true);
    if (m) saveState();
  }

  /* 单文件版：模型以 base64 zip 内嵌，运行时解成 File 数组 */
  const _unpacked = {};
  async function unpackEmbedded(slug) {
    if (_unpacked[slug]) return _unpacked[slug];
    setStatus('解压内置模型…');
    const b64 = window.__EMBED__.models[slug];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const files = [];
    for (const n of names) {
      const blob = await zip.files[n].async('blob');
      const f = new File([blob], n.split('/').pop(), { type: 'application/octet-stream' });
      try { Object.defineProperty(f, 'webkitRelativePath', { value: n, configurable: true }); } catch (e) { }
      files.push(f);
    }
    _unpacked[slug] = files;
    setStatus('');
    return files;
  }

  function fileToRelative(files) {
    return files.map((f) => {
      if (f.webkitRelativePath) return f;
      try { Object.defineProperty(f, 'webkitRelativePath', { value: f.name, configurable: true }); } catch (e) { }
      return f;
    });
  }

  async function loadZip(key, file) {
    const slot = slots[key];
    setStatus('解压中…');
    let zip;
    try { zip = await JSZip.loadAsync(file); }
    catch (e) { setStatus('zip 打不开', true); setTimeout(() => setStatus(''), 3500); return; }
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX'));
    const cands = names.filter((n) => /\.model3?\.json$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length);
    if (!cands.length) { setStatus('压缩包里找不到 .model3.json', true); setTimeout(() => setStatus(''), 4000); return; }
    const target = cands[0];
    const base = target.slice(0, target.lastIndexOf('/') + 1);
    const picked = names.filter((n) => n === target || n.startsWith(base));
    const out = [];
    let done = 0;
    for (const n of picked) {
      const blob = await zip.files[n].async('blob');
      const rel = n.startsWith(base) ? n.slice(base.length) : n;
      const f = new File([blob], rel.split('/').pop(), { type: 'application/octet-stream' });
      try { Object.defineProperty(f, 'webkitRelativePath', { value: rel, configurable: true }); } catch (e) { }
      out.push(f);
      done++;
      if (done % 12 === 0) setStatus('解压中… ' + done + '/' + picked.length);
    }
    await loadInto(slot, out, file.name.replace(/\.zip$/i, ''), false);
    saveState();
  }

  async function loadFiles(key, fileList) {
    const files = fileToRelative(Array.from(fileList));
    if (!files.length) return;
    const m3 = files.find((f) => /\.model3?\.json$/i.test(f.name));
    if (!m3) { setStatus('没找到 .model3.json', true); setTimeout(() => setStatus(''), 4000); return; }
    await loadInto(slots[key], files, m3.name.replace(/\.model3?\.json$/i, ''), false);
    saveState();
  }

  async function loadURL(key, url) {
    if (!url) return;
    const slot = slots[key];
    slot.actor.preset = '';
    slot.actor.url = url;
    await loadInto(slot, url, url.split('/').pop(), false);
    saveState();
  }

  /* ================= 槽位 UI ================= */

  function slotPaneHTML(key) {
    const title = key === 'mount' ? '冲浪板' : '冲浪者';
    const tip = key === 'mount'
      ? '默认横躺 88° 当作板子'
      : '默认前倾 -8° 站在板上';
    return `
      <div class="card">
        <div class="label">模型 <span class="dimtxt">${tip}</span></div>
        <div class="srcrow">
          <select class="preset"></select>
          <button class="btn mini accent load-preset">换上</button>
        </div>
        <div class="srcrow">
          <label class="btn mini">上传 zip<input type="file" class="zip" accept=".zip,application/zip" hidden></label>
          <label class="btn mini">选文件夹<input type="file" class="dir" webkitdirectory directory multiple hidden></label>
        </div>
        <div class="srcrow">
          <input type="text" class="url" placeholder="或粘贴 .model3.json 网址">
          <button class="btn mini load-url">载入</button>
        </div>
        <div class="model-name dim">（未加载）</div>
      </div>
      <div class="card">
        <div class="label">位置 / 外观</div>
        <div class="row"><label>缩放</label><input type="range" class="sc" min="30" max="230" value="100"><output></output></div>
        <div class="row"><label>左右</label><input type="range" class="ox" min="-60" max="60" value="0"><output></output></div>
        <div class="row"><label>高低</label><input type="range" class="oy" min="-60" max="60" value="0"><output></output></div>
        <div class="row"><label>旋转</label><input type="range" class="rot" min="-180" max="180" value="0"><output></output></div>
        <label class="sw"><input type="checkbox" class="flip"><span>水平镜像</span></label>
        <label class="sw"><input type="checkbox" class="follow" checked><span>视线跟随手指</span></label>
      </div>
      <button class="btn wide ghost reset">重置「${title}」</button>
    `;
  }

  function buildSlotUI(key) {
    const pane = $(`[data-pane="${key}"]`);
    if (!pane) return;
    pane.innerHTML = slotPaneHTML(key);
    const slot = slots[key];
    const a = slot.actor;
    const q = (s) => $(s, pane);

    fillPresetSelect(q('.preset'));
    q('.preset').value = a.preset || '';
    q('.load-preset').onclick = () => {
      const v = q('.preset').value;
      if (!v) { toast('先选一个模型'); return; }
      loadPreset(key, v);
    };
    q('.zip').onchange = (e) => { if (e.target.files[0]) loadZip(key, e.target.files[0]); e.target.value = ''; };
    q('.dir').onchange = (e) => { if (e.target.files.length) loadFiles(key, e.target.files); e.target.value = ''; };
    q('.load-url').onclick = () => loadURL(key, q('.url').value.trim());

    const bindRange = (sel, field) => {
      const input = q(sel);
      const out = input.parentElement.querySelector('output');
      input.value = a[field];
      const paint = () => { out.textContent = input.value; };
      paint();
      input.oninput = () => { a[field] = parseFloat(input.value); paint(); layoutSlot(slot); };
      input.onchange = saveState;
    };
    bindRange('.sc', 'sc');
    bindRange('.ox', 'ox');
    bindRange('.oy', 'oy');
    bindRange('.rot', 'rot');

    const flip = q('.flip');
    flip.checked = !!a.flip;
    flip.onchange = () => { a.flip = flip.checked; layoutSlot(slot); saveState(); };

    const follow = q('.follow');
    follow.checked = !!a.follow;
    follow.onchange = () => { a.follow = follow.checked; saveState(); };

    q('.reset').onclick = () => {
      const d = makeActor(key);
      Object.assign(a, {
        sc: d.sc, rot: d.rot, ox: d.ox, oy: d.oy,
        flip: d.flip, follow: d.follow
      });
      buildSlotUI(key);
      if (a.model) layoutSlot(slot);
      saveState();
    };

    refreshName(slot);
  }

  function fillPresetSelect(sel) {
    if (sel.dataset.filled === '1') return;
    const groups = {};
    presetList.forEach((x) => {
      const who = (x.name || '').split(' · ')[0] || '其它';
      (groups[who] = groups[who] || []).push(x);
    });
    sel.innerHTML = '<option value="">— 内置模型 —</option>';
    Object.keys(groups).forEach((who) => {
      const og = document.createElement('optgroup');
      og.label = who;
      groups[who].forEach((x) => {
        const o = document.createElement('option');
        o.value = x.slug;
        o.textContent = x.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.dataset.filled = '1';
  }

  /* ================= 面板切换 ================= */

  function bindTabs() {
    $$('.tab').forEach((btn) => {
      btn.onclick = () => {
        $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === btn.dataset.tab));
        onResize();
      };
    });
  }

  /* ================= tween 动作系统 ================= */

  const tw = [];
  let busyShown = false;

  function tween(dur, update, opts) {
    const o = opts || {};
    tw.push({
      t: -(o.delay || 0),
      dur: Math.max(0.001, dur),
      upd: update,
      ease: o.ease || E.inOut,
      done: o.done || null
    });
  }

  function updateTweens(dt) {
    for (let i = tw.length - 1; i >= 0; i--) {
      const a = tw[i];
      a.t += dt;
      if (a.t < 0) continue;
      const p = Math.min(1, a.t / a.dur);
      try { a.upd(a.ease(p), p); } catch (e) { }
      if (p >= 1) {
        tw.splice(i, 1);
        if (a.done) { try { a.done(); } catch (e) { } }
      }
    }
    const b = tw.length > 0;
    if (b !== busyShown) {
      busyShown = b;
      const box = $('#acts');
      if (box) $$('.btn', box).forEach((el) => { el.disabled = b; });
    }
  }

  // 每帧重置的动作偏移
  const fx = {};
  fx.focus = { x: 0, y: 0 };
  function resetFx() {
    fx.wY = 0; fx.wX = 0; fx.wRot = 0; fx.wScale = 1;
    fx.rY = 0; fx.rRot = 0; fx.mY = 0; fx.mRot = 0;
    fx.shake = 0; fx.dark = 0; fx.flash = 0; fx.boost = 0; fx.spot = 0;
    fx.focus.x = 0; fx.focus.y = 0;
  }
  resetFx();

  const running = () => tw.length > 0;

  /* ---- 通用水花 ---- */
  function splash(power, spread) {
    const W = view.W, H = view.H;
    const m = slots.mount;
    const cx = m.actor.model ? m.wrap.position.x : W * 0.5;
    const cy = m.actor.model ? m.wrap.position.y : H * 0.63;
    const n = Math.round((18 + 46 * power) * (scene.spray ? 1 : 0.35));
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI * (0.12 + Math.random() * 0.76);
      const sp = (150 + Math.random() * 430) * power;
      spawn({
        x: cx + rnd(-1, 1) * W * 0.07 * spread,
        y: cy + rnd(-1, 1) * H * 0.025,
        vx: Math.cos(ang) * sp * rnd(0.35, 1.15),
        vy: Math.sin(ang) * sp * rnd(0.55, 1.25),
        grav: rnd(520, 920),
        tex: Math.random() < 0.5 ? T.spray() : T.drop(),
        s0: rnd(0.24, 0.6) * power,
        s1: rnd(0.5, 1.35) * power,
        a0: rnd(0.5, 0.95),
        max: rnd(0.5, 1.25),
        vr: rnd(-3, 3)
      });
    }
    // 底层翻涌的泡沫
    for (let i = 0; i < Math.round(n * 0.35); i++) {
      spawn({
        x: cx + rnd(-1, 1) * W * 0.11 * spread,
        y: cy + rnd(-0.4, 0.5) * H * 0.03,
        vx: rnd(-70, 70), vy: rnd(-140, -30),
        grav: 260,
        tex: T.foam(),
        s0: rnd(0.3, 0.6), s1: rnd(1.2, 2.4),
        a0: rnd(0.35, 0.7), max: rnd(0.7, 1.5)
      });
    }
  }

  function bubbles(cx, cy, n, spread) {
    for (let i = 0; i < n; i++) {
      spawn({
        x: cx + rnd(-1, 1) * spread,
        y: cy + rnd(-1, 1) * spread * 0.5,
        vx: rnd(-30, 30), vy: rnd(-120, -40),
        grav: -30,
        tex: T.bubble(),
        s0: rnd(0.15, 0.4), s1: rnd(0.5, 1.1),
        a0: rnd(0.35, 0.8), a1: 0.9, max: rnd(1, 2),
        vr: rnd(-1, 1)
      });
    }
  }

  /* ---- 1. 腾空（整体抛物线跃起，第一版） ---- */
  function actHop() {
    if (running()) return;
    splash(0.42, 0.35);
    tween(0.4, (v) => {
      fx.wY = -view.H * 0.34 * v;
      fx.wRot = 0.05 * v;
      fx.wScale = 1 + 0.04 * v;
    }, { ease: E.cOut });
    tween(0.52, (v) => {
      fx.wY = -view.H * 0.34 * (1 - v);
      fx.wRot = 0.05 * (1 - v);
      fx.wScale = 1 + 0.04 * (1 - v);
    }, { delay: 0.4, ease: E.cIn, done: () => splash(0.7, 0.65) });
  }

  /* ---- 2. 海豚跳：抛物线跃起 + 前空翻一整圈，原位落回 ---- */
  function actDolphin() {
    if (running()) return;
    splash(0.55, 0.5);
    // 蓄力下压
    tween(0.2, (v) => {
      fx.wY = view.H * 0.035 * v;
      fx.wScale = 1 - 0.03 * v;
    }, { ease: E.cIn });
    // 抛物线：垂直上抛 + 整圈前空翻，落回原点
    tween(1.05, (v, p) => {
      const h = Math.sin(p * Math.PI);          // 0 → 1 → 0
      fx.wY = -view.H * 0.40 * h + view.H * 0.035 * (1 - p);
      fx.wRot = p * TAU;                        // 正好转一圈，落定时回正
      fx.wScale = 1 + h * 0.07 - 0.03 * (1 - p);
    }, { delay: 0.2, ease: E.lin, done: () => splash(1.05, 1.0) });
    tween(0.45, (v) => { fx.shake = 4 * Math.sin(v * Math.PI); }, { delay: 1.05 });
  }

  /* ---- 3. 转板：板绕自身转一圈，人轻弹 ---- */
  function actSpin() {
    if (running()) return;
    const m = slots.mount;
    if (!m.actor.model) return;
    splash(0.5, 0.55);
    tween(0.95, (v) => { fx.mRot = v * TAU; }, { ease: E.cInOut });
    tween(0.5, (v) => { fx.rY = -view.H * 0.05 * Math.sin(v * Math.PI); }, { ease: E.lin });
    tween(0.5, (v) => { fx.mY = -view.H * 0.05 * Math.sin(v * Math.PI); }, { ease: E.lin });
    tween(0.3, (v) => { fx.shake = 3 * (1 - v); }, { delay: 0.85, done: () => splash(0.55, 0.7) });
  }

  /* ---- 4. 人和板对调（弧线飞过，各自保持自己的大小旋转） ---- */
  // 对调的位移必须放在主循环最后应用，否则会被"随浪起伏"覆盖掉
  let swapAnim = null;

  function actSwap() {
    if (running()) return;
    const A = slots.mount, B = slots.rider;
    if (!A.actor.model || !B.actor.model) return;

    const a0 = { x: A.wrap.position.x, y: A.baseY };
    const b0 = { x: B.wrap.position.x, y: B.baseY };

    swapActors();

    // 交换后 wrap 里已经是对方的模型，先把它放回起点，再飞过去
    A.wrap.position.set(b0.x, b0.y);
    B.wrap.position.set(a0.x, a0.y);

    swapAnim = {
      p: 0, A: A, B: B,
      a0: a0, b0: b0,
      a1: { x: A.baseX, y: A.baseY },
      b1: { x: B.baseX, y: B.baseY },
      splashed: false
    };
    splash(0.5, 0.7);

    tween(1.0, (v, p) => { swapAnim.p = p; }, {
      ease: E.inOut,
      done: () => {
        swapAnim = null;
        layoutSlot(A); layoutSlot(B);
        splash(0.8, 0.95);
      }
    });
    tween(0.4, (v) => { fx.shake = 4 * (1 - v); }, { delay: 0.85 });
  }

  function swapActors() {
    const A = slots.mount, B = slots.rider;
    const ma = A.actor, ra = B.actor;

    // 摘掉两边的模型
    if (ma.model) A.wrap.removeChild(ma.model);
    if (ra.model) B.wrap.removeChild(ra.model);

    // 先把两边的状态整个快照下来（ma / ra 是同一个对象，不能边读边写）
    const snapA = Object.assign({}, ma);
    const snapB = Object.assign({}, ra);

    // 只把「模型本身」搬过去；sc / rot / ox / oy / flip / follow 属于位置，留在原地
    const KEYS = ['model', 'rawW', 'rawH', 'name', 'preset', 'url', 'expression', 'motion'];
    KEYS.forEach((k) => {
      ma[k] = snapB[k];
      ra[k] = snapA[k];
    });

    if (ma.model) A.wrap.addChild(ma.model);
    if (ra.model) B.wrap.addChild(ra.model);

    layoutSlot(A); layoutSlot(B);
    buildSlotUI('rider'); buildSlotUI('mount');
    refreshActionOptions();
    saveState();
  }

  /* ---- 5. 钻浪管：一道卷浪从右扫到左，把模型整个吞掉 ---- */
  function actTube() {
    if (running()) return;
    const W = view.W, H = view.H;
    const th = SEAS[scene.sea] || SEAS.day;

    const wW = W * 0.72;     // 浪宽
    const wH = H * 1.12;     // 浪高
    const wall = new PIXI.Graphics();
    const deep = PIXI.utils.string2hex(th.sea[2][1]);
    const lit = PIXI.utils.string2hex(th.sea[2][0]);

    // 卷唇曲线（浪顶 → 唇尖）
    const lip = () => {
      wall.moveTo(wW * 0.97, wH * 0.30);
      wall.bezierCurveTo(wW * 0.96, wH * 0.13, wW * 0.88, wH * 0.02, wW * 0.68, wH * 0.005);
      wall.bezierCurveTo(wW * 0.46, -wH * 0.012, wW * 0.26, wH * 0.05, wW * 0.135, wH * 0.155);
      wall.bezierCurveTo(wW * 0.055, wH * 0.225, wW * 0.065, wH * 0.30, wW * 0.145, wH * 0.335);
    };

    // 1) 浪体：右下 → 沿右缘上升 → 卷顶 → 唇尖 → 唇内回卷 → 管腔 → 回右下
    wall.beginFill(deep, 0.97);
    wall.moveTo(wW, wH);
    wall.lineTo(wW * 0.97, wH * 0.30);
    wall.bezierCurveTo(wW * 0.96, wH * 0.13, wW * 0.88, wH * 0.02, wW * 0.68, wH * 0.005);
    wall.bezierCurveTo(wW * 0.46, -wH * 0.012, wW * 0.26, wH * 0.05, wW * 0.135, wH * 0.155);
    wall.bezierCurveTo(wW * 0.055, wH * 0.225, wW * 0.065, wH * 0.30, wW * 0.145, wH * 0.335);
    wall.bezierCurveTo(wW * 0.27, wH * 0.375, wW * 0.40, wH * 0.30, wW * 0.50, wH * 0.365);
    wall.bezierCurveTo(wW * 0.62, wH * 0.445, wW * 0.665, wH * 0.62, wW * 0.70, wH * 0.84);
    wall.lineTo(wW, wH);
    wall.closePath();
    wall.endFill();

    // 2) 浪壁受光面（浅色，收在里面一点）
    wall.beginFill(lit, 0.5);
    wall.moveTo(wW * 0.74, wH * 0.87);
    wall.bezierCurveTo(wW * 0.70, wH * 0.63, wW * 0.68, wH * 0.46, wW * 0.575, wH * 0.365);
    wall.bezierCurveTo(wW * 0.50, wH * 0.30, wW * 0.42, wH * 0.315, wW * 0.35, wH * 0.315);
    wall.bezierCurveTo(wW * 0.47, wH * 0.245, wW * 0.63, wH * 0.235, wW * 0.755, wH * 0.31);
    wall.bezierCurveTo(wW * 0.875, wH * 0.40, wW * 0.91, wH * 0.64, wW * 0.93, wH * 0.90);
    wall.lineTo(wW * 0.74, wH * 0.87);
    wall.closePath();
    wall.endFill();

    // 3) 管腔内部（透过浪看到的光）
    wall.beginFill(0xffffff, 0.16);
    wall.moveTo(wW * 0.18, wH * 0.335);
    wall.bezierCurveTo(wW * 0.30, wH * 0.40, wW * 0.42, wH * 0.34, wW * 0.52, wH * 0.40);
    wall.bezierCurveTo(wW * 0.60, wH * 0.46, wW * 0.63, wH * 0.56, wW * 0.65, wH * 0.66);
    wall.bezierCurveTo(wW * 0.56, wH * 0.52, wW * 0.44, wH * 0.42, wW * 0.30, wH * 0.40);
    wall.closePath();
    wall.endFill();

    // 4) 浪唇白边
    wall.lineStyle(Math.max(3, H * 0.013), 0xffffff, 0.85);
    lip();
    wall.lineStyle(0);

    // 5) 浪壁上的水痕
    wall.lineStyle(Math.max(1.2, H * 0.0045), 0xffffff, 0.28);
    for (let k = 0; k < 5; k++) {
      const t = k / 5;
      wall.moveTo(wW * (0.82 + t * 0.12), wH * (0.92 - t * 0.02));
      wall.bezierCurveTo(wW * (0.80 + t * 0.12), wH * 0.62,
        wW * (0.76 + t * 0.11), wH * 0.36,
        wW * (0.62 + t * 0.10), wH * (0.20 - t * 0.05));
    }
    wall.lineStyle(0);

    // 6) 唇上泡沫
    wall.beginFill(0xffffff, 0.82);
    for (let i = 0; i < 30; i++) {
      const t = Math.pow(i / 30, 0.65);
      const px = wW * (0.135 + (1 - t) * 0.58) + rnd(-6, 6);
      const py = wH * (0.155 - t * 0.145) + rnd(-7, 7);
      wall.drawCircle(px, py, H * rnd(0.0035, 0.0105));
    }
    wall.endFill();

    wall.alpha = 0;
    wall.y = H * 0.02;
    wall.x = W * 1.3;
    fxFront.addChild(wall);

    const startX = W * 1.3, endX = -wW * 1.06;
    tween(1.5, (v, p) => {
      wall.x = startX + (endX - startX) * v;
      wall.y = H * 0.02 - Math.sin(p * Math.PI) * H * 0.015;
      wall.alpha = Math.min(1, p / 0.1) * (1 - Math.max(0, (p - 0.86) / 0.14));
      fx.wX = -W * 0.045 * Math.sin(p * Math.PI);
    }, {
      ease: E.lin,
      done: () => { fxFront.removeChild(wall); wall.destroy(); }
    });

    // 模型被浪吞掉：下潜 + 缩小
    tween(1.5, (v, p) => {
      fx.wY = Math.sin(p * Math.PI) * H * 0.055;
      fx.wScale = 1 - Math.sin(p * Math.PI) * 0.05;
    }, { ease: E.lin });

    tween(0.01, () => { }, { delay: 0.6, done: () => splash(1.4, 1.4) });
    tween(0.7, (v) => { fx.shake = 6 * (1 - v); }, { delay: 0.55 });
  }

  /* ---- 6. 潜水：沉下去 + 气泡，再冲出来 ---- */
  function actDive() {
    if (running()) return;
    const W = view.W, H = view.H;
    const m = slots.mount;
    const cx = m.actor.model ? m.wrap.position.x : W * 0.5;
    const cy = m.actor.model ? m.wrap.position.y : H * 0.63;

    tween(0.5, (v) => {
      fx.wY = H * 0.22 * v;
      fx.wScale = 1 - 0.08 * v;
    }, { ease: E.cIn });
    tween(0.42, (v) => { fx.wY = H * 0.22; fx.wScale = 0.92; bubbles(cx, cy, 5, W * 0.08); }, { delay: 0.5 });
    tween(0.75, (v) => {
      fx.wY = H * 0.22 * (1 - v * v);
      fx.wScale = 0.92 + 0.08 * v;
    }, { delay: 0.92, ease: E.cOut, done: () => { splash(1.25, 1.15); bubbles(cx, cy, 18, W * 0.16); } });
    tween(0.8, (v) => { fx.shake = 5 * Math.sin(v * Math.PI); }, { delay: 1.1 });
  }

  /* ---- 7. 加速冲刺：加速冲出屏幕，从另一侧滑回来 ---- */
  function actDash() {
    if (running()) return;
    const W = view.W, H = view.H;
    splash(0.45, 0.4);
    tween(2.2, (v, p) => {
      if (p < 0.34) {
        // 1) 加速冲出右侧
        const q = p / 0.34;
        fx.wX = W * 1.5 * (q * q);
        fx.boost = q;
        fx.shake = 4.5 * q;
        fx.wScale = 1 + 0.06 * q;
      } else if (p < 0.44) {
        // 2) 屏幕外瞬移换边
        fx.wX = -W * 1.5;
        fx.boost = 1;
        fx.shake = 4.5;
      } else {
        // 3) 从左侧减速滑回
        const q = (p - 0.44) / 0.56;
        fx.wX = -W * 1.5 * (1 - E.cOut(q));
        fx.boost = 1 - q * 0.85;
        fx.shake = 4.5 * (1 - q);
        fx.wScale = 1 + 0.06 * (1 - q);
      }
    }, {
      ease: E.lin,
      done: () => { splash(1.0, 1.1); }
    });
  }

  /* ---- 8. 旋风：各自绕自身中心转两圈（不绕屏幕中心，才不会飞出画面） ---- */
  function actCyclone() {
    if (running()) return;
    const W = view.W, H = view.H;
    tween(1.5, (v, p) => {
      const e = E.cInOut(v);
      fx.mRot = e * TAU * 2;
      fx.rRot = Math.max(0, (e - 0.06) / 0.94) * TAU * 2;   // 人稍滞后一点
      fx.wY = -Math.sin(p * Math.PI) * H * 0.05;
      fx.wScale = 1 - Math.sin(p * Math.PI) * 0.05;
      fx.shake = 1.6 * Math.sin(p * Math.PI);
    }, { done: () => splash(0.75, 1) });

    // 绕中心甩出的漩涡飞沫
    for (let k = 0; k < 6; k++) {
      tween(0.01, () => {
        const ang = Math.random() * TAU;
        for (let i = 0; i < 3; i++) {
          spawn({
            x: W * 0.5 + Math.cos(ang) * W * 0.16,
            y: H * 0.5 + Math.sin(ang) * H * 0.08,
            vx: Math.cos(ang) * rnd(130, 260),
            vy: -rnd(70, 220),
            grav: 640, tex: T.spray(),
            s0: rnd(0.2, 0.45), s1: rnd(0.6, 1.2), a0: 0.7, max: rnd(0.5, 1)
          });
        }
      }, { delay: 0.15 + k * 0.22 });
    }
  }

  /* ---- 9. 高光时刻：背景压暗 + 追光 + 镜头推进特写 ---- */
  function actGlory() {
    if (running()) return;
    const W = view.W, H = view.H;
    // 焦点定在冲浪者身上（不是画面中心），这样推近才是"特写"
    const focX = W * 0.5, focY = H * 0.46;
    const setF = () => { fx.focus.x = focX; fx.focus.y = focY; };

    tween(0.5, (v) => { fx.dark = 0.7 * v; setF(); }, { ease: E.cOut });
    tween(0.9, (v) => { fx.spot = v; setF(); }, { delay: 0.12, ease: E.back });
    tween(0.22, (v) => { fx.flash = 0.45 * (1 - v); setF(); }, { delay: 0.15 });
    // 镜头推近
    tween(0.85, (v) => { fx.wScale = 1 + 0.34 * E.cOut(v); setF(); }, { delay: 0.25, ease: E.lin });
    tween(0.35, (v) => { fx.shake = 2.2 * Math.sin(v * Math.PI); setF(); }, { delay: 0.25 });
    // 停留
    tween(0.9, () => { setF(); }, { delay: 1.1 });
    // 拉回
    tween(0.7, (v) => {
      fx.dark = 0.7 * (1 - v);
      fx.spot = 1 - v;
      fx.wScale = 1.34 - 0.34 * E.cInOut(v);
      setF();
    }, { delay: 2.0, ease: E.lin });
  }

  /* ---- 10. 炸水花 ---- */
  function actSplash() {
    if (running()) return;
    splash(1.45, 1.15);
    tween(0.45, (v) => { fx.shake = 6 * (1 - v); }, { ease: E.cOut });
  }

  const ACTIONS = {
    hop: actHop, dolphin: actDolphin, spin: actSpin, swap: actSwap,
    tube: actTube, dive: actDive, dash: actDash, cyclone: actCyclone,
    glory: actGlory, splash: actSplash
  };

  /* ================= 动作面板 ================= */

  function actionTarget() {
    const sel = $('#act-target');
    return slots[(sel && sel.value) || 'rider'] || slots.rider;
  }

  function refreshActionOptions() {
    const t = actionTarget();
    const exprSel = $('#act-expr'), motSel = $('#act-motion');
    if (!exprSel || !motSel) return;
    exprSel.innerHTML = '<option value="">（不改）</option>';
    motSel.innerHTML = '<option value="">（选一个）</option>';
    const a = t.actor;
    if (!a.model) return;
    const im = a.model.internalModel;
    const exps = (im.settings && im.settings.expressions) || [];
    const seen = {};
    exps.forEach((x) => {
      const n = x.Name || (x.File || '').replace(/^.*\//, '').replace(/\.exp3\.json$/, '');
      if (!n || seen[n]) return;
      seen[n] = 1;
      exprSel.insertAdjacentHTML('beforeend', `<option value="${n}">${n}</option>`);
    });
    const defs = (im.motionManager && im.motionManager.definitions) || {};
    Object.keys(defs).forEach((g) => {
      motSel.insertAdjacentHTML('beforeend', `<option value="${g}">${g}</option>`);
    });
    exprSel.value = a.expression || '';
    motSel.value = a.motion || '';
  }

  function bindActionUI() {
    $$('[data-act]').forEach((btn) => {
      btn.onclick = () => {
        const fn = ACTIONS[btn.dataset.act];
        if (fn) fn();
      };
    });
    const target = $('#act-target');
    if (target) target.onchange = refreshActionOptions;

    const goExpr = $('#act-expr-go');
    if (goExpr) goExpr.onclick = () => {
      const t = actionTarget();
      if (!t.actor.model) { toast('那边还没有模型'); return; }
      const v = $('#act-expr').value;
      if (!v) return;
      t.actor.expression = v;
      try { t.actor.model.expression(v); } catch (e) { toast('这个表情播不了'); }
      saveState();
    };
    const goMotion = $('#act-motion-go');
    if (goMotion) goMotion.onclick = () => {
      const t = actionTarget();
      if (!t.actor.model) { toast('那边还没有模型'); return; }
      const v = $('#act-motion').value;
      if (!v) return;
      t.actor.motion = v;
      try { t.actor.model.motion(v, 0, live2d.MotionPriority ? live2d.MotionPriority.FORCE : 3); }
      catch (e) { toast('这个动作播不了'); }
      saveState();
    };
    const rnd = $('#act-rand');
    if (rnd) rnd.onclick = () => pokedSlot(actionTarget().key);
    refreshActionOptions();
  }

  // 戳模型：随机动作 + 随机表情（无提示）
  function pokedSlot(key) {
    const a = slots[key].actor;
    if (!a.model) return;
    const im = a.model.internalModel;
    const exps = (im.settings && im.settings.expressions) || [];
    const defs = (im.motionManager && im.motionManager.definitions) || {};
    const groups = Object.keys(defs);
    if (groups.length) {
      try {
        a.model.motion(groups[Math.floor(Math.random() * groups.length)], 0,
          live2d.MotionPriority ? live2d.MotionPriority.FORCE : 3);
      } catch (e) { }
    }
    if (exps.length) {
      const n = exps[Math.floor(Math.random() * exps.length)].Name;
      if (n) { try { a.model.expression(n); } catch (e) { } }
    }
  }

  /* ================= 海况面板 ================= */

  function bindSeaUI() {
    const bind = (id, field) => {
      const el = $('#' + id);
      const out = $('#' + id + '-o');
      if (!el) return;
      el.value = scene[field];
      if (out) out.textContent = scene[field];
      el.oninput = () => {
        scene[field] = parseFloat(el.value);
        if (out) out.textContent = el.value;
        if (field === 'gap') { layoutSlot(slots.rider); layoutSlot(slots.mount); }
      };
      el.onchange = saveState;
    };
    bind('wave', 'wave');
    bind('speed', 'speed');
    bind('sway', 'sway');
    bind('gap', 'gap');

    const sea = $('#sea');
    if (sea) {
      sea.value = scene.sea;
      sea.onchange = () => { scene.sea = sea.value; buildScene(); saveState(); };
    }
    ['scroll', 'lines', 'spray', 'trail', 'reflect'].forEach((k) => {
      const el = $('#opt-' + k);
      if (!el) return;
      el.checked = !!scene[k];
      el.onchange = () => { scene[k] = el.checked; saveState(); };
    });
    const lr = $('#opt-lowres');
    if (lr) {
      lr.checked = !!scene.lowRes;
      lr.onchange = () => { scene.lowRes = lr.checked; applyResolution(); saveState(); };
    }
    const reset = $('#btn-reset-scene');
    if (reset) {
      reset.onclick = () => {
        Object.assign(scene, SCENE_DEFAULT);
        bindSeaUI(); buildScene();
        layoutSlot(slots.rider); layoutSlot(slots.mount);
        saveState();
      };
    }
  }

  function applyResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    app.renderer.resolution = scene.lowRes ? 1 : dpr;
    onResize();
  }

  /* ================= BGM ================= */

  const bgm = {
    tracks: [], cur: -1,
    audio: new Audio(),
    ctx: null, src: null, analyser: null, freq: null,
    beat: 0, level: 0, ready: false
  };
  bgm.audio.loop = true;

  function initAudioGraph() {
    if (bgm.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      bgm.ctx = new AC();
      bgm.src = bgm.ctx.createMediaElementSource(bgm.audio);
      bgm.analyser = bgm.ctx.createAnalyser();
      bgm.analyser.fftSize = 512;
      bgm.analyser.smoothingTimeConstant = 0.75;
      bgm.freq = new Uint8Array(bgm.analyser.frequencyBinCount);
      bgm.src.connect(bgm.analyser);
      bgm.analyser.connect(bgm.ctx.destination);
      bgm.ready = true;
    } catch (e) { console.warn('音频分析不可用', e); }
  }

  function bgmAddFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /^audio\//.test(f.type) || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name));
    if (!files.length) { toast('没认出音频文件'); return; }
    files.forEach((f) => {
      bgm.tracks.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) });
    });
    renderBgmList();
    if (bgm.cur < 0) bgmPlay(0);
  }

  function renderBgmList() {
    const box = $('#bgm-list');
    if (!box) return;
    if (!bgm.tracks.length) {
      box.innerHTML = '<div class="hint">还没有音乐。mp3 / m4a / wav / ogg / flac 都行。</div>';
      return;
    }
    box.innerHTML = bgm.tracks.map((t, i) =>
      `<div class="bgm-item${i === bgm.cur ? ' on' : ''}" data-i="${i}">
         <span class="bgm-name">${i === bgm.cur ? '♪ ' : ''}${t.name}</span>
         <button class="btn mini" data-del="${i}">×</button>
       </div>`).join('');
    $$('#bgm-list .bgm-item').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.dataset.del !== undefined) {
          const i = +e.target.dataset.del;
          bgm.tracks.splice(i, 1);
          if (i === bgm.cur) { bgm.audio.pause(); bgm.cur = -1; }
          else if (i < bgm.cur) bgm.cur--;
          renderBgmList();
          return;
        }
        bgmPlay(+el.dataset.i);
      };
    });
  }

  function bgmPlay(i) {
    if (!bgm.tracks.length) { toast('先上传一首音乐'); return; }
    const t = bgm.tracks[i];
    if (!t) return;
    initAudioGraph();
    bgm.cur = i;
    bgm.audio.src = t.url;
    const vol = $('#bgm-vol');
    bgm.audio.volume = vol ? (+vol.value) / 100 : 0.7;
    const loop = $('#bgm-loop');
    bgm.audio.loop = loop ? loop.checked : true;
    const p = bgm.audio.play();
    if (p && p.catch) p.catch(() => { toast('点一下播放按钮（浏览器要求手势）'); });
    if (bgm.ctx && bgm.ctx.state === 'suspended') bgm.ctx.resume();
    renderBgmList();
    updateBgmBtn();
  }

  function updateBgmBtn() {
    const b = $('#bgm-play');
    if (b) b.textContent = bgm.audio.paused ? '▶ 播放' : '❚❚ 暂停';
  }

  function bindBgmUI() {
    const file = $('#bgm-file');
    if (file) file.onchange = (e) => { bgmAddFiles(e.target.files); e.target.value = ''; };
    const play = $('#bgm-play');
    if (play) play.onclick = () => {
      if (!bgm.tracks.length) { toast('先上传一首音乐'); return; }
      if (bgm.cur < 0) { bgmPlay(0); return; }
      if (bgm.audio.paused) bgmPlay(bgm.cur);
      else { bgm.audio.pause(); updateBgmBtn(); }
    };
    const stop = $('#bgm-stop');
    if (stop) stop.onclick = () => { bgm.audio.pause(); bgm.audio.currentTime = 0; updateBgmBtn(); };
    const clr = $('#bgm-clear');
    if (clr) clr.onclick = () => { bgm.audio.pause(); bgm.cur = -1; bgm.tracks = []; renderBgmList(); updateBgmBtn(); };
    const vol = $('#bgm-vol'), volO = $('#bgm-vol-o');
    if (vol) vol.oninput = () => { bgm.audio.volume = (+vol.value) / 100; if (volO) volO.textContent = vol.value; };
    const loop = $('#bgm-loop');
    if (loop) loop.onchange = () => { bgm.audio.loop = loop.checked; };
    bgm.audio.addEventListener('play', updateBgmBtn);
    bgm.audio.addEventListener('pause', updateBgmBtn);
    renderBgmList();
    updateBgmBtn();
  }

  let beatTick = 0;
  function bgmBeat() {
    if (!bgm.ready || bgm.audio.paused) {
      bgm.beat += (0 - bgm.beat) * 0.08;
      return bgm.beat;
    }
    if (++beatTick % 3 !== 0) return bgm.beat;
    bgm.analyser.getByteFrequencyData(bgm.freq);
    const n = bgm.freq.length;
    let low = 0, cnt = 0;
    for (let i = 1; i < n * 0.35; i++) { low += bgm.freq[i]; cnt++; }
    low = low / Math.max(1, cnt) / 255;
    bgm.level = low;
    const target = clamp((low - 0.18) * 1.9, 0, 1);
    bgm.beat += (target - bgm.beat) * (target > bgm.beat ? 0.5 : 0.12);
    return bgm.beat;
  }

  /* ================= 拖拽 / 点击 ================= */

  let drag = null;

  function stagePoint(e) {
    const r = stageEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height };
  }

  stageEl.addEventListener('pointerdown', (e) => {
    if (running()) return;
    const p = stagePoint(e);
    for (const key of ['rider', 'mount']) {
      const s = slots[key];
      if (!s.actor.model) continue;
      try {
        if (s.actor.model.getBounds().contains(p.x, p.y)) {
          drag = { key: key, sx: p.x, sy: p.y, ox: s.actor.ox, oy: s.actor.oy, moved: false };
          if (stageEl.setPointerCapture) stageEl.setPointerCapture(e.pointerId);
          break;
        }
      } catch (err) { }
    }
  }, { passive: true });

  stageEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = stagePoint(e);
    const s = slots[drag.key];
    s.actor.ox = clamp(drag.ox + (p.x - drag.sx) / p.W * 100, -60, 60);
    s.actor.oy = clamp(drag.oy + (p.y - drag.sy) / p.H * 100, -60, 60);
    drag.moved = true;
    layoutSlot(s);
    syncSlotUI(drag.key);
  }, { passive: true });

  function endDrag() {
    if (drag) {
      if (drag.moved) saveState();
      else pokedSlot(drag.key);
    }
    drag = null;
  }
  stageEl.addEventListener('pointerup', endDrag);
  stageEl.addEventListener('pointercancel', endDrag);

  function syncSlotUI(key) {
    const pane = $(`[data-pane="${key}"]`);
    if (!pane) return;
    const a = slots[key].actor;
    const ox = $('.ox', pane), oy = $('.oy', pane);
    if (ox) { ox.value = Math.round(a.ox); ox.parentElement.querySelector('output').textContent = Math.round(a.ox); }
    if (oy) { oy.value = Math.round(a.oy); oy.parentElement.querySelector('output').textContent = Math.round(a.oy); }
  }

  /* ================= 顶栏 ================= */

  $('#btn-random').onclick = () => {
    if (!presetList.length) { toast('没有内置模型'); return; }
    if (running()) return;
    const pick = () => presetList[Math.floor(Math.random() * presetList.length)];
    let a = pick(), b = pick(), guard = 0;
    while (b.slug === a.slug && guard++ < 20) b = pick();
    slots.rider.actor.flip = Math.random() < 0.5;
    slots.mount.actor.flip = Math.random() < 0.5;
    ['rider', 'mount'].forEach((k) => {
      const ac = slots[k].actor;
      ac.ox = 0; ac.oy = 0;
      ac.sc = 100;
      ac.rot = SLOT_POS[k].baseRot;
    });
    scene.speed = 25 + Math.floor(Math.random() * 70);
    scene.wave = 15 + Math.floor(Math.random() * 75);
    scene.sway = 10 + Math.floor(Math.random() * 60);
    scene.sea = ['dawn', 'day', 'dusk', 'night', 'storm'][Math.floor(Math.random() * 5)];
    buildSlotUI('rider'); buildSlotUI('mount'); bindSeaUI(); buildScene();
    Promise.all([loadPreset('rider', a.slug), loadPreset('mount', b.slug)]);
  };

  $('#btn-shot').onclick = () => {
    try {
      const canvas = app.renderer.extract.canvas(app.stage);
      canvas.toBlob((blob) => {
        if (!blob) { toast('截图失败'); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'surf-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
      }, 'image/png');
    } catch (e) { toast('截图失败：' + e.message); }
  };

  $('#btn-share').onclick = () => {
    const data = { v: 2, rider: exportActor(slots.rider), mount: exportActor(slots.mount), scene: exportScene() };
    let hash = '';
    try { hash = btoa(unescape(encodeURIComponent(JSON.stringify(data)))); } catch (e) { }
    const url = location.origin + location.pathname + (hash ? '#' + hash : '');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => { }, () => { prompt('复制这个链接：', url); });
    } else { prompt('复制这个链接：', url); }
    if (hash) history.replaceState(null, '', '#' + hash);
  };

  function exportScene() {
    return {
      wave: scene.wave, speed: scene.speed, sway: scene.sway, gap: scene.gap, sea: scene.sea,
      scroll: scene.scroll, lines: scene.lines, spray: scene.spray,
      trail: scene.trail, reflect: scene.reflect, lowRes: scene.lowRes
    };
  }
  function exportActor(slot) {
    const a = slot.actor;
    return {
      preset: a.preset, sc: a.sc, ox: a.ox, oy: a.oy, rot: a.rot,
      flip: a.flip, follow: a.follow, expression: a.expression, motion: a.motion
    };
  }
  function saveState() {
    try {
      localStorage.setItem('l2dsurf.v2', JSON.stringify({
        rider: exportActor(slots.rider), mount: exportActor(slots.mount), scene: exportScene()
      }));
    } catch (e) { }
  }

  /* ================= 主循环 ================= */

  let phase = 0, beat = 0, trailAcc = 0, splashAcc = 0, critterAcc = 4;

  app.ticker.add(() => {
    const dt = Math.min(app.ticker.deltaMS, 50) / 1000;
    const W = view.W, H = view.H;
    const sp = scene.speed / 100;
    const wv = scene.wave / 100;

    beat = bgmBeat();
    const beatAmp = 1 + beat * 0.9;
    phase += dt * (0.5 + sp * 1.5) * TAU;

    // 冲刺时等效速度变快
    resetFx();
    updateTweens(dt);
    const eff = clamp(0.12 + Math.max(sp, fx.boost) * 0.88, 0, 1.35);

    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 6);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 6);

    const bob = H * 0.038 * wv * beatAmp;
    const swayRad = (scene.sway / 100) * 6.5 * (0.4 + eff * 0.6) * Math.PI / 180;
    const m = slots.mount, r = slots.rider;

    /* --- 模型随浪 --- */
    if (m.actor.model) {
      m.wrap.position.y = m.baseY + Math.sin(phase) * bob;
      m.wrap.rotation = m.baseRot + Math.sin(phase * 0.5 + 0.6) * swayRad * 0.7;
      if (m.actor.follow) try { m.actor.model.focus(pointer.x * W, pointer.y * H); } catch (e) { }
      if (scene.trail && eff > 0.15) {
        trailAcc += dt * (5 + eff * 22);
        while (trailAcc > 1) {
          trailAcc -= 1;
          spawn({
            x: m.wrap.position.x - m.k * m.rawW * 0.2,
            y: m.wrap.position.y + rnd(-5, 12),
            vx: -40 - eff * 150, vy: rnd(-16, 18), grav: 0,
            tex: T.foam(), s0: rnd(0.24, 0.5), s1: rnd(0.9, 1.8),
            a0: rnd(0.22, 0.5), max: rnd(0.5, 1.1)
          });
        }
      }
    }
    if (r.actor.model) {
      const lag = phase - 0.6;
      r.wrap.position.y = r.baseY + Math.sin(lag) * bob * 0.9 - bob * 0.32;
      const balance = Math.sin(phase * 1.7 + 1.2) * 2.2 + (eff - 0.5) * 5;
      r.wrap.rotation = r.baseRot + Math.sin(phase * 0.5 - 0.3) * swayRad + balance * Math.PI / 180;
      if (r.actor.follow) try { r.actor.model.focus(pointer.x * W, pointer.y * H); } catch (e) { }
    }

    /* --- 相机（绕画面中心轻晃 + 抖动） --- */
    const camR = Math.sin(phase * 0.35) * 0.006 * (1 + wv);
    const cx = W / 2, cy = H * 0.6;
    const jitterY = (Math.sin(phase * 1.3) + Math.sin(phase * 0.7)) * bob * 0.12;
    const shakeX = fx.shake ? rnd(-fx.shake, fx.shake) : 0;
    const shakeY = fx.shake ? rnd(-fx.shake, fx.shake) : 0;
    world.rotation = camR + fx.wRot;
    world.x = cx - (cx * Math.cos(camR) - cy * Math.sin(camR)) + fx.wX + shakeX;
    world.y = cy - (cx * Math.sin(camR) + cy * Math.cos(camR)) + jitterY + fx.wY + shakeY;
    world.pivot.set(0, 0);

    // 动作附加偏移（在常规动画之后叠加）
    if (m.actor.model) {
      m.wrap.position.y += fx.mY;
      m.wrap.rotation += fx.mRot;
    }
    if (r.actor.model) {
      r.wrap.position.y += fx.rY;
      r.wrap.rotation += fx.rRot;
    }
    if (fx.wScale !== 1) {
      world.scale.set(fx.wScale);
      // 以 fx.focus（默认画面中心）为不动点缩放，这样"推近"才是特写
      const fx0 = fx.focus.x || cx, fy0 = fx.focus.y || cy;
      world.x += fx0 - fx0 * fx.wScale;
      world.y += fy0 - fy0 * fx.wScale;
    } else {
      world.scale.set(1);
    }

    /* --- 对调动画：必须在常规动画之后覆盖，否则会被浪的起伏盖掉 --- */
    if (swapAnim) {
      const S = swapAnim;
      const p = S.p;
      const ev = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const arc = Math.sin(Math.PI * p);
      const A = S.A, B = S.B;
      A.wrap.x = S.b0.x + (S.a1.x - S.b0.x) * ev;
      A.wrap.y = S.b0.y + (S.a1.y - S.b0.y) * ev + arc * H * 0.18;
      A.wrap.rotation = A.baseRot - (1 - ev) * TAU;
      A.wrap.scale.set(A.k * (1 + arc * 0.08));
      B.wrap.x = S.a0.x + (S.b1.x - S.a0.x) * ev;
      B.wrap.y = S.a0.y + (S.b1.y - S.a0.y) * ev - arc * H * 0.24;
      B.wrap.rotation = B.baseRot + (1 - ev) * TAU;
      B.wrap.scale.set(B.k * (1 + arc * 0.08));
      if (!S.splashed && p > 0.45) { S.splashed = true; splash(0.65, 0.85); }
    } else {
      // 清一下可能被 swap 改过的缩放
      if (m.actor.model && m.wrap.scale.x !== m.k) m.wrap.scale.set(m.k);
      if (r.actor.model && r.wrap.scale.x !== r.k) r.wrap.scale.set(r.k);
    }

    /* --- 随机浪花 --- */
    if (scene.spray) {
      splashAcc += dt * (0.32 + wv * 1.25 + eff * 0.75) * beatAmp;
      if (splashAcc > 1) {
        splashAcc = 0;
        const n = 5 + Math.round(wv * 8);
        const sx = W * rnd(0.05, 0.95), sy = H * rnd(0.62, 0.86);
        for (let i = 0; i < n; i++) {
          spawn({
            x: sx, y: sy,
            vx: rnd(-90, 90), vy: rnd(-270, -90) * (1 + wv),
            grav: 620,
            tex: Math.random() < 0.35 ? T.spray() : T.foam(),
            s0: rnd(0.2, 0.5), s1: rnd(0.7, 1.6), a0: rnd(0.28, 0.62), max: rnd(0.6, 1.35)
          });
        }
      }
    }

    /* --- 路过的小鱼 / 海鸥 --- */
    critterAcc -= dt;
    if (critterAcc <= 0) {
      critterAcc = rnd(5, 11);
      const isFish = Math.random() < 0.6;
      spawn({
        x: isFish ? rnd(W * 0.1, W * 0.9) : -40,
        y: isFish ? H * rnd(0.64, 0.82) : H * rnd(0.1, 0.35),
        vx: isFish ? rnd(-30, 30) : rnd(90, 180),
        vy: isFish ? rnd(-160, -80) : rnd(-10, 10),
        grav: isFish ? 300 : 0,
        tex: isFish ? T.fish() : T.bird(),
        s0: 0.36, s1: 0.4, a0: 0.95, max: isFish ? 1.4 : 3.2,
        rot: isFish ? rnd(-0.6, 0.6) : 0,
        vr: isFish ? rnd(-2, 2) : 0
      });
    }

    /* --- 海面 --- */
    updateWaveMeshes(phase);
    const t = phase / TAU;
    for (let i = 0; i < 3; i++) {
      const tt = water.tiling[i];
      if (!tt) continue;
      if (scene.scroll) {
        tt.tilePosition.x -= (6 + i * 22 + eff * (28 + i * 90)) * dt;
        tt.tilePosition.y = Math.sin(t * TAU * (0.3 + i * 0.12)) * 3;
      }
    }
    if (water.refl) {
      water.refl.alpha = scene.reflect ? 0.2 + beat * 0.2 + Math.sin(t * TAU * 1.7) * 0.05 : 0;
      water.refl.width = W * (0.26 + wv * 0.1 + Math.sin(t * TAU * 0.8) * 0.02);
      water.refl.x = W * (SEAS[scene.sea] || SEAS.day).sunX + Math.sin(t * TAU * 0.6) * W * 0.01;
    }
    if (bg.lines && scene.lines) bg.lines.tilePosition.x -= (60 + eff * 900) * dt;

    /* --- 特效覆盖层 --- */
    darkMask.width = W; darkMask.height = H;
    darkMask.alpha = fx.dark;
    if (fx.spot > 0.01) {
      spotLight.texture = T.glow();
      spotLight.position.set(cx, H * 0.45);
      spotLight.width = spotLight.height = Math.max(W, H) * (0.7 + fx.spot * 0.6);
      spotLight.alpha = fx.spot * 0.4;
      spotLight.tint = 0xfff0c0;
    } else {
      spotLight.alpha = 0;
    }

    updateParticles(dt);
  });

  /* ================= 启动 ================= */

  function applyActor(slot, c) {
    if (!c) return;
    const a = slot.actor;
    ['sc', 'ox', 'oy', 'rot', 'flip', 'follow', 'preset', 'expression', 'motion'].forEach((k) => {
      if (c[k] !== undefined) a[k] = c[k];
    });
  }

  function bootFromHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return null;
    try {
      const d = JSON.parse(decodeURIComponent(escape(atob(h))));
      if (!d || (d.v !== 2 && d.v !== 1)) return null;
      applyActor(slots.rider, d.rider);
      applyActor(slots.mount, d.mount);
      if (d.scene) Object.assign(scene, d.scene);
      return d;
    } catch (e) { return null; }
  }

  function bootFromLocal() {
    try {
      const d = JSON.parse(localStorage.getItem('l2dsurf.v2') || 'null');
      if (!d) return null;
      applyActor(slots.rider, d.rider);
      applyActor(slots.mount, d.mount);
      if (d.scene) Object.assign(scene, d.scene);
      return d;
    } catch (e) { return null; }
  }

  function syncUIFromCfg(key) {
    const pane = $(`[data-pane="${key}"]`);
    if (!pane) return;
    const a = slots[key].actor;
    const set = (sel, val) => { const el = $(sel, pane); if (el) el.value = val; };
    set('.sc', a.sc); set('.ox', a.ox); set('.oy', a.oy); set('.rot', a.rot);
    const flip = $('.flip', pane); if (flip) flip.checked = !!a.flip;
    const fol = $('.follow', pane); if (fol) fol.checked = !!a.follow;
    $$('.row', pane).forEach((row) => {
      const inp = row.querySelector('input[type=range]');
      const out = row.querySelector('output');
      if (inp && out) out.textContent = inp.value;
    });
  }

  async function boot() {
    setStatus('读取模型列表…');
    if (window.__EMBED__ && window.__EMBED__.index) {
      presetList = window.__EMBED__.index;      // 单文件版
    } else {
      try { presetList = await (await fetch('models/index.json')).json(); }
      catch (e) { presetList = []; }
    }
    if (!presetList.length) {
      setStatus('models/index.json 没读到（tools/fetch_sakiko.py 可以抓模型）', true);
      setTimeout(() => setStatus(''), 5000);
    }

    buildSlotUI('rider');
    buildSlotUI('mount');
    bindTabs();
    bindSeaUI();
    bindBgmUI();
    bindActionUI();
    buildScene();

    const restored = bootFromHash() || (!location.hash ? bootFromLocal() : null);
    if (restored) {
      syncUIFromCfg('rider'); syncUIFromCfg('mount');
      buildScene(); bindSeaUI();
    }

    watchResize();
    if (scene.lowRes) applyResolution();

    const has = (slug) => slug && presetList.some((x) => x.slug === slug);
    const rp = has(slots.rider.actor.preset) ? slots.rider.actor.preset
      : (has(DEFAULTS.rider) ? DEFAULTS.rider : (presetList[0] && presetList[0].slug));
    const mp = has(slots.mount.actor.preset) ? slots.mount.actor.preset
      : (has(DEFAULTS.mount) ? DEFAULTS.mount : ((presetList[1] && presetList[1].slug) || rp));

    const jobs = [];
    if (rp) jobs.push(loadPreset('rider', rp));
    if (mp) jobs.push(loadPreset('mount', mp));
    await Promise.all(jobs);
    setStatus('');
    onResize();
  }

  let rTimer = 0;
  function onResize() {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
      measure();
      const res = app.renderer.resolution;
      if (Math.round(app.renderer.width / res) !== view.W || Math.round(app.renderer.height / res) !== view.H) {
        app.renderer.resize(view.W, view.H);
      }
      buildScene();
      layoutSlot(slots.rider);
      layoutSlot(slots.mount);
    }, 90);
  }

  function watchResize() {
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe(stageEl);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (app.ticker.started) app.ticker.stop(); }
      else if (!app.ticker.started) app.ticker.start();
    });
  }

  if (!Live2DModel) {
    setStatus('Live2D 运行库没加载出来（vendor/ 里的文件看看在不在）', true);
    return;
  }

  window.__ride = {
    app: app, slots: slots, scene: scene, live2d: live2d,
    loadPreset: loadPreset, layoutSlot: layoutSlot, particles: P, spawn: spawn,
    bgm: bgm, splash: splash, actions: ACTIONS,
    swapActors: swapActors, buildScene: buildScene, poked: pokedSlot,
    tweens: tw, water: water
  };

  boot();
})();