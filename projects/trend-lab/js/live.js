/* ============================================================
   trend-lab / live.js —— 真实抓取 + 文本统计
   ------------------------------------------------------------
   说明：
     · 三个平台的公开热搜接口都是「榜单」，不是「搜索量」。
       所以这里的词频 = 目标词在今日榜单标题里的命中条数，
       这是能在静态页里诚实拿到的量。
     · 静态站直连大概率被 CORS 拦 → 依次尝试直连 / 公共代理。
       代理可在设置里改成自己的 worker。
     · 抓不到不代表页面坏：内置数据集照常看，抓取只是补今日快照。
   ============================================================ */
(function () {
  "use strict";

  var PLATS = [
    {
      id: "baidu", name: "百度",
      url: "https://top.baidu.com/api/board?platform=wise&tab=realtime",
      pick: function (j) {
        var cards = j && j.data && j.data.cards;
        if (!cards || !cards.length) return null;
        var out = [];
        // 结构：data.cards[0].content[0].content[] = [{word,index,url}...]
        cards.forEach(function (card) {
          (card.content || []).forEach(function (group) {
            if (group && Array.isArray(group.content)) {
              group.content.forEach(function (x) {
                out.push(x.word || x.query || x.title || "");
              });
            } else if (group) {
              out.push(group.word || group.query || group.title || "");
            }
          });
        });
        return out;
      }
    },
    {
      id: "bilibili", name: "B站",
      url: "https://s.search.bilibili.com/main/hotword",
      pick: function (j) {
        var l = j && (j.list || (j.data && j.data.list));
        if (!l) return null;
        return l.map(function (x) { return x.keyword || x.show_name || x.name || ""; });
      }
    },
    {
      id: "weibo", name: "微博",
      url: "https://weibo.com/ajax/side/hotSearch",
      pick: function (j) {
        var r = j && j.data && (j.data.realtime || j.data.hotgov);
        if (!r) return null;
        return r.map(function (x) { return x.word || x.note || x.name || ""; });
      }
    }
  ];

  var DEFAULT_PROXIES = [
    "https://api.allorigins.win/raw?url=",
    "https://api.codetabs.com/v1/proxy/?quest=",
    "https://corsproxy.io/?url="
  ];

  var PROXY_KEY = "wg-trend-proxy";
  var SNAP_KEY = "wg-trend-snapshot";
  var BRIDGE_KEY = "wg-trend-bridge";
  var BRIDGE_DEFAULT = "http://127.0.0.1:8899";

  /* 本地桥：tools/bridge.py 跑在本机，绕开 CORS */
  function getBridge() {
    try {
      var v = localStorage.getItem(BRIDGE_KEY);
      if (v === "") return "";          /* 用户主动关掉 */
      if (v) return v.replace(/\/+$/, "");
    } catch (e) {}
    return BRIDGE_DEFAULT;
  }
  function setBridge(v) {
    try {
      if (v == null) localStorage.removeItem(BRIDGE_KEY);
      else localStorage.setItem(BRIDGE_KEY, String(v).trim().replace(/\/+$/, ""));
    } catch (e) {}
  }

  function getProxies() {
    try {
      var own = localStorage.getItem(PROXY_KEY);
      if (own && own.trim()) {
        return own.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      }
    } catch (e) {}
    return DEFAULT_PROXIES.slice();
  }
  function setProxies(text) {
    try {
      if (text && text.trim()) localStorage.setItem(PROXY_KEY, text);
      else localStorage.removeItem(PROXY_KEY);
    } catch (e) {}
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; reject(new Error("超时")); }
      }, ms);
      promise.then(function (v) {
        if (done) return;
        done = true; clearTimeout(t); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(t); reject(e);
      });
    });
  }

  function getText(url, ms, opts) {
    opts = opts || {};
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var p = fetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      credentials: opts.credentials || "omit",
      cache: "no-store",
      headers: opts.headers || {}
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
    return withTimeout(p, ms || 6000).catch(function (e) {
      if (ctrl) { try { ctrl.abort(); } catch (err) {} }
      throw e;
    });
  }

  /* ---------- 单个平台：本地桥 → 直连 → 代理 ---------- */
  function fetchPlatform(plat, onNote) {
    var attempts = [];
    var bridge = getBridge();
    if (bridge) {
      attempts.push({ name: "本地桥", url: bridge + "/hot?p=" + plat.id, ms: 9000 });
    }
    attempts.push({ name: "直连", url: plat.url, ms: 6000 });
    getProxies().forEach(function (p, i) {
      attempts.push({ name: "代理" + (i + 1), url: p + encodeURIComponent(plat.url), ms: 6500 });
    });

    var idx = 0;
    var lastErr = "";
    function next() {
      if (idx >= attempts.length) {
        return Promise.reject(new Error("全部通道失败" + (lastErr ? "（最后一次：" + lastErr + "）" : "")));
      }
      var a = attempts[idx++];
      if (onNote) onNote(a.name);
      return getText(a.url, a.ms).then(function (txt) {
        var json;
        try { json = JSON.parse(txt); } catch (e) { throw new Error("不是 JSON"); }
        // 有些代理会把结果包一层 {contents:"..."}
        if (json && typeof json.contents === "string") {
          try { json = JSON.parse(json.contents); } catch (e) { throw new Error("contents 解不开"); }
        }
        // 桥自己出错时返回 {"error":"..."}；百度官方接口也带 error 字段（常为空对象），
        // 所以只有「error 是非空字符串」才算故障，别误伤正常响应
        if (json && typeof json.error === "string" && json.error) {
          throw new Error(String(json.error).slice(0, 40));
        }
        var items = plat.pick(json);
        if (!items || !items.length) throw new Error("榜单为空");
        items = items.filter(function (s) { return s && String(s).trim(); });
        return { plat: plat.id, items: items, via: a.name };
      }).catch(function (err) {
        if (onNote) onNote(a.name + " ✗ " + err.message);
        lastErr = a.name + " " + err.message;
        return next();
      });
    }
    return next();
  }

  /* ---------- 词频统计：目标词在多少条标题里出现 ---------- */
  function countHits(items, words) {
    var hits = {};
    words.forEach(function (w) { hits[w] = 0; });
    items.forEach(function (title) {
      var t = String(title).toLowerCase();
      words.forEach(function (w) {
        if (t.indexOf(String(w).toLowerCase()) >= 0) hits[w] += 1;
      });
    });
    return hits;
  }

  /* ---------- 从纯文本里切出条目（每行一条） ---------- */
  function linesFrom(text) {
    return String(text || "")
      .split(/[\n\r]+/)
      .map(function (s) { return s.replace(/^\s*[\d一二三四五六七八九十]+[.、)）:\s]*/, "").trim(); })
      .filter(function (s) { return s.length > 1; });
  }

  function saveSnapshot(snap) {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) {}
  }
  function loadSnapshot() {
    try {
      var s = localStorage.getItem(SNAP_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function clearSnapshot() {
    try { localStorage.removeItem(SNAP_KEY); } catch (e) {}
  }

  function todayISO() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  window.TrendLive = {
    PLATS: PLATS,
    getProxies: getProxies,
    setProxies: setProxies,
    getBridge: getBridge,
    setBridge: setBridge,
    fetchPlatform: fetchPlatform,
    countHits: countHits,
    linesFrom: linesFrom,
    saveSnapshot: saveSnapshot,
    loadSnapshot: loadSnapshot,
    clearSnapshot: clearSnapshot,
    todayISO: todayISO
  };
})();