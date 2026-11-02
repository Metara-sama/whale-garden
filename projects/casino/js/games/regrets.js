/* 浅滩鱼悔 · 对战适配层
 *
 * 规则层（cards / gameState / rules / stateMachine / abilities / scoring / heuristicAI）
 * 原样来自开源实现 Jeko-jike/shallow-regrets（MIT），只做了「多副牌组」实例化适配。
 * 本文件只负责：把 core 的状态机接到赛博棋牌室的通用对局外壳上，
 * 以及给 LLM 提供合法动作清单、给玩家提供交互界面。
 */
import { el } from '../core/util.js';
import { createInitialState, getHooks, getPower, CARDS_PER_SHOAL } from './regrets-core/gameState.js';
import { applyAction, validateAction, ACTION, PHASE } from './regrets-core/stateMachine.js';
import {
  canCatch, getCatchableDrawn, getDrawableShoals, getLegalThrowTargets,
  getRequiredDrawCount, getCatchLimit,
} from './regrets-core/rules.js';
import { CARD_BY_ID, baseIdOf, isExpansionCard } from './regrets-core/cards.js';
import { ABILITIES, ABILITY_TYPES, autoResolution } from './regrets-core/abilities.js';
import { getResults, getRawScore, getFoulCount, getPlayerScore } from './regrets-core/scoring.js';
import { chooseAction } from './regrets-core/heuristicAI.js';
import { chooseScriptAction, TARGETS, SCRIPT_NAME } from './regrets-core/soloScript.js';

const T = ABILITY_TYPES;
const card = (id) => CARD_BY_ID[id] || { name: '?', points: 0, strength: 0, hooks: 0, type: 'fair', ability: null };

/* 浅滩顶牌只露「需求档位」，不露具体数字（原版卡背就是给区间提示） */
const tierLabel = (st) => (st <= 0 ? '0' : st <= 2 ? '1–2' : '3–5');
const tierRange = (st) => (st <= 0 ? [0, 0] : st <= 2 ? [1, 2] : [3, 5]);

/* ---------------- 小工具 ---------------- */
function replaceState(target, src) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, src);
}

/** pending 窗口该由谁做决定（原实现未指定，这里按"最相关的人"定，保持确定） */
function pendingActor(s) {
  const p = s.pending;
  if (!p) return s.currentPlayer;
  if (p.type === 'REDIRECT') return p.candidates[0] ?? s.currentPlayer;
  if (p.type === 'COUNTER') return p.counterP ?? s.currentPlayer;
  if (p.type === 'REARRANGE') return p.owner ?? s.currentPlayer;
  if (p.type === 'PASS_LEFT') return p.playerIndices[p.current] ?? s.currentPlayer;
  return s.currentPlayer;
}

const fishName = (id) => card(id).name;

const SHORT_ABILITY = {
  draw_plus2: '+2抽', draw_plus1: '+1抽', power_plus3: '+3力量', reveal_all: '翻顶牌',
  shuffle_all: '洗牌', snow_guard: '护体', pass_left: '传鱼',
  exhaust_foul: '横置污秽', exhaust_fair: '横置正品', exhaust_any: '横置',
  swap_any: '换鱼', swap_fair: '换正品', swap_zero: '换难度0',
  give_card: '送鱼', peek_multi: '偷看', remove_zero: '移除难度0', rearrange_shoal: '重排鱼群',
};
/* 需要「点对方一条鱼」的能力：直接告诉他点哪，不用先选人 */
const OPP_HINT = {
  swap_any: '点一张对方的鱼，和它交换',
  swap_fair: '点一张对方的正品鱼，和它交换',
  swap_zero: '点一张对方难度 0 的鱼，和它交换',
  exhaust_foul: '点一条对方的污秽鱼，把它横置',
  exhaust_fair: '点一条对方的正品鱼，把它横置',
  exhaust_any: '点一条对方的鱼，把它横置',
  remove_zero: '点一条难度 0 的鱼，把它移除',
};

function abilityLabel(key, target, s) {
  if (!target) return ABILITIES[key]?.desc || key;
  if (target.shoalIndexes) return `查看 ${target.shoalIndexes.map((i) => i + 1).join('、')} 号浅滩`;
  if (target.shoalIndex !== undefined && target.cardIndex === undefined) return `重排 ${target.shoalIndex + 1} 号浅滩`;
  if (target.cardIndex !== undefined) return `移除 ${target.shoalIndex + 1} 号浅滩第 ${target.cardIndex + 1} 张`;
  if (target.cardId && target.playerIndex !== undefined) {
    return `目标：${s.players[target.playerIndex]?.name ?? target.playerIndex} 的【${fishName(target.cardId)}】`;
  }
  if (target.oppCardId && target.playerIndex !== undefined) {
    return `换走 ${s.players[target.playerIndex]?.name ?? target.playerIndex} 的【${fishName(target.oppCardId)}】`;
  }
  if (target.playerIndex !== undefined) return `目标：${s.players[target.playerIndex]?.name ?? target.playerIndex}`;
  return ABILITIES[key]?.desc || key;
}

function describeAction(a, s) {
  switch (a.type) {
    case ACTION.USE_ABILITY: {
      const c = card(a.cardId);
      return `发动【${c.name}】：${ABILITY_LABEL_CACHE.get(a) || ABILITIES[c.ability]?.desc || ''}`;
    }
    case ACTION.PASS_ABILITIES: return '结束能力阶段，进入抽牌';
    case ACTION.DRAW: return `从 ${a.from.map((i) => i + 1).join('、')} 号浅滩抽 ${a.from.length} 张`;
    case ACTION.CATCH: return `钓走【${fishName(a.cardId)}】`;
    case ACTION.THROW_BACK: return `把【${fishName(a.cardId)}】放回 ${a.shoalIndex + 1} 号浅滩`;
    case ACTION.RESOLVE: {
      const p = s.pending;
      if (!p) return '结算';
      if (p.type === 'REDIRECT') return a.resolution?.use ? '女妖改向' : '不改向';
      if (p.type === 'COUNTER') return a.resolution?.use ? '僧帽水母反击' : '不反击';
      if (p.type === 'REARRANGE') return '重排鱼群';
      if (p.type === 'PASS_LEFT') return a.resolution?.pick ? `把【${fishName(a.resolution.pick)}】传给左边` : '跳过传鱼';
      return '结算';
    }
    default: return '动作';
  }
}
const ABILITY_LABEL_CACHE = new WeakMap();

/* ---------------- 合法动作枚举 ---------------- */
function abilityActions(s, meIdx) {
  const me = s.players[meIdx];
  const out = [];
  const ready = me.caught.filter((id) => !me.exhausted.includes(id) && card(id).ability
    && ABILITIES[card(id).ability]?.kind === 'active');

  for (const cardId of ready) {
    const key = card(cardId).ability;
    const push = (target) => {
      const a = { type: ACTION.USE_ABILITY, cardId, ...(target ? { target } : {}) };
      if (validateAction(s, a)) return;
      const label = `${card(cardId).name}｜${abilityLabel(key, target, s)}`;
      ABILITY_LABEL_CACHE.set(a, label);
      out.push({ ...a, k: 'use:' + cardId + ':' + (target ? JSON.stringify(target) : '-'), label });
    };
    switch (key) {
      case T.DRAW_PLUS1: case T.DRAW_PLUS2: case T.POWER_PLUS3:
      case T.REVEAL_ALL: case T.SHUFFLE_ALL: case T.SNOW_GUARD: case T.PASS_LEFT:
        push(null);
        break;
      case T.EXHAUST_FOUL: case T.EXHAUST_FAIR: case T.EXHAUST_ANY:
      case T.SWAP_ANY: case T.SWAP_FAIR: case T.SWAP_ZERO: {
        const swap = key === T.SWAP_ANY || key === T.SWAP_FAIR || key === T.SWAP_ZERO;
        s.players.forEach((p, oi) => {
          if (oi === meIdx) return;
          p.caught.forEach((id) => {
            push(swap ? { playerIndex: oi, oppCardId: id } : { playerIndex: oi, cardId: id });
          });
        });
        break;
      }
      case T.GIVE_CARD:
        s.players.forEach((p, oi) => { if (oi !== meIdx) push({ playerIndex: oi }); });
        break;
      case T.PEEK_MULTI: {
        const nonEmpty = getDrawableShoals(s);
        nonEmpty.forEach((i) => push({ shoalIndexes: [i] }));
        if (nonEmpty.length >= 2) push({ shoalIndexes: nonEmpty.slice(0, Math.min(3, nonEmpty.length)) });
        break;
      }
      case T.REARRANGE_SHOAL:
        getDrawableShoals(s).forEach((i) => push({ shoalIndex: i }));
        break;
      case T.REMOVE_ZERO: {
        s.shoals.forEach((sh, si) => {
          sh.forEach((id, ci) => {
            if (card(id).strength === 0) push({ shoalIndex: si, cardIndex: ci });
          });
        });
        s.players.forEach((p, oi) => {
          if (oi === meIdx) return;
          p.caught.forEach((id) => { if (card(id).strength === 0) push({ playerIndex: oi, cardId: id }); });
        });
        break;
      }
      default: break;
    }
  }
  out.push({ type: ACTION.PASS_ABILITIES, k: 'pass_abilities', label: '结束能力阶段，进入抽牌' });
  return out;
}

function drawActions(s) {
  const required = getRequiredDrawCount(s);
  const drawable = getDrawableShoals(s);
  if (!drawable.length) return [];
  const out = [];
  const seen = new Set();
  const add = (from) => {
    const k = from.join(',');
    if (seen.has(k)) return;
    const a = { type: ACTION.DRAW, from };
    if (validateAction(s, a)) return;
    seen.add(k);
    out.push({ ...a, k: 'draw:' + k, label: `从 ${from.map((i) => i + 1).join(' + ')} 号浅滩抽牌` });
  };
  const K = required;
  if (K <= 1) { drawable.forEach((i) => add([i])); return out; }

  // ① 同一堆挖到底（能翻出次顶牌）
  drawable.forEach((i) => add(new Array(K).fill(i)));

  // ② 规模可控时枚举「可重复组合」（n 选 K 可重复）
  let approx = 1;
  for (let i = 1; i <= K; i++) approx = (approx * (drawable.length + i - 1)) / i;
  if (approx <= 240) {
    const rec = (start, depth, acc) => {
      if (out.length >= 240) return;
      if (depth === K) { add(acc.slice()); return; }
      for (let x = start; x < drawable.length; x++) {
        acc.push(drawable[x]);
        rec(x, depth + 1, acc);
        acc.pop();
      }
    };
    rec(0, 0, []);
  } else {
    // ③ 规模太大（如 3 副 + 额外抽牌）：滑动窗口的「不同堆各抽一张」+ 前 6 堆内的不重复组合
    for (let i = 0; i + K <= drawable.length; i++) add(drawable.slice(i, i + K));
    const head = drawable.slice(0, Math.max(K, 6));
    const rec = (start, depth, acc) => {
      if (depth === K) { add(acc.slice()); return; }
      for (let x = start; x < head.length; x++) {
        acc.push(head[x]);
        rec(x + 1, depth + 1, acc);
        acc.pop();
      }
    };
    if (head.length >= K) rec(0, 0, []);
  }
  return out.slice(0, 160);
}

function catchActions(s) {
  const out = [];
  const limit = getCatchLimit(s);
  if (s.caughtThisTurn < limit) {
    getCatchableDrawn(s).forEach((id) => {
      const a = { type: ACTION.CATCH, cardId: id };
      if (!validateAction(s, a)) out.push({ ...a, k: 'catch:' + id, label: `钓走【${fishName(id)}】` });
    });
  }
  const targets = getLegalThrowTargets(s);
  s.drawn.forEach((id, di) => {
    targets.forEach((ti) => {
      const a = { type: ACTION.THROW_BACK, cardId: id, shoalIndex: ti };
      if (!validateAction(s, a)) out.push({ ...a, k: `throw:${id}:${ti}:${di}`, label: `放回【${fishName(id)}】到 ${ti + 1} 号浅滩` });
    });
  });
  return out;
}

function pendingActions(s) {
  const p = s.pending;
  if (!p) return [];
  const out = [];
  const push = (resolution, label, k) => {
    const a = { type: ACTION.RESOLVE, resolution, k };
    if (!validateAction(s, a)) out.push({ ...a, label });
  };
  if (p.type === 'REDIRECT') {
    push({ use: false }, '不改向（保护原目标）', 'resolve:no');
    p.candidates.forEach((ci, k) => push({ use: true, candidateIdx: k }, `用 ${s.players[ci].name} 的女妖替它挡下`, 'resolve:' + ci));
  } else if (p.type === 'COUNTER') {
    push({ use: false }, '不反击', 'resolve:no');
    p.counterTargets.forEach((id) => push({ use: true, cardId: id }, `反击：横置对方【${fishName(id)}】`, 'resolve:' + id));
  } else if (p.type === 'REARRANGE') {
    const cards = (s.shoals[p.shoalIndex] || []).slice();
    push({ order: cards }, '保持原顺序', 'resolve:keep');
    push({ order: cards.slice().sort((a, b) => card(b).points - card(a).points) }, '高分置顶', 'resolve:high');
    push({ order: cards.slice().sort((a, b) => card(a).points - card(b).points) }, '低分置顶', 'resolve:low');
  } else if (p.type === 'PASS_LEFT') {
    const fromIdx = p.playerIndices[p.current];
    (s.players[fromIdx]?.caught || []).forEach((id) => push({ pick: id }, `把【${fishName(id)}】传出去`, 'resolve:' + id));
    push({ pick: null }, '跳过（不传）', 'resolve:null');
  }
  return out;
}

/* ---------------- 游戏模块 ---------------- */
const regrets = {
  id: 'regrets',
  name: '浅滩鱼悔',
  icon: '🎣',
  desc: '钓起灰雾下的怪鱼：攒钩数、抢大鱼，三段回合与反应窗口全按原规则。',
  tags: ['多人', '卡牌', '开源规则'],
  players: { min: 2, max: 4, def: 3 },
  optionSpec: [
    {
      key: 'mult', label: '牌组倍数', type: 'seg', def: 1,
      options: [{ v: 1, label: '1 副' }, { v: 2, label: '2 副' }, { v: 3, label: '3 副' }],
      hint: '每副牌按下面「牌池」算：基础 18 张，或含拓展 24 张。',
    },
    {
      key: 'pool', label: '牌池', type: 'seg', def: 'all',
      options: [{ v: 'all', label: '24 张（含 Lingering Remorse）' }, { v: 'base', label: '基础 18 张' }],
      hint: '官方拓展《Lingering Remorse》加了 6 条带「永续效果」的鱼（海猴、女妖、僧帽水母、狮子鱼、巨型乌贼、旧日支配者）。基础 18 张 → 6 堆 × 3 张；含拓展 24 张 → 6 堆 × 4 张（4 人局也是 6 堆）。',
    },
    {
      key: 'opponent', label: '对手', type: 'seg', def: 'ai',
      options: [{ v: 'ai', label: 'AI 角色卡' }, { v: 'frod', label: 'Frod（官方单人拓展）' }],
      hint: 'Frod 来自官方 6 张卡单人拓展《The Fisher & The Frod》：固定剧本、不烧 token、按星级评价。选它自动变 1v1。',
    },
  ],
  rulesBrief: '每回合三段：①能力阶段——可逐个发动自己已钓到的主动能力鱼（整局各一次，发动后横置）；②抽牌——从任意浅滩一共抽 2 张（可同一堆抽两次，能挖到次顶牌）；③钓走/放回——力量（已钓鱼钩数之和）≥ 目标难度就能钓走，每回合最多钓 1 条；有能钓的牌必须先钓走，其余放回。放回可以放进六个牌堆里任何一堆非空的堆（不管这堆多满）。浅滩顶牌只露需求档位（0 / 1–2 / 3–5），看不出具体是哪条鱼。他人以你的鱼为目标可能触发女妖改向、僧帽反击。全部鱼钓光、或连续一整轮没人钓到鱼、或没人能钓任何可接触的鱼时终局。计分=钓获分值之和，污秽鱼最多者额外 -2。',

  init(opt, seatCount) {
    const mult = Math.max(1, Math.min(3, opt.mult || 1));
    const frod = opt.opponent === 'frod';
    const n = frod ? 2 : Math.max(2, Math.min(4, seatCount || 3));
    // 官方：4 人局必须加入《Lingering Remorse》（6 张拓展鱼，浅滩改为 8 堆）
    const includeExpansion = n >= 4 ? true : opt.pool !== 'base';
    const state = createInitialState({
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
      playerNames: frod ? ['你', SCRIPT_NAME] : Array.from({ length: n }, (_, i) => (i === 0 ? '你' : `座位${i + 1}`)),
      mult,
      includeExpansion,
    });
    state.mult = mult;
    state.pool = includeExpansion ? 'all' : 'base';
    state.opponent = frod ? 'frod' : 'ai';
    state.frodSeat = frod ? 1 : null;
    return state;
  },
  /** 对手选项决定人数：Frod 拓展固定 1v1 */
  seatCountFor(options) {
    return options?.opponent === 'frod' ? 2 : null;
  },

  /** 开局设置里固定座位（Frod 不用选角色卡） */
  fixedSeat(seatIdx, options) {
    if (options?.opponent === 'frod' && seatIdx === 1) {
      return { name: 'Frod', avatar: '🐸', personaId: 'p_frod', sub: '脚本对手 · 官方 6 张卡拓展' };
    }
    return null;
  },

  /** 脚本对手（Frod）：确定性剧本，不走 LLM */
  scriptAction(s, seat) {
    if (s.opponent !== 'frod' || seat !== s.frodSeat) return null;
    if (s.phase === PHASE.PENDING) {
      return pendingActor(s) === seat ? { type: ACTION.RESOLVE, resolution: autoResolution(s) } : null;
    }
    if (s.currentPlayer !== seat) return null;
    const a = chooseScriptAction(s);
    return a || null;
  },

  /** Frod 的台词（本地，不烧 token） */
  scriptLine(s, seat) {
    if (s.opponent !== 'frod' || seat !== s.frodSeat) return '';
    if (Math.random() > 0.45) return '';
    const lines = ['Blup.', 'Blupp blup.', 'Blup blup blup.', '……Blup。', 'Blup!', 'Blupp……blup。', 'Blup？'];
    return lines[Math.floor(Math.random() * lines.length)];
  },

  turn(s) {
    if (s.phase === PHASE.GAME_OVER || s.gameOver) return null;
    if (s.phase === PHASE.PENDING) return pendingActor(s);
    return s.currentPlayer;
  },

  legal(s, seat) {
    if (s.phase === PHASE.GAME_OVER || s.gameOver) return [];
    const actor = this.turn(s);
    if (seat !== undefined && seat !== null && seat !== actor) return [];
    if (s.phase === PHASE.PENDING) return pendingActions(s);
    if (s.phase === PHASE.ABILITY) return abilityActions(s, s.currentPlayer);
    if (s.phase === PHASE.DRAW) return drawActions(s);
    if (s.phase === PHASE.CATCH) return catchActions(s);
    return [];
  },

  apply(s, a) {
    const text = describeAction(a, s);
    const actor = s.currentPlayer;
    const prevCaught = s.players.map((p) => p.caught.slice());
    const r = applyAction(s, a);
    if (r.error) return { log: '✗ ' + r.error };
    replaceState(s, r.state);

    // 记录每条鱼的来路：钓到 / 交换 / 赠予 / 传递（用来解释"力量不够却拿着大鱼"）
    const abilityKey = a.type === ACTION.USE_ABILITY ? card(a.cardId).ability : null;
    const label = a.type === ACTION.CATCH ? 'catch'
      : a.type === ACTION.RESOLVE ? 'pass'
        : abilityKey === 'give_card' ? 'give'
          : (abilityKey && String(abilityKey).startsWith('swap')) ? 'swap'
            : 'other';
    if (!s.acq) s.acq = {};
    s.players.forEach((p, pi) => {
      const before = prevCaught[pi] || [];
      p.caught.forEach((id) => {
        if (before.includes(id)) return;
        s.acq[id] = label;
      });
    });

    const logs = [text];
    if (a.type === ACTION.CATCH && actor != null && s.players[actor]) {
      logs.push(`力量 → ${getPower(s, actor)}`);
    }
    if (r.events?.includes('game_over')) logs.push('对局结束，开始结算');
    if (s.pending?.type === 'PASS_LEFT') {
      const who = s.players[s.pending.playerIndices[s.pending.current]]?.name;
      if (who) logs.push(`${who} 要选一条鱼传给左边`);
    }
    return { log: logs };
  },

  status(s) {
    if (!s.gameOver) return { over: false };
    const scoring = getResults(s);
    const results = scoring.map((r) => ({
      seat: r.playerIndex,
      score: r.score,
      raw: r.caught.reduce((x, c) => x + c.points, 0),
      foul: r.foulCount,
      count: r.caught.length,
    })).sort((a, b) => b.score - a.score);
    const top = results[0].score;
    const winners = results.filter((r) => r.score === top).map((r) => r.seat);
    const iWin = winners.includes(0);

    // 单人拓展《The Fisher & The Frod》：4 项特色目标 + 星级评价（RULES 11.6）
    let extra = '';
    if (s.opponent === 'frod') {
      const me = s.players[0];
      const myScore = getPlayerScore(s, 0);
      const scriptScore = getPlayerScore(s, s.frodSeat);
      const owned = me.caught.map((id) => baseIdOf(id));
      const grabbed = owned.filter((id) => TARGETS.includes(id)).length;
      const foul = getFoulCount(s, 0);
      const goals = [
        { t: '总分高于 Frod', ok: myScore > scriptScore, d: `${myScore} vs ${scriptScore}` },
        { t: '钓到挪威海怪', ok: owned.includes('kraken'), d: '' },
        { t: '全程没碰污秽鱼', ok: foul === 0, d: foul ? `污秽 ${foul}` : '' },
        { t: '抢到 ≥3 条 Frod 的目标鱼', ok: grabbed >= 3, d: `${grabbed}/3` },
      ];
      const stars = goals.filter((g) => g.ok).length;
      const rank = stars <= 1 ? '浅滩之耻' : stars === 2 ? '勉强及格' : stars === 3 ? '合格渔夫' : '深海传奇';
      extra = `　拓展评价：${rank}（${stars}/4 星）— ` + goals.map((g) => `${g.ok ? '✓' : '✗'}${g.t}${g.d ? ' ' + g.d : ''}`).join('；');
    }

    return {
      over: true,
      result: {
        title: winners.length > 1 ? '平局' : (iWin ? '你赢了' : '你输了'),
        text: (winners.length > 1 ? `并列最高 ${top} 分。` : `${winners[0] === 0 ? '你' : s.players[winners[0]].name} 以 ${top} 分收竿。`) + extra,
        rows: results.map((r) => ({
          seat: r.seat,
          text: `${r.raw} 分${r.foul ? `（污秽 ${r.foul}，-2）` : ''} → ${r.score} 分 · ${r.count} 条`,
        })),
      },
    };
  },

  view(s, seat) {
    const me = s.players[seat];
    const phaseName = { ability: '能力阶段', draw: '抽牌', catch: '钓走/放回', pending: '反应窗口', gameOver: '终局' }[s.phase] || s.phase;
    const lines = [];
    lines.push(`【浅滩鱼悔】你是 ${me.name}。第 ${s.turn} 轮，现在是「${phaseName}」。`);
    lines.push(`你的力量（钩数）${getPower(s, seat)}${me.powerBonus ? `（含能力加成 +${me.powerBonus}）` : ''}；本回合最多钓 ${getCatchLimit(s)} 条，已钓 ${s.caughtThisTurn} 条。`);
    const mine = me.caught.map((id) => `${card(id).name}${me.exhausted.includes(id) ? '(已横置)' : ''}`);
    lines.push(`你已钓（${me.caught.length} 条，${getRawScore(s, seat)} 分）：${mine.join('、') || '无'}`);
    s.players.forEach((p, i) => {
      if (i === seat) return;
      lines.push(`对手 ${p.name}：${getRawScore(s, i)} 分，力量 ${getPower(s, i)}，已钓 ${p.caught.map((id) => card(id).name).join('、') || '无'}${p.caught.some((id) => !p.exhausted.includes(id) && card(id).ability) ? '（有可用能力鱼）' : ''}`);
    });
    lines.push('浅滩（顶牌默认只露需求档位）：');
    const revealedSet = new Set([
      ...(s.revealedTops?.shoalIndexes || []),
      ...(s.lastPeek?.player === seat ? (s.lastPeek.shoalIndexes || []) : []),
    ]);
    s.shoals.forEach((sh, i) => {
      if (!sh.length) { lines.push(`  ${i + 1} 号：空`); return; }
      const topId = sh[0];
      const [lo, hi] = tierRange(card(topId).strength);
      const pw = getPower(s, seat);
      if (revealedSet.has(i)) {
        lines.push(`  ${i + 1} 号：${sh.length} 张，顶牌已翻开＝【${card(topId).name}】需 ${card(topId).strength} 钩、${card(topId).points} 分${card(topId).type === 'foul' ? '、污秽' : ''}${pw >= card(topId).strength ? '（你能钓）' : '（钓不了）'}`);
        return;
      }
      const state2 = pw >= hi ? '你能钓' : (pw >= lo ? '档内看具体鱼，可能钓得动' : '力量不够');
      lines.push(`  ${i + 1} 号：${sh.length} 张，顶牌需求 ${tierLabel(card(topId).strength)}（你力量 ${pw}，${state2}）`);
    });
    if (s.drawn.length) {
      lines.push('本回合抽到的牌：' + s.drawn.map((id) => {
        const c = card(id);
        return `${c.name}（难度${c.strength}，${c.points}分${c.type === 'foul' ? '，污秽' : ''}${c.hooks ? `，钓到+${c.hooks}钩` : ''}）`;
      }).join('；'));
    }
    const usable = me.caught.filter((id) => !me.exhausted.includes(id) && card(id).ability && ABILITIES[card(id).ability]?.kind === 'active');
    if (usable.length && s.phase === PHASE.ABILITY) {
      lines.push('可发动的能力鱼：' + usable.map((id) => `${card(id).name}（${ABILITIES[card(id).ability].desc}）`).join('、'));
    }
    if (s.pending) {
      const p = s.pending;
      if (p.type === 'REDIRECT') lines.push(`有人以你的鱼为目标（${s.players[p.initiatorIdx].name}），你可以用女妖把目标换成自己。`);
      if (p.type === 'COUNTER') lines.push('有人以你或你的鱼为目标，你可以用僧帽水母横置他的一条鱼。');
      if (p.type === 'PASS_LEFT') lines.push('腐鱼生效：从自己已钓的鱼里选一条传给左边的玩家。');
      if (p.type === 'REARRANGE') {
        const cards = s.shoals[p.shoalIndex] || [];
        lines.push(`眼球团：${p.shoalIndex + 1} 号浅滩现在是 ${cards.map((id) => `${card(id).name}(${card(id).points}分)`).join('、')}，可以重排。`);
      }
    }
    lines.push(`已经连续 ${s.stagnation} 轮没人钓到鱼（满 ${s.players.length} 轮就终局）。`);
    return lines.join('\n');
  },

  fallback(s, seat, level) {
    try {
      const a = chooseAction(s);
      if (a) return a;
    } catch { /* 落到下面兜底 */ }
    const legal = this.legal(s, seat);
    return legal[0] || null;
  },

  rankActions(s, seat, legal) {
    const score = (a) => {
      if (a.type === ACTION.CATCH) return 100 + card(a.cardId).points * 2 - (card(a.cardId).type === 'foul' ? 6 : 0);
      if (a.type === ACTION.USE_ABILITY) return 60;
      if (a.type === ACTION.DRAW) return 40;
      if (a.type === ACTION.THROW_BACK) return 10 - card(a.cardId).points;
      if (a.type === ACTION.PASS_ABILITIES) return 5;
      return 0;
    };
    return legal.slice().sort((x, y) => score(y) - score(x));
  },

  hint(s, seat) {
    if (s.gameOver) return '对局结束';
    const actor = this.turn(s);
    if (actor !== seat) {
      const who = s.players[actor]?.name || '对手';
      return s.phase === PHASE.PENDING ? `等 ${who} 处理反应窗口…` : `等 ${who} 行动…`;
    }
    if (s.phase === PHASE.ABILITY) return '能力阶段：可发动已钓能力鱼（每局各一次），或直接进抽牌';
    if (s.phase === PHASE.DRAW) return `抽牌：选 ${getRequiredDrawCount(s)} 张（点同一堆两次可挖次顶牌）`;
    if (s.phase === PHASE.CATCH) return `力量 ${getPower(s, seat)}，本回合还能钓 ${Math.max(0, getCatchLimit(s) - s.caughtThisTurn)} 条`;
    if (s.phase === PHASE.PENDING) return '有个反应窗口要你决定';
    return '';
  },

  seatInfo(s, seat) {
    const p = s.players[seat];
    const foul = getFoulCount(s, seat);
    const tag = s.frodSeat === seat ? ' · 脚本' : '';
    const guard = p.snowGuard ? ' · 🛡护体' : '';
    return {
      sub: `${getRawScore(s, seat)} 分 · 力量 ${getPower(s, seat)} · ${p.caught.length} 条${foul ? ` · 污秽${foul}` : ''}${tag}${guard}`,
      badge: this.turn(s) === seat ? (s.phase === PHASE.PENDING ? '待反应' : '该你') : '',
    };
  },

  /* ---------------- 交互 ---------------- */
  extraButtons(s, seat, ctx) {
    if (s.gameOver || this.turn(s) !== seat) return [];
    const ui = ctx.table?.host?.__ui;
    const btns = [];
    if (s.phase === PHASE.ABILITY) {
      // 每个能力鱼只出一个按钮；需要目标的点开后再选对象（不再一次铺一堆组合）
      const uses = this.legal(s, 0).filter((a) => a.type === ACTION.USE_ABILITY);
      const byCard = new Map();
      uses.forEach((a) => {
        if (!byCard.has(a.cardId)) byCard.set(a.cardId, []);
        byCard.get(a.cardId).push(a);
      });
      byCard.forEach((list, cardId) => {
        const key = card(cardId).ability;
        const label = `${card(cardId).name} · ${SHORT_ABILITY[key] || ''}`;
        // 目标是「对方某条鱼」的，点技能后直接在对方那边点鱼（不用先选人）
        const oppActs = list.filter((a) => a.target && a.target.playerIndex !== undefined && (a.target.oppCardId || a.target.cardId));
        btns.push(el('button.btn.sm', {
          onClick: () => {
            const ui2 = ctx.host?.__ui || ctx.table?.host?.__ui;
            if (oppActs.length === list.length && ui2) {
              ui2.oppPick = { cardId, hint: OPP_HINT[key] || '点一条对方的鱼', acts: oppActs };
              ctx.rerender();
              return;
            }
            abilityPicker(list, ctx, label);
          },
        }, label));
      });
      btns.push(el('button.btn.sm.primary', {
        onClick: () => ctx.act({ type: ACTION.PASS_ABILITIES, k: 'pass_abilities' })
      }, '结束能力阶段'));
    }
    if (s.phase === PHASE.DRAW) {
      const need = getRequiredDrawCount(s);
      btns.push(el('button.btn.sm.primary', {
        onClick: () => {
          const picks = ui?.drawPicks || [];
          if (picks.length !== need) return window.__cgToast?.(`要选 ${need} 张`, 'err');
          ui.drawPicks = [];
          ctx.act({ type: ACTION.DRAW, from: picks.slice() });
        }
      }, `抽牌（已选 ${(ui?.drawPicks || []).length}/${need}）`));
      btns.push(el('button.btn.sm.ghost', {
        onClick: () => { if (ui) ui.drawPicks = []; ctx.rerender(); }
      }, '清空'));
    }
    if (s.phase === PHASE.CATCH) {
      const sel = ui?.drawnSel;
      const pickedId = sel != null ? s.drawn[sel] : null;
      btns.push(el('button.btn.sm.primary', {
        onClick: () => {
          if (!pickedId) return window.__cgToast?.('先点一张抽到的牌', 'err');
          if (s.caughtThisTurn >= getCatchLimit(s)) return window.__cgToast?.('本回合已经钓够了，剩下这张只能放回', 'err');
          if (!canCatch(s, seat, pickedId)) {
            return window.__cgToast?.(`力量不够：这张需 ${card(pickedId).strength} 钩，你只有 ${getPower(s, 0)}`, 'err');
          }
          if (ui) { ui.drawnSel = null; ui.throwMode = false; }
          ctx.act({ type: ACTION.CATCH, cardId: pickedId });
        }
      }, '钓走这张'));
      btns.push(el('button.btn.sm', {
        onClick: () => {
          if (!pickedId) return window.__cgToast?.('先点一张抽到的牌', 'err');
          if (s.caughtThisTurn === 0 && getCatchableDrawn(s).length > 0) {
            return window.__cgToast?.('规则：有能钓的鱼必须先钓走一条，之后才能放回', 'err');
          }
          const targets = getLegalThrowTargets(s);
          if (!targets.length) return window.__cgToast?.('所有浅滩都满了，这张放不回去', 'err');
          if (ui) { ui.throwMode = true; ui.throwCardId = pickedId; ui.drawnSel = null; }
          ctx.rerender();
        }
      }, '放回…'));
      btns.push(el('button.btn.sm.ghost', {
        onClick: () => {
          if (ui) { ui.drawnSel = null; ui.throwMode = false; ui.throwCardId = null; }
          ctx.rerender();
        }
      }, '取消选择'));
    }
    return btns;
  },

  render(s, ctx) {
    const me = 0;
    const host = ctx.host;
    const ui = host.__ui = host.__ui || {};
    if (!ui.drawPicks) ui.drawPicks = [];
    const myTurn = this.turn(s) === me && !s.gameOver;

    /* --- 阶段进度条：让人一眼知道现在该干什么 --- */
    const stepIdx = s.phase === PHASE.ABILITY ? 0 : s.phase === PHASE.DRAW ? 1 : s.phase === PHASE.CATCH ? 2 : -1;
    const steps = ['① 能力', '② 抽牌', '③ 钓走 / 放回'];
    host.append(el('div.steps',
      ...steps.map((t, i) => el('div.step' + (i === stepIdx ? '.on' : '') + (stepIdx > i ? '.done' : ''), { text: t })),
      s.phase === PHASE.PENDING ? el('div.step.on', { text: '反应窗口' }) : null
    ));

    // 能力阶段没有可用能力时自动进抽牌，免得玩家点了半天没反应
    if (myTurn && s.phase === PHASE.ABILITY) {
      const acts = this.legal(s, 0);
      const onlyPass = acts.length === 1 && acts[0].type === ACTION.PASS_ABILITIES;
      if (onlyPass) {
        if (!ui.autoPassed) {
          ui.autoPassed = true;
          setTimeout(() => ctx.act({ type: ACTION.PASS_ABILITIES, k: 'pass_abilities' }), 240);
        }
      } else ui.autoPassed = false;
    } else ui.autoPassed = false;

    // 放回模式：牌已经被钓走 / 阶段变了，就退出选择
    if (ui.throwMode && (s.phase !== PHASE.CATCH || !s.drawn.includes(ui.throwCardId))) {
      ui.throwMode = false;
      ui.throwCardId = null;
    }
    if (ui.throwMode) {
      host.append(el('div.throwbar',
        el('span', { text: `点一个浅滩，把【${card(ui.throwCardId).name}】放回去` }),
        el('button.btn.sm.ghost', {
          onClick: () => { ui.throwMode = false; ui.throwCardId = null; ctx.rerender(); },
        }, '取消')
      ));
    }

    /* 能力目标模式：直接在对方那边点鱼（换鱼 / 横置 / 移除） */
    if (ui.oppPick) {
      const stillOk = myTurn && s.phase === PHASE.ABILITY && this.legal(s, me)
        .some((a) => a.type === ACTION.USE_ABILITY && a.cardId === ui.oppPick.cardId);
      if (!stillOk) ui.oppPick = null;
    }
    if (ui.oppPick) {
      host.append(el('div.throwbar',
        el('span', { text: ui.oppPick.hint }),
        el('button.btn.sm.ghost', {
          onClick: () => { ui.oppPick = null; ctx.rerender(); },
        }, '取消')
      ));
    }

    /* --- 浅滩 --- */
    const grid = el('div.shoals');
    s.shoals.forEach((sh, i) => {
      const picked = ui.drawPicks.filter((x) => x === i).length;
      const need = getRequiredDrawCount(s);
      const throwMode = !!ui.throwMode && myTurn && s.phase === PHASE.CATCH;
      const legalThrowTargets = throwMode ? getLegalThrowTargets(s) : [];
      const isThrowTarget = throwMode && legalThrowTargets.includes(i);
      const canPick = isThrowTarget || (myTurn && s.phase === PHASE.DRAW && sh.length > 0 && ui.drawPicks.length < need);
      const top = sh.length ? card(sh[0]) : null;
      const myPower = getPower(s, 0);
      const peeked = s.lastPeek?.player === 0 && (s.lastPeek.shoalIndexes || []).includes(i);
      const revealedAll = (s.revealedTops?.shoalIndexes || []).includes(i);
      const topVisible = !!(top && (peeked || revealedAll));
      const [tMin, tMax] = top ? tierRange(top.strength) : [0, 0];
      const sureCan = top ? myPower >= tMax : false;
      const maybe = top ? (myPower >= tMin && myPower < tMax) : false;
      const reach = top ? myPower >= (topVisible ? top.strength : tMax) : false;
      const box = el('div.shoal' + (canPick ? '.pickable' : '') + (picked ? '.picked' : ''));
      box.append(el('div.shoal-h',
        el('span', { text: `浅滩 ${i + 1}${picked ? ` · 已选 ${picked}` : ''}` }),
        el('span', { text: `${sh.length} 张` })
      ));
      if (top) {
        if (topVisible) {
          box.append(el('div.demand' + (reach ? '.ok' : ''),
            el('span.dl', { text: `需 ${top.strength}（已翻开）` }),
            el('span.dv', { text: reach ? '可钓' : '钓不了' })
          ));
        } else {
          box.append(el('div.demand' + (sureCan ? '.ok' : (maybe ? '.maybe' : '')),
            el('span.dl', { text: `需 ${tierLabel(top.strength)}` }),
            el('span.dv', { text: sureCan ? '可钓' : (maybe ? '看具体鱼' : '力量不够') })
          ));
        }
      }
      const cap = s.cardsPerShoal || CARDS_PER_SHOAL;
      const show = Math.min(cap, 6);
      sh.slice(0, show).forEach((id, ci) => {
        if (ci === 0 && topVisible) box.append(cardFace(id, { mini: true }));
        else box.append(ci === 0 ? el('div.fish.topcard', { text: '顶' }) : el('div.fish.backface'));
      });
      if (topVisible) {
        box.append(el('div.tiny', { style: { color: 'var(--aqua)' }, text: peeked ? '美人鱼偷看' : '顶牌已翻开（凯尔派）' }));
      }
      if (!sh.length) box.append(el('div.tiny.muted.center', { text: '空了' }));
      else if (sh.length > show) box.append(el('div.tiny.muted', { text: `…还有 ${sh.length - show} 张` }));
      if (isThrowTarget) {
        box.append(el('div.pick-hint', { text: '点这里放回' }));
        box.addEventListener('click', () => {
          const cardId = ui.throwCardId;
          ui.throwMode = false;
          ui.throwCardId = null;
          ui.drawnSel = null;
          ctx.act({ type: ACTION.THROW_BACK, cardId, shoalIndex: i });
        });
      } else if (canPick) {
        box.append(el('div.pick-hint', { text: `点这里抽（${ui.drawPicks.length}/${need}）` }));
        box.addEventListener('click', () => {
          if (ui.drawPicks.length >= need) return;
          ui.drawPicks.push(i);
          ctx.rerender();
        });
      } else if (myTurn && s.phase === PHASE.DRAW) {
        box.append(el('div.tiny.muted.center', { text: '已选满' }));
      } else if (throwMode) {
        box.append(el('div.tiny.muted.center', { text: '不能放这里' }));
      }
      grid.append(box);
    });
    host.append(grid);

    /* --- 本回合抽到的牌 --- */
    if (s.drawn.length) {
      const row = el('div.caught-row', { style: { marginTop: '6px', gap: '8px' } });
      s.drawn.forEach((id, di) => {
        const canC = canCatch(s, s.currentPlayer, id) && s.caughtThisTurn < getCatchLimit(s);
        const sel = ui.drawnSel === di;
        row.append(cardFace(id, {
          picked: sel,
          info: true,
          dim: !canC,
          onClick: myTurn && s.phase === PHASE.CATCH ? () => { ui.drawnSel = sel ? null : di; ctx.rerender(); } : null,
          onInfo: () => openFishDetail(id, { where: `本回合抽到的第 ${di + 1} 张` }),
        }));
      });
      host.append(el('div', { style: { marginTop: '10px' } },
        el('div.tiny.muted', { text: '本回合抽到（点卡面选中，点 i 看详情）' }), row));
    }

    /* --- 我的钓获 --- */
    const meP = s.players[me];
    const mineRow = el('div.caught-row', { style: { marginTop: '6px', gap: '8px' } });
    meP.caught.forEach((id) => {
      const ex = meP.exhausted.includes(id);
      const acq = s.acq?.[id];
      mineRow.append(cardFace(id, {
        mini: true,
        exhausted: ex,
        acq,
        onClick: () => openFishDetail(id, {
          where: ex ? '你的钓获 · 已横置（能力已用掉）' : '你的钓获',
          acq,
        }),
      }));
    });
    host.append(el('div', { style: { marginTop: '10px' } },
      el('div.tiny.muted', { text: `你的钓获 · ${getRawScore(s, me)} 分 · 力量 ${getPower(s, me)}（点卡看详情）` }),
      meP.caught.length ? mineRow : el('div.tiny.muted', { text: '还空着' })
    ));

    /* --- 对手（公开信息）--- */
    const oppBox = el('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' } });
    s.players.forEach((p, i) => {
      if (i === me) return;
      const prow = el('div.row.wrap', { style: { gap: '6px', alignItems: 'flex-end' } },
        el('span.tiny.muted', { style: { minWidth: '58px' }, text: p.name }),
        el('span.tiny', { text: `${getRawScore(s, i)} 分 · 力量 ${getPower(s, i)}` })
      );
      if (!p.caught.length) prow.append(el('span.tiny.muted', { text: '还没钓到' }));
      p.caught.forEach((id) => {
        const ex = p.exhausted.includes(id);
        const acq = s.acq?.[id];
        const pick = ui.oppPick
          ? ui.oppPick.acts.find((a) => a.target && a.target.playerIndex === i
            && (a.target.oppCardId === id || a.target.cardId === id))
          : null;
        prow.append(cardFace(id, {
          mini: true,
          exhausted: ex,
          acq,
          picked: !!pick,
          onClick: pick
            ? () => { ui.oppPick = null; ctx.act(pick); }
            : () => openFishDetail(id, {
              where: `${p.name} 的钓获${ex ? ' · 已横置' : ''}（当前力量 ${getPower(s, i)}）`,
              acq,
            }),
        }));
      });
      oppBox.append(prow);
    });
    host.append(oppBox);

    /* --- 反应窗口：轮到人类就弹选择 --- */
    if (s.phase === PHASE.PENDING && this.turn(s) === me && !s.gameOver) {
      const key = JSON.stringify(s.pending);
      if (ui.pendingKey !== key) {
        ui.pendingKey = key;
        setTimeout(() => openPendingPicker(s, this, ctx), 40);
      }
    } else if (s.phase !== PHASE.PENDING) {
      ui.pendingKey = null;
    }

    host.append(el('div.tiny.muted', { style: { marginTop: '6px' } },
      `第 ${s.turn} 轮 · 连续空手 ${s.stagnation}/${s.players.length} · ${s.pool === 'base' ? '基础 18 张' : (s.includeExpansion === false ? '基础 18 张' : '24 张（含拓展）')} · ${s.mult || 1} 副 · ${s.shoals.length} 堆 × ${s.cardsPerShoal || 4} 张`));
  },
};

/* ---------------- 上游卡面 ---------------- */
const CARD_IMG = (id) => `assets/cards/${baseIdOf(id)}.webp`;

/**
 * 一张鱼卡（用上游卡图）。
 * opt: {mini, picked, exhausted, dim, info, onClick, onInfo}
 */
const ACQ_TXT = { catch: '钓到的', swap: '交换得到的', give: '别人送的', pass: '传过来的', other: '其他方式得到' };

function cardFace(id, opt = {}) {
  const c = card(id);
  const cls = 'div.fcard'
    + (opt.mini ? '.mini' : '')
    + (c.type === 'foul' ? '.foul' : '')
    + (opt.picked ? '.picked' : '')
    + (opt.exhausted ? '.exhausted' : '');
  const style = { backgroundImage: `url(${CARD_IMG(id)})` };
  if (opt.dim) { style.filter = 'grayscale(.85)'; style.opacity = '.55'; }
  const acqMark = (opt.acq && opt.acq !== 'catch') ? (opt.acq === 'swap' ? '↔' : '⇢') : '';
  const node = el(cls, {
    style,
    title: `${c.name}｜${c.points >= 0 ? '+' : ''}${c.points} 分｜需 ${c.strength} 钩${c.hooks ? `｜钓到给 ${c.hooks} 钩` : ''}｜${c.type === 'foul' ? '污秽' : '正品'}${acqMark ? `｜${ACQ_TXT[opt.acq] || ''}（不靠钓力）` : ''}`,
    onClick: opt.onClick || null,
  });
  node.append(
    el('div.pt', { text: (c.points > 0 ? '+' : '') + c.points }),
    el('div.str', { text: `${acqMark}🪝${c.strength}` }),
    el('div.nm', { text: c.name }),
    c.ability ? el('div.ab', { text: '✦' }) : null,
  );
  if (opt.info) {
    node.append(el('button.info', {
      text: 'i',
      onClick: (e) => {
        e.stopPropagation();
        (opt.onInfo || (() => openFishDetail(id, {})))();
      },
    }));
  }
  return node;
}

/** 卡牌详情：属性 + 能力全文 + 当前状态 */
function openFishDetail(id, opt = {}) {
  const c = card(id);
  const meta = c.ability ? ABILITIES[c.ability] : null;
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.style.zIndex = 82;
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.width = 'min(470px,100%)';

  const info = el('div.fdetail-info',
    el('h4', { text: c.name }, el('span.en', { text: c.nameEn || '' })),
    el('div.row.wrap', { style: { gap: '5px' } },
      el('span.tagx' + (c.type === 'foul' ? '.foul' : ''), { text: c.type === 'foul' ? '污秽鱼（污秽最多者 -2）' : '正品鱼' }),
      isExpansionCard(id) ? el('span.tagx.exp', { text: 'Lingering Remorse 拓展' }) : null,
      meta
        ? el('span.tagx', { text: meta.kind === 'active' ? '主动能力 · 每局一次' : '永续被动' })
        : el('span.tagx', { text: '无能力' })
    ),
    el('div.frow',
      el('span', { text: '分值 ' }, el('b', { text: (c.points > 0 ? '+' : '') + c.points })),
      el('span', { text: '难度 ' }, el('b', { text: String(c.strength) }), el('span', { text: ' 钩' })),
      el('span', { text: '钓到给 ' }, el('b', { text: String(c.hooks) }), el('span', { text: ' 钩' }))
    ),
    el('div.frow',
      el('span', { text: '来路 ' },
        el('b', { text: ACQ_TXT[opt.acq] || ACQ_TXT.catch }),
        el('span', {
          text: opt.acq && opt.acq !== 'catch'
            ? '——这条不靠钓力（能力换/送/传来），所以可能超过当前力量'
            : `（钓它时力量需 ≥ ${c.strength}）`,
        })
      )
    ),
    meta
      ? el('div.abbox',
        el('b', { text: '能力：' + (meta.desc || '') }),
        el('span', {
          text: meta.kind === 'active'
            ? '发动时机：自己回合开始的能力阶段；发动后这张鱼横置，能力整局只能用这一次。'
            : '永续：只要这张鱼没被横置就一直生效（被对手横置后失效）。',
        })
      )
      : el('div.abbox', el('b', { text: '没有能力' }), el('span', { text: '纯渔获，只给分值和钩数。' })),
    opt.where ? el('div.tiny.muted', { text: '位置：' + opt.where }) : null,
    el('div.tiny.muted', { text: '卡图由上游开源项目用 AI 生成（MIT），非本站绘制。' })
  );

  const face = cardFace(id, {});
  face.style.width = '132px';

  box.append(el('div.fdetail', face, info));
  box.append(el('div.modal-foot',
    el('button.btn', { onClick: () => scrim.remove() }, '关掉')
  ));
  scrim.append(box);
  document.getElementById('modalRoot').append(scrim);
  requestAnimationFrame(() => scrim.classList.add('on'));
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
}

/* 能力目标选择器：先选对象（对手/浅滩），再选具体哪条鱼 */
function abilityPicker(list, ctx, title) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.style.zIndex = 82;
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.width = 'auto';
  box.style.maxWidth = '430px';
  scrim.append(box);
  document.getElementById('modalRoot').append(scrim);
  requestAnimationFrame(() => scrim.classList.add('on'));
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });

  const run = (a) => { scrim.remove(); ctx.act(a); };
  const showList = (items, t, hint) => {
    box.innerHTML = '';
    box.append(el('h3', { text: t }));
    if (hint) box.append(el('p.tiny.muted', { style: { marginBottom: '8px', whiteSpace: 'pre-line' } }, hint));
    const col = el('div.col');
    items.forEach((it) => col.append(el('button.btn.block', { onClick: () => it.run() }, it.label)));
    box.append(col);
  };
  const shortLabel = (a) => (a.label.split('｜')[1] || a.label);

  const level2 = (items) => {
    if (items.length === 1) return run(items[0]);
    showList(items.map((a) => ({ label: shortLabel(a), run: () => run(a) })), '选哪一条？');
  };

  // 先按「对象是谁」分组：对手 / 浅滩 / 不需要目标
  const groups = new Map();
  list.forEach((a) => {
    const t = a.target || {};
    const key = t.playerIndex !== undefined ? 'p' + t.playerIndex
      : t.shoalIndexes ? 's' + t.shoalIndexes.join(',')
        : t.shoalIndex !== undefined ? 's' + t.shoalIndex
          : 'self';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  });

  if (groups.size === 1) {
    const items = [...groups.values()][0];
    if (items.length === 1) return run(items[0]);
    return level2(items);
  }

  const entries = [...groups.entries()].map(([k, v]) => {
    let label = '发动';
    if (k.startsWith('p')) {
      const raw = shortLabel(v[0]);
      label = raw.replace(/的【.*$/, '').replace(/^目标：/, '') || `对手 ${Number(k.slice(1)) + 1}`;
    } else if (k.startsWith('s')) {
      const idxs = k.slice(1).split(',');
      label = idxs.length > 1 ? `浅滩 ${idxs.join('、')}` : `浅滩 ${Number(idxs[0]) + 1}`;
    }
    return { label, run: () => level2(v) };
  });

  showList(entries, title || '选目标', '先选对象，再选具体哪一条。');
}

/* 反应窗口选择器 */
function openPendingPicker(s, game, ctx) {
  const acts = game.legal(s, 0);
  if (!acts.length) return;
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.style.zIndex = 80;
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.width = 'auto';
  box.style.maxWidth = '430px';
  const p = s.pending;
  const titles = { REDIRECT: '女妖改向', COUNTER: '僧帽水母反击', REARRANGE: '眼球团：重排鱼群', PASS_LEFT: '腐鱼：选一条传给左边' };
  box.append(el('h3', { text: titles[p?.type] || '反应窗口' }));
  const desc = el('p.tiny.muted', { style: { marginBottom: '10px' } });
  if (p?.type === 'REDIRECT') desc.textContent = `${s.players[p.initiatorIdx].name} 以一条鱼为目标，你可以用女妖把目标换成自己来保护原目标。`;
  if (p?.type === 'COUNTER') desc.textContent = `${s.players[p.initiatorIdx].name} 以你或你的鱼为目标，你可以横置他一条鱼。`;
  if (p?.type === 'REARRANGE') {
    const cards = s.shoals[p.shoalIndex] || [];
    desc.textContent = `这一堆现在是：${cards.map((id) => `${card(id).name}(${card(id).points}分)`).join('、')}`;
  }
  if (p?.type === 'PASS_LEFT') desc.textContent = '所有玩家各选一条鱼传给左边的人。';
  box.append(desc);
  const list = el('div.col');
  acts.forEach((a) => {
    list.append(el('button.btn.block', { onClick: () => { scrim.remove(); ctx.act(a); } }, a.label));
  });
  box.append(list);
  scrim.append(box);
  document.getElementById('modalRoot').append(scrim);
  requestAnimationFrame(() => scrim.classList.add('on'));
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
}

export default regrets;
export { pendingActor };