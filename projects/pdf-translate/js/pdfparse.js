/* ============================================================
 * pdfparse.js —— PDF 文本层解析：行聚类 → 分栏 → 段落切块
 * 依赖：pdf.js (window.pdfjsLib)
 * ============================================================ */
(function (global) {
  'use strict';

  // 全角 / CJK 判定（用于换行与宽度估算）
  var CJK = /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFFEF\u2018\u2019\u201C\u201D\u2014\u2026]/;
  // 数学符号（用于识别公式行）
  var MATHY = /[=∑∫∏√±×÷≤≥∞∂∇≈≠∝⊥∠⟨⟩⌊⌋⌈⌉→←↔⋅·⁄]/;

  /* ---------- 行聚类 ---------- */
  function buildLines(items) {
    var lines = [];
    // 按基线 y 排序，让同一行的 item 尽量相邻
    var sorted = items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    for (var n = 0; n < sorted.length; n++) {
      var it = sorted[n];
      var best = null, bestD = 1e9;
      // 只在最近 8 行里找宿主行
      for (var k = lines.length - 1; k >= Math.max(0, lines.length - 8); k--) {
        var L = lines[k];
        var d = Math.abs(L.y - it.y);
        var tol = Math.max(1.5, 0.45 * Math.max(L.fh, it.fh));
        if (d >= tol) continue;
        // 水平连续性：无论哪边相距过远，都说明属于另一栏/另一块，另起一行
        var lMinX = (L.minX === undefined ? L.x0 : L.minX);
        var lMaxX = (L.maxX === undefined ? it.x : L.maxX);
        var gapX = Math.max(it.x - lMaxX, lMinX - (it.x + it.w));
        var maxGap = Math.max(6, 1.7 * Math.max(L.fh, it.fh));
        if (gapX > maxGap) continue;
        if (d < bestD) { best = L; bestD = d; }
      }
      if (best) {
        best.items.push(it);
        if (it.fh > best.fh) best.fh = it.fh;
        if (best.maxX === undefined || it.x + it.w > best.maxX) best.maxX = it.x + it.w;
        if (best.minX === undefined || it.x < best.minX) best.minX = it.x;
        best.y = (best.y * (best.items.length - 1) + it.y) / best.items.length;
      } else {
        lines.push({ y: it.y, fh: it.fh, items: [it], maxX: it.x + it.w, minX: it.x });
      }
    }

    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      ln.items.sort(function (a, b) { return a.x - b.x; });
      ln.text = joinItems(ln.items);
      if (!ln.text) continue;
      ln.x0 = Infinity; ln.x1 = -Infinity;
      for (var j = 0; j < ln.items.length; j++) {
        var o = ln.items[j];
        if (o.x < ln.x0) ln.x0 = o.x;
        if (o.x + o.w > ln.x1) ln.x1 = o.x + o.w;
      }
      ln.w = ln.x1 - ln.x0;
      ln.cy = (ln.x0 + ln.x1) / 2;
      out.push(ln);
    }
    out.sort(function (a, b) { return a.y - b.y; });
    return out;
  }

  function joinItems(items) {
    var text = '';
    var prev = null;
    var sum = 0;
    for (var i = 0; i < items.length; i++) sum += items[i].fh;
    var avg = sum / Math.max(1, items.length);
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (prev) {
        var gap = it.x - (prev.x + prev.w);
        if (gap > 0.22 * avg && !/\s$/.test(text)) text += ' ';
      }
      text += it.str;
      prev = it;
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  /* ---------- 分栏（单栏 / 双栏） ---------- */
  function columnSplit(lines, pageW) {
    var body = lines;
    if (!body.length) return { seq: [], colOf: function () { return 'c0'; } };

    var xs0 = Infinity, xs1 = -Infinity;
    for (var i = 0; i < body.length; i++) {
      if (body[i].x0 < xs0) xs0 = body[i].x0;
      if (body[i].x1 > xs1) xs1 = body[i].x1;
    }
    var span = Math.max(1, xs1 - xs0);

    /* 栏间空隙检测：把 x 轴切成 2pt 桶，统计“有多少行的横向区间覆盖了该桶”。
     * 正文栏内覆盖数高，栏与栏之间的空白覆盖数≈0（仅被跨栏的标题/页眉压到）。 */
    var BIN = 2;
    var nbin = Math.ceil(span / BIN) + 1;
    var cover = new Int32Array(nbin);
    for (var i2 = 0; i2 < body.length; i2++) {
      var a = Math.max(0, Math.floor((body[i2].x0 - xs0) / BIN));
      var b = Math.min(nbin, Math.ceil((body[i2].x1 - xs0) / BIN));
      for (var k3 = a; k3 < b; k3++) cover[k3]++;
    }
    var lo = Math.max(0, Math.floor((pageW * 0.30 - xs0) / BIN));
    var hi = Math.min(nbin - 1, Math.ceil((pageW * 0.70 - xs0) / BIN));
    var minV = Infinity;
    for (var k4 = lo; k4 <= hi; k4++) if (cover[k4] < minV) minV = cover[k4];

    var dual = false, xSplit = null;
    var thresh = Math.max(1, Math.floor(body.length * 0.12));
    var dbg = { lines: body.length, minV: minV, thresh: thresh, bestLen: 0, xSplit: null, LC: 0, RC: 0, xs0: +xs0.toFixed(1), xs1: +xs1.toFixed(1) };
    dbg.cross = [];
    var probeX = pageW * 0.5;
    for (var cq = 0; cq < body.length && dbg.cross.length < 3; cq++) {
      if (body[cq].x0 < probeX - 2 && body[cq].x1 > probeX + 2) {
        var L0 = body[cq];
        dbg.cross.push({
          x0: +L0.x0.toFixed(1), x1: +L0.x1.toFixed(1), n: L0.items.length,
          it: L0.items.slice(0, 8).map(function (o) { return [+o.x.toFixed(1), +o.w.toFixed(1), o.str.slice(0, 16)]; })
        });
      }
    }
    dbg.curve = [];
    for (var ck = lo; ck <= hi; ck += 8) dbg.curve.push(cover[ck]);
    if (minV <= thresh) {
      // 找覆盖数低于阈值的最宽连续区段
      var bestS = -1, bestE = -1, bestLen = -1;
      var p = lo;
      while (p <= hi) {
        if (cover[p] <= thresh) {
          var s = p;
          while (p <= hi && cover[p] <= thresh) p++;
          var len = p - s;
          if (len > bestLen) { bestLen = len; bestS = s; bestE = p; }
        } else p++;
      }
      if (bestLen * BIN >= 8) {
        xSplit = xs0 + ((bestS + bestE) / 2) * BIN;
        var LC = 0, RC = 0;
        for (var q = 0; q < body.length; q++) {
          if (body[q].x1 <= xSplit + 2) LC++;
          else if (body[q].x0 >= xSplit - 2) RC++;
        }
        dbg.bestLen = bestLen * BIN; dbg.xSplit = xSplit; dbg.LC = LC; dbg.RC = RC;
        if (LC >= 4 && RC >= 4) dual = true;
      }
    }

    if (!dual) {
      var s0 = body.slice().sort(function (a, b) { return a.y - b.y; });
      return { seq: s0, colOf: function () { return 'c0'; }, dual: false, debug: dbg };
    }

    // 分成 全宽 / 左栏 / 右栏
    var full = [], left = [], right = [];
    for (var t = 0; t < body.length; t++) {
      var Ln = body[t];
      if (Ln.x0 < xSplit - 6 && Ln.x1 > xSplit + 6) full.push(Ln);
      else if (Ln.cy < xSplit) left.push(Ln);
      else right.push(Ln);
    }
    var byY = function (a, b) { return a.y - b.y; };
    full.sort(byY); left.sort(byY); right.sort(byY);

    // 全宽行：位于两栏开始之前的算页眉（题名/摘要），其余算页脚
    var firstY = Math.min(
      left.length ? left[0].y : Infinity,
      right.length ? right[0].y : Infinity
    );
    var head = [], tail = [];
    for (var f = 0; f < full.length; f++) (full[f].y < firstY - 1 ? head : tail).push(full[f]);

    var colMap = new Map();
    var assign = function (arr, name) { for (var q = 0; q < arr.length; q++) colMap.set(arr[q], name); };
    assign(head, 'c0'); assign(left, 'c1'); assign(right, 'c2'); assign(tail, 'c3');

    var seq = head.concat(left, right, tail);
    return { seq: seq, colOf: function (L) { return colMap.get(L) || 'c0'; }, dual: true, xSplit: xSplit, debug: dbg };
  }

  /* ---------- 段落成块 ---------- */
  function newBlock(L, col) {
    return {
      col: col,
      lines: [L],
      x0: L.x0, x1: L.x1,
      yTop: L.y - L.fh * 0.84,
      yBottom: L.y + L.fh * 0.28,
      fh: L.fh,
      lastY: L.y,
      text: L.text
    };
  }

  function pushLine(b, L) {
    b.lines.push(L);
    if (L.x0 < b.x0) b.x0 = L.x0;
    if (L.x1 > b.x1) b.x1 = L.x1;
    b.yBottom = L.y + L.fh * 0.28;
    if (L.fh > b.fh) b.fh = L.fh;
    // 行末连字符接续：state- / of  → stateof
    if (/-$/.test(b.text) && !/--$/.test(b.text) && /^[a-z]/.test(L.text)) {
      b.text = b.text.slice(0, -1) + L.text;
    } else {
      b.text += ' ' + L.text;
    }
    b.lastY = L.y;
  }

  function groupBlocks(seq, colOf) {
    var blocks = [], cur = null;
    for (var i = 0; i < seq.length; i++) {
      var L = seq[i];
      if (!cur) { cur = newBlock(L, colOf(L)); continue; }
      var ref = Math.max(cur.fh, L.fh);
      var dy = L.y - cur.lastY;
      var sameCol = colOf(L) === cur.col;
      var okGap = dy > 0 && dy < 1.78 * ref;
      var overlap = xOverlap(L.x0, L.x1, cur.x0, cur.x1);
      var okX = overlap > 0.5 || Math.abs(L.x0 - cur.x0) < 2.0 * ref;
      if (sameCol && okGap && okX) pushLine(cur, L);
      else { blocks.push(cur); cur = newBlock(L, colOf(L)); }
    }
    if (cur) blocks.push(cur);
    return blocks;
  }

  function xOverlap(a0, a1, b0, b1) {
    var o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return 0;
    return o / Math.max(1, Math.min(a1 - a0, b1 - b0));
  }

  /* ---------- 块 → 翻译单元（seg） ---------- */
  function segFromLines(lines, col) {
    var seg = {
      col: col,
      x0: Infinity, x1: -Infinity, yTop: Infinity, yBottom: -Infinity,
      fontSize: 0,
      text: ''
    };
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (L.x0 < seg.x0) seg.x0 = L.x0;
      if (L.x1 > seg.x1) seg.x1 = L.x1;
      if (L.y - L.fh * 0.84 < seg.yTop) seg.yTop = L.y - L.fh * 0.84;
      if (L.y + L.fh * 0.28 > seg.yBottom) seg.yBottom = L.y + L.fh * 0.28;
      if (L.fh > seg.fontSize) seg.fontSize = L.fh;
      if (i === 0) seg.text = L.text;
      else if (/-$/.test(seg.text) && !/--$/.test(seg.text) && /^[a-z]/.test(L.text)) seg.text = seg.text.slice(0, -1) + L.text;
      else seg.text += ' ' + L.text;
    }
    seg.w = Math.max(1, seg.x1 - seg.x0);
    seg.h = Math.max(1, seg.yBottom - seg.yTop);
    seg.availH = seg.h;
    return seg;
  }

  function splitSegs(block, maxChars, opts) {
    var out = [];
    var cur = [], len = 0;
    var maxLines = Math.max(2, Math.min(9, Math.ceil(maxChars / 45)));
    var flush = function () {
      if (!cur.length) return;
      out.push(segFromLines(cur, block.col));
      cur = []; len = 0;
    };
    for (var i = 0; i < block.lines.length; i++) {
      var L = block.lines[i];
      if (cur.length && (len + L.text.length + 1 > maxChars || cur.length >= maxLines)) flush();
      cur.push(L);
      len += L.text.length + 1;
      // 句子边界处优先断开（长度过半时）
      if (opts.sentenceSplit !== false && len > maxChars * 0.5 && /[.。!！?？:：;；]$/.test(L.text)) flush();
    }
    flush();
    return out;
  }

  /* ---------- 该不该跳过（公式 / 数字表 / 页码） ---------- */
  function shouldSkip(text, fontSize, opts) {
    var t = String(text || '').trim();
    var ns = t.replace(/\s/g, '');
    if (ns.length < 2) return '碎片';
    var letters = (t.match(/[A-Za-z]/g) || []).length;
    if (!opts.keepNumbers && /^[\d\s.,;:%°()\[\]\-–—+/]+$/.test(t)) return '数字/页码';
    if (opts.skipFormula) {
      if (letters / Math.max(1, ns.length) < 0.30) return '公式/符号';
      var m = (t.match(MATHY) || []).length;
      if (m >= 3 && letters / Math.max(1, ns.length) < 0.5) return '公式/符号';
    }
    return '';
  }

  /* ---------- 允许高度：能不能往下蹭空隙 ---------- */
  function assignAvail(segs, pageH) {
    var byCol = {};
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      (byCol[s.col] = byCol[s.col] || []).push(s);
    }
    Object.keys(byCol).forEach(function (k) {
      var arr = byCol[k].sort(function (a, b) { return a.yTop - b.yTop; });
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i];
        var limit = Math.min(pageH - 3, s.yBottom + 46);
        for (var j = i + 1; j < arr.length; j++) {
          if (xOverlap(arr[j].x0, arr[j].x1, s.x0, s.x1) > 0.35) { limit = arr[j].yTop; break; }
        }
        var avail = Math.max(s.h, Math.min(limit - s.yTop - 1, s.h * 2.2));
        s.availH = avail;
      }
    });
  }

  /* ---------- 单页解析 ---------- */
  async function analyzePage(pdfDoc, pageNum, opts) {
    opts = opts || {};
    var maxChars = opts.maxChars || 420;
    var page = await pdfDoc.getPage(pageNum);
    var viewport = page.getViewport({ scale: 1 });
    var pageW = viewport.width, pageH = viewport.height;
    var tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });

    var items = [];
    for (var i = 0; i < tc.items.length; i++) {
      var it = tc.items[i];
      var s = it.str;
      if (!s || !s.trim()) continue;
      var tr = pdfjsLib.Util.transform(viewport.transform, it.transform);
      var fh = Math.hypot(tr[2], tr[3]) || 0;
      if (!fh || fh < 2) continue;
      var x = tr[4], y = tr[5];
      var w = (typeof it.width === 'number' && it.width > 0) ? it.width : s.length * fh * 0.5;
      if (x < -10 || x > pageW + 10) continue;
      items.push({ str: s, x: x, y: y, w: w, fh: fh });
    }

    if (!items.length) return { no: pageNum, w: pageW, h: pageH, segs: [], empty: true };

    var lines = buildLines(items);
    var cs = columnSplit(lines, pageW);
    var blocks = groupBlocks(cs.seq, cs.colOf);

    var segs = [];
    for (var b = 0; b < blocks.length; b++) {
      var parts = splitSegs(blocks[b], maxChars, opts);
      for (var p = 0; p < parts.length; p++) segs.push(parts[p]);
    }
    assignAvail(segs, pageH);

    for (var k = 0; k < segs.length; k++) {
      var sg = segs[k];
      sg.id = 'p' + pageNum + '-' + k;
      sg.page = pageNum;
      sg.trans = '';
      var reason = shouldSkip(sg.text, sg.fontSize, opts);
      if (reason) { sg.skip = true; sg.skipReason = reason; }
      // 表格单元格里的小碎片：位置太窄/太矮，塞不进译文，直接保留原文
      if (!sg.skip && sg.w < 20 && sg.h < 9 && sg.text.replace(/\s/g, '').length < 10) {
        sg.skip = true; sg.skipReason = '碎片小块';
      }
    }

    var res = { no: pageNum, w: pageW, h: pageH, segs: segs, dual: !!cs.dual, _dbg: cs.debug };
    if (opts.debug) res._lines = lines.map(function (L) { return { x0: +L.x0.toFixed(1), x1: +L.x1.toFixed(1), y: +L.y.toFixed(1), fh: +L.fh.toFixed(1), n: L.items.length, t: L.text.slice(0, 60) }; });
    return res;
  }

  global.PDFParse = {
    analyzePage: analyzePage,
    shouldSkip: shouldSkip,
    CJK: CJK,
    // 供离线测试使用
    _internal: {
      buildLines: buildLines,
      columnSplit: columnSplit,
      groupBlocks: groupBlocks,
      splitSegs: splitSegs,
      assignAvail: assignAvail
    }
  };
})(window);
