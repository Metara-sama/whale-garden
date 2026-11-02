/**
 * 状态机：状态枚举 / 转移表 / 动作分发。
 * 纯函数 applyAction(state, action) → { state, events } | { error }。
 * 同状态 + 同动作序列 ⇒ 同结果（确定性），可被单机、联机(权威)、回放与测试复用。
 *
 * 回合流程：ability（能力阶段，可逐个发动主动牌）→ draw（抽牌）→ catch（钓走/放生）→ 下一位玩家。
 * 反应窗口：能力阶段中"以他人之鱼为目标"会进入 pending（REDIRECT/COUNTER），
 *           以及眼球团(REARRANGE)、腐鱼(PASS_LEFT)的待决策窗口，由 RESOLVE 收束。
 */
import { CARD_BY_ID } from './cards.js';
import { cloneState, getPower } from './gameState.js';
import {
  canCatch,
  getCatchableDrawn,
  getDrawableShoals,
  getLegalThrowTargets,
  getRequiredDrawCount,
  getCatchLimit,
  checkGameOver,
} from './rules.js';
import {
  ABILITIES,
  ABILITY_TYPES,
  validateActiveUse,
  validateAbilityTarget,
  applyUnboundedAbility,
  beginTargetedEffect,
  resolvePending,
  createAbilityRng,
} from './abilities.js';
import { getWinners } from './scoring.js';

export const ACTION = {
  USE_ABILITY: 'USE_ABILITY',
  PASS_ABILITIES: 'PASS_ABILITIES',
  DRAW: 'DRAW',
  CATCH: 'CATCH',
  THROW_BACK: 'THROW_BACK',
  RESOLVE: 'RESOLVE',
};

export const PHASE = {
  ABILITY: 'ability',
  DRAW: 'draw',
  CATCH: 'catch',
  PENDING: 'pending',
  GAME_OVER: 'gameOver',
};

/** 以他人之鱼为目标的主动能力（进入目标/反击链路） */
const OPP_TARGETED_SET = new Set([
  ABILITY_TYPES.EXHAUST_FOUL,
  ABILITY_TYPES.EXHAUST_FAIR,
  ABILITY_TYPES.EXHAUST_ANY,
  ABILITY_TYPES.SWAP_ANY,
  ABILITY_TYPES.SWAP_FAIR,
  ABILITY_TYPES.SWAP_ZERO,
]);

export function validateAction(state, action) {
  if (state.phase === PHASE.GAME_OVER) return '对局已结束';

  // pending 窗口：只允许 RESOLVE
  if (state.phase === PHASE.PENDING) {
    if (action.type !== ACTION.RESOLVE) return '有待决策窗口，请先进行选择';
    if (!state.pending) return '状态异常：无待决策窗口对象';
    return null;
  }

  const playerIndex = state.currentPlayer;
  const me = state.players[playerIndex];

  switch (action.type) {
    case ACTION.USE_ABILITY: {
      if (state.phase !== PHASE.ABILITY) return '只能在回合开始的能力阶段发动能力';
      const card = CARD_BY_ID[action.cardId];
      if (!card) return '卡牌不存在';
      const err = validateActiveUse(state, playerIndex, action.cardId);
      if (err) return err;
      const meta = ABILITIES[card.ability];
      return validateAbilityTarget(state, playerIndex, card.ability, action.target);
    }

    case ACTION.PASS_ABILITIES:
      if (state.phase !== PHASE.ABILITY) return '当前不在能力阶段';
      return null;

    case ACTION.DRAW: {
      if (state.phase !== PHASE.DRAW) return '当前不在抽牌阶段';
      const required = getRequiredDrawCount(state);
      if (!Array.isArray(action.from) || action.from.length !== required) {
        return `本回合需抽 ${required} 张牌`;
      }
      const drawable = getDrawableShoals(state);
      for (const idx of action.from) {
        if (!drawable.includes(idx)) return '所选浅滩无牌可抽';
      }
      return null;
    }

    case ACTION.CATCH: {
      if (state.phase !== PHASE.CATCH) return '当前不在钓走阶段';
      if (state.caughtThisTurn >= getCatchLimit(state)) {
        return `本回合最多钓走 ${getCatchLimit(state)} 条鱼`;
      }
      if (!state.drawn.includes(action.cardId)) return '这张牌不在本回合抽出的牌中';
      if (!canCatch(state, playerIndex, action.cardId)) {
        return `无法钓走：需要难度 ${CARD_BY_ID[action.cardId].strength}，当前力量 ${getPower(state, playerIndex)}`;
      }
      return null;
    }

    case ACTION.THROW_BACK: {
      if (state.phase !== PHASE.CATCH) return '当前不在放生阶段';
      if (!state.drawn.includes(action.cardId)) return '这张牌不在本回合抽出的牌中';
      if (state.caughtThisTurn === 0 && getCatchableDrawn(state).length > 0) {
        return '有可钓走的鱼，必须先钓走一条';
      }
      const legal = getLegalThrowTargets(state);
      if (!legal.includes(action.shoalIndex)) return '该浅滩不是合法的放回目标';
      return null;
    }

    default:
      return '未知动作类型';
  }
}

/** 回合结束：终局判定或轮到下一位玩家 */
function endTurn(state, events) {
  // 停滞保护：本回合是否钓到鱼（整轮无人钓获 → checkGameOver 兜底终局）
  state.stagnation = state.caughtThisTurn > 0 ? 0 : state.stagnation + 1;
  if (checkGameOver(state)) {
    state.phase = PHASE.GAME_OVER;
    state.gameOver = true;
    state.winner = getWinners(state);
    events.push('game_over');
    return;
  }
  // 清空刚结束回合玩家的力量加成、凯尔派揭示态
  state.players[state.currentPlayer].powerBonus = 0;
  state.revealedTops = null;

  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  if (state.currentPlayer === 0) state.turn += 1;
  // 雪鳗护体：当再次轮到护体者时解除
  if (state.snowGuardOwner != null && state.currentPlayer === state.snowGuardOwner) {
    state.players[state.snowGuardOwner].snowGuard = false;
    state.snowGuardOwner = null;
  }
  state.phase = PHASE.ABILITY;
  state.drawn = [];
  state.drawnFrom = [];
  state.extraDraw = 0;
  state.caughtThisTurn = 0;
  state.lastPeek = null;
  events.push('turn_end');
}

export function applyAction(state, action) {
  const s = cloneState(state);
  const err = validateAction(s, action);
  if (err) return { error: err };

  const events = [];
  const playerIndex = s.currentPlayer;
  const me = s.players[playerIndex];

  switch (action.type) {
    case ACTION.USE_ABILITY: {
      const card = CARD_BY_ID[action.cardId];
      const abilityKey = card.ability;
      let pending = null;
      if (OPP_TARGETED_SET.has(abilityKey)) {
        const r = beginTargetedEffect(s, playerIndex, abilityKey, action.target || {}, action.cardId);
        pending = r.pending;
        events.push('ability_used');
      } else {
        const r = applyUnboundedAbility(
          s, playerIndex, abilityKey, action.target || {},
          { rng: createAbilityRng(s) }, action.cardId,
        );
        events.push(...r.events);
        pending = r.pending;
        if (!pending) events.push('ability_used');
      }
      // 使用后横置。断脚(GIVE_CARD)会把自己的卡交给他人（卡离开 caught），
      // 横置态已随卡转移给新主人，这里不能再标记回发起者，否则产生 stale 横置记录。
      if (me.caught.includes(action.cardId)) me.exhausted.push(action.cardId);
      if (pending) {
        s.pending = pending;
        s.phase = PHASE.PENDING;
      }
      break;
    }

    case ACTION.PASS_ABILITIES:
      s.phase = PHASE.DRAW;
      events.push('phase_draw');
      break;

    case ACTION.DRAW:
      for (const shoalIndex of action.from) {
        const cardId = s.shoals[shoalIndex].shift();
        s.drawn.push(cardId);
        s.drawnFrom.push(shoalIndex);
      }
      s.phase = PHASE.CATCH;
      events.push('draw');
      // 一张都没抽到（浅滩已被梭子鱼等移空）→ 本回合无牌可处理，直接收束回合
      if (s.drawn.length === 0) endTurn(s, events);
      break;

    case ACTION.CATCH: {
      const idx = s.drawn.indexOf(action.cardId);
      s.drawn.splice(idx, 1);
      s.drawnFrom.splice(idx, 1);
      me.caught.push(action.cardId);
      s.caughtThisTurn += 1;
      events.push('catch');
      if (s.drawn.length === 0) endTurn(s, events);
      break;
    }

    case ACTION.THROW_BACK: {
      const idx = s.drawn.indexOf(action.cardId);
      s.drawn.splice(idx, 1);
      s.drawnFrom.splice(idx, 1);
      s.shoals[action.shoalIndex].unshift(action.cardId);
      events.push('throw_back');
      if (s.drawn.length === 0) endTurn(s, events);
      break;
    }

    case ACTION.RESOLVE: {
      const r = resolvePending(s, action.resolution || {});
      events.push(...r.events);
      if (r.pending) {
        s.pending = r.pending;
      } else {
        s.pending = null;
        s.phase = PHASE.ABILITY;
      }
      break;
    }
  }

  s.actions.push({ player: playerIndex, turn: s.turn, action });
  return { state: s, events };
}