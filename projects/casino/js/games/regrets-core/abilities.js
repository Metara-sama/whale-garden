/**
 * 能力引擎：主动/被动能力元数据、目标校验、效果应用，以及"反应窗口"的编排。
 *
 * 能力三大类：
 *  active   一次性主动：回合开始能力阶段可发动，整局仅一次，发动后横置(exhausted)。
 *  passive  永续被动：常驻起效；被横置（自用或被对方横置）后失效。
 *
 * 反应窗口（pending，由 stateMachine 的 RESOLVE 动作结算）：
 *  REDIRECT   女妖：他人以某鱼为目标时，可把目标替换成自己的女妖（保护原目标）。
 *  COUNTER    僧帽水母：他人以你或你的鱼为目标时，你可以横置他的一条鱼（先于效果结算）。
 *  REARRANGE  眼球团：查看并重排一个鱼群。
 *  PASS_LEFT  腐鱼：所有玩家按座位序各选一条传给左边（无鱼跳过）。
 */
import { createRng } from './rng.js';
import { CARD_BY_ID, baseIdOf } from './cards.js';
import { passiveActive, ensureSmallTops } from './gameState.js';

export const ABILITY_TYPES = {
  DRAW_PLUS2: 'draw_plus2',
  DRAW_PLUS1: 'draw_plus1',
  POWER_PLUS3: 'power_plus3',
  EXHAUST_FOUL: 'exhaust_foul',
  EXHAUST_FAIR: 'exhaust_fair',
  EXHAUST_ANY: 'exhaust_any',
  SWAP_ANY: 'swap_any',
  SWAP_FAIR: 'swap_fair',
  SWAP_ZERO: 'swap_zero',
  REVEAL_ALL: 'reveal_all',
  PEEK_MULTI: 'peek_multi',
  SHUFFLE_ALL: 'shuffle_all',
  SNOW_GUARD: 'snow_guard',
  GIVE_CARD: 'give_card',
  PASS_LEFT: 'pass_left',
  REMOVE_ZERO: 'remove_zero',
  REARRANGE_SHOAL: 'rearrange_shoal',
  CATCH_RESTRICT_ZERO: 'catch_restrict_zero',
  CATCH_RESTRICT_HIGH: 'catch_restrict_high',
  UNTARGETABLE: 'untargetable',
  REDIRECT_TARGET: 'redirect_target',
  COUNTER_EXHAUST: 'counter_exhaust',
  FORCE_SWAP_LIONFISH: 'force_swap_lionfish',
};

export const ABILITIES = {
  draw_plus2: { kind: 'active', amount: 2, schema: null, desc: '本回合额外抽 2 张牌（看 4 张，但只能钓走 1 条）' },
  draw_plus1: { kind: 'active', amount: 1, schema: null, desc: '本回合额外抽 1 张牌（看 3 张，但只能钓走 1 条）' },
  power_plus3: { kind: 'active', amount: 3, schema: null, desc: '本回合你的力量增加 3' },
  exhaust_foul: { kind: 'active', schema: { playerIndex: 'number', cardId: 'string' }, typeFilter: 'foul', desc: '横置另一位玩家的一条邪秽鱼' },
  exhaust_fair: { kind: 'active', schema: { playerIndex: 'number', cardId: 'string' }, typeFilter: 'fair', desc: '横置另一位玩家的一条正品鱼' },
  exhaust_any: { kind: 'active', schema: { playerIndex: 'number', cardId: 'string' }, desc: '横置另一位玩家的一条鱼' },
  swap_any: { kind: 'active', schema: { playerIndex: 'number', oppCardId: 'string' }, desc: '将这条鱼与另一位玩家的鱼交换' },
  swap_fair: { kind: 'active', schema: { playerIndex: 'number', oppCardId: 'string' }, typeFilter: 'fair', desc: '将这条鱼与另一位玩家的正品鱼交换' },
  swap_zero: { kind: 'active', schema: { playerIndex: 'number', oppCardId: 'string' }, strengthFilter: 0, desc: '将这条鱼与你选择的另一位玩家难度 0 的鱼交换' },
  reveal_all: { kind: 'active', schema: null, desc: '将每个鱼群顶端的牌翻面' },
  peek_multi: { kind: 'active', schema: { shoalIndexes: 'number[]' }, desc: '查看最多 3 个鱼群顶端的牌' },
  shuffle_all: { kind: 'active', schema: null, desc: '洗混所有鱼群牌，并平分为 6 堆新鱼群' },
  snow_guard: { kind: 'active', schema: null, desc: '直到你下个回合前，能力不能影响你' },
  give_card: { kind: 'active', schema: { playerIndex: 'number' }, desc: '将这条鱼交给另一位玩家' },
  pass_left: { kind: 'active', schema: null, desc: '所有玩家将一条鱼传给左边的玩家' },
  remove_zero: { kind: 'active', schema: { shoalIndex: 'number', cardIndex: 'number', playerIndex: 'number', cardId: 'string' }, desc: '将一张难度 0 的鱼牌移除游戏（浅滩或对方已钓区）' },
  rearrange_shoal: { kind: 'active', schema: { shoalIndex: 'number' }, desc: '查看一个鱼群的所有牌，并以任意顺序放回' },
  catch_restrict_zero: { kind: 'passive', desc: '你不能捕捉难度为 0 的鱼' },
  catch_restrict_high: { kind: 'passive', desc: '有其他可选的鱼时，你不能捕捉难度 ≥3 的鱼' },
  untargetable: { kind: 'passive', desc: '其他玩家不能选定巨型乌贼为目标' },
  redirect_target: { kind: 'passive', desc: '有玩家选定一条鱼为目标时，你可以将目标替换成女妖' },
  counter_exhaust: { kind: 'passive', desc: '其他玩家以你或你的鱼为目标时，你可以横置他的一条鱼' },
  force_swap_lionfish: { kind: 'passive', desc: '其他玩家与你交换鱼时，必须选择狮子鱼' },
};

export const ACTIVE_KEYS = new Set(
  Object.keys(ABILITIES).filter((k) => ABILITIES[k].kind === 'active'),
);

function othersOf(state, idx) {
  return state.players.map((_, i) => i).filter((i) => i !== idx);
}
function playerHasCard(p, cardId) {
  return p.caught.includes(cardId);
}
function isExhausted(p, cardId) {
  return p.exhausted.includes(cardId);
}

/** 雪鳗护体：是否不可被他人当作目标 */
export function isProtected(state, playerIndex) {
  return state.players[playerIndex].snowGuard;
}

/** 巨型乌贼：他人不可将其选为目标 */
export function isUntargetableCard(cardId, controller, initiatorIdx) {
  return (
    CARD_BY_ID[cardId].ability === ABILITY_TYPES.UNTARGETABLE &&
    controller !== initiatorIdx
  );
}

/** 主动能力可发动性校验 */
export function validateActiveUse(state, playerIndex, cardId) {
  const card = CARD_BY_ID[cardId];
  if (!card) return '卡牌不存在';
  const me = state.players[playerIndex];
  if (!me.caught.includes(cardId)) return '你还没有钓到这条鱼';
  if (me.exhausted.includes(cardId)) return '这条鱼的能力已失效（已横置）';
  if (!card.ability || !ABILITIES[card.ability]) return '这条鱼没有能力';
  if (ABILITIES[card.ability].kind !== 'active') return '这是永续能力，无法主动发动';
  return null;
}

function validateDefense(state, initiatorIdx, targetPlayerIndex, cardId) {
  if (isProtected(state, targetPlayerIndex)) return '雪鳗护体中，不能以其为目标';
  if (cardId && isUntargetableCard(cardId, targetPlayerIndex, initiatorIdx)) {
    return '巨型乌贼不能被他人选定为目标';
  }
  return null;
}

/** 主动能力目标校验 */
export function validateAbilityTarget(state, playerIndex, abilityKey, target) {
  const meta = ABILITIES[abilityKey] || {};
  const invalidOpp = (msg) => msg;

  switch (abilityKey) {
    case ABILITY_TYPES.EXHAUST_FOUL:
    case ABILITY_TYPES.EXHAUST_FAIR:
    case ABILITY_TYPES.EXHAUST_ANY: {
      if (!target || typeof target.playerIndex !== 'number' || !target.cardId) return '需要指定对方的一条鱼';
      const tp = target.playerIndex;
      if (tp === playerIndex) return '不能以自己为目标';
      if (tp < 0 || tp >= state.players.length) return '玩家索引越界';
      const opp = state.players[tp];
      if (!playerHasCard(opp, target.cardId)) return '对方没有这条鱼';
      if (isExhausted(opp, target.cardId)) return '对方这条鱼已横置';
      const ty = CARD_BY_ID[target.cardId].type;
      if (meta.typeFilter && ty !== meta.typeFilter) {
        return meta.typeFilter === 'fair' ? '目标必须是正品鱼' : '目标必须是邪秽鱼';
      }
      return invalidOpp(validateDefense(state, playerIndex, tp, target.cardId));
    }

    case ABILITY_TYPES.SWAP_ANY:
    case ABILITY_TYPES.SWAP_FAIR:
    case ABILITY_TYPES.SWAP_ZERO: {
      if (!target || typeof target.playerIndex !== 'number' || !target.oppCardId) return '需要指定对方的一条鱼';
      const tp = target.playerIndex;
      if (tp === playerIndex) return '不能以自己为目标';
      if (tp < 0 || tp >= state.players.length) return '玩家索引越界';
      const opp = state.players[tp];
      if (!playerHasCard(opp, target.oppCardId)) return '对方没有这条鱼';
      if (isExhausted(opp, target.oppCardId)) return '对方这条鱼已横置';
      if (meta.typeFilter && CARD_BY_ID[target.oppCardId].type !== meta.typeFilter) {
        return meta.typeFilter === 'fair' ? '目标必须是正品鱼' : '目标必须是邪秽鱼';
      }
      if (meta.strengthFilter != null && CARD_BY_ID[target.oppCardId].strength !== meta.strengthFilter) {
        return `目标必须是难度 ${meta.strengthFilter} 的鱼`;
      }
      if (passiveActive(state, tp, ABILITY_TYPES.FORCE_SWAP_LIONFISH) && baseIdOf(target.oppCardId) !== 'lionfish') {
        return '对方有狮子鱼，交换必须选择狮子鱼';
      }
      return invalidOpp(validateDefense(state, playerIndex, tp, target.oppCardId));
    }

    case ABILITY_TYPES.GIVE_CARD: {
      if (!target || typeof target.playerIndex !== 'number') return '需要指定一位玩家';
      const tp = target.playerIndex;
      if (tp === playerIndex) return '不能把鱼交给自己';
      if (tp < 0 || tp >= state.players.length) return '玩家索引越界';
      return invalidOpp(validateDefense(state, playerIndex, tp, null));
    }

    case ABILITY_TYPES.PEEK_MULTI: {
      if (!target || !Array.isArray(target.shoalIndexes)) return '需要指定鱼群';
      const ks = target.shoalIndexes;
      if (ks.length < 1 || ks.length > 3) return '只能查看 1-3 个鱼群';
      if (new Set(ks).size !== ks.length) return '鱼群不能重复';
      for (const i of ks) {
        if (i < 0 || i >= state.shoals.length) return '鱼群索引越界';
        if (state.shoals[i].length === 0) return '空鱼群无法查看';
      }
      return null;
    }

    case ABILITY_TYPES.REARRANGE_SHOAL: {
      if (!target || typeof target.shoalIndex !== 'number') return '需要指定一个鱼群';
      const i = target.shoalIndex;
      if (i < 0 || i >= state.shoals.length) return '鱼群索引越界';
      if (state.shoals[i].length === 0) return '空鱼群无法查看';
      return null;
    }

    case ABILITY_TYPES.REMOVE_ZERO: {
      // 目标 A：浅滩中的难度 0 牌 { shoalIndex, cardIndex }
      if (target && typeof target.shoalIndex === 'number' && typeof target.cardIndex === 'number') {
        const s = state.shoals[target.shoalIndex];
        if (!s || target.cardIndex < 0 || target.cardIndex >= s.length) return '鱼群位置越界';
        if (CARD_BY_ID[s[target.cardIndex]].strength !== 0) return '只能移除难度 0 的鱼牌';
        return null;
      }
      // 目标 B：对方已钓的难度 0 牌 { playerIndex, cardId }
      if (target && typeof target.playerIndex === 'number' && typeof target.cardId === 'string') {
        const tp = target.playerIndex;
        if (tp === playerIndex) return '不能移除自己的鱼';
        if (tp < 0 || tp >= state.players.length) return '玩家索引越界';
        const opp = state.players[tp];
        if (!playerHasCard(opp, target.cardId)) return '对方没有这条鱼';
        if (CARD_BY_ID[target.cardId].strength !== 0) return '只能移除难度 0 的鱼牌';
        return invalidOpp(validateDefense(state, playerIndex, tp, target.cardId));
      }
      return '需要指定一张难度 0 的鱼牌（浅滩或对方已钓区）';
    }

    case ABILITY_TYPES.PASS_LEFT:
    case ABILITY_TYPES.REVEAL_ALL:
    case ABILITY_TYPES.SHUFFLE_ALL:
    case ABILITY_TYPES.SNOW_GUARD:
    case ABILITY_TYPES.DRAW_PLUS1:
    case ABILITY_TYPES.DRAW_PLUS2:
    case ABILITY_TYPES.POWER_PLUS3:
      return null;

    default:
      return '未知能力类型';
  }
}

/** 可触发"女妖改向"的玩家（座位序） */
export function getRedirectCandidates(state, initiatorIdx) {
  return othersOf(state, initiatorIdx).filter((i) =>
    passiveActive(state, i, ABILITY_TYPES.REDIRECT_TARGET),
  );
}

/** 目标玩家的僧帽水母反击发起者（有可横置目标时才成立） */
export function getCounterPlayer(state, targetPlayerIndex) {
  if (!passiveActive(state, targetPlayerIndex, ABILITY_TYPES.COUNTER_EXHAUST)) return null;
  return targetPlayerIndex;
}

/** 僧帽可横置的对方鱼 */
export function getCounterTargets(state, targetPlayerIndex) {
  const p = state.players[targetPlayerIndex];
  return p.caught.filter(
    (id) =>
      !p.exhausted.includes(id) &&
      CARD_BY_ID[id].ability !== ABILITY_TYPES.UNTARGETABLE,
  );
}

/* ============ 效果应用 ============ */

/** 最终结算"以对方之鱼为目标"（横置 / 交换）。target 已通过校验与全部反应窗口。 */
function applyTargetedEffect(state, initiatorIdx, abilityKey, target) {
  const me = state.players[initiatorIdx];
  const opp = state.players[target.playerIndex];

  switch (abilityKey) {
    case ABILITY_TYPES.EXHAUST_FOUL:
    case ABILITY_TYPES.EXHAUST_FAIR:
    case ABILITY_TYPES.EXHAUST_ANY:
      opp.exhausted.push(target.cardId);
      break;
    case ABILITY_TYPES.SWAP_ANY:
    case ABILITY_TYPES.SWAP_FAIR:
    case ABILITY_TYPES.SWAP_ZERO: {
      const myIdx = me.caught.indexOf(target.dispenseCardId);
      const oppIdx = opp.caught.indexOf(target.oppCardId);
      if (myIdx === -1 || oppIdx === -1) throw new Error('交换目标卡牌缺失');
      me.caught[myIdx] = target.oppCardId;
      opp.caught[oppIdx] = target.dispenseCardId;
      break;
    }
  }
}

/**
 * 发起"以他人之鱼为目标"的主动效果，视情况进入 REDIRECT / COUNTER 窗口。
 * @param {string} dCardId 我方付出的主动卡（交换时交出）
 */
export function beginTargetedEffect(state, initiatorIdx, abilityKey, target, dCardId) {
  if (abilityKey === ABILITY_TYPES.SWAP_ANY ||
      abilityKey === ABILITY_TYPES.SWAP_FAIR ||
      abilityKey === ABILITY_TYPES.SWAP_ZERO) {
    target.dispenseCardId = dCardId;
  }

  const candidates = getRedirectCandidates(state, initiatorIdx);
  if (candidates.length > 0) {
    return { events: [], pending: {
      type: 'REDIRECT', initiatorIdx, abilityKey, target,
      candidates, targetCardId: target.cardId || target.oppCardId || null,
    } };
  }
  return continueOrApplyCounter(state, initiatorIdx, abilityKey, target);
}

/** 接力：尝试进入僧帽反击窗口，否则直接结算 */
function continueOrApplyCounter(state, initiatorIdx, abilityKey, target) {
  const counterP = getCounterPlayer(state, target.playerIndex);
  if (counterP != null && getCounterTargets(state, initiatorIdx).length > 0) {
    return { events: [], pending: {
      type: 'COUNTER', initiatorIdx, abilityKey, target,
      counterP, counterTargets: getCounterTargets(state, initiatorIdx),
    } };
  }
  applyTargetedEffect(state, initiatorIdx, abilityKey, target);
  return { events: [], applied: true };
}

/** 结算一个 pending 窗口 */
export function resolvePending(state, resolution) {
  const pending = state.pending;
  if (!pending) throw new Error('当前没有待决策窗口');

  switch (pending.type) {
    case 'REDIRECT': {
      const accepted = resolution.use && typeof resolution.candidateIdx === 'number';
      const target = pending.target;
      let initiatorIdx = pending.initiatorIdx;
      let abilityKey = pending.abilityKey;
      if (accepted) {
        const candIdx = pending.candidates[resolution.candidateIdx];
        const cand = state.players[candIdx];
        // 多副牌组下女妖可能是 `banshee#2` 这样的实例，必须指向它真正持有的那张，
        // 否则横置/交换会作用到一个不存在的 id 上（原实现单副牌时就是字符串 'banshee'）。
        const bansheeId = cand.caught.find(
          (id) => CARD_BY_ID[id] && CARD_BY_ID[id].ability === ABILITY_TYPES.REDIRECT_TARGET,
        ) || 'banshee';
        target.cardId = bansheeId;
        target.oppCardId = bansheeId;
        target.playerIndex = candIdx;
      }
      return continueOrApplyCounter(state, initiatorIdx, abilityKey, target, target.dispenseCardId);
    }

    case 'COUNTER': {
      if (resolution.use && resolution.cardId) {
        const p = state.players[pending.initiatorIdx];
        if (p.caught.includes(resolution.cardId) && !p.exhausted.includes(resolution.cardId)) {
          p.exhausted.push(resolution.cardId);
        }
      }
      applyTargetedEffect(state, pending.initiatorIdx, pending.abilityKey, pending.target);
      return { events: [], pending: null };
    }

    case 'REARRANGE': {
      if (!Array.isArray(resolution.order)) throw new Error('缺少重排顺序');
      const s = state.shoals[pending.shoalIndex];
      if (new Set(resolution.order).size !== s.length ||
          resolution.order.some((id) => !s.includes(id))) {
        throw new Error('重排顺序必须恰好包含该鱼群全部牌');
      }
      state.shoals[pending.shoalIndex] = resolution.order.slice();
      return { events: [], pending: null };
    }

    case 'PASS_LEFT': {
      pending.queue[pending.current] = resolution.pick;
      if (pending.current < pending.playerIndices.length - 1) {
        pending.current += 1;
        pending.queue.push(null);
        return { events: [], pending };
      }
      const n = state.players.length;
      pending.playerIndices.forEach((fromIdx, k) => {
        const cardId = pending.queue[k];
        if (cardId == null) return;
        const toIdx = (fromIdx + 1) % n;
        const from = state.players[fromIdx];
        const to = state.players[toIdx];
        const i = from.caught.indexOf(cardId);
        if (i === -1) return;
        from.caught.splice(i, 1);
        to.caught.push(cardId);
        // 横置状态随卡转移：腐鱼发动后传自身，接收方这张牌仍横置，不能重复发动
        const eIdx = from.exhausted.indexOf(cardId);
        if (eIdx !== -1) {
          from.exhausted.splice(eIdx, 1);
          to.exhausted.push(cardId);
        }
      });
      return { events: [], pending: null };
    }

    default:
      throw new Error('未知待决策窗口');
  }
}

/**
 * 应用"无目标/少步骤"的主动能力。
 * @param {string} dCardId 本动作发放的主动卡（give 用）
 * @returns {{events:string[], pending?:object|null}}
 */
export function applyUnboundedAbility(state, playerIndex, abilityKey, target, ctx, dCardId) {
  const me = state.players[playerIndex];
  const events = [];

  switch (abilityKey) {
    case ABILITY_TYPES.DRAW_PLUS2: state.extraDraw += 2; events.push('draw_extra'); break;
    case ABILITY_TYPES.DRAW_PLUS1: state.extraDraw += 1; events.push('draw_extra'); break;
    case ABILITY_TYPES.POWER_PLUS3: me.powerBonus += 3; events.push('power_plus'); break;
    case ABILITY_TYPES.REVEAL_ALL:
      state.revealedTops = {
        shoalIndexes: state.shoals.map((s, i) => (s.length > 0 ? i : -1)).filter((i) => i !== -1),
      };
      events.push('reveal_all');
      break;
    case ABILITY_TYPES.PEEK_MULTI: {
      state.lastPeek = {
        player: playerIndex,
        shoalIndexes: target.shoalIndexes,
        cardIds: target.shoalIndexes.map((i) => ({ shoalIndex: i, cardId: state.shoals[i][0] })),
      };
      events.push('peek_multi');
      break;
    }
    case ABILITY_TYPES.SHUFFLE_ALL: {
      const rng = ctx.rng;
      const all = [];
      state.shoals.forEach((s) => all.push(...s));
      const shuffled = rng.shuffle(all);
      const shoalCount = state.shoals.length; // 单副 6 堆，多副按比例（原实现固定 NUM_SHOALS）
      const newShoals = Array.from({ length: shoalCount }, () => []);
      shuffled.forEach((id, k) => newShoals[k % shoalCount].push(id));
      ensureSmallTops(newShoals, rng);
      state.shoals = newShoals;
      events.push('shuffle_all');
      break;
    }
    case ABILITY_TYPES.SNOW_GUARD:
      me.snowGuard = true;
      state.snowGuardOwner = playerIndex;
      events.push('snow_guard');
      break;
    case ABILITY_TYPES.GIVE_CARD: {
      const dIdx = me.caught.indexOf(dCardId);
      if (dIdx === -1) throw new Error('give_card：找不到要送出的鱼');
      // 横置态随卡转移到新主人：主动已用（牌被消耗），原主也不残留 stale 横置记录
      const eIdx = me.exhausted.indexOf(dCardId);
      if (eIdx !== -1) me.exhausted.splice(eIdx, 1);
      me.caught.splice(dIdx, 1);
      const recv = state.players[target.playerIndex];
      recv.caught.push(dCardId);
      recv.exhausted.push(dCardId);
      events.push('give_card');
      break;
    }
    case ABILITY_TYPES.REMOVE_ZERO:
      if (typeof target.playerIndex === 'number' && typeof target.cardId === 'string') {
        const opp = state.players[target.playerIndex];
        const ri = opp.caught.indexOf(target.cardId);
        if (ri === -1) throw new Error('remove_zero：找不到对方已钓的鱼');
        opp.caught.splice(ri, 1);
        const ei = opp.exhausted.indexOf(target.cardId);
        if (ei !== -1) opp.exhausted.splice(ei, 1); // 移出游戏，横置态一并清除
      } else {
        state.shoals[target.shoalIndex].splice(target.cardIndex, 1);
      }
      events.push('remove_zero');
      break;
    case ABILITY_TYPES.PASS_LEFT: {
      const playerIndices = state.players
        .map((_, i) => i)
        .filter((i) => state.players[i].caught.length > 0);
      if (playerIndices.length === 0) { events.push('pass_left'); return { events, pending: null }; }
      state.pending = { type: 'PASS_LEFT', playerIndices, current: 0, queue: [null] };
      events.push('pass_left');
      return { events, pending: state.pending };
    }
    case ABILITY_TYPES.REARRANGE_SHOAL:
      state.pending = {
        type: 'REARRANGE',
        owner: playerIndex,
        shoalIndex: target.shoalIndex,
        cards: state.shoals[target.shoalIndex].slice(),
      };
      return { events, pending: state.pending };

    default:
      throw new Error(`无法应用能力: ${abilityKey}`);
  }
  return { events, pending: null };
}

/** 供状态机使用的确定性随机上下文 */
export function createAbilityRng(state) {
  return createRng(state.seed + state.actions.length);
}

/**
 * 确定性消解当前 pending 窗口（供 AI / 观战 / 在线托管 / Solo 脚本自动结算）。
 * 返回 RESOLVE 动作的 resolution 对象（调用方自行包成 { type:'RESOLVE', resolution }）。
 */
export function autoResolution(state) {
  const p = state.pending;
  if (!p) return {};
  switch (p.type) {
    case 'REDIRECT':
      // 默认不改向，保护原目标
      return { use: false };
    case 'COUNTER':
      // 默认横置攻击者的第一条可横置鱼
      return { use: p.counterTargets.length > 0, cardId: p.counterTargets[0] };
    case 'REARRANGE':
      // 保持原顺序放回
      return { order: (state.shoals[p.shoalIndex] || []).slice() };
    case 'PASS_LEFT': {
      const fromIdx = p.playerIndices[p.current];
      const pick = state.players[fromIdx]?.caught?.[0];
      return { pick };
    }
    default:
      return {};
  }
}