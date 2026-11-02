/**
 * 启发式 AI（M2 单人 AI 对战 与 M4 AI 斗蛐蛐 共享）。
 * 输入状态快照，返回动作；必须走与玩家完全相同的动作接口与 rules 校验，禁止作弊。
 *
 * 决策优先级（提示词四.7）：
 *   能否满足钩数 → 优先高分且非污秽 → 评估污秽风险 → 抢关键能力鱼。
 * PENDING（反应窗口）用 constantjs/core/abilities 的确定性自动结算，保证不卡死。
 */
import { CARD_BY_ID, baseIdOf } from './cards.js';
import { getHooks, passiveActive } from './gameState.js';
import { autoResolution } from './abilities.js';
import {
  canCatch,
  getCatchableDrawn,
  getDrawableShoals,
  getLegalThrowTargets,
  getRequiredDrawCount,
  getCatchLimit,
} from './rules.js';

/** 能力对 AI 的额外价值（"抢关键能力鱼"的量化） */
const ABILITY_BONUS = {
  draw_plus2: 2,
  draw_plus1: 1,
  power_plus3: 1.5,
  exhaust_any: 1.5,
  exhaust_foul: 1.2,
  exhaust_fair: 1.2,
  swap_any: 2,
  swap_fair: 1.5,
  swap_zero: 1.5,
  give_card: 1.2,
  pass_left: 1.5,
  remove_zero: 1.2,
  rearrange_shoal: 1,
  peek_multi: 1.2,
  shuffle_all: 1,
  snow_guard: 1.5,
  reveal_all: 0.8,
};

/** 目标玩家（除自己外，优先下一位仍存活/在座的玩家） */
function others(state, p) {
  return state.players.map((_, i) => i).filter((i) => i !== p);
}

/**
 * AI 对一张卡的价值评估：分值 - 污秽风险 + 能力价值。
 * @returns {number}
 */
export function aiCardValue(card, state, playerIndex) {
  let v = card.points;
  if (card.type === 'foul') v -= 2; // 污秽风险（含 -2 惩罚与负分倾向）
  if (card.ability) v += ABILITY_BONUS[card.ability] || 0;
  return v;
}

/** 选择当前玩家本回合的下一步动作 */
export function chooseAction(state) {
  switch (state.phase) {
    case 'ability':
      return chooseAbilityAction(state);
    case 'draw':
      return chooseDrawAction(state);
    case 'catch':
      return chooseCatchAction(state);
    case 'pending':
      return { type: 'RESOLVE', resolution: autoResolution(state) };
    default:
      return null;
  }
}

/** 能力阶段：按价值依次评估可用的能力鱼，决定发动哪个或跳过 */
function chooseAbilityAction(state) {
  const p = state.currentPlayer;
  const me = state.players[p];
  const ready = me.caught.filter((id) => !me.exhausted.includes(id) && CARD_BY_ID[id].ability);
  // 优先发动"本回合额外抽牌/加力量"类能力（皇带鱼/七鳃鳗/海神之怒），
  // 先锁定抽牌上限再处理其它，避免乱序导致额外抽牌被浪费或延后。
  const PRIORITY = { draw_plus2: 0, draw_plus1: 1, power_plus3: 2 };
  const byPriority = [...ready].sort((a, b) => (PRIORITY[CARD_BY_ID[a]?.ability] ?? 9) - (PRIORITY[CARD_BY_ID[b]?.ability] ?? 9));

  for (const cardId of byPriority) {
    const action = buildAbilityAction(state, cardId);
    if (action) return action;
  }
  return { type: 'PASS_ABILITIES' };
}

function isFrozen(state, idx) {
  return state.players[idx].snowGuard;
}

/**
 * 为一张能力鱼构建可发动动作；不可行返回 null（跳过）。target 只对 3-4 人局显式给 playerIndex。
 */
function buildAbilityAction(state, cardId) {
  const card = CARD_BY_ID[cardId];
  const p = state.currentPlayer;
  const me = state.players[p];
  const opps = others(state, p);
  const opp = state.players[(p + 1) % state.players.length];

  switch (card.ability) {
    case 'draw_plus2':
    case 'draw_plus1':
    case 'power_plus3':
    case 'pass_left':
    case 'shuffle_all':
      return { type: 'USE_ABILITY', cardId };

    case 'reveal_all':
      // 知道顶牌便于决策
      return { type: 'USE_ABILITY', cardId };

    case 'exhaust_foul':
    case 'exhaust_fair':
    case 'exhaust_any': {
      const filter = card.ability === 'exhaust_foul' ? 'foul' : card.ability === 'exhaust_fair' ? 'fair' : null;
      for (const oi of opps) {
        if (isFrozen(state, oi)) continue;
        const o = state.players[oi];
        // 仅选满足类型过滤的目标；若该对手无匹配目标则跳过（避免选定被规则拒绝的牌造成死循环）
        const good = o.caught.filter(
          (id) =>
            !o.exhausted.includes(id) &&
            (!filter || CARD_BY_ID[id].type === filter) &&
            CARD_BY_ID[id].ability !== 'untargetable',
        );
        if (good.length === 0) continue;
        // 优先废掉对方仍可用的能力鱼，否则按钓获顺序横置一条
        const priority = (id) => (CARD_BY_ID[id].ability ? -1 : o.caught.indexOf(id));
        const target = good.sort((a, b) => priority(a) - priority(b))[0];
        return { type: 'USE_ABILITY', cardId, target: { playerIndex: oi, cardId: target } };
      }
      return null;
    }

    case 'swap_any':
    case 'swap_fair':
    case 'swap_zero': {
      const filter = card.ability === 'swap_fair' ? 'fair' : null;
      const sFilter = card.ability === 'swap_zero' ? 0 : null;
      // 交换以本卡换对方一鱼转手；排除不可被选定的巨型乌贼
      const myValue = aiCardValue(card, state, p);
      for (const oi of opps) {
        if (isFrozen(state, oi)) continue;
        const o = state.players[oi];
        let pool;
        if (passiveActive(state, oi, 'force_swap_lionfish')) {
          // 对方有狮子鱼现行：规则强制交换必须选狮子鱼；但若狮子鱼不满足类型/难度过滤则此对手不可交换
          pool = o.caught.filter((id) =>
            baseIdOf(id) === 'lionfish' && !o.exhausted.includes(id) &&
            (!filter || CARD_BY_ID[id].type === filter) &&
            (sFilter == null || CARD_BY_ID[id].strength === sFilter));
        } else {
          pool = o.caught.filter((id) =>
            !o.exhausted.includes(id) &&
            CARD_BY_ID[id].ability !== 'untargetable' &&
            (!filter || CARD_BY_ID[id].type === filter) &&
            (sFilter == null || CARD_BY_ID[id].strength === sFilter));
        }
        const oppBest = pool
          .sort((a, b) => aiCardValue(CARD_BY_ID[b], state, p) - aiCardValue(CARD_BY_ID[a], state, p))[0];
        if (oppBest && aiCardValue(CARD_BY_ID[oppBest], state, p) > myValue) {
          return { type: 'USE_ABILITY', cardId, target: { playerIndex: oi, oppCardId: oppBest } };
        }
      }
      return null;
    }

    case 'give_card': {
      // 断脚是负分污秽，尽早丢给下一位玩家（避开雪鳗护体，否则动作被拒导致死循环）
      for (const oi of opps) {
        if (isFrozen(state, oi)) continue;
        return { type: 'USE_ABILITY', cardId, target: { playerIndex: oi } };
      }
      return null;
    }

    case 'peek_multi': {
      const nonEmpty = getDrawableShoals(state);
      if (nonEmpty.length === 0) return null;
      return { type: 'USE_ABILITY', cardId, target: { shoalIndexes: nonEmpty.slice(0, 3) } };
    }

    case 'remove_zero': {
      // 优先移除对方已钓的难度 0 鱼（削弱对手），否则移除浅滩顶牌的难度 0 鱼
      for (const oi of opps) {
        if (isFrozen(state, oi)) continue;
        const o = state.players[oi];
        const zero = o.caught.filter((id) => CARD_BY_ID[id].strength === 0);
        if (zero.length === 0) continue;
        const target = zero
          .sort((a, b) => aiCardValue(CARD_BY_ID[b], state, p) - aiCardValue(CARD_BY_ID[a], state, p))[0];
        return { type: 'USE_ABILITY', cardId, target: { playerIndex: oi, cardId: target } };
      }
      for (let i = 0; i < state.shoals.length; i++) {
        if (state.shoals[i].length > 0 && CARD_BY_ID[state.shoals[i][0]].strength === 0) {
          return { type: 'USE_ABILITY', cardId, target: { shoalIndex: i, cardIndex: 0 } };
        }
      }
      return null;
    }

    case 'rearrange_shoal': {
      const shoals = getDrawableShoals(state).filter((i) => (state.shoals[i] || []).length > 1);
      const idx = shoals[0];
      if (idx == null) return null;
      return { type: 'USE_ABILITY', cardId, target: { shoalIndex: idx } };
    }

    case 'snow_guard': {
      // 有交换/横置威胁时开护体
      const threat = opps.some((oi) =>
        state.players[oi].caught.some(
          (id) =>
            !state.players[oi].exhausted.includes(id) &&
            ['swap_any', 'swap_fair', 'swap_zero', 'exhaust_any', 'exhaust_foul', 'exhaust_fair'].includes(CARD_BY_ID[id].ability),
        ),
      );
      if (threat) return { type: 'USE_ABILITY', cardId };
      return null;
    }

    default:
      return null;
  }
}

/**
 * 抽牌阶段：优先选"顶牌或次顶牌可钓且价值高"的浅滩。
 * 顶牌不可钓而次顶牌可钓时连抽同一浅滩两张（from=[i,i]）以触及次顶牌，
 * 否则次顶牌永远埋在顶牌之下、对局会陷入"抽两张不可钓大鱼再放回"的死循环。
 */
function chooseDrawAction(state) {
  const required = getRequiredDrawCount(state);
  const drawable = getDrawableShoals(state);
  const hooks = getHooks(state, state.currentPlayer);
  const me = state.currentPlayer;

  const scored = drawable.map((i) => {
    const shoal = state.shoals[i];
    const top = CARD_BY_ID[shoal[0]];
    const second = shoal.length > 1 ? CARD_BY_ID[shoal[1]] : null;
    let score = aiCardValue(top, state, me);
    // 可钓的顶牌/次顶牌绝对优先：保证每回合尽可能钓到鱼、对局总能推进
    if (hooks >= top.strength) score += 100;
    else if (second && hooks >= second.strength) score += 100;
    return { i, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const from = [];
  for (const { i } of scored) {
    if (from.length >= required) break;
    const shoal = state.shoals[i];
    const top = CARD_BY_ID[shoal[0]];
    const second = shoal.length > 1 ? CARD_BY_ID[shoal[1]] : null;
    const dig = hooks < top.strength && second && hooks >= second.strength;
    if (dig && required - from.length >= 2 && shoal.length >= 2) {
      from.push(i, i);
    } else {
      from.push(i);
    }
  }
  return { type: 'DRAW', from };
}

/** 钓走/放生阶段：钓价值最高的可钓牌（可多钓至本回合上限），其余放回合法浅滩（避免放回来源浅滩，防止埋住可钓牌） */
function chooseCatchAction(state) {
  const catchable = getCatchableDrawn(state);
  if (catchable.length > 0 && state.caughtThisTurn < getCatchLimit(state)) {
    const best = catchable
      .map((id) => ({ id, v: aiCardValue(CARD_BY_ID[id], state, state.currentPlayer) }))
      .sort((a, b) => b.v - a.v)[0];
    return { type: 'CATCH', cardId: best.id };
  }
  const idx = 0;
  const sourceShoal = state.drawnFrom[idx];
  const legal = getLegalThrowTargets(state);
  const target = legal.find((i) => i !== sourceShoal) ?? legal[0];
  return { type: 'THROW_BACK', cardId: state.drawn[idx], shoalIndex: target };
}

export { canCatch };