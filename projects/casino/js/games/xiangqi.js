/* 中国象棋 · 完整走子规则（马腿 / 象眼 / 炮翻山 / 九宫 / 双王照面） */
import { el } from '../core/util.js';
import { resignBtn } from './common.js';

const COLS = 'abcdefghi';
const GLYPH = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' };
const GLYPH_B = { k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' };
const VALUE = { k: 10000, r: 900, n: 400, c: 450, a: 200, b: 200, p: 100 };

const isRed = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (p ? (isRed(p) ? 'r' : 'b') : null);
const nameOf = (p) => (p ? (isRed(p) ? GLYPH[p] : GLYPH_B[p]) : '');
const posName = (i) => `${COLS[i % 9]}${10 - Math.floor(i / 9)}`;
const at = (x, y) => (x >= 0 && x < 9 && y >= 0 && y < 10 ? y * 9 + x : -1);

const START = [
  'r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r',
  '', '', '', '', '', '', '', '', '',
  '', 'c', '', '', '', '', '', 'c', '',
  'p', '', 'p', '', 'p', '', 'p', '', 'p',
  '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '',
  'P', '', 'P', '', 'P', '', 'P', '', 'P',
  '', 'C', '', '', '', '', '', 'C', '',
  '', '', '', '', '', '', '', '', '',
  'R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R',
];

const inPalace = (x, y, color) => x >= 3 && x <= 5 && (color === 'r' ? y >= 7 : y <= 2);

function genMoves(s, color) {
  const b = s.board;
  const out = [];
  for (let i = 0; i < 90; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== color) continue;
    const x = i % 9, y = Math.floor(i / 9);
    const t = p.toLowerCase();
    const push = (tx, ty) => {
      const j = at(tx, ty);
      if (j < 0) return;
      if (b[j] && colorOf(b[j]) === color) return;
      out.push({ from: i, to: j });
    };

    if (t === 'k') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inPalace(nx, ny, color)) push(nx, ny);
      }
    } else if (t === 'a') {
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inPalace(nx, ny, color)) push(nx, ny);
      }
    } else if (t === 'b') {
      for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx > 8) continue;
        if (color === 'r' ? ny < 5 : ny > 4) continue;
        const eye = at(x + dx / 2, y + dy / 2);
        if (eye >= 0 && b[eye]) continue;
        push(nx, ny);
      }
    } else if (t === 'n') {
      const legs = [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]];
      for (const [dx, dy, lx, ly] of legs) {
        const leg = at(x + lx, y + ly);
        if (leg < 0 || b[leg]) continue;
        push(x + dx, y + dy);
      }
    } else if (t === 'r') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let cx = x + dx, cy = y + dy;
        while (true) {
          const j = at(cx, cy);
          if (j < 0) break;
          if (!b[j]) out.push({ from: i, to: j });
          else { if (colorOf(b[j]) !== color) out.push({ from: i, to: j }); break; }
          cx += dx; cy += dy;
        }
      }
    } else if (t === 'c') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let cx = x + dx, cy = y + dy, jumped = false;
        while (true) {
          const j = at(cx, cy);
          if (j < 0) break;
          if (!jumped) {
            if (!b[j]) out.push({ from: i, to: j });
            else jumped = true;
          } else if (b[j]) {
            if (colorOf(b[j]) !== color) out.push({ from: i, to: j });
            break;
          }
          cx += dx; cy += dy;
        }
      }
    } else if (t === 'p') {
      const fwd = color === 'r' ? -1 : 1;
      push(x, y + fwd);
      const crossed = color === 'r' ? y <= 4 : y >= 5;
      if (crossed) { push(x - 1, y); push(x + 1, y); }
    }
  }
  return out;
}

/** 双王照面（中间无子）时，视为自己的将处于被攻击状态 */
function kingsFace(s) {
  const rk = s.board.indexOf('K'), bk = s.board.indexOf('k');
  if (rk < 0 || bk < 0) return false;
  if (rk % 9 !== bk % 9) return false;
  const x = rk % 9;
  const y1 = Math.floor(rk / 9), y2 = Math.floor(bk / 9);
  for (let y = Math.min(y1, y2) + 1; y < Math.max(y1, y2); y++) {
    if (s.board[y * 9 + x]) return false;
  }
  return true;
}

function attacked(s, idx, byColor) {
  return genMoves(s, byColor).some((m) => m.to === idx);
}

function inCheck(s, color) {
  const king = s.board.indexOf(color === 'r' ? 'K' : 'k');
  if (king < 0) return true;
  if (kingsFace(s)) return true;
  return attacked(s, king, color === 'r' ? 'b' : 'r');
}

function makeMove(s, mv) {
  const b = s.board.slice();
  const cap = b[mv.to];
  b[mv.to] = b[mv.from];
  b[mv.from] = '';
  return { ...s, board: b, turn: s.turn === 'r' ? 'b' : 'r', last: { from: mv.from, to: mv.to }, half: cap ? 0 : s.half + 1 };
}

function legalMoves(s, color) {
  const out = [];
  for (const mv of genMoves(s, color)) {
    const ns = makeMove(s, mv);
    if (kingsFace(ns)) continue;
    if (inCheck(ns, color)) continue;
    out.push(mv);
  }
  return out;
}

function evaluate(s, forColor) {
  let v = 0;
  for (let i = 0; i < 90; i++) {
    const p = s.board[i];
    if (!p) continue;
    let val = VALUE[p.toLowerCase()] || 0;
    const x = i % 9, y = Math.floor(i / 9);
    if (p.toLowerCase() === 'p') {
      const crossed = isRed(p) ? y <= 4 : y >= 5;
      val = crossed ? 160 : 90;
    }
    // 机动性微调：靠近中路更高
    val += (4 - Math.abs(4 - x)) * 4;
    v += (isRed(p) ? 1 : -1) * val;
  }
  return forColor === 'r' ? v : -v;
}

const xiangqi = {
  id: 'xiangqi',
  name: '中国象棋',
  icon: '🀄',
  desc: '马走日、炮翻山、将不过河，闷宫与照面全按规矩来。',
  tags: ['棋类', '双人'],
  players: { min: 2, max: 2, def: 2 },
  optionSpec: [
    { key: 'first', label: '谁执红', type: 'seg', def: 0, options: [{ v: 0, label: '你执红（先行）' }, { v: 1, label: 'AI 执红' }] },
  ],
  rulesBrief: '红先。帅/将只能在九宫内走一步，不能与对方将帅照面（同列且中间无子）。仕斜走一步不出宫；相走田字、不过河、塞象眼不走；马走日、蹩马腿不走；车走直线；炮走直线但吃子必须隔一个子；兵过河前只能前进，过河后可左右走。被将死或无子可走即负。',

  init(opt) {
    const redSeat = opt.first ? 1 : 0;
    return { board: START.slice(), turn: 'r', redSeat, winner: null, reason: '', last: null, half: 0 };
  },

  turn(s) {
    if (s.winner !== null) return null;
    return s.turn === 'r' ? s.redSeat : 1 - s.redSeat;
  },

  legal(s, seat) {
    if (s.winner !== null) return [];
    const color = (seat === undefined || seat === null) ? s.turn : (seat === s.redSeat ? 'r' : 'b');
    if (color !== s.turn) return [];
    return legalMoves(s, color).map((mv) => {
      const p = s.board[mv.from];
      const cap = s.board[mv.to];
      return {
        k: posName(mv.from) + posName(mv.to),
        ...mv,
        label: `${nameOf(p)}${posName(mv.from)}→${posName(mv.to)}${cap ? ' 吃' + nameOf(cap) : ''}`,
      };
    });
  },

  apply(s, a) {
    if (a.resign) {
      s.winner = 1 - this.turn(s);
      s.reason = '认输';
      return { log: '认输了' };
    }
    const color = s.turn;
    const cap = s.board[a.to];
    const p = s.board[a.from];
    const line = `${color === 'r' ? '红' : '黑'} ${nameOf(p)}${posName(a.from)}→${posName(a.to)}${cap ? ' 吃' + nameOf(cap) : ''}`;
    Object.assign(s, makeMove(s, a));
    const opp = s.turn;
    const oppMoves = legalMoves(s, opp);
    const logs = [line];
    if (!oppMoves.length) {
      s.winner = opp === 'r' ? 1 - s.redSeat : s.redSeat;
      s.reason = inCheck(s, opp) ? '将死' : '困毙';
      logs.push(`${opp === 'r' ? '红' : '黑'}方${s.reason}`);
      return { log: logs };
    }
    if (inCheck(s, opp)) logs.push(`${opp === 'r' ? '红' : '黑'}方被将军`);
    if (s.half >= 120) { s.winner = -1; s.reason = '60 回合无吃子'; logs.push('长时间无吃子，判和'); }
    return { log: logs };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    if (s.winner === -1) return { over: true, result: { title: '和棋', text: s.reason, rows: [{ seat: 0, text: '½' }, { seat: 1, text: '½' }] } };
    return {
      over: true,
      result: {
        title: s.winner === 0 ? '你赢了' : '你输了',
        text: `${s.winner === 0 ? '你' : '对手'}${s.reason === '认输' ? '（对方认输）' : '拿下'}`,
        rows: [{ seat: s.winner, text: '胜' }, { seat: 1 - s.winner, text: '负' }],
      },
    };
  },

  view(s, seat) {
    const myColor = seat === s.redSeat ? 'r' : 'b';
    const rows = [];
    for (let y = 0; y < 10; y++) {
      let line = String(10 - y).padStart(2, '0') + ' ';
      for (let x = 0; x < 9; x++) {
        const p = s.board[y * 9 + x];
        line += (p ? nameOf(p) : '・') + ' ';
      }
      rows.push(line);
    }
    const moves = legalMoves(s, myColor);
    return [
      `你执${myColor === 'r' ? '红' : '黑'}，${s.turn === myColor ? '轮到你走' : '轮到对手走'}。`,
      `你被将军：${inCheck(s, myColor) ? '是' : '否'}。可行走法 ${moves.length} 个。`,
      '棋盘（上黑下红）：',
      rows.join('\n'),
      '   ' + COLS.split('').map((c) => c + ' ').join(''),
    ].join('\n');
  },

  fallback(s, seat, level) {
    const color = seat === s.redSeat ? 'r' : 'b';
    const moves = legalMoves(s, color);
    if (!moves.length) return null;
    if (level <= 0) {
      const mv = moves[Math.floor(Math.random() * moves.length)];
      return { k: posName(mv.from) + posName(mv.to), ...mv };
    }
    let best = [], bestV = -Infinity;
    for (const mv of moves) {
      const ns = makeMove(s, mv);
      let v = evaluate(ns, color);
      if (level >= 2) {
        const replies = legalMoves(ns, ns.turn);
        if (!replies.length) v += inCheck(ns, ns.turn) ? 50000 : 0;
        else {
          let worst = Infinity;
          for (const r of replies.slice(0, 30)) worst = Math.min(worst, evaluate(makeMove(ns, r), color));
          v = worst * 0.8 + v * 0.2;
        }
      }
      v += Math.random() * (level >= 2 ? 5 : 60);
      if (v > bestV) { bestV = v; best = [mv]; } else if (Math.abs(v - bestV) < 1e-9) best.push(mv);
    }
    const mv = best[Math.floor(Math.random() * best.length)];
    return { k: posName(mv.from) + posName(mv.to), ...mv };
  },

  rankActions(s, seat, legal) {
    const color = seat === s.redSeat ? 'r' : 'b';
    return legal.slice().sort((a, b) => evaluate(makeMove(s, b), color) - evaluate(makeMove(s, a), color));
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    const myColor = seat === s.redSeat ? 'r' : 'b';
    if (s.turn !== myColor) return '对手正在想…';
    return inCheck(s, myColor) ? '你被将军，必须应将！' : '点棋子，再点目标点';
  },

  extraButtons(s, seat, ctx) {
    return s.winner === null ? [resignBtn(ctx.act)] : [];
  },

  seatInfo(s, seat) {
    return { sub: seat === s.redSeat ? '红方' : '黑方', badge: this.turn(s) === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const myColor = 0 === s.redSeat ? 'r' : 'b';
    const availH = Math.max(280, window.innerHeight - 330);
    const availW = (ctx.host.clientWidth || 400) - 8;
    const cellW = availW / 9;
    const cellH = availH / 10;
    const cell = Math.min(cellW, cellH * 0.96);
    const pw = cell * 9, ph = cell * 10;
    const pad = 0;
    const sq = (n) => n * cell;

    const wrap = el('div.board-wrap', { style: { width: '100%' } });
    const board = el('div.board', { style: { width: (pw + cell) + 'px', height: (ph + cell) + 'px', position: 'relative', background: 'linear-gradient(160deg,#f0e0c0,#dcc59b)' } });

    const cv = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    const W = pw + cell, H = ph + cell;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.cssText = `width:${W}px;height:${H}px;display:block`;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.strokeStyle = 'rgba(88,62,38,.72)';
    g.lineWidth = Math.max(1, cell / 26);
    const ox = cell / 2, oy = cell / 2;
    // 横线
    for (let y = 0; y < 10; y++) {
      g.beginPath(); g.moveTo(ox, oy + sq(y)); g.lineTo(ox + sq(8), oy + sq(y)); g.stroke();
    }
    // 竖线（河界断开）
    for (let x = 0; x < 9; x++) {
      if (x === 0 || x === 8) {
        g.beginPath(); g.moveTo(ox + sq(x), oy); g.lineTo(ox + sq(x), oy + sq(9)); g.stroke();
      } else {
        g.beginPath(); g.moveTo(ox + sq(x), oy); g.lineTo(ox + sq(x), oy + sq(4)); g.stroke();
        g.beginPath(); g.moveTo(ox + sq(x), oy + sq(5)); g.lineTo(ox + sq(x), oy + sq(9)); g.stroke();
      }
    }
    // 九宫斜线
    for (const y0 of [0, 7]) {
      g.beginPath(); g.moveTo(ox + sq(3), oy + sq(y0)); g.lineTo(ox + sq(5), oy + sq(y0 + 2)); g.stroke();
      g.beginPath(); g.moveTo(ox + sq(5), oy + sq(y0)); g.lineTo(ox + sq(3), oy + sq(y0 + 2)); g.stroke();
    }
    // 楚河汉界
    g.fillStyle = 'rgba(88,62,38,.5)';
    g.font = `${Math.round(cell * 0.52)}px system-ui, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('楚 河', ox + sq(2), oy + sq(4.5));
    g.fillText('汉 界', ox + sq(6), oy + sq(4.5));
    // 外框
    g.lineWidth = Math.max(1.4, cell / 16);
    g.strokeRect(ox - cell * 0.14, oy - cell * 0.14, sq(8) + cell * 0.28, sq(9) + cell * 0.28);
    board.append(cv);

    const ui = ctx.host.__ui = ctx.host.__ui || {};
    const sel = ui.sel ?? null;
    const legalNow = (s.turn === myColor && s.winner === null) ? legalMoves(s, myColor) : [];
    const targets = sel !== null ? legalNow.filter((m) => m.from === sel) : [];

    const layer = el('div', { style: { position: 'absolute', inset: '0' } });
    for (let i = 0; i < 90; i++) {
      const p = s.board[i];
      const x = i % 9, y = Math.floor(i / 9);
      const cx = ox + sq(x), cy = oy + sq(y);
      if (p) {
        const node = el('div', {
          style: {
            position: 'absolute', width: cell * 0.88 + 'px', height: cell * 0.88 + 'px',
            left: (cx - cell * 0.44) + 'px', top: (cy - cell * 0.44) + 'px',
            borderRadius: '50%', display: 'grid', placeItems: 'center',
            fontFamily: 'system-ui,serif', fontWeight: '700',
            fontSize: Math.round(cell * 0.45) + 'px',
            color: isRed(p) ? '#a8243a' : '#1b2b3a',
            background: 'radial-gradient(circle at 34% 28%, #fff8ec, #e6d2ae 74%)',
            boxShadow: '0 2px 5px rgba(0,0,0,.28), inset 0 0 0 1.5px rgba(120,90,60,.55)',
            animation: 'popIn .18s cubic-bezier(.16,1,.3,1) both',
            cursor: (s.turn === myColor && colorOf(p) === myColor) ? 'pointer' : 'default',
            zIndex: 2,
          },
          text: nameOf(p),
        });
        if (sel === i) node.style.boxShadow = '0 0 0 3px rgba(76,201,240,.9), 0 4px 10px rgba(0,0,0,.3)';
        if (s.last && s.last.to === i) node.style.outline = '2px solid rgba(232,195,122,.95)';
        node.addEventListener('click', (e) => { e.stopPropagation(); onCell(i); });
        layer.append(node);
      }
      // 可走标记
      if (targets.some((m) => m.to === i)) {
        layer.append(el('div', {
          style: {
            position: 'absolute', width: cell * 0.34 + 'px', height: cell * 0.34 + 'px',
            left: (cx - cell * 0.17) + 'px', top: (cy - cell * 0.17) + 'px',
            borderRadius: '50%', background: p ? 'rgba(255,122,138,.35)' : 'rgba(40,200,240,.55)',
            border: p ? '2px solid rgba(255,122,138,.9)' : '2px solid rgba(40,200,240,.75)',
            zIndex: 1, pointerEvents: 'none',
          },
        }));
      }
    }

    const onCell = (i) => {
      if (s.turn !== myColor || s.winner !== null) return;
      const nowSel = ctx.host.__ui.sel ?? null;
      if (nowSel !== null) {
        const hit = legalNow.find((m) => m.from === nowSel && m.to === i);
        if (hit) {
          ctx.host.__ui.sel = null;
          ctx.act({ k: posName(hit.from) + posName(hit.to), ...hit });
          return;
        }
      }
      const p = s.board[i];
      ctx.host.__ui.sel = (p && colorOf(p) === myColor) ? i : null;
      ctx.rerender();
    };

    board.append(layer);
    board.addEventListener('click', (e) => {
      // 点在空白处：取消选择
      if (e.target === board || e.target.tagName === 'CANVAS') {
        ctx.host.__ui.sel = null;
        ctx.rerender();
      }
    });
    wrap.append(board);
    ctx.host.append(wrap);
  },
};

export default xiangqi;