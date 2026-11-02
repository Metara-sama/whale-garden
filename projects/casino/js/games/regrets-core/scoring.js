/**
 * 终局计分。
 * 计分 = 各玩家钓获分值之和；钓到最多"污秽鱼"的玩家额外 -2 分（并列都扣）；
 * 总分最高者胜；并列最高者共享胜局（平局）。
 */
import { CARD_BY_ID } from './cards.js';

export const FOUL_PENALTY = -2;

/** 某玩家钓到的污秽鱼数量 */
export function getFoulCount(state, playerIndex) {
  return state.players[playerIndex].caught.filter((id) => CARD_BY_ID[id].type === 'foul').length;
}

/** 某玩家当前原始分（已钓卡 points 之和，不含污秽惩罚；对局中实时显示用） */
export function getRawScore(state, playerIndex) {
  return state.players[playerIndex].caught.reduce((sum, id) => sum + CARD_BY_ID[id].points, 0);
}

/** 某玩家最终得分（含污秽惩罚） */
export function getPlayerScore(state, playerIndex) {
  const p = state.players[playerIndex];
  const base = p.caught.reduce((sum, id) => sum + CARD_BY_ID[id].points, 0);
  const foulCount = getFoulCount(state, playerIndex);
  const maxFoul = Math.max(...state.players.map((_, i) => getFoulCount(state, i)));
  const penalty = maxFoul > 0 && foulCount === maxFoul ? FOUL_PENALTY : 0;
  return base + penalty;
}

/** 完整结算结果（含钓获明细，供结算页渲染） */
export function getResults(state) {
  return state.players.map((p, i) => ({
    playerIndex: i,
    name: p.name,
    caught: p.caught.map((id) => CARD_BY_ID[id]),
    foulCount: getFoulCount(state, i),
    score: getPlayerScore(state, i),
  }));
}

/** 胜者玩家索引数组（可多个 = 平局） */
export function getWinners(state) {
  const results = getResults(state);
  const max = Math.max(...results.map((r) => r.score));
  return results.filter((r) => r.score === max).map((r) => r.playerIndex);
}
