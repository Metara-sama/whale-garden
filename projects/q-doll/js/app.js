/* ============================================================
   Q弹玩偶 · Live Wallpaper
   three.js 正交舞台 / 弹簧压缩物理 / BPM 节拍驱动
   ============================================================ */

import * as THREE from 'three';
import { GLTFLoader } from './loaders/GLTFLoader.js';
import { MeshoptDecoder } from './libs/meshopt_decoder.module.js';

/* ---------------- 常量 ---------------- */
/* 线上把大文件交给 jsDelivr（GitHub Pages 在国内太慢） */
const GH = /github\.io$/.test(location.hostname);
const CDN = 'https://cdn.jsdelivr.net/gh/Metara-sama/whale-garden@main/projects/q-doll/';
const ASSET = GH ? CDN : './';
const GLB_DIR = GH ? CDN + 'glb/' : './glb/';
const BGM_URL = GH ? CDN + 'assets/bgm.mp3' : './assets/bgm.mp3';


const CAST = [
  { k: 'arisa',      n: '市谷有咲' },
  { k: 'rimi',       n: '牛込里美' },
  { k: 'kasumi',     n: '户山香澄' },
  { k: 'otae',       n: '花园多惠' },
  { k: 'saya',       n: '山吹沙绫' },
  { k: 'tomori',     n: '高松灯' },
  { k: 'anon',       n: '千早爱音' },
  { k: 'soyo',       n: '长崎素世' },
  { k: 'taki',       n: '椎名立希' },
  { k: 'rana',       n: '要乐奈' },
  { k: 'Amoris',     n: 'Amoris' },
  { k: 'Doloris',    n: 'Doloris' },
  { k: 'Timoris',    n: 'Timoris' },
  { k: 'Mortis',     n: 'Mortis' },
  { k: 'Oblivionis', n: 'Oblivionis' },
].map((c, i) => ({ ...c, idx: i, file: `${GLB_DIR}${c.k}.glb` }));

const HORIZON = [0.5556,0.5521,0.5521,0.5486,0.5451,0.5417,0.5382,0.5347,0.5347,0.5312,0.5312,0.5312,0.5312,0.5278,0.5278,0.5278,0.5278,0.5278,0.5278,0.5278,0.5278,0.5312,0.5312,0.5347,0.5347,0.5347,0.5382,0.5382,0.5417,0.5417,0.5451,0.5486,0.5521,0.5521,0.5556,0.559,0.559,0.5625,0.5625,0.566,0.5694,0.5694,0.5729,0.5764,0.5799,0.5799,0.5833,0.5868,0.5903,0.5938,0.5938,0.5972,0.6007,0.6007,0.6042,0.6042,0.6076,0.6111,0.6146,0.6181,0.6215,0.625,0.625,0.6285,0.6302,0.6319];
const IMG_W = 2048, IMG_H = 1152;

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const DEG = Math.PI / 180;

const wrapDeg = (v) => ((((v + 180) % 360) + 360) % 360) - 180;

/* ---------------- 状态 ---------------- */

const S = {
  bpm: 100,
  elastic: 0.62,
  depth: 0.55,      // 压缩量
  audioGain: 0.55,
  roster: ['arisa', 'rimi', 'kasumi', 'otae', 'saya', 'tomori'],
  yaw: 0,           // 手动全局朝向（度）
  rotYaw: 0,        // 自动旋转累积角（度）
  autoRot: false,   // 自动旋转开关
  rotSpeed: 30,     // 度 / 秒
  rotDir: 1,        // +1 顺时针 / -1 逆时针
  view: { s: 1, x: 0, y: 0 },
  playing: false,
};

const STORE_KEY = 'dollWallpaper.v1';
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  Object.assign(S, {
    bpm: saved.bpm ?? S.bpm,
    elastic: saved.elastic ?? S.elastic,
    depth: saved.depth ?? S.depth,
    audioGain: saved.audioGain ?? S.audioGain,
    roster: Array.isArray(saved.roster) && saved.roster.length ? saved.roster : S.roster,
    yaw: saved.yaw ?? 0,
    autoRot: !!saved.autoRot,
    rotSpeed: saved.rotSpeed ?? 30,
    rotDir: saved.rotDir ?? 1,
  });
} catch (e) {/* noop */}
const save = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      bpm: S.bpm, elastic: S.elastic, depth: S.depth, audioGain: S.audioGain, roster: S.roster,
      yaw: S.yaw, autoRot: S.autoRot, rotSpeed: S.rotSpeed, rotDir: S.rotDir,
    }));
  } catch (e) {}
};

/* ---------------- three 基础 ---------------- */

const canvas = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearAlpha(0);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
camera.position.set(0, 0, 600);
camera.lookAt(0, 0, 0);

const world = new THREE.Group();      // 载入 pan / zoom
scene.add(world);

/* 光：天光 + 草皮反射光 + 太阳 */
scene.add(new THREE.AmbientLight(0xffffff, 0.95));
const hemi = new THREE.HemisphereLight(0xcfeeff, 0x9ec95f, 0.95);
hemi.position.set(0, 1, 0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e2, 1.35);
sun.position.set(0.6, 1.05, 0.85);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xbfe6ff, 0.30);
rim.position.set(-0.7, 0.35, 0.5);
scene.add(rim);

/* ---------------- 布局几何 ---------------- */

let VW = 1, VH = 1, coverS = 1, coverOX = 0, coverOY = 0;

function measureCover() {
  VW = window.innerWidth;
  VH = window.innerHeight;
  coverS = Math.max(VW / IMG_W, VH / IMG_H);
  const dw = IMG_W * coverS, dh = IMG_H * coverS;
  coverOX = (VW - dw) / 2;
  coverOY = (VH - dh) / 2;
}

function horizonAt(u) {
  const f = clamp(u, 0, 1) * (HORIZON.length - 1);
  const i = Math.floor(f), t = f - i;
  const a = HORIZON[i], b = HORIZON[Math.min(i + 1, HORIZON.length - 1)];
  return lerp(a, b, t);
}

/** 图片归一化坐标 (u,v) → 世界坐标（x=0 为屏幕中心，y 向上为正） */
function imgToWorld(u, v) {
  const px = coverOX + u * IMG_W * coverS;
  const py = coverOY + v * IMG_H * coverS;
  return { x: px - VW / 2, y: VH / 2 - py };
}

/* ---------------- 阴影贴图 ---------------- */

function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(12,26,10,0.62)');
  grd.addColorStop(0.42, 'rgba(12,26,10,0.34)');
  grd.addColorStop(1, 'rgba(12,26,10,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const SHADOW_TEX = makeShadowTexture();
const SHADOW_GEO = new THREE.PlaneGeometry(1, 1);

/* ---------------- 玩偶 ---------------- */

const dolls = [];       // 全部（含未显示的）
const active = [];      // 当前参与渲染的

function makeDoll(gltf, def) {
  const root = new THREE.Group();

  const jumpNode = new THREE.Group();       // 竖直位移
  const squashNode = new THREE.Group();     // 压缩 / 拉伸
  const modelWrap = new THREE.Group();

  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const ns = 1 / (size.y || 1);

  model.scale.multiplyScalar(ns);
  model.position.set(-center.x * ns, -box.min.y * ns, -center.z * ns);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const src = o.material;
    if (!src) return;
    if (src.map) src.map.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({
      map: src.map || null,
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      side: src.side,
      transparent: false,
    });
    if (src.map) m.map.colorSpace = THREE.SRGBColorSpace;
    o.material = m;
  });

  modelWrap.add(model);
  squashNode.add(modelWrap);
  jumpNode.add(squashNode);
  root.add(jumpNode);

  const shadow = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({
    map: SHADOW_TEX, transparent: true, depthWrite: false, opacity: 0.34,
  }));
  shadow.renderOrder = -1;
  root.add(shadow);

  return {
    def, root, jumpNode, squashNode, modelWrap, shadow,
    sq: 0, sqv: 0,          // 弹簧状态
    visible: false,
    jitter: hash(def.idx) - 0.5,
    phaseShift: hash(def.idx + 91) * 0.22,
    yaw: (hash(def.idx + 17) - 0.5) * 0.34,
    baseScale: 1,
    anchor: { x: 0, y: 0 },
    jump: 0,
    user: { s: 1, dx: 0, dy: 0 },
    tilt: 0,   // 单体手调：缩放 / 位移
  };
}

/* ---------------- 摆放 ---------------- */

/** 当前视口下，背景图真正可见的 u 区间（cover 裁切后） */
function visibleU() {
  const total = IMG_W * coverS;
  const uL = (0 - coverOX) / total;
  const uR = (VW - coverOX) / total;
  return [clamp(uL, 0, 1), clamp(uR, 0, 1)];
}

function placeDolls() {
  const n = active.length;
  if (!n) return;

  const [uL, uR] = visibleU();
  const span = uR - uL;

  // 每个玩偶的横向槽位（决定“能站多大”）
  const slot = VW / n;
  const hBase = clamp(slot * 1.50, VH * 0.10, VH * 0.30);
  const spread = clamp(span * 1.1, 0.25, 1);   // 视野越宽，远小近大越明显

  // 按玩偶半宽留边，保证最左/最右都不出画
  const half = hBase * 0.52;
  const x0 = half * 0.95;
  const x1 = VW - half * 0.95;
  const imgPxW = IMG_W * coverS;

  for (let i = 0; i < n; i++) {
    const d = active[i];
    const t = n === 1 ? 0.5 : i / (n - 1);

    const screenX = lerp(x0, x1, t);
    const ux = clamp((screenX - coverOX) / imgPxW, 0, 1);
    const v = horizonAt(ux) + 0.05;

    const p = imgToWorld(ux, v);
    d.anchor.x = p.x;
    d.anchor.y = p.y;
    // 前后错落 + 遮挡排序（近处在上）
    const stagger = hash(d.def.idx + 41) - 0.5;
    d.root.position.set(
      p.x + d.user.dx,
      p.y - Math.abs(stagger) * hBase * 0.03 + d.user.dy,
      t * 150 - 75 + stagger * 40
    );

    const sizeMul = 1 + (t - 0.5) * 0.30 * spread;
    d.baseScale = hBase * sizeMul;
    d.root.scale.setScalar(d.baseScale * d.user.s);

    d.root.rotation.z = (hash(d.def.idx + 5) - 0.5) * 0.03;
    d.tilt = (0.5 - t) * 0.40 * spread;   // 内八朝向
    d.modelWrap.rotation.y = d.yaw;

    d.shadow.scale.set(1.02, 0.28, 1);
    d.shadow.position.set(0, 0.008, -0.62);
  }
}

/* ---------------- 载入 ---------------- */

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const loadedMap = new Map();
let loadDone = 0;
let totalToLoad = 6;

function setProgress(pct) {
  $('#ld-num').textContent = Math.round(pct);
}

function loadOne(def) {
  return new Promise((resolve) => {
    loader.load(def.file, (gltf) => {
      loadedMap.set(def.k, gltf);
      loadDone++;
      setProgress((loadDone / totalToLoad) * 100);
      resolve(gltf);
    }, undefined, (err) => {
      console.warn('load fail', def.k, err);
      loadDone++;
      setProgress((loadDone / totalToLoad) * 100);
      resolve(null);
    });
  });
}

async function loadBatch(list) {
  const queue = list.slice();
  const workers = new Array(6).fill(0).map(async () => {
    while (queue.length) {
      const d = queue.shift();
      await loadOne(d);
    }
  });
  await Promise.all(workers);
}

function mountDolls(list) {
  for (const def of list) {
    if (dolls.some((d) => d.def.k === def.k)) continue;
    const gltf = loadedMap.get(def.k);
    if (!gltf) continue;
    const inst = makeDoll({ scene: cloneSkeleton(gltf.scene) }, def);
    dolls.push(inst);
    world.add(inst.root);
  }
  dolls.sort((a, b) => a.def.idx - b.def.idx);
}

/** 首屏先加载 8 只，其余待首帧之后再静默预载 */
async function loadAll() {
  // 首屏只拉当前名单里的角色，其余等用户点选时再加载
  const first = CAST.filter((c) => S.roster.includes(c.k));
  totalToLoad = first.length || 1;
  await loadBatch(first);
  setProgress(100);
  mountDolls(first);
  syncActive();
}

/** 简单深克隆（模型无骨骼动画，直接 clone 并克隆材质即可） */
function cloneSkeleton(scene) {
  const c = scene.clone(true);
  c.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = o.material.clone();
      if (o.material.map) o.material.map.needsUpdate = true;
    }
  });
  return c;
}

/* ---------------- 数量控制 ---------------- */

/* ---------- 角色列表（点选上/下，而不是走数量条） ---------- */
function buildRosterUI() {
  const box = $('#roster');
  if (!box) return;
  box.innerHTML = '';
  for (const c of CAST) {
    const el = document.createElement('div');
    el.className = 'chip';
    el.dataset.k = c.k;
    el.textContent = c.n;
    el.addEventListener('click', () => toggleMember(c.k, el));
    box.appendChild(el);
  }
  syncRosterUI();
}

function syncRosterUI() {
  const box = $('#roster');
  if (!box) return;
  for (const el of box.children) {
    el.classList.toggle('on', S.roster.includes(el.dataset.k));
  }
  const cnt = $('#roster-count');
  if (cnt) cnt.textContent = S.roster.length + ' / ' + CAST.length;
}

function toggleMember(k, el) {
  const i = S.roster.indexOf(k);
  if (i >= 0) {
    S.roster.splice(i, 1);
    syncActive();
    return;
  }
  S.roster.push(k);
  // 模型还没加载的话补上
  if (!dolls.some((d) => d.def.k === k)) {
    const def = CAST.find((c) => c.k === k);
    if (def) {
      if (el) el.classList.add('busy');
      loadOne(def).then(() => {
        mountDolls([def]);
        syncActive();
        if (el) el.classList.remove('busy');
      });
      return;
    }
  }
  syncActive();
}

/** 按 roster 顺序重建 active */
function syncActive() {
  active.length = 0;
  for (const k of S.roster) {
    const d = dolls.find((x) => x.def.k === k);
    if (!d) continue;
    d.root.visible = true;
    active.push(d);
  }
  for (const d of dolls) {
    if (!S.roster.includes(d.def.k)) d.root.visible = false;
  }
  placeDolls();
  syncRosterUI();
  save();
}

/* ---------------- 节拍 + 弹簧 ---------------- */

const clock = { acc: 0, lastBeat: 0, beatIdx: 0 };
let audioEnergy = 0;

/* 全局同步的 Q 弹波形：一拍一个完整周期，首尾归零，无缝隙衔接 */
const SQUASH = { sq: 0 };

function squashWave(ph) {
  // ph: 0→1（一个拍）。0 秒压到底 → 0.5 回中 → 0.75 拉长 → 1 归位
  const z = 0.42 - S.elastic * 0.30;        // Q弹度越高，衰减越慢，过冲越明显
  const env = Math.exp(-z * 6.2832 * ph);
  return Math.sin(6.2832 * ph) * env;
}

/** 当前这一拍的目标压缩量（全体共享同一个值） */
function squashTarget() {
  const ph = clock.acc % 1;
  const beatNow = Math.floor(clock.acc);
  const bar = ((beatNow % 4) + 4) % 4;
  const accent = bar === 0 ? 1.24 : bar === 2 ? 1.09 : 1;
  const energy = 0.74 + audioEnergy * 0.72;
  const amp = (0.20 + S.depth * 0.42) * accent * energy * (0.85 + S.audioGain * 0.30);
  return amp * squashWave(ph);
}

function updateSquash(dt) {
  if (S.playing) {
    SQUASH.sq = clamp(squashTarget(), -0.6, 0.9);
  } else {
    SQUASH.sq *= Math.pow(0.02, dt);      // 停下时柔顺归零
    if (Math.abs(SQUASH.sq) < 0.0005) SQUASH.sq = 0;
  }
}

/* ---------------- 音频 ---------------- */

const audio = new Audio();
audio.src = BGM_URL;
audio.loop = true;
audio.preload = 'auto';
audio.crossOrigin = 'anonymous';

let actx = null, analyser = null, freqData = null, gainNode = null, srcNode = null;

function initAudioGraph() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  srcNode = actx.createMediaElementSource(audio);
  analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.68;
  gainNode = actx.createGain();
  gainNode.gain.value = ($('#vol').value | 0) / 100;
  srcNode.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(actx.destination);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}

function readEnergy() {
  if (!analyser) { audioEnergy += (0 - audioEnergy) * 0.1; return; }
  analyser.getByteFrequencyData(freqData);
  let sum = 0;
  for (let i = 1; i <= 6; i++) sum += freqData[i];
  const bass = sum / 6 / 255;
  audioEnergy += (bass - audioEnergy) * 0.22;
}

async function play() {
  initAudioGraph();
  if (actx && actx.state === 'suspended') { try { await actx.resume(); } catch (e) {} }
  try {
    await audio.play();
    S.playing = true;
  } catch (e) {
    console.warn('play blocked', e);
    S.playing = false;
    tappedOnLoad = false;   // 允许再次点击重试
    $('#hint').classList.remove('gone');
  }
  syncPlayUI();
}

function pause() {
  audio.pause();
  S.playing = false;
  syncPlayUI();
}

function togglePlay() { S.playing ? pause() : play(); }

function syncPlayUI() {
  document.body.classList.toggle('playing', S.playing);
  $('#play-label').textContent = S.playing ? '暂停' : '开始';
  $('#nowplaying').classList.toggle('on', S.playing);
  $('#progress').classList.toggle('on', S.playing);
  $('#hint').classList.add('gone');
}

/* ---------------- 交互：拖动 / 缩放 ---------------- */

const pointers = new Map();
let dragMoved = 0, lastX = 0, lastY = 0;
let tappedOnLoad = false;
let gesture = { mode: 'none', doll: null };

/* ---------- 坐标换算 / 命中检测 ---------- */
function toWorld(cx, cy) {
  return {
    x: (cx - VW / 2 - world.position.x) / (world.scale.x || 1),
    y: (VH / 2 - cy - world.position.y) / (world.scale.y || 1),
  };
}

/** 命中最靠前的玩偶（z 越大越靠前） */
function hitDoll(cx, cy) {
  const p = toWorld(cx, cy);
  let best = null, bestZ = -1e9;
  for (let i = 0; i < active.length; i++) {
    const d = active[i];
    const h = d.baseScale * d.user.s;
    const x = d.root.position.x, y = d.root.position.y;
    if (p.x > x - h * 0.62 && p.x < x + h * 0.62 && p.y > y - h * 0.10 && p.y < y + h * 1.05) {
      if (d.root.position.z > bestZ) { bestZ = d.root.position.z; best = d; }
    }
  }
  return best;
}

function midOf() {
  const a = [...pointers.values()];
  let x = 0, y = 0;
  for (const p of a) { x += p.x; y += p.y; }
  return { x: x / a.length, y: y / a.length };
}
function distOf() {
  const a = [...pointers.values()];
  return a.length < 2 ? 0 : (Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1);
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragMoved = 0;

  if (pointers.size === 1) {
    const hit = hitDoll(e.clientX, e.clientY);
    // 鼠标：左键=旋转，右键=平移；触屏：命玩偶=旋转，空白=平移
    const isMouse = e.pointerType === 'mouse';
    let mode;
    if (isMouse) mode = (e.button === 2) ? 'pan' : 'rotate';
    else mode = hit ? 'rotate' : 'pan';
    gesture = { mode, doll: hit };
    lastX = e.clientX; lastY = e.clientY;
    canvas.classList.add('grabbing');
    canvas.classList.toggle('rotating', mode === 'rotate');
  } else if (pointers.size === 2) {
    dragMoved = 99;                       // 双指不当作点击
    const m = midOf();
    const first = [...pointers.values()][0];
    const hit = hitDoll(m.x, m.y) || hitDoll(first.x, first.y);
    if (hit) {
      gesture = {
        mode: 'doll', doll: hit,
        startDist: distOf(), startMid: m,
        startS: hit.user.s, startDx: hit.user.dx, startDy: hit.user.dy,
      };
    } else {
      gesture = { mode: 'view', startDist: distOf(), startView: S.view.s };
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // 双指：捏合缩放 + 同步拖动（命中玩偶时只处理该只）
  if (pointers.size === 2 && (gesture.mode === 'doll' || gesture.mode === 'view')) {
    const k = distOf() / (gesture.startDist || 1);
    if (gesture.mode === 'doll') {
      const dd = gesture.doll;
      const m = midOf();
      const ws = world.scale.x || 1;
      dd.user.s = clamp(gesture.startS * k, 0.25, 4);
      dd.user.dx = gesture.startDx + (m.x - gesture.startMid.x) / ws;
      dd.user.dy = gesture.startDy - (m.y - gesture.startMid.y) / ws;
      placeDolls();
    } else {
      setViewScale(gesture.startView * k);
    }
    return;
  }

  if (pointers.size !== 1) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  dragMoved += Math.abs(dx) + Math.abs(dy);

  if (gesture.mode === 'rotate') {
    setYaw(S.yaw + dx * 0.45);            // 单指拖玩偶 = 全体旋转
  } else {
    S.view.x += dx; S.view.y += dy;       // 单指拖空白 = 平移
    applyView();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    canvas.classList.remove('grabbing');
    canvas.classList.remove('rotating');
    if (dragMoved < 8) firstTap();
    gesture = { mode: 'none', doll: null };
  } else if (pointers.size === 1) {
    const p = [...pointers.values()][0];
    lastX = p.x; lastY = p.y;
    const hit = hitDoll(p.x, p.y);
    gesture = { mode: hit ? 'rotate' : 'pan', doll: hit };
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // 滚轮 = 改变大小（按住右键时同样有效）
  const f = Math.exp(-e.deltaY * 0.0012);
  setViewScale(S.view.s * f);
}, { passive: false });

// 右键拖平移，屏蔽系统菜单
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function firstTap() {
  if (tappedOnLoad) return;
  tappedOnLoad = true;
  if (!S.playing) play();
}

function setViewScale(v) {
  S.view.s = clamp(v, 0.4, 3);
  applyView();
  syncScaleUI();
}

function applyView() {
  world.scale.set(S.view.s, S.view.s, 1);
  world.position.set(S.view.x, S.view.y, 0);
  saveView();
}

let saveViewTimer = null;
function saveView() {
  clearTimeout(saveViewTimer);
  saveViewTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY + '.view', JSON.stringify(S.view)); } catch (e) {}
  }, 400);
}

function syncScaleUI() {
  const v = Math.round(S.view.s * 100);
  $('#scale').value = clamp(v, 50, 220);
  $('#scale-o').textContent = v;
  setFill($('#scale'));
}

/* ---------------- UI ---------------- */

function setFill(el) {
  if (!el) return;
  const min = +el.min || 0, max = +el.max || 100, v = +el.value;
  const pct = ((v - min) / (max - min)) * 100;
  el.style.setProperty('--fill', pct + '%');
}

/** 全局手动朝向：转盘 / 滑块 / 长按拖动共用 */
function setYaw(v, from) {
  S.yaw = wrapDeg(v);
  const r = $('#yaw');
  if (r && from !== 'range') { r.value = Math.round(S.yaw); }
  if (r) setFill(r);
  const o = $('#yaw-o');
  if (o) o.textContent = Math.round(S.yaw) + '°';
  const dv = $('#dial-val');
  if (dv) dv.textContent = Math.round(S.yaw) + '°';
  const nd = $('#dial-needle');
  if (nd) nd.style.transform = 'rotate(' + S.yaw + 'deg)';
  save();
}

const panel = $('#panel');
let panelT = 0;          // 0 = 收起, 1 = 展开（JS 驱动的动画值）
let panelTarget = 0;

function paintPanel() {
  const e = panelT <= 0 ? 0 : panelT >= 1 ? 1 : 1 - Math.pow(1 - panelT, 3);
  panel.style.opacity = e.toFixed(3);
  panel.style.transform = 'translateY(' + ((1 - e) * 38).toFixed(1) + 'px)';
  panel.style.pointerEvents = e > 0.35 ? 'auto' : 'none';
}

function openPanel() {
  panel.classList.add('open');
  document.body.classList.add('fab-open');
  panel.setAttribute('aria-hidden', 'false');
  panelTarget = 1;
}
function closePanel() {
  panel.classList.remove('open');
  document.body.classList.remove('fab-open');
  panel.setAttribute('aria-hidden', 'true');
  panelTarget = 0;
}

$('#fab').addEventListener('click', openPanel);
$('#close').addEventListener('click', closePanel);

$('#play').addEventListener('click', togglePlay);

$('#vol').addEventListener('input', (e) => {
  const v = e.target.value;
  $('#vol-o').textContent = v;
  if (gainNode) gainNode.gain.value = v / 100;
  audio.volume = v / 100;
  setFill(e.target);
});

/* BPM：滑块 ↔ 数字双向 */
const bpmRange = $('#bpm'), bpmNum = $('#bpm-num');
function setBpm(v, from) {
  const n = clamp(Math.round(v || 100), 40, 240);
  S.bpm = n;
  if (from !== 'range') { bpmRange.value = n; }
  if (from !== 'num') { bpmNum.value = n; }
  $('#np-bpm').textContent = n + ' BPM';
  setFill(bpmRange);
  save();
}
bpmRange.addEventListener('input', (e) => setBpm(e.target.value, 'range'));
bpmNum.addEventListener('input', (e) => setBpm(e.target.value, 'num'));
bpmNum.addEventListener('blur', (e) => setBpm(e.target.value));

$('#elastic').addEventListener('input', (e) => {
  S.elastic = e.target.value / 100;
  $('#elastic-o').textContent = e.target.value;
  setFill(e.target); save();
});
$('#depth').addEventListener('input', (e) => {
  S.depth = e.target.value / 100;
  $('#depth-o').textContent = e.target.value;
  setFill(e.target); save();
});

/* ---- 全局旋转模块 ---- */
$('#yaw').addEventListener('input', (e) => setYaw(+e.target.value, 'range'));

$('#auto-rot').addEventListener('click', (e) => {
  S.autoRot = !S.autoRot;
  e.currentTarget.setAttribute('aria-checked', String(S.autoRot));
  save();
});

$('#rot-speed').addEventListener('input', (e) => {
  S.rotSpeed = +e.target.value;
  setFill(e.target); save();
});

$('#rot-dir').addEventListener('click', (e) => {
  S.rotDir *= -1;
  e.currentTarget.textContent = S.rotDir > 0 ? '↻' : '↺';
  save();
});

/* 转盘拖动 */
const dialEl = $('#dial');
let dialActive = false, dialLast = 0;
function dialAngle(e) {
  const r = dialEl.getBoundingClientRect();
  return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
}
if (dialEl) {
  dialEl.addEventListener('pointerdown', (e) => {
    dialActive = true; dialLast = dialAngle(e);
    dialEl.classList.add('on');
    try { dialEl.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  dialEl.addEventListener('pointermove', (e) => {
    if (!dialActive) return;
    const a = dialAngle(e);
    let d = a - dialLast;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    setYaw(S.yaw + d);
    dialLast = a;
    e.preventDefault();
  });
  const dialEnd = () => { dialActive = false; dialEl.classList.remove('on'); };
  dialEl.addEventListener('pointerup', dialEnd);
  dialEl.addEventListener('pointercancel', dialEnd);
  dialEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    setYaw(S.yaw - Math.sign(e.deltaY) * 5);
  }, { passive: false });
  dialEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { setYaw(S.yaw - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setYaw(S.yaw + 5); e.preventDefault(); }
  });
}

$('#audio-gain').addEventListener('input', (e) => {
  S.audioGain = e.target.value / 100;
  $('#ag-o').textContent = e.target.value;
  setFill(e.target); save();
});

/* 数量按钮已移除，改走角色列表 */

function pulse(el) {
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
}

$('#scale').addEventListener('input', (e) => {
  setViewScale(e.target.value / 100);
});

$('#reset-view').addEventListener('click', () => {
  S.view = { s: 1, x: 0, y: 0 };
  applyView(); syncScaleUI();
  pulse($('#reset-view'));
});

$('#file-audio').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const wasPlaying = S.playing;
  audio.src = url;
  audio.load();
  const name = f.name.replace(/\.[^.]+$/, '');
  $('#track-name').textContent = f.name;
  $('#np-name').textContent = name;
  if (wasPlaying) play();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    document.body.classList.toggle('ui-hidden');
    if (document.body.classList.contains('ui-hidden')) closePanel();
  }
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'Escape') closePanel();
});

/* ---------------- 尺寸 ---------------- */

function resize() {
  measureCover();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.left = -VW / 2;
  camera.right = VW / 2;
  camera.top = VH / 2;
  camera.bottom = -VH / 2;
  camera.updateProjectionMatrix();
  placeDolls();
  setViewScale(S.view.s);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

/* ---------------- 主循环 ---------------- */

let lastT = performance.now();
let rafId = 0;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;

  readEnergy();

  // 节拍推进
  if (S.playing) {
    clock.acc += dt * (S.bpm / 60);
    if (clock.acc > 1e6) clock.acc = clock.acc % 1000;   // 防止长时间运行精度流失
  }

  // 面板展开/收起（JS 驱动的缓动）
  if (Math.abs(panelTarget - panelT) > 0.0015) {
    panelT += (panelTarget - panelT) * Math.min(1, dt * 15);
    paintPanel();
  }

  // Q弹波形
  updateSquash(dt);

  const beatFrac = S.playing ? clock.acc - Math.floor(clock.acc) : 0;

  // 全局自动旋转
  if (S.autoRot) {
    S.rotYaw += dt * S.rotSpeed * S.rotDir;
    if (S.rotYaw > 360) S.rotYaw -= 360;
    if (S.rotYaw < -360) S.rotYaw += 360;
  }
  const yawBase = (S.yaw + S.rotYaw) * DEG;

  for (let i = 0; i < active.length; i++) {
    const d = active[i];

    // 原地 Q 弹：全体同一个波形值，脚底 y=0 钉死不动
    const sq = SQUASH.sq;
    const idle = S.playing ? 0 : Math.sin((now / 1000) * 1.15 + d.def.idx * 0.9) * 0.009;
    const sy = clamp(1 - sq + idle, 0.30, 1.80);
    const sxz = clamp(1 + sq * 0.55 - idle * 0.6, 0.30, 1.80);

    d.squashNode.scale.set(sxz, sy, sxz);
    d.jumpNode.position.y = 0;

    // 旋转：全局朝向 + 个体微差 + 呼吸摆
    d.modelWrap.rotation.y = yawBase + d.tilt + d.yaw * 0.9 + Math.sin((now / 1000) * 0.9 + d.def.idx * 1.3) * 0.028;
    d.modelWrap.rotation.z = sq * 0.055;

    // 影子：跟着摊开 / 变淡
    const flat = clamp(sq, -0.2, 0.6);
    d.shadow.scale.set(1.02 * (1 + flat * 0.42), 0.28 * (1 - flat * 0.16), 1);
    d.shadow.material.opacity = 0.34 * (1 - flat * 0.35);
  }

  // 进度线
  if (S.playing && audio.duration) {
    $('#progress-bar').style.width = ((audio.currentTime / audio.duration) * 100).toFixed(2) + '%';
  }

  renderer.render(scene, camera);
}

/* ---------------- 启动 ---------------- */

function makeDust() {
  const box = $('#dust');
  const n = 16;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i');
    const s = 1.5 + hash(i * 3.1) * 2.6;
    el.style.width = el.style.height = s.toFixed(1) + 'px';
    el.style.left = (hash(i * 5.7) * 100).toFixed(2) + '%';
    el.style.top = (25 + hash(i * 9.3) * 70).toFixed(2) + '%';
    el.style.animationDuration = (13 + hash(i * 2.3) * 16).toFixed(1) + 's';
    el.style.animationDelay = (-hash(i * 7.7) * 20).toFixed(1) + 's';
    el.style.opacity = 0;
    box.appendChild(el);
  }
}

async function boot() {
  measureCover();
  resize();
  makeDust();
  buildRosterUI();

  // 恢复视图
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY + '.view') || 'null');
    if (v && typeof v.s === 'number') S.view = v;
  } catch (e) {}
  applyView(); syncScaleUI();

  // UI 初值
  setBpm(S.bpm);
  $('#elastic').value = Math.round(S.elastic * 100);
  $('#elastic-o').textContent = $('#elastic').value;
  $('#depth').value = Math.round(S.depth * 100);
  $('#depth-o').textContent = $('#depth').value;
  setYaw(S.yaw);
  $('#auto-rot').setAttribute('aria-checked', String(S.autoRot));
  $('#rot-speed').value = S.rotSpeed;
  $('#rot-dir').textContent = S.rotDir > 0 ? '↻' : '↺';
  $('#audio-gain').value = Math.round(S.audioGain * 100);
  $('#ag-o').textContent = $('#audio-gain').value;
  ['#elastic', '#depth', '#audio-gain', '#vol', '#bpm', '#rot-speed'].forEach((s) => setFill($(s)));
  audio.volume = ($('#vol').value | 0) / 100;

  await loadAll();

  placeDolls();
  $('#ld-num').textContent = '100';
  setTimeout(() => {
    $('#loader').classList.add('gone');
    frame(performance.now());
  }, 420);

  // 载入完成后自动进入“静止呼吸”状态；点击才播放
  setTimeout(() => { if (!S.playing) $('#hint').classList.remove('gone'); }, 1400);
}

boot();

/* 调试挂钩 */
window.__doll = { S, dolls, active, syncActive, toggleMember, buildRosterUI, play, pause, setViewScale, setYaw, camera, renderer, scene };