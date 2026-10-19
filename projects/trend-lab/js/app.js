/* ============================================================
   trend-lab / app.js —— 状态、聚合、交互、抓取联动
   ============================================================ */
(function () {
  "use strict";

  var D = window.TREND_DATA;
  var LIVE = window.TrendLive;
  var $ = function (id) { return document.getElementById(id); };

  var PBY = {};
  D.platforms.forEach(function (p) { PBY[p.id] = p; });

  var WORD_COLORS = ["#16181c", "#3f6ad8", "#e2637f", "#2f9e7d"];
  var DASHES = [null, [6, 4], [2, 3], [9, 3, 2, 3]];
  var PREF_KEY = "wg-trend-prefs";
  var ND = D.days.length;

  var S = {
    words: ["双十一", "考研", "台风"],
    plats: D.platforms.map(function (p) { return p.id; }),
    mode: "merge",
    grain: "day",
    norm: false,
    quick: "30",
    range: [ND - 30, ND - 1],
    hidden: {},
    snap: null
  };

  var chart, tip, chartWrap;

  /* ---------------- 小工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function compact(v) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, "") + "亿";
    if (a >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    if (a >= 1000) return String(Math.round(v));
    if (a >= 10) return String(Math.round(v));
    return v.toFixed(a < 1 ? 2 : 1).replace(/\.0+$/, "");
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
      if (o.words && o.words.length) S.words = o.words.filter(function (w) { return D.words.indexOf(w) >= 0; }).slice(0, 3);
      if (!S.words.length) S.words = ["考研"];
      if (o.plats && o.plats.length) S.plats = o.plats.filter(function (p) { return !!PBY[p]; });
      if (!S.plats.length) S.plats = D.platforms.map(function (p) { return p.id; });
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

  /* ---------------- 聚合 ---------------- */
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
    if (S.grain === "day") { for (var i = s; i <= e; i++) out.push(D.days[i]); }
    else { for (var k = s; k <= e; k += 7) out.push(D.days[k]); }
    return out;
  }

  function raw(word, plat) {
    var wi = D.words.indexOf(word);
    if (wi < 0 || !D.series[plat]) return null;
    return D.series[plat][wi];
  }

  function lineOf(word, plat) {
    var r = raw(word, plat);
    return r ? agg(r, S.range[0], S.range[1], S.grain) : null;
  }

  /* ---------------- 构造视图 ---------------- */
  function build() {
    var labels = labelsFor();
    var n = labels.length;
    var words = S.words.slice();
    var plats = S.plats.slice();
    var unit = S.norm ? null : (S.grain === "day" ? "次/日" : "次/日·7日均");
    var panels = [];

    if (S.mode === "merge") {
      var sers = words.map(function (w, wi) {
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
          data: arr, area: words.length === 1, width: 2
        };
      });
      panels.push({ title: "", unit: unit, series: sers });
    } else if (S.mode === "split") {
      var sers2 = [];
      words.forEach(function (w, wi) {
        plats.forEach(function (pid) {
          sers2.push({
            key: "w|" + w + "|" + pid,
            name: words.length > 1 ? w + " · " + PBY[pid].name : PBY[pid].name,
            color: PBY[pid].color,
            dash: words.length > 1 ? DASHES[wi % DASHES.length] : null,
            width: words.length > 1 ? 1.7 : 2.1,
            data: lineOf(w, pid)
          });
        });
      });
      panels.push({ title: "", unit: unit, series: sers2 });
    } else {
      plats.forEach(function (pid) {
        panels.push({
          title: PBY[pid].name,
          unit: unit,
          series: words.map(function (w, wi) {
            return {
              key: "w|" + w + "|" + pid, name: w, color: WORD_COLORS[wi % WORD_COLORS.length],
              data: lineOf(w, pid), area: words.length === 1, width: 2
            };
          })
        });
      });
    }

    // 归一化：每条线以区间均值为 100
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

    // 隐藏
    panels.forEach(function (p) {
      p.series = p.series.filter(function (s) { return !S.hidden[s.key]; });
    });

    return { labels: labels, panels: panels };
  }

  /* ---------------- 统计 ---------------- */
  function stats() {
    var s = S.range[0], e = S.range[1];
    var nDays = e - s + 1;
    var words = S.words.slice();
    var plats = S.plats.slice();
    var byDay = new Array(nDays);
    for (var i = 0; i < nDays; i++) byDay[i] = 0;
    var perPlat = {};
    plats.forEach(function (p) { perPlat[p] = 0; });
    var grand = 0;

    words.forEach(function (w) {
      plats.forEach(function (pid) {
        var r = raw(w, pid);
        if (!r) return;
        for (var i = 0; i < nDays; i++) {
          var v = r[s + i];
          byDay[i] += v;
          perPlat[pid] += v;
          grand += v;
        }
      });
    });

    var peakI = 0;
    for (var k = 1; k < nDays; k++) if (byDay[k] > byDay[peakI]) peakI = k;

    var half = Math.floor(nDays / 2);
    var firstSum = 0, secondSum = 0;
    for (var a = 0; a < half; a++) firstSum += byDay[a];
    for (var b = nDays - half; b < nDays; b++) secondSum += byDay[b];
    var firstAvg = half ? firstSum / half : 0;
    var secondAvg = half ? secondSum / half : 0;
    var slope = firstAvg ? (secondAvg - firstAvg) / firstAvg * 100 : 0;

    var shares = plats.map(function (pid) {
      return { id: pid, name: PBY[pid].name, color: PBY[pid].color, v: perPlat[pid], pct: grand ? perPlat[pid] / grand * 100 : 0 };
    }).sort(function (x, y) { return y.v - x.v; });

    return { total: grand, peakDay: D.days[s + peakI], peakVal: byDay[peakI], slope: slope, days: nDays, shares: shares };
  }

  /* ---------------- 渲染 ---------------- */
  function renderChips() {
    var wrap = $("wordChips");
    var q = ($("wordFilter").value || "").trim();
    wrap.innerHTML = "";
    D.words.forEach(function (w) {
      if (q && w.toLowerCase().indexOf(q.toLowerCase()) < 0) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (S.words.indexOf(w) >= 0 ? " on" : "");
      b.textContent = w;
      b.addEventListener("click", function () { toggleWord(w); });
      wrap.appendChild(b);
    });
    if (!wrap.children.length) wrap.innerHTML = '<span class="chip-none">没有匹配的词</span>';
  }

  function renderPlats() {
    var wrap = $("platChips");
    wrap.innerHTML = "";
    D.platforms.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pt" + (S.plats.indexOf(p.id) >= 0 ? " on" : "");
      b.innerHTML = '<i style="background:' + p.color + '"></i>' + p.name;
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
    var lo = 0, hi = ND - 1;
    $("rA").value = s;
    $("rB").value = e;
    var p1 = (s - lo) / (hi - lo) * 100;
    var p2 = (e - lo) / (hi - lo) * 100;
    $("rngFill").style.left = p1 + "%";
    $("rngFill").style.width = (p2 - p1) + "%";
    $("rngText").textContent = D.days[s] + " → " + D.days[e] + " · " + (e - s + 1) + " 天";
  }

  function renderLegend(view) {
    var wrap = $("legend");
    wrap.innerHTML = "";
    var seen = {};
    view.panels.forEach(function (p) {
      p.series.forEach(function (s) {
        if (seen[s.key]) return;
        seen[s.key] = 1;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "lg" + (S.hidden[s.key] ? " off" : "");
        b.innerHTML = '<span class="lg-line" style="--c:' + s.color + '"></span>' + s.name;
        b.title = "点一下隐藏 / 显示";
        b.addEventListener("click", function () {
          S.hidden[s.key] = !S.hidden[s.key];
          savePrefs();
          refresh(true);
        });
        wrap.appendChild(b);
      });
    });
    // 已隐藏的也列出来，方便点回来
    Object.keys(S.hidden).forEach(function (k) {
      if (!S.hidden[k] || seen[k]) return;
      seen[k] = 1;
      var name = k.split("|").slice(1).join(" · ");
      var b2 = document.createElement("button");
      b2.type = "button";
      b2.className = "lg off";
      b2.innerHTML = '<span class="lg-line" style="--c:#c6cbd3"></span>' + name;
      b2.addEventListener("click", function () {
        S.hidden[k] = false;
        savePrefs();
        refresh(true);
      });
      wrap.appendChild(b2);
    });
  }

  function countUpTo(el, to, fmt) {
    var from = parseFloat(el.dataset.v || "0");
    el.dataset.v = to;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
      el.textContent = fmt(to);
      return;
    }
    var t0 = performance.now(), dur = 420;
    function step(now) {
      var t = clamp((now - t0) / dur, 0, 1);
      var e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = fmt(to);
    }
    requestAnimationFrame(step);
  }

  function renderKPI(st) {
    countUpTo($("kTotal"), st.total, compact);
    $("kTotalSub").textContent = st.days + " 天 · " + S.words.length + " 词 · " + S.plats.length + " 平台合计";
    $("kPeak").textContent = mmdd(st.peakDay);
    $("kPeakSub").textContent = "峰值 " + compact(st.peakVal) + " 次";
    var up = st.slope >= 0;
    $("kSlope").textContent = (up ? "+" : "") + st.slope.toFixed(1) + "%";
    $("kSlope").className = "kpi-num " + (up ? "up" : "down");
    $("kSlopeSub").textContent = "后半段 vs 前半段";

    var bar = $("shareBar");
    bar.innerHTML = "";
    st.shares.forEach(function (s) {
      if (s.pct <= 0) return;
      var d = document.createElement("span");
      d.style.width = s.pct + "%";
      d.style.background = s.color;
      d.title = s.name + " " + s.pct.toFixed(1) + "%";
      bar.appendChild(d);
    });
    $("shareText").innerHTML = st.shares.map(function (s) {
      return '<span class="sh"><i style="background:' + s.color + '"></i>' + s.name +
        " <b>" + s.pct.toFixed(1) + "%</b></span>";
    }).join("");
  }

  function renderCaption() {
    var parts = [];
    parts.push(S.mode === "merge" ? "各平台相加" : (S.mode === "split" ? "同一坐标系分平台" : "一平台一面板"));
    if (S.plats.length < 3) {
      parts.push("只算 " + S.plats.map(function (p) { return PBY[p].name; }).join(" / "));
    }
    if (S.grain === "week") parts.push("7 天均值聚合，点标在周期首日");
    if (S.norm) parts.push("每条线以自身区间均值 = 100");
    $("capLine").textContent = parts.join(" · ");
  }

  function chartHeight() {
    var w = window.innerWidth || 360;
    if (S.mode === "facet") return w < 700 ? 460 : 520;
    return w < 700 ? 280 : 360;
  }

  /* ---------------- 主刷新 ---------------- */
  function refresh(keepAnim) {
    var view = build();
    if (!view.panels.length) view.panels = [{ title: "", unit: null, series: [] }];
    var vis = view.panels.some(function (p) { return p.series.length; });
    $("emptyHint").classList.toggle("on", !vis);

    chartWrap.style.height = chartHeight() + "px";
    chart.update(view, {
      valueFmt: function (v) { return compact(v); },
      dateFmt: function (iso) { return mmdd(iso); }
    });

    renderLegend(view);
    renderKPI(stats());
    renderCaption();
    renderRange();
    renderSegs();
    renderChips();
    renderPlats();
    savePrefs();
  }

  /* ---------------- 交互 ---------------- */
  function toggleWord(w) {
    var i = S.words.indexOf(w);
    if (i >= 0) {
      if (S.words.length === 1) { flash("至少留一个词"); return; }
      S.words.splice(i, 1);
    } else {
      if (S.words.length >= 3) { flash("最多同时比 3 个词"); return; }
      S.words.push(w);
    }
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
        return D.platforms.findIndex(function (p) { return p.id === a; }) -
          D.platforms.findIndex(function (p) { return p.id === b; });
      });
    }
    S.hidden = {};
    if (S.mode === "facet" && !S.plats.length) S.plats = [D.platforms[0].id];
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

  function syncRangeInputs() {
    var a = parseInt($("rA").value, 10), b = parseInt($("rB").value, 10);
    if (a > b - 2) {
      // 保证至少 3 个点
      if (this === $("rA")) a = b - 2; else b = a + 2;
      $("rA").value = a; $("rB").value = b;
    }
    S.range = [clamp(a, 0, ND - 1), clamp(b, 0, ND - 1)];
    S.quick = "custom";
    refresh();
  }

  /* ---------------- 实时快照 ---------------- */
  function renderLive() {
    var box = $("liveOut");
    var snap = S.snap;
    if (!snap) {
      box.innerHTML = "";
      $("liveMeta").textContent = "";
      return;
    }
    var html = "";
    var okCount = 0;
    LIVE.PLATS.forEach(function (p) {
      var r = snap.plats[p.id];
      if (!r) return;
      if (r.ok) okCount++;
      var hits = r.hits || {};
      var rows = Object.keys(hits).filter(function (w) { return hits[w] > 0; })
        .sort(function (x, y) { return hits[y] - hits[x]; })
        .map(function (w) { return '<span class="hit">' + w + "<b>" + hits[w] + "</b></span>"; })
        .join("");
      html += '<div class="lp">' +
        '<div class="lp-h"><b>' + p.name + "</b>" +
        '<span class="lp-via">' + (r.ok ? (r.via + " · " + (r.items ? r.items.length : 0) + " 条") : "失败：" + (r.err || "未知")) + "</span></div>" +
        '<div class="lp-hits">' + (r.ok ? (rows || '<span class="dim">这 ' + D.words.length + " 个词今天 0 命中 —— 热搜日更，词库固定所以常常撞不上</span>") : '<span class="dim">这一家没抓到，可用下面的粘贴导入</span>') + "</div>" +
        (r.items && r.items.length
          ? '<details class="lp-raw"><summary>原始榜单 ' + r.items.length + " 条</summary><div class=\"raw-list\">" +
          r.items.slice(0, 40).map(function (t, i) { return (i + 1) + ". " + escapeHtml(t); }).join("<br>") +
          "</div></details>"
          : "") +
        "</div>";
    });
    box.innerHTML = html;
    $("liveDot").classList.toggle("on", okCount > 0);
    $("topMeta").textContent = okCount > 0
      ? "140 天 · 3 平台 · 18 词 · 含 " + snap.date + " 快照"
      : "140 天 · 3 平台 · 18 词";
    $("liveMeta").textContent = "快照日期 " + snap.date + " · 词频口径 = 目标词在榜单标题里的命中条数（不并入历史曲线）";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      if (c === "\u0026") return "\u0026amp;";
      if (c === "<") return "\u0026lt;";
      if (c === ">") return "\u0026gt;";
      return "\u0026#34;";
    });
  }

  function runFetch() {
    var btn = $("liveBtn");
    if (btn.disabled) return;
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = "抓取中…";
    var log = [];
    $("liveMeta").textContent = "开始抓取…";
    var out = { date: LIVE.todayISO(), plats: {} };

    Promise.all(LIVE.PLATS.map(function (p) {
      return LIVE.fetchPlatform(p, function (note) {
        log.push(p.name + " " + note);
        $("liveMeta").textContent = log.slice(-3).join("  |  ");
      }).then(function (r) {
        out.plats[p.id] = { ok: true, via: r.via, items: r.items, hits: LIVE.countHits(r.items, D.words) };
      }).catch(function (e) {
        out.plats[p.id] = { ok: false, err: e.message, items: [], hits: {} };
      });
    })).then(function () {
      var okCount = Object.keys(out.plats).filter(function (k) { return out.plats[k].ok; }).length;
      S.snap = out;
      LIVE.saveSnapshot(out);
      renderLive();
      btn.disabled = false;
      btn.textContent = old;
      $("liveMeta").textContent = okCount
        ? "抓到 " + okCount + "/3 家 · 快照日期 " + out.date
        : "三家都没抓到（CORS 或代理被墙）。用下面的粘贴导入一样能算。";
    });
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
    var src = $("chartCv");
    var tmp = document.createElement("canvas");
    tmp.width = src.width; tmp.height = src.height;
    var c = tmp.getContext("2d");
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, tmp.width, tmp.height);
    c.drawImage(src, 0, 0);
    var url = tmp.toDataURL("image/png");
    download("trend-lab-" + S.range[0] + "-" + S.range[1] + ".png", url);
  }

  function exportCSV() {
    var view = build();
    var lines = [];
    var head = ["date"];
    view.panels.forEach(function (p) {
      p.series.forEach(function (s) { head.push((p.title ? p.title + " " : "") + s.name); });
    });
    lines.push(head.join(","));
    view.labels.forEach(function (lab, i) {
      var row = [lab];
      view.panels.forEach(function (p) {
        p.series.forEach(function (s) {
          var v = s.data[i];
          row.push(v == null ? "" : Math.round(v * 100) / 100);
        });
      });
      lines.push(row.join(","));
    });
    download("trend-lab.csv", new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    chartWrap = $("chartWrap");
    tip = $("chartTip");
    chart = new window.TrendChart($("chartCv"), tip);

    loadPrefs();
    S.snap = LIVE.loadSnapshot();

    // 词 / 平台
    $("wordFilter").addEventListener("input", renderChips);

    Array.prototype.forEach.call(document.querySelectorAll("#segView button"), function (b) {
      b.addEventListener("click", function () {
        S.mode = b.dataset.mode;
        S.hidden = {};
        refresh();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#grainSeg button"), function (b) {
      b.addEventListener("click", function () {
        S.grain = b.dataset.grain;
        refresh();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#quickBar button"), function (b) {
      b.addEventListener("click", function () { applyQuick(b.dataset.quick); });
    });
    $("normChk").addEventListener("click", function () {
      S.norm = !S.norm;
      refresh();
    });

    $("rA").addEventListener("input", syncRangeInputs);
    $("rB").addEventListener("input", syncRangeInputs);
    // 双滑块：让两个 thumb 都能拖
    ["rA", "rB"].forEach(function (id) {
      var el = $(id);
      el.addEventListener("pointerdown", function () {
        el.classList.add("drag");
      });
      el.addEventListener("pointerup", function () { el.classList.remove("drag"); });
    });

    // 抓取
    $("liveBtn").addEventListener("click", runFetch);
    $("proxySave").addEventListener("click", function () {
      LIVE.setProxies($("proxyIn").value);
      flash("代理已保存");
    });
    $("proxyReset").addEventListener("click", function () {
      LIVE.setProxies("");
      $("proxyIn").value = LIVE.getProxies().join("\n");
      flash("已恢复默认代理");
    });
    $("snapClear").addEventListener("click", function () {
      S.snap = null;
      LIVE.clearSnapshot();
      renderLive();
      flash("快照已清空");
    });
    $("pasteGo").addEventListener("click", function () {
      var txt = $("pasteIn").value;
      var pid = $("pastePlat").value;
      var items = LIVE.linesFrom(txt);
      if (!items.length) { flash("先粘点东西进来"); return; }
      var snap = S.snap && S.snap.plats ? S.snap : { date: LIVE.todayISO(), plats: {} };
      snap.date = LIVE.todayISO();
      snap.plats[pid] = { ok: true, via: "粘贴导入", items: items, hits: LIVE.countHits(items, D.words) };
      S.snap = snap;
      LIVE.saveSnapshot(snap);
      renderLive();
      flash("已统计 " + items.length + " 条");
    });

    $("dlPng").addEventListener("click", exportPNG);
    $("dlCsv").addEventListener("click", exportCSV);

    // 代理输入框回填
    $("proxyIn").value = LIVE.getProxies().join("\n");
    // 本地桥
    $("bridgeIn").value = LIVE.getBridge();
    $("bridgeSave").addEventListener("click", function () {
      LIVE.setBridge($("bridgeIn").value);
      flash("桥地址已保存：" + ($("bridgeIn").value.trim() || "（空 = 不试桥）"));
    });
    $("bridgeTest").addEventListener("click", function () {
      var btn = $("bridgeTest");
      var base = ($("bridgeIn").value || "").trim().replace(/\/+$/, "");
      if (!base) { flash("先填桥地址"); return; }
      btn.disabled = true;
      btn.textContent = "测试中…";
      var done = function (ok, msg) {
        btn.disabled = false;
        btn.textContent = "测一下";
        $("bridgeHint").innerHTML = (ok ? "✓ " : "✗ ") + escapeHtml(msg);
        $("bridgeHint").className = "adv-hint " + (ok ? "ok" : "err");
      };
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
      fetch(base + "/ping", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) {
          clearTimeout(timer);
          done(true, "桥已连通 " + base + " · 源：" + ((j && j.sources) || []).join(" / "));
        })
        .catch(function (e) {
          clearTimeout(timer);
          done(false, "连不上 " + base + "（" + e.message + "）。先在同一台设备跑 python3 tools/bridge.py");
        });
    });
    // 粘贴平台下拉
    $("pastePlat").innerHTML = D.platforms.map(function (p) {
      return '<option value="' + p.id + '">' + p.name + "</option>";
    }).join("");

    renderLive();
    refresh();

    window.addEventListener("resize", function () {
      chartWrap.style.height = chartHeight() + "px";
      chart.schedule();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();