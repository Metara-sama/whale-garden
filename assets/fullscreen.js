/* ============================================================
   Whale's Garden · 通用全屏开关  (fullscreen.js)   v1.1
   ------------------------------------------------------------
   约定：站点所有页面都必须在 </body> 前引入本脚本
        <script src="../assets/fullscreen.js"></script>   （按深度写相对路径）

   行为：
     · 默认停在**左下角**；按住可以拖到任意位置，松手后记住（localStorage: wg-fs-pos）
     · 拖动阈值 6px —— 手抖不会误触，拖动也不会误当成点击
     · 优先真全屏：Fullscreen API → webkit 前缀
     · 都不支持 / 被拒（Android WebView、iOS Safari 常态）→ 退化成「沉浸模式」：
       藏掉站点自带顶栏底栏、正文铺满整屏
     · 桌面支持 Esc / F 键

   版本：1.1   维护：大肥鱼
   ============================================================ */
(function () {
  "use strict";
  if (window.__wgFsReady) return;
  window.__wgFsReady = true;

  var doc = document;
  var root = doc.documentElement;
  var IM = "wg-immersive";
  var BTN_ID = "wg-fs-btn";
  var POS_KEY = "wg-fs-pos";
  var EDGE = 6;      /* 拖到边上留的间隙 */
  var DRAG_T = 6;    /* 拖动判定阈值 */

  var ICON_EXPAND =
    '<path d="M9 4H4v5"/><path d="M15 4h5v5"/>' +
    '<path d="M20 15v5h-5"/><path d="M4 15v5h5"/>';
  var ICON_COLLAPSE =
    '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/>' +
    '<path d="M20 15h-5v5"/><path d="M4 15h5v5"/>';

  var CSS = [
    "#" + BTN_ID + "{position:fixed;left:14px;bottom:14px;z-index:2147483000;",
    "width:46px;height:46px;padding:0;margin:0;box-sizing:border-box;",
    "display:flex;align-items:center;justify-content:center;",
    "border:1px solid rgba(150,220,255,.34);border-radius:14px;",
    "background:linear-gradient(160deg,rgba(14,48,76,.62),rgba(6,26,44,.62));",
    "backdrop-filter:blur(9px) saturate(1.25);-webkit-backdrop-filter:blur(9px) saturate(1.25);",
    "box-shadow:0 6px 20px rgba(0,18,36,.38),inset 0 1px 0 rgba(255,255,255,.14);",
    "color:#d3ecff;cursor:grab;opacity:.74;",
    "touch-action:none;-webkit-user-select:none;user-select:none;",
    "transition:transform .18s cubic-bezier(.2,.8,.3,1),opacity .18s ease,background .18s ease,box-shadow .18s ease;",
    "-webkit-tap-highlight-color:transparent}",
    "#" + BTN_ID + ":hover{opacity:1;transform:translateY(-1px) scale(1.05);",
    "background:linear-gradient(160deg,rgba(22,70,108,.8),rgba(8,34,58,.8));",
    "box-shadow:0 10px 26px rgba(0,24,46,.45),inset 0 1px 0 rgba(255,255,255,.2)}",
    "#" + BTN_ID + ":active{transform:scale(.93)}",
    "#" + BTN_ID + ":focus-visible{outline:2px solid rgba(150,220,255,.7);outline-offset:3px}",
    "#" + BTN_ID + " svg{width:22px;height:22px;display:block;fill:none;stroke:currentColor;",
    "stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}",

    /* —— 拖动中：抓手 + 抬起 + 发光，明确「我在跟着你走」 —— */
    "#" + BTN_ID + ".wg-dragging{opacity:1!important;cursor:grabbing;transform:scale(1.07);",
    "background:linear-gradient(160deg,rgba(26,84,128,.9),rgba(10,42,70,.9));",
    "box-shadow:0 16px 34px rgba(0,22,44,.5),0 0 0 1px rgba(150,220,255,.45),inset 0 1px 0 rgba(255,255,255,.24)}",
    "#" + BTN_ID + ".wg-dragging:active{transform:scale(1.07)}",

    "#" + BTN_ID + ".wg-pulse{animation:wgFsPulse .5s ease-out 1}",
    "@keyframes wgFsPulse{0%{box-shadow:0 0 0 0 rgba(120,205,255,.55)}100%{box-shadow:0 0 0 16px rgba(120,205,255,0)}}",

    /* —— 沉浸模式：藏顶栏底栏，正文铺满 —— */
    "html." + IM + "{overflow:hidden!important;background:#06182a}",
    "html." + IM + " body{position:fixed!important;inset:0!important;width:100%!important;",
    "height:100%!important;margin:0!important;overflow:auto!important;",
    "border-radius:0!important;-webkit-overflow-scrolling:touch}",
    "html." + IM + " body>header,html." + IM + " body>footer,html." + IM + " .banner,",
    "html." + IM + " .site-header,html." + IM + " .site-footer,html." + IM + " .site-nav{display:none!important}",
    "html." + IM + " body>main,html." + IM + " body>.wrap,html." + IM + " body>.container{max-width:none!important;margin:0!important}",
    "html." + IM + " #" + BTN_ID + "{opacity:.5}",
    "html." + IM + " #" + BTN_ID + ":hover,html." + IM + " #" + BTN_ID + ".wg-dragging{opacity:1}",

    "@media (max-width:520px){#" + BTN_ID + "{width:42px;height:42px;left:11px;bottom:11px;border-radius:13px}}",
    "@media (prefers-reduced-motion:reduce){#" + BTN_ID + "{transition:none}#" + BTN_ID + ".wg-pulse{animation:none}}"
  ].join("");

  var btn = null;
  var dragging = false, dragMoved = false, startX = 0, startY = 0, startL = 0, startT = 0;
  var suppressClick = false;
  var placed = false;   /* 是否已经用自定义坐标定位过 */

  /* ---------- 状态 ---------- */
  function isNativeFs() {
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement ||
      doc.mozFullScreenElement || doc.msFullscreenElement);
  }
  function isImmersive() { return root.classList.contains(IM); }
  function isOn() { return isNativeFs() || isImmersive(); }

  function paint() {
    if (!btn) return;
    var on = isOn();
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      (on ? ICON_COLLAPSE : ICON_EXPAND) + "</svg>";
    btn.setAttribute("aria-label", on ? "退出全屏" : "全屏（可拖动）");
    btn.setAttribute("title", on ? "退出全屏（Esc / F）" : "全屏（F）· 按住可拖动");
  }

  function immersive(on) {
    if (on) root.classList.add(IM);
    else root.classList.remove(IM);
    paint();
  }

  /* ---------- 位置记忆 ---------- */
  function vw() {
    return window.innerWidth || root.clientWidth || doc.body.clientWidth || 360;
  }
  function vh() {
    return window.innerHeight || root.clientHeight || doc.body.clientHeight || 640;
  }
  function size() {
    var r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
    return { w: (r && r.width) || btn.offsetWidth || 46, h: (r && r.height) || btn.offsetHeight || 46 };
  }
  function clamp(x, y) {
    var s = size();
    var maxX = Math.max(EDGE, vw() - s.w - EDGE);
    var maxY = Math.max(EDGE, vh() - s.h - EDGE);
    var nx = Math.max(EDGE, Math.min(x, maxX));
    var ny = Math.max(EDGE, Math.min(y, maxY));
    return { x: Math.round(nx), y: Math.round(ny) };
  }
  function applyPos(x, y) {
    var p = clamp(x, y);
    btn.style.left = p.x + "px";
    btn.style.top = p.y + "px";
    btn.style.right = "auto";
    btn.style.bottom = "auto";
    placed = true;
    return p;
  }
  function loadPos() {
    try {
      var s = window.localStorage && window.localStorage.getItem(POS_KEY);
      if (!s) return null;
      var o = JSON.parse(s);
      if (o && typeof o.x === "number" && typeof o.y === "number") return o;
    } catch (e) {}
    return null;
  }
  function savePos(x, y) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
      }
    } catch (e) {}
  }

  /* ---------- 全屏切换 ---------- */
  function enter() {
    var el = root;
    var req = el.requestFullscreen || el.webkitRequestFullscreen ||
      el.webkitRequestFullScreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (req) {
      try {
        var p = req.call(el, { navigationUI: "hide" });
        if (p && typeof p.catch === "function") {
          p.catch(function () { immersive(true); });
        }
        setTimeout(function () {
          if (!isNativeFs()) immersive(true);
        }, 380);
        return;
      } catch (e) {}
    }
    immersive(true);
  }

  function exit() {
    if (isNativeFs()) {
      try {
        if (doc.exitFullscreen) {
          var p = doc.exitFullscreen();
          if (p && typeof p.catch === "function") p.catch(function () {});
        } else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        else if (doc.webkitCancelFullScreen) doc.webkitCancelFullScreen();
        else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
        else if (doc.msExitFullscreen) doc.msExitFullscreen();
      } catch (e) {}
    }
    immersive(false);
  }

  function toggle() {
    if (isOn()) exit(); else enter();
    if (btn) {
      btn.classList.remove("wg-pulse");
      void btn.offsetWidth;
      btn.classList.add("wg-pulse");
    }
  }

  /* ---------- 拖动 ---------- */
  function onDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    var r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 0, top: 0 };
    dragging = true;
    dragMoved = false;
    startX = e.clientX || 0;
    startY = e.clientY || 0;
    startL = r.left;
    startT = r.top;
    try { if (btn.setPointerCapture && e.pointerId !== undefined) btn.setPointerCapture(e.pointerId); } catch (err) {}
    btn.classList.add("wg-dragging");
  }

  function onMove(e) {
    if (!dragging) return;
    var dx = (e.clientX || 0) - startX;
    var dy = (e.clientY || 0) - startY;
    if (!dragMoved && Math.abs(dx) < DRAG_T && Math.abs(dy) < DRAG_T) return;
    dragMoved = true;
    applyPos(startL + dx, startT + dy);
    if (e.preventDefault) e.preventDefault();
  }

  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    btn.classList.remove("wg-dragging");
    try { if (btn.releasePointerCapture && e && e.pointerId !== undefined) btn.releasePointerCapture(e.pointerId); } catch (err) {}
    if (dragMoved) {
      var r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 0, top: 0 };
      var p = applyPos(r.left, r.top);
      savePos(p.x, p.y);
      suppressClick = true;   /* 吞掉这一次 click，别顺手切成全屏 */
    }
    dragMoved = false;
  }

  function mount() {
    if (doc.getElementById(BTN_ID)) return;

    var style = doc.createElement("style");
    style.id = "wg-fs-style";
    style.textContent = CSS;
    (doc.head || root).appendChild(style);

    btn = doc.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";

    /* 上次拖到的位置（按当前视口再夹一次，换屏幕也不会跑出去） */
    var saved = loadPos();
    if (saved) applyPos(saved.x, saved.y);

    btn.addEventListener("click", function (e) {
      if (suppressClick) {              /* 刚拖完，这次点击不算 */
        suppressClick = false;
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        return;
      }
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      toggle();
    });
    btn.addEventListener("pointerdown", onDown, false);
    btn.addEventListener("pointermove", onMove, false);
    btn.addEventListener("pointerup", onUp, false);
    btn.addEventListener("pointercancel", onUp, false);
    /* 老浏览器没有 pointer events 时退回 mouse/touch */
    if (!window.PointerEvent) {
      btn.addEventListener("mousedown", onDown, false);
      btn.addEventListener("mousemove", onMove, false);
      btn.addEventListener("mouseup", onUp, false);
      btn.addEventListener("touchstart", function (ev) {
        var t = ev.touches && ev.touches[0];
        if (t) onDown({ clientX: t.clientX, clientY: t.clientY, pointerType: "touch" });
      }, { passive: true });
      btn.addEventListener("touchmove", function (ev) {
        var t = ev.touches && ev.touches[0];
        if (t) onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: function () {} });
      }, { passive: true });
      btn.addEventListener("touchend", function () { onUp({}); }, false);
    }

    (doc.body || root).appendChild(btn);
    paint();

    ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]
      .forEach(function (ev) {
        doc.addEventListener(ev, function () {
          if (!isNativeFs()) root.classList.remove(IM);
          paint();
        }, false);
      });

    var onResize = function () {
      if (!placed) return;
      var r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 0, top: 0 };
      applyPos(r.left, r.top);
    };
    if (window.addEventListener) {
      window.addEventListener("resize", onResize, false);
      window.addEventListener("orientationchange", onResize, false);
    }

    doc.addEventListener("keydown", function (e) {
      var t = e.target || {};
      var tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t.isContentEditable) return;
      if (e.key === "f" || e.key === "F") { toggle(); if (e.preventDefault) e.preventDefault(); }
      else if (e.key === "Escape" && isImmersive()) { exit(); }
    }, false);
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", mount, false);
  } else {
    mount();
  }

  window.WGFullscreen = {
    toggle: toggle,
    enter: enter,
    exit: exit,
    isOn: isOn,
    /* 复位到默认左下角（拖飞了可以用） */
    reset: function () {
      try { if (window.localStorage) window.localStorage.removeItem(POS_KEY); } catch (e) {}
      if (btn) {
        btn.style.left = "";
        btn.style.top = "";
        btn.style.right = "";
        btn.style.bottom = "";
        placed = false;
      }
    }
  };
})();