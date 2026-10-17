/* ============================================================
   engine.js —— WebGL2 装配 / 主循环 / 交互 / 转场
   ------------------------------------------------------------
   渲染链：
     scene(raymarch) → accum(时域累积 ping-pong) → bright+blur(1/4)
       → post(ACES+颗粒+暗角+色差) → 屏幕
   特性：
     · 静止时叠帧"显影"（最多 13 帧），完全静止后干脆不渲染，省电
     · 帧时间中位数自适应内部渲染分辨率（0.36~0.92 倍）
     · 真实进度（程序化贴图 4 步 + shader 编译 4 步 + 渲染目标 1 步）
   ============================================================ */
window.LIMINAL = window.LIMINAL || {};
(function (NS) {
  "use strict";

  var SH = NS.Shaders;

  var SCENES = [
    { key: "pool", steps: 66, fov: 0.95, exposure: 0.78, pos: [0.0, 1.62, 26.9], yaw: 0.0, pitch: -0.115 },
    { key: "rooms", steps: 64, fov: 1.00, exposure: 1.02, pos: [3.2, 1.62, 3.2], yaw: 0.16, pitch: -0.02 },
    { key: "meadow", steps: 60, fov: 0.92, exposure: 0.72, pos: [0.6, 1.62, 4.0], yaw: 0.10, pitch: -0.06 }
  ];

  /* 子像素抖动序列（累积时用，帮助抹平边缘锯齿与 SDF 噪声） */
  var JIT = [
    [0, 0], [0.5, -0.25], [-0.5, 0.25], [0.25, 0.5], [-0.25, -0.5],
    [0.75, 0.25], [-0.75, -0.25], [0.25, -0.75], [-0.25, 0.75],
    [0.5, 0.5], [-0.5, -0.5], [0.0, 1.0], [1.0, 0.0], [-1.0, 0.0],
    [0.0, -1.0], [0.87, 0.37]
  ];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ease(t) { return t * t * (3 - 2 * t); }

  /* 与 shader 里完全一致的草甸起伏（相机贴地要用） */
  function meadowH(x, z) {
    return 0.62 * Math.sin(x * 0.085) * Math.cos(z * 0.062)
      + 0.30 * Math.sin(x * 0.21 + 1.7) * Math.sin(z * 0.18)
      + 0.14 * Math.sin(x * 0.55 + z * 0.4);
  }

  /* ---------------- GL 小工具 ---------------- */
  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh) || "";
      gl.deleteShader(sh);
      throw new Error("[" + label + "] " + log);
    }
    return sh;
  }

  function link(gl, vsSrc, fsSrc, label) {
    var p = gl.createProgram();
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + ".vs");
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + ".fs");
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(p) || "";
      gl.deleteProgram(p);
      throw new Error("[" + label + "] link " + log);
    }
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      if (!info) continue;
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function makeTex2D(gl, source, repeat, mip) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    var wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    return t;
  }

  function makeTarget(gl, w, h, internal, type, filter) {
    var tex = gl.createTexture();
    if (!tex) throw new Error("createTexture 失败（WebGL 上下文已掉线）");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    if (!fb) throw new Error("createFramebuffer 失败（WebGL 上下文已掉线）");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("渲染目标不完整 0x" + st.toString(16) + " @" + w + "x" + h);
    }
    return { tex: tex, fb: fb, w: w, h: h };
  }

  function freeTarget(gl, t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
  }

  NS.Engine = {
    boot: function (canvas, hooks) {
      hooks = hooks || {};
      var onProgress = hooks.progress || function () {};
      var onReady = hooks.ready || function () {};
      var onFatal = hooks.fatal || function () {};

      var TOTAL = 9;
      var done = 0;
      function tick() {
        done++;
        onProgress(done / TOTAL, "");
      }

      var onLog = hooks.log || function () {};
      var onReport = hooks.report || function () {};
      onReport({ ev: "boot", ua: (navigator.userAgent || "?").slice(0, 40) });

      return NS.Textures.build(tick).then(function (sources) {
        var gl = canvas.getContext("webgl2", {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: "high-performance"
        });
        if (!gl) throw new Error("这个浏览器没有 WebGL2，阈限空间打不开。");

        var G = { gl: gl };
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);

        G.scene = link(gl, SH.VS, SH.SCENE, "scene"); tick();
        G.bright = link(gl, SH.VS, SH.BRIGHT_H, "bright"); tick();
        G.blur = link(gl, SH.VS, SH.BLUR_V, "blur"); tick();
        G.post = link(gl, SH.VS, SH.POST, "post"); tick();

        G.texTile = makeTex2D(gl, sources.tile, true, true);
        G.texWall = makeTex2D(gl, sources.wall, true, true);
        G.texCarpet = makeTex2D(gl, sources.carpet, true, true);
        G.texGrain = makeTex2D(gl, sources.grain, true, false);

        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        G.vao = vao;

        /* 掉线监听：移动端 GPU 一旦被算力打挂，整块 canvas 会变白。
           必须让上层知道，而不是静默白屏。 */
        canvas.addEventListener("webglcontextlost", function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          onLog("CONTEXT LOST — GPU 掉了，正在尝试恢复");
          onReport({ ev: "lost" });
        }, false);
        canvas.addEventListener("webglcontextrestored", function () {
          onLog("CONTEXT RESTORED — 请刷新页面");
        }, false);

        var floatOK = !!gl.getExtension("EXT_color_buffer_float");
        G.internal = floatOK ? gl.RGBA16F : gl.RGBA8;
        G.type = floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

        var view = { w: 640, h: 360 };
        var targets = null;
        var autoScale = null;
        var baseScale = 0.7;
        var sceneIdx = 0;
        var pos = { x: SCENES[0].pos[0], z: SCENES[0].pos[2] };
        var yaw = SCENES[0].yaw;
        var pitch = SCENES[0].pitch;
        var camY = 1.62;
        var bobPhase = 0;
        var speed = 0;
        var animTime = 0;
        var still = 0;
        var dirty = true;
        var flash = 0;
        var ac = 0;
        var last = 0;
        var running = true;
        var paused = false;
        var tr = { active: false, t: 0, dir: 1, next: 0 };
        var input = { mx: 0, my: 0 };
        var keys = { fwd: false, back: false, left: false, right: false };

        function resize() {
          var cw = canvas.clientWidth || window.innerWidth || 360;
          var ch = canvas.clientHeight || window.innerHeight || 640;
          var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          var px = cw * dpr * ch * dpr;
          baseScale = clamp(Math.sqrt(150000 / Math.max(px, 1)), 0.38, 0.92);
          if (autoScale === null) autoScale = baseScale;
          var s = Math.min(baseScale, autoScale);
          var w = Math.max(64, Math.round(cw * dpr * s));
          var h = Math.max(64, Math.round(ch * dpr * s));
          if (w === view.w && h === view.h && targets) return false;

          view.w = w;
          view.h = h;
          canvas.width = w;
          canvas.height = h;

          if (targets) {
            freeTarget(gl, targets.accum[0]);
            freeTarget(gl, targets.accum[1]);
            freeTarget(gl, targets.bloom[0]);
            freeTarget(gl, targets.bloom[1]);
          }
          var bw = Math.max(16, Math.round(w / 4));
          var bh = Math.max(16, Math.round(h / 4));
          targets = {
            accum: [
              makeTarget(gl, w, h, G.internal, G.type, gl.NEAREST),
              makeTarget(gl, w, h, G.internal, G.type, gl.NEAREST)
            ],
            bloom: [
              makeTarget(gl, bw, bh, G.internal, G.type, gl.LINEAR),
              makeTarget(gl, bw, bh, G.internal, G.type, gl.LINEAR)
            ]
          };
          ac = 0;
          still = 0;
          dirty = true;
          return true;
        }

        resize();
        tick();

        function probePixels() {
          if (!targets) return "no-targets";
          var out = [];
          try {
            var tgt = targets.accum[ac === 0 ? 1 : 0];
            gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
            var pts = [
              [view.w >> 1, view.h >> 1],
              [Math.floor(view.w * 0.30), Math.floor(view.h * 0.75)],
              [Math.floor(view.w * 0.70), Math.floor(view.h * 0.25)],
              [Math.floor(view.w * 0.10), Math.floor(view.h * 0.10)]
            ];
            for (var i = 0; i < pts.length; i++) {
              var f = new Float32Array(4);
              gl.readPixels(pts[i][0], pts[i][1], 1, 1, gl.RGBA, gl.FLOAT, f);
              out.push(f[0].toFixed(3) + "/" + f[1].toFixed(3) + "/" + f[2].toFixed(3));
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          } catch (e) {
            return "probe_err:" + e.message;
          }
          return out.join(" ");
        }

        function groundY() {
          if (sceneIdx === 0) {
            if (Math.abs(pos.x) <= 9.0 && Math.abs(pos.z - 19.0) <= 7.0) return -1.15;
            if (Math.abs(pos.x) <= 15.0 && Math.abs(pos.z + 14.0) <= 12.0) return -0.35;
            return 0.0;
          }
          if (sceneIdx === 1) return 0.0;
          return meadowH(pos.x, pos.z);
        }

        /* 池核多房间：把玩家夹在房间并集里（穿门洞靠房间重叠实现） */
        var ROOMS = [
          { x0: -16, x1: 16, z0: 8, z1: 30 },
          { x0: -3.2, x1: 3.2, z0: -2.5, z1: 10.5 },
          { x0: -15, x1: 15, z0: -26, z1: 2 },
          { x0: 16, x1: 26, z0: -16, z1: -6 },
          { x0: 13.5, x1: 17.5, z0: -13.2, z1: -8.8 }
        ];

        function containInRooms() {
          var m = 0.34;
          var best = 1e9;
          var bx = pos.x;
          var bz = pos.z;
          for (var i = 0; i < ROOMS.length; i++) {
            var r = ROOMS[i];
            var cx = clamp(pos.x, r.x0 + m, r.x1 - m);
            var cz = clamp(pos.z, r.z0 + m, r.z1 - m);
            var d = Math.hypot(pos.x - cx, pos.z - cz);
            if (d < best) { best = d; bx = cx; bz = cz; }
            if (d === 0) return;
          }
          if (best > 0.0001) {
            pos.x = bx;
            pos.z = bz;
            dirty = true;
          }
        }

        /* 各场景/各水深的移动速度 */
        function speedHere() {
          if (sceneIdx === 0) {
            if (Math.abs(pos.x) <= 9.0 && Math.abs(pos.z - 19.0) <= 7.0) return 1.05;
            if (Math.abs(pos.x) <= 15.0 && Math.abs(pos.z + 14.0) <= 12.0) return 0.82;
            return 1.85;
          }
          if (sceneIdx === 1) return 1.75;
          return 1.95;
        }

        function inWater() {
          return sceneIdx === 0 && Math.abs(pos.x) <= 9.0 && Math.abs(pos.z) <= 12.0;
        }

        function enterScene(i) {
          sceneIdx = i;
          var s = SCENES[i];
          pos.x = s.pos[0];
          pos.z = s.pos[2];
          yaw = s.yaw;
          pitch = s.pitch;
          camY = groundY() + 1.62;
          still = 0;
          flash = 1;
          dirty = true;
          NS.Audio.setScene(i);
        }

        function startTransition(next) {
          if (tr.active) return;
          tr.active = true;
          tr.t = 0;
          tr.dir = 1;
          tr.next = next;
          NS.Audio.whoosh();
          dirty = true;
        }

        function checkTrigger() {
          if (tr.active) return;
          var nx = null;
          if (sceneIdx === 0) {
            if (Math.hypot(pos.x - 25.0, pos.z + 11.0) < 2.4) nx = 1;
          } else if (sceneIdx === 1) {
            if (Math.hypot(pos.x, pos.z) > 24) nx = 2;
          } else {
            if (Math.hypot(pos.x - 3, pos.z + 13) < 2.6) nx = 0;
            else if (Math.hypot(pos.x, pos.z) > 30) nx = 0;
          }
          if (nx !== null) startTransition(nx);
        }

        /* ---------------- 输入 ---------------- */
        var stickEl = document.getElementById("stick");
        var knobEl = document.getElementById("stickKnob");
        var stick = { active: false, id: -1, cx: 0, cy: 0, R: 46 };
        var look = { active: false, id: -1, x: 0, y: 0 };

        function stickDown(e) {
          var r = stickEl.getBoundingClientRect();
          stick.active = true;
          stick.id = e.pointerId;
          stick.cx = r.left + r.width / 2;
          stick.cy = r.top + r.height / 2;
          try { stickEl.setPointerCapture(e.pointerId); } catch (err) {}
          stickMove(e);
          if (e.cancelable) e.preventDefault();
        }

        function stickMove(e) {
          if (!stick.active || e.pointerId !== stick.id) return;
          var dx = e.clientX - stick.cx;
          var dy = e.clientY - stick.cy;
          var len = Math.hypot(dx, dy);
          if (len > stick.R) {
            dx = dx / len * stick.R;
            dy = dy / len * stick.R;
          }
          if (len < 9) { dx = 0; dy = 0; }
          input.mx = dx / stick.R;
          input.my = -dy / stick.R;
          if (knobEl) {
            knobEl.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
          }
          dirty = true;
          if (e.cancelable) e.preventDefault();
        }

        function stickUp(e) {
          if (e && e.pointerId !== undefined && e.pointerId !== stick.id) return;
          stick.active = false;
          stick.id = -1;
          input.mx = 0;
          input.my = 0;
          if (knobEl) knobEl.style.transform = "translate(0px,0px)";
          dirty = true;
        }

        if (stickEl) {
          stickEl.addEventListener("pointerdown", stickDown, { passive: false });
          stickEl.addEventListener("pointermove", stickMove, { passive: false });
          stickEl.addEventListener("pointerup", stickUp, { passive: true });
          stickEl.addEventListener("pointercancel", stickUp, { passive: true });
        }

        /* 空白处拖动 = 转头 */
        function onDown(e) {
          look.active = true;
          look.id = e.pointerId;
          look.x = e.clientX;
          look.y = e.clientY;
          try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
          if (e.cancelable) e.preventDefault();
        }

        function onMove(e) {
          if (!look.active || e.pointerId !== look.id) return;
          var dx = e.clientX - look.x;
          var dy = e.clientY - look.y;
          look.x = e.clientX;
          look.y = e.clientY;
          if (dx === 0 && dy === 0) return;
          yaw += dx * 0.0042;
          pitch = clamp(pitch - dy * 0.0032, -0.62, 0.62);
          dirty = true;
          if (e.cancelable) e.preventDefault();
        }

        function onUp(e) {
          if (e && e.pointerId !== undefined && e.pointerId !== look.id) return;
          look.active = false;
          look.id = -1;
        }

        canvas.addEventListener("pointerdown", onDown, { passive: false });
        canvas.addEventListener("pointermove", onMove, { passive: false });
        canvas.addEventListener("pointerup", onUp, { passive: true });
        canvas.addEventListener("pointercancel", onUp, { passive: true });


        /* 老浏览器没有 PointerEvent 时退回 touch/mouse */
        if (!window.PointerEvent) {
          canvas.addEventListener("touchstart", function (e) {
            var t = e.touches[0];
            if (t) onDown({ pointerId: 1, clientX: t.clientX, clientY: t.clientY, cancelable: true, preventDefault: function () {} });
          }, { passive: false });
          canvas.addEventListener("touchmove", function (e) {
            var t = e.touches[0];
            if (t) onMove({ pointerId: 1, clientX: t.clientX, clientY: t.clientY, cancelable: true, preventDefault: function () {} });
          }, { passive: false });
          canvas.addEventListener("touchend", function () { onUp({ pointerId: 1 }); }, { passive: true });
          canvas.addEventListener("mousedown", function (e) {
            onDown({ pointerId: 1, clientX: e.clientX, clientY: e.clientY, cancelable: true, preventDefault: function () {} });
          });
          canvas.addEventListener("mousemove", function (e) {
            onMove({ pointerId: 1, clientX: e.clientX, clientY: e.clientY, cancelable: true, preventDefault: function () {} });
          });
          canvas.addEventListener("mouseup", function () { onUp({ pointerId: 1 }); });
        }

        window.addEventListener("keydown", function (e) {
          var k = e.key;
          if (k === "w" || k === "W" || k === "ArrowUp") keys.fwd = true;
          else if (k === "s" || k === "S" || k === "ArrowDown") keys.back = true;
          else if (k === "a" || k === "A" || k === "ArrowLeft") keys.left = true;
          else if (k === "d" || k === "D" || k === "ArrowRight") keys.right = true;
          else return;
          dirty = true;
          if (e.cancelable) e.preventDefault();
        }, { passive: false });

        window.addEventListener("keyup", function (e) {
          var k = e.key;
          if (k === "w" || k === "W" || k === "ArrowUp") keys.fwd = false;
          else if (k === "s" || k === "S" || k === "ArrowDown") keys.back = false;
          else if (k === "a" || k === "A" || k === "ArrowLeft") keys.left = false;
          else if (k === "d" || k === "D" || k === "ArrowRight") keys.right = false;
        });

        document.addEventListener("visibilitychange", function () {
          paused = !!document.hidden;
          last = 0;
          dirty = true;
        });

        window.addEventListener("resize", function () { resize(); });
        window.addEventListener("orientationchange", function () { setTimeout(resize, 260); });

        /* ---------------- 更新 ---------------- */
        function update(dt, dtRaw) {
          if (tr.active) {
            tr.t += dt;
            if (tr.dir === 1) {
              flash = ease(clamp(tr.t / 0.5, 0, 1));
              if (tr.t >= 0.5) {
                enterScene(tr.next);
                tr.dir = -1;
                tr.t = 0;
              }
            } else {
              flash = 1 - ease(clamp(tr.t / 1.25, 0, 1));
              if (tr.t >= 1.25) {
                tr.active = false;
                flash = 0;
              }
            }
            dirty = true;
          }

          var fx = Math.sin(yaw);
          var fz = -Math.cos(yaw);
          var rx = Math.cos(yaw);
          var rz = Math.sin(yaw);
          var inX = input.mx + (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
          var inY = input.my + (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
          var ilen = Math.hypot(inX, inY);
          if (ilen > 1) { inX /= ilen; inY /= ilen; }

          var mx = fx * inY + rx * inX;
          var mz = fz * inY + rz * inX;
          var mlen = Math.hypot(mx, mz);

          var targetSpeed = mlen > 0.02 ? speedHere() * Math.min(1, mlen) : 0;
          speed += (targetSpeed - speed) * Math.min(1, dt * 8.0);
          if (speed > 0.002 && mlen > 0.001) {
            pos.x += (mx / mlen) * speed * dt;
            pos.z += (mz / mlen) * speed * dt;
            dirty = true;
          }

          if (sceneIdx === 0) {
            containInRooms();
          } else if (sceneIdx === 1) {
            /* 柱子推开（格心 6.4m，柱半宽 0.42 + 身体 0.34） */
            var gx = Math.round(pos.x / 6.4) * 6.4;
            var gz = Math.round(pos.z / 6.4) * 6.4;
            var ddx = pos.x - gx;
            var ddz = pos.z - gz;
            var dd = Math.hypot(ddx, ddz);
            var minD = 0.42 + 0.34;
            if (dd < minD && dd > 0.0001) {
              pos.x = gx + (ddx / dd) * minD;
              pos.z = gz + (ddz / dd) * minD;
              dirty = true;
            }
          }

          var ty = groundY() + 1.62;
          if (Math.abs(ty - camY) > 0.0005) {
            camY += (ty - camY) * Math.min(1, dt * 5.5);
            dirty = true;
          }
          if (speed > 0.06) {
            bobPhase += dt * speed * 3.1;
            dirty = true;
          }

          checkTrigger();

          /* 白闪衰减：进场时从一片白光里慢慢显影（转场时由转场逻辑接管） */
          if (!tr.active && flash > 0) {
            flash = Math.max(0, flash - Math.min(dtRaw || dt, 0.4) / 1.05);
            dirty = true;
          }

          /* 时间：静止即凝固（世界像一张照片，画面缓慢显影） */
          if (dirty || tr.active) animTime += dt * 0.85;

          if (dirty || tr.active) still = 0;
          else still++;
        }

        /* ---------------- 渲染 ---------------- */
        function bindUnit(unit, tex, prog, name) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          var loc = prog.u[name];
          if (loc) gl.uniform1i(loc, unit);
        }

        function render() {
          var sc = SCENES[sceneIdx];
          var under = (camY < 0.0 && inWater()) ? 1 : 0;

          /* 静止收敛后干脆不画 —— 省电，也让"凝固"更彻底 */
          if (!dirty && !tr.active && still > 13) return;

          gl.bindVertexArray(G.vao);

          var cur = targets.accum[ac];
          var prev = targets.accum[1 - ac];
          var weight = (still === 0 || tr.active) ? 1.0 : 1 / Math.min(still + 1, 13);
          var jit = weight > 0.999 ? [0, 0] : JIT[still % JIT.length];

          gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
          gl.viewport(0, 0, view.w, view.h);
          gl.useProgram(G.scene.p);
          var u = G.scene.u;
          if (u.uRes) gl.uniform2f(u.uRes, view.w, view.h);
          if (u.uJitter) gl.uniform2f(u.uJitter, jit[0], jit[1]);
          if (u.uTime) gl.uniform1f(u.uTime, animTime);
          if (u.uCam) gl.uniform3f(u.uCam, pos.x, camY + Math.sin(bobPhase) * 0.022, pos.z);
          if (u.uRot) gl.uniform2f(u.uRot, yaw, pitch);
          if (u.uFov) gl.uniform1f(u.uFov, sc.fov);
          if (u.uScene) gl.uniform1i(u.uScene, sceneIdx);
          if (u.uSteps) gl.uniform1i(u.uSteps, sc.steps);
          if (u.uNewWeight) gl.uniform1f(u.uNewWeight, weight);
          if (u.uFlash) gl.uniform1f(u.uFlash, flash);
          if (u.uExposure) gl.uniform1f(u.uExposure, sc.exposure * (under ? 1.12 : 1.0));
          if (u.uUnder) gl.uniform1i(u.uUnder, under);

          bindUnit(0, G.texTile, G.scene, "uTile");
          bindUnit(1, G.texWall, G.scene, "uWall");
          bindUnit(2, G.texCarpet, G.scene, "uCarpet");
          bindUnit(3, prev.tex, G.scene, "uPrev");
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          var bw = targets.bloom[0].w;
          var bh = targets.bloom[0].h;
          gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloom[0].fb);
          gl.viewport(0, 0, bw, bh);
          gl.useProgram(G.bright.p);
          bindUnit(0, cur.tex, G.bright, "uSrc");
          if (G.bright.u.uTexel) gl.uniform2f(G.bright.u.uTexel, 8.0 / view.w, 0.0);
          if (G.bright.u.uThreshold) gl.uniform1f(G.bright.u.uThreshold, 0.80);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloom[1].fb);
          gl.useProgram(G.blur.p);
          bindUnit(0, targets.bloom[0].tex, G.blur, "uSrc");
          if (G.blur.u.uTexel) gl.uniform2f(G.blur.u.uTexel, 0.0, 8.0 / view.h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, view.w, view.h);
          gl.useProgram(G.post.p);
          bindUnit(0, cur.tex, G.post, "uSceneTex");
          bindUnit(1, targets.bloom[1].tex, G.post, "uBloomTex");
          bindUnit(2, G.texGrain, G.post, "uGrain");
          if (G.post.u.uRes) gl.uniform2f(G.post.u.uRes, view.w, view.h);
          if (G.post.u.uTime) gl.uniform1f(G.post.u.uTime, animTime);
          if (G.post.u.uBloom) gl.uniform1f(G.post.u.uBloom, 0.34);
          if (G.post.u.uVignette) gl.uniform1f(G.post.u.uVignette, 0.52);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          ac = 1 - ac;
        }

        /* ---------------- 自适应分辨率 ---------------- */
        var frameTimes = [];
        function adapt(dt) {
          if (dt <= 0 || dt > 0.2) return;
          frameTimes.push(dt);
          if (frameTimes.length < 26) return;
          var sorted = frameTimes.slice().sort(function (a, b) { return a - b; });
          var med = sorted[13];
          frameTimes.length = 0;
          if (med > 0.037 && autoScale > 0.36) {
            autoScale = Math.max(0.36, autoScale - 0.055);
            resize();
          } else if (med < 0.0215 && autoScale < baseScale) {
            autoScale = Math.min(baseScale, autoScale + 0.03);
            resize();
          }
        }

        /* ---------------- 主循环 ---------------- */
        function frame(now) {
          if (!running) return;
          var dtRaw = last ? (now - last) / 1000 : 0.016;
          last = now;
          var dt = clamp(dtRaw, 0.0, 0.05);

          if (!paused) {
            update(dt, Math.min(dtRaw, 0.4));
            render();
            if (dirty || tr.active) adapt(dt);
            dirty = false;
          }
          requestAnimationFrame(frame);
        }

        /* 首帧同步跑一次（后台标签页 rAF 会被节流，同步才能保证一定出图） */
        (function () {
        try {
        enterScene(0);
        camY = groundY() + 1.62;
        dirty = true;
        render();
        dirty = false;
        still = 0;
        } catch (e0) {
          onFatal("首帧渲染失败：" + (e0 && e0.message ? e0.message : e0));
          onReport({ ev: "firstfail", msg: String(e0 && e0.message || e0) });
          return;
        }
        onReport({ ev: "first", sz: view.w + "x" + view.h, px: probePixels() });

        onReady({
          scene: function () { return sceneIdx; },
          next: function () { startTransition((sceneIdx + 1) % 3); },
          mute: function (m) { return NS.Audio.setMuted(m); },
          size: function () { return { w: view.w, h: view.h }; },
          /* 诊断：把累积缓冲中心 / 四个角的像素读回来（HDR 浮点） */
          probe: probePixels,
          /* 诊断：强制一帧纯色（验证 canvas 是否真的可见） */
          solid: function () {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, view.w, view.h);
            gl.clearColor(1.0, 0.0, 0.4, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return "solid";
          },
          steps: function () { return SCENES[sceneIdx].steps; }
        });


        /* 诊断接口：仅 ?diag 时挂载（供无屏幕环境下读取画面数值） */
        if (location.search.indexOf('diag') >= 0) {
          window.__LIM = {
            probe: probePixels,
            go: function (i) {
              enterScene(i);
              camY = groundY() + 1.62;
              flash = 0;
              still = 0;
              dirty = true;
              render();
              return 'scene=' + i;
            },
            render: function () { still = 0; dirty = true; render(); return 'ok'; },
            walk: function (n, fwd, side) {
              keys.fwd = !!fwd;
              keys.right = !!side;
              for (var i = 0; i < (n || 60); i++) update(0.016, 0.016);
              keys.fwd = false;
              keys.right = false;
              still = 0;
              dirty = true;
              render();
              return JSON.stringify({
                x: +pos.x.toFixed(2), z: +pos.z.toFixed(2),
                y: +camY.toFixed(2), scene: sceneIdx, flash: +flash.toFixed(2)
              });
            },
            scan: function (cols, rows) {
              cols = cols || 20;
              rows = rows || 10;
              flash = 0;
              still = 0;
              dirty = true;
              render();
              var tgt = targets.accum[ac === 0 ? 1 : 0];
              gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.fb);
              var out = [];
              for (var ry = rows - 1; ry >= 0; ry--) {
                var line = [];
                for (var rx = 0; rx < cols; rx++) {
                  var px = Math.min(view.w - 1, Math.floor((rx + 0.5) / cols * view.w));
                  var py = Math.min(view.h - 1, Math.floor((ry + 0.5) / rows * view.h));
                  var f = new Float32Array(4);
                  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, f);
                  line.push((0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]).toFixed(2));
                }
                out.push(line.join(' '));
              }
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              return out.join('\n');
            },
            info: function () {
              return JSON.stringify({
                sz: view.w + 'x' + view.h,
                scene: sceneIdx,
                ac: ac,
                loss: gl.isContextLost(),
                err: gl.getError(),
                flash: flash,
                x: +pos.x.toFixed(2),
                z: +pos.z.toFixed(2),
                y: +camY.toFixed(2)
              });
            }
          };
        }

        requestAnimationFrame(frame);
        })();
      }).catch(function (err) {
        onFatal(err && err.message ? err.message : String(err));
        onReport({ ev: "fatal", msg: String(err && err.message || err) });
      });
    }
  };
})(window.LIMINAL);