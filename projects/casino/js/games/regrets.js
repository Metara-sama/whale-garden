/* 浅滩鱼悔 · 改编自 Jeko-jike/shallow-regrets（MIT）
   本实现为该作品的「简化对战版」：保留 24 张鱼卡、钩数/强度、浅滩、污秽罚分与能力，
   把繁杂的多段式回合压成「一次判定」，方便与 AI 逐手对话。
   玩法数据来源：https://github.com/Jeko-jike/shallow-regrets
*/
import { el, shuffle } from '../core/util.js';

/* 24 张鱼卡：id / 名字 / 分值 / 所需钩数 / 提供钩数 / 类型 / 能力 */
const CARDS = [
  { id: 'lamprey', n: '七鳃鳗', p: 1, s: 0, h: 1, t: 'fair', a: 'draw_plus1' },
  { id: 'seaBishop', n: '海主教', p: 1, s: 0, h: 1, t: 'foul', a: 'shuffle_all' },
  { id: 'seaMonkey', n: '海猴', p: -2, s: 0, h: 3, t: 'foul', a: 'curse' },
  { id: 'severedFoot', n: '断脚', p: -1, s: 0, h: 2, t: 'foul', a: 'curse' },
  { id: 'eyeballBlob', n: '眼球团', p: 1, s: 0, h: 1, t: 'foul', a: 'shuffle_all' },
  { id: 'rotfish', n: '腐鱼', p: -1, s: 0, h: 2, t: 'foul', a: 'curse' },
  { id: 'dayOctopus', n: '日间章鱼', p: 1, s: 0, h: 0, t: 'fair', a: 'curse' },
  { id: 'barracuda', n: '梭子鱼', p: 0, s: 0, h: 1, t: 'fair', a: 'curse' },
  { id: 'whiptailStingray', n: '鞭尾魟鱼', p: 0, s: 0, h: 1, t: 'fair', a: 'curse' },
  { id: 'oarfish', n: '皇带鱼', p: 2, s: 1, h: 1, t: 'fair', a: 'draw_plus2' },
  { id: 'mermaid', n: '美人鱼', p: 2, s: 1, h: 1, t: 'foul', a: 'draw_plus1' },
  { id: 'snowEel', n: '雪鳗', p: 2, s: 1, h: 1, t: 'fair', a: 'draw_plus1' },
  { id: 'manOWar', n: '僧帽水母', p: 0, s: 1, h: 1, t: 'fair', a: 'curse' },
  { id: 'lionfish', n: '狮子鱼', p: 0, s: 1, h: 1, t: 'fair', a: 'curse' },
  { id: 'sealMan', n: '海豹人', p: 3, s: 2, h: 1, t: 'foul', a: 'curse' },
  { id: 'banshee', n: '女妖', p: 3, s: 2, h: 1, t: 'foul', a: 'draw_plus1' },
  { id: 'everSquid', n: '永动鱿鱼', p: 2, s: 2, h: 0, t: 'foul', a: 'curse' },
  { id: 'giantOctopus', n: '巨型章鱼', p: 2, s: 2, h: 1, t: 'fair', a: 'draw_plus1' },
  { id: 'swordfish', n: '旗鱼', p: 3, s: 3, h: 0, t: 'fair', a: 'curse' },
  { id: 'giantSquid', n: '巨型乌贼', p: 3, s: 3, h: 0, t: 'fair', a: 'curse' },
  { id: 'greatWhite', n: '大白鲨', p: 3, s: 3, h: 0, t: 'fair', a: 'draw_plus1' },
  { id: 'elderThing', n: '旧日支配者', p: 5, s: 4, h: 0, t: 'foul', a: 'curse' },
  { id: 'kelpie', n: '凯尔派', p: 4, s: 4, h: 0, t: 'foul', a: 'shuffle_all' },
  { id: 'kraken', n: '挪威海怪', p: 5, s: 5, h: 0, t: 'foul', a: null },
];

const ABILITY_TXT = {
  draw_plus1: '涨潮：本回合所需钩数 -1',
  draw_plus2: '大潮：本回合所需钩数 -2',
  shuffle_all: '搅动：重排所有浅滩',
  curse: '诅咒：让一个对手的一条鱼跑掉（分数归零）',
};

function buildShoals(mult) {
  const pool = [];
  for (let k = 0; k < mult; k++) for (const c of CARDS) pool.push({ ...c, uid: c.id + '#' + k });
  const deck = shuffle(pool);
  const shoals = [];
  while (deck.length) shoals.push(deck.splice(0, 3));
  // 每堆顶牌放这堆里最容易钓的那张，保证开局人人有事做
  return shoals.map((sh) => {
    let minIdx = 0;
    sh.forEach((c, i) => { if (c.s < sh[minIdx].s) minIdx = i; });
    const copy = sh.slice();
    const [easiest] = copy.splice(minIdx, 1);
    copy.unshift(easiest);
    return copy;
  });
}

const topOf = (shoal) => (shoal && shoal.length ? shoal[0] : null);

function scoreOf(pl) {
  let sum = 0, foul = 0;
  for (const f of pl.caught) {
    if (!f.dead) { sum += f.p; if (f.t === 'foul') foul++; }
  }
  return { sum, foul };
}

const regrets = {
  id: 'regrets',
  name: '浅滩鱼悔',
  icon: '🎣',
  desc: '钓起灰雾下的怪鱼：攒钩数、抢大鱼，别让污秽拖低你的分。',
  tags: ['多人', '卡牌', '改编'],
  players: { min: 2, max: 4, def: 3 },
  optionSpec: [
    { key: 'mult', label: '牌组倍数', type: 'num', min: 1, max: 3, step: 1, def: 1, hint: '24 张基础鱼卡，2 倍 = 48 张，浅滩更多，局势更慢更肥。' },
    { key: 'stall', label: '停滞保护', type: 'seg', def: 8, options: [{ v: 6, label: '6 回合' }, { v: 8, label: '8 回合' }, { v: 12, label: '12 回合' }] },
  ],
  rulesBrief: '浅滩每堆最多 3 张，顶牌明示。轮到你时选一个浅滩读牌：当前钩数 ≥ 这条鱼所需钩数就能钓走，得到它的分数和钩数；否则它惊走，你空手。每回合最多钓 1 条。已钓到的鱼带能力，每局各用一次：减难度、搅乱浅滩、或诅咒对手让它一条鱼跑掉。浅滩钓空或长时间无人上钩就结束，分数最高者胜；污秽鱼最多的人额外 -2 分。',

  init(opt, seatCount) {
    const mult = Math.max(1, Math.min(3, opt.mult || 1));
    const seats = seatCount || 3;
    return {
      mult, seats,
      shoals: buildShoals(mult),
      players: Array.from({ length: seats }, () => ({ hooks: 0, caught: [], bonus: 0 })),
      turn: 0, round: 1, failStreak: 0,
      stallLimit: opt.stall || 8,
      winner: null, result: null,
    };
  },

  turn(s) { return s.winner === null ? s.turn : null; },

  legal(s, seat) {
    if (s.winner !== null) return [];
    if (seat !== undefined && seat !== null && s.turn !== seat) return [];
    const pl = s.players[s.turn];
    const out = [];
    s.shoals.forEach((sh, i) => {
      const t = topOf(sh);
      if (!t) return;
      const eff = Math.max(0, t.s - pl.bonus);
      out.push({
        k: 'hook:' + i, shoal: i, tile: t,
        label: `读浅滩 ${i + 1}：${t.n}（需 ${eff} 钩 · ${t.p} 分${t.t === 'foul' ? ' · 污秽' : ''}）${pl.hooks >= eff ? ' → 能钓' : ' → 钩不够'}`,
      });
    });
    pl.caught.forEach((f, fi) => {
      if (f.dead || !f.a || f.used) return;
      if (f.a === 'curse') {
        for (let vs = 0; vs < s.seats; vs++) {
          if (vs === s.turn) continue;
          out.push({ k: `ab:${fi}:${vs}`, ability: f.a, fromIdx: fi, target: vs, label: `能力「诅咒」→ 座位 ${vs}` });
        }
      } else {
        out.push({ k: `ab:${fi}`, ability: f.a, fromIdx: fi, label: `能力「${ABILITY_TXT[f.a] || f.a}」` });
      }
    });
    out.push({ k: 'skip', skip: true, label: '这一手不钓（跳过）' });
    return out;
  },

  apply(s, a) {
    const pl = s.players[s.turn];
    const advance = () => {
      s.turn = (s.turn + 1) % s.seats;
      if (s.turn === 0) s.round++;
    };
    if (a.skip) {
      s.failStreak++;
      advance();
      this.checkEnd(s);
      return { log: '这一手没动钩' };
    }
    if (a.ability) {
      const f = pl.caught[a.fromIdx];
      if (!f || f.used) return null;
      f.used = true;
      if (a.ability === 'draw_plus1') pl.bonus += 1;
      else if (a.ability === 'draw_plus2') pl.bonus += 2;
      else if (a.ability === 'shuffle_all') {
        const all = s.shoals.flat().filter(Boolean);
        const mixed = shuffle(all);
        const sizes = s.shoals.map((x) => x.length);
        let k = 0;
        s.shoals = sizes.map((n) => mixed.slice(k, k += n));
        return { log: `${f.n} 搅动浅滩，牌全重排` };
      } else if (a.ability === 'curse') {
        const target = s.players[a.target];
        const alive = target.caught.filter((x) => !x.dead);
        if (!alive.length) return { log: '对方没有可诅咒的鱼' };
        const victim = alive[Math.floor(Math.random() * alive.length)];
        victim.dead = true;
        return { log: `${f.n} 诅咒生效：座位 ${a.target} 的${victim.n}跑掉了` };
      }
      return { log: `${f.n} 发动能力：${ABILITY_TXT[a.ability] || a.ability}` };
    }
    if (a.shoal !== undefined) {
      const sh = s.shoals[a.shoal];
      const t = topOf(sh);
      if (!t) return null;
      const eff = Math.max(0, t.s - pl.bonus);
      if (pl.hooks >= eff) {
        sh.shift();
        pl.caught.push({ ...t, used: false, dead: false });
        pl.hooks += t.h;
        pl.bonus = 0;
        s.failStreak = 0;
        advance();
        this.checkEnd(s);
        return { log: `钓到【${t.n}】${t.p >= 0 ? '+' : ''}${t.p} 分，钩数 +${t.h}（现有 ${pl.hooks}）` };
      }
      sh.push(sh.shift());
      pl.bonus = 0;
      s.failStreak++;
      advance();
      this.checkEnd(s);
      return { log: `钩数不够（需 ${eff}，你有 ${pl.hooks}），${t.n} 受惊潜回水底` };
    }
    return null;
  },

  checkEnd(s) {
    const empty = s.shoals.every((x) => x.length === 0);
    const stalled = s.failStreak >= s.stallLimit;
    if (!empty && !stalled) return;
    const scored = s.players.map((pl, i) => {
      const { sum, foul } = scoreOf(pl);
      return { seat: i, sum, foul };
    });
    const maxFoul = Math.max(...scored.map((x) => x.foul));
    const adjusted = scored.map((x) => ({ ...x, total: x.sum - (x.foul === maxFoul && maxFoul > 0 ? 2 : 0) }));
    const best = Math.max(...adjusted.map((x) => x.total));
    const winners = adjusted.filter((x) => x.total === best).map((x) => x.seat);
    s.winner = winners.length === 1 ? winners[0] : -1;
    s.result = { adjusted, best, winners, stalled, empty };
  },

  status(s) {
    if (s.winner === null) return { over: false };
    const rows = s.result.adjusted.slice().sort((a, b) => b.total - a.total).map((x) => ({
      seat: x.seat,
      text: `${x.sum} 分${x.foul ? `（污秽 ${x.foul}，-2）` : ''} → 合计 ${x.total}`,
    }));
    return {
      over: true,
      result: {
        title: s.winner === -1 ? '平局' : (s.winner === 0 ? '你赢了' : '你输了'),
        text: s.result.stalled ? '海面安静太久，大家都收竿了。' : '所有浅滩都钓空了。',
        rows,
      },
    };
  },

  view(s, seat) {
    const pl = s.players[seat];
    const lines = [
      `你在第 ${s.round} 回合，当前钩数 ${pl.hooks}${pl.bonus ? `（本回合能力加成 +${pl.bonus}）` : ''}。`,
      '浅滩情况（顶牌明示）：',
    ];
    s.shoals.forEach((sh, i) => {
      const t = topOf(sh);
      if (!t) { lines.push(`  浅滩${i + 1}：空`); return; }
      const eff = Math.max(0, t.s - pl.bonus);
      lines.push(`  浅滩${i + 1}：${t.n}（需 ${eff} 钩 / ${t.p} 分${t.t === 'foul' ? ' / 污秽' : ''}${t.h ? ' / 钓到给 ' + t.h + ' 钩' : ''}）${pl.hooks >= eff ? ' ← 你能钓' : ''}`);
    });
    const mine = pl.caught.map((f) => `${f.n}(${f.dead ? '跑掉' : f.p})`).join('、') || '无';
    lines.push(`你已钓到：${mine}`);
    const others = s.players.map((o, i) => {
      if (i === seat) return null;
      const sc = scoreOf(o);
      return `座位${i}：${sc.sum} 分，钩数 ${o.hooks}，已钓 ${o.caught.length} 条`;
    }).filter(Boolean);
    lines.push('对手：' + others.join('；'));
    const usable = pl.caught.filter((f) => f.a && !f.used && !f.dead).map((f) => `${f.n}（${ABILITY_TXT[f.a]}）`);
    if (usable.length) lines.push('可用能力：' + usable.join('、'));
    lines.push(`已经连续 ${s.failStreak} 手没人上钩（到 ${s.stallLimit} 就结束）。`);
    return lines.join('\n');
  },

  fallback(s, seat, level) {
    const pl = s.players[seat];
    const opts = [];
    s.shoals.forEach((sh, i) => {
      const t = topOf(sh);
      if (!t) return;
      const eff = Math.max(0, t.s - pl.bonus);
      opts.push({ i, t, eff, can: pl.hooks >= eff });
    });
    const can = opts.filter((o) => o.can);
    if (level <= 0) {
      if (!can.length) return { k: 'skip', skip: true };
      return { k: 'hook:' + can[0].i, shoal: can[0].i, tile: can[0].t };
    }
    if (can.length) {
      const sorted = can.slice().sort((a, b) => {
        const va = a.t.p - (a.t.t === 'foul' ? 0.8 : 0) + a.t.h * 0.45;
        const vb = b.t.p - (b.t.t === 'foul' ? 0.8 : 0) + b.t.h * 0.45;
        return vb - va;
      });
      return { k: 'hook:' + sorted[0].i, shoal: sorted[0].i, tile: sorted[0].t };
    }
    const cursor = pl.caught.findIndex((f) => f.a && !f.used && !f.dead);
    if (cursor >= 0 && level >= 2) {
      const f = pl.caught[cursor];
      if (f.a === 'curse') {
        const target = s.players.findIndex((o, i) => i !== seat && o.caught.some((x) => !x.dead));
        if (target >= 0) return { k: `ab:${cursor}:${target}`, ability: 'curse', fromIdx: cursor, target };
      } else if (f.a === 'shuffle_all' || f.a === 'draw_plus1' || f.a === 'draw_plus2') {
        return { k: `ab:${cursor}`, ability: f.a, fromIdx: cursor };
      }
    }
    return { k: 'skip', skip: true };
  },

  rankActions(s, seat, legal) {
    const val = (a) => {
      if (a.shoal === undefined) return -1;
      const t = a.tile;
      return t.p + t.h * 0.5 - (t.t === 'foul' ? 0.5 : 0);
    };
    return legal.slice().sort((a, b) => val(b) - val(a));
  },

  hint(s, seat) {
    if (s.winner !== null) return '对局结束';
    if (s.turn !== seat) return '对手正在挑浅滩…';
    const pl = s.players[seat];
    return `你的钩数 ${pl.hooks}${pl.bonus ? `(+${pl.bonus})` : ''}：点一个浅滩的顶牌读一读，钩够就能钓走`;
  },

  extraButtons(s, seat, ctx) {
    if (s.winner !== null || s.turn !== seat) return [];
    const pl = s.players[seat];
    const btns = [];
    pl.caught.forEach((f, fi) => {
      if (f.dead || !f.a || f.used) return;
      if (f.a === 'curse') {
        for (let vs = 0; vs < s.seats; vs++) {
          if (vs === seat) continue;
          btns.push(el('button.btn.sm.ghost', { onClick: () => ctx.act({ k: `ab:${fi}:${vs}`, ability: 'curse', fromIdx: fi, target: vs }) }, `${f.n} 诅咒→${vs}号位`));
        }
      } else {
        btns.push(el('button.btn.sm.ghost', { onClick: () => ctx.act({ k: `ab:${fi}`, ability: f.a, fromIdx: fi }) }, `${f.n} · ${f.a === 'shuffle_all' ? '搅动' : '涨潮'}`));
      }
    });
    btns.push(el('button.btn.sm.ghost', { onClick: () => ctx.act({ k: 'skip', skip: true }) }, '不钓（跳过）'));
    return btns;
  },

  seatInfo(s, seat) {
    const pl = s.players[seat];
    const sc = scoreOf(pl);
    return { sub: `${sc.sum} 分 · 钩 ${pl.hooks}`, badge: s.turn === seat ? '该你' : '' };
  },

  render(s, ctx) {
    const me = 0;
    const host = ctx.host;
    const pl = s.players[me];
    const myTurn = s.turn === me && s.winner === null;

    const grid = el('div.shoals');
    s.shoals.forEach((sh, i) => {
      const t = topOf(sh);
      const eff = t ? Math.max(0, t.s - pl.bonus) : 99;
      const pickable = myTurn && t && pl.hooks >= eff;
      const box = el('div.shoal' + (pickable ? '.pickable' : ''));
      box.append(el('div.shoal-h',
        el('span', { text: '浅滩 ' + (i + 1) }),
        el('span', { text: sh.length + ' 张' })
      ));
      sh.forEach((c, ci) => {
        if (ci === 0) {
          box.append(el('div.fish.revealed' + (c.t === 'foul' ? '.foul' : ''),
            el('div.fn', { text: c.n }),
            el('div.fs',
              el('span', { text: `需 ${Math.max(0, c.s - pl.bonus)} 钩` }),
              el('span', { text: `${c.p >= 0 ? '+' : ''}${c.p} 分` }),
              c.h ? el('span', { text: `+${c.h} 钩` }) : null,
            ),
            c.a ? el('div.fw', { text: '✦' }) : null,
          ));
        } else {
          box.append(el('div.fish.backface', { text: '?' }));
        }
      });
      if (!t) box.append(el('div.tiny.muted.center', { text: '空了' }));
      if (pickable) box.addEventListener('click', () => ctx.act({ k: 'hook:' + i, shoal: i, tile: t }));
      grid.append(box);
    });
    host.append(grid);

    const sc = scoreOf(pl);
    host.append(el('div', { style: { marginTop: '10px' } },
      el('div.tiny.muted', { text: `你 · ${sc.sum} 分 · 钩数 ${pl.hooks}${pl.bonus ? `(+${pl.bonus})` : ''}` }),
      el('div.caught-row', { style: { marginTop: '4px' } },
        ...pl.caught.map((f) => el('div.chip' + (!f.dead && f.t !== 'foul' ? '.on' : ''),
          { text: `${f.n} ${f.dead ? '(跑)' : f.p}${f.a && !f.used ? ' ✦' : ''}` }))
      )
    ));
    host.append(el('div.tiny.muted', { style: { marginTop: '6px' } },
      `第 ${s.round} 回合 · 连续空手 ${s.failStreak}/${s.stallLimit} 手 · 牌组 ${s.mult} 倍`));
  },
};

export default regrets;