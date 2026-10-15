/* ============================================================
 * render.js —— 自动嵌字引擎：擦原文 / 排中文 / 自适应字号 / 保底底色
 * 全部在 canvas 上完成，不需要人工排版
 * ============================================================ */
(function (global) {
  'use strict';

  var FONT_STACK = '"Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","HarmonyOS Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  var CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\u2018\u2019\u201C\u201D\u2014\u2026]/;
  // 行首禁则标点
  var NO_LINE_START = /[，。、；：！？）】》”’…,.!?;:)\]%°〕」]/;

  function fontOf(fs) { return '400 ' + fs.toFixed(1) + 'px ' + FONT_STACK; }

  /* 带缓存的字符宽度测量（比整串 measureText 快很多） */
  function makeMeas(ctx, font) {
    ctx.font = font;
    var cache = Object.create(null);
    var m = function (str) {
      var t = 0;
      for (var i = 0; i < str.length; i++) {
        var ch = str[i];
        var w = cache[ch];
        if (w === undefined) { w = ctx.measureText(ch).width; cache[ch] = w; }
        t += w;
      }
      return t;
    };
    m.raw = ctx;
    return m;
  }

  function tokenize(text) {
    var toks = [], buf = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        if (buf) { toks.push(buf); buf = ''; }
        toks.push(' ');
      } else if (CJK.test(ch)) {
        if (buf) { toks.push(buf); buf = ''; }
        toks.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) toks.push(buf);
    return toks;
  }

  function wrapTokens(meas, toks, maxW) {
    var lines = [], cur = '';
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (tk === ' ') {
        if (cur && !/ $/.test(cur)) cur += ' ';
        continue;
      }
      var cand = cur + tk;
      if (cur && meas(cand) > maxW) {
        // 标点悬挂：不让标点跑到行首
        if (NO_LINE_START.test(tk) && meas(tk) < maxW * 0.4) {
          lines.push((cur + tk).replace(/\s+$/, ''));
          cur = '';
          continue;
        }
        lines.push(cur.replace(/\s+$/, ''));
        cur = tk;
      } else {
        cur = cand;
      }
    }
    if (cur.replace(/\s+$/, '')) lines.push(cur.replace(/\s+$/, ''));
    return lines;
  }

  function maxWOf(meas, lines) {
    var w = 0;
    for (var i = 0; i < lines.length; i++) {
      var x = meas(lines[i]);
      if (x > w) w = x;
    }
    return w;
  }

  /* 字号自适应：先缩到装得下，再在有余量时适度放大铺满 */
  function fitText(ctx, text, maxW, maxH, maxFs, minFs, lineH, autoFill) {
    var toks = tokenize(text);
    var fs = maxFs, lines = null, widest = 0, guard = 0;
    while (true) {
      var meas = makeMeas(ctx, fontOf(fs));
      lines = wrapTokens(meas, toks, maxW);
      widest = maxWOf(meas, lines);
      if (lines.length * fs * lineH <= maxH) break;
      if (fs <= minFs + 0.05) break;
      fs = Math.max(minFs, fs * 0.94);
      if (++guard > 48) break;
    }
    if (autoFill) {
      var cap = maxFs * 1.12;
      var g2 = 0;
      while (fs < cap - 0.01 && g2++ < 12) {
        var nf = Math.min(cap, fs * 1.05);
        var m2 = makeMeas(ctx, fontOf(nf));
        var l2 = wrapTokens(m2, toks, maxW);
        var w2 = maxWOf(m2, l2);
        if (l2.length * nf * lineH > maxH || w2 > maxW * 0.97) break;
        if (l2.length !== lines.length && l2.length > lines.length) break;
        fs = nf; lines = l2; widest = w2;
      }
    }
    return { fs: fs, lines: lines, widest: widest, height: lines.length * fs * lineH };
  }

  /* 采样块周边底色 → 取众数（量化到 16 级抗噪） */
  function sampleBg(ctx, x, y, w, h, d) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var x0 = Math.max(0, Math.floor(x - d)), y0 = Math.max(0, Math.floor(y - d));
    var x1 = Math.min(W, Math.ceil(x + w + d)), y1 = Math.min(H, Math.ceil(y + h + d));
    if (x1 - x0 < 2 || y1 - y0 < 2) return { css: '#ffffff', lum: 255 };
    var data;
    try {
      data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    } catch (e) {
      return { css: '#ffffff', lum: 255 };
    }
    var iw = x1 - x0;
    var hist = Object.create(null);
    var bright = Object.create(null), brightN = 0;
    var ix0 = Math.floor(x - x0) + 1, ix1 = Math.ceil(x + w - x0) - 1;
    var iy0 = Math.floor(y - y0) + 1, iy1 = Math.ceil(y + h - y0) - 1;
    for (var yy = 0; yy < y1 - y0; yy += 2) {
      for (var xx = 0; xx < iw; xx += 2) {
        if (xx > ix0 && xx < ix1 && yy > iy0 && yy < iy1) continue; // 跳过内部文字区
        var p = (yy * iw + xx) * 4;
        var r = data[p], g = data[p + 1], b = data[p + 2];
        if (data[p + 3] < 40) { r = g = b = 255; }
        var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        hist[key] = (hist[key] || 0) + 1;
        if (r > 170 && g > 170 && b > 170) bright[key] = (bright[key] || 0) + 1, brightN++;
      }
    }
    var bestK = -1, bestN = -1;
    for (var k in hist) if (hist[k] > bestN) { bestN = hist[k]; bestK = +k; }
    var pool = bestK;
    // 若主色偏暗但存在大量接近白的像素，优先用白（文献里最常见）
    if (bestK >= 0) {
      var br = ((bestK >> 8) & 15) * 17;
      if (br < 190 && brightN > bestN * 0.6) {
        var bk2 = -1, bn2 = -1;
        for (var k2 in bright) if (bright[k2] > bn2) { bn2 = bright[k2]; bk2 = +k2; }
        if (bk2 >= 0) pool = bk2;
      }
    }
    if (pool < 0) return { css: '#ffffff', lum: 255 };
    var R = ((pool >> 8) & 15) * 17 + 8, G = ((pool >> 4) & 15) * 17 + 8, B = (pool & 15) * 17 + 8;
    return { css: 'rgb(' + R + ',' + G + ',' + B + ')', lum: 0.299 * R + 0.587 * G + 0.114 * B };
  }

  /**
   * 把译文嵌到页面上（原地修改 canvas）
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} segs  解析结果
   * @param {Number} S    渲染倍率
   * @param {Object} opts {mode, smartBg, bgColor, fontScale, autoFill}
   */
  function drawSegs(ctx, segs, S, opts) {
    opts = opts || {};
    var mode = opts.mode || 'replace';
    var lineH = 1.34;
    var stat = { drawn: 0, skipped: 0, kept: 0, over: 0, detail: [] };

    for (var i = 0; i < segs.length; i++) {
      var sg = segs[i];
      if (sg.skip) { stat.kept++; continue; }
      var txt = (sg.trans || '').trim();
      if (!txt) { stat.kept++; continue; }

      var bx = sg.x0 * S, by = sg.yTop * S, bw = Math.max(2, sg.w * S), bh = Math.max(2, sg.h * S);
      var avail = Math.max(bh, sg.availH * S);
      var baseFs = Math.max(4.5, sg.fontSize) * S * (opts.fontScale || 1);
      var maxFs = baseFs;
      var minFs = Math.max(4, baseFs * 0.55);
      var boxX, boxY, boxW, boxH, textColor;

      if (mode === 'aside') {
        var gap = avail - bh - 2 * S;
        if (gap < baseFs * 0.85) { stat.skipped++; continue; }
        boxX = bx; boxY = by + bh + Math.max(1, S * 0.8);
        boxW = bw; boxH = gap;
        maxFs = baseFs * 0.82; minFs = Math.max(4, maxFs * 0.62);
      } else {
        boxX = bx; boxY = by; boxW = bw; boxH = Math.max(bh, Math.min(avail, bh * 1.9));
      }

      // 底色
      var bgInfo = opts.smartBg ? sampleBg(ctx, bx, by, bw, bh, Math.max(2, S * 1.2))
        : { css: opts.bgColor || '#ffffff', lum: 255 };
      if (mode === 'replace') {
        var pad = Math.max(1, S * 0.7);
        ctx.fillStyle = bgInfo.css;
        ctx.fillRect(bx - pad, by - pad, bw + pad * 2, bh + pad * 2);
      }

      var innerW = Math.max(4, boxW - Math.max(2, S));
      var fit = fitText(ctx, txt, innerW, boxH, maxFs, minFs, lineH, opts.autoFill !== false);
      var fs = fit.fs, lines = fit.lines;

      var meas = makeMeas(ctx, fontOf(fs));
      var ty;
      if (lines.length === 1 && boxH > fs * 1.75) ty = boxY + boxH / 2 + fs * 0.34; // 单行垂直居中
      else ty = boxY + fs * 0.84;

      if (mode === 'aside') {
        textColor = bgInfo.lum < 110 ? '#8ab6ff' : '#12539e';
      } else {
        textColor = bgInfo.lum < 110 ? '#eef3f8' : '#101418';
      }
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = fontOf(fs);

      var tx = boxX + Math.max(0.5, S * 0.4);
      var lastBaseline = ty;
      for (var L = 0; L < lines.length; L++) {
        ctx.fillText(lines[L], tx, ty);
        lastBaseline = ty;
        ty += fs * lineH;
      }
      var limit = boxY + boxH;
      if (lastBaseline > limit + 1) stat.over++;
      stat.detail.push({
        id: sg.id, fs: +fs.toFixed(1), lines: lines.length,
        last: +lastBaseline.toFixed(1), limit: +limit.toFixed(1),
        over: lastBaseline > limit + 1
      });
      stat.drawn++;
    }
    return stat;
  }

  global.PaperRender = {
    drawSegs: drawSegs,
    sampleBg: sampleBg,
    FONT_STACK: FONT_STACK
  };
})(window);