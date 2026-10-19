/* ============================================================
   trend-lab / model.js
   ------------------------------------------------------------
   页面不再抓任何东西，也不预设任何词。用户输入什么词，
   就用「词名做种子」确定性生成 8 个平台的日度曲线：

     · 同一个词，任何时候打开都一样（种子哈希，不用 Math.random）
     · 同一件事在各平台有各自的量级、周内节奏、以及滞后
       （微博先爆 → 抖音/小红书跟上 → 百度再慢半拍 → 知乎最晚）
     · 词本身的热度、季节相位、突发窗口也由词名决定

   所以它是「演示数据集」：像真的，但不是真实搜索量。
   ============================================================ */
(function () {
  "use strict";

  var DAYS = 180;

  var PLATS = [
    { id: "baidu", name: "百度", color: "#3f6ad8", w: 1.00, lag: 1.4, wkDay: 1.04, wkEnd: 0.93 },
    { id: "wechat", name: "微信", color: "#2f9e7d", w: 1.32, lag: 1.9, wkDay: 1.05, wkEnd: 0.97 },
    { id: "douyin", name: "抖音", color: "#16181c", w: 1.22, lag: 0.4, wkDay: 1.00, wkEnd: 1.12 },
    { id: "weibo", name: "微博", color: "#e0903c", w: 1.06, lag: 0.0, wkDay: 1.00, wkEnd: 1.10 },
    { id: "xhs", name: "小红书", color: "#d1495b", w: 0.86, lag: 0.7, wkDay: 0.99, wkEnd: 1.13 },
    { id: "bili", name: "B站", color: "#e2637f", w: 0.72, lag: 1.0, wkDay: 0.98, wkEnd: 1.15 },
    { id: "zhihu", name: "知乎", color: "#5b6b9e", w: 0.46, lag: 2.3, wkDay: 1.06, wkEnd: 0.90 },
    { id: "toutiao", name: "头条", color: "#8a74d6", w: 0.56, lag: 0.9, wkDay: 1.03, wkEnd: 1.01 }
  ];

  var BY_ID = {};
  PLATS.forEach(function (p) { BY_ID[p.id] = p; });

  /* ---- 日期：从今天往前 180 天 ---- */
  var END = new Date();
  END.setHours(12, 0, 0, 0);
  var DAYS_ISO = [];
  var DOW = [];
  for (var i = DAYS - 1; i >= 0; i--) {
    var d = new Date(END.getTime() - i * 86400000);
    var m = d.getMonth() + 1, dd = d.getDate();
    DAYS_ISO.push(d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd);
    DOW.push(d.getDay()); /* 0=周日 */
  }

  /* ---- 确定性随机 ---- */
  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- 词自己的画像（所有平台共用，保证三…八条线相关） ---- */
  var profiles = {};
  function profile(word) {
    if (profiles[word]) return profiles[word];
    var r = rng(hash("w:" + word));
    var base = 9000 + Math.pow(r(), 1.7) * 82000;       /* 这个词本身多热 */
    var evCount = 1 + Math.floor(r() * 3);              /* 1–3 次突发 */
    var events = [];
    for (var i = 0; i < evCount; i++) {
      events.push({
        c: 10 + r() * (DAYS - 20),                      /* 突发中心 */
        w: 3.6 + r() * 6.4,                             /* 宽度 */
        a: 0.55 + r() * 1.75                            /* 幅度 */
      });
    }
    var p = {
      base: base,
      phase: r() * Math.PI * 2,
      trend: (r() - 0.42) * 0.55,
      wig: r() * 2 - 1,
      events: events
    };
    profiles[word] = p;
    return p;
  }

  /* ---- 某词在某平台的日度序列 ---- */
  var cache = {};
  function series(word, platId) {
    var key = word + "|" + platId;
    if (cache[key]) return cache[key];
    var plat = BY_ID[platId];
    if (!plat) return null;
    var p = profile(word);
    var r = rng(hash(word + ":" + platId));
    var lag = Math.round(plat.lag);
    var arr = new Array(DAYS);

    for (var i = 0; i < DAYS; i++) {
      var dow = DOW[i];
      var week = (dow === 0 || dow === 6) ? plat.wkEnd : plat.wkDay;
      var slow = 1 + 0.12 * Math.sin(i / 11 + p.phase) + p.trend * (i / DAYS);
      var ev = 1;
      for (var e = 0; e < p.events.length; e++) {
        var ev0 = p.events[e];
        var d = i - (ev0.c + lag);
        ev += ev0.a * Math.exp(-(d * d) / (2 * ev0.w * ev0.w));
      }
      var noise = 0.9 + r() * 0.2;
      var v = p.base * plat.w * week * slow * ev * noise;
      v *= 1 + 0.05 * Math.sin(i * 1.9 + p.wig * 3);
      arr[i] = Math.max(40, Math.round(v));
    }
    cache[key] = arr;
    return arr;
  }

  window.TrendModel = {
    DAYS: DAYS,
    days: DAYS_ISO,
    PLATS: PLATS,
    plat: function (id) { return BY_ID[id]; },
    series: series
  };
})();