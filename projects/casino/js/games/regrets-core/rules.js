/**
 * 规则引擎：取牌合法性、强度判定、放生（放回）合法性、捕鱼限制、终局判定。
 * 全部纯函数（含"永续被动"参与的判定，被动见 abilities.js 的 passiveActive）。
 */
import { CARD_BY_ID } from './cards.js';
import { getPower, getRemainingInShoals, CARDS_PER_SHOAL, BASE_DRAW, passiveActive } from './gameState.js';

/** 浅滩顶牌是否为"小阴影"（strength<=0） */
export function isSmallShadow(shoal) {
  return shoal.length > 0 && CARD_BY_ID[shoal[0]].strength <= 0;
}

/** 判断某玩家是否被"海猴/旧日支配者"限制捕某张牌（返回限制理由，null=不受限） */
function passiveCatchBlock(state, playerIndex, cardId) {
  const card = CARD_BY_ID[cardId];
  if (card.strength === 0 && passiveActive(state, playerIndex, 'catch_restrict_zero')) {
    return '海猴：你不能捕捉难度为 0 的鱼';
  }
  if (card.strength >= 3 && passiveActive(state, playerIndex, 'catch_restrict_high')) {
    if (hasLowerAlternative(state, playerIndex, cardId)) {
      return '旧日支配者：有其他可选的鱼时，你不能捕捉难度 ≥3 的鱼';
    }
  }
  return null;
}

/**
 * 是否存在"其他可选的、难度<3 且能钓"的鱼（供旧日支配者判定）。
 * 「可选」= 本回合抽到的鱼（state.drawn，只有这些牌本回合可被钓走），
 * 而非浅滩中仅"可接触"的牌——抽到的全是难度≥3 时不应再被旧日支配者限制。
 */
export function hasLowerAlternative(state, playerIndex, excludeCardId) {
  return state.drawn.some((id) => {
    if (id === excludeCardId) return false;
    const c = CARD_BY_ID[id];
    if (c.strength >= 3) return false;
    if (getPower(state, playerIndex) < c.strength) return false;
    // 排除海猴禁捕的难度0
    if (c.strength === 0 && passiveActive(state, playerIndex, 'catch_restrict_zero')) return false;
    return true;
  });
}

/** 全部可接触的鱼 id（已抽出 + 各浅滩顶/次顶） */
export function getAccessibleFish(state) {
  const out = state.drawn.slice();
  state.shoals.forEach((s) => {
    out.push(...s.slice(0, 2));
  });
  return out;
}

/** 某玩家能否钓起某张牌（力量足够 + 无被动禁捕） */
export function canCatch(state, playerIndex, cardId) {
  if (getPower(state, playerIndex) < CARD_BY_ID[cardId].strength) return false;
  return passiveCatchBlock(state, playerIndex, cardId) === null;
}

/** 当前抽出牌中可被当前玩家钓走的牌 */
export function getCatchableDrawn(state) {
  const p = state.currentPlayer;
  return state.drawn.filter((id) => canCatch(state, p, id));
}

/**
 * 合法放回目标浅滩索引列表。
 *
 * 本站按用户要求放开了原版限制：**六个浅滩里任何一堆「非空」的牌堆都能放回**——
 * 不再要求"优先空滩 / 只能盖大阴影"，也不再限制满堆（4 张的堆也能继续往上放）。
 * 只有全场都空时才退化为所有堆，避免无解。
 */
export function getLegalThrowTargets(state) {
  const nonEmpty = [];
  const all = [];
  state.shoals.forEach((s, i) => {
    all.push(i);
    if (s.length > 0) nonEmpty.push(i);
  });
  return nonEmpty.length > 0 ? nonEmpty : all;
}

/** 可抽牌的浅滩索引（非空） */
export function getDrawableShoals(state) {
  const out = [];
  state.shoals.forEach((s, i) => {
    if (s.length > 0) out.push(i);
  });
  return out;
}

/** 当前回合应抽牌数（基础 2 + 额外抽卡） */
export function getRequiredDrawCount(state) {
  return Math.min(BASE_DRAW + state.extraDraw, getDrawableShoals(state).length);
}

/**
 * 本回合可钓走上限。
 *
 * 本站规则（按站主要求）：**不管这回合抽了几张，只能钓走 1 条**。
 * （上游原版是「1 + 额外抽牌数」，即多抽就能多留；这里改掉了。）
 */
export function getCatchLimit(state) {
  return 1;
}

/**
 * 终局判定：所有鱼牌被钓光或被移出游戏（浅滩全空），或没有任何玩家能钓起可接触的鱼。
 */
export function checkGameOver(state) {
  if (getRemainingInShoals(state) === 0) return true;
  // 停滞保护：连续满一整轮无人钓获（stagnation >= 玩家人数）即终局，
  // 防止"参与双方只会放回污秽/低可用牌导致浅滩牌无限回流"的死锁。
  if (state.stagnation >= state.players.length) return true;
  const accessible = getAccessibleFish(state);
  if (accessible.length === 0) return true;
  for (const id of accessible) {
    for (let i = 0; i < state.players.length; i++) {
      if (canCatch(state, i, id)) return false;
    }
  }
  return true;
}