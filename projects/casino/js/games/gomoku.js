/* 五子棋 · 可选 9/13/15/19 路 · 任一方连五即胜 */
import { el } from '../core/util.js';
import { resignBtn } from './common.js';

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const NAMES = ['黑', '白'];
const COLS = 'ABCDEFGHJKLMNOPQRST';

const idxOf = (x, y, N) => y * N + x;
const xyOf = (i, N) => [i % N, Math.floor(i / N)];

function fiveAt(board, x, y, N, who) {
  for (const [dx, dy] of DIRS) {
    let n = 1;
    for (const s of [1, -1]) {
      let cx = x + dx * s, cy = y + dy * s;
      while (cx >= 0 && cx < N && cy >= 0 && cy < N && board[idxOf(cx, cy, N)] === who) {
        n++; cx += dx * s; cy += dy * s;
      }
    }
    if (n >= 5) return true;
  }
  return false;
}

function pointScore(board, i, N, who) {
  const [x, y] = xyOf(i, N);
  const enemy = 3 - who;
  const scan = (p) => {
    let total = 0;
    for (const [dx, dy] of DIRS) {
      let count = 1, open = 0;
      for (const s of [1, -1]) {
        let cx = x + dx * s, cy = y + dy * s, run = 0;
        while (cx >= 0 && cx < N && cy >= 0 && cy < N) {
          const v = board[idxOf(cx, cy, N)];
          if (v === p) { run++; cx += dx * s; cy += dy * s; }
          else { if (v === 0) open++; break; }
        }
        count += run;
      }
      const w = { 1: 1, 2: 12, 3: 90, 4: 900, 5: 100000 }[Math.min(count, 5)] || 0;
      total = Math.max(total, w * (1 + 0.3 * open));
    }
    return total;
  };
  const cx = (N - 1) / 2, cy = (N - 1) / 2;
  const center = 1 + 3 / (1 + Math.abs(x - cx) + Math.abs(y - cy));
  return (scan(who) + scan(enemy) * 0.92) * center;
}

const gomoku = {
  id: 'gomoku',
  name: '五子棋',
  icon: '⚫',
  desc: '最纯粹的攻防：先连成五子的人赢，AI 会抬手堵你的活三。',
  tags: ['棋类', '双人'],
  players: { min: 2, max: 2, def: 2 },
  optionSpec: [
    { key: 'size', label: '棋盘路数', type: 'seg', def: 15, options: [{ v: 9, label: '9 路' }, { v: 13, label: '13 路' }, { v: 15, label: '15 路' }, { v: 19, label: '19 路' }] },
    { key: 'first', label: '谁先手', type: 'seg', def: 0, options: [{ v: 0, label: '你先（黑）' }, { v: 1, label: 'AI 先（黑）' }] },
  ],
  rulesBrief: '黑先白后，轮流在交叉点落子。横、竖、斜任一方向先连成 5 子的一方获胜，无禁手。',

  init(opt) {
    const N = opt.size || 15;
    const first = opt.first ? 1 : 0;
    return { N, board: new Array(N * N).fill(0), turn: first, last: null, moveCount: 0, blackSeat: first, winner: null };
  },

  turn(s) { return s.winner === null ? s.turn : null; },

  legal(s, seat) {
    if (s.winner !== null) return [];
    if (seat !== undefined && s.turn !== seat) return [];
    const out = [];
    for (let i = 0; i < s.board.length; i++) {
      if (s.board[i] !== 0) continue;
      const [x, y] = xyOf(i, s.N);
      out.push({ k: 'p' + i, i, label: `落子 ${COLS[x] || x}${y + 1}` });
    }
    return out;
  },

  apply(s, a) {
    if (a.resign) {
      const loser = s.turn;
      s.winner = 1 - loser;
      return { log: '对手认输了' };
    }
    if (s.winner !== null || s.board[a.i] !== 0) return null;
    const who = s.turn === s.blackSeat ? 1 : 2;
    s.board[a.i] = who;
    s.last = a.i;
    s.moveCount++;
    const [x, y] = xyOf(a.i, s.N);
    const line = `${NAMES[who - 1]}落 ${COLS[x] || x}${y + 1}`;
    if (fiveAt(s.board, x, y, s.N, who)) {
      s.winner = s.turn;
      return { log: [line, `${NAMES[who - 1]}连五，拿下。`] };
    }
    if (s.moveCount >= s.N * s.N) { s.winner = -1; return { log: [line, '棋盘已满'] }; }
    s.turn = 1 - s.turn;
    return { log: line };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    if (s.winner === -1) return { over: true, result: { title: '和棋', text: '棋盘下满，谁也没连成五。', rows: [{ seat: 0, text: '—' }, { seat: 1, text: '—' }] } };
    return {
      over: true,
      result: {
        title: s.winner === 0 ? '你赢了' : '你输了',
        text: `${s.winner === 0 ? '你' : '对手'}连成五子。`,
        rows: [{ seat: s.winner, text: '胜' }, { seat: 1 - s.winner, text: '负' }],
      },
    };
  },

  view(s, seat) {
    const N = s.N;
    const me = seat === s.blackSeat ? 1 : 2;
    const rows = [];
    for (let y = 0; y < N; y++) {
      let line = '';
      for (let x = 0; x < N; x++) {
        const v = s.board[idxOf(x, y, N)];
        line += v === 0 ? '·' : v === me ? '○' : '●';
      }
      rows.push(String(y + 1).padStart(2, '0') + ' ' + line);
    }
    return [
      `你执${me === 1 ? '黑' : '白'}，${s.turn === seat ? '现在轮到你' : '现在轮到对手'}。棋盘 ${N}×${N}，已下 ${s.moveCount} 手。`,
      '（○ 是你的子，● 是对手的子；列号从 1 到 ' + N + '）',
      rows.join('\n'),
    ].join('\n');
  },

  fallback(s, seat, level) {
    const who = seat === s.blackSeat ? 1 : 2;
    const empties = [];
    for (let i = 0; i < s.board.length; i++) if (s.board[i] === 0) empties.push(i);
    if (!empties.length) return null;
    if (level <= 0) {
      const i = empties[Math.floor(Math.random() * empties.length)];
      return { k: 'p' + i, i };
    }
    let best = [], bestV = -1;
    for (const i of empties) {
      let v = pointScore(s.board, i, s.N, who);
      if (level <= 1) v *= 0.6 + Math.random() * 0.8;
      if (v > bestV + 1e-9) { bestV = v; best = [i]; }
      else if (Math.abs(v - bestV) < 1e-9) best.push(i);
    }
    const i = best[Math.floor(Math.random() * best.length)];
    return { k: 'p' + i, i };
  },

  rankActions(s, seat, legal) {
    const who = seat === s.blackSeat ? 1 : 2;
    return legal.slice().sort((a, b) => pointScore(s.board, b.i, s.N, who) - pointScore(s.board, a.i, s.N, who));
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    return s.turn === seat ? '轮到你落子' : '对手正在想…';
  },

  extraButtons(s, seat, ctx) {
    return s.winner === null ? [resignBtn(ctx.act)] : [];
  },

  seatInfo(s, seat) {
    return { sub: `${seat === s.blackSeat ? '黑' : '白'}棋`, badge: s.turn === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const N = s.N;
    const me = 0;
    const myColor = me === s.blackSeat ? 1 : 2;
    const availH = Math.max(260, window.innerHeight - 300);
    const px = Math.round(Math.min((ctx.host.clientWidth || 460) - 6, Math.min(availH, 580), 580));
    const cell = px / N;

    const wrap = el('div.board-wrap', { style: { width: '100%' } });
    const board = el('div.board', { style: { width: px + 'px', height: px + 'px', position: 'relative', background: 'linear-gradient(160deg,#e9d7b4,#cfb488)' } });
    const cv = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    cv.width = px * dpr; cv.height = px * dpr;
    cv.style.cssText = `width:${px}px;height:${px}px;display:block`;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.strokeStyle = 'rgba(70,52,32,.5)';
    g.lineWidth = Math.max(1, px / 520);
    for (let k = 0; k < N; k++) {
      const p = (k + 0.5) * cell;
      g.beginPath(); g.moveTo(cell / 2, p); g.lineTo(px - cell / 2, p); g.stroke();
      g.beginPath(); g.moveTo(p, cell / 2); g.lineTo(p, px - cell / 2); g.stroke();
    }
    const starMid = (N - 1) / 2;
    const stars = [Math.max(2, Math.round(starMid / 2)), Math.round(starMid), N - 1 - Math.max(2, Math.round(starMid / 2))];
    g.fillStyle = 'rgba(70,52,32,.55)';
    for (const sx of stars) for (const sy of stars) {
      g.beginPath();
      g.arc((sx + 0.5) * cell, (sy + 0.5) * cell, Math.max(1.5, px / 300), 0, Math.PI * 2);
      g.fill();
    }
    board.append(cv);

    const layer = el('div', { style: { position: 'absolute', inset: '0' } });
    for (let i = 0; i < s.board.length; i++) {
      const v = s.board[i];
      if (!v) continue;
      const [x, y] = xyOf(i, N);
      const r = cell * 0.86;
      const st = el('div', {
        style: {
          position: 'absolute', width: r + 'px', height: r + 'px', borderRadius: '50%',
          left: (x + 0.5) * cell - r / 2 + 'px', top: (y + 0.5) * cell - r / 2 + 'px',
          background: v === 1
            ? 'radial-gradient(circle at 33% 28%, #6b8095, #0b1b28 72%)'
            : 'radial-gradient(circle at 33% 28%, #fff, #c8dbe8 74%)',
          boxShadow: v === 1 ? '0 2px 5px rgba(0,0,0,.5), inset -2px -3px 5px rgba(0,0,0,.6)' : '0 2px 5px rgba(0,0,0,.4), inset -2px -3px 5px rgba(120,150,170,.5)',
          animation: 'popIn .18s cubic-bezier(.16,1,.3,1) both',
          outline: s.last === i ? '2px solid rgba(255,95,115,.9)' : 'none',
        },
      });
      layer.append(st);
    }

    const ghost = el('div', {
      style: {
        position: 'absolute', display: 'none', width: cell * 0.8 + 'px', height: cell * 0.8 + 'px',
        borderRadius: '50%', background: myColor === 1 ? 'rgba(10,30,45,.3)' : 'rgba(255,255,255,.6)',
        pointerEvents: 'none', transition: 'left .1s, top .1s',
      },
    });
    layer.append(ghost);

    if (s.winner === null && s.turn === me) {
      board.style.cursor = 'crosshair';
      board.addEventListener('click', (e) => {
        const rect = board.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left) / cell - 0.5);
        const y = Math.round((e.clientY - rect.top) / cell - 0.5);
        if (x < 0 || y < 0 || x >= N || y >= N) return;
        const i = idxOf(x, y, N);
        if (s.board[i] !== 0) return;
        ctx.act({ k: 'p' + i, i });
      });
      board.addEventListener('pointermove', (e) => {
        const rect = board.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left) / cell - 0.5);
        const y = Math.round((e.clientY - rect.top) / cell - 0.5);
        const ok = x >= 0 && y >= 0 && x < N && y < N && s.board[idxOf(x, y, N)] === 0;
        ghost.style.display = ok ? 'block' : 'none';
        ghost.style.left = (x + 0.5) * cell - cell * 0.4 + 'px';
        ghost.style.top = (y + 0.5) * cell - cell * 0.4 + 'px';
      });
      board.addEventListener('pointerleave', () => { ghost.style.display = 'none'; });
    }

    board.append(layer);
    wrap.append(board);
    ctx.host.append(wrap);
  },
};

export default gomoku;