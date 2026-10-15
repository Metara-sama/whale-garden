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
})();
