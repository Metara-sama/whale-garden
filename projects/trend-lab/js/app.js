/* ============================================================
   trend-lab / app.js  （v2：任意词 · 8 平台 · 无抓取）
   ============================================================ */
(function () {
  "use strict";

  var M = window.TrendModel;
  var ND = M.DAYS;
  var $ = function (id) { return document.getElementById(id); };

  var WORD_COLORS = ["#17191d", "#3f6ad8", "#e2637f"];
  var DASHES = [null, [6, 4], [2, 3]];
  var PREF_KEY = "wg-trend-v2";

  var S = {
    words: [],
    plats: ["baidu", "weibo", "douyin", "bili", "xhs"],
    mode: "merge",
    grain: "day",
    norm: false,
    quick: "30",
    range: [ND - 30, ND - 1],
    hidden: {}
  };

  var chart, chartWrap;

  /* ---------------- 工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function compact(v) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, "") + "亿";
    if (a >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    if (a >= 1000) return String(Math.round(v));
    if (a >= 10) return String(Math.round(v));
    return v.toFixed(1).replace(/\.0$/, "");
  }

  function mmdd(iso) { return iso.slice(5).replace("-", "/"); }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        words: S.words, plats: S.plats, mode: S.mode,
        grain: S.grain, norm: S.norm, quick: S.quick, range: S.range
      }));
    } catch (e) {}
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o.words && o.words.length) {
        S.words = o.words.filter(function (w) { return typeof w === "string" && w.trim(); }).slice(0, 3);
      }
      if (o.plats && o.plats.length) {
        S.plats = o.plats.filter(function (p) { return !!M.plat(p); });
      }
      if (!S.plats.length) S.plats = ["baidu", "weibo", "douyin", "bili", "xhs"];
      if (o.mode) S.mode = o.mode;
      if (o.grain) S.grain = o.grain;
      if (o.norm != null) S.norm = !!o.norm;
      if (o.quick) S.quick = o.quick;
      if (o.range && o.range.length === 2) {
        S.range = [clamp(o.range[0] | 0, 0, ND - 1), clamp(o.range[1] | 0, 0, ND - 1)];
        if (S.range[0] > S.range[1]) S.range = [0, ND - 1];
      }
    } catch (e) {}
  }

  /* ---------------- 数据整形 ---------------- */
  function agg(arr, s, e, grain) {
    if (grain === "day") return arr.slice(s, e + 1);
    var out = [];
    for (var i = s; i <= e; i += 7) {
      var end = Math.min(i + 6, e), sum = 0, n = 0;
      for (var j = i; j <= end; j++) { sum += arr[j]; n++; }
      out.push(n ? sum / n : null);
    }
    return out;
  }

  function labelsFor() {
    var s = S.range[0], e = S.range[1], out = [];
    if (S.grain === "day") { for (var i = s; i <= e; i++) out.push(M.days[i]); }
    else { for (var k = s; k <= e; k += 7) out.push(M.days[k]); }
    return out;
  }

  function lineOf(word, pid) {
    var arr = M.series(word, pid);
    return arr ? agg(arr, S.range[0], S.range[1], S.grain) : null;
  }

  /* ---------------- 组视图 ---------------- */
  function build() {
    var labels = labelsFor();
    var n = labels.length;
    var words = S.words.slice();
    var plats = S.plats.slice();
    var unit = S.norm ? null : (S.grain === "day" ? "次/日" : "次/日·7日均");
    var panels = [];

    if (S.mode === "merge") {
      panels.push({
        title: "", unit: unit,
        series: words.map(function (w, wi) {
          var arr = new Array(n);
          for (var i = 0; i < n; i++) arr[i] = plats.length ? 0 : null;
          plats.forEach(function (pid) {
            var a = lineOf(w, pid);
            if (!a) return;
            for (var i = 0; i < n; i++) {
              if (a[i] == null) continue;
              arr[i] = (arr[i] == null ? 0 : arr[i]) + a[i];
            }
          });
          return {
            key: "w|" + w, name: w, color: WORD_COLORS[wi % WORD_COLORS.length],
            data: arr, width: 1.9
          };
        })
      });
    } else if (S.mode === "split") {
      var sers = [];
      words.forEach(function (w, wi) {
        plats.forEach(function (pid) {
          sers.push({
            key: "w|" + w + "|" + pid,
            name: words.length > 1 ? w + " · " + M.plat(pid).name : M.plat(pid).name,
            group: M.plat(pid).name,
            color: M.plat(pid).color,
            dash: words.length > 1 ? DASHES[wi % DASHES.length] : null,
            width: words.length > 1 ? 1.6 : 2,
            data: lineOf(w, pid)
          });
        });
      });
      panels.push({ title: "", unit: unit, series: sers });
    } else {
      plats.forEach(function (pid) {
        panels.push({
          title: M.plat(pid).name,
          unit: unit,
          series: words.map(function (w, wi) {
            return {
              key: "w|" + w + "|" + pid, name: w,
              color: WORD_COLORS[wi % WORD_COLORS.length],
              data: lineOf(w, pid), width: 1.9
            };
          })
        });
      });
    }

    /* 归一化：每条线以区间均值 = 100 */
    if (S.norm) {
      panels.forEach(function (p) {
        p.unit = "指数";
        p.series.forEach(function (s) {
          var sum = 0, cnt = 0;
          s.data.forEach(function (v) { if (v != null && isFinite(v)) { sum += v; cnt++; } });
          var mean = cnt ? sum / cnt : 1;
          s.data = s.data.map(function (v) { return v == null ? null : (mean ? v / mean * 100 : 0); });
        });
      });
    }

    /* 线多了就不铺面积 */
    var total = 0;
    panels.forEach(function (p) { total += p.series.length; });
    if (total > 3) {
      panels.forEach(function (p) {
        p.series.forEach(function (s) { s.area = false; });
      });
    }

    /* 隐藏 */
    panels.forEach(function (p) {
      p.series = p.series.filter(function (s) { return !S.hidden[s.key]; });
    });

    return { labels: labels, panels: panels };
  }

  /* ---------------- 统计 ---------------- */
  function stats() {
    var s = S.range[0], e = S.range[1];
    var nDays = e - s + 1;
    var words = S.words, plats = S.plats;
    if (!words.length || !plats.length) return null;

    var byDay = new Array(nDays);
    for (var i = 0; i < nDays; i++) byDay[i] = 0;
    var grand = 0;

    words.forEach(function (w) {
      plats.forEach(function (pid) {
        var arr = M.series(w, pid);
        if (!arr) return;
        for (var i = 0; i < nDays; i++) {
          byDay[i] += arr[s + i];
          grand += arr[s + i];
        }
      });
    });

    var peakI = 0;
    for (var k = 1; k < nDays; k++) if (byDay[k] > byDay[peakI]) peakI = k;

    var half = Math.floor(nDays / 2);
    var a = 0, b = 0;
    for (var x = 0; x < half; x++) a += byDay[x];
    for (var y = nDays - half; y < nDays; y++) b += byDay[y];
    var slope = a ? (b / (half || 1) - a / (half || 1)) / (a / (half || 1)) * 100 : 0;

    return {
      total: grand, peakDay: M.days[s + peakI], peakVal: byDay[peakI],
      slope: slope, days: nDays
    };
  }

  /* ---------------- 渲染 ---------------- */
  function renderChips() {
    var wrap = $("wordChips");
    wrap.innerHTML = "";
    S.words.forEach(function (w) {
      var el = document.createElement("span");
      el.className = "chip";
      var t = document.createElement("span");
      t.textContent = w;
      var x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", "移除 " + w);
      x.addEventListener("click", function () { removeWord(w); });
      el.appendChild(t);
      el.appendChild(x);
      wrap.appendChild(el);
    });
  }

  function renderPlats() {
    var wrap = $("platChips");
    wrap.innerHTML = "";
    M.PLATS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pt" + (S.plats.indexOf(p.id) >= 0 ? " on" : "");
      b.innerHTML = '<i style="color:' + p.color + '"></i>' + p.name;
      b.addEventListener("click", function () { togglePlat(p.id); });
      wrap.appendChild(b);
    });
  }

  function renderSegs() {
    Array.prototype.forEach.call(document.querySelectorAll("#segView button"), function (b) {
      b.classList.toggle("on", b.dataset.mode === S.mode);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#grainSeg button"), function (b) {
      b.classList.toggle("on", b.dataset.grain === S.grain);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#quickBar button"), function (b) {
      b.classList.toggle("on", b.dataset.quick === S.quick);
    });
    $("normChk").classList.toggle("on", S.norm);
  }

  function renderRange() {
    var s = S.range[0], e = S.range[1];
    $("rA").value = s;
    $("rB").value = e;
    var p1 = s / (ND - 1) * 100, p2 = e / (ND - 1) * 100;
    $("rngFill").style.left = p1 + "%";
    $("rngFill").style.width = (p2 - p1) + "%";
    $("rngText").textContent = M.days[s] + " → " + M.days[e] + " · " + (e - s + 1) + " 天";
  }

  function renderStats(st) {
    if (!st) {
      $("kTotal").textContent = "—";
      $("kPeak").textContent = "—";
      $("kSlope").textContent = "—";
      $("kSlope").className = "";
      return;
    }
    $("kTotal").textContent = compact(st.total);
    $("kPeak").textContent = mmdd(st.peakDay);
    var up = st.slope >= 0;
    $("kSlope").textContent = (up ? "+" : "") + st.slope.toFixed(1) + "%";
    $("kSlope").className = up ? "up" : "down";
  }

  function renderLegend(view) {
    var wrap = $("legend");
    wrap.innerHTML = "";

    /* 按图例分组键归并：合计/分面按词，分平台按平台 */
    var groups = [], byName = {};
    view.panels.forEach(function (p) {
      p.series.forEach(function (s) {
        var nm = s.group || s.name;
        var g = byName[nm];
        if (!g) {
          g = byName[nm] = { name: nm, color: s.color, keys: [] };
          groups.push(g);
        }
        g.keys.push(s.key);
      });
    });

    /* 已隐藏的按同一个「组标签」合并成一条，点一下全恢复 */
    function keyLabel(k) {
      var p = k.split("|");
      return p.length > 2 ? p[1] + " · " + M.plat(p[2]).name : p[1];
    }
    var hiddenLabels = [];
    Object.keys(S.hidden).forEach(function (k) {
      if (!S.hidden[k]) return;
      var nm = keyLabel(k);
      if (hiddenLabels.indexOf(nm) < 0) hiddenLabels.push(nm);
    });

    if (groups.length + hiddenLabels.length < 2) return;   /* 一条线不用图例 */

    groups.forEach(function (g) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lg";
      b.innerHTML = '<span class="lg-line" style="--c:' + g.color + '"></span>' + g.name;
      b.addEventListener("click", function () {
        g.keys.forEach(function (k) { S.hidden[k] = true; });
        savePrefs();
        refresh();
      });
      wrap.appendChild(b);
    });

    hiddenLabels.forEach(function (nm) {
      var b2 = document.createElement("button");
      b2.type = "button";
      b2.className = "lg off";
      b2.innerHTML = '<span class="lg-line" style="--c:#c8ccd3"></span>' + nm;
      b2.addEventListener("click", function () {
        Object.keys(S.hidden).forEach(function (k) {
          if (keyLabel(k) === nm) S.hidden[k] = false;
        });
        savePrefs();
        refresh();
      });
      wrap.appendChild(b2);
    });
  }

  function chartHeight() {
    var mobile = (window.innerWidth || 360) < 700;
    if (S.mode === "facet") {
      var per = mobile ? 78 : 92;
      return clamp(S.plats.length * per + 46, mobile ? 240 : 300, 900);
    }
    return mobile ? 280 : 340;
  }

  /* ---------------- 主刷新 ---------------- */
  function refresh() {
    var hasWord = S.words.length > 0;
    var view = hasWord ? build() : { labels: [], panels: [] };
    $("emptyHint").classList.toggle("on", !hasWord || !S.plats.length);

    chartWrap.style.height = chartHeight() + "px";
    chart.update(view, {
      valueFmt: function (v) { return compact(v); },
      dateFmt: function (iso) { return mmdd(iso); }
    });

    renderLegend(view);
    renderStats(stats());
    renderRange();
    renderSegs();
    renderChips();
    renderPlats();

    var sel = S.plats.length;
    $("topMeta").textContent = "8 平台 · " + ND + " 天" + (sel < 8 ? " · 选了 " + sel + " 个" : "");
    savePrefs();
  }

  /* ---------------- 词 ---------------- */
  function addWords(text) {
    var parts = String(text || "").split(/[,，、\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return;
    var added = 0, dup = 0, full = 0;
    parts.forEach(function (w) {
      if (w.length > 24) w = w.slice(0, 24);
      if (S.words.indexOf(w) >= 0) { dup++; return; }
      if (S.words.length >= 3) { full++; return; }
      S.words.push(w);
      added++;
    });
    S.hidden = {};
    $("wordIn").value = "";
    if (full) flash("最多同时看 3 个词");
    else if (!added && dup) flash("这个词已经在图里了");
    refresh();
  }

  function removeWord(w) {
    var i = S.words.indexOf(w);
    if (i >= 0) S.words.splice(i, 1);
    S.hidden = {};
    refresh();
  }

  function togglePlat(id) {
    var i = S.plats.indexOf(id);
    if (i >= 0) {
      if (S.plats.length === 1) { flash("至少留一个平台"); return; }
      S.plats.splice(i, 1);
    } else {
      S.plats.push(id);
      S.plats.sort(function (a, b) {
        return M.PLATS.findIndex(function (p) { return p.id === a; }) -
          M.PLATS.findIndex(function (p) { return p.id === b; });
      });
    }
    S.hidden = {};
    refresh();
  }

  var flashTimer = 0;
  function flash(msg) {
    var el = $("flashMsg");
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove("on"); }, 1800);
  }

  function applyQuick(q) {
    S.quick = q;
    if (q === "all") S.range = [0, ND - 1];
    else {
      var n = parseInt(q, 10);
      S.range = [Math.max(0, ND - n), ND - 1];
    }
    refresh();
  }

  function syncRange(which) {
    var a = parseInt($("rA").value, 10), b = parseInt($("rB").value, 10);
    if (a > b - 2) {
      if (which === "a") { a = b - 2; $("rA").value = a; }
      else { b = a + 2; $("rB").value = b; }
    }
    S.range = [clamp(a, 0, ND - 1), clamp(b, 0, ND - 1)];
    S.quick = "custom";
    refresh();
  }

  /* ---------------- 导出 ---------------- */
  function download(name, blobOrUrl) {
    var a = document.createElement("a");
    a.download = name;
    if (typeof blobOrUrl === "string") a.href = blobOrUrl;
    else a.href = URL.createObjectURL(blobOrUrl);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (typeof blobOrUrl !== "string") URL.revokeObjectURL(a.href);
      a.remove();
    }, 800);
  }

  function exportPNG() {
    if (!S.words.length) { flash("先加个词"); return; }
    var src = $("chartCv");
    var tmp = document.createElement("canvas");
    tmp.width = src.width; tmp.height = src.height;
    var c = tmp.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, tmp.width, tmp.height);
    c.drawImage(src, 0, 0);
    download("trend-lab.png", tmp.toDataURL("image/png"));
  }

  function exportCSV() {
    if (!S.words.length) { flash("先加个词"); return; }
    var view = build();
    var head = ["date"], rows = [];
    view.panels.forEach(function (p) {
      p.series.forEach(function (s) { head.push((p.title ? p.title + " " : "") + s.name); });
    });
    rows.push(head.join(","));
    view.labels.forEach(function (lab, i) {
      var row = [lab];
      view.panels.forEach(function (p) {
        p.series.forEach(function (s) {
          var v = s.data[i];
          row.push(v == null ? "" : Math.round(v * 100) / 100);
        });
      });
      rows.push(row.join(","));
    });
    download("trend-lab.csv", new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" }));
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    chartWrap = $("chartWrap");
    chart = new window.TrendChart($("chartCv"), $("chartTip"));
    loadPrefs();

    $("wordAdd").addEventListener("click", function () { addWords($("wordIn").value); });
    $("wordIn").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addWords($("wordIn").value); }
    });
    $("platAll").addEventListener("click", function () {
      S.plats = S.plats.length === M.PLATS.length ? [M.PLATS[0].id] : M.PLATS.map(function (p) { return p.id; });
      S.hidden = {};
      refresh();
    });

    Array.prototype.forEach.call(document.querySelectorAll("#segView button"), function (b) {
      b.addEventListener("click", function () {
        S.mode = b.dataset.mode;
        S.hidden = {};
        refresh();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#grainSeg button"), function (b) {
      b.addEventListener("click", function () { S.grain = b.dataset.grain; refresh(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#quickBar button"), function (b) {
      b.addEventListener("click", function () { applyQuick(b.dataset.quick); });
    });
    $("normChk").addEventListener("click", function () { S.norm = !S.norm; refresh(); });

    $("rA").addEventListener("input", function () { syncRange("a"); });
    $("rB").addEventListener("input", function () { syncRange("b"); });
    ["rA", "rB"].forEach(function (id) {
      var el = $(id);
      el.addEventListener("pointerdown", function () { el.classList.add("drag"); });
      el.addEventListener("pointerup", function () { el.classList.remove("drag"); });
    });

    $("dlPng").addEventListener("click", exportPNG);
    $("dlCsv").addEventListener("click", exportCSV);

    window.addEventListener("resize", function () {
      chartWrap.style.height = chartHeight() + "px";
      chart.schedule();
    });

    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();