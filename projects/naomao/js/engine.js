/* ============================================================
   闹麻编辑器 · 匹配引擎 NAOMAO ENGINE
   输入文本 -> 切成节点流（纯文本 / 命中词+emoji） -> 渲染成带 chip 的 HTML
   全程纯前端，不联网。
   ============================================================ */
(function (global) {
  'use strict';

  const D = global.NAOMAO_DICT || { entries: [], byHead: new Map() };

  /* ---------- emoji 判定 ---------- */
  const EMOJI_RE = (function () {
    try { return new RegExp('\\p{Extended_Pictographic}', 'u'); } catch (e) { return null; }
  })();

  /* 按码点安全取一个完整字符（emoji 是代理对，text[i] 只能拿到半截） */
  function cpAt(s, i) {
    if (!s || i == null || i >= s.length || i < 0) return '';
    return String.fromCodePoint(s.codePointAt(i));
  }
  /* 取字符串最后一个完整字符 */
  function lastCh(s) {
    if (!s) return '';
    const arr = Array.from(s);
    return arr.length ? arr[arr.length - 1] : '';
  }

  function isEmoji(s) {
    if (!s) return false;
    const ch = cpAt(s, 0);
    if (!ch) return false;
    if (EMOJI_RE) return EMOJI_RE.test(ch);
    const c = ch.codePointAt(0);
    return c >= 0x1F300 && c <= 0x1FAFF;
  }

  /* 标点前不插 emoji 用的标点集（不含空白，空白单独判） */
  const PUNCT = '，。！？、；：,.!?;:）)】》」』”’…—～"\'·';
  function isPunct(ch) { return !!ch && PUNCT.indexOf(ch) >= 0; }
  function isSpace(ch) { return !!ch && /\s/.test(ch); }

  /* 上一字符后面要不要补空格 */
  function needSpace(prev, opts) {
    return !!(opts && opts.space && prev && !isSpace(prev) && !isPunct(prev));
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      if (c === '&') return '&' + 'amp;';
      if (c === '<') return '&' + 'lt;';
      if (c === '>') return '&' + 'gt;';
      if (c === '"') return '&#' + '34;';
      return '&#' + '39;';
    });
  }

  /**
   * 分析文本
   * @param {string} text
   * @param {object} opts { space, punct, once, safe }
   * @returns {{nodes:Array, hits:Array}}
   */
  function analyze(text, opts) {
    opts = opts || {};
    text = String(text == null ? '' : text);

    const nodes = [];
    const hits = [];
    const seen = Object.create(null);
    let id = 0;
    let i = 0;

    function pushText(s) {
      if (!s) return;
      const last = nodes[nodes.length - 1];
      if (last && last.t === 'txt') last.v += s;
      else nodes.push({ t: 'txt', v: s });
    }

    /* 上一个节点是不是同一个词（连续同词不重复标，避免「看👀看👀」） */
    function prevSameWord(w) {
      for (let k = nodes.length - 1; k >= 0; k--) {
        const n = nodes[k];
        if (n.t === 'txt') { if (!n.v) continue; return false; }
        return n.w === w;
      }
      return false;
    }

    while (i < text.length) {
      const head = text[i];
      const cands = D.byHead && D.byHead.get(head);
      let m = null;

      if (cands) {
        for (let k = 0; k < cands.length; k++) {
          const e = cands[k];
          if (opts.minLen > 1 && e.len < opts.minLen) continue;
          if (text.startsWith(e.word, i)) { m = e; break; } /* entries 已按长度降序 => 长词优先 */
        }
      }
      if (!m) { pushText(head); i += 1; continue; }

      const w = m.word;
      const after = i + w.length;
      const afterCh = after < text.length ? cpAt(text, after) : '';
      const emoji = m.emojis[0];
      let skip = false;

      if (opts.once && seen[w]) skip = true;              /* 整篇同词只插一次 */
      if (!skip && opts.punct && isPunct(afterCh)) skip = true; /* 标点前不插 */
      if (!skip && opts.safe && isEmoji(afterCh)) skip = true;  /* 安全模式：后面紧跟 emoji 就不叠加 */
      if (!skip && prevSameWord(w)) skip = true;          /* 连续同词只标一个 */

      if (skip) {
        pushText(w);
      } else {
        seen[w] = true;
        id += 1;
        nodes.push({ t: 'hit', w: w, e: emoji, g: m.group, id: id, all: m.emojis.slice() });
        hits.push({ word: w, emoji: emoji, group: m.group, all: m.emojis.slice(), id: id });
      }
      i = after;
    }

    return { nodes: nodes, hits: hits };
  }

  /** 渲染节点流成 HTML（chip 带 data-id，供点击撤回） */
  function render(nodes, opts) {
    opts = opts || {};
    let out = '';
    let prev = '';

    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'txt') {
        out += esc(n.v).replace(/\n/g, '<br>');
        prev = lastCh(n.v) || prev;
        continue;
      }
      out += '<span class="hit-chip" data-w="' + esc(n.w) + '" data-id="' + n.id + '">' + esc(n.w);
      const tail = lastCh(n.w) || prev;   /* emoji 紧跟当前词，空格按当前词末尾判 */
      if (n.e) {
        const sp = needSpace(tail, opts) ? ' ' : '';
        out += '<span class="emo-chip" data-id="' + n.id + '" data-w="' + esc(n.w) + '" title="点一下撤掉 · 长按换一个">' + sp + esc(n.e) + '</span>';
        prev = n.e;
      } else {
        prev = tail;
      }
      out += '</span>';
    }
    return out;
  }

  /** 节点流 -> 纯文本（复制/下载用） */
  function toText(nodes, opts) {
    opts = opts || {};
    let out = '';
    let prev = '';
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'txt') { out += n.v; prev = lastCh(n.v) || prev; continue; }
      out += n.w;
      prev = lastCh(n.w) || prev;
      if (n.e) {
        out += (needSpace(prev, opts) ? ' ' : '') + n.e;
        prev = n.e;
      }
    }
    return out;
  }

  /** 撤掉某个 id 的 emoji（可直接传 id 或节点对象） */
  function removeEmoji(nodes, id) {
    if (id && typeof id === 'object') id = id.id;
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'hit' && n.id === id) {
        if (!n.e) return false;
        n.e = null;
        return true;
      }
    }
    return false;
  }

  /** 给某个词的命中换一个候选 emoji（多候选时轮换），返回受影响 id 列表 */
  function cycleEmoji(nodes, word) {
    const ids = [];
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'hit' && n.w === word && n.e) {
        const all = n.all || [];
        if (all.length < 2) continue;
        const idx = (all.indexOf(n.e) + 1) % all.length;
        n.e = all[idx];
        ids.push(n.id);
      }
    }
    return ids;
  }

  /** 统计 */
  function stats(nodes, hits) {
    let chars = 0, hitCount = 0, emoCount = 0;
    const kinds = Object.create(null);
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'txt') { chars += Array.from(n.v).length; continue; }
      chars += Array.from(n.w).length;
      if (n.e) { hitCount += 1; emoCount += 1; kinds[n.e] = 1; }
    }
    return {
      chars: chars,
      hits: hitCount,
      kinds: Object.keys(kinds).length,
      marked: nodes.length ? hits.length : 0,
      emojis: emoCount
    };
  }

  /** 差异视图：原文（无标注） / 生成（新增项高亮） */
  function diff(nodes, opts) {
    opts = opts || {};
    let before = '', after = '';
    let prev = '';
    for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k];
      if (n.t === 'txt') {
        const html = esc(n.v).replace(/\n/g, '<br>');
        before += html;
        after += html;
        prev = lastCh(n.v) || prev;
        continue;
      }
      before += '<span class="d-hit">' + esc(n.w) + '</span>';
      after += '<span class="d-hit">' + esc(n.w) + '</span>';
      prev = lastCh(n.w) || prev;
      if (n.e) {
        after += '<ins class="d-add">' + (needSpace(prev, opts) ? ' ' : '') + esc(n.e) + '</ins>';
        prev = n.e;
      }
    }
    return { before: before, after: after };
  }

  const DEMO = '今天晚上我想吃火锅，然后去看看月亮，再来点啤酒。\n'
    + '老板天天加班，我麻了，真的闹麻。写完代码就崩溃，笑着笑着就哭了。\n'
    + '我爱你，也恨这个世界。祝你生日快乐，考试满分，加油！';

  global.NAOMAO_ENGINE = {
    analyze: analyze,
    render: render,
    toText: toText,
    diff: diff,
    stats: stats,
    removeEmoji: removeEmoji,
    cycleEmoji: cycleEmoji,
    isEmoji: isEmoji,
    DEMO: DEMO,
    dictSize: (D.size || (D.entries ? D.entries.length : 0))
  };
})(window);
