(function () {
  "use strict";

  var frame = document.getElementById("game");
  var boot = document.getElementById("boot");
  var done = false;

  function finish() {
    if (done) { return; }
    done = true;
    if (!boot) { return; }
    boot.classList.add("done");
    setTimeout(function () { if (boot && boot.parentNode) { boot.parentNode.removeChild(boot); } }, 400);
  }

  if (frame) {
    frame.addEventListener("load", finish);
    /* 跨域框架拿不到内部状态，兜底别让幕布一直挂着 */
    setTimeout(finish, 30000);
  } else {
    finish();
  }
})();