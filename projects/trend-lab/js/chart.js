/* ============================================================
   trend-lab / chart.js —— 手写 canvas 折线引擎
   · 单面板 / 多面板（分面）通用
   · 单调三次插值（Fritsch–Carlson）平滑，不过冲
   · 展开动画、悬停十字线、跨面板同步 tooltip
   · 高 DPI 自适应
   ============================================================ */
(function () {
  "use strict";

  var PALETTE_GRID = "#eceef1";
  var PALETTE_AXIS = "#d8dce2";
  var PALETTE_TEXT = "#9aa1ab";
  var PALETTE_INK = "#1b1e23";

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---- 好看刻度 ---- */
  function niceScale(min, max, want) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { max = min + Math.max(1, Math.abs(min) * 0.1); }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / want) / Math.LN10));
    var err = span / want / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    return { min: lo, max: hi, step: step };
  }

  /* ---- 单调三次插值：返回每一段的控制点 ---- */
  function monotone(pts) {
    var n = pts.length, i;
    var dx = [], dy = [], m = [], t = [];
    for (i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      dy[i] = pts[i + 1].y - pts[i].y;
      m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
    }
    t[0] = m[0] || 0;
    for (i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) t[i] = 0;
      else t[i] = (m[i - 1] + m[i]) / 2;
    }
    t[n - 1] = m[n - 2] || 0;
    for (i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      var a = t[i] / m[i], b = t[i + 1] / m[i];
      var s = a * a + b * b;
      if (s > 9) {
        var tau = 3 / Math.sqrt(s);
        t[i] = tau * a * m[i];
        t[i + 1] = tau * b * m[i];
      }
    }
    return t;
  }

  function Chart(canvas, tipEl) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.tip = tipEl || null;
    this.data = { panels: [], labels: [] };
    this.opts = { smooth: true, area: true, valueFmt: null, dateFmt: null };
    this.hover = -1;
    this.progress = 1;
    this._geo = null;
    this._raf = 0;
    this._animStart = 0;
    this._animDur = 560;
    this._bind();
    var self = this;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.schedule(); });
      this._ro.observe(canvas.parentNode || canvas);
    } else {
      window.addEventListener("resize", function () { self.schedule(); });
    }
  }

  Chart.prototype._bind = function () {
    var self = this;
    var cv = this.cv;

    function pos(e) {
      var r = cv.getBoundingClientRect();
      var cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: cx, y: cy };
    }

    function move(e) {
      if (!self._geo) return;
      var p = pos(e);
      var g = self._geo;
      var idx = Math.round((p.x - g.x0) / Math.max(1e-6, g.stepX));
      idx = clamp(idx, 0, self.data.labels.length - 1);
      var inside = p.x >= g.x0 - 8 && p.x <= g.x1 + 8 && p.y >= g.top && p.y <= g.bottom;
      var next = inside ? idx : -1;
      self._tipPos = p;
      if (next !== self.hover) {
        self.hover = next;
        self.draw();
      } else if (next >= 0) {
        self._placeTip();
      }
    }

    function leave() {
      if (self.hover !== -1) {
        self.hover = -1;
        self.draw();
      }
      if (self.tip) self.tip.classList.remove("on");
    }

    cv.addEventListener("pointermove", move, { passive: true });
    cv.addEventListener("pointerdown", move, { passive: true });
    cv.addEventListener("pointerleave", leave, false);
    cv.addEventListener("pointercancel", leave, false);
  };

  Chart.prototype.update = function (data, opts) {
    this.data = data || { panels: [], labels: [] };
    if (opts) {
      for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) this.opts[k] = opts[k];
    }
    this.hover = -1;
    if (this.tip) this.tip.classList.remove("on");
    this.animate();
  };

  Chart.prototype.animate = function () {
    var self = this;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    if (reduce) {
      this.progress = 1;
      this.schedule();
      return;
    }
    this.progress = 0;
    this._animStart = performance.now();
    if (this._raf) cancelAnimationFrame(this._raf);
    function step(now) {
      var t = clamp((now - self._animStart) / self._animDur, 0, 1);
      // easeOutCubic
      self.progress = 1 - Math.pow(1 - t, 3);
      self.draw();
      if (t < 1) self._raf = requestAnimationFrame(step);
      else { self._raf = 0; self.progress = 1; self.draw(); }
    }
    this._raf = requestAnimationFrame(step);
  };

  Chart.prototype.schedule = function () {
    var self = this;
    if (this._raf2) return;
    this._raf2 = requestAnimationFrame(function () {
      self._raf2 = 0;
      self.draw();
    });
  };

  /* ---------------- 主绘制 ---------------- */
  Chart.prototype.draw = function () {
    var cv = this.cv;
    var host = cv.parentNode || cv;
    var cssW = host.clientWidth || cv.clientWidth || 320;
    var cssH = host.clientHeight || cv.clientHeight || 320;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    var ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var panels = this.data.panels || [];
    var labels = this.data.labels || [];
    if (!panels.length || !labels.length) {
      this._geo = null;
      return;
    }

    var padL = 44, padR = 12, padT = 10, axisH = 24;
    var n = panels.length;
    var gap = n > 1 ? 20 : 0;
    var titleH = n > 1 ? 17 : 0;
    var usableH = cssH - padT - axisH - gap * (n - 1) - titleH * n;
    var panelH = Math.max(46, usableH / n);

    var x0 = padL, x1 = cssW - padR;
    var stepX = labels.length > 1 ? (x1 - x0) / (labels.length - 1) : 0;

    var geo = {
      x0: x0, x1: x1, stepX: stepX, top: padT, bottom: cssH - axisH,
      panels: [], cssW: cssW, cssH: cssH
    };

    var self = this;
    var fmt = this.opts.valueFmt || function (v) { return String(Math.round(v)); };
    var dateFmt = this.opts.dateFmt || function (s) { return s; };
    var prog = this.progress;

    // ---- 每个面板：算范围 ----
    var top = padT;
    panels.forEach(function (p, pi) {
      var y0 = top + titleH;
      var y1 = y0 + panelH;
      var min = Infinity, max = -Infinity;
      p.series.forEach(function (s) {
        for (var i = 0; i < s.data.length; i++) {
          var v = s.data[i];
          if (v == null || !isFinite(v)) continue;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      });
      if (!isFinite(min)) { min = 0; max = 1; }
      if (p.zeroBased !== false && min > 0 && min < max * 0.42) min = 0;
      var sc = niceScale(min, max, n > 1 ? 3 : 4);
      geo.panels.push({ y0: y0, y1: y1, scale: sc, series: p.series, title: p.title, unit: p.unit });
      top = y1 + gap;
    });
    this._geo = geo;

    function yOf(panel, v) {
      var sc = panel.scale;
      var t = (v - sc.min) / (sc.max - sc.min || 1);
      return panel.y1 - clamp(t, -0.05, 1.05) * (panel.y1 - panel.y0);
    }

    // ---- 网格 + y 轴标签 + 面板标题 ----
    ctx.textBaseline = "middle";
    geo.panels.forEach(function (p, pi) {
      var sc = p.scale;
      var ticks = [];
      var v = sc.min;
      var guard = 0;
      while (v <= sc.max + 1e-9 && guard++ < 20) { ticks.push(v); v += sc.step; }
      ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
      ctx.textAlign = "right";
      ticks.forEach(function (tv) {
        var y = Math.round(yOf(p, tv)) + 0.5;
        ctx.beginPath();
        ctx.strokeStyle = tv === 0 ? PALETTE_AXIS : PALETTE_GRID;
        ctx.lineWidth = 1;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.fillStyle = PALETTE_TEXT;
        ctx.fillText(fmt(tv), x0 - 8, y);
      });
      if (titleH) {
        ctx.font = "600 11px ui-sans-serif,system-ui,-apple-system,'Noto Sans CJK SC',sans-serif";
        ctx.fillStyle = "#5d646e";
        ctx.textAlign = "left";
        ctx.fillText(p.title || "", x0, p.y0 - 8);
      }
      // 左右边界淡线
      ctx.beginPath();
      ctx.strokeStyle = PALETTE_AXIS;
      ctx.moveTo(x0, p.y1 + 0.5);
      ctx.lineTo(x1, p.y1 + 0.5);
      ctx.stroke();
      // 单位
      if (p.unit) {
        ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
        ctx.fillStyle = "#b0b6bf";
        ctx.textAlign = "right";
        ctx.fillText(p.unit, x1, p.y0 - 8);
      }
    });

    // ---- x 轴标签 ----
    var lastBottom = geo.panels[geo.panels.length - 1].y1;
    ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
    ctx.fillStyle = PALETTE_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    var maxLabels = Math.max(2, Math.floor((x1 - x0) / 74));
    var stride = Math.ceil(labels.length / maxLabels);
    for (var i = 0; i < labels.length; i += stride) {
      var lx = x0 + stepX * i;
      var txt = dateFmt(labels[i]);
      // 避免贴边
      var tw = ctx.measureText(txt).width;
      if (lx - tw / 2 < 2) lx = tw / 2 + 2;
      if (lx + tw / 2 > cssW - 2) lx = cssW - 2 - tw / 2;
      ctx.fillText(txt, lx, lastBottom + 7);
    }

    // ---- 折线（带展开裁剪） ----
    if (prog < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x0 + (x1 - x0) * prog + 2, cssH);
      ctx.clip();
    }

    geo.panels.forEach(function (p) {
      p.series.forEach(function (s) {
        var pts = [];
        for (var i = 0; i < s.data.length; i++) {
          var v = s.data[i];
          if (v == null || !isFinite(v)) { pts.push(null); continue; }
          pts.push({ x: x0 + stepX * i, y: yOf(p, v), i: i });
        }
        var segs = [];
        var cur = [];
        for (var j = 0; j < pts.length; j++) {
          if (pts[j]) cur.push(pts[j]);
          else if (cur.length) { segs.push(cur); cur = []; }
        }
        if (cur.length) segs.push(cur);

        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        segs.forEach(function (seg) {
          if (seg.length === 1) {
            ctx.beginPath();
            ctx.fillStyle = s.color;
            ctx.arc(seg[0].x, seg[0].y, 1.8, 0, Math.PI * 2);
            ctx.fill();
            return;
          }
          // 路径
          var path = new Path2D();
          if (self.opts.smooth !== false) {
            var t = monotone(seg);
            path.moveTo(seg[0].x, seg[0].y);
            for (var k = 0; k < seg.length - 1; k++) {
              var a = seg[k], b = seg[k + 1];
              var h = (b.x - a.x) / 3;
              path.bezierCurveTo(a.x + h, a.y + t[k] * h, b.x - h, b.y - t[k + 1] * h, b.x, b.y);
            }
          } else {
            path.moveTo(seg[0].x, seg[0].y);
            for (var k2 = 1; k2 < seg.length; k2++) path.lineTo(seg[k2].x, seg[k2].y);
          }

          // 面积
          if (s.area !== false && self.opts.area !== false) {
            var ap = new Path2D(path);
            ap.lineTo(seg[seg.length - 1].x, p.y1);
            ap.lineTo(seg[0].x, p.y1);
            ap.closePath();
            var grad = ctx.createLinearGradient(0, p.y0, 0, p.y1);
            grad.addColorStop(0, hexA(s.color, 0.16));
            grad.addColorStop(1, hexA(s.color, 0));
            ctx.fillStyle = grad;
            ctx.fill(ap);
          }

          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.width || 1.9;
          if (s.dash) ctx.setLineDash(s.dash); else ctx.setLineDash([]);
          ctx.stroke(path);
          ctx.setLineDash([]);
        });
      });
    });

    if (prog < 1) ctx.restore();

    // ---- 悬停 ----
    if (this.hover >= 0 && this.hover < labels.length) {
      var hx = x0 + stepX * this.hover;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = "#c9ced6";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(Math.round(hx) + 0.5, geo.panels[0].y0);
      ctx.lineTo(Math.round(hx) + 0.5, lastBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      geo.panels.forEach(function (p) {
        p.series.forEach(function (s) {
          var v = s.data[self.hover];
          if (v == null || !isFinite(v)) return;
          var y = yOf(p, v);
          ctx.beginPath();
          ctx.fillStyle = "#fff";
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2;
          ctx.arc(hx, y, 3.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      });
      ctx.restore();
      this._placeTip();
    }
  };

  Chart.prototype._placeTip = function () {
    if (!this.tip || !this._geo || this.hover < 0) return;
    var i = this.hover;
    var labels = this.data.labels;
    var fmt = this.opts.valueFmt || function (v) { return String(Math.round(v)); };
    var dateFmt = this.opts.dateFmt || function (s) { return s; };
    var html = '<div class="tt-date">' + dateFmt(labels[i]) + "</div>";
    var self = this;
    this._geo.panels.forEach(function (p) {
      var rows = "";
      p.series.forEach(function (s) {
        var v = s.data[i];
        var show = (v == null || !isFinite(v)) ? "—" : fmt(v);
        rows += '<div class="tt-row"><i style="background:' + s.color + (s.dash ? ";opacity:.55" : "") + '"></i>' +
          '<span class="tt-k">' + esc(s.name) + "</span>" +
          '<b class="tt-v">' + show + (p.unit && v != null ? '<em>' + p.unit + "</em>" : "") + "</b></div>";
      });
      html += (p.title ? '<div class="tt-p">' + esc(p.title) + "</div>" : "") + rows;
    });
    this.tip.innerHTML = html;
    this.tip.classList.add("on");

    var host = this.cv.parentNode || this.cv;
    var hostRect = host.getBoundingClientRect();
    var pos = this._tipPos || { x: 0, y: 0 };
    var tw = this.tip.offsetWidth;
    var th = this.tip.offsetHeight;
    var left = pos.x + 16;
    if (left + tw > hostRect.width - 6) left = pos.x - tw - 16;
    if (left < 6) left = 6;
    var topY = pos.y - th / 2;
    topY = clamp(topY, 4, Math.max(4, hostRect.height - th - 4));
    this.tip.style.left = Math.round(left) + "px";
    this.tip.style.top = Math.round(topY) + "px";
  };

  function hexA(hex, a) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      if (c === "\u0026") return "\u0026amp;";
      if (c === "<") return "\u0026lt;";
      if (c === ">") return "\u0026gt;";
      return "\u0026#34;";
    });
  }

  window.TrendChart = Chart;
})();
