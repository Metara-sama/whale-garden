/* ============================================================
   textures.js —— 程序化材质（Canvas2D 生成，零外部图片）
   ------------------------------------------------------------
   生成 4 张贴图：
     tile   池核瓷砖（8×8 釉面砖 + 勾缝 + 水渍）
     wall   后室墙纸（竖条纹织物 + 陈旧水斑）
     carpet 后室地毯（纤维噪点 + 横向编织纹 + 脏污）
     grain  胶片颗粒 / 抖动噪声（后期使用）
   每张都按真实施工尺寸画（2m×2m），shader 里按世界坐标采。
   ============================================================ */
window.LIMINAL = window.LIMINAL || {};
(function (NS) {
  "use strict";

  /* ---------- 小工具 ---------- */
  function canvas(size) {
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  }

  /* 线性同余伪随机，种子固定 → 每次刷新纹理一致（不闪烁） */
  function prng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function speckle(g, size, count, rand, colorFn, maxR) {
    for (var i = 0; i < count; i++) {
      var x = rand() * size;
      var y = rand() * size;
      var r = 0.4 + rand() * maxR;
      g.fillStyle = colorFn(rand);
      g.globalAlpha = 0.05 + rand() * 0.15;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.5 + rand()), rand() * 6.2832, 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /* ---------- 1. 池核瓷砖 ---------- */
  function tiles() {
    var S = 512, N = 8, cell = S / N;
    var c = canvas(S), g = c.getContext("2d"), rand = prng(20260901);

    /* 勾缝底色 */
    g.fillStyle = "#7f979d";
    g.fillRect(0, 0, S, S);

    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var px = x * cell, py = y * cell;
        var v = 0.93 + rand() * 0.07;
        g.fillStyle = "rgb(" + Math.round(231 * v) + "," +
          Math.round(242 * v) + "," + Math.round(240 * v) + ")";
        g.fillRect(px + 2, py + 2, cell - 4, cell - 4);

        /* 釉面高光（上缘亮 / 下缘暗），一眼看出是瓷砖不是格子纸 */
        g.fillStyle = "rgba(255,255,255,0.34)";
        g.fillRect(px + 2, py + 2, cell - 4, 2);
        g.fillStyle = "rgba(110,140,150,0.18)";
        g.fillRect(px + 2, py + cell - 4, cell - 4, 2);

        /* 随机台面污渍 */
        if (rand() < 0.38) {
          g.fillStyle = "rgba(140,164,162," + (0.05 + rand() * 0.1).toFixed(3) + ")";
          g.fillRect(
            px + 4 + rand() * (cell - 26),
            py + 4 + rand() * (cell - 26),
            cell * 0.25 + rand() * cell * 0.35,
            cell * 0.2 + rand() * cell * 0.3
          );
        }
      }
    }

    speckle(g, S, 300, rand, function (r) {
      return r < 0.5 ? "#7a8d90" : "#c6d6d4";
    }, 5);

    return c;
  }

  /* ---------- 2. 后室墙纸 ---------- */
  function wallpaper() {
    var S = 512;
    var c = canvas(S), g = c.getContext("2d"), rand = prng(778899);

    var grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0.0, "#d5bf75");
    grad.addColorStop(0.55, "#c9b366");
    grad.addColorStop(1.0, "#b6a054");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);

    /* 竖条纹（墙纸织物经纬） */
    for (var x = 0; x < S; x += 4) {
      g.fillStyle = (x % 8 === 0)
        ? "rgba(255,248,205,0.10)"
        : "rgba(118,98,40,0.07)";
      g.fillRect(x, 0, 2, S);
    }

    /* 陈旧水斑：大块径向渐变，边缘不留硬边 */
    for (var i = 0; i < 20; i++) {
      var x0 = rand() * S, y0 = rand() * S, r = 24 + rand() * 96;
      var rad = g.createRadialGradient(x0, y0, 0, x0, y0, r);
      rad.addColorStop(0, "rgba(118,94,38,0.11)");
      rad.addColorStop(1, "rgba(118,94,38,0.0)");
      g.fillStyle = rad;
      g.beginPath();
      g.arc(x0, y0, r, 0, 6.2832);
      g.fill();
    }

    speckle(g, S, 420, rand, function () { return "#6b5a2c"; }, 3);
    return c;
  }

  /* ---------- 3. 后室地毯 ---------- */
  function carpet() {
    var S = 512;
    var c = canvas(S), g = c.getContext("2d"), rand = prng(31337);

    g.fillStyle = "#8d7a3a";
    g.fillRect(0, 0, S, S);

    /* 逐像素纤维噪声 */
    var img = g.getImageData(0, 0, S, S), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (rand() - 0.5) * 64;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.65));
    }
    g.putImageData(img, 0, 0);

    /* 横向编织纹 */
    for (var y = 0; y < S; y += 3) {
      g.fillStyle = (y % 6 === 0) ? "rgba(58,46,16,0.10)" : "rgba(232,212,142,0.07)";
      g.fillRect(0, y, S, 1);
    }

    /* 被踩脏的斑块 */
    for (var k = 0; k < 12; k++) {
      var x0 = rand() * S, y0 = rand() * S, r = 30 + rand() * 84;
      var rad = g.createRadialGradient(x0, y0, 0, x0, y0, r);
      rad.addColorStop(0, "rgba(48,38,12,0.15)");
      rad.addColorStop(1, "rgba(48,38,12,0.0)");
      g.fillStyle = rad;
      g.beginPath();
      g.arc(x0, y0, r, 0, 6.2832);
      g.fill();
    }

    return c;
  }

  /* ---------- 4. 颗粒噪声 ---------- */
  function grain() {
    var S = 256;
    var c = canvas(S), g = c.getContext("2d"), rand = prng(4242);
    var img = g.createImageData(S, S), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = rand() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /* ---------- 对外：带真实进度的构建 ---------- */
  NS.Textures = {
    sources: {},

    /* step(done, total, label) 每完成一项调用一次 —— 进度条按它驱动 */
    build: function (step) {
      var list = [
        ["tile", tiles],
        ["wall", wallpaper],
        ["carpet", carpet],
        ["grain", grain]
      ];
      var i = 0;

      function next() {
        if (i >= list.length) return Promise.resolve(NS.Textures.sources);
        var item = list[i++];
        /* 让出一帧，浏览器才有机会把进度画出来（否则同步跑完看不到进度） */
        return new Promise(function (res) {
          setTimeout(function () {
            NS.Textures.sources[item[0]] = item[1]();
            if (step) step(i, list.length, item[0]);
            res();
          }, 16);
        }).then(next);
      }
      return next();
    }
  };
})(window.LIMINAL);
