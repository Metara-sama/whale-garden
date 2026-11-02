/**
 * 对局状态对象与不可变更新函数。
 * 状态必须可序列化纯数据，用于渲染、联机同步、重连恢复与对局回放。
 * 支持 2-4 人对局。
 */
import { createRng } from './rng.js';
import { CARDS, CARD_BY_ID, TOTAL_CARDS, buildDeck } from './cards.js';

export const NUM_SHOALS = 6;              // 单副牌时的浅滩数
export const CARDS_PER_SHOAL = TOTAL_CARDS / NUM_SHOALS; // 4
export const BASE_DRAW = 2;
/** 开局至少保证多少个浅滩顶牌为"易钓小鱼"（strength=0） */
export const MIN_SMALL_TOPS = 4;

/**
 * 创建初始对局状态。
 * @param {{seed:number, playerNames:string[], mult?:number}} opts
 *   mult = 牌组倍数（1 副 6 堆，2 副 12 堆，3 副 18 堆；每堆始终 4 张）
 * @returns {object} 初始状态
 */
export function createInitialState({ seed, playerNames, mult = 1 }) {
  const m = Math.max(1, Math.min(3, mult | 0 || 1));
  const rng = createRng(seed);
  const deck = rng.shuffle(buildDeck(m));
  const shoalCount = Math.floor(deck.length / CARDS_PER_SHOAL);
  const shoals = [];
  for (let i = 0; i < shoalCount; i++) {
    shoals.push(deck.slice(i * CARDS_PER_SHOAL, (i + 1) * CARDS_PER_SHOAL));
  }
  ensureSmallTops(shoals, rng);
  if (!hasEnoughSmallTops(shoals)) throw new Error('ensureSmallTops 未保证至少 4 个易钓顶牌');

  const players = playerNames.map((name, i) => ({
    id: i,
    name,
    caught: [],        // 已钓获的鱼 id（按钓获顺序）
    exhausted: [],     // 已横置（能力已失效，主动已用 或 被对方横置）的鱼 id
    powerBonus: 0,     // 本回合额外力量（大白鲨等，回合结束清零）
    snowGuard: false,  // 雪鳗护体：直到自己下个回合前，能力不能指向自己
  }));

  return {
    version: 2,
    seed,
    mult: m,
    players,
    shoals,
    currentPlayer: 0,
    phase: 'ability',   // ability | draw | catch | gameOver | pending
    turn: 1,
    drawn: [],
    drawnFrom: [],
    extraDraw: 0,
    caughtThisTurn: 0,  // 本回合已钓走条数（上限 = 1 + extraDraw，见 rules.getCatchLimit）
    lastPeek: null,     // 最近偷看结果 {player, shoalIndexes, cardIds}
    revealedTops: null, // 凯尔派：{shoalIndexes} 揭示的堆顶，回合结束清空
    stagnation: 0,      // 连续无人钓获的回合数（见 rules.checkGameOver 的停滞保护终局）
    pending: null,      // 反应/待决策窗口 {type, ...}（女妖/僧帽/排序/传球等）
    snowGuardOwner: null, // 当前雪鳗护体的玩家索引
    actions: [],
    gameOver: false,
    winner: null,
  };
}

/** 是否至少 MIN_SMALL_TOPS 个浅滩顶牌是易钓小鱼（strength<=0） */
function hasEnoughSmallTops(shoals, min = MIN_SMALL_TOPS) {
  return shoals.filter((s) => s.length > 0 && isSmallTopId(s[0])).length >= min;
}

/** 某牌是否为易钓小鱼（strength<=0） */
export function isSmallTopId(id) {
  return CARD_BY_ID[id].strength <= 0;
}

/** 尽量保证至少 MIN_SMALL_TOPS 个浅滩顶牌是易钓小鱼（确定性构造，见旧版注释逻辑） */
export function ensureSmallTops(shoals, rng) {
  const isSmallTopAt = (s) => s.length > 0 && isSmallTopId(s[0]);
  const need = MIN_SMALL_TOPS - shoals.filter(isSmallTopAt).length;
  if (need <= 0) return;
  const dst = [];
  for (let i = 0; i < shoals.length && dst.length < need; i++) {
    if (shoals[i].length > 0 && !isSmallTopAt(shoals[i])) dst.push(i);
  }
  if (dst.length === 0) return;
  const candidates = [];
  shoals.forEach((s, i) =>
    s.forEach((id, k) => {
      if (isSmallTopId(id) && k > 0) candidates.push({ shoalIdx: i, cardIdx: k });
    }),
  );
  for (const di of dst) {
    const c = candidates.shift();
    if (!c) break;
    const src = shoals[c.shoalIdx];
    if (!src || c.cardIdx >= src.length) continue;
    const smallCard = src[c.cardIdx];
    const dstTop = shoals[di][0];
    src[c.cardIdx] = dstTop;
    shoals[di][0] = smallCard;
  }
  if (rng && need > 0) {
    /* 兜底：若剩余易钓牌不足则尽力而为（对局中途调用时可能如此） */
  }
}

/** 深拷贝状态 */
export function cloneState(state) {
  return structuredClone(state);
}

/** 某玩家钩子数 = 已钓获鱼 hooks 之和 */
export function getHooks(state, playerIndex) {
  const p = state.players[playerIndex];
  return p.caught.reduce((sum, id) => sum + CARD_BY_ID[id].hooks, 0);
}

/** 某玩家可用力量 = 钩子数 + 本回合力量加成（大白鲨） */
export function getPower(state, playerIndex) {
  return getHooks(state, playerIndex) + state.players[playerIndex].powerBonus;
}

/** 某玩家已钓到、且未横置的某个被动能力是否现行 */
export function passiveActive(state, playerIndex, abilityKey) {
  const p = state.players[playerIndex];
  return p.caught.some((id) => !p.exhausted.includes(id) && CARD_BY_ID[id].ability === abilityKey);
}

/** 全部已钓获数量 */
export function getTotalCaught(state) {
  return state.players.reduce((n, p) => n + p.caught.length, 0);
}

/** 浅滩剩余总卡数（含已被梭子鱼移出游戏，不计入） */
export function getRemainingInShoals(state) {
  return state.shoals.reduce((n, s) => n + s.length, 0);
}

export { TOTAL_CARDS };