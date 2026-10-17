(function () {
  "use strict";

  var SRC = "https://touhou.vip/";
  var $ = function (s) { return document.querySelector(s); };

  var stage = $("#stage");
  var slot = $("#slot");
  var idle = $("#slotIdle");
  var boot = $("#boot");
  var bootBar = $("#bootBar");
  var bootPct = $("#bootPct");
  var bootText = $("#bootText");
  var state = $("#stageState");
  var note = $("#stageNote");
  var launch = $("#launch");

  var frame = null;
  var progTimer = 0;
  var guardTimer = 0;
  var prog = 0;
  var phrases = ["连接官方节点…", "校验运行组件…", "准备渲染舞台…", "等待首个画面…"];
  var phraseIdx = 0;

  function setProg(v) {
    prog = Math.max(prog, Math.min(100, v));
    bootBar.style.width = prog + "%";
    bootPct.textContent = Math.round(prog) + "%";
  }

  function tick() {
    var left = 92 - prog;
    setProg(prog + Math.max(0.6, left * 0.06));
    if (prog > 24 && phraseIdx < 1) { phraseIdx = 1; bootText.textContent = phrases[1]; }
    if (prog > 52 && phraseIdx < 2) { phraseIdx = 2; bootText.textContent = phrases[2]; }
    if (prog > 76 && phraseIdx < 3) { phraseIdx = 3; bootText.textContent = phrases[3]; }
  }

  function stopTimers() {
    clearInterval(progTimer); progTimer = 0;
    clearTimeout(guardTimer); guardTimer = 0;
  }

  function openFrame() {
    if (frame) {
      frame.src = SRC;
      return;
    }
    frame = document.createElement("iframe");
    frame.src = SRC;
    frame.title = "EAGLER TOUHOU — 东方原作 Web 化";
    frame.setAttribute("allow", "fullscreen; gamepad; autoplay; clipboard-write");
    frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
    frame.addEventListener("load", onLoaded);
    slot.appendChild(frame);

    idle.hidden = true;
    boot.hidden = false;
    prog = 0; phraseIdx = 0;
    setProg(4);
    bootText.textContent = phrases[0];
    stage.classList.add("live");
    state.textContent = "连接中";
    note.textContent = "touhou.vip · embedded";
    launch.querySelector(".label").textContent = "重新加载";
    progTimer = setInterval(tick, 220);

    /* 兜底：40 秒还没 load 完，别让进度条骗人 */
    guardTimer = setTimeout(function () {
      stopTimers();
      setProg(100);
      bootText.innerHTML = "连接超时。可能是网络不通，或浏览器拦截了第三方框架 —— <a href=\"" + SRC + "\" target=\"_blank\" rel=\"noopener\" style=\"color:#4de1ff\">直接在新窗口打开</a>。";
      state.textContent = "超时";
    }, 40000);
  }

  function onLoaded() {
    stopTimers();
    setProg(100);
    setTimeout(function () { boot.hidden = true; }, 260);
    state.textContent = "运行中";
    note.textContent = "touhou.vip · embedded";
  }

  launch.addEventListener("click", openFrame);

  /* 舞台工具条 */
  document.querySelector(".stage-bar").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act");

    if (act === "full") {
      var el = stage;
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }

    if (act === "big") {
      var big = slot.classList.toggle("big");
      btn.textContent = big ? "还原" : "放大";
    }

    if (act === "reload") {
      if (!frame) { openFrame(); return; }
      boot.hidden = false;
      prog = 0; phraseIdx = 0;
      setProg(6);
      bootText.textContent = phrases[0];
      state.textContent = "重载中";
      progTimer = setInterval(tick, 220);
      frame.src = SRC + (SRC.indexOf("?") < 0 ? "?" : "&") + "_r=" + Date.now();
    }

    if (act === "close") {
      if (!frame) return;
      stopTimers();
      frame.removeEventListener("load", onLoaded);
      frame.remove();
      frame = null;
      boot.hidden = true;
      idle.hidden = false;
      stage.classList.remove("live");
      state.textContent = "待机";
      note.textContent = "嵌入 touhou.vip";
      slot.classList.remove("big");
      var bigBtn = document.querySelector('[data-act="big"]');
      if (bigBtn) bigBtn.textContent = "放大";
      launch.querySelector(".label").textContent = "启动系统";
    }
  });

  /* 截图放大 */
  var lb = $("#lightbox");
  var lbImg = $("#lightboxImg");
  document.querySelectorAll(".shots img").forEach(function (img) {
    img.addEventListener("click", function () {
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt || "";
      lb.hidden = false;
    });
  });
  lb.addEventListener("click", function () { lb.hidden = true; lbImg.removeAttribute("src"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !lb.hidden) { lb.hidden = true; lbImg.removeAttribute("src"); }
  });

  /* 跟随光标的光斑 */
  var glow = $("#cursorGlow");
  if (glow && window.matchMedia("(hover:hover)").matches) {
    var gx = 0, gy = 0, cx = 0, cy = 0, raf = 0, moved = false;
    function loop() {
      cx += (gx - cx) * 0.14;
      cy += (gy - cy) * 0.14;
      glow.style.transform = "translate3d(" + cx + "px," + cy + "px,0)";
      raf = requestAnimationFrame(loop);
    }
    window.addEventListener("pointermove", function (e) {
      gx = e.clientX; gy = e.clientY;
      if (!moved) { moved = true; glow.classList.add("on"); loop(); }
    }, { passive: true });
    document.addEventListener("mouseleave", function () { glow.classList.remove("on"); });
  }
})();