/* ============================================================
 * translate.js —— 调用 OpenAI 兼容接口批量翻译（只干翻译这一件事）
 * ============================================================ */
(function (global) {
  'use strict';

  var SYS_TMPL =
    '你是学术文献翻译引擎。用户会给你一个 JSON 数组，每个元素形如 {"i":序号,"t":"原文"}。\n' +
    '要求：\n' +
    '1) 把每条 t 翻译成简体中文，语义准确、术语符合该领域惯例、语气为学术书面语；句子要通顺，不要逐词硬译。\n' +
    '2) 严格保留：数学符号与公式、变量名、数字、单位、化学式、基因/蛋白名、代码标识符、URL、引用编号（如 [12]）。\n' +
    '3) 不要合并或拆分条目，不要增删条目，输出必须是与输入等长的 JSON 数组：\n' +
    '   [{"i":0,"t":"译文"},{"i":1,"t":"译文"}]\n' +
    '4) 只输出 JSON 本身，不要 markdown 代码块，不要任何解释文字。\n' +
    '5) 若某条本身无实义（例如纯符号），原样返回该条内容。';

  function buildSystem(domain) {
    return domain && domain.trim()
      ? SYS_TMPL + '\n6) 领域提示：' + domain.trim() + '，请使用该领域的规范译名。'
      : SYS_TMPL;
  }

  function endpoint(base) {
    var b = String(base || '').trim().replace(/\/+$/, '');
    if (!b) throw new Error('Base URL 为空');
    if (/\/chat\/completions$/.test(b)) return b;
    return b + '/chat/completions';
  }

  /* 从模型回复里抠出 JSON 数组（容忍 ```json 包裹 / 前后废话 / {i,t} 对象包裹） */
  function parseArr(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    var s = t.indexOf('['), e = t.lastIndexOf(']');
    if (s >= 0 && e > s) {
      var seg = t.slice(s, e + 1);
      try { return JSON.parse(seg); } catch (err) { /* 继续尝试 */ }
    }
    // 退路：整体当作对象解析，找里面的数组
    try {
      var o = JSON.parse(t);
      if (Array.isArray(o)) return o;
      for (var k in o) if (Array.isArray(o[k])) return o[k];
      // {"0":"译","1":"译"} 形式
      var keys = Object.keys(o).filter(function (x) { return /^\d+$/.test(x); });
      if (keys.length) return keys.map(function (x) { return { i: Number(x), t: o[x] }; });
    } catch (err2) { /* ignore */ }
    return null;
  }

  function normalizeArr(arr) {
    var map = new Map();
    if (!Array.isArray(arr)) return map;
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (o == null) continue;
      if (typeof o === 'string') { map.set(i, o); continue; }
      var idx = (o.i !== undefined) ? Number(o.i) : (o.index !== undefined ? Number(o.index) : i);
      var txt = (o.t !== undefined) ? o.t : (o.translation !== undefined ? o.translation : (o.text !== undefined ? o.text : ''));
      if (!isNaN(idx)) map.set(idx, String(txt == null ? '' : txt));
    }
    return map;
  }

  /* 单个请求：返回 Map<局部序号, 译文> */
  async function requestOnce(batch, cfg, signal) {
    var payload = batch.map(function (s, i) { return { i: i, t: s.text }; });
    var body = {
      model: cfg.model,
      temperature: Number(cfg.temp),
      stream: false,
      messages: [
        { role: 'system', content: buildSystem(cfg.domain) },
        { role: 'user', content: JSON.stringify(payload) }
      ]
    };
    var res = await fetch(endpoint(cfg.base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify(body),
      signal: signal
    });
    if (!res.ok) {
      var txt = '';
      try { txt = await res.text(); } catch (e) { }
      throw new Error('HTTP ' + res.status + ' ' + txt.slice(0, 220));
    }
    var j = await res.json();
    var content = '';
    if (j && j.choices && j.choices[0]) {
      var m = j.choices[0].message || j.choices[0].delta || {};
      content = m.content || '';
      if (Array.isArray(content)) content = content.map(function (p) { return p.text || ''; }).join('');
    } else if (j && j.output_text) {
      content = j.output_text;
    }
    if (!content) throw new Error('响应里没有内容: ' + JSON.stringify(j).slice(0, 200));
    var arr = parseArr(content);
    if (!arr) throw new Error('解析不出 JSON 数组: ' + content.slice(0, 160));
    return normalizeArr(arr);
  }

  /* 拆批 */
  function makeBatches(list, maxChars, maxItems) {
    var out = [], cur = [], n = 0;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var len = (s.text || '').length;
      if (cur.length && (n + len > maxChars || cur.length >= maxItems)) {
        out.push(cur); cur = []; n = 0;
      }
      cur.push(s); n += len;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /* 带重试的一批 */
  async function runBatch(batch, cfg, signal, onWarn, tempBoost) {
    var lastErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var c = Object.assign({}, cfg);
        if (attempt > 0) c.temp = 0; // 重试降温，提高格式稳定性
        var map = await requestOnce(batch, c, signal);
        if (map.size === 0) throw new Error('译文条目为空');
        return map;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        lastErr = e;
        onWarn('重试 ' + (attempt + 1) + '/3：' + e.message);
        await sleep(600 * (attempt + 1));
      }
    }
    // 整批仍失败 → 逐条再试
    var map2 = new Map();
    for (var i = 0; i < batch.length; i++) {
      if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
      try {
        var m = await requestOnce([batch[i]], Object.assign({}, cfg, { temp: 0 }), signal);
        if (m.size) map2.set(0, m.get(0));
      } catch (e2) {
        onWarn('单条失败（保留原文）：' + String(e2.message).slice(0, 90));
        map2.set(0, batch[i].text);
      }
      await sleep(120);
    }
    return map2;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * 批量翻译
   * @param {Array} list  待翻译 seg 数组（需有 .text）
   * @param {Object} cfg  {base,key,model,temp,domain,concurrency,batchChars}
   * @param {Object} hooks {onProgress(done,total,ok,fail), onLog(msg,level), signal}
   */
  async function translateSegments(list, cfg, hooks) {
    hooks = hooks || {};
    var signal = hooks.signal;
    var onProgress = hooks.onProgress || function () { };
    var onLog = hooks.onLog || function () { };
    var onWarn = function (msg) { onLog(msg, 'warn'); };

    var maxItems = Math.max(4, Math.min(30, Math.ceil((cfg.batchChars || 1500) / 80)));
    var batches = makeBatches(list, cfg.batchChars || 1500, maxItems);
    var total = list.length;
    var done = 0, ok = 0, fail = 0;
    var idx = 0;
    var conc = Math.max(1, Math.min(8, Number(cfg.concurrency) || 1));

    async function worker() {
      while (true) {
        if (signal && signal.aborted) return;
        var my = idx++;
        if (my >= batches.length) return;
        var batch = batches[my];
        try {
          var map = await runBatch(batch, cfg, signal, onWarn);
          for (var i = 0; i < batch.length; i++) {
            var txt = map.get(i);
            if (txt === undefined || txt === null) { fail++; continue; }
            if (!String(txt).trim()) { fail++; continue; }
            batch[i].trans = String(txt).trim();
            ok++;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          fail += batch.length;
          onWarn('批次失败：' + e.message);
        }
        done += batch.length;
        onProgress(done, total, ok, fail);
      }
    }

    var pool = [];
    for (var i = 0; i < conc; i++) pool.push(worker());
    await Promise.all(pool);
    return { total: total, ok: ok, fail: fail };
  }

  /* 连通性测试：发一条最小请求 */
  async function testConnection(cfg) {
    var res = await fetch(endpoint(cfg.base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        stream: false,
        messages: [
          { role: 'system', content: '只输出 JSON，不要解释。' },
          { role: 'user', content: '[{"i":0,"t":"Hello world"}]' }
        ]
      })
    });
    if (!res.ok) {
      var t = '';
      try { t = await res.text(); } catch (e) { }
      throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 200));
    }
    var j = await res.json();
    var c = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return String(c).slice(0, 120);
  }

  global.Translator = {
    translateSegments: translateSegments,
    testConnection: testConnection,
    parseArr: parseArr
  };
})(window);