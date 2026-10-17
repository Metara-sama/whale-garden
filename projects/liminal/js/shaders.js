/* ============================================================
   shaders.js —— 全部 GLSL 源码（手写 raymarching，零外部库）
   ------------------------------------------------------------
   一个全屏三角形，三个场景靠 SDF 现场"雕"出来：
     scene 0  泳池 · 池核（瓷砖、水面反射、水下焦散、栏杆、跳台）
     scene 1  后室 · Level 0（无限柱厅、荧光灯闪烁、地毯、墙纸）
     scene 2  草地 · 梦核（起伏草甸、落日、白门、萤火）
   外加：体积光累积、软阴影、接触阴影、时域累积(TAA)、
         ACES 色调映射、bloom、胶片颗粒、色差、暗角、白闪转场。
   ============================================================ */
window.LIMINAL = window.LIMINAL || {};
(function (NS) {
  "use strict";

  /* 全屏三角形：不需要任何顶点缓冲，靠 gl_VertexID */
  var VS = [
    "#version 300 es",
    "precision highp float;",
    "out vec2 vUv;",
    "void main() {",
    "  vec2 p = vec2(float((gl_VertexID & 1) * 4 - 1), float((gl_VertexID >> 1) * 4 - 1));",
    "  vUv = p * 0.5 + 0.5;",
    "  gl_Position = vec4(p, 0.0, 1.0);",
    "}"
  ].join("\n");

  /* ==========================================================
     主渲染 pass
     ========================================================== */
  var SCENE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) out vec4 outColor;

uniform vec2  uRes;
uniform vec2  uJitter;
uniform float uTime;
uniform vec3  uCam;
uniform vec2  uRot;
uniform float uFov;
uniform int   uScene;
uniform int   uSteps;
uniform float uNewWeight;
uniform float uFlash;
uniform float uExposure;
uniform int   uUnder;
uniform sampler2D uTile;
uniform sampler2D uWall;
uniform sampler2D uCarpet;
uniform sampler2D uPrev;

#define PI 3.14159265
#define MAXD 70.0

/* ---------------- hash / noise ---------------- */
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* 便宜的草/水用 fbm（3 层就够，性能优先） */
float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

/* ---------------- SDF 基础件 ---------------- */
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCyl(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/* ==========================================================
   场景 0 · 泳池（池核）
   房间 x∈[-15,15] z∈[-28,28] y∈[-2.6,6]
   池   x∈[-9,9]   z∈[-18,18] y∈[-2.2,0]
   ========================================================== */
float sdPoolRoom(vec3 p) {
  return -sdBox(p - vec3(0.0, 1.7, 0.0), vec3(15.0, 4.3, 22.0));
}

/* 池内空气距离：到池壁 / 池底的最近距离（不含"池口"这个假面）。
   这一步很关键：若把池子当成有顶的盒子，水面附近距离会趋近于 0，
   sphere tracing 会在水面附近原地蹭到步数耗尽。 */
float poolAir(vec3 p) {
  float dx = 9.0 - abs(p.x);
  float dz = 12.0 - abs(p.z);
  float dy = p.y + 2.2;
  return min(min(dx, dz), dy);
}

/* 地面：y<0 的实体，池子从里面挖掉 */
float sdPoolFloor(vec3 p) {
  return max(p.y, poolAir(p));
}

/* 两端护栏（z=±18.3），中间留 3.8m 开口下水 */
float sdPoolRail(vec3 p) {
  float ax = abs(p.x);
  float az = abs(p.z) - 18.3;
  float sx = mod(ax - 2.0, 1.85) - 0.925;
  float post = sdCyl(vec3(sx, p.y - 0.55, az), 0.03, 0.55);
  float bx = max(ax - 9.4, 1.9 - ax);
  float barHi = max(sdBox(vec3(0.0, p.y - 1.06, az), vec3(9.4, 0.026, 0.026)), bx);
  float barLo = max(sdBox(vec3(0.0, p.y - 0.55, az), vec3(9.4, 0.021, 0.021)), bx);
  return min(min(post, barHi), barLo);
}

/* 跳台：从 z=18 池边伸向池内，高 3.2m */
float sdPoolBoard(vec3 p) {
  float board = sdBox(p - vec3(0.0, 3.15, 16.1), vec3(0.85, 0.08, 2.3));
  float legL = sdBox(p - vec3(-0.7, 1.55, 18.3), vec3(0.08, 1.55, 0.08));
  float legR = sdBox(p - vec3(0.7, 1.55, 18.3), vec3(0.08, 1.55, 0.08));
  return min(board, min(legL, legR));
}

/* 天花板灯槽（发光） */
float sdPoolLamp(vec3 p) {
  float zc = mod(p.z + 4.0, 8.0) - 4.0;
  return sdBox(vec3(p.x, p.y - 5.93, zc), vec3(2.3, 0.06, 0.5));
}

/* 远端的白色门（发光，出口） */
float sdPoolDoor(vec3 p) {
  return sdBox(p - vec3(0.0, 1.35, -27.82), vec3(1.15, 1.35, 0.07));
}

vec2 mapPool(vec3 p) {
  float dRoom = sdPoolRoom(p);
  float dFloor = sdPoolFloor(p);
  float d = min(dRoom, dFloor);
  float m = 1.0;

  float a = sdPoolRail(p);
  if (a < d) { d = a; m = 2.0; }

  a = sdPoolBoard(p);
  if (a < d) { d = a; m = 4.0; }

  a = sdPoolDoor(p);
  if (a < d) { d = a; m = 3.0; }

  a = sdPoolLamp(p);
  if (a < d) { d = a; m = 5.0; }

  return vec2(d, m);
}

/* ==========================================================
   场景 1 · 后室（Level 0）
   天花板 2.72m，柱阵周期 6.4m，灯阵 (6.4, 3.2)
   ========================================================== */
#define ROOM_H 2.72
#define CELL 6.4

vec2 mapRooms(vec3 p) {
  float dCeil = ROOM_H - p.y;
  float dFloor = p.y;
  float d = min(dCeil, dFloor);
  float m = (dFloor < dCeil) ? 2.0 : 3.0;

  /* 柱阵 */
  vec2 id = floor(p.xz / CELL + 0.5);
  vec2 lp = p.xz - id * CELL;
  float dPost = sdBox(vec3(lp.x, p.y - ROOM_H * 0.5, lp.y), vec3(0.42, ROOM_H * 0.5, 0.42));
  if (dPost < d) { d = dPost; m = 4.0; }

  /* 灯板 */
  vec2 g = vec2(CELL, 3.2);
  vec2 id2 = floor(p.xz / g + 0.5);
  vec2 lp2 = p.xz - id2 * g;
  float dLamp = sdBox(vec3(lp2.x, p.y - (ROOM_H - 0.035), lp2.y), vec3(0.86, 0.035, 0.15));
  if (dLamp < d) { d = dLamp; m = 5.0; }

  return vec2(d, m);
}

/* ==========================================================
   场景 2 · 草地（梦核黄昏）
   ========================================================== */
float meadowH(vec2 xz) {
  return 0.62 * sin(xz.x * 0.085) * cos(xz.y * 0.062)
       + 0.30 * sin(xz.x * 0.21 + 1.7) * sin(xz.y * 0.18)
       + 0.14 * sin(xz.x * 0.55 + xz.y * 0.4);
}

vec2 sdTree(vec3 p) {
  vec3 c = vec3(-7.5, 0.0, -13.0);
  float g = meadowH(c.xz);
  vec3 q = p - c;
  float trunk = sdCyl(vec3(q.x, q.y - g - 1.7, q.z), 0.26, 1.8);
  vec3 cp = vec3(q.x, q.y - g - 4.2, q.z);
  float crown = sdSphere(cp, 1.6);
  crown = smin(crown, sdSphere(cp - vec3(1.05, 0.45, 0.35), 1.15), 0.75);
  crown = smin(crown, sdSphere(cp - vec3(-0.95, 0.30, -0.50), 1.05), 0.75);
  crown = smin(crown, sdSphere(cp - vec3(0.15, 1.15, 0.10), 1.00), 0.75);
  crown = smin(crown, sdSphere(cp - vec3(0.10, -0.85, -0.15), 0.95), 0.75);
  if (crown < trunk) return vec2(crown, 8.0);
  return vec2(trunk, 7.0);
}

/* 立在场中的白门：门框是暗色，门板自发光 */
vec2 sdMeadowDoor(vec3 p) {
  vec3 c = vec3(3.0, 0.0, -19.0);
  float g = meadowH(c.xz);
  vec3 q = p - c;
  float panel = sdBox(vec3(q.x, q.y - g - 1.20, q.z), vec3(0.62, 1.20, 0.055));
  float frame = sdBox(vec3(q.x, q.y - g - 1.26, q.z), vec3(0.70, 1.26, 0.09));
  float dFrame = max(frame, -panel);
  float d = min(dFrame, panel);
  float m = (dFrame <= panel) ? 9.0 : 3.0;
  return vec2(d, m);
}

vec2 sdBneck(vec3 p) {
  float g = meadowH(vec2(7.0, 6.0));
  vec3 q = p - vec3(7.0, g, 6.0);
  float seat = sdBox(q - vec3(0.0, 0.45, 0.0), vec3(0.92, 0.06, 0.28));
  float l1 = sdBox(q - vec3(-0.72, 0.22, 0.0), vec3(0.06, 0.22, 0.24));
  float l2 = sdBox(q - vec3(0.72, 0.22, 0.0), vec3(0.06, 0.22, 0.24));
  return vec2(min(seat, min(l1, l2)), 9.0);
}

vec2 mapMeadow(vec3 p) {
  vec2 res = vec2((p.y - meadowH(p.xz)) * 0.75, 6.0);

  vec2 t = sdTree(p);
  if (t.x < res.x) res = t;

  vec2 dr = sdMeadowDoor(p);
  if (dr.x < res.x) res = dr;

  vec2 bn = sdBneck(p);
  if (bn.x < res.x) res = bn;

  return res;
}

/* ---------------- 场景入口 ---------------- */
vec2 mapAll(vec3 p) {
  if (uScene == 0) return mapPool(p);
  if (uScene == 1) return mapRooms(p);
  return mapMeadow(p);
}

/* ==========================================================
   程序化纹理采样（显式 LOD，避免移动端导数问题与远距摩尔纹）
   ========================================================== */
vec3 texT(sampler2D t, vec2 uv, float dist) {
  float lod = clamp(log2(max(dist, 1.0) * 0.30), 0.0, 5.0);
  vec3 c = textureLod(t, uv, lod).rgb;
  return c * c; /* 近似 sRGB → linear */
}

vec3 tileAt(vec2 uv, float dist) { return texT(uTile, uv, dist); }
vec3 wallAt(vec2 uv, float dist) { return texT(uWall, uv, dist); }
vec3 carpetAt(vec2 uv, float dist) { return texT(uCarpet, uv, dist); }

/* 三平面 UV（按法线主轴挑投影面） */
vec2 triUV(vec3 p, vec3 n, float s) {
  vec3 an = abs(n);
  if (an.y > max(an.x, an.z)) return p.xz * s;
  if (an.x > an.z) return p.zy * s;
  return p.xy * s;
}

/* ==========================================================
   光照工具
   ========================================================== */
vec3 calcNormal(vec3 p, float t) {
  float e = max(0.0012, 0.0009 * t);
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapAll(p + k.xyy * e).x +
    k.yyx * mapAll(p + k.yyx * e).x +
    k.yxy * mapAll(p + k.yxy * e).x +
    k.xxx * mapAll(p + k.xxx * e).x
  );
}

/* 单次采样接触阴影：便宜且足够让物体"坐在地上" */
float contactAO(vec3 p, vec3 n) {
  float d = mapAll(p + n * 0.55).x;
  return clamp(0.45 + 0.55 * d / 0.55, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd, float maxT, int steps) {
  float res = 1.0;
  float t = 0.06;
  for (int i = 0; i < 20; i++) {
    if (i >= steps) break;
    float h = mapAll(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.05, 0.9);
    if (res < 0.02 || t > maxT) break;
  }
  return clamp(res, 0.0, 1.0);
}

/* 水波法线：三层正弦 + 一层噪声，够用且便宜 */
float waterWave(vec2 p, float t) {
  float w = 0.0;
  w += sin(p.x * 1.7 + t * 1.05) * 0.50;
  w += sin(p.y * 2.30 - t * 0.85) * 0.40;
  w += sin((p.x + p.y) * 1.10 + t * 1.60) * 0.30;
  w += (vnoise(p * 2.6 + t * 0.32) - 0.5) * 0.85;
  return w * 0.013;
}

vec3 waterNormal(vec2 xz, float t) {
  float e = 0.08;
  float h0 = waterWave(xz, t);
  float hx = waterWave(xz + vec2(e, 0.0), t);
  float hz = waterWave(xz + vec2(0.0, e), t);
  return normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));
}

/* 水下焦散 */
float caustics(vec2 p, float t) {
  vec2 q = p * 1.35;
  float v = 0.0;
  v += sin(q.x * 2.1 + sin(q.y * 1.7 + t * 1.25) * 1.9);
  v += sin(q.y * 2.3 + sin(q.x * 1.3 - t * 1.05) * 1.8);
  v += sin((q.x + q.y) * 1.4 + sin(q.x * 0.9 + t * 0.7) * 1.4);
  v = max(v * 0.5 + 0.5, 0.0);
  return pow(v, 4.5);
}

/* ==========================================================
   天空 / 雾
   ========================================================== */
vec3 skyMeadow(vec3 rd) {
  float y = clamp(rd.y, -1.0, 1.0);
  vec3 top = vec3(0.24, 0.20, 0.42);
  vec3 mid = vec3(0.62, 0.46, 0.54);
  vec3 hor = vec3(0.95, 0.78, 0.60);
  vec3 c = mix(hor, mid, smoothstep(-0.02, 0.20, y));
  c = mix(c, top, smoothstep(0.16, 0.72, y));

  vec3 sd = normalize(vec3(-0.30, 0.200, -0.95));
  float s = max(dot(rd, sd), 0.0);
  c += vec3(1.7, 1.2, 0.72) * pow(s, 150.0) * 1.5;
  c += vec3(1.20, 0.74, 0.44) * pow(s, 9.0) * 0.13;

  /* 高空卷云：fbm 投影到天穹 */
  float h = max(y + 0.22, 0.16);
  vec2 cuv = rd.xz / h * 0.55 + vec2(uTime * 0.004, 0.0);
  float cl = fbm3(cuv * 1.6 + fbm3(cuv * 0.7) * 0.8);
  float band = smoothstep(0.52, 0.86, cl) * smoothstep(0.0, 0.14, y) * (1.0 - smoothstep(0.55, 0.95, y));
  c = mix(c, vec3(1.10, 0.96, 0.94), band * 0.40);
  return c;
}

vec3 skyPool(vec3 rd) {
  float y = clamp(rd.y, -1.0, 1.0);
  return mix(vec3(0.92, 1.05, 1.08), vec3(1.30, 1.42, 1.45), smoothstep(-0.2, 0.7, y));
}

vec3 fogColorAt(vec3 p) {
  if (uScene == 0) return vec3(0.62, 0.83, 0.90);
  if (uScene == 1) {
    float far = length(p.xz);
    vec3 base = vec3(0.40, 0.34, 0.15);
    return mix(base, vec3(0.98, 0.94, 0.82), smoothstep(15.0, 31.0, far));
  }
  float far = length(p.xz);
  return mix(vec3(1.02, 0.86, 0.76), vec3(1.10, 1.02, 0.98), smoothstep(12.0, 34.0, far));
}

float fogDensity() {
  float base;
  if (uScene == 0) base = 0.022;
  else if (uScene == 1) base = 0.052;
  else base = 0.020;
  if (uUnder == 1) base *= 4.5;
  return base;
}

vec3 applyFog(vec3 col, vec3 p, vec3 ro) {
  float dist = length(p - ro);
  float f = 1.0 - exp(-dist * fogDensity());
  return mix(col, fogColorAt(p), clamp(f, 0.0, 1.0));
}

/* 体积光（沿射线累积的辉光密度） */
vec3 glowAt(vec3 p) {
  if (uScene == 0) {
    float band = smoothstep(2.6, 6.0, p.y);
    float zc = mod(p.z + 4.0, 8.0) - 4.0;
    float lane = exp(-zc * zc * 0.35);
    return vec3(0.95, 1.08, 1.12) * band * lane * 0.55;
  }
  if (uScene == 1) {
    vec2 g = vec2(CELL, 3.2);
    vec2 lc = floor(p.xz / g + 0.5) * g;
    vec3 lp = vec3(lc.x, ROOM_H - 0.06, lc.y);
    float d = length(p - lp);
    return vec3(1.00, 0.93, 0.62) * (2.2 / (1.0 + d * d * 1.7));
  }
  vec3 sd = normalize(vec3(-0.30, 0.200, -0.95));
  float s = max(dot(normalize(p - uCam), sd), 0.0);
  return vec3(1.05, 0.80, 0.52) * (0.16 + pow(s, 5.0) * 0.9);
}

/* ==========================================================
   Ray marching
   ========================================================== */
void marchScene(vec3 ro, vec3 rd, float maxDist, int maxSteps,
                out float tHit, out float matId, out vec3 glow) {
  float t = 0.02;
  tHit = maxDist + 1.0;
  matId = 0.0;
  glow = vec3(0.0);
  float tau = 0.0;

  for (int i = 0; i < 150; i++) {
    if (i >= maxSteps) break;
    vec3 p = ro + rd * t;
    vec2 h = mapAll(p);

    /* 体积光：步长越大贡献越多，同时被雾衰减 */
    float ds = min(h.x, 0.55);
    glow += glowAt(p) * ds * exp(-tau) * fogDensity();
    tau += ds * fogDensity();

    if (h.x < 0.0016 * t + 0.0009) {
      tHit = t;
      matId = h.y;
      break;
    }
    t += h.x * 0.92;
    if (t > maxDist) break;
  }
}

/* ==========================================================
   材质着色
   ========================================================== */
vec3 shadePool(vec3 p, vec3 n, float mi, vec3 rd, float t) {
  vec3 L = normalize(vec3(0.13, 1.0, 0.06));
  vec3 albedo = vec3(0.5);
  vec3 emit = vec3(0.0);
  float specK = 0.0;

  if (mi < 1.5) {
    /* 瓷砖 */
    albedo = tileAt(triUV(p, n, 0.5), t) * vec3(0.88, 0.97, 1.00);
    specK = 0.55;
    if (p.y < -0.02) {
      float depth = -p.y;
      vec3 absorb = exp(-depth * vec3(0.58, 0.22, 0.15));
      float caus = caustics(p.xz * 1.15, uTime);
      albedo *= absorb * (0.55 + 2.35 * caus * exp(-depth * 0.22));
      albedo += vec3(0.10, 0.26, 0.30) * caus * 0.5;
      specK = 0.15;
    }
  } else if (mi < 2.5) {
    /* 不锈钢栏杆 */
    albedo = vec3(0.60, 0.64, 0.67);
    specK = 2.6;
  } else if (mi < 3.5) {
    emit = vec3(2.35, 2.55, 2.70);
    albedo = vec3(1.0);
  } else if (mi < 4.5) {
    /* 跳台混凝土 */
    albedo = vec3(0.72, 0.74, 0.72) * (0.86 + 0.14 * vnoise(p.xz * 6.0));
    specK = 0.12;
  } else {
    /* 灯槽 */
    emit = vec3(2.6, 2.9, 3.0);
    albedo = vec3(1.0);
  }

  float ao = contactAO(p, n);
  float sh = softShadow(p + n * 0.03, L, 10.0, 4);
  float ndl = max(dot(n, L), 0.0);

  vec3 col = albedo * (vec3(0.13, 0.18, 0.21) + vec3(0.92, 1.02, 1.08) * ndl * mix(0.40, 1.0, sh)) * ao;

  /* 高处墙面泛白（天窗环境光） */
  col += albedo * vec3(0.22, 0.32, 0.36) * smoothstep(2.4, 6.0, p.y) * 0.40 * ao;

  /* 釉面高光 */
  vec3 hv = normalize(L - rd);
  col += vec3(1.0) * pow(max(dot(n, hv), 0.0), 120.0) * specK * 0.35;

  return col + emit;
}

/* 荧光灯闪烁（少数灯管坏掉，随机跳） */
float flicker(vec2 id, float t) {
  float r = hash12(id * 0.37 + 11.0);
  float base = 0.88 + 0.12 * sin(t * (1.2 + r * 3.4) + r * 21.0);
  float bad = step(0.87, r);
  float fl = step(0.45, hash11(floor(t * (3.0 + r * 7.0)) + r * 41.0));
  return mix(base, base * (0.18 + 0.82 * fl), bad);
}

vec3 shadeRooms(vec3 p, vec3 n, float mi, vec3 rd, float t) {
  vec3 albedo = vec3(0.5);
  vec3 emit = vec3(0.0);

  vec2 g = vec2(CELL, 3.2);
  vec2 lc = floor(p.xz / g + 0.5) * g;
  vec3 lampP = vec3(lc.x, ROOM_H - 0.07, lc.y);

  if (mi < 2.5) {
    /* 地毯 */
    albedo = carpetAt(p.xz * 0.42, t) * vec3(2.55, 2.40, 2.05);
  } else if (mi < 3.5) {
    /* 天花板吊顶板 */
    vec2 ap = p.xz * 1.25;
    float seam = smoothstep(0.02, 0.06, abs(fract(ap.x) - 0.5)) * smoothstep(0.02, 0.06, abs(fract(ap.y) - 0.5));
    albedo = vec3(1.15, 1.08, 0.86) * (0.72 + 0.28 * seam) * (0.9 + 0.1 * vnoise(p.xz * 3.0));
  } else if (mi < 4.5) {
    /* 墙纸柱 */
    albedo = wallAt(triUV(p, n, 0.55), t) * vec3(2.30, 2.18, 1.80);
    if (p.y < 0.15) albedo = vec3(0.24, 0.21, 0.13);
  } else {
    /* 灯板 */
    float f = flicker(lc, uTime);
    emit = vec3(2.45, 2.32, 1.72) * f;
    albedo = vec3(1.0);
  }

  vec3 ld = lampP - p;
  float dl = max(length(ld), 0.001);
  vec3 ldir = ld / dl;
  float att = 1.0 / (1.0 + dl * dl * 0.62);
  float ndl = max(dot(n, ldir), 0.0);
  float sh = softShadow(p + n * 0.03, ldir, dl, 5);
  float ao = contactAO(p, n);

  vec3 col = albedo * (vec3(0.16, 0.145, 0.095) + vec3(1.20, 1.08, 0.78) * ndl * att * 4.6 * mix(0.45, 1.0, sh)) * ao;

  /* 天花板附近整体偏暖亮，地面更闷 —— 后室的空气感 */
  col += albedo * vec3(0.17, 0.15, 0.09) * smoothstep(1.4, 2.7, p.y) * ao;

  return col * 1.15 + emit;
}

vec3 shadeMeadow(vec3 p, vec3 n, float mi, vec3 rd, float t) {
  vec3 sunDir = normalize(vec3(-0.30, 0.200, -0.95));
  vec3 sunCol = vec3(1.55, 0.98, 0.62);
  vec3 albedo = vec3(0.5);
  vec3 emit = vec3(0.0);

  if (mi < 6.5) {
    /* 草甸：低频起伏 + 高频草丝 + 逆光草尖 */
    float g1 = fbm3(p.xz * 0.55);
    float blade = vnoise(p.xz * 8.0 + vec2(uTime * 0.30, uTime * 0.12));
    float blade2 = vnoise(p.xz * 19.0 - vec2(uTime * 0.55, 0.0));
    float lush = smoothstep(0.30, 0.92, blade * 0.65 + blade2 * 0.35);
    vec3 gDark = vec3(0.210, 0.380, 0.130);
    vec3 gLite = vec3(0.500, 0.640, 0.205);
    albedo = mix(gDark, gLite, g1 * 0.85 + lush * 0.5);
    albedo *= 1.02 + 0.38 * lush;
    float back = pow(max(dot(-rd, sunDir), 0.0), 3.0);
    albedo += vec3(0.55, 0.58, 0.16) * lush * back * 1.05;
  } else if (mi < 7.5) {
    /* 树干 */
    float bark = vnoise(vec2(p.x * 9.0, p.y * 2.2));
    albedo = mix(vec3(0.16, 0.11, 0.075), vec3(0.30, 0.22, 0.155), bark);
  } else if (mi < 8.5) {
    /* 树冠 */
    float leaf = fbm3(p.xz * 3.2 + p.y * 1.7);
    albedo = mix(vec3(0.115, 0.225, 0.080), vec3(0.30, 0.46, 0.135), leaf);
    albedo += vec3(0.22, 0.26, 0.06) * pow(max(dot(n, sunDir), 0.0), 2.0) * 0.6;
  } else if (mi < 9.5) {
    /* 混凝土 / 门框 */
    albedo = vec3(0.50, 0.48, 0.44) * (0.85 + 0.15 * vnoise(p.xz * 5.0));
  } else {
    emit = vec3(2.6, 2.5, 2.3);
    albedo = vec3(1.0);
  }

  float sh = softShadow(p + n * 0.03, sunDir, 22.0, 8);
  float ao = contactAO(p, n);
  float ndl = max(dot(n, sunDir), 0.0);
  vec3 sky = skyMeadow(n) * 1.75;

  vec3 col = albedo * (sky + sunCol * ndl * mix(0.10, 1.0, sh) * 1.15) * ao;
  return col + emit;
}

/* ==========================================================
   水面（池核的灵魂）
   ========================================================== */
vec3 waterLayer(vec3 col, vec3 ro, vec3 rd, float tHit) {
  if (abs(rd.y) < 1e-4) return col;
  float tw = (0.0 - ro.y) / rd.y;
  if (tw <= 0.0 || tw > tHit) return col;

  vec3 pw = ro + rd * tw;
  if (abs(pw.x) > 9.0 || abs(pw.z) > 18.0) return col;

  vec3 nrm = waterNormal(pw.xz, uTime);
  if (ro.y < 0.0) nrm = -nrm;

  vec3 rrd = reflect(rd, nrm);
  float tr;
  float mr;
  vec3 gr;
  marchScene(pw + nrm * 0.012, rrd, 40.0, 26, tr, mr, gr);

  vec3 refl;
  if (tr > 40.0) {
    refl = skyPool(rrd);
  } else {
    vec3 pr = pw + rrd * tr;
    vec3 nr = calcNormal(pr, tr);
    refl = shadePool(pr, nr, mr, rrd, tr);
    refl = applyFog(refl, pr, pw);
  }
  refl += min(gr, vec3(6.0)) * 0.55;

  float f = 0.02 + 0.98 * pow(1.0 - clamp(dot(-rd, nrm), 0.0, 1.0), 5.0);
  if (ro.y < 0.0) f = clamp(f + 0.65, 0.0, 1.0);

  vec3 c = mix(col, refl, f);
  c = mix(c, vec3(0.30, 0.63, 0.73), 0.24);

  /* 灯槽在水面上的镜面反光（柔化，避免高频抖动成噪点） */
  vec3 hh = normalize(normalize(vec3(0.10, 1.0, 0.04)) - rd);
  c += vec3(1.0, 1.05, 1.12) * pow(max(dot(nrm, hh), 0.0), 72.0) * 0.38;

  /* 池边一圈很淡的浪花亮线 */
  float edge = max(abs(pw.x) / 9.0, abs(pw.z) / 18.0);
  c += vec3(0.85, 0.95, 1.0) * smoothstep(0.93, 1.0, edge) * 0.10;

  return c;
}

/* 萤火：跟随相机的 3×3 网格，逐格 hash 出位置，按垂直距离发辉 */
vec3 fireflies(vec3 ro, vec3 rd) {
  vec3 acc = vec3(0.0);
  vec2 base = floor(ro.xz / 4.5) * 4.5;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 cell = base + vec2(mod(fi, 3.0) - 1.0, floor(fi / 3.0) - 1.0) * 4.5;
    vec2 h = hash22(cell);
    float tb = uTime * 0.35;
    vec3 fp = vec3(
      cell.x + h.x * 4.5 + sin(tb + h.y * 6.283) * 0.75,
      0.85 + h.y * 1.5 + sin(tb * 1.3 + h.x * 12.0) * 0.28,
      cell.y + h.y * 4.5 + cos(tb * 0.9 + h.x * 6.283) * 0.75
    );
    vec3 v = fp - ro;
    float along = dot(v, rd);
    if (along < 0.8 || along > 24.0) continue;
    float perp = length(v - rd * along);
    float pulse = 0.45 + 0.55 * sin(uTime * (1.5 + h.x * 1.6) + h.y * 20.0);
    float g = 0.0009 / (perp * perp + 0.0032);
    acc += vec3(1.0, 0.80, 0.34) * g * pulse;
  }
  return acc * 0.55;
}

/* ==========================================================
   main
   ========================================================== */
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 ndc = (frag + uJitter - 0.5 * uRes) / uRes.y;

  float cyaw = cos(uRot.x);
  float syaw = sin(uRot.x);
  float cpit = cos(uRot.y);
  float spit = sin(uRot.y);
  vec3 fwd = vec3(syaw * cpit, spit, -cyaw * cpit);
  vec3 right = vec3(cyaw, 0.0, syaw);
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd + (ndc.x * right + ndc.y * up) * uFov);
  vec3 ro = uCam;

  float tHit;
  float mi;
  vec3 glow;
  marchScene(ro, rd, MAXD, uSteps, tHit, mi, glow);

  vec3 col;
  if (tHit > MAXD) {
    if (uScene == 2) {
      col = skyMeadow(rd);
    } else {
      col = fogColorAt(ro + rd * 55.0);
    }
  } else {
    vec3 p = ro + rd * tHit;
    vec3 n = calcNormal(p, tHit);
    if (uScene == 0) col = shadePool(p, n, mi, rd, tHit);
    else if (uScene == 1) col = shadeRooms(p, n, mi, rd, tHit);
    else col = shadeMeadow(p, n, mi, rd, tHit);
    col = applyFog(col, p, ro);
  }

  if (uScene == 0) col = waterLayer(col, ro, rd, tHit);
  if (uScene == 2) col += fireflies(ro, rd);

  /* 水下整体染蓝 */
  if (uUnder == 1) {
    col = mix(col, vec3(0.16, 0.44, 0.56), 0.30);
  }

  col += min(glow, vec3(6.0)) * 1.15;
  col *= uExposure;
  col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));

  /* 时域累积：静止时叠帧去噪，画面会慢慢"显影" */
  vec3 prev = texture(uPrev, frag / uRes).rgb;
  col = mix(prev, col, clamp(uNewWeight, 0.0, 1.0));

  outColor = vec4(col, 1.0);
}
`;

  /* ==========================================================
     Bloom 提取 + 水平模糊（1/4 分辨率）
     ========================================================== */
  var BRIGHT_H = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
out vec4 o;

void main() {
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = exp(-float(i * i) * 0.13);
    c += texture(uSrc, vUv + vec2(float(i) * uTexel.x, 0.0)).rgb * w;
    wsum += w;
  }
  c /= wsum;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(lum - uThreshold, 0.0) / max(lum, 1e-4);
  o = vec4(c * k, 1.0);
}
`;

  var BLUR_V = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 o;

void main() {
  vec3 c = vec3(0.0);
  float wsum = 0.0;
  for (int i = -5; i <= 5; i++) {
    float w = exp(-float(i * i) * 0.10);
    c += texture(uSrc, vUv + vec2(0.0, float(i) * uTexel.y)).rgb * w;
    wsum += w;
  }
  o = vec4(c / wsum, 1.0);
}
`;

  /* ==========================================================
     合成到屏幕：ACES + 色差 + 暗角 + 颗粒 + 抖动
     ========================================================== */
  var POST = `#version 300 es
precision highp float;
uniform sampler2D uSceneTex;
uniform sampler2D uBloomTex;
uniform sampler2D uGrain;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloom;
uniform float uVignette;
in vec2 vUv;
out vec4 o;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  vec2 off = c * r2 * 0.010;
  vec3 col;
  col.r = texture(uSceneTex, uv + off).r;
  col.g = texture(uSceneTex, uv).g;
  col.b = texture(uSceneTex, uv - off).b;

  col += texture(uBloomTex, uv).rgb * uBloom;

  col = aces(col);

  float vig = 1.0 - uVignette * smoothstep(0.10, 0.92, r2 * 1.85);
  col *= vig;

  float g = texture(uGrain, uv * uRes / 512.0 + vec2(uTime * 1.73, uTime * 2.31)).r;
  col += (g - 0.5) * 0.030;

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col += (g - 0.5) * 0.004;

  o = vec4(col, 1.0);
}
`;

  NS.Shaders = {
    VS: VS,
    SCENE: SCENE,
    BRIGHT_H: BRIGHT_H,
    BLUR_V: BLUR_V,
    POST: POST
  };
})(window.LIMINAL);