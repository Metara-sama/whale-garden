/**
 * M5 Solo 脚本对手：6 张固定卡牌定义 + 确定性剧本（数据 + 引擎）。
 * 与 M2 启发式 AI 明确区分：本模块无随机、无评估分支，严格按固定优先级执行。
 * 决策为纯函数（输入状态快照 → 输出动作），可 100% 单测。
 *
 * 剧本规则见 docs/RULES.md 第十一章。
 */
import { CARD_BY_ID } from './cards.js';
import { PHASE } from './stateMachine.js';
import {
  getCatchableDrawn,
  getDrawableShoals,
  getLegalThrowTargets,
  getRequiredDrawCount,
  getCatchLimit,
} from './rules.js';

/** 脚本对手名称 */
export const SCRIPT_NAME = '渔夫与青蛙';

/** 目标清单：脚本对手偏好的 6 张固定卡牌（按优先级从高到低，见 RULES.md 11.2） */
export const TARGETS = ['kraken', 'kelpie', 'oarfish', 'everSquid', 'barracuda', 'mermaid'];

/** 能力发动固定顺序（已钓且未横置时依次尝试，全部为无目标主动能力） */
export const ABILITY_ORDER = ['oarfish', 'lamprey', 'greatWhite', 'kelpie', 'seaBishop', 'snowEel'];

/** 一张牌是否在目标清单内 */
export function isTarget(cardId) {
  return TARGETS.includes(cardId);
}

/** 目标清单优先级（越小越优先；非目标返回 Infinity） */
export function targetPriority(cardId) {
  const idx = TARGETS.indexOf(cardId);
  return idx === -1 ? Infinity : idx;
}

/** 选择脚本对手本回合的下一步动作（纯函数） */
export function chooseScriptAction(state) {
  switch (state.phase) {
    case PHASE.ABILITY:
      return chooseAbility(state);
    case PHASE.DRAW:
      return chooseDraw(state);
    case PHASE.CATCH:
      return chooseCatch(state);
    default:
      return null;
  }
}

/** 能力阶段：按固定顺序发动已钓且未横置的能力鱼，否则跳过 */
function chooseAbility(state) {
  const me = state.players[state.currentPlayer];
  for (const cardId of ABILITY_ORDER) {
    if (me.caught.includes(cardId) && !me.exhausted.includes(cardId) && CARD_BY_ID[cardId].ability) {
      return { type: 'USE_ABILITY', cardId };
    }
  }
  return { type: 'PASS_ABILITIES' };
}

/** 抽牌阶段：优先从"顶牌或次顶牌为目标清单内"的浅滩取牌，否则取最左非空浅滩 */
function chooseDraw(state) {
  const required = getRequiredDrawCount(state);
  const drawable = getDrawableShoals(state);
  const scored = drawable.map((i) => {
    const shoal = state.shoals[i];
    const top = shoal[0];
    const second = shoal.length > 1 ? shoal[1] : null;
    let score = Infinity;
    if (isTarget(top)) score = targetPriority(top);
    else if (second && isTarget(second)) score = targetPriority(second) + 0.5;
    return { i, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const from = scored.slice(0, required).map((s) => s.i);
  return { type: 'DRAW', from };
}

/** 钓走/放回：优先钓目标清单内的可钓牌（可多钓至本回合上限），否则钓分值最高且非污秽；否则放回（先污秽，最左合法浅滩） */
function chooseCatch(state) {
  const catchable = getCatchableDrawn(state);
  if (catchable.length > 0 && state.caughtThisTurn < getCatchLimit(state)) {
    const targetCatch = catchable
      .filter((id) => isTarget(id))
      .sort((a, b) => targetPriority(a) - targetPriority(b))[0];
    if (targetCatch) return { type: 'CATCH', cardId: targetCatch };
    const best = catchable
      .map((id) => ({ id, v: CARD_BY_ID[id].points - (CARD_BY_ID[id].type === 'foul' ? 2 : 0) }))
      .sort((a, b) => b.v - a.v)[0];
    return { type: 'CATCH', cardId: best.id };
  }
  const legal = getLegalThrowTargets(state);
  const foul = state.drawn.filter((id) => CARD_BY_ID[id].type === 'foul');
  const cardId = foul.length > 0 ? foul[0] : state.drawn[0];
  return { type: 'THROW_BACK', cardId, shoalIndex: legal[0] };
}
