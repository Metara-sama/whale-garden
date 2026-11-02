/* 斗地主 · 3 人 · 叫地主 / 底牌 / 全部牌型 / 炸弹王炸 */
import { el, shuffle } from '../core/util.js';

const RANK_TXT = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
const SUITS = ['♠', '♥', '♣', '♦'];
const TYPE_TXT = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', pairseq: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  four2: '四带二', bomb: '炸弹', rocket: '王炸',
};

const cardName = (c) => (c.r >= 16 ? RANK_TXT[c.r] : RANK_TXT[c.r] + SUITS[c.s]);
const cardsName = (arr) => arr.map(cardName).join(' ');

/* ---------------- 牌型分析 ---------------- */
function isSeq(vals) {
  if (vals.length < 2) return vals.length === 1;
  for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1] + 1) return false;
  return true;
}

export function analyze(cards) {
  const n = cards.length;
  if (!n) return null;
  const cnt = {};
  for (const c of cards) cnt[c.r] = (cnt[c.r] || 0) + 1;
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  const groups = Object.values(cnt).sort((a, b) => b - a);

  if (n === 2 && cnt[16] === 1 && cnt[17] === 1) return { type: 'rocket', len: 1, rank: 99 };
  if (n === 4 && groups[0] === 4) return { type: 'bomb', len: 1, rank: vals[0] };
  if (n === 1) return { type: 'single', len: 1, rank: vals[0] };
  if (n === 2 && groups[0] === 2) return { type: 'pair', len: 1, rank: vals[0] };
  if (n === 3 && groups[0] === 3) return { type: 'triple', len: 1, rank: vals[0] };
  if (n === 4 && groups[0] === 3) return { type: 'triple1', len: 1, rank: vals.find((v) => cnt[v] === 3) };
  if (n === 5 && groups[0] === 3 && groups[1] === 2) return { type: 'triple2', len: 1, rank: vals.find((v) => cnt[v] === 3) };

  // 顺子
  if (n >= 5 && vals.length === n && isSeq(vals) && vals[vals.length - 1] <= 14) {
    return { type: 'straight', len: n, rank: vals[0] };
  }
  // 连对
  if (n >= 6 && n % 2 === 0 && groups.every((g) => g === 2) && vals.length >= 3 && isSeq(vals) && vals[vals.length - 1] <= 14) {
    return { type: 'pairseq', len: vals.length, rank: vals[0] };
  }
  // 纯飞机
  if (n >= 6 && n % 3 === 0 && groups.every((g) => g === 3) && vals.length >= 2 && isSeq(vals) && vals[vals.length - 1] <= 14) {
    return { type: 'plane', len: vals.length, rank: vals[0] };
  }
  // 飞机带翅膀：找连续三张段
  const tri = vals.filter((v) => cnt[v] >= 3 && v <= 14).sort((a, b) => a - b);
  for (let len = tri.length; len >= 2; len--) {
    for (let st = 0; st + len <= tri.length; st++) {
      const seg = tri.slice(st, st + len);
      if (!isSeq(seg)) continue;
      const k = len;
      if (n === k * 4) {
        // 带单：剩余 k 张
        const rest = cards.filter((c) => !seg.includes(c.r) || cnt[c.r] > 3);
        const restCount = n - seg.reduce((x, v) => x + Math.min(cnt[v], 3), 0);
        if (restCount === k) {
          // 翅膀不能是王炸拆出来的两个王同时？宽松处理：允许
          return { type: 'plane1', len: k, rank: seg[0] };
        }
      }
      if (n === k * 5) {
        const restCount = n - seg.reduce((x, v) => x + Math.min(cnt[v], 3), 0);
        if (restCount === k * 2) {
          // 翅膀必须是 k 个对子
          const wing = { ...cnt };
          for (const v of seg) wing[v] = (wing[v] || 0) - 3;
          const ok = Object.entries(wing).every(([v, c]) => c === 0 || c === 2);
          if (ok) return { type: 'plane2', len: k, rank: seg[0] };
        }
      }
    }
  }
  // 四带二
  const quad = vals.find((v) => cnt[v] === 4);
  if (quad) {
    if (n === 6) return { type: 'four2', len: 1, rank: quad };
    if (n === 8) {
      const wing = { ...cnt };
      delete wing[quad];
      const ws = Object.values(wing);
      if (ws.length === 2 && ws.every((c) => c === 2)) return { type: 'four2', len: 2, rank: quad };
    }
  }
  return null;
}

export function canBeat(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.type === 'rocket') return true;
  if (b.type === 'rocket') return false;
  if (a.type === 'bomb' && b.type !== 'bomb') return true;
  if (b.type === 'bomb' && a.type !== 'bomb') return false;
  if (a.type !== b.type) return false;
  if (a.len !== b.len) return false;
  return a.rank > b.rank;
}

const BIG = (a, b) => a.rank - b.rank;

/* ---------------- 候选出牌生成 ---------------- */
function genCandidates(s, seat, mustBeat, limit = 260) {
  const hand = s.hands[seat];
  const out = [];
  const byRank = {};
  hand.forEach((c, i) => { (byRank[c.r] = byRank[c.r] || []).push(i); });
  const ranks = Object.keys(byRank).map(Number).sort((a, b) => a - b);
  const push = (idxs, type, len, rank) => {
    const key = idxs.slice().sort((a, b) => a - b).join(',');
    if (out.some((o) => o.key === key)) return;
    out.push({ key, idxs, type, len, rank });
  };

  // 单/对/三/炸
  for (const r of ranks) {
    const g = byRank[r];
    push([g[0]], 'single', 1, r);
    if (g.length >= 2) push([g[0], g[1]], 'pair', 1, r);
    if (g.length >= 3) {
      push([g[0], g[1], g[2]], 'triple', 1, r);
      // 三带一 / 三带二
      for (const r2 of ranks) {
        if (r2 === r) continue;
        const g2 = byRank[r2];
        push([g[0], g[1], g[2], g2[0]], 'triple1', 1, r);
        if (g2.length >= 2) push([g[0], g[1], g[2], g2[0], g2[1]], 'triple2', 1, r);
      }
    }
    if (g.length === 4) {
      push([g[0], g[1], g[2], g[3]], 'bomb', 1, r);
      // 四带二
      for (const r2 of ranks) {
        if (r2 === r) continue;
        const g2 = byRank[r2];
        for (const r3 of ranks) {
          if (r3 === r || r3 === r2) continue;
          push([g[0], g[1], g[2], g[3], g2[0], byRank[r3][0]], 'four2', 1, r);
          if (g2.length >= 2) push([g[0], g[1], g[2], g[3], g2[0], g2[1]], 'four2', 2, r);
        }
      }
    }
  }
  // 王炸
  if (byRank[16] && byRank[17]) push([byRank[16][0], byRank[17][0]], 'rocket', 1, 99);

  // 顺子
  const seqRanks = ranks.filter((r) => r <= 14).sort((a, b) => a - b);
  for (let i = 0; i < seqRanks.length; i++) {
    for (let len = 5; i + len <= seqRanks.length; len++) {
      const seg = seqRanks.slice(i, i + len);
      if (!isSeq(seg)) break;
      push(seg.map((r) => byRank[r][0]), 'straight', len, seg[0]);
    }
  }
  // 连对
  const pairRanks = ranks.filter((r) => r <= 14 && byRank[r].length >= 2).sort((a, b) => a - b);
  for (let i = 0; i < pairRanks.length; i++) {
    for (let len = 3; i + len <= pairRanks.length; len++) {
      const seg = pairRanks.slice(i, i + len);
      if (!isSeq(seg)) break;
      push(seg.flatMap((r) => [byRank[r][0], byRank[r][1]]), 'pairseq', len, seg[0]);
    }
  }
  // 飞机（纯 + 带单 + 带对，简单版：只带最没用的牌）
  const triRanks = ranks.filter((r) => r <= 14 && byRank[r].length >= 3).sort((a, b) => a - b);
  for (let i = 0; i < triRanks.length; i++) {
    for (let len = 2; i + len <= triRanks.length; len++) {
      const seg = triRanks.slice(i, i + len);
      if (!isSeq(seg)) break;
      const base = seg.flatMap((r) => [byRank[r][0], byRank[r][1], byRank[r][2]]);
      push(base, 'plane', len, seg[0]);
      // 带单：从最小的非主体牌里挑
      const rest = hand.map((c, idx) => ({ c, idx })).filter((x) => !seg.includes(x.c.r)).sort((a, b) => a.c.r - b.c.r);
      if (rest.length >= len) push(base.concat(rest.slice(0, len).map((x) => x.idx)), 'plane1', len, seg[0]);
      const restPairs = [];
      const usedR = new Set();
      for (const x of rest) {
        if (usedR.has(x.c.r)) continue;
        const same = rest.filter((y) => y.c.r === x.c.r);
        if (same.length >= 2) { restPairs.push([same[0].idx, same[1].idx]); usedR.add(x.c.r); }
      }
      if (restPairs.length >= len) push(base.concat(restPairs.slice(0, len).flat()), 'plane2', len, seg[0]);
    }
  }

  // 过滤必须压过 & 排序
  let list = out
    .map((o) => ({ ...o, cards: o.idxs.map((i) => hand[i]), info: analyze(o.idxs.map((i) => hand[i])) }))
    .filter((o) => o.info)
    .filter((o) => (mustBeat ? canBeat(o.info, mustBeat) : true));

  list.sort((a, b) => {
    if (a.info.type === 'rocket') return 1;
    if (b.info.type === 'rocket') return -1;
    if (a.info.type === 'bomb' && b.info.type !== 'bomb') return 1;
    if (b.info.type === 'bomb' && a.info.type !== 'bomb') return -1;
    if (b.cards.length !== a.cards.length) return b.cards.length - a.cards.length;
    return a.info.rank - b.info.rank;
  });
  return list.slice(0, limit).map((o) => ({
    k: 'p:' + o.key,
    idxs: o.idxs,
    label: `出 ${TYPE_TXT[o.info.type] || o.info.type}【${cardsName(o.cards)}】`,
    _info: o.info,
  }));
}

const doudizhu = {
  id: 'doudizhu',
  name: '斗地主',
  icon: '🃏',
  desc: '三人一桌，叫地主抢底牌，炸弹王炸都得防着。',
  tags: ['三人', '卡牌'],
  players: { min: 3, max: 3, def: 3 },
  optionSpec: [
    { key: 'auction', label: '叫地主方式', type: 'seg', def: 0, options: [{ v: 0, label: '轮流问' }, { v: 1, label: '随机指定' }] },
  ],
  rulesBrief: '三人对局，一人当地主拿 3 张底牌（共 20 张），另外两人是农民合作。地主先出，逆时针轮流。跟牌必须同牌型同张数且更大，炸弹可压任意非炸弹，王炸最大。出完手牌的一方获胜（地主胜或两农民胜）。',

  init(opt, seatCount) {
    const seats = seatCount || 3;
    let deck = [];
    for (let r = 3; r <= 15; r++) for (let s = 0; s < 4; s++) deck.push({ r, s });
    deck.push({ r: 16, s: 0 });
    deck.push({ r: 17, s: 0 });
    deck = shuffle(deck);
    const hands = [[], [], []].slice(0, seats);
    for (let i = 0; i < 51; i++) hands[i % seats].push(deck[i]);
    const bottom = deck.slice(51);
    hands.forEach((h) => h.sort((a, b) => b.r - a.r || a.s - b.s));
    return {
      seats, hands, bottom: bottom.sort((a, b) => b.r - a.r),
      opt: { ...opt },
      phase: 'bid', turn: 0, landlord: null, bidPassed: 0,
      lastPlay: null, passCount: 0, winner: null, history: [],
      bidLog: [],
    };
  },

  turn(s) { return s.winner === null ? s.turn : null; },

  legal(s, seat) {
    if (s.winner !== null) return [];
    if (seat !== undefined && seat !== null && s.turn !== seat) return [];
    if (s.phase === 'bid') {
      return [
        { k: 'bid', bid: true, label: '叫地主（拿底牌）' },
        { k: 'skip', bid: false, label: '不叫' },
      ];
    }
    const mustBeat = s.lastPlay && s.lastPlay.seat !== s.turn ? s.lastPlay.info : null;
    const list = genCandidates(s, s.turn, mustBeat);
    if (!mustBeat) return list;
    return list.concat([{ k: 'pass', pass: true, label: '不要（过）' }]);
  },

  apply(s, a) {
    if (s.phase === 'bid') {
      if (a.bid) {
        s.landlord = s.turn;
        s.hands[s.turn] = s.hands[s.turn].concat(s.bottom).sort((x, y) => y.r - x.r || x.s - y.s);
        s.bottom = [];
        s.phase = 'play';
        s.turn = s.landlord;
        return { log: `地主是座位 ${s.landlord}（${s.turn === 0 ? '你' : 'AI'}）` };
      }
      s.bidPassed++;
      s.turn = (s.turn + 1) % s.seats;
      if (s.bidPassed >= s.seats) {
        // 都不叫：重新发牌
        const fresh = doudizhu.init(s.opt || {}, s.seats);
        Object.assign(s, fresh);
        return { log: '三家都不叫，重新发牌' };
      }
      return { log: '不叫' };
    }

    if (a.pass) {
      s.passCount++;
      s.turn = (s.turn + 1) % s.seats;
      if (s.passCount >= s.seats - 1) { s.lastPlay = null; s.passCount = 0; }
      return { log: '不要' };
    }
    if (!a.idxs || !a.idxs.length) return null;
    const hand = s.hands[s.turn];
    const cards = a.idxs.map((i) => hand[i]).filter(Boolean);
    const info = analyze(cards);
    if (!info) return { log: '牌型不对' };
    const mustBeat = s.lastPlay && s.lastPlay.seat !== s.turn ? s.lastPlay.info : null;
    if (mustBeat && !canBeat(info, mustBeat)) return { log: '压不过' };

    // 移除手牌
    const sorted = a.idxs.slice().sort((x, y) => y - x);
    for (const i of sorted) hand.splice(i, 1);
    s.lastPlay = { seat: s.turn, info, cards };
    s.passCount = 0;
    s.history.push({ seat: s.turn, cards });
    const who = s.turn;
    if (hand.length === 0) {
      s.winner = who;
      s.winSide = who === s.landlord ? 'landlord' : 'farmer';
      return { log: [`${TYPE_TXT[info.type]} ${cardsName(cards)}`, who === s.landlord ? '地主赢了' : '农民赢了'] };
    }
    if (hand.length === 1) {
      // 报单提示
    }
    s.turn = (s.turn + 1) % s.seats;
    return { log: `${TYPE_TXT[info.type]} ${cardsName(cards)}` };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    const rows = [];
    if (s.winSide === 'landlord') {
      rows.push({ seat: s.landlord, text: '地主 · 胜' });
      for (let i = 0; i < s.seats; i++) if (i !== s.landlord) rows.push({ seat: i, text: '农民 · 负' });
    } else {
      rows.push({ seat: s.winner, text: '农民 · 胜' });
      for (let i = 0; i < s.seats; i++) if (i !== s.winner) rows.push({ seat: i, text: i === s.landlord ? '地主 · 负' : '农民 · 胜' });
    }
    const iWin = s.winSide === 'landlord' ? s.landlord === 0 : s.landlord !== 0;
    return {
      over: true,
      result: {
        title: iWin ? '你赢了' : '你输了',
        text: s.winSide === 'landlord' ? '地主先出完了牌。' : '农民一伙顶住了。',
        rows,
      },
    };
  },

  view(s, seat) {
    const hand = s.hands[seat];
    const role = s.phase === 'bid' ? '尚未确定' : (seat === s.landlord ? '地主' : '农民');
    const lines = [
      `你是座位 ${seat}，身份：${role}。第 ${s.seats} 人局。`,
      `牌局阶段：${s.phase === 'bid' ? '叫地主' : '出牌'}；${s.turn === seat ? '轮到你' : '轮到下家'}。`,
      `你的手牌（${hand.length} 张）：${cardsName(hand)}`,
    ];
    if (s.phase === 'play') {
      lines.push(`上一个出牌：${s.lastPlay ? `座位 ${s.lastPlay.seat} 出了 ${TYPE_TXT[s.lastPlay.info.type]}【${cardsName(s.lastPlay.cards)}】` : '无（你可以自由出牌）'}`);
      const others = s.hands.map((h, i) => (i === seat ? null : `座位${i} 剩 ${h.length} 张`)).filter(Boolean).join('，');
      lines.push(`对手牌数：${others}`);
      if (s.landlord === seat) lines.push('你是地主，独自对抗两个农民，要小心他们配合。');
      else if (s.landlord !== null) lines.push(`你是农民，队友是座位 ${[0, 1, 2].find((i) => i !== seat && i !== s.landlord)}，别压队友的牌。`);
    } else {
      lines.push('现在决定要不要叫地主：叫了就拿 3 张底牌单挑两家，不叫就等别人。');
    }
    return lines.join('\n');
  },

  fallback(s, seat, level) {
    if (s.phase === 'bid') {
      const hand = s.hands[seat];
      let power = 0;
      for (const c of hand) {
        if (c.r === 17) power += 4;
        else if (c.r === 16) power += 3;
        else if (c.r === 15) power += 2;
        else if (c.r === 14) power += 1;
      }
      const bomb = Object.values(hand.reduce((m, c) => { m[c.r] = (m[c.r] || 0) + 1; return m; }, {})).some((n) => n === 4);
      return { k: power >= 4 || bomb ? 'bid' : 'skip', bid: power >= 4 || bomb };
    }
    const mustBeat = s.lastPlay && s.lastPlay.seat !== s.turn ? s.lastPlay.info : null;
    const cands = genCandidates(s, s.turn, mustBeat, 400);
    if (!cands.length) return { k: 'pass', pass: true };
    const hand = s.hands[s.turn];
    const isTeammate = s.landlord !== null && s.landlord !== s.turn && s.lastPlay && s.lastPlay.seat !== s.landlord;
    // 队友出的牌，一般不要压（除非能一把出完）
    if (isTeammate && level >= 1) {
      const finisher = cands.find((c) => c.idxs.length === hand.length);
      if (finisher) return finisher;
      return { k: 'pass', pass: true };
    }
    if (level <= 0) return cands[Math.floor(Math.random() * cands.length)];
    // 能一把出完就出
    const finisher = cands.find((c) => c.idxs.length === hand.length);
    if (finisher) return finisher;
    // 不出炸弹（除非对手快出完）
    const safe = cands.filter((c) => c._info.type !== 'bomb' && c._info.type !== 'rocket');
    const pool = safe.length ? safe : cands;
    // 优先出张数多的（快速清牌），但别拆大牌
    const scored = pool.slice().sort((a, b) => {
      const sa = a.idxs.length * 2 - a._info.rank * 0.35 + (a._info.type === 'bomb' ? -20 : 0);
      const sb = b.idxs.length * 2 - b._info.rank * 0.35 + (b._info.type === 'bomb' ? -20 : 0);
      return sb - sa;
    });
    return scored[0];
  },

  rankActions(s, seat, legal) {
    const handLen = s.hands[seat].length;
    return legal.slice().sort((a, b) => {
      const fa = a.idxs && a.idxs.length === handLen ? 1 : 0;
      const fb = b.idxs && b.idxs.length === handLen ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return (b.idxs?.length || 0) - (a.idxs?.length || 0);
    });
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    if (s.phase === 'bid') return s.turn === seat ? '要不要叫地主？叫了就单挑两家' : '等别人决定…';
    if (s.turn !== seat) return '等对手出牌…';
    const mustBeat = s.lastPlay && s.lastPlay.seat !== s.turn;
    return mustBeat ? `必须压过【${TYPE_TXT[s.lastPlay.info.type]}】，或点「不要」` : '你自由出牌，选好牌点「出牌」';
  },

  extraButtons(s, seat, ctx) {
    if (s.winner !== null) return [];
    const host = ctx.table?.host;
    if (s.phase === 'bid') {
      if (s.turn !== seat) return [];
      return [
        el('button.btn.sm', { onClick: () => ctx.act({ k: 'bid', bid: true }) }, '叫地主'),
        el('button.btn.sm.ghost', { onClick: () => ctx.act({ k: 'skip', bid: false }) }, '不叫'),
      ];
    }
    if (s.turn !== seat) return [];
    const btns = [];
    btns.push(el('button.btn.sm.primary', {
      onClick: () => {
        const sel = host?.__ui?.sel;
        if (!sel || !sel.size) return;
        const idxs = [...sel];
        const info = analyze(idxs.map((i) => s.hands[seat][i]));
        if (!info) { window.__cgToast?.('这手牌不成牌型'); return; }
        host.__ui.sel = new Set();
        ctx.act({ k: 'p:' + idxs.join(','), idxs });
      }
    }, '出牌'));
    const mustBeat = s.lastPlay && s.lastPlay.seat !== s.turn;
    if (mustBeat) btns.push(el('button.btn.sm.ghost', { onClick: () => ctx.act({ k: 'pass', pass: true }) }, '不要'));
    btns.push(el('button.btn.sm.ghost', {
      onClick: () => {
        const cands = genCandidates(s, seat, mustBeat ? s.lastPlay.info : null, 400);
        if (!cands.length) return window.__cgToast?.('没有能出的牌');
        const pick = cands[Math.floor(Math.random() * Math.min(3, cands.length))];
        host.__ui.sel = new Set(pick.idxs);
        ctx.rerender();
      }
    }, '提示'));
    return btns;
  },

  seatInfo(s, seat) {
    const n = s.hands[seat].length;
    const role = s.landlord === null ? '' : (seat === s.landlord ? '地主' : '农民');
    return { sub: `${n} 张${role ? ' · ' + role : ''}`, badge: s.turn === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const me = 0;
    const host = ctx.host;
    const ui = host.__ui = host.__ui || {};
    if (!ui.sel) ui.sel = new Set();

    const cardNode = (c, { mini = true, sel = false, playable = false, onClick } = {}) => {
      const red = c.s === 1 || c.s === 3 || c.r >= 16;
      const rankTxt = c.r >= 16 ? (c.r === 17 ? '大' : '小') : RANK_TXT[c.r];
      const suitTxt = c.r >= 16 ? 'JOKER'.slice(0, c.r === 17 ? 5 : 3) : SUITS[c.s];
      const node = el('div.pcard' + (mini ? '.mini' : '') + (red ? '.red' : '') + (sel ? '.sel' : '') + (playable ? '.playable' : ''),
        el('div.rank', { text: rankTxt }),
        el('div.suit', { text: c.r >= 16 ? '★' : suitTxt }),
        el('div.big', { text: c.r >= 16 ? '🃏' : suitTxt }),
      );
      if (onClick) node.addEventListener('click', onClick);
      return node;
    };

    // 底牌
    if (s.bottom.length) {
      host.append(el('div.row', { style: { justifyContent: 'center', gap: '4px', margin: '8px 0' } },
        el('span.tiny.muted', { text: '底牌' }),
        ...s.bottom.map((c) => cardNode(c, {}))
      ));
    }

    // 中央：上家出的牌
    const tableArea = el('div', { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px', minHeight: '80px', alignItems: 'center', margin: '6px 0' } });
    if (s.lastPlay) {
      tableArea.append(el('div.col', { style: { alignItems: 'center', gap: '3px' } },
        el('span.tiny.muted', { text: `${ctx.seats[s.lastPlay.seat]?.name || ('座位' + s.lastPlay.seat)} 出：${TYPE_TXT[s.lastPlay.info.type]}` }),
        el('div.row', { style: { gap: '4px', flexWrap: 'wrap', justifyContent: 'center' } }, ...s.lastPlay.cards.map((c) => cardNode(c, {})))
      ));
    } else if (s.phase === 'play') {
      tableArea.append(el('span.tiny.muted', { text: '新一轮，自由出牌' }));
    }
    host.append(tableArea);

    // 自己的手牌
    const myTurn = s.turn === me && s.winner === null;
    const handWrap = el('div.scrollx', { style: { width: '100%' } });
    const handRow = el('div.hand');
    s.hands[me].forEach((c, i) => {
      const sel = ui.sel.has(i);
      handRow.append(cardNode(c, {
        sel,
        playable: myTurn,
        onClick: myTurn ? () => {
          if (ui.sel.has(i)) ui.sel.delete(i); else ui.sel.add(i);
          ctx.rerender();
        } : null,
      }));
    });
    handWrap.append(handRow);
    host.append(el('div.tiny.muted', { style: { marginTop: '4px' } },
      `你的手牌 · ${s.hands[me].length} 张${s.landlord === me ? ' · 地主' : s.landlord !== null ? ' · 农民' : ''}${ui.sel.size ? ` · 已选 ${ui.sel.size} 张` : ''}`));
    host.append(handWrap);
  },
};

export default doudizhu;