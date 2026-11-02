/* 赛博棋牌室 · 通用工具 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 建元素：el('div.cls#id', {attrs}, ...children) */
export function el(spec, attrs, ...children) {
  const m = /^([a-zA-Z0-9-]+)?((?:[.#][\w-]+)*)$/.exec(spec) || [];
  const tag = m[1] || 'div';
  const node = document.createElement(tag);
  if (m[2]) {
    for (const tok of m[2].match(/[.#][\w-]+/g) || []) {
      if (tok[0] === '.') node.classList.add(tok.slice(1));
      else node.id = tok.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs); attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className += (node.className ? ' ' : '') + v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** 可复现随机数（存档 / AI 缓存一致性都靠它） */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function uid(n = 8) {
  let s = '';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** FNV-1a 32bit → hex，用于缓存键 */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + str.length.toString(36);
}

export const store = {
  get(key, def = null) {
    try {
      const raw = localStorage.getItem('cg:' + key);
      return raw === null ? def : JSON.parse(raw);
    } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('cg:' + key, JSON.stringify(val)); return true; }
    catch { return false; }
  },
  del(key) { try { localStorage.removeItem('cg:' + key); } catch {} },
  /** 扫描前缀 */
  keys(prefix) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('cg:' + prefix)) out.push(k.slice(3));
      }
    } catch {}
    return out;
  },
  sizeOf(prefix) {
    let n = 0;
    for (const k of this.keys(prefix)) {
      try { n += (localStorage.getItem('cg:' + k) || '').length; } catch {}
    }
    return n;
  },
};

export const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';

/** 提取文本里第一个 JSON 对象（容忍 ```json 包裹和前后废话） */
export function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  let r = tryParse(s);
  if (r) return r;
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    r = tryParse(s.slice(i, j + 1));
    if (r) return r;
  }
  // 退化：找最内层最长的 {...}
  const matches = s.match(/\{[\s\S]*?\}/g);
  if (matches) {
    for (const m of matches.sort((a, b) => b.length - a.length)) {
      r = tryParse(m);
      if (r) return r;
    }
  }
  return null;
}

/** 打字机 */
export function typewriter(node, text, speed = 18) {
  node.textContent = '';
  if (!text) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || text.length > 220) { node.textContent = text; return; }
  let i = 0;
  const timer = setInterval(() => {
    node.textContent = text.slice(0, ++i);
    if (i >= text.length) clearInterval(timer);
  }, speed);
  return () => clearInterval(timer);
}