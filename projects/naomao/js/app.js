/* ============================================================
   闹麻编辑器 · 交互层 NAOMAO APP
   ============================================================ */
(function (global) {
  'use strict';

  const E = global.NAOMAO_ENGINE;
  const $ = function (id) { return document.getElementById(id); };

  const el = {
    src: $('src'), out: $('outView'), chips: $('chips'), mapHint: $('mapHint'),
    stChars: $('stChars'), stHits: $('stHits'), stEmoji: $('stEmoji'), ruleInfo: $('ruleInfo'),
    btnRun: $('btnRun'), btnDiff: $('btnDiff'), btnCopy: $('btnCopy'), btnDown: $('btnDown'),
    btnTheme: $('btnTheme'), diffBox: $('diffBox'), diffBody: $('diffBody'), diffClose: $('diffClose'),
    toast: $('toast'), ticker: $('ticker')
  };

  /* ------------------------------------------------------------
     固定的标注规则（不再让用户选，直接按最舒服的那套来）
       空格     中文与 emoji 之间加一个空格
       安全     词后面本来就跟着 emoji 就不叠加
       连续同词 只标第一个，避免「看👀看👀」
       标点     不再抑制——词后紧跟标点也照标，emoji 落在标点前，
                这样句末的词不会被漏掉
     ------------------------------------------------------------ */
  const RULES = Object.freeze({
    space: true,
    punct: false,
    safe: true,
    once: false,
    minLen: 1
  });

  const PH = '<span class="ph">输出会出现在这里 —— 左边先来点字，或者点「示例」。</span>';

  let nodes = [];
  let hits = [];
  let timer = null;

  /* ---------- 小工具 ---------- */
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(el.toast._t);
    el.toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 1600);
  }

  function opts() { return RULES; }

  /* 从 nodes 重建 hits（永远以 nodes 为唯一真相） */
  function rebuildHits() {
    const out = [];
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'hit' && n.e) {
        out.push({ word: n.w, emoji: n.e, group: n.g, all: n.all, id: n.id });
      }
    }
    return out;
  }

  function paintStats() {
    const s = E.stats(nodes, hits);
    el.stChars.textContent = s.chars;
    el.stHits.textContent = s.hits;
    el.stEmoji.textContent = s.kinds;
    return s;
  }

  /* ---------- 核心：跑一遍 ---------- */
  function run(silent) {
    const text = el.src.value;
    const o = opts();
    const r = E.analyze(text, o);
    nodes = r.nodes;
    hits = r.hits;

    el.out.innerHTML = text ? (nodes.length ? E.render(nodes, o) : PH) : PH;

    const s = paintStats();
    renderChips();
    if (!el.diffBox.hidden) renderDiff();
    if (!silent) {
      if (!text) toast('先写点字吧');
      else if (s.hits > 0) toast('命中 ' + s.hits + ' 处 · ' + s.kinds + ' 种 emoji');
      else toast('这篇没认出什么词');
    }
  }

  /* 只重绘（不重新匹配） */
  function refreshOnly() {
    const o = opts();
    el.out.innerHTML = nodes.length ? E.render(nodes, o) : PH;
    hits = rebuildHits();
    paintStats();
    renderChips();
    if (!el.diffBox.hidden) renderDiff();
  }

  /* ---------- 命中词表 ---------- */
  function renderChips() {
    if (!hits.length) {
      el.chips.innerHTML = '';
      el.mapHint.textContent = '还没命中';
      return;
    }
    const order = [];
    const bag = Object.create(null);
    for (let k = 0; k < hits.length; k++) {
      const h = hits[k];
      if (!bag[h.word]) {
        bag[h.word] = { word: h.word, emoji: h.emoji, group: h.group, all: h.all, n: 0 };
        order.push(h.word);
      }
      bag[h.word].n += 1;
    }
    order.sort(function (a, b) {
      return bag[b].n - bag[a].n || bag[b].word.length - bag[a].word.length || a.localeCompare(b);
    });

    el.mapHint.textContent = order.length + ' 个词 · ' + hits.length + ' 次';

    const html = [];
    for (let k = 0; k < order.length; k++) {
      const it = bag[order[k]];
      html.push(
        '<span class="chip" data-word="' + escapeAttr(it.word) + '" title="点一下换个 emoji">' +
          '<i class="ce">' + it.emoji + '</i>' +
          '<span class="cw">' + escapeHtml(it.word) + '</span>' +
          (it.all && it.all.length > 1 ? '<i class="alt">↻' + it.all.length + '</i>' : '') +
          '<i class="cn">' + escapeHtml(it.group || '') + (it.n > 1 ? ' ×' + it.n : '') + '</i>' +
        '</span>'
      );
    }
    el.chips.innerHTML = html.join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      if (c === '&') return '&' + 'amp;';
      if (c === '<') return '&' + 'lt;';
      return '&' + 'gt;';
    });
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&#' + '34;');
  }

  /* ---------- 差异视图 ---------- */
  function renderDiff() {
    const o = opts();
    const d = E.diff(nodes, o);
    el.diffBody.innerHTML =
      '<div class="diff-col"><h3>原文 <i>BEFORE</i></h3><div class="diff-pre">' + (d.before || '<span class="ph">空</span>') + '</div></div>' +
      '<div class="diff-col"><h3>生成 <i>AFTER</i></h3><div class="diff-pre">' + (d.after || '<span class="ph">空</span>') + '</div></div>';
  }

  /* ---------- 输出区交互：点撤 / 长按换 ---------- */
  function bindOut() {
    let press = null;

    el.out.addEventListener('pointerdown', function (ev) {
      const chipEl = ev.target.closest ? ev.target.closest('.emo-chip') : null;
      if (!chipEl) return;
      press = { el: chipEl, t: Date.now(), x: ev.clientX, y: ev.clientY, long: false, timer: null };
      press.timer = setTimeout(function () {
        if (!press || press.long) return;
        press.long = true;
        const word = chipEl.getAttribute('data-w');
        const ids = E.cycleEmoji(nodes, word);
        if (ids.length) {
          hits = rebuildHits();
          refreshOnly();
          const cur = hits.filter(function (h) { return h.word === word; })[0];
          toast('「' + word + '」换成 ' + (cur ? cur.emoji : ''));
        } else {
          toast('「' + word + '」没有别的候选 emoji');
        }
      }, 420);
    });

    el.out.addEventListener('pointerup', function (ev) {
      if (!press) return;
      clearTimeout(press.timer);
      const moved = Math.abs(ev.clientX - press.x) + Math.abs(ev.clientY - press.y);
      if (!press.long && moved < 10) {
        const id = parseInt(press.el.getAttribute('data-id'), 10);
        const w = press.el.getAttribute('data-w');
        if (E.removeEmoji(nodes, id)) {
          hits = rebuildHits();
          refreshOnly();
          toast('已撤掉「' + w + '」的 emoji');
        }
      }
      press = null;
    });

    el.out.addEventListener('pointercancel', function () {
      if (press) { clearTimeout(press.timer); press = null; }
    });
    el.out.addEventListener('pointerleave', function () {
      if (press) { clearTimeout(press.timer); press = null; }
    });
    el.out.addEventListener('contextmenu', function (ev) {
      if (ev.target.closest && ev.target.closest('.emo-chip')) ev.preventDefault();
    });
  }

  /* ---------- 词表点击：换 emoji ---------- */
  function bindChips() {
    el.chips.addEventListener('click', function (ev) {
      const chip = ev.target.closest ? ev.target.closest('.chip') : null;
      if (!chip) return;
      const word = chip.getAttribute('data-word');
      const ids = E.cycleEmoji(nodes, word);
      if (!ids.length) { toast('「' + word + '」只有一个候选'); return; }
      hits = rebuildHits();
      refreshOnly();
      const cur = hits.filter(function (h) { return h.word === word; })[0];
      if (cur) toast('「' + word + '」→ ' + cur.emoji);
    });
  }

  /* ---------- 主题 ---------- */
  const THEMES = ['', 'theme-light', 'theme-pink'];
  const THEME_ICON = ['◐', '◑', '◒'];
  let ti = 0;
  function applyTheme() {
    const cls = document.body.classList;
    for (let k = 0; k < THEMES.length; k++) {
      if (THEMES[k]) cls.remove(THEMES[k]); /* 空字符串不能传给 classList */
    }
    if (THEMES[ti]) cls.add(THEMES[ti]);
    el.btnTheme.textContent = THEME_ICON[ti];
    el.btnTheme.setAttribute('title', '切换主题 · ' + ['赛博', '浅色', '粉紫'][ti]);
  }
  function bindTheme() {
    el.btnTheme.addEventListener('click', function () {
      ti = (ti + 1) % THEMES.length;
      applyTheme();
    });
  }

  /* ---------- 按钮 ---------- */
  function bindBtns() {
    el.btnRun.addEventListener('click', function () { run(false); });

    el.btnDiff.addEventListener('click', function () {
      el.diffBox.hidden = !el.diffBox.hidden;
      if (!el.diffBox.hidden) renderDiff();
    });
    el.diffClose.addEventListener('click', function () { el.diffBox.hidden = true; });

    el.btnCopy.addEventListener('click', function () {
      const txt = E.toText(nodes, opts());
      if (!txt) { toast('没东西可复制'); return; }
      copy(txt);
    });

    el.btnDown.addEventListener('click', function () {
      const txt = E.toText(nodes, opts());
      if (!txt) { toast('没东西可下载'); return; }
      const blob = new Blob(['\ufeff' + txt], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '闹麻输出.txt';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      toast('已下载 闹麻输出.txt');
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-demo]'), function (b) {
      b.addEventListener('click', function () {
        const k = b.getAttribute('data-demo');
        if (k === 'clear') {
          el.src.value = ''; nodes = []; hits = [];
          el.out.innerHTML = PH; renderChips(); paintStats();
          toast('已清空'); el.src.focus();
          return;
        }
        el.src.value = E.DEMO;
        run(true);
        toast('示例已载入 · 词库 ' + E.dictSize + ' 条');
      });
    });
  }

  function copy(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('已复制'); }, function () { fallback(txt); });
    } else fallback(txt);
  }
  function fallback(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，手动选吧'); }
    ta.remove();
  }

  /* ---------- 启动 ---------- */
  function boot() {
    el.src.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { run(true); }, 180);
    });
    el.src.addEventListener('keydown', function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); run(false); }
    });

    if (el.ruleInfo) el.ruleInfo.textContent = '词库 ' + E.dictSize + ' 条';

    bindOut(); bindChips(); bindBtns(); bindTheme();

    /* 滚动字幕 */
    if (el.ticker) {
      const base = 'EMOJI ENGINE ONLINE · 词库 ' + E.dictSize + ' 条 · 实时识别 · 点击回退 · 长按换个表情';
      let t = 0;
      el.ticker.textContent = base + ' · ';
      setInterval(function () {
        t += 1;
        const chars = parseInt(el.stChars.textContent, 10) || 0;
        const hh = parseInt(el.stHits.textContent, 10) || 0;
        const pct = chars ? Math.round((hh / chars) * 100) : 0;
        const msgs = [
          base,
          '命中率 ' + pct + '% · 纯前端 · 不上传任何内容 · Ctrl+Enter 生成 · 点 emoji 撤掉 · 长按换一个'
        ];
        el.ticker.textContent = msgs[t % msgs.length] + ' · ';
      }, 5200);
    }

    el.src.value = E.DEMO;
    run(true);
    setTimeout(function () { toast('闹麻编辑器就绪 · 词库 ' + E.dictSize + ' 条'); }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);