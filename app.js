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
  $("#links").innerHTML = (SITE.links || []).map(function (l) {
    return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>";
  }).join("");

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
    var tags = (p.tags || []).map(function (t) {
      return '<span class="tag">' + esc(t) + "</span>";
    }).join("");
    var links = (p.links || []).map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>";
    }).join("");

    return '<article class="card" data-tags="' + esc((p.tags || []).join(",")) + '">' +
      "<h3>" + title + badge + year + "</h3>" +
      '<p class="desc">' + esc(p.desc) + "</p>" +
      (tags ? '<div class="tags">' + tags + "</div>" : "") +
      (links ? '<div class="card-links">' + links + "</div>" : "") +
      "</article>";
  }

  var grid = $("#projects");
  grid.innerHTML = all.map(cardHTML).join("");
  if (!all.length) $("#empty").hidden = false;

  /* ---------- 标签筛选 ---------- */
  var tags = [];
  all.forEach(function (p) {
    (p.tags || []).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
  });

  if (tags.length) {
    var fw = $("#filters");
    ["全部"].concat(tags).forEach(function (t, i) {
      var b = document.createElement("button");
      b.textContent = t;
      b.className = i === 0 ? "on" : "";
      b.onclick = function () {
        fw.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        grid.querySelectorAll(".card").forEach(function (c) {
          var ok = t === "全部" || (c.dataset.tags || "").split(",").indexOf(t) >= 0;
          c.style.display = ok ? "" : "none";
        });
      };
      fw.appendChild(b);
    });
  }

  /* ---------- 气泡 ---------- */
  var box = document.querySelector(".bubbles");
  if (box && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (var i = 0; i < 16; i++) {
      var d = document.createElement("div");
      var size = 6 + Math.random() * 26;
      d.className = "bubble";
      d.style.width = size + "px";
      d.style.height = size + "px";
      d.style.left = Math.random() * 100 + "%";
      d.style.animationDuration = (9 + Math.random() * 13).toFixed(1) + "s";
      d.style.animationDelay = (-Math.random() * 20).toFixed(1) + "s";
      d.style.setProperty("--drift", (Math.random() * 80 - 40).toFixed(0) + "px");
      box.appendChild(d);
    }
  }
})();
