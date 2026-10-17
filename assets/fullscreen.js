/* ============================================================
   Whale's Garden · 通用全屏开关  (fullscreen.js)
   ------------------------------------------------------------
   约定：站点所有页面都必须在 </body> 前引入本脚本
        <script src="../assets/fullscreen.js"></script>   （按深度写相对路径）

   行为：
     · 右下角出现一颗玻璃态全屏按钮（不挡内容、页面自带的按钮也不冲突）
     · 优先真全屏：Fullscreen API → webkit 前缀
     · 上面都不支持 / 被拒绝（Android WebView、iOS Safari 常见）→ 自动退化成
       「沉浸模式」：藏掉站点自带的顶栏底栏、把正文铺满整屏，按钮仍在右下角可退出
     · 桌面额外支持 Esc / F 键

   版本：1.0   维护：大肥鱼
   ============================================================ */
(function () {
  "use strict";
  if (window.__wgFsReady) return;
  window.__wgFsReady = true;

  var doc = document;
  var root = doc.documentElement;
  var IM = "wg-immersive";      /* 沉浸模式类名 */
  var BTN_ID = "wg-fs-btn";

  var ICON_EXPAND =
    '<path d="M9 4H4v5"/><path d="M15 4h5v5"/>' +
    '<path d="M20 15v5h-5"/><path d="M4 15v5h5"/>';
  var ICON_COLLAPSE =
    '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/>' +
    '<path d="M20 15h-5v5"/><path d="M4 15h5v5"/>';

  var CSS = [
    "#" + BTN_ID + "{position:fixed;right:14px;bottom:14px;z-index:2147483000;",
    "width:46px;height:46px;padding:0;margin:0;box-sizing:border-box;",
    "display:flex;align-items:center;justify-content:center;",
    "border:1px solid rgba(150,220,255,.34);border-radius:14px;",
    "background:linear-gradient(160deg,rgba(14,48,76,.62),rgba(6,26,44,.62));",
    "backdrop-filter:blur(9px) saturate(1.25);-webkit-backdrop-filter:blur(9px) saturate(1.25);",
    "box-shadow:0 6px 20px rgba(0,18,36,.38),inset 0 1px 0 rgba(255,255,255,.14);",
    "color:#d3ecff;cursor:pointer;opacity:.74;",
    "transition:transform .18s cubic-bezier(.2,.8,.3,1),opacity .18s ease,background .18s ease,box-shadow .18s ease;",
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation}",
    "#" + BTN_ID + ":hover{opacity:1;transform:translateY(-1px) scale(1.05);",
    "background:linear-gradient(160deg,rgba(22,70,108,.8),rgba(8,34,58,.8));",
    "box-shadow:0 10px 26px rgba(0,24,46,.45),inset 0 1px 0 rgba(255,255,255,.2)}",
    "#" + BTN_ID + ":active{transform:scale(.93)}",
    "#" + BTN_ID + ":focus-visible{outline:2px solid rgba(150,220,255,.7);outline-offset:3px}",
    "#" + BTN_ID + " svg{width:22px;height:22px;display:block;fill:none;stroke:currentColor;",
    "stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
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
    "html." + IM + " #" + BTN_ID + ":hover{opacity:1}",

    "@media (max-width:520px){#" + BTN_ID + "{width:42px;height:42px;right:11px;bottom:11px;border-radius:13px}}",
    "@media (prefers-reduced-motion:reduce){#" + BTN_ID + "{transition:none}#" + BTN_ID + ".wg-pulse{animation:none}}"
  ].join("");

  function isNativeFs() {
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement ||
      doc.mozFullScreenElement || doc.msFullscreenElement);
  }
  function isImmersive() { return root.classList.contains(IM); }
  function isOn() { return isNativeFs() || isImmersive(); }

  var btn = null;

  function paint() {
    if (!btn) return;
    var on = isOn();
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      (on ? ICON_COLLAPSE : ICON_EXPAND) + "</svg>";
    btn.setAttribute("aria-label", on ? "退出全屏" : "全屏");
    btn.setAttribute("title", on ? "退出全屏（Esc / F）" : "全屏（F）");
  }

  function immersive(on) {
    if (on) root.classList.add(IM);
    else root.classList.remove(IM);
    paint();
  }

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
        /* 有些壳子返回了 Promise 却静默失败：等一下确认，没进就退沉浸 */
        setTimeout(function () {
          if (!isNativeFs()) immersive(true);
        }, 380);
        return;
      } catch (e) { /* 落到沉浸模式 */ }
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

  function mount() {
    if (doc.getElementById(BTN_ID)) return;
    var style = doc.createElement("style");
    style.id = "wg-fs-style";
    style.textContent = CSS;
    (doc.head || root).appendChild(style);

    btn = doc.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    (doc.body || root).appendChild(btn);
    paint();

    /* 原生全屏状态变化 → 同步图标；退出原生全屏时一并清掉沉浸类 */
    ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]
      .forEach(function (ev) {
        doc.addEventListener(ev, function () {
          if (!isNativeFs()) root.classList.remove(IM);
          paint();
        }, false);
      });

    /* 键盘：F 切换、Esc 退出（输入框里不劫持） */
    doc.addEventListener("keydown", function (e) {
      var t = e.target || {};
      var tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t.isContentEditable) return;
      if (e.key === "f" || e.key === "F") { toggle(); e.preventDefault(); }
      else if (e.key === "Escape" && isImmersive()) { exit(); }
    }, false);
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", mount, false);
  } else {
    mount();
  }

  /* 暴露给页面：WGFullscreen.toggle() / .on() */
  window.WGFullscreen = {
    toggle: toggle,
    enter: enter,
    exit: exit,
    isOn: isOn
  };
})();
