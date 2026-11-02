/* 国际象棋 · 完整规则（易位 / 吃过路兵 / 升变 / 将死 / 僵局） */
import { el } from '../core/util.js';
import { resignBtn } from './common.js';

const FILES = 'abcdefgh';
const GLYPH = { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕', K: '♔', p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const NAME = { p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' };

const isWhite = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (p ? (isWhite(p) ? 'w' : 'b') : null);
const sqName = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
const at = (x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8 ? y * 8 + x : -1);

const START = [
  'r', 'n', 'b', 'q', 'k', 'b', 'n', 'r',
  'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p',
  ...new Array(32).fill(''),
  'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P',
  'R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R',
];

const DIRS = {
  n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  k: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};
DIRS.q = [...DIRS.b, ...DIRS.r];

/* ---------- 走法生成 ---------- */
function genMoves(s, color, forAttackOnly = false) {
  const b = s.board;
  const out = [];
  const push = (from, to, extra = {}) => out.push({ from, to, ...extra });

  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== color) continue;
    const x = i % 8, y = Math.floor(i / 8);
    const t = p.toLowerCase();

    if (t === 'p') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const promoRow = color === 'w' ? 0 : 7;
      const f1 = at(x, y + dir);
      if (f1 >= 0 && !b[f1]) {
        if (y + dir === promoRow) for (const pr of 'qrbn') push(i, f1, { promo: pr });
        else push(i, f1);
        const f2 = at(x, y + dir * 2);
        if (y === startRow && f2 >= 0 && !b[f2]) push(i, f2, { dbl: true });
      }
      for (const dx of [-1, 1]) {
        const c = at(x + dx, y + dir);
        if (c < 0) continue;
        if (b[c] && colorOf(b[c]) !== color) {
          if (y + dir === promoRow) for (const pr of 'qrbn') push(i, c, { promo: pr, cap: true });
          else push(i, c, { cap: true });
        } else if (!b[c] && s.ep === c) {
          push(i, c, { ep: true, cap: true });
        }
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dx, dy] of DIRS[t]) {
        const c = at(x + dx, y + dy);
        if (c < 0) continue;
        if (!b[c] || colorOf(b[c]) !== color) push(i, c, { cap: !!b[c] });
      }
      if (t === 'k' && !forAttackOnly) {
        // 易位
        const rights = s.castling;
        const homeRow = color === 'w' ? 7 : 0;
        if (y === homeRow && x === 4) {
          const canK = color === 'w' ? rights.wK : rights.bK;
          const canQ = color === 'w' ? rights.wQ : rights.bQ;
          const rookK = homeRow * 8 + 7, rookQ = homeRow * 8;
          if (canK && b[rookK] && b[rookK].toLowerCase() === 'r' && !b[at(5, y)] && !b[at(6, y)]
            && !isAttacked(s, at(4, y), color === 'w' ? 'b' : 'w') && !isAttacked(s, at(5, y), color === 'w' ? 'b' : 'w')
            && !isAttacked(s, at(6, y), color === 'w' ? 'b' : 'w')) {
            push(i, at(6, y), { castle: 'K' });
          }
          if (canQ && b[rookQ] && b[rookQ].toLowerCase() === 'r' && !b[at(3, y)] && !b[at(2, y)] && !b[at(1, y)]
            && !isAttacked(s, at(4, y), color === 'w' ? 'b' : 'w') && !isAttacked(s, at(3, y), color === 'w' ? 'b' : 'w')
            && !isAttacked(s, at(2, y), color === 'w' ? 'b' : 'w')) {
            push(i, at(2, y), { castle: 'Q' });
          }
        }
      }
    } else {
      for (const [dx, dy] of DIRS[t]) {
        let cx = x + dx, cy = y + dy;
        while (true) {
          const c = at(cx, cy);
          if (c < 0) break;
          if (!b[c]) push(i, c);
          else {
            if (colorOf(b[c]) !== color) push(i, c, { cap: true });
            break;
          }
          cx += dx; cy += dy;
        }
      }
    }
  }
  return out;
}

function isAttacked(s, idx, byColor) {
  if (idx < 0) return false;
  const moves = genMoves(s, byColor, true);
  return moves.some((m) => m.to === idx);
}

function findKing(b, color) {
  const k = color === 'w' ? 'K' : 'k';
  return b.indexOf(k);
}

/** 执行走法，返回新的 state（不改原对象） */
function makeMove(s, mv) {
  const b = s.board.slice();
  const p = b[mv.from];
  const color = colorOf(p);
  const cap = b[mv.to];
  b[mv.to] = mv.promo ? (color === 'w' ? mv.promo.toUpperCase() : mv.promo) : p;
  b[mv.from] = '';
  // 吃过路兵
  if (mv.ep) {
    const capIdx = color === 'w' ? mv.to + 8 : mv.to - 8;
    b[capIdx] = '';
  }
  // 易位挪车
  if (mv.castle) {
    const row = color === 'w' ? 7 : 0;
    if (mv.castle === 'K') { b[row * 8 + 5] = b[row * 8 + 7]; b[row * 8 + 7] = ''; }
    else { b[row * 8 + 3] = b[row * 8]; b[row * 8] = ''; }
  }
  const castling = { ...s.castling };
  if (p === 'K') { castling.wK = false; castling.wQ = false; }
  if (p === 'k') { castling.bK = false; castling.bQ = false; }
  if (mv.from === 63 || mv.to === 63) castling.wK = false;
  if (mv.from === 56 || mv.to === 56) castling.wQ = false;
  if (mv.from === 7 || mv.to === 7) castling.bK = false;
  if (mv.from === 0 || mv.to === 0) castling.bQ = false;

  const ep = mv.dbl ? (mv.from + mv.to) / 2 : null;
  return {
    ...s,
    board: b,
    turn: color === 'w' ? 'b' : 'w',
    castling,
    ep,
    half: (cap || p.toLowerCase() === 'p') ? 0 : s.half + 1,
    moveNo: color === 'b' ? s.moveNo + 1 : s.moveNo,
    last: { from: mv.from, to: mv.to },
  };
}

/** 某方所有完全合法走法（走完自己的王不被吃） */
function legalMoves(s, color) {
  const out = [];
  for (const mv of genMoves(s, color)) {
    const ns = makeMove(s, mv);
    const king = findKing(ns.board, color);
    if (king >= 0 && isAttacked(ns, king, color === 'w' ? 'b' : 'w')) continue;
    out.push(mv);
  }
  return out;
}

function inCheck(s, color) {
  const k = findKing(s.board, color);
  return k >= 0 && isAttacked(s, k, color === 'w' ? 'b' : 'w');
}

/* ---------- 本地评估 ---------- */
function evaluate(s, forColor) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!p) continue;
    const v = VALUE[p.toLowerCase()] || 0;
    // 兵往前推进更有价值
    let bonus = 0;
    const row = Math.floor(i / 8);
    if (p.toLowerCase() === 'p') bonus = (p === 'P' ? (6 - row) : (row - 1)) * 6;
    // 中心偏好
    const cx = i % 8, cy = row;
    bonus += 6 - (Math.abs(3.5 - cx) + Math.abs(3.5 - cy)) * 1.6;
    score += (isWhite(p) ? 1 : -1) * (v + bonus);
  }
  return forColor === 'w' ? score : -score;
}

const chess = {
  id: 'chess',
  name: '国际象棋',
  icon: '♞',
  desc: '易位、吃过路兵、升变全都有，王被将死即负。',
  tags: ['棋类', '双人'],
  players: { min: 2, max: 2, def: 2 },
  optionSpec: [
    { key: 'first', label: '谁执白', type: 'seg', def: 0, options: [{ v: 0, label: '你执白' }, { v: 1, label: 'AI 执白' }] },
  ],
  rulesBrief: '标准国际象棋：白先。兵首次可走两格，斜吃；王车易位；吃过路兵；兵到底线升变（后/车/象/马）。王被将死或困毙（无子可动且被将/无合法步）则败，无合法步且未被将算和。',

  init(opt) {
    const whiteSeat = opt.first ? 1 : 0;
    return {
      board: START.slice(),
      turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      ep: null, half: 0, moveNo: 1, last: null,
      whiteSeat, winner: null, reason: '', history: [],
    };
  },

  turn(s) {
    if (s.winner !== null) return null;
    return s.turn === 'w' ? s.whiteSeat : 1 - s.whiteSeat;
  },

  legal(s, seat) {
    if (s.winner !== null) return [];
    const color = (seat === undefined || seat === null) ? s.turn : (seat === s.whiteSeat ? 'w' : 'b');
    if (color !== s.turn) return [];
    return legalMoves(s, color).map((mv) => ({
      k: sqName(mv.from) + sqName(mv.to) + (mv.promo ? '=' + mv.promo : ''),
      ...mv,
      label: `${NAME[s.board[mv.from].toLowerCase()]} ${sqName(mv.from)}→${sqName(mv.to)}`
        + (mv.promo ? `升${NAME[mv.promo]}` : '')
        + (mv.castle ? '（易位）' : '')
        + (mv.ep ? '（吃过路兵）' : '')
        + (s.board[mv.to] && !mv.ep ? ` 吃${NAME[s.board[mv.to].toLowerCase()]}` : ''),
    }));
  },

  apply(s, a) {
    if (a.resign) {
      s.winner = 1 - this.turn(s);
      s.reason = '认输';
      return { log: '认输了' };
    }
    const color = s.turn;
    const next = makeMove(s, a);
    Object.assign(s, next);
    const line = `${color === 'w' ? '白' : '黑'} ${sqName(a.from)}→${sqName(a.to)}${a.promo ? '=' + a.promo.toUpperCase() : ''}`;
    // 判定
    const oppColor = s.turn;
    const oppMoves = legalMoves(s, oppColor);
    const logs = [line];
    if (oppMoves.length === 0) {
      if (inCheck(s, oppColor)) {
        s.winner = oppColor === 'w' ? 1 - s.whiteSeat : s.whiteSeat;
        s.reason = '将死';
        logs.push(`${oppColor === 'w' ? '白' : '黑'}方被将死`);
      } else {
        s.winner = -1;
        s.reason = '僵局';
        logs.push('对方无子可动，和棋');
      }
      return { log: logs };
    }
    if (inCheck(s, oppColor)) logs.push(`${oppColor === 'w' ? '白' : '黑'}方被将军`);
    if (s.half >= 100) { s.winner = -1; s.reason = '50 回合'; logs.push('50 回合无吃子无兵动，和棋'); }
    return { log: logs };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    const wName = (seat) => (seat === 0 ? '你' : '对手');
    if (s.winner === -1) return { over: true, result: { title: '和棋', text: s.reason || '双方和棋', rows: [{ seat: 0, text: '½' }, { seat: 1, text: '½' }] } };
    return {
      over: true,
      result: {
        title: s.winner === 0 ? '你赢了' : '你输了',
        text: `${wName(1 - s.winner)}被${s.reason || '击败'}。`,
        rows: [{ seat: s.winner, text: '胜' }, { seat: 1 - s.winner, text: '负' }],
      },
    };
  },

  view(s, seat) {
    const myColor = seat === s.whiteSeat ? 'w' : 'b';
    const rows = [];
    for (let y = 0; y < 8; y++) {
      let line = (8 - y) + ' ';
      for (let x = 0; x < 8; x++) {
        const p = s.board[y * 8 + x];
        line += (p || '.') + ' ';
      }
      rows.push(line);
    }
    const mine = [], theirs = [];
    for (const mv of legalMoves(s, myColor)) {
      mine.push(`${NAME[s.board[mv.from].toLowerCase()]}${sqName(mv.from)}-${sqName(mv.to)}${mv.promo ? '=' + mv.promo : ''}`);
    }
    return [
      `你执${myColor === 'w' ? '白' : '黑'}，${s.turn === myColor ? '轮到你走' : '轮到对手走'}。第 ${s.moveNo} 回合。`,
      `你被将军：${inCheck(s, myColor) ? '是' : '否'}。`,
      '局面（大写=白 小写=黑，. 为空）：',
      rows.join('\n'),
      '   a b c d e f g h',
      `你的可行走法共 ${mine.length} 个。`,
    ].join('\n');
  },

  fallback(s, seat, level) {
    const color = seat === s.whiteSeat ? 'w' : 'b';
    const moves = legalMoves(s, color);
    if (!moves.length) return null;
    if (level <= 0) {
      const mv = moves[Math.floor(Math.random() * moves.length)];
      return { k: sqName(mv.from) + sqName(mv.to) + (mv.promo ? '=' + mv.promo : ''), ...mv };
    }
    const depth = level >= 3 ? 2 : 1;
    let best = [], bestV = -Infinity;
    for (const mv of moves) {
      let v;
      const ns = makeMove(s, mv);
      if (depth >= 2) {
        const replies = legalMoves(ns, ns.turn);
        if (!replies.length) v = inCheck(ns, ns.turn) ? 90000 : 0;
        else {
          let worst = Infinity;
          for (const r of replies.slice(0, 40)) {
            const ns2 = makeMove(ns, r);
            worst = Math.min(worst, evaluate(ns2, color));
          }
          v = worst;
        }
      } else {
        v = evaluate(ns, color) + (s.board[mv.to] ? 12 : 0);
      }
      v += Math.random() * (level >= 2 ? 3 : 40);
      if (v > bestV) { bestV = v; best = [mv]; } else if (Math.abs(v - bestV) < 1e-9) best.push(mv);
    }
    const mv = best[Math.floor(Math.random() * best.length)];
    return { k: sqName(mv.from) + sqName(mv.to) + (mv.promo ? '=' + mv.promo : ''), ...mv };
  },

  rankActions(s, seat, legal) {
    const color = seat === s.whiteSeat ? 'w' : 'b';
    return legal.slice().sort((a, b) => {
      const va = evaluate(makeMove(s, a), color) + (s.board[a.to] ? VALUE[s.board[a.to].toLowerCase()] / 20 : 0);
      const vb = evaluate(makeMove(s, b), color) + (s.board[b.to] ? VALUE[s.board[b.to].toLowerCase()] / 20 : 0);
      return vb - va;
    });
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    const myColor = seat === s.whiteSeat ? 'w' : 'b';
    if (s.turn !== myColor) return '对手正在想…';
    return inCheck(s, myColor) ? '你被将军了！必须先解将' : '点自己的棋子，再点目标格';
  },

  extraButtons(s, seat, ctx) {
    return s.winner === null ? [resignBtn(ctx.act)] : [];
  },

  seatInfo(s, seat) {
    return { sub: seat === s.whiteSeat ? '白方' : '黑方', badge: this.turn(s) === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const me = 0;
    const myColor = me === s.whiteSeat ? 'w' : 'b';
    const flipped = myColor === 'b';
    const availH = Math.max(260, window.innerHeight - 320);
    const px = Math.round(Math.min((ctx.host.clientWidth || 460) - 6, Math.min(availH, 560), 560));
    const cell = px / 8;

    const wrap = el('div.board-wrap', { style: { width: '100%' } });
    const board = el('div.board', { style: { width: px + 'px', height: px + 'px', position: 'relative' } });
    const grid = el('div.bgrid', { style: { gridTemplateColumns: `repeat(8,1fr)`, gridTemplateRows: `repeat(8,1fr)` } });

    const ui = ctx.host.__ui = ctx.host.__ui || {};
    const sel = ui.sel ?? null;
    const legalNow = (s.turn === myColor && s.winner === null) ? legalMoves(s, myColor) : [];
    const targets = sel !== null ? legalNow.filter((m) => m.from === sel) : [];

    for (let vy = 0; vy < 8; vy++) {
      for (let vx = 0; vx < 8; vx++) {
        const x = flipped ? 7 - vx : vx;
        const y = flipped ? 7 - vy : vy;
        const i = y * 8 + x;
        const dark = (x + y) % 2 === 1;
        const cellNode = el('div.cell' + (dark ? '.dark2' : '.light'));
        if (sel === i) cellNode.classList.add('sel');
        if (s.last && s.last.to === i) cellNode.classList.add('lastto');
        if (s.last && s.last.from === i) cellNode.classList.add('lastfrom');
        const p = s.board[i];
        if (p) {
          cellNode.append(el('div.piece' + (isWhite(p) ? '.s1' : '.s2'), {
            style: { fontSize: Math.round(cell * 0.74) + 'px' },
            text: GLYPH[p],
          }));
        }
        const tgt = targets.find((m) => m.to === i);
        if (tgt) cellNode.append(el('div.hint' + (s.board[i] || tgt.ep ? '.cap' : '')));
        cellNode.addEventListener('click', () => {
          if (s.turn !== myColor || s.winner !== null) return;
          const nowSel = ctx.host.__ui.sel ?? null;
          if (nowSel !== null) {
            const hit = legalNow.filter((m) => m.from === nowSel && m.to === i);
            if (hit.length) {
              if (hit.length > 1 && hit[0].promo) {
                pickPromo(hit, (mv) => { ctx.host.__ui.sel = null; ctx.act({ k: sqName(mv.from) + sqName(mv.to) + '=' + mv.promo, ...mv }); });
                return;
              }
              ctx.host.__ui.sel = null;
              const mv = hit[0];
              ctx.act({ k: sqName(mv.from) + sqName(mv.to) + (mv.promo ? '=' + mv.promo : ''), ...mv });
              return;
            }
          }
          if (p && colorOf(p) === myColor) ctx.host.__ui.sel = i;
          else ctx.host.__ui.sel = null;
          ctx.rerender();
        });
        grid.append(cellNode);
      }
    }
    board.append(grid);
    wrap.append(board);
    ctx.host.append(wrap);
  },
};

function pickPromo(moves, cb) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.style.zIndex = 80;
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.width = 'auto';
  box.append(el('h3', { text: '升变为' }));
  const row = el('div.row');
  for (const pr of 'qrbn') {
    const mv = moves.find((m) => m.promo === pr);
    if (!mv) continue;
    row.append(el('button.btn', { onClick: () => { scrim.remove(); cb(mv); } }, GLYPH[pr === 'q' ? 'Q' : pr.toUpperCase()] + ' ' + NAME[pr]));
  }
  box.append(row);
  scrim.append(box);
  document.getElementById('modalRoot').append(scrim);
  requestAnimationFrame(() => scrim.classList.add('on'));
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
}

export default chess;