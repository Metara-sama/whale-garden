/* 围棋 · 9/13/19 路 · 提子 / 禁自杀 / 打劫 / 双弃权终局 · 中国规则数子 */
import { el } from '../core/util.js';
import { resignBtn } from './common.js';

const COLS = 'ABCDEFGHJKLMNOPQRST';
const idxOf = (x, y, N) => y * N + x;
const xyOf = (i, N) => [i % N, Math.floor(i / N)];

function neighbors(i, N) {
  const x = i % N, y = Math.floor(i / N);
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < N - 1) out.push(i + 1);
  if (y > 0) out.push(i - N);
  if (y < N - 1) out.push(i + N);
  return out;
}

function groupOf(board, start, N) {
  const color = board[start];
  const stones = new Set([start]);
  const libs = new Set();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    for (const nb of neighbors(cur, N)) {
      const v = board[nb];
      if (v === 0) libs.add(nb);
      else if (v === color && !stones.has(nb)) { stones.add(nb); stack.push(nb); }
    }
  }
  return { stones, libs };
}

/** 尝试落子，返回新局面或 null（非法） */
function tryPlay(s, i, color) {
  const { board, N } = s;
  if (board[i] !== 0) return null;
  if (s.ko === i) return null;
  const b = board.slice();
  b[i] = color;
  const enemy = color === 1 ? 2 : 1;
  const captured = [];
  for (const nb of neighbors(i, N)) {
    if (b[nb] !== enemy) continue;
    const g = groupOf(b, nb, N);
    if (g.libs.size === 0) {
      for (const st of g.stones) { b[st] = 0; captured.push(st); }
    }
  }
  if (captured.length === 0) {
    const mine = groupOf(b, i, N);
    if (mine.libs.size === 0) return null; // 自杀
  }
  const mineAfter = groupOf(b, i, N);
  const ko = (captured.length === 1 && mineAfter.stones.size === 1) ? captured[0] : null;
  return { board: b, captured, ko };
}

function scoreBoard(board, N) {
  const visited = new Array(N * N).fill(false);
  let black = 0, white = 0;
  for (let i = 0; i < N * N; i++) {
    if (board[i] === 1) black++;
    else if (board[i] === 2) white++;
  }
  for (let i = 0; i < N * N; i++) {
    if (board[i] !== 0 || visited[i]) continue;
    const region = [];
    const borders = new Set();
    const stack = [i];
    visited[i] = true;
    while (stack.length) {
      const cur = stack.pop();
      region.push(cur);
      for (const nb of neighbors(cur, N)) {
        const v = board[nb];
        if (v === 0 && !visited[nb]) { visited[nb] = true; stack.push(nb); }
        else if (v !== 0) borders.add(v);
      }
    }
    if (borders.size === 1) {
      if (borders.has(1)) black += region.length;
      else white += region.length;
    }
  }
  return { black, white };
}

/** 本地兜底：靠近已有棋子 + 提子优先 + 少量随机 */
function pickLocal(s, color, level) {
  const N = s.N;
  const cand = [];
  for (let i = 0; i < N * N; i++) {
    if (s.board[i] !== 0) continue;
    const r = tryPlay(s, i, color);
    if (r) cand.push({ i, r });
  }
  if (!cand.length) return { k: 'pass', pass: true };
  if (level <= 0) {
    const c = cand[Math.floor(Math.random() * cand.length)];
    return { k: 'p' + c.i, i: c.i };
  }
  let best = null, bestV = -1e9;
  for (const c of cand) {
    const [x, y] = xyOf(c.i, N);
    let v = c.r.captured.length * 12;
    let near = 0;
    for (const nb of neighbors(c.i, N)) if (s.board[nb]) near++;
    v += near * 2.5;
    v += 3 - (Math.abs(x - N / 2) + Math.abs(y - N / 2)) * 0.16;
    if (s.moveCount < 2) v += (Math.abs(x - N / 2) + Math.abs(y - N / 2) < 3) ? 10 : 0;
    v += Math.random() * (level >= 2 ? 1.5 : 6);
    if (v > bestV) { bestV = v; best = c; }
  }
  return { k: 'p' + best.i, i: best.i };
}

const go = {
  id: 'go',
  name: '围棋',
  icon: '⚪',
  desc: '真提子、真打劫、真数子。9 路适合跟 AI 磨，19 路够呛。',
  tags: ['棋类', '双人'],
  players: { min: 2, max: 2, def: 2 },
  optionSpec: [
    { key: 'size', label: '棋盘', type: 'seg', def: 9, options: [{ v: 9, label: '9 路' }, { v: 13, label: '13 路' }, { v: 19, label: '19 路' }] },
    { key: 'komi', label: '贴目（白方）', type: 'seg', def: 6.5, options: [{ v: 0, label: '0' }, { v: 5.5, label: '5.5' }, { v: 6.5, label: '6.5' }, { v: 7.5, label: '7.5' }] },
    { key: 'first', label: '谁执黑', type: 'seg', def: 0, options: [{ v: 0, label: '你执黑（先行）' }, { v: 1, label: 'AI 执黑' }] },
  ],
  rulesBrief: '黑先，轮流在交叉点落子。被完全包围（无气）的棋子被提走。禁止自杀（除非同时提子），禁止立即回提同一劫。双方连续弃权终局，中国规则数子：己方棋子 + 己方围住的空点，白方另加贴目。',

  init(opt) {
    const N = opt.size || 9;
    const blackSeat = opt.first ? 1 : 0;
    return {
      N, board: new Array(N * N).fill(0), turn: blackSeat, blackSeat,
      ko: null, passes: 0, caps: [0, 0],
      moveCount: 0, last: null, komi: opt.komi ?? 6.5, winner: null, result: null,
    };
  },

  turn(s) { return s.winner === null ? s.turn : null; },

  legal(s, seat) {
    if (s.winner !== null) return [];
    if (seat !== undefined && seat !== null && s.turn !== seat) return [];
    const color = s.turn === s.blackSeat ? 1 : 2;
    const out = [{ k: 'pass', label: '弃权（停一手）', pass: true }];
    for (let i = 0; i < s.N * s.N; i++) {
      if (s.board[i] !== 0) continue;
      if (tryPlay(s, i, color)) {
        const [x, y] = xyOf(i, s.N);
        out.push({ k: 'p' + i, i, label: `落子 ${COLS[x] || x}${y + 1}` });
      }
    }
    return out.slice(0, 400);
  },

  apply(s, a) {
    if (a.resign) {
      s.winner = 1 - this.turn(s);
      s.result = { resigned: true };
      return { log: '认输了' };
    }
    if (a.pass) {
      s.passes++;
      s.last = null;
      s.turn = 1 - s.turn;
      if (s.passes >= 2) {
        const sc = scoreBoard(s.board, s.N);
        const bTotal = sc.black;
        const wTotal = sc.white + s.komi;
        s.result = { sc, bTotal, wTotal };
        s.winner = bTotal === wTotal ? -1 : (bTotal > wTotal ? s.blackSeat : 1 - s.blackSeat);
        return { log: ['双方弃权，终局', `数子：黑 ${bTotal} / 白 ${wTotal}（含贴目 ${s.komi}）`] };
      }
      return { log: '弃权一手' };
    }
    const color = s.turn === s.blackSeat ? 1 : 2;
    const r = tryPlay(s, a.i, color);
    if (!r) return { log: '非法落子' };
    s.board = r.board;
    s.ko = r.ko;
    s.passes = 0;
    s.moveCount++;
    s.last = a.i;
    s.caps[s.turn] += r.captured.length;
    const [x, y] = xyOf(a.i, s.N);
    const logs = [`${color === 1 ? '黑' : '白'} ${COLS[x] || x}${y + 1}`];
    if (r.captured.length) logs.push(`提 ${r.captured.length} 子`);
    s.turn = 1 - s.turn;
    return { log: logs };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    if (s.winner === -1) return { over: true, result: { title: '和棋', text: `黑 ${s.result?.bTotal} : 白 ${s.result?.wTotal}`, rows: [{ seat: 0, text: '½' }, { seat: 1, text: '½' }] } };
    const sc = s.result?.sc;
    return {
      over: true,
      result: {
        title: s.winner === 0 ? '你赢了' : '你输了',
        text: s.result?.resigned ? '对手认输。' : `数子：黑 ${s.result?.bTotal} 目，白 ${s.result?.wTotal} 目（含贴目）。黑子 ${sc?.black}，白子 ${sc?.white}。`,
        rows: [{ seat: s.winner, text: '胜' }, { seat: 1 - s.winner, text: '负' }],
      },
    };
  },

  view(s, seat) {
    const N = s.N;
    const myColor = seat === s.blackSeat ? 1 : 2;
    const rows = [];
    for (let y = 0; y < N; y++) {
      let line = String(y + 1).padStart(2, '0') + ' ';
      for (let x = 0; x < N; x++) {
        const v = s.board[idxOf(x, y, N)];
        line += v === 0 ? '·' : v === 1 ? 'X' : 'O';
      }
      rows.push(line);
    }
    const cnt = (c) => s.board.filter((v) => v === c).length;
    return [
      `你执${myColor === 1 ? '黑' : '白'}（黑先，贴目 ${s.komi}）。${s.turn === seat ? '轮到你' : '轮到对手'}，第 ${s.moveCount} 手。`,
      `盘上黑 ${cnt(1)} 子、白 ${cnt(2)} 子；你提了对方 ${s.caps[seat]} 子。${s.ko !== null ? '现在有劫，不能马上回提。' : ''}`,
      '（X = 黑，O = 白，· 为空）',
      rows.join('\n'),
    ].join('\n');
  },

  fallback(s, seat, level) {
    const color = seat === s.blackSeat ? 1 : 2;
    return pickLocal(s, color, level);
  },

  rankActions(s, seat, legal) { return legal.slice(); },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    if (s.turn !== seat) return '对手正在想…';
    return '点交叉点落子；没得下了就「弃权」，双方连续弃权即终局数子';
  },

  extraButtons(s, seat, ctx) {
    if (s.winner !== null) return [];
    return [el('button.btn.sm', { onClick: () => ctx.act({ k: 'pass', pass: true }) }, '弃权'), resignBtn(ctx.act)];
  },

  seatInfo(s, seat) {
    return { sub: `${seat === s.blackSeat ? '黑' : '白'}棋 · 提 ${s.caps[seat]}`, badge: s.turn === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const N = s.N;
    const availH = Math.max(260, window.innerHeight - 320);
    const px = Math.round(Math.min((ctx.host.clientWidth || 440) - 8, Math.min(availH, 560), 560));
    const cell = px / N;
    const ox = cell / 2;

    const wrap = el('div.board-wrap', { style: { width: '100%' } });
    const board = el('div.board', { style: { width: px + 'px', height: px + 'px', position: 'relative', background: 'linear-gradient(155deg,#e6cd9e,#c9a86e)' } });
    const cv = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    cv.width = px * dpr; cv.height = px * dpr;
    cv.style.cssText = `width:${px}px;height:${px}px;display:block`;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.strokeStyle = 'rgba(70,50,30,.62)';
    g.lineWidth = Math.max(0.8, px / 700);
    for (let k = 0; k < N; k++) {
      const p = ox + k * cell;
      g.beginPath(); g.moveTo(ox, p); g.lineTo(ox + (N - 1) * cell, p); g.stroke();
      g.beginPath(); g.moveTo(p, ox); g.lineTo(p, ox + (N - 1) * cell); g.stroke();
    }
    const stars = N === 19 ? [3, 9, 15] : N === 13 ? [3, 6, 9] : N === 9 ? [2, 4, 6] : [];
    g.fillStyle = 'rgba(60,40,20,.75)';
    for (const sx of stars) for (const sy of stars) {
      g.beginPath();
      g.arc(ox + sx * cell, ox + sy * cell, Math.max(1.6, cell * 0.06), 0, Math.PI * 2);
      g.fill();
    }
    board.append(cv);

    const layer = el('div', { style: { position: 'absolute', inset: '0' } });
    for (let i = 0; i < N * N; i++) {
      const v = s.board[i];
      if (!v) continue;
      const [x, y] = xyOf(i, N);
      const r = cell * 0.92;
      layer.append(el('div', {
        style: {
          position: 'absolute', width: r + 'px', height: r + 'px', borderRadius: '50%',
          left: ox + x * cell - r / 2 + 'px', top: ox + y * cell - r / 2 + 'px',
          background: v === 1
            ? 'radial-gradient(circle at 33% 28%, #6b8095, #0b1b28 72%)'
            : 'radial-gradient(circle at 33% 28%, #fff, #cddfeb 74%)',
          boxShadow: v === 1 ? '0 2px 5px rgba(0,0,0,.5), inset -2px -3px 5px rgba(0,0,0,.55)' : '0 2px 5px rgba(0,0,0,.4), inset -2px -3px 5px rgba(120,150,170,.45)',
          animation: 'popIn .16s cubic-bezier(.16,1,.3,1) both',
          outline: s.last === i ? '2px solid rgba(255,95,115,.85)' : 'none',
          zIndex: 2,
        },
      }));
    }

    if (s.winner === null && s.turn === 0) {
      board.style.cursor = 'pointer';
      board.addEventListener('click', (e) => {
        const rect = board.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left - ox) / cell);
        const y = Math.round((e.clientY - rect.top - ox) / cell);
        if (x < 0 || y < 0 || x >= N || y >= N) return;
        const i = idxOf(x, y, N);
        if (s.board[i] !== 0) return;
        if (s.ko === i) return;
        const color = s.turn === s.blackSeat ? 1 : 2;
        if (!tryPlay(s, i, color)) return;
        ctx.act({ k: 'p' + i, i });
      });
    }
    board.append(layer);
    wrap.append(board);
    ctx.host.append(wrap);
  },
};

export default go;