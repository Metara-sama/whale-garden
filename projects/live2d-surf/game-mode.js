/* ==========================================================
   谁在冲浪 · 跑酷模式（game-mode.js）
   ----------------------------------------------------------
   挂在 app.js 后面，复用它的 PIXI app / 两个 Live2D 模型 / 海面场景，
   把「角色展示页」原地切成跑酷游戏。
   · 顶栏 + 控制面板无缝收起
   · 当前选中的冲浪者 + 冲浪板直接当玩家
   · 沿用当前海况，并且游戏过程中会自己变天
   ========================================================== */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const TAU = Math.PI * 2;

  /* ================= 状态 ================= */
  const GM = {
    on: false,
    phase: 'idle',          // idle | run | over
    score: 0, dist: 0, speed: 1,
    jumpY: 0, vy: 0, onGround: true,
    dive: 0, diveHold: 0, diving: false, tilt: 0,
    dead: false, deadT: 0,
    obstacles: [],
    spawnT: 2,
    weatherT: 20,
    best: 0,
    shake: 0,
    baseSeaSpeed: 50
  };
  try { GM.best = parseInt(localStorage.getItem('surfdash.best') || '0', 10) || 0; } catch (e) { }

  /* ================= 障碍纹理 ================= */
  const texCache = {};
  function tex(key, w, h, draw) {
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    texCache[key] = PIXI.Texture.from(c);
    return texCache[key];
  }

  function obsTexture(kind) {
    if (kind === 'rock') {
      return tex('gm_rock', 120, 120, (g, w, h) => {
        g.fillStyle = '#28323d';
        g.beginPath();
        g.moveTo(8, h - 2); g.lineTo(26, 32); g.lineTo(56, 12);
        g.lineTo(90, 38); g.lineTo(110, h - 2); g.closePath(); g.fill();
        g.fillStyle = '#44535f';
        g.beginPath();
        g.moveTo(26, 32); g.lineTo(56, 12); g.lineTo(64, 50); g.lineTo(38, 58); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.moveTo(8, h - 2); g.lineTo(26, 32); g.lineTo(33, h - 2); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath(); g.ellipse(58, h - 6, 46, 7, 0, 0, TAU); g.fill();
      });
    }
    if (kind === 'log') {
      return tex('gm_log', 140, 64, (g, w, h) => {
        g.fillStyle = '#553venue';
        g.fillStyle = '#553a24';
        g.beginPath(); g.roundRect ? g.roundRect(4, 16, w - 8, h - 30, 11) : g.rect(4, 16, w - 8, h - 30); g.fill();
        g.fillStyle = '#7d5535'; g.fillRect(12, 22, w - 24, 6);
        g.fillStyle = 'rgba(255,255,255,0.32)'; g.fillRect(12, 18, w - 24, 3);
        g.fillStyle = '#38230f'; g.beginPath(); g.arc(w - 15, h / 2 - 1, 11, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath(); g.ellipse(w / 2, h - 10, 58, 6, 0, 0, TAU); g.fill();
      });
    }
    if (kind === 'buoy') {
      return tex('gm_buoy', 72, 130, (g, w, h) => {
        g.fillStyle = '#d24b4b'; g.fillRect(19, 10, 34, h - 22);
        g.fillStyle = '#ffffff'; g.fillRect(19, 44, 34, 22);
        g.fillStyle = '#8e2b2b'; g.fillRect(19, h - 20, 34, 8);
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(23, 12, 6, h - 26);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath(); g.ellipse(w / 2, h - 6, 32, 6, 0, 0, TAU); g.fill();
      });
    }
    if (kind === 'gull') {
      return tex('gm_gull', 120, 84, (g, w, h) => {
        g.fillStyle = '#f6faff';
        g.beginPath();
        g.moveTo(6, 54); g.quadraticCurveTo(38, 6, 60, 44);
        g.quadraticCurveTo(82, 6, 114, 54);
        g.quadraticCurveTo(82, 34, 60, 60);
        g.quadraticCurveTo(38, 34, 6, 54);
        g.fill();
        g.fillStyle = '#e2a83a';
        g.beginPath(); g.moveTo(55, 48); g.lineTo(67, 53); g.lineTo(55, 58); g.fill();
      });
    }
    // jelly
    return tex('gm_jelly', 104, 124, (g, w, h) => {
      g.fillStyle = 'rgba(255,148,200,0.62)';
      g.beginPath(); g.arc(52, 42, 34, Math.PI, 0);
      g.lineTo(86, 58); g.lineTo(18, 58); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,180,222,0.62)'; g.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        const x = 24 + i * 14;
        g.beginPath(); g.moveTo(x, 58);
        g.quadraticCurveTo(x + 8, 82, x - 4, 108); g.stroke();
      }
    });
  }

  /* 障碍定义（参照 Chrome 小恐龙 Obstacle.types 的身高/间距比例）
     · 玩家视觉身高 ≈ 0.156H
     · 地面类高度 = 0.74~1.06 倍身高（小仙人掌 / 大仙人掌）
     · 空中类悬在水面上方，必须下潜
     碰撞盒顶/底（站水面上沿 = 0.74H）：
       站立 top 0.603H  bottom 0.767H
       下潜 top 0.688H  bottom 0.767H（只变矮，不下移 → 石头照样撞） */
  const DEF = {
    rock: { w: 0.145, h: 0.115, yOff: -0.010, need: 'jump' },
    log: { w: 0.200, h: 0.075, yOff: -0.005, need: 'jump' },
    buoy: { w: 0.070, h: 0.165, yOff: -0.025, need: 'jump' },
    gull: { w: 0.170, h: 0.130, yOff: -0.075, need: 'dive' },
    jelly: { w: 0.110, h: 0.150, yOff: -0.085, need: 'dive' }
  };
  const JUMP_KINDS = ['rock', 'log', 'buoy'];
  const DIVE_KINDS = ['gull', 'jelly'];

  /* ================= 运行时引用 ================= */
  let R = null;             // window.__ride
  let obsLayer = null;      // 障碍物层（插在 models 之前）
  let board0 = null;        // 玩家基准线

  function ready() {
    return !!(R && R.app && R.slots && R.slots.mount.actor.model);
  }

  function viewSize() {
    const W = R.app.screen.width || 1;
    const H = R.app.screen.height || 1;
    return { W, H };
  }

  /* 玩家（人+板整体）的几何：x 固定，y 由跳跃/下潜驱动
     dive 视觉下沉 0.09H（碰撞盒只下移 0.085H 的"顶部"，见 playerBox） */
  function playerGeom() {
    const { W, H } = viewSize();
    const px = W * 0.235;
    const baseY = H * 0.74 + GM.jumpY + GM.dive * H * 0.09;
    return { px, baseY, W, H };
  }

  function playerBox() {
    const { px, H, W } = viewSize();
    const px0 = W * 0.235;
    const baseY0 = H * 0.74 + GM.jumpY;      // 不含下潜
    const cy = baseY0 - H * 0.055;
    const hh = H * 0.082;
    const hw = Math.max(14, Math.min(W, H) * 0.048);
    // 下潜：只把顶部往下压（身高变矮），底部不动
    const diveTop = GM.dive * H * 0.085;
    return { l: px0 - hw, r: px0 + hw, t: cy - hh + diveTop, b: cy + hh };
  }

  /* ================= 障碍物 ================= */
  function ensureLayer() {
    if (obsLayer) return;
    const world = R.slots.mount.wrap.parent;
    obsLayer = new PIXI.Container();
    const idx = R.app.stage.getChildIndex(world);
    R.app.stage.addChildAt(obsLayer, idx);
  }

  function spawnObstacle(forceKind) {
    const { W, H } = viewSize();
    const kind = forceKind || (Math.random() < 0.62 ? pick(JUMP_KINDS) : pick(DIVE_KINDS));
    const d = DEF[kind];
    const S = Math.min(W, H);
    const ow = S * d.w, oh = H * d.h;
    const sp = new PIXI.Sprite(obsTexture(kind));
    sp.anchor.set(0.5, 1);
    sp.width = ow; sp.height = oh;
    sp.x = W + ow;
    sp.y = H * 0.74 + H * d.yOff;
    sp.zIndex = 1;
    obsLayer.addChild(sp);
    const o = {
      kind, sp, need: d.need,
      w: ow * 0.82, h: oh * 0.9,
      x: sp.x, cy: sp.y - oh / 2,
      passed: false
    };
    GM.obstacles.push(o);
    return o;
  }

  function clearObstacles() {
    GM.obstacles.forEach((o) => o.sp.destroy());
    GM.obstacles.length = 0;
  }

  function updateObstacles(dt) {
    const { W, H } = viewSize();
    const px = GM.speed * Math.min(W, H) * 0.62;
    const { px: ppx } = playerGeom();
    for (let i = GM.obstacles.length - 1; i >= 0; i--) {
      const o = GM.obstacles[i];
      o.sp.x -= px * dt;
      o.x = o.sp.x;
      if (o.sp.x < -o.w * 2.5) {
        o.sp.destroy();
        GM.obstacles.splice(i, 1);
        continue;
      }
      if (!o.passed && o.sp.x < ppx) {
        o.passed = true;
        GM.score += 10;
      }
    }
  }

  /* ================= 跳跃 / 下潜 ================= */
  /* 跳跃：照搬 Chrome 小恐龙的比例
     · 滞空 0.556s（那边 33 帧 @60fps，重力 0.6/frame²、初速 -10/frame）
     · 跳高 ≈ 1.77 倍玩家身高 ≈ 0.276H
     · v0 = 4h/T，g = 2v0/T */
  function jumpV() {
    const { H } = viewSize();
    return -4 * (H * 0.300) / 0.68;
  }
  function jumpGrav() {
    const { H } = viewSize();
    return 2 * (4 * (H * 0.300) / 0.68) / 0.68;
  }

  function doJump() {
    if (GM.phase !== 'run' || GM.dead) return;
    if (!GM.onGround) return;
    GM.vy = jumpV();
    GM.onGround = false;
    GM.diving = false;
    GM.diveHold = 0;          // 起跳立即结束下潜，否则碰撞盒顶部还被压着
    splashAt(3, 0.6);
  }

  /* 下潜：一次手势 = 一整次下潜（0.55s → 前后插值后完全潜下约 0.4s），
     松手只提前收尾，不立刻浮起 */
  const DIVE_HOLD = 0.60;
  function diveStart() {
    if (GM.phase !== 'run' || GM.dead) return;
    if (GM.jumpY < -viewSize().H * 0.02) return;      // 空中不下潜
    GM.diveHold = DIVE_HOLD;
    GM.diving = true;
    if (GM.onGround) splashAt(2, 0.4);
  }
  function diveEnd() {
    // 松手：把剩余时间压到 0.12s，自然浮起（不瞬浮）
    if (GM.diveHold > 0.12) GM.diveHold = 0.12;
  }

  function splashAt(n, power) {
    if (!R.spawn) return;
    const { px, baseY, W, H } = playerGeom();
    for (let i = 0; i < n; i++) {
      R.spawn({
        x: px + rnd(-W * 0.03, W * 0.03),
        y: baseY + H * 0.03,
        vx: rnd(-170, 40), vy: rnd(-300, -100) * power,
        grav: 1100,
        tex: R.T && R.T.foam ? R.T.foam() : undefined,
        s0: rnd(0.14, 0.28), s1: rnd(0.35, 0.8),
        a0: rnd(0.5, 0.9), max: rnd(0.4, 0.8)
      });
    }
  }

  /* ================= 模型 / 场景 ================= */
  function applyModels() {
    if (GM.phase === 'over') return;   // 死亡翻滚动画期间不要覆盖
    const { W, H } = viewSize();
    const { px, baseY } = playerGeom();
    const m = R.slots.mount, r = R.slots.rider;
    const S = 0.46;
    const diveA = 1 - GM.dive * 0.35;

    if (m.actor.model) {
      m.wrap.position.set(px, baseY + Math.sin(performance.now() / 420) * H * 0.004);
      m.wrap.rotation = m.baseRot + GM.tilt * 0.6;
      m.wrap.scale.set(m.k * S);
      m.wrap.alpha = diveA;
      try { m.actor.model.focus(W * 0.96, H * 0.45); } catch (e) { }
    }
    if (r.actor.model) {
      r.wrap.position.set(px, baseY - H * 0.085 + Math.sin(performance.now() / 460 + 1) * H * 0.004);
      r.wrap.rotation = r.baseRot + GM.tilt;
      r.wrap.scale.set(r.k * S);
      r.wrap.alpha = diveA;
      try { r.actor.model.focus(W * 0.96, H * 0.45); } catch (e) { }
    }
  }

  function restoreModels() {
    // 让 app.js 的常规布局重新接管
    R.layoutSlot(R.slots.mount);
    R.layoutSlot(R.slots.rider);
    R.slots.mount.wrap.alpha = 1;
    R.slots.rider.wrap.alpha = 1;
  }

  const SEA_ICON = { dawn: '🌅', day: '☀', dusk: '🌆', night: '🌙', storm: '⛈' };

  function switchSea() {
    const keys = ['dawn', 'day', 'dusk', 'night', 'storm'];
    const next = pick(keys.filter((k) => k !== R.scene.sea));
    R.scene.sea = next;
    try { R.buildScene(); } catch (e) { }
    const el = $('#hud-sea');
    if (el) {
      el.textContent = SEA_ICON[next] || '☀';
      el.classList.add('pop');
      setTimeout(() => el.classList.remove('pop'), 400);
    }
  }

  /* ================= 主循环 ================= */
  function update(dt) {
    if (!GM.on || GM.phase !== 'run') {
      if (GM.dead) { /* 死亡动画由 applyModels 外的逻辑处理 */ }
      return;
    }
    const { W, H } = viewSize();

    // 难度
    GM.speed = clamp(1 + GM.dist / 7000, 1, 2.4);
    GM.dist += GM.speed * Math.min(W, H) * 0.62 * dt;
    GM.score = Math.floor(GM.dist / 14) + (GM.passBonus || 0);
    const sc = $('#hud-score');
    if (sc) sc.textContent = GM.score;
    $('#hud-best') && (GM.score > GM.best ? ($('#hud-best').textContent = GM.score) : null);

    // 水面加速（喂给 app.js 的展示模式场景）
    if (R.scene) R.scene.speed = clamp(18 + GM.speed * 34, 0, 100);

    // 跳跃物理
    if (!GM.onGround) {
      GM.vy += jumpGrav() * dt;
      GM.jumpY += GM.vy * dt;
      if (GM.jumpY >= 0) {
        GM.jumpY = 0; GM.vy = 0; GM.onGround = true;
        splashAt(4, 0.8);
        GM.shake = Math.max(GM.shake, 2.2);
      }
    }
    // 下潜
    // 下潜：由 diveHold 计时驱动，归零后自动浮起
    if (GM.diveHold > 0) GM.diveHold = Math.max(0, GM.diveHold - dt);
    if (GM.diveHold === 0) GM.diving = false;
    const dT = GM.diveHold > 0 ? 1 : 0;
    GM.dive += (dT - GM.dive) * Math.min(1, dt * 14);
    // 姿态倾斜
    const tiltT = GM.onGround ? (GM.diving ? 0.5 : 0) : clamp(GM.vy / (H * -1.6), -0.3, 0.6);
    GM.tilt += (tiltT - GM.tilt) * Math.min(1, dt * 10);

    // 生成（间隔必须容得下「一次完整跳跃 + 落地反应」：
    //   滞空 0.68s + 最宽浮木通过 0.32s + 落地反应 0.32s → 最小间隔 1.32s）
    GM.spawnT -= dt;
    if (GM.spawnT <= 0) {
      spawnObstacle();
      const gapTime = clamp(1.66 - (GM.speed - 1) * 0.22, 1.32, 1.66) * rnd(1.0, 1.18);
      GM.spawnT = gapTime;
    }
    updateObstacles(dt);

    // 碰撞
    checkHit();

    // 天气
    GM.weatherT -= dt;
    if (GM.weatherT <= 0) {
      GM.weatherT = rnd(18, 30);
      switchSea();
    }

    // 震屏
    if (GM.shake > 0) {
      GM.shake = Math.max(0, GM.shake - dt * 26);
      R.app.stage.x = rnd(-GM.shake, GM.shake);
      R.app.stage.y = rnd(-GM.shake, GM.shake);
    } else {
      R.app.stage.x = 0; R.app.stage.y = 0;
    }
  }

  function checkHit() {
    if (GM.dead) return;
    const b = playerBox();
    for (const o of GM.obstacles) {
      const ol = o.x - o.w / 2, or = o.x + o.w / 2;
      const ot = o.cy - o.h / 2, ob = o.cy + o.h / 2;
      const pad = o.w * 0.12;
      if (b.r > ol + pad && b.l < or - pad && b.b > ot + pad && b.t < ob - pad) {
        gameOver();
        return;
      }
    }
  }

  /* ================= 流程 ================= */
  function startGame() {
    if (!ready() || GM.on) return;
    ensureLayer();

    GM.on = true;
    GM.phase = 'run';
    GM.dead = false; GM.deadT = 0;
    GM.score = 0; GM.dist = 0; GM.speed = 1;
    GM.jumpY = 0; GM.vy = 0; GM.onGround = true;
    GM.dive = 0; GM.diveHold = 0; GM.diving = false; GM.tilt = 0;
    GM.shake = 0;
    GM.spawnT = 2.4;
    GM.weatherT = rnd(18, 28);
    GM.baseSeaSpeed = R.scene ? R.scene.speed : 50;
    clearObstacles();
    try { R.closeActions && R.closeActions(); } catch (e) { }

    document.body.classList.add('playing');
    $('#over').classList.remove('on');
    const hb = $('#hud-best'); if (hb) hb.textContent = GM.best;
    const hs = $('#hud-sea'); if (hs) hs.textContent = SEA_ICON[R.scene ? R.scene.sea : 'day'] || '☀';
    const sc = $('#hud-score'); if (sc) sc.textContent = '0';

    // 角色面板里可能还高亮着动作，收起时顺手清掉提示
    const tip = $('#tip'); if (tip) tip.style.opacity = '0';
  }

  function gameOver() {
    if (GM.dead) return;
    GM.dead = true;
    GM.phase = 'over';
    GM.shake = 14;

    const { px, baseY, W, H } = playerGeom();
    if (R.spawn) {
      for (let i = 0; i < 22; i++) {
        R.spawn({
          x: px + rnd(-W * 0.04, W * 0.04),
          y: baseY + rnd(-H * 0.03, H * 0.02),
          vx: rnd(-280, 100), vy: rnd(-460, -120),
          grav: 1200,
          s0: rnd(0.2, 0.45), s1: rnd(0.6, 1.3),
          a0: rnd(0.6, 0.95), max: rnd(0.6, 1.2)
        });
      }
    }

    // 角色被拍飞
    const m = R.slots.mount, r = R.slots.rider;
    [m, r].forEach((s, i) => {
      const dx = rnd(-1, 1) * viewSize().W * 0.08;
      const dur = 480;
      const t0 = performance.now();
      const p0 = { x: s.wrap.x, y: s.wrap.y, rot: s.wrap.rotation };
      (function tick() {
        const p = Math.min(1, (performance.now() - t0) / dur);
        s.wrap.x = p0.x + dx * p;
        s.wrap.y = p0.y - viewSize().H * 0.12 * Math.sin(p * Math.PI) + viewSize().H * 0.05 * p * p;
        s.wrap.rotation = p0.rot + p * (i ? 2.2 : -1.8);
        if (p < 1) requestAnimationFrame(tick);
      })();
    });

    setTimeout(showOver, 620);
  }

  function showOver() {
    const isNew = GM.score > GM.best;
    if (isNew) {
      GM.best = GM.score;
      try { localStorage.setItem('surfdash.best', String(GM.best)); } catch (e) { }
    }
    $('#over-score').textContent = GM.score;
    $('#over-best').textContent = GM.best;
    $('#over-title').textContent = isNew ? '新纪录！' : pick(['被浪拍中了', '撞上礁石了', '这浪有点猛', '再来一次？']);
    $('#over-new').classList.toggle('on', isNew);
    $('#over').classList.add('on');
  }

  function exitGame(keepOver) {
    if (!GM.on) return;
    GM.on = false;
    GM.phase = 'idle';
    GM.dead = false;
    clearObstacles();
    if (R.scene) R.scene.speed = GM.baseSeaSpeed;
    R.app.stage.x = 0; R.app.stage.y = 0;
    document.body.classList.remove('playing');
    if (!keepOver) $('#over').classList.remove('on');
    setTimeout(restoreModels, 60);
  }

  function restart() {
    $('#over').classList.remove('on');
    if (GM.on) {
      // 已经在游戏里：直接重置
      GM.phase = 'run';
      GM.dead = false; GM.score = 0; GM.dist = 0; GM.speed = 1;
      GM.jumpY = 0; GM.vy = 0; GM.onGround = true;
      GM.dive = 0; GM.diveHold = 0; GM.diving = false; GM.tilt = 0;
      GM.spawnT = 2.4;
      clearObstacles();
      restoreModels();
      const sc = $('#hud-score'); if (sc) sc.textContent = '0';
    } else {
      startGame();
    }
  }

  /* ================= 输入 ================= */
  let touch = null;

  function onDown(e) {
    if (!GM.on || GM.phase !== 'run') return;
    touch = { y0: e.clientY, diving: false };
  }
  function onMove(e) {
    if (!touch || GM.phase !== 'run') return;
    if (!touch.diving && e.clientY - touch.y0 > 26) {
      touch.diving = true;
      diveStart();
    }
  }
  function onUp() {
    if (touch) {
      if (touch.diving) diveEnd();
      else doJump();
    }
    touch = null;
  }

  // 游戏中的指针输入：用 document 捕获阶段拦下，避免触发 app.js 的模型拖拽
  // （stage 上的监听器同节点传播无法用 stopPropagation 拦住，必须提前到 document）
  document.addEventListener('pointerdown', (e) => {
    if (!(GM.on && GM.phase === 'run')) return;
    if (e.target && e.target.closest && e.target.closest('#over')) return;
    e.stopPropagation();
    onDown(e);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!(GM.on && GM.phase === 'run') || !touch) return;
    e.stopPropagation();
    onMove(e);
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!(GM.on && GM.phase === 'run') || !touch) return;
    e.stopPropagation();
    onUp(e);
  }, true);

  document.addEventListener('pointercancel', () => { touch = null; diveEnd(); }, true);

  document.addEventListener('keydown', (e) => {
    if (!GM.on) return;
    const k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      e.preventDefault();
      if (GM.phase === 'over') restart();
      else doJump();
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      e.preventDefault();
      diveStart();
    } else if (k === 'Enter') {
      if (GM.phase === 'over') restart();
    } else if (k === 'Escape') {
      exitGame(false);
    }
  });
  document.addEventListener('keyup', (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') diveEnd();
  });

  /* ================= 与 app.js 的衔接 ================= */
  function hookTicker() {
    R.app.ticker.add(() => {
      if (!GM.on) return;
      const dt = Math.min(R.app.ticker.deltaMS, 50) / 1000;
      update(dt);
      applyModels();
    });
  }

  /* ================= 启动 ================= */
  (function waitForRide() {
    const t = setInterval(() => {
      if (window.__ride && window.__ride.app && window.__ride.slots.mount.actor.model) {
        clearInterval(t);
        R = window.__ride;
        ensureLayer();
        hookTicker();
        $('#btn-play').onclick = () => startGame();
        $('#btn-again').onclick = () => restart();
        $('#btn-exit').onclick = () => exitGame(false);
        const hb = $('#hud-best'); if (hb) hb.textContent = GM.best;
        GM.phase = 'idle';
      }
    }, 120);
  })();

  window.__dash = { GM, startGame, restart, exitGame, doJump, diveStart, diveEnd, spawnObstacle, playerBox, DEF, get R() { return R; } };
})();