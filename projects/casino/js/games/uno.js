/* UNO · 2-10 人 · 数字/符号/颜色匹配 · +2/+4 · 万能牌选色 */
import { el, shuffle } from '../core/util.js';

const COLORS = { r: '红', y: '黄', g: '绿', b: '蓝', w: '万能' };
const GLYPH = { skip: '⊘', rev: '⇄', d2: '+2', wild: '★', w4: '+4' };
const CLS = { r: 'r', y: 'y', g: 'g', b: 'b', w: 'w' };

function buildDeck() {
  const d = [];
  for (const c of ['r', 'y', 'g', 'b']) {
    d.push(c + '0');
    for (let n = 1; n <= 9; n++) { d.push(c + n); d.push(c + n); }
    for (const sym of ['skip', 'rev', 'd2']) { d.push(c + sym); d.push(c + sym); }
  }
  for (let i = 0; i < 4; i++) { d.push('wild'); d.push('w4'); }
  return d;
}

const colorOf = (card) => (card === 'wild' || card === 'w4' ? 'w' : card[0]);
const faceOf = (card) => (card === 'wild' ? 'wild' : card === 'w4' ? 'w4' : card.slice(1));
const isWild = (card) => card === 'wild' || card === 'w4';
const canPlayOn = (card, top, color) => isWild(card) || colorOf(card) === color || (faceOf(card) === faceOf(top) && !isWild(top));

function cardName(card) {
  if (card === 'wild') return '万能牌';
  if (card === 'w4') return '万能+4';
  const f = faceOf(card);
  return COLORS[colorOf(card)] + (GLYPH[f] || f);
}

function cardScore(card) {
  if (card === 'w4') return 50;
  if (card === 'wild') return 50;
  const f = faceOf(card);
  if (f === 'skip' || f === 'rev' || f === 'd2') return 20;
  return Number(f) || 0;
}

function reshuffle(s) {
  if (s.deck.length) return;
  const top = s.discard[s.discard.length - 1];
  const rest = s.discard.slice(0, -1);
  s.discard = [top];
  s.deck = shuffle(rest);
}

function drawCards(s, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    reshuffle(s);
    if (!s.deck.length) break;
    out.push(s.deck.pop());
  }
  return out;
}

function advance(s, steps = 1) {
  s.turn = (s.turn + s.dir * steps + s.seats * 10) % s.seats;
}

const uno = {
  id: 'uno',
  name: 'UNO',
  icon: '🃏',
  desc: '2 到 10 人都能开，每人一张角色卡，各骂各的。',
  tags: ['多人', '卡牌'],
  players: { min: 2, max: 10, def: 4 },
  optionSpec: [
    { key: 'stacking', label: '+2/+4 累积', type: 'switch', def: false, hint: '开启后被 +2 的人可以再打 +2 叠上去，一家全吃。' },
    { key: 'drawTo', label: '摸牌规则', type: 'seg', def: 1, options: [{ v: 1, label: '摸一张' }, { v: 3, label: '摸三张' }] },
  ],
  rulesBrief: '手牌与弃牌堆顶「同色或同数字/符号」即可打出。万能牌可随时打出并指定颜色；+2 让下家摸 2 张并跳过，万能+4 让下家摸 4 张并跳过。没有能出的牌就摸牌，摸到能出可以出，否则过。先出完手牌者胜。',

  init(opt, seatCount) {
    const seats = seatCount || 4;
    let deck = shuffle(buildDeck());
    const hands = Array.from({ length: seats }, () => []);
    for (let r = 0; r < 7; r++) for (let p = 0; p < seats; p++) hands[p].push(deck.pop());
    let top = deck.pop();
    while (top === 'w4' || top === 'wild') { deck.unshift(top); top = deck.pop(); }
    return {
      seats, hands, deck, discard: [top],
      color: colorOf(top), turn: Math.floor(Math.random() * seats), dir: 1,
      pending: null, winner: null, scores: null,
      stacking: !!opt.stacking, drawTo: opt.drawTo || 1,
      pendingDraw: 0, log: [],
    };
  },

  turn(s) { return s.winner === null ? s.turn : null; },

  legal(s, seat) {
    if (s.winner !== null) return [];
    if (seat !== undefined && seat !== null && s.turn !== seat) return [];
    const top = s.discard[s.discard.length - 1];
    const hand = s.hands[s.turn];
    const out = [];
    if (s.pending && s.pending.seat === s.turn) {
      // 刚摸完牌：只能出这一张或过
      const c = s.pending.card;
      if (canPlayOn(c, top, s.color)) {
        if (isWild(c)) for (const col of ['r', 'y', 'g', 'b']) out.push({ k: 'p' + c + col, card: c, color: col, label: `打出 ${cardName(c)} → 指定${COLORS[col]}` });
        else out.push({ k: 'p' + c, card: c, label: `打出刚摸到的 ${cardName(c)}` });
      }
      out.push({ k: 'pass', label: '过（不出）', pass: true });
      return out;
    }
    hand.forEach((c, i) => {
      if (!canPlayOn(c, top, s.color)) return;
      if (isWild(c)) {
        for (const col of ['r', 'y', 'g', 'b']) {
          out.push({ k: `p${i}${col}`, card: c, idx: i, color: col, label: `打出 ${cardName(c)} → 指定${COLORS[col]}` });
        }
      } else {
        out.push({ k: 'p' + i, card: c, idx: i, label: `打出 ${cardName(c)}` });
      }
    });
    out.push({ k: 'draw', label: '摸牌', draw: true });
    return out;
  },

  apply(s, a) {
    if (s.pending && s.pending.seat === s.turn) {
      if (a.pass || a.draw) {
        s.pending = null;
        advance(s);
        return { log: '不出，过' };
      }
    }
    if (a.draw) {
      const got = drawCards(s, s.drawTo);
      s.hands[s.turn].push(...got);
      if (s.drawTo > 1) { advance(s); s.pending = null; return { log: `摸 ${got.length} 张` }; }
      const c = got[0];
      const top = s.discard[s.discard.length - 1];
      if (c && canPlayOn(c, top, s.color)) {
        s.pending = { seat: s.turn, card: c };
        return { log: '摸了一张，能出' };
      }
      advance(s);
      return { log: '摸一张，出不了，过' };
    }
    // 出牌
    const hand = s.hands[s.turn];
    let idx = a.idx;
    if (idx === undefined) idx = hand.indexOf(a.card);
    if (idx < 0 || idx >= hand.length) return null;
    const card = hand[idx];
    if (!canPlayOn(card, s.discard[s.discard.length - 1], s.color)) return null;
    hand.splice(idx, 1);
    s.discard.push(card);
    s.pending = null;
    const who = s.turn;
    s.color = isWild(card) ? (a.color || 'r') : colorOf(card);
    const logs = [`${cardName(card)}${isWild(card) ? '（指定' + COLORS[s.color] + '）' : ''}`];
    if (card === 'w4' || card === 'd2' || (a.card === 'w4')) {
      // 罚牌：看牌面
    }
    const f = faceOf(card);
    if (f === 'skip') { advance(s, 2); logs.push('下家被跳过'); }
    else if (f === 'rev') {
      if (s.seats === 2) { advance(s, 2); logs.push('两人局，反转等于跳过'); }
      else { s.dir *= -1; advance(s); logs.push('方向反转'); }
    } else if (f === 'd2' || card === 'w4') {
      const n = card === 'w4' ? 4 : 2;
      const victimIdx = (s.turn + s.dir + s.seats * 10) % s.seats;
      const got = drawCards(s, n);
      s.hands[victimIdx].push(...got);
      advance(s, 2);
      logs.push(`下家摸 ${n} 张并跳过`);
    } else {
      advance(s);
    }
    if (s.hands[who].length === 0) {
      s.winner = who;
      s.scores = s.hands.map((h, i) => (i === who ? 0 : h.reduce((x, c) => x + cardScore(c), 0)));
      logs.push('出完了！');
    }
    return { log: logs };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    const rows = s.hands.map((h, i) => ({ seat: i, text: `${h.length} 张${i === s.winner ? ' · 胜' : ` · 剩 ${s.scores[i]} 分`}` }))
      .sort((a, b) => (a.seat === s.winner ? -1 : b.seat === s.winner ? 1 : 0));
    return {
      over: true,
      result: {
        title: s.winner === 0 ? '你赢了' : `${'座位' + s.winner}赢了`,
        text: s.winner === 0 ? '手牌清空，这局归你。' : '有人先出完了手牌。',
        rows,
      },
    };
  },

  view(s, seat) {
    const hand = s.hands[seat];
    const top = s.discard[s.discard.length - 1];
    const others = s.hands.map((h, i) => (i === seat ? null : `${i}号位 ${h.length} 张`)).filter(Boolean).join('，');
    return [
      `你是 ${seat} 号位。当前指定颜色：${COLORS[s.color]}；弃牌堆顶：${cardName(top)}；出牌方向：${s.dir === 1 ? '顺时针' : '逆时针'}。`,
      `其他玩家手牌数：${others}`,
      `你的手牌（${hand.length} 张）：${hand.map(cardName).join('、')}`,
      '这是你打的第几手不重要，重要的是先出完手牌。',
    ].join('\n');
  },

  fallback(s, seat, level) {
    const legal = this.legal(s, seat);
    if (!legal.length) return null;
    const plays = legal.filter((a) => !a.draw && !a.pass);
    const top = s.discard[s.discard.length - 1];
    const hand = s.hands[seat];
    if (!plays.length) return legal.find((a) => a.draw) || legal[0];
    if (level <= 0) return plays[Math.floor(Math.random() * plays.length)];
    // 有非万能牌就出非万能牌，优先出符号牌搞别人
    const plain = plays.filter((a) => !isWild(a.card));
    if (plain.length) {
      const pick = plain.slice().sort((a, b) => {
        const score = (x) => {
          const f = faceOf(x.card);
          let v = 0;
          if (f === 'd2') v += 8;
          if (f === 'skip' || f === 'rev') v += 5;
          v += cardScore(x.card) / 10;
          // 手里同色牌多就继续这个颜色
          v += hand.filter((c) => colorOf(c) === colorOf(x.card)).length * 0.6;
          return v;
        };
        return score(b) - score(a);
      })[0];
      return pick;
    }
    // 只剩万能牌
    const counts = ['r', 'y', 'g', 'b'].map((c) => ({ c, n: hand.filter((x) => colorOf(x) === c).length })).sort((a, b) => b.n - a.n);
    const best = counts[0].c;
    return plays.find((a) => a.color === best) || plays[0];
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    if (s.turn !== seat) return '等对手出牌…';
    if (s.pending && s.pending.seat === seat) return '你刚摸到一张能出的牌：出它，或者过';
    return `该你出牌（当前颜色 ${COLORS[s.color]}）`;
  },

  seatInfo(s, seat) {
    return { sub: `${s.hands[seat].length} 张`, badge: s.turn === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const me = 0;
    const host = ctx.host;
    const top = s.discard[s.discard.length - 1];

    const cardNode = (card, { mini = false, sel = false, playable = false, onClick } = {}) => {
      const c = CLS[colorOf(card)];
      const f = faceOf(card);
      const glyph = isWild(card) ? (card === 'w4' ? '+4' : '★') : (GLYPH[f] || f);
      const corner = isWild(card) ? 'W' : (GLYPH[f] || f);
      const node = el('div.ucard.' + c + (mini ? '.mini' : '') + (sel ? '.sel' : '') + (playable ? '.playable' : ''),
        el('div.oval'),
        el('div.cnr.a', { text: corner }),
        el('div.glyph', { text: glyph }),
        el('div.cnr.b', { text: corner }),
      );
      if (onClick) node.addEventListener('click', onClick);
      return node;
    };

    // 顶部：牌局信息
    host.append(el('div.row.wrap', { style: { justifyContent: 'center', gap: '14px', padding: '4px 0 8px' } },
      el('div.chip', { text: '指定颜色 ' + COLORS[s.color] }),
      el('div.chip', { text: '牌堆剩 ' + s.deck.length }),
      el('div.chip', { text: s.dir === 1 ? '顺时针 →' : '← 逆时针' }),
      s.stacking ? el('div.chip.on', { text: '+2/+4 可叠' }) : null,
    ));

    // 中央：牌堆 + 弃牌
    const center = el('div.row', { style: { justifyContent: 'center', alignItems: 'center', gap: '16px', margin: '6px 0 14px' } });
    const deckNode = cardNode(s.deck[s.deck.length - 1] || 'wild', { mini: false });
    deckNode.style.filter = 'brightness(.7)';
    const drawable = s.turn === me && s.winner === null && !(s.pending && s.pending.seat === me);
    if (drawable) {
      deckNode.classList.add('playable');
      deckNode.addEventListener('click', () => ctx.act({ k: 'draw', draw: true }));
    }
    center.append(el('div.col', { style: { alignItems: 'center', gap: '4px' } }, deckNode, el('span.tiny.muted', { text: '摸牌' })));
    const topNode = cardNode(top, {});
    topNode.style.transform = 'rotate(-3deg)';
    topNode.style.width = '58px';
    topNode.style.height = '84px';
    center.append(el('div.col', { style: { alignItems: 'center', gap: '4px' } }, topNode, el('span.tiny.muted', { text: '弃牌堆顶' })));
    host.append(center);

    // 自己的手牌
    const myHand = s.hands[me];
    const legalNow = (s.turn === me && s.winner === null) ? this.legal(s, me) : [];
    const playableCards = new Set(legalNow.filter((a) => !a.draw && !a.pass).map((a) => a.idx !== undefined ? a.idx : myHand.indexOf(a.card)));
    const handWrap = el('div.scrollx', { style: { width: '100%' } });
    const handRow = el('div.uno-hand');
    myHand.forEach((card, i) => {
      const canP = playableCards.has(i);
      const node = cardNode(card, {
        playable: canP,
        onClick: canP ? () => {
          if (isWild(card)) askColor(card, i);
          else ctx.act({ k: 'p' + i, card, idx: i });
        } : null,
      });
      if (!canP && s.turn === me && s.winner === null) node.classList.add('dim');
      handRow.append(node);
    });
    handWrap.append(handRow);
    host.append(el('div.tiny.muted', { style: { marginTop: '6px' } }, `你的手牌 · ${myHand.length} 张`));
    host.append(handWrap);

    function askColor(card, idx) {
      const scrim = document.createElement('div');
      scrim.className = 'modal-scrim';
      scrim.style.zIndex = 80;
      const box = document.createElement('div');
      box.className = 'modal';
      box.style.width = 'auto';
      box.append(el('h3', { text: '指定颜色' }));
      const row = el('div.row');
      for (const c of ['r', 'y', 'g', 'b']) {
        const b = el('button.btn', { text: COLORS[c] });
        b.style.background = { r: 'linear-gradient(160deg,#ff6b6b,#c92a3c)', y: 'linear-gradient(160deg,#ffd166,#e0a01a)', g: 'linear-gradient(160deg,#63d98a,#1f9e57)', b: 'linear-gradient(160deg,#5bb3ea,#1c5f9e)' }[c];
        b.style.color = '#fff';
        b.addEventListener('click', () => {
          scrim.remove();
          ctx.act({ k: `p${idx}${c}`, card, idx, color: c });
        });
        row.append(b);
      }
      box.append(row);
      scrim.append(box);
      document.getElementById('modalRoot').append(scrim);
      requestAnimationFrame(() => scrim.classList.add('on'));
      scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
    }
  },

  extraButtons(s, seat, ctx) {
    if (s.winner !== null) return [];
    const btns = [];
    if (s.pending && s.pending.seat === seat) {
      btns.push(el('button.btn.sm', { onClick: () => ctx.act({ k: 'pass', pass: true }) }, '过'));
    }
    return btns;
  },
};

export default uno;