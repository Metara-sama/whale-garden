/* 渲染逻辑，一般不需要改 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "\x26amp;", "<": "\x26lt;", ">": "\x26gt;", '"': "\x26quot;", "'": "\x26#39;" }[c];
    });
  }

  /* ---------- 站点信息 ---------- */
  document.title = SITE.name;
  $("#site-name").textContent = SITE.name;
  $("#tagline").textContent = SITE.tagline || "";
  $("#about").textContent = SITE.about || "";
  $("#footer-text").textContent = SITE.footer || SITE.name;

  var linksHTML = (SITE.links || []).map(function (l) {
    return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>";
  }).join("");
  $("#links").innerHTML = linksHTML;
  if (!linksHTML) $("#links").hidden = true;

  var STATUS = { live: ["已完成", "live"], wip: ["进行中", "wip"] };

  /* ---------- 项目卡 ---------- */
  var all = (typeof PROJECTS !== "undefined" ? PROJECTS : []);

  function cardHTML(p) {
    var st = STATUS[p.status] || null;
    var badge = st ? '<span class="badge ' + st[1] + '">' + st[0] + "</span>" : "";
    var year = p.year ? '<span class="year">' + esc(p.year) + "</span>" : "";
    var title = p.links && p.links[0] && p.links[0].url
      ? '<a href="' + esc(p.links[0].url) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a>"
      : esc(p.name);
    var links = (p.links || []).map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>";
    }).join("");

    return '<article class="card">' +
      "<h3>" + title + badge + year + "</h3>" +
      '<p class="desc">' + esc(p.desc) + "</p>" +
      (links ? '<div class="card-links">' + links + "</div>" : "") +
      "</article>";
  }

  var grid = $("#projects");
  grid.innerHTML = all.map(cardHTML).join("");
  if (!all.length) $("#empty").hidden = false;

  /* ---------- 气泡（只在顶部珊瑚礁区域里飘） ---------- */
  /* 珊瑚礁区域的高度随屏幕宽度变化，实时写进 --rise，让气泡正好升到图顶 */
  var reef = $(".reef");
  function setRise() {
    if (reef) document.documentElement.style.setProperty("--rise", (reef.clientHeight + 80) + "px");
  }
  setRise();
  window.addEventListener("resize", setRise);
  window.addEventListener("load", setRise);

  var box = document.querySelector(".bubbles");
  if (box && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (var i = 0; i < 14; i++) {
      var d = document.createElement("div");
      var size = 5 + Math.random() * 16;
      d.className = "bubble";
      d.style.width = size + "px";
      d.style.height = size + "px";
      d.style.left = Math.random() * 100 + "%";
      d.style.animationDuration = (7 + Math.random() * 9).toFixed(1) + "s";
      d.style.animationDelay = (-Math.random() * 16).toFixed(1) + "s";
      d.style.setProperty("--drift", (Math.random() * 70 - 35).toFixed(0) + "px");
      box.appendChild(d);
    }
  }

  /* ---------- 彩蛋：连点吉祥物 10 次 ---------- */
  var eggCount = 0, eggTimer = 0, eggBusy = false;
  var mascot = document.querySelector(".reef-mascot");

  function loadCssOnce(href) {
    if (document.querySelector('link[data-wg="' + href + '"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.setAttribute("data-wg", href);
    document.head.appendChild(l);
  }

  /* 在用户手势里预热音频，绕开浏览器的自动播放拦截 */
  function warmAudio() {
    /* 气泡声：点击的这一瞬间就响，和气泡柱同拍 */
    try {
      var s = window.__wgSfx || (window.__wgSfx = new Audio("assets/game/bubble.mp3"));
      s.volume = 1;
      s.currentTime = 0;
      var p1 = s.play(); if (p1 && p1.catch) p1.catch(function () {});
    } catch (e) {}
    /* BGM：只做「解锁」，静音播一下立刻收掉，等过场结束再真正响 */
    try {
      var b = window.__wgBgm || (window.__wgBgm = new Audio("assets/game/bgm.mp3"));
      b.loop = true;
      b.muted = true;
      var p2 = b.play();
      if (p2 && p2.then) {
        p2.then(function () {
          try { b.pause(); b.currentTime = 0; b.muted = false; } catch (e2) {}
        }).catch(function () { b.muted = false; });
      } else {
        try { b.pause(); b.currentTime = 0; } catch (e3) {}
        b.muted = false;
      }
    } catch (e) {}
  }

  function startEgg() {
    if (eggBusy) return;
    eggBusy = true;
    warmAudio();
    loadCssOnce("game.css");
    var s = document.createElement("script");
    s.src = "game.js";
    s.onload = function () {
      if (window.WGGame) window.WGGame.boot();
      eggBusy = false;          /* 玩完还能再触发 */
    };
    s.onerror = function () { eggBusy = false; };
    document.body.appendChild(s);
  }

  if (mascot) {
    mascot.addEventListener("click", function () {
      if (eggBusy) return;
      eggCount++;
      mascot.classList.remove("egg-tap");
      void mascot.offsetWidth;
      mascot.classList.add("egg-tap");
      clearTimeout(eggTimer);
      eggTimer = setTimeout(function () { eggCount = 0; }, 1500);
      if (eggCount >= 10) { eggCount = 0; startEgg(); }
    });
  }
})();
