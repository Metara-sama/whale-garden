/* 麻将 · 4 人 · 万/条/筒（无字牌） · 碰 / 杠 / 胡 / 点炮 / 荒庄 */
import { el, shuffle } from '../core/util.js';

const SUIT_TXT = ['万', '条', '筒'];
const NUM_TXT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const tileName = (t) => NUM_TXT[(t % 9) + 1] + SUIT_TXT[Math.floor(t / 9)];
const tilesName = (arr) => arr.map(tileName).join('');

function buildWall() {
  const w = [];
  for (let s = 0; s < 3; s++) for (let n = 0; n < 9; n++) for (let k = 0; k < 4; k++) w.push(s * 9 + n);
  return shuffle(w);
}

const countOf = (tiles) => {
  const c = new Array(27).fill(0);
  for (const t of tiles) c[t]++;
  return c;
};

function checkMelds(c) {
  let i = 0;
  while (i < 27 && c[i] === 0) i++;
  if (i === 27) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    if (checkMelds(c)) { c[i] += 3; return true; }
    c[i] += 3;
  }
  const num = i % 9;
  if (num <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (checkMelds(c)) { c[i]++; c[i + 1]++; c[i + 2]++; return true; }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return false;
}

/** 3n+2 张是否和牌（标准型 + 七对） */
export function isWinTiles(tiles) {
  if (tiles.length % 3 !== 2) return false;
  const c = countOf(tiles);
  if (tiles.length === 14 && c.every((n) => n % 2 === 0) && c.filter((n) => n > 0).length >= 5) return true;
  for (let i = 0; i < 27; i++) {
    if (c[i] >= 2) {
      c[i] -= 2;
      const ok = checkMelds(c.slice());
      c[i] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 向听粗估，用于本地 AI 打分 */
function shantenScore(tiles) {
  const c = countOf(tiles);
  let melds = 0, pairs = 0, partial = 0;
  for (let i = 0; i < 27; i++) {
    if (c[i] >= 3) { melds++; c[i] -= 3; }
  }
  for (let i = 0; i < 27; i++) {
    if (c[i] >= 2) { pairs++; c[i] -= 2; }
  }
  for (let s = 0; s < 3; s++) {
    for (let n = 0; n < 8; n++) {
      const i = s * 9 + n;
      if (n <= 6 && c[i] > 0 && c[i + 1] > 0) { partial++; c[i]--; c[i + 1]--; }
      else if (n <= 7 && c[i] > 0 && c[i + 2] > 0) { partial++; c[i]--; c[i + 2]--; }
    }
  }
  const used = melds + Math.min(partial, 4 - melds);
  return used * 2 + Math.min(pairs, 1);
}

function neighborValue(tiles, idx) {
  if (idx < 0) return 0;
  const t = tiles[idx];
  const s = Math.floor(t / 9), n = t % 9;
  let v = 0;
  for (const d of [-2, -1, 1, 2]) {
    const nn = n + d;
    if (nn < 0 || nn > 8) continue;
    const target = s * 9 + nn;
    const same = tiles.filter((x) => x === target).length;
    if (same) v += (Math.abs(d) === 1 ? 2.2 : 1) * same;
  }
  const sameCount = tiles.filter((x) => x === t).length;
  v += (sameCount - 1) * 4;
  v += (4 - Math.abs(4 - n)) * 0.12;
  return v;
}

const mahjong = {
  id: 'mahjong',
  name: '麻将',
  icon: '🀄',
  desc: '四人一桌，万条筒，能碰能杠能点炮，先和牌者胜。',
  tags: ['四人', '牌类'],
  players: { min: 4, max: 4, def: 4 },
  optionSpec: [
    { key: 'aiHand', label: 'AI 开局手气', type: 'seg', def: 0, options: [{ v: 0, label: '正常' }, { v: 1, label: '偏顺' }] },
  ],
  rulesBrief: '只用万、条、筒各 1-9（共 108 张，无字牌无花牌）。每人 13 张，庄家先摸。轮流摸牌打牌。别人打出的牌可以碰（两张同牌）、杠（三张同牌）或和（凑成 4 面子 + 1 对，或七对）。不能吃。牌摸完还没人和牌则荒庄。',

  init(opt, seatCount) {
    const seats = seatCount || 4;
    const wall = buildWall();
    const hands = Array.from({ length: seats }, () => []);
    for (let r = 0; r < 13; r++) for (let p = 0; p < seats; p++) hands[p].push(wall.pop());
    hands.forEach((h) => h.sort((a, b) => a - b));
    const s = {
      seats, wall, hands,
      melds: Array.from({ length: seats }, () => []),
      discards: Array.from({ length: seats }, () => []),
      turn: 0, phase: 'draw', drawn: null, lastDiscard: null,
      claim: null, claimQueue: [], claimIndex: 0,
      winner: null, winType: '', winSeat: null, kongCount: new Array(seats).fill(0),
      opt: { ...opt },
    };
    mahjong.doDraw(s);
    return s;
  },

  turn(s) {
    if (s.winner !== null) return null;
    if (s.phase === 'claim') return s.claimQueue[s.claimIndex] ?? null;
    return s.turn;
  },

  doDraw(s) {
    if (!s.wall.length) { s.phase = 'over'; s.winner = -1; return; }
    const t = s.wall.pop();
    s.drawn = t;
    s.hands[s.turn].push(t);
    s.hands[s.turn].sort((a, b) => a - b);
    s.phase = 'discard';
  },

  legal(s, seat) {
    if (s.winner !== null) return [];
    if (seat !== undefined && seat !== null && this.turn(s) !== seat) return [];
    const out = [];
    if (s.phase === 'claim') {
      const t = s.lastDiscard?.tile;
      const me = s.claimQueue[s.claimIndex];
      if (me === undefined) return [];
      const hand = s.hands[me];
      const full = hand.concat(t !== undefined ? [t] : []);
      if (t !== undefined && isWinTiles(full)) out.push({ k: 'win', win: true, label: `和牌！用 ${tileName(t)} 点炮` });
      const same = t !== undefined ? hand.filter((x) => x === t).length : 0;
      if (t !== undefined && same >= 3) out.push({ k: 'kong:' + t, kong: true, kind: 'ming', tile: t, label: `杠 ${tileName(t)}` });
      if (t !== undefined && same >= 2) out.push({ k: 'pong:' + t, pong: true, tile: t, label: `碰 ${tileName(t)}` });
      out.push({ k: 'pass', pass: true, label: '不要' });
      return out;
    }
    const hand = s.hands[s.turn];
    if (isWinTiles(hand)) out.push({ k: 'win', win: true, label: '自摸和牌！' });
    const c = countOf(hand);
    for (let i = 0; i < 27; i++) if (c[i] === 4) out.push({ k: 'ankong:' + i, kong: true, kind: 'an', tile: i, label: `暗杠 ${tileName(i)}` });
    s.melds[s.turn].forEach((m, mi) => {
      if (m.type === 'pong' && hand.includes(m.tile)) {
        out.push({ k: `addkong:${mi}`, kong: true, kind: 'add', meldIndex: mi, tile: m.tile, label: `加杠 ${tileName(m.tile)}` });
      }
    });
    const seen = new Set();
    hand.forEach((t) => {
      if (seen.has(t)) return;
      seen.add(t);
      out.push({ k: 'd:' + t, discard: true, tile: t, label: `打出 ${tileName(t)}` });
    });
    return out;
  },

  apply(s, a) {
    /* ---- 响应窗口 ---- */
    if (s.phase === 'claim') {
      const me = s.claimQueue[s.claimIndex];
      if (!a || a.pass) {
        s.claimIndex++;
        if (s.claimIndex >= s.claimQueue.length) {
          s.phase = 'draw';
          s.claim = null;
          s.turn = (s.lastDiscard.seat + 1) % s.seats;
          this.doDraw(s);
        }
        return { log: '不要' };
      }
      const t = s.lastDiscard.tile;
      const from = s.lastDiscard.seat;
      if (a.win) {
        s.winner = me;
        s.winSeat = me;
        s.winType = '点炮（' + tileName(t) + '）';
        return { log: `${tileName(t)} 点炮，和了` };
      }
      if (a.pong) {
        const hand = s.hands[me];
        for (let k = 0; k < 2; k++) {
          const i = hand.indexOf(t);
          if (i >= 0) hand.splice(i, 1);
        }
        s.melds[me].push({ type: 'pong', tile: t });
        s.discards[from].pop();
        s.turn = me;
        s.drawn = null;
        s.phase = 'discard';
        s.claim = null;
        return { log: `碰 ${tileName(t)}` };
      }
      if (a.kong) {
        const hand = s.hands[me];
        for (let k = 0; k < 3; k++) {
          const i = hand.indexOf(t);
          if (i >= 0) hand.splice(i, 1);
        }
        s.melds[me].push({ type: 'kong', tile: t });
        s.discards[from].pop();
        s.kongCount[me]++;
        s.turn = me;
        s.claim = null;
        s.phase = 'draw';
        this.doDraw(s);
        return { log: `杠 ${tileName(t)}` };
      }
      return null;
    }

    /* ---- 自己的回合 ---- */
    if (a.win) {
      s.winner = s.turn;
      s.winSeat = s.turn;
      s.winType = '自摸（' + (s.drawn !== null ? tileName(s.drawn) : '') + '）';
      return { log: '自摸和牌！' };
    }
    if (a.kong) {
      const hand = s.hands[s.turn];
      if (a.kind === 'an') {
        const t = a.tile;
        for (let k = 0; k < 4; k++) {
          const i = hand.indexOf(t);
          if (i >= 0) hand.splice(i, 1);
        }
        s.melds[s.turn].push({ type: 'kong', tile: t });
        s.kongCount[s.turn]++;
        s.phase = 'draw';
        this.doDraw(s);
        return { log: `暗杠 ${tileName(t)}` };
      }
      if (a.kind === 'add') {
        const m = s.melds[s.turn][a.meldIndex];
        const i = hand.indexOf(a.tile);
        if (i >= 0) hand.splice(i, 1);
        m.type = 'kong';
        s.kongCount[s.turn]++;
        s.phase = 'draw';
        this.doDraw(s);
        return { log: `加杠 ${tileName(a.tile)}` };
      }
      return null;
    }
    if (a.discard) {
      const hand = s.hands[s.turn];
      const t = a.tile;
      const i = hand.indexOf(t);
      if (i < 0) return null;
      hand.splice(i, 1);
      s.discards[s.turn].push(t);
      s.lastDiscard = { seat: s.turn, tile: t };
      s.drawn = null;
      const queue = [];
      for (let k = 1; k < s.seats; k++) queue.push((s.turn + k) % s.seats);
      s.claimQueue = queue;
      s.claimIndex = 0;
      s.phase = 'claim';
      s.claim = { tile: t, seat: s.turn };
      return { log: `打出 ${tileName(t)}` };
    }
    return null;
  },

  status(s) {
    if (s.winner === null) return { over: false };
    if (s.winner === -1) return { over: true, result: { title: '荒庄', text: '牌摸完了，没人自摸。', rows: s.hands.map((h, i) => ({ seat: i, text: h.length + ' 张' })) } };
    return {
      over: true,
      result: {
        title: s.winner === 0 ? '你赢了' : '你输了',
        text: `${s.winner === 0 ? '你' : '座位 ' + s.winner} ${s.winType}`,
        rows: s.hands.map((h, i) => ({ seat: i, text: i === s.winner ? '和牌 · ' + s.winType : `未和 · ${h.length} 张` })),
      },
    };
  },

  view(s, seat) {
    const hand = s.hands[seat];
    const lines = [
      `你是座位 ${seat}，${s.seats} 人局。牌墙还剩 ${s.wall.length} 张。`,
      `你的手牌（${hand.length} 张）：${tilesName(hand)}`,
    ];
    const myMelds = s.melds[seat].map((m) => `${m.type === 'kong' ? '杠' : '碰'}${tileName(m.tile)}`);
    if (myMelds.length) lines.push(`你的副露：${myMelds.join('、')}`);
    const others = s.hands.map((h, i) => (i === seat ? null : `座位${i} ${h.length}张${s.melds[i].length ? '，副露 ' + s.melds[i].map((m) => tileName(m.tile)).join(',') : ''}`)).filter(Boolean);
    lines.push(`其他玩家：${others.join('；')}`);
    lines.push('牌河：', s.discards.map((d, i) => `座位${i}：${d.length ? tilesName(d) : '空'}`).join('\n'));
    if (s.phase === 'claim' && this.turn(s) === seat && s.lastDiscard) {
      lines.push(`座位 ${s.lastDiscard.seat} 刚打出 ${tileName(s.lastDiscard.tile)}，你可以碰/杠/和，或者不要。`);
    } else if (s.turn === seat) {
      lines.push(`轮到你${s.drawn !== null ? '（刚摸到 ' + tileName(s.drawn) + '）' : ''}，请打出一张牌。`);
    }
    return lines.join('\n');
  },

  fallback(s, seat, level) {
    const legal = this.legal(s, seat);
    if (!legal.length) return null;
    if (s.phase === 'claim') {
      const win = legal.find((x) => x.win);
      if (win) return win;
      const kong = legal.find((x) => x.kong);
      if (kong && level >= 1) return kong;
      const pong = legal.find((x) => x.pong);
      if (pong && level >= 2) return pong;
      return legal.find((x) => x.pass);
    }
    const win = legal.find((x) => x.win);
    if (win) return win;
    const kong = legal.find((x) => x.kong);
    if (kong && level >= 2) return kong;
    const disk = legal.filter((x) => x.discard);
    if (!disk.length) return legal[0];
    if (level <= 0) return disk[Math.floor(Math.random() * disk.length)];
    const hand = s.hands[seat];
    let best = disk[0], bestV = Infinity;
    for (const a of disk) {
      const rest = hand.slice();
      const i = rest.indexOf(a.tile);
      if (i >= 0) rest.splice(i, 1);
      const v = neighborValue(hand, hand.indexOf(a.tile)) + shantenScore(rest) * 10;
      if (v < bestV) { bestV = v; best = a; }
    }
    return best;
  },

  rankActions(s, seat, legal) {
    if (s.phase === 'claim') {
      return legal.slice().sort((a, b) => (b.win ? 2 : b.kong ? 1 : 0) - (a.win ? 2 : a.kong ? 1 : 0));
    }
    const hand = s.hands[seat];
    return legal.slice().sort((a, b) => {
      if (a.win && !b.win) return -1;
      if (b.win && !a.win) return 1;
      const va = a.tile !== undefined ? neighborValue(hand, hand.indexOf(a.tile)) : 99;
      const vb = b.tile !== undefined ? neighborValue(hand, hand.indexOf(b.tile)) : 99;
      return va - vb;
    });
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    if (s.phase === 'claim') {
      if (this.turn(s) === seat) return `别人打出 ${tileName(s.lastDiscard.tile)}：可以碰、杠、和，或者不要`;
      return '等其他玩家决定要不要碰…';
    }
    if (s.turn !== seat) return '等对手出牌…';
    return s.drawn !== null ? `刚摸到 ${tileName(s.drawn)}，点一张打出` : '点一张打出';
  },

  extraButtons(s, seat, ctx) {
    if (s.winner !== null) return [];
    const legalNow = this.legal(s, seat);
    const btns = [];
    if (s.phase === 'claim' && this.turn(s) === seat) {
      for (const a of legalNow) {
        btns.push(el('button.btn.sm' + (a.win ? '.primary' : a.pass ? '.ghost' : ''), { onClick: () => ctx.act(a) }, a.label));
      }
      return btns;
    }
    if (s.turn !== seat) return [];
    for (const a of legalNow) {
      if (a.win) btns.push(el('button.btn.sm.primary', { onClick: () => ctx.act(a) }, '自摸和牌！'));
      if (a.kong) btns.push(el('button.btn.sm', { onClick: () => ctx.act(a) }, a.label));
    }
    return btns;
  },

  seatInfo(s, seat) {
    const m = s.melds[seat].length;
    return {
      sub: `${s.hands[seat].length} 张${m ? ' · ' + m + ' 副露' : ''}`,
      badge: this.turn(s) === seat ? (s.phase === 'claim' ? '待响应' : '该你') : '',
    };
  },

  render(s, ctx) {
    const me = 0;
    const host = ctx.host;
    const SUITCLS = ['f', 't', 'b'];

    const tileNode = (t, { mini = false, playable = false, onClick } = {}) => {
      const node = el('div.mj' + (mini ? '.mini' : '') + '.' + SUITCLS[Math.floor(t / 9)] + (playable ? '.playable' : ''),
        el('span.num', { text: String((t % 9) + 1) }),
        el('span.suit', { text: SUIT_TXT[Math.floor(t / 9)] }),
      );
      if (onClick) node.addEventListener('click', onClick);
      return node;
    };

    const riverBox = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '4px 0 10px' } });
    s.discards.forEach((d, i) => {
      const row = el('div.row', { style: { gap: '3px', flexWrap: 'wrap' } },
        el('span.tiny.muted', { style: { width: '40px' } }, `${ctx.seats[i]?.name || '座位' + i}`),
      );
      d.forEach((t) => row.append(tileNode(t, { mini: true })));
      if (s.melds[i].length) {
        row.append(el('span.tiny.muted', { text: ' 副露' }));
        s.melds[i].forEach((m) => {
          for (let k = 0; k < (m.type === 'kong' ? 4 : 3); k++) row.append(tileNode(m.tile, { mini: true }));
        });
      }
      riverBox.append(row);
    });
    host.append(riverBox);

    const myTurn = this.turn(s) === me && s.winner === null;
    const handWrap = el('div.scrollx', { style: { width: '100%' } });
    const handRow = el('div.mj-hand');
    s.hands[me].forEach((t) => {
      handRow.append(tileNode(t, {
        playable: myTurn && s.phase === 'discard',
        onClick: (myTurn && s.phase === 'discard') ? () => ctx.act({ k: 'd:' + t, discard: true, tile: t }) : null,
      }));
    });
    handWrap.append(handRow);
    host.append(el('div.tiny.muted', { style: { marginTop: '6px' } },
      `你的手牌 · ${s.hands[me].length} 张 · 牌墙剩 ${s.wall.length} 张${s.drawn !== null && s.turn === me ? ` · 刚摸 ${tileName(s.drawn)}` : ''}`));
    host.append(handWrap);
  },
};

export default mahjong;