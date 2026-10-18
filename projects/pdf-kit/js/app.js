/* ============================================================
   PDF 拆分 · 合并 —— 主逻辑
   PDF.js  负责「看」（缩略图、预览）
   pdf-lib 负责「写」（复制页、重组、旋转、导出）
   zip.js  负责把多份输出打包
   一句上传都没有：全部在内存里过一遍。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var HUE = [188, 262, 330, 42, 152, 8, 212, 286, 96, 20, 176, 310];

  var S = {
    files: [],            // { id, name, size, bytes, pdfDoc, numPages, hue }
    entries: [],          // { id, fid, pageIdx, rot, sel }
    seq: 1,
    hue: 0,
    busy: false,
    cancel: false,
    progress: { done: 0, total: 0 },
    splitMode: 'range'
  };

  var els = {};
  var io = null;
  var queue = [];
  var pumping = false;
  var drag = null;
  var dragDepth = 0;
  var toastTimer = 0;

  /* ---------------- 小工具 ---------------- */

  function tick() {
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
  }

  function fmtSize(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) +
      '-' + pad(d.getHours(), 2) + pad(d.getMinutes(), 2);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"', "'": '&#39;' }[c];
    });
  }

  function fileOf(id) {
    for (var i = 0; i < S.files.length; i++) if (S.files[i].id === id) return S.files[i];
    return null;
  }

  function entryOf(id) {
    for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) return S.entries[i];
    return null;
  }

  function abortError() {
    var e = new Error('已取消');
    e.__abort = true;
    return e;
  }

  function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function toast(msg, kind) {
    els.toast.textContent = msg;
    els.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.className = 'toast' + (kind ? ' ' + kind : '');
    }, 2800);
  }

  function save(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 12000);
  }

  /* ---------------- 载入 ---------------- */

  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true;
    return false;
  }

  function addFiles(list) {
    var arr = Array.prototype.slice.call(list || []);
    var pdfs = arr.filter(function (f) {
      return /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    });
    if (!pdfs.length) {
      toast('只认 PDF 文件', 'err');
      return;
    }
    if (pdfs.length !== arr.length) {
      toast('跳过了 ' + (arr.length - pdfs.length) + ' 个非 PDF 文件', 'err');
    }
    var chain = Promise.resolve();
    pdfs.forEach(function (f) {
      chain = chain.then(function () { return addOne(f); });
    });
    chain.then(function () {
      syncAll();
      if (S.entries.length) setStatus('工位共 ' + S.entries.length + ' 页，可以开始拆了', 'ok');
    });
  }

  function addOne(file) {
    setStatus('读取 ' + file.name + ' …');
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      return window.pdfjsLib.getDocument({
        data: new Uint8Array(bytes),   // 副本：pdf.js 会把它 transfer 给 worker
        isEvalSupported: false
      }).promise.then(function (doc) {
        var rec = {
          id: 'f' + (S.seq++),
          name: file.name,
          size: file.size || bytes.length,
          bytes: bytes,
          pdfDoc: doc,
          numPages: doc.numPages,
          hue: HUE[S.hue++ % HUE.length]
        };
        S.files.push(rec);
        for (var i = 0; i < rec.numPages; i++) {
          S.entries.push({ id: 'e' + (S.seq++), fid: rec.id, pageIdx: i, rot: 0, sel: false });
        }
      });
    }).catch(function (err) {
      if (err && err.name === 'PasswordException') {
        toast(file.name + ' 有密码，先解密再拖进来', 'err');
      } else {
        toast('打不开 ' + file.name + '：' + ((err && err.message) || err), 'err');
      }
    });
  }

  /* ---------------- 渲染 ---------------- */

  function syncAll() {
    renderFiles();
    renderPages();
    syncStats();
  }

  function renderFiles() {
    var html = S.files.map(function (f) {
      var present = S.entries.filter(function (e) { return e.fid === f.id; }).length;
      var canRestore = present < f.numPages;
      return '<div class="file" data-fid="' + f.id + '" style="--h:' + f.hue + '">' +
        '<i class="dot"></i>' +
        '<div class="fi"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b>' +
        '<span>' + present + ' / ' + f.numPages + ' 页 · ' + fmtSize(f.size) + '</span></div>' +
        (canRestore ? '<button class="x" data-act="restore-file" title="把移出去的页放回工位">↺</button>' : '') +
        '<button class="x" data-act="rm-file" title="移除这个文件">×</button>' +
        '</div>';
    }).join('');
    els.files.innerHTML = html;
  }

  function buildCard(e) {
    var f = fileOf(e.fid);
    var el = document.createElement('article');
    el.className = 'pg' + (e.sel ? ' sel' : '');
    el.dataset.eid = e.id;
    el.style.setProperty('--h', f ? f.hue : 200);
    el.innerHTML =
      '<div class="pg-top">' +
        '<span class="pg-no"></span><span class="pg-src"></span>' +
        '<span class="pg-of">p.' + (e.pageIdx + 1) + '</span>' +
        '<button class="pg-hnd" data-act="drag" title="按住拖动，换个位置">⠿</button>' +
      '</div>' +
      '<div class="pg-img"><span class="spin"></span></div>' +
      '<div class="pg-foot"><span class="pg-size"></span>' +
        '<button class="pg-zoom" data-act="zoom" title="放大看这一页">⤢</button></div>' +
      '<span class="pg-tick">✓</span>';
    paintRot(el, e);
    io.observe(el);
    return el;
  }

  function paintRot(el, e) {
    var s = el.querySelector('.pg-size');
    if (s) s.textContent = e.rot ? '↻ ' + e.rot + '°' : '';
  }

  function renderPages() {
    els.pages.innerHTML = '';
    var frag = document.createDocumentFragment();
    S.entries.forEach(function (e) { frag.appendChild(buildCard(e)); });
    els.pages.appendChild(frag);
    renumber();
  }

  function renumber() {
    $$('.pg', els.pages).forEach(function (card, i) {
      var no = card.querySelector('.pg-no');
      if (no) no.textContent = i + 1;
    });
  }

  function syncStats() {
    var total = S.entries.length;
    var sel = S.entries.filter(function (e) { return e.sel; }).length;
    els.badgePages.textContent = total + ' 页';
    els.badgeSel.textContent = '选中 ' + sel;
    els.badgeSel.classList.toggle('on', sel > 0);
    els.cntAll.textContent = total;
    els.cntSel.textContent = sel;
    els.btnExportAll.disabled = S.busy || total === 0;
    els.btnExportSel.disabled = S.busy || sel === 0;
    els.btnSplit.disabled = S.busy || total === 0;
    els.empty.hidden = total > 0;
    els.toolbar.hidden = total === 0;
  }

  /* ---------------- 缩略图流水线 ---------------- */

  function enqueue(card) {
    if (!card || card._drawn || card._queued) return;
    card._queued = true;
    queue.push(card);
    pump();
  }

  function pump() {
    if (pumping) return;
    pumping = true;
    (function next() {
      if (!queue.length) { pumping = false; return; }
      var card = queue.shift();
      if (!card.isConnected || card._drawn) {
        card._queued = false;
        return next();
      }
      drawThumb(card).then(function () {
        card._queued = false;
        return tick();
      }).then(next, function () {
        card._queued = false;
        next();
      });
    })();
  }

  function drawThumb(card) {
    var e = entryOf(card.dataset.eid);
    if (!e) return Promise.resolve();
    var f = fileOf(e.fid);
    if (!f || !f.pdfDoc) return Promise.resolve();
    return f.pdfDoc.getPage(e.pageIdx + 1).then(function (page) {
      if (!card.isConnected) return;
      var rot = ((page.rotate + e.rot) % 360 + 360) % 360;
      var base = page.getViewport({ scale: 1, rotation: rot });
      var host = card.querySelector('.pg-img');
      if (!host) return;
      var cssW = host.clientWidth || 100;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var scale = Math.max(0.12, (cssW * dpr) / base.width);
      var vp = page.getViewport({ scale: scale, rotation: rot });
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vp.width));
      cv.height = Math.max(1, Math.round(vp.height));
      return page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise.then(function () {
        if (!card.isConnected) return;
        var old = host.querySelector('canvas');
        if (old) old.remove();
        var spin = host.querySelector('.spin');
        if (spin) spin.remove();
        host.appendChild(cv);
        host.style.aspectRatio = vp.width + '/' + vp.height;
        card._drawn = true;
      });
    });
  }

  function refreshCard(card) {
    var host = card.querySelector('.pg-img');
    if (!host) return;
    $$('canvas', host).forEach(function (c) { c.remove(); });
    if (!host.querySelector('.spin')) {
      var s = document.createElement('span');
      s.className = 'spin';
      host.insertBefore(s, host.firstChild);
    }
    host.style.aspectRatio = '';
    card._drawn = false;
    card._queued = false;
    enqueue(card);
  }

  /* ---------------- 选择 ---------------- */

  function setSel(card, on) {
    var e = entryOf(card.dataset.eid);
    if (!e) return;
    e.sel = on;
    card.classList.toggle('sel', on);
  }

  function selectAll(on) {
    $$('.pg', els.pages).forEach(function (c) { setSel(c, on); });
    syncStats();
  }

  function invertSel() {
    $$('.pg', els.pages).forEach(function (c) {
      setSel(c, !c.classList.contains('sel'));
    });
    syncStats();
  }

  function paritySel(odd) {
    $$('.pg', els.pages).forEach(function (c, i) {
      setSel(c, odd ? (i % 2 === 0) : (i % 2 === 1));
    });
    syncStats();
  }

  function applyExpr() {
    var expr = els.selExpr.value.trim();
    if (!expr) { toast('先填个编号，例如 1-3,7', 'err'); return; }
    var groups;
    try {
      groups = parsePageRanges(expr, S.entries.length);
    } catch (err) {
      toast(err.message, 'err');
      return;
    }
    var want = {};
    groups.forEach(function (g) { g.forEach(function (n) { want[n] = 1; }); });
    var count = 0;
    $$('.pg', els.pages).forEach(function (c, i) {
      var on = !!want[i + 1];
      setSel(c, on);
      if (on) count++;
    });
    syncStats();
    toast('选中了 ' + count + ' 页', 'ok');
  }

  /* ---------------- 页码表达式 ---------------- */

  function toPageNum(v, total) {
    if (!v) return null;
    if (v > 0) return v <= total ? v : null;
    var p = total + v + 1;
    return p >= 1 ? p : null;
  }

  function rangeArr(a, b, step) {
    var out = [];
    var p;
    if (step > 0) { for (p = a; p <= b; p++) out.push(p); }
    else { for (p = a; p >= b; p--) out.push(p); }
    return out;
  }

  /* 支持：3 / 1-5 / 5- / -1（倒数第一页）/ -3--1 / 逗号分段 */
  function parsePageRanges(expr, total) {
    var groups = [];
    var segs = String(expr).split(/[,，;；\n]+/).map(function (s) { return s.trim(); })
      .filter(Boolean);
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var m;
      if (seg === '-' || seg === '*' || /^(全部|所有|all)$/i.test(seg)) {
        groups.push(rangeArr(1, total, 1));
        continue;
      }
      if ((m = seg.match(/^(-?\d+)\s*(?:-|~|–|—|至|到)\s*(-?\d+)$/))) {
        var a = toPageNum(parseInt(m[1], 10), total);
        var b = toPageNum(parseInt(m[2], 10), total);
        if (a === null || b === null) throw new Error('页码超出范围：' + seg);
        groups.push(rangeArr(a, b, a <= b ? 1 : -1));
        continue;
      }
      if ((m = seg.match(/^(\d+)\s*[-~–—]\s*$/))) {
        var st = toPageNum(parseInt(m[1], 10), total);
        if (st === null) throw new Error('页码超出范围：' + seg);
        groups.push(rangeArr(st, total, 1));
        continue;
      }
      if (/^-?\d+$/.test(seg)) {
        var one = toPageNum(parseInt(seg, 10), total);
        if (one === null) throw new Error('页码超出范围：' + seg);
        groups.push([one]);
        continue;
      }
      throw new Error('看不懂这段：' + seg);
    }
    if (!groups.length) throw new Error('范围是空的');
    return groups;
  }

  /* ---------------- 写 PDF ---------------- */

  function paintProgress() {
    var p = S.progress;
    var pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
    els.progressFill.style.width = pct + '%';
    if (S.busy) setStatus(p.done + ' / ' + p.total + ' 页 · ' + pct + '%');
  }

  function buildPdf(list) {
    var PL = window.PDFLib;
    if (!PL) return Promise.reject(new Error('PDF 引擎还没就绪，稍等一秒再试'));

    var groups = [];
    var map = {};
    list.forEach(function (e) {
      if (!map[e.fid]) { map[e.fid] = { fid: e.fid, items: [] }; groups.push(map[e.fid]); }
      map[e.fid].items.push(e);
    });

    var buckets = {};   // fid -> { pageIdx: [pageObj…] }

    return PL.PDFDocument.create().then(function (out) {
      var chain = Promise.resolve();
      groups.forEach(function (g) {
        chain = chain.then(function () {
          if (S.cancel) throw abortError();
          var f = fileOf(g.fid);
          if (!f) throw new Error('源文件不见了');
          setStatus('解析 ' + f.name + ' · ' + g.items.length + ' 页…');
          return PL.PDFDocument.load(f.bytes, { ignoreEncryption: true, updateMetadata: false })
            .then(function (src) {
              var idx = [];
              var seen = {};
              g.items.forEach(function (it) {
                if (!seen[it.pageIdx]) { seen[it.pageIdx] = 1; idx.push(it.pageIdx); }
              });
              var dup = idx.length !== g.items.length;
              if (!dup) {
                return out.copyPages(src, idx).then(function (pages) {
                  var m = {};
                  idx.forEach(function (pi, k) { m[pi] = [pages[k]]; });
                  buckets[g.fid] = m;
                });
              }
              // 同一页被排了多次：逐份单独复制，避免多个位置引用同一页面对象
              var m2 = {};
              var sub = Promise.resolve();
              g.items.forEach(function (it) {
                sub = sub.then(function () {
                  return out.copyPages(src, [it.pageIdx]).then(function (ps) {
                    if (!m2[it.pageIdx]) m2[it.pageIdx] = [];
                    m2[it.pageIdx].push(ps[0]);
                  });
                });
              });
              return sub.then(function () { buckets[g.fid] = m2; });
            });
        });
      });

      return chain.then(function () {
        return new Promise(function (resolve, reject) {
          (function step(i) {
            if (i >= list.length) {
              out.setProducer("Whale's Garden · PDF Kit");
              out.setCreator("Whale's Garden · PDF Kit");
              out.save({ useObjectStreams: true }).then(resolve, reject);
              return;
            }
            if (S.cancel) { reject(abortError()); return; }
            var e = list[i];
            var bucket = buckets[e.fid] && buckets[e.fid][e.pageIdx];
            var p = bucket && bucket.shift();
            if (!p) { reject(new Error('第 ' + (i + 1) + ' 页取不出来')); return; }
            if (e.rot) {
              var cur = (p.getRotation() && p.getRotation().angle) || 0;
              p.setRotation(PL.degrees(((cur + e.rot) % 360 + 360) % 360));
            }
            out.addPage(p);
            S.progress.done++;
            paintProgress();
            if (i % 8 === 0) {
              tick().then(function () { step(i + 1); });
            } else {
              step(i + 1);
            }
          })(0);
        });
      });
    });
  }

  function baseName(def) {
    var v = (els.outName.value || '').trim();
    v = v.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\n\r\t]/g, '-').trim();
    v = v.replace(/-+/g, '-').replace(/^-|-$/g, '');
    return v || def;
  }

  function setBusy(on) {
    S.busy = on;
    els.btnCancel.hidden = !on;
    els.progress.classList.toggle('busy', on);
    els.btnAdd.disabled = on;
    els.btnEmptyAdd.disabled = on;
    $$('.toolbar button').forEach(function (b) { b.disabled = on; });
    if (!on) {
      if (S.cancel) els.progressFill.style.width = '0%';
      S.progress.done = 0;
      S.progress.total = 0;
    }
    syncStats();
  }

  function handleErr(err) {
    if (err && err.__abort) {
      setStatus('已取消');
      toast('已取消');
      return;
    }
    console.error(err);
    var msg = (err && err.message) || String(err);
    setStatus('出错：' + msg, 'err');
    toast('出错：' + msg, 'err');
  }

  /* ---------------- 导出 ---------------- */

  function runExport(list, defName) {
    if (S.busy) return;
    if (!list.length) { toast('还没有可导出的页', 'err'); return; }
    S.cancel = false;
    S.progress = { done: 0, total: list.length };
    setBusy(true);
    paintProgress();
    return buildPdf(list).then(function (bytes) {
      var name = baseName(defName) + '.pdf';
      save(new Blob([bytes], { type: 'application/pdf' }), name);
      setStatus('已导出 ' + name + ' · ' + fmtSize(bytes.length), 'ok');
      toast('已导出 ' + name, 'ok');
    }).catch(handleErr).then(function () {
      setBusy(false);
    });
  }

  function exportAll() {
    return runExport(S.entries.slice(), '合并-' + stamp());
  }

  function exportSel() {
    var list = S.entries.filter(function (e) { return e.sel; });
    if (!list.length) { toast('先选中几页', 'err'); return; }
    return runExport(list, '选中-' + stamp());
  }

  /* ---------------- 拆分 ---------------- */

  function splitGroups(pool) {
    var mode = S.splitMode;
    if (mode === 'single') {
      return pool.map(function (e) { return [e]; });
    }
    if (mode === 'every') {
      var n = parseInt(els.splitEvery.value, 10);
      if (!n || n < 1) n = 1;
      var g = [];
      for (var i = 0; i < pool.length; i += n) g.push(pool.slice(i, i + n));
      return g;
    }
    var expr = els.splitRange.value.trim();
    if (!expr) {
      toast('填个范围，例如 1-3,5,8-', 'err');
      return null;
    }
    var groups = parsePageRanges(expr, pool.length);
    return groups.map(function (nums) {
      return nums.map(function (n) { return pool[n - 1]; }).filter(Boolean);
    }).filter(function (g2) { return g2.length; });
  }

  function doSplit() {
    if (S.busy) return;
    var pool = els.splitSel.checked
      ? S.entries.filter(function (e) { return e.sel; })
      : S.entries.slice();
    if (!pool.length) { toast('没有可拆的页', 'err'); return; }

    var groups;
    try {
      groups = splitGroups(pool);
    } catch (err) {
      toast(err.message, 'err');
      return;
    }
    if (!groups) return;
    if (!groups.length) { toast('范围没对上任何页', 'err'); return; }

    var totalPages = groups.reduce(function (a, g) { return a + g.length; }, 0);
    if (groups.length > 200) toast('要拆 ' + groups.length + ' 份，可能有点久…', 'err');

    var prefix = baseName('拆分-' + stamp());
    S.cancel = false;
    S.progress = { done: 0, total: totalPages };
    setBusy(true);
    paintProgress();

    var outs = [];
    var chain = Promise.resolve();
    groups.forEach(function (g, i) {
      chain = chain.then(function () {
        if (S.cancel) throw abortError();
        setStatus('第 ' + (i + 1) + ' / ' + groups.length + ' 份 · 写盘中…');
        return buildPdf(g).then(function (bytes) {
          outs.push({
            name: groupName(prefix, i, groups.length, g, pool),
            data: bytes
          });
          return tick();
        });
      });
    });

    return chain.then(function () {
      if (outs.length === 1) {
        save(new Blob([outs[0].data], { type: 'application/pdf' }), outs[0].name);
        setStatus('已导出 ' + outs[0].name + ' · ' + fmtSize(outs[0].data.length), 'ok');
        toast('已导出 ' + outs[0].name, 'ok');
      } else {
        setStatus('打包 ' + outs.length + ' 份…');
        var blob = window.WhaleZip.store(outs);
        save(blob, prefix + '.zip');
        setStatus('已打包 ' + outs.length + ' 份 · ' + fmtSize(blob.size), 'ok');
        toast('已打包 ' + outs.length + ' 份 ZIP', 'ok');
      }
    }).catch(handleErr).then(function () {
      setBusy(false);
    });
  }

  function groupName(prefix, i, count, group, pool) {
    if (count === 1) return prefix + '.pdf';
    var digits = String(count).length < 3 ? 3 : String(count).length;
    if (S.splitMode === 'single') {
      var pos = pool.indexOf(group[0]) + 1;
      return prefix + '-' + pad(pos, digits) + '.pdf';
    }
    return prefix + '-' + pad(i + 1, digits) + '.pdf';
  }

  /* ---------------- 删除 / 旋转 / 恢复 ---------------- */

  function removeSel() {
    var cards = $$('.pg.sel', els.pages);
    if (!cards.length) { toast('先选中要删的页', 'err'); return; }
    var fids = {};
    cards.forEach(function (c) {
      var e = entryOf(c.dataset.eid);
      if (e) fids[e.fid] = 1;
    });
    var ids = cards.map(function (c) { return c.dataset.eid; });
    S.entries = S.entries.filter(function (e) { return ids.indexOf(e.id) < 0; });
    cards.forEach(function (c) { c.remove(); });
    Object.keys(fids).forEach(function (fid) {
      var still = S.entries.some(function (e) { return e.fid === fid; });
      if (!still) S.files = S.files.filter(function (f) { return f.id !== fid; });
    });
    renumber();
    renderFiles();
    syncStats();
    setStatus('移出 ' + ids.length + ' 页（源文件还在列表里，点 ↺ 可放回）');
  }

  function rotateSel() {
    var cards = $$('.pg.sel', els.pages);
    if (!cards.length) { toast('先选中要转的页', 'err'); return; }
    cards.forEach(function (c) {
      var e = entryOf(c.dataset.eid);
      if (!e) return;
      e.rot = (e.rot + 90) % 360;
      paintRot(c, e);
      refreshCard(c);
    });
    toast('转了 ' + cards.length + ' 页 90°', 'ok');
  }

  function restoreFile(fid) {
    var f = fileOf(fid);
    if (!f) return;
    var present = S.entries.filter(function (e) { return e.fid === fid; });
    var anchor = present.length ? S.entries.indexOf(present[0]) : S.entries.length;
    S.entries = S.entries.filter(function (e) { return e.fid !== fid; });
    var fresh = [];
    for (var i = 0; i < f.numPages; i++) {
      fresh.push({ id: 'e' + (S.seq++), fid: fid, pageIdx: i, rot: 0, sel: false });
    }
    Array.prototype.splice.apply(S.entries, [anchor, 0].concat(fresh));
    renderPages();
    renderFiles();
    syncStats();
    setStatus('已把 ' + f.name + ' 的 ' + fresh.length + ' 页放回工位', 'ok');
  }

  function removeFile(fid) {
    var f = fileOf(fid);
    if (!f) return;
    S.entries = S.entries.filter(function (e) { return e.fid !== fid; });
    S.files = S.files.filter(function (x) { return x.id !== fid; });
    syncAll();
    setStatus('已移除 ' + f.name);
  }

  /* ---------------- 大图 ---------------- */

  function openLightbox(card) {
    var e = entryOf(card.dataset.eid);
    if (!e) return;
    var f = fileOf(e.fid);
    if (!f || !f.pdfDoc) return;
    var idx = S.entries.indexOf(e) + 1;
    els.lbLabel.textContent = '第 ' + idx + ' 页 / 共 ' + S.entries.length + ' 页 · 原文件第 ' + (e.pageIdx + 1) + ' 页';
    els.lightbox.hidden = false;
    return f.pdfDoc.getPage(e.pageIdx + 1).then(function (page) {
      var rot = ((page.rotate + e.rot) % 360 + 360) % 360;
      var base = page.getViewport({ scale: 1, rotation: rot });
      var maxW = Math.min(window.innerWidth * 0.92, 880);
      var maxH = window.innerHeight * 0.74;
      var scale = Math.min(maxW / base.width, maxH / base.height);
      var vp = page.getViewport({ scale: scale, rotation: rot });
      var cv = els.lbCanvas;
      cv.width = Math.round(vp.width);
      cv.height = Math.round(vp.height);
      return page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
    }).catch(function () {});
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lbCanvas.width = 1;
    els.lbCanvas.height = 1;
  }

  /* ---------------- 拖动排序 ---------------- */

  function onHandleDown(ev) {
    var hnd = ev.target.closest ? ev.target.closest('.pg-hnd') : null;
    if (!hnd || S.busy) return;
    var card = hnd.closest('.pg');
    if (!card) return;
    ev.preventDefault();
    drag = { card: card, x: ev.clientX, y: ev.clientY };
    card.classList.add('dragging');
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);
  }

  function onDragMove(ev) {
    if (!drag) return;
    ev.preventDefault();
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el) return;
    var over = el.closest ? el.closest('.pg') : null;
    if (!over || over === drag.card) return;
    var r = over.getBoundingClientRect();
    var after = ev.clientX > r.left + r.width / 2;
    over.parentNode.insertBefore(drag.card, after ? over.nextSibling : over);
  }

  function onDragUp() {
    if (!drag) return;
    drag.card.classList.remove('dragging');
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragUp);
    var order = $$('.pg', els.pages).map(function (c) { return c.dataset.eid; });
    var map = {};
    S.entries.forEach(function (e) { map[e.id] = e; });
    S.entries = order.map(function (id) { return map[id]; }).filter(Boolean);
    renumber();
    drag = null;
    setStatus('顺序已更新');
  }

  /* ---------------- 初始化 ---------------- */

  function cacheEls() {
    els = {
      files: $('#files'),
      fileInput: $('#file-input'),
      btnAdd: $('#btn-add'),
      btnEmptyAdd: $('#btn-empty-add'),
      pages: $('#pages'),
      toolbar: $('#toolbar'),
      empty: $('#empty'),
      badgePages: $('#badge-pages'),
      badgeSel: $('#badge-sel'),
      cntAll: $('#cnt-all'),
      cntSel: $('#cnt-sel'),
      btnExportAll: $('#btn-export-all'),
      btnExportSel: $('#btn-export-sel'),
      btnSplit: $('#btn-split'),
      btnCancel: $('#btn-cancel'),
      outName: $('#out-name'),
      splitMode: $('#split-mode'),
      splitRange: $('#split-range'),
      splitEvery: $('#split-every'),
      splitSel: $('#split-sel'),
      selExpr: $('#sel-expr'),
      btnSelApply: $('#btn-sel-apply'),
      progress: $('#progress'),
      progressFill: $('#progress-fill'),
      status: $('#status'),
      toast: $('#toast'),
      veil: $('#veil'),
      lightbox: $('#lightbox'),
      lbCanvas: $('#lb-canvas'),
      lbLabel: $('#lb-label'),
      lbClose: $('#lb-close')
    };
  }

  function bind() {
    els.btnAdd.addEventListener('click', function () { els.fileInput.click(); });
    els.btnEmptyAdd.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files && els.fileInput.files.length) addFiles(els.fileInput.files);
      els.fileInput.value = '';
    });

    els.files.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      var row = btn.closest('.file');
      if (!row) return;
      if (btn.dataset.act === 'rm-file') removeFile(row.dataset.fid);
      else if (btn.dataset.act === 'restore-file') restoreFile(row.dataset.fid);
    });

    // 页面：点选 / 放大 / 拖动手柄
    els.pages.addEventListener('click', function (ev) {
      var card = ev.target.closest('.pg');
      if (!card) return;
      if (ev.target.closest('.pg-zoom')) { openLightbox(card); return; }
      if (ev.target.closest('.pg-hnd')) return;
      setSel(card, !card.classList.contains('sel'));
      syncStats();
    });
    els.pages.addEventListener('pointerdown', onHandleDown);

    // 工具栏
    els.toolbar.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-act]');
      if (!b || S.busy) return;
      var act = b.dataset.act;
      if (act === 'all') selectAll(true);
      else if (act === 'none') selectAll(false);
      else if (act === 'invert') invertSel();
      else if (act === 'odd') paritySel(true);
      else if (act === 'even') paritySel(false);
      else if (act === 'reverse') {
        S.entries.reverse();
        renderPages();
        syncStats();
        setStatus('顺序已反转');
      }
      else if (act === 'rotate') rotateSel();
      else if (act === 'remove') removeSel();
    });

    els.btnSelApply.addEventListener('click', applyExpr);
    els.selExpr.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); applyExpr(); }
    });

    // 导出 / 拆分
    els.btnExportAll.addEventListener('click', exportAll);
    els.btnExportSel.addEventListener('click', exportSel);
    els.btnSplit.addEventListener('click', doSplit);
    els.btnCancel.addEventListener('click', function () {
      S.cancel = true;
      setStatus('正在取消…');
    });

    // 拆分模式
    els.splitMode.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-mode]');
      if (!b) return;
      S.splitMode = b.dataset.mode;
      $$('button', els.splitMode).forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      $$('[data-mode-field]').forEach(function (f) {
        f.hidden = f.dataset.modeField !== S.splitMode;
      });
    });

    // 大图
    els.lbClose.addEventListener('click', closeLightbox);
    els.lightbox.addEventListener('click', function (ev) {
      if (ev.target === els.lightbox) closeLightbox();
    });

    // 拖拽文件
    window.addEventListener('dragenter', function (ev) {
      if (!hasFiles(ev)) return;
      dragDepth++;
      els.veil.hidden = false;
    });
    window.addEventListener('dragover', function (ev) {
      if (hasFiles(ev)) ev.preventDefault();
    });
    window.addEventListener('dragleave', function (ev) {
      if (!hasFiles(ev)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) els.veil.hidden = true;
    });
    window.addEventListener('drop', function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      dragDepth = 0;
      els.veil.hidden = true;
      addFiles(ev.dataTransfer.files);
    });

    // 快捷键
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      var mod = ev.ctrlKey || ev.metaKey;
      var k = (ev.key || '').toLowerCase();

      if (mod && k === 'o') { ev.preventDefault(); els.fileInput.click(); return; }
      if (mod && k === 's') { ev.preventDefault(); if (!S.busy) exportAll(); return; }
      if (mod && k === 'a') { if (typing) return; ev.preventDefault(); selectAll(true); return; }
      if (k === 'escape') {
        if (!els.lightbox.hidden) { closeLightbox(); return; }
        if (typing) { ev.target.blur(); return; }
        selectAll(false);
        return;
      }
      if (!typing && !S.busy && (k === 'delete' || k === 'backspace')) {
        if ($$('.pg.sel', els.pages).length) { ev.preventDefault(); removeSel(); }
      }
    });

    window.addEventListener('resize', function () {
      if (!els.lightbox.hidden) closeLightbox();
    });
  }

  function init() {
    cacheEls();

    io = new IntersectionObserver(function (list) {
      list.forEach(function (en) {
        if (en.isIntersecting) {
          io.unobserve(en.target);
          enqueue(en.target);
        }
      });
    }, { rootMargin: '600px 0px' });

    if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    }

    bind();
    syncStats();
    setStatus('就绪');

    if (!window.PDFLib || !window.pdfjsLib || !window.WhaleZip) {
      setStatus('引擎加载中…', 'err');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();