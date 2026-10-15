/* ============================================================
 * app.js —— 主流程：PDF 进 → 翻译 → 自动嵌字 → PDF 出
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    pdf: null,
    fileName: '',
    pages: [],
    running: false,
    abort: null
  };

  /* ---------------- 配置存取 ---------------- */
  var TEXT_KEYS = ['base', 'key', 'model', 'temp', 'conc', 'batchChars', 'domain', 'pages', 'scale', 'mode', 'fontScale'];
  var CHK_KEYS = ['optSmartBg', 'optSkipFormula', 'optKeepNumbers', 'optGrow', 'optAutoFill'];

  function loadCfg() {
    var c = {};
    try { c = JSON.parse(localStorage.getItem('pt_cfg') || '{}'); } catch (e) { }
    TEXT_KEYS.forEach(function (k) { var el = $(k); if (el && c[k] !== undefined && c[k] !== '') el.value = c[k]; });
    CHK_KEYS.forEach(function (k) { var el = $(k); if (el && c[k] !== undefined) el.checked = !!c[k]; });
  }
  function saveCfg() {
    var c = {};
    TEXT_KEYS.forEach(function (k) { var el = $(k); if (el) c[k] = el.value; });
    CHK_KEYS.forEach(function (k) { var el = $(k); if (el) c[k] = el.checked; });
    try { localStorage.setItem('pt_cfg', JSON.stringify(c)); } catch (e) { }
  }
  function getCfg() {
    return {
      base: $('base').value.trim(),
      key: $('key').value.trim(),
      model: $('model').value.trim(),
      temp: parseFloat($('temp').value) || 0,
      domain: $('domain').value.trim(),
      concurrency: parseInt($('conc').value, 10) || 1,
      batchChars: parseInt($('batchChars').value, 10) || 1500
    };
  }
  function getOpts() {
    return {
      scale: parseFloat($('scale').value) || 2.5,
      mode: $('mode').value,
      fontScale: parseFloat($('fontScale').value) || 1,
      smartBg: $('optSmartBg').checked,
      skipFormula: $('optSkipFormula').checked,
      keepNumbers: $('optKeepNumbers').checked,
      grow: $('optGrow').checked,
      autoFill: $('optAutoFill').checked,
      maxChars: 400
    };
  }

  /* ---------------- 日志 / 进度 ---------------- */
  function log(msg, level) {
    var box = $('logBox');
    var t = new Date().toTimeString().slice(0, 8);
    var line = document.createElement('div');
    if (level) line.className = 'l-' + level;
    line.textContent = '[' + t + '] ' + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.childNodes.length > 300) box.removeChild(box.firstChild);
  }
  function setProgress(pct, text) {
    $('progFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (text !== undefined) $('progText').textContent = text;
  }
  function busy(on) {
    state.running = on;
    ['btnRunAll', 'btnAnalyze', 'btnTranslate', 'btnRender', 'btnExport', 'btnClear', 'btnTest'].forEach(function (id) {
      $(id).disabled = on;
    });
  }

  /* ---------------- 页范围 ---------------- */
  function parsePages(str, total) {
    str = (str || '').trim();
    if (!str) { var all = []; for (var i = 1; i <= total; i++) all.push(i); return all; }
    var set = {};
    str.split(',').forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = part.match(/^(\d+)\s*[-~－]\s*(\d+)$/);
      if (m) {
        var a = +m[1], b = +m[2];
        if (a > b) { var t = a; a = b; b = t; }
        for (var i = a; i <= b; i++) if (i >= 1 && i <= total) set[i] = 1;
      } else if (/^\d+$/.test(part)) {
        var n = +part; if (n >= 1 && n <= total) set[n] = 1;
      }
    });
    return Object.keys(set).map(Number).sort(function (x, y) { return x - y; });
  }

  /* ---------------- 打开 PDF ---------------- */
  async function openFile(file) {
    if (!file) return;
    state.fileName = file.name || 'paper.pdf';
    log('读取 ' + state.fileName + ' …');
    var buf = await file.arrayBuffer();
    try {
      state.pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    } catch (e) {
      log('PDF 打开失败：' + e.message + '（请用本地 http 服务打开本页，不要用 file:// ）', 'err');
      return;
    }
    log('已载入，共 ' + state.pdf.numPages + ' 页', 'ok');
    state.pages = [];
    setProgress(0, '已载入 ' + state.pdf.numPages + ' 页');
    renderPageCards();
  }

  /* ---------------- 1. 分析 ---------------- */
  async function analyze() {
    if (!state.pdf) { log('先选一个 PDF', 'err'); return; }
    var opts = getOpts();
    var list = parsePages($('pages').value, state.pdf.numPages);
    state.pages = [];
    var t0 = Date.now();
    for (var i = 0; i < list.length; i++) {
      setProgress((i / list.length) * 100, '解析第 ' + list[i] + ' 页（' + (i + 1) + '/' + list.length + '）');
      var p = await PDFParse.analyzePage(state.pdf, list[i], opts);
      state.pages.push(p);
      var sk = 0;
      for (var k = 0; k < p.segs.length; k++) if (p.segs[k].skip) sk++;
      log('P' + p.no + '：' + p.segs.length + ' 个文本块，其中 ' + sk + ' 块按公式/数字跳过' + (p.dual ? '（双栏）' : ''));
    }
    setProgress(100, '解析完成，共 ' + list.length + ' 页，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    renderPageCards();
  }

  /* ---------------- 2. 翻译 ---------------- */
  async function translateAll() {
    var cfg = getCfg();
    if (!cfg.base || !cfg.model) { log('Base URL / 模型 不能为空', 'err'); return; }
    var list = [];
    state.pages.forEach(function (p) {
      p.segs.forEach(function (s) { if (!s.skip && !(s.trans || '').trim()) list.push(s); });
    });
    if (!list.length) { log('没有需要翻译的文本块（可能已翻完或全被跳过）', 'warn'); return; }
    var chars = list.reduce(function (a, s) { return a + s.text.length; }, 0);
    log('待翻译 ' + list.length + ' 块 / ' + chars + ' 字符，开始调用 API …');
    state.abort = new AbortController();
    var t0 = Date.now();
    try {
      var r = await Translator.translateSegments(list, cfg, {
        signal: state.abort.signal,
        onLog: log,
        onProgress: function (d, t, ok, fail) {
          setProgress(d / t * 100, '翻译 ' + d + '/' + t + ' 块（成功 ' + ok + '，失败 ' + fail + '）');
        }
      });
      log('翻译结束：成功 ' + r.ok + ' / 失败 ' + r.fail + '，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', r.fail ? 'warn' : 'ok');
    } catch (e) {
      if (e && e.name === 'AbortError') log('已中断', 'warn');
      else log('翻译出错：' + e.message, 'err');
    }
    renderPageCards();
  }

  /* ---------------- 3. 嵌字渲染 ---------------- */
  async function renderPages(pages) {
    if (!state.pdf || !pages.length) return;
    var opts = getOpts();
    var S = opts.scale;
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      setProgress((i / pages.length) * 100, '渲染第 ' + p.no + ' 页（' + (i + 1) + '/' + pages.length + '）');
      var page = await state.pdf.getPage(p.no);
      var vp = page.getViewport({ scale: S });
      var cv = document.createElement('canvas');
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      var ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      var st = PaperRender.drawSegs(ctx, p.segs, S, opts);
      p.outImg = cv.toDataURL('image/jpeg', 0.92);
      p.stat = st;
      log('P' + p.no + ' 嵌字完成：写入 ' + st.drawn + ' 块，保留原文 ' + st.kept + ' 块' + (st.skipped ? '，无空隙跳过 ' + st.skipped + ' 块' : ''));
      cv.width = cv.height = 0; // 释放
    }
    setProgress(100, '渲染完成');
  }

  async function renderAll() {
    var ready = state.pages.filter(function (p) { return p.segs.length; });
    if (!ready.length) { log('先分析 PDF', 'err'); return; }
    await renderPages(ready);
    renderPageCards();
  }

  /* ---------------- 4. 导出 ---------------- */
  function exportPdf() {
    var ready = state.pages.filter(function (p) { return p.outImg; });
    if (!ready.length) { log('还没有渲染结果，先点「生成嵌字」', 'err'); return; }
    var Ctor = window.jspdf && window.jspdf.jsPDF;
    if (!Ctor) { log('jsPDF 未加载', 'err'); return; }
    var doc = null;
    setProgress(30, '拼装 PDF …');
    ready.forEach(function (p) {
      var orient = p.w > p.h ? 'l' : 'p';
      if (!doc) doc = new Ctor({ unit: 'pt', format: [p.w, p.h], orientation: orient, compress: true });
      else doc.addPage([p.w, p.h], orient);
      doc.addImage(p.outImg, 'JPEG', 0, 0, p.w, p.h, undefined, 'FAST');
    });
    var name = (state.fileName || 'paper').replace(/\.pdf$/i, '') + '_zh.pdf';
    setProgress(100, '导出 ' + name);
    log('导出 ' + ready.length + ' 页 → ' + name, 'ok');
    doc.save(name);
  }

  function exportPng(p) {
    if (!p.outImg) { log('该页还没渲染', 'warn'); return; }
    var a = document.createElement('a');
    a.href = p.outImg;
    a.download = (state.fileName || 'paper').replace(/\.pdf$/i, '') + '_p' + p.no + '.jpg';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------------- 结果区渲染 ---------------- */
  function renderPageCards() {
    var box = $('pagesBox');
    if (!state.pages.length) {
      box.innerHTML = '<div class="empty">还没有内容 —— 先选 PDF，然后点「一键跑完全流程」。</div>';
      return;
    }
    var html = [];
    state.pages.forEach(function (p, pi) {
      var trans = 0, skip = 0;
      p.segs.forEach(function (s) { if (s.skip) skip++; else if ((s.trans || '').trim()) trans++; });
      html.push('<div class="page" data-pi="' + pi + '">');
      html.push('  <div class="ph"><span class="no">P' + p.no + '</span>');
      html.push('<span class="tag">' + p.segs.length + ' 块</span>');
      html.push('<span class="tag ok">译 ' + trans + '</span>');
      if (skip) html.push('<span class="tag sk">跳过 ' + skip + '</span>');
      html.push('<span class="sp"></span>');
      html.push('<button data-act="render1" data-pi="' + pi + '">重新嵌字</button>');
      html.push('<button data-act="png" data-pi="' + pi + '">下载图</button>');
      html.push('</div>');
      html.push('  <div class="body">');
      html.push('    <div>');
      if (p.outImg) html.push('<img class="thumb" data-act="zoom" data-pi="' + pi + '" src="' + p.outImg + '" alt="P' + p.no + '" />');
      else html.push('<div class="empty">尚未嵌字<br>（点上方「3. 生成嵌字」）</div>');
      html.push('    </div>');
      html.push('    <div>');
      for (var i = 0; i < p.segs.length; i++) {
        var s = p.segs[i];
        html.push('<div class="seg' + (s.skip ? ' sk' : '') + '" data-pi="' + pi + '" data-si="' + i + '">');
        html.push('<div class="src">#' + i + ' · ' + s.fontSize.toFixed(1) + 'pt · ' + esc(s.text.slice(0, 400)) + (s.skip ? ' <span class="tag sk">' + s.skipReason + '</span>' : '') + '</div>');
        if (!s.skip) {
          html.push('<textarea data-pi="' + pi + '" data-si="' + i + '" placeholder="（译文）">' + esc(s.trans || '') + '</textarea>');
        }
        html.push('</div>');
      }
      html.push('    </div>');
      html.push('  </div>');
      html.push('</div>');
    });
    box.innerHTML = html.join('\n');
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('file').addEventListener('change', function (e) { openFile(e.target.files[0]); });

    $('btnTest').addEventListener('click', async function () {
      try {
        setProgress(20, '测试 API …');
        var out = await Translator.testConnection(getCfg());
        $('apiStatus').innerHTML = '<b>连接正常</b>';
        setProgress(100, 'API 可用');
        log('API 测试返回：' + out.replace(/\s+/g, ' ').slice(0, 100), 'ok');
      } catch (e) {
        $('apiStatus').innerHTML = '<span style="color:#f85149">失败</span>';
        setProgress(0, 'API 不可用');
        log('API 测试失败：' + e.message, 'err');
      }
    });

    $('btnAnalyze').addEventListener('click', async function () {
      busy(true);
      try { await analyze(); } catch (e) { log(e.message, 'err'); }
      busy(false);
    });

    $('btnTranslate').addEventListener('click', async function () {
      busy(true);
      try { await translateAll(); } catch (e) { log(e.message, 'err'); }
      busy(false);
    });

    $('btnRender').addEventListener('click', async function () {
      busy(true);
      try { await renderAll(); } catch (e) { log(e.message, 'err'); }
      busy(false);
    });

    $('btnExport').addEventListener('click', function () { exportPdf(); });

    $('btnRunAll').addEventListener('click', async function () {
      if (state.running) return;
      busy(true);
      try {
        setProgress(0, '开始');
        await analyze();
        await translateAll();
        await renderAll();
        log('全流程完成，按「4. 导出 PDF」拿走译文文件 🐋', 'ok');
      } catch (e) {
        log('流程中断：' + (e && e.message), 'err');
      }
      busy(false);
    });

    $('btnClear').addEventListener('click', function () {
      state.pdf = null; state.pages = []; state.fileName = '';
      $('file').value = '';
      $('logBox').textContent = '';
      log('已清空');
      renderPageCards();
      setProgress(0, '待开始');
    });

    // 结果区委托事件
    $('pagesBox').addEventListener('input', function (e) {
      var ta = e.target;
      if (ta.tagName !== 'TEXTAREA') return;
      var pi = +ta.dataset.pi, si = +ta.dataset.si;
      if (state.pages[pi] && state.pages[pi].segs[si]) state.pages[pi].segs[si].trans = ta.value;
    });

    $('pagesBox').addEventListener('click', async function (e) {
      var t = e.target;
      var act = t.dataset && t.dataset.act;
      if (!act) return;
      var pi = +t.dataset.pi;
      var p = state.pages[pi];
      if (act === 'zoom' && p && p.outImg) { $('viewerImg').src = p.outImg; $('viewer').classList.add('on'); return; }
      if (act === 'png' && p) { exportPng(p); return; }
      if (act === 'render1' && p) {
        busy(true);
        try {
          await renderPages([p]);
          renderPageCards();
          log('P' + p.no + ' 已重新嵌字', 'ok');
        } catch (err) { log(err.message, 'err'); }
        busy(false);
      }
    });

    $('viewerClose').addEventListener('click', function () { $('viewer').classList.remove('on'); });
    $('viewer').addEventListener('click', function (e) { if (e.target === $('viewer')) $('viewer').classList.remove('on'); });

    // 配置变更即存
    document.addEventListener('change', saveCfg);
    document.addEventListener('blur', saveCfg, true);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    loadCfg();
    bind();
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    } else {
      log('pdf.js 未加载，检查 lib/ 目录', 'err');
    }
    log('就绪。API 只管翻译，嵌字全自动。');
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();