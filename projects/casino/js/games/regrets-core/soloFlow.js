/**
 * M5 Solo 流程控制：玩家 vs 脚本对手。
 * UI 无关（可单测）：管理状态、玩家动作派发、脚本自动行动、结算评价。
 * 特色机制（压迫节奏 / 星级评价）见 docs/RULES.md 第十一章。
 */
import { createInitialState } from './gameState.js';
import { applyAction, ACTION, PHASE } from './stateMachine.js';
import { autoResolution } from './abilities.js';
import { getResults } from './scoring.js';
import { CARD_BY_ID } from './cards.js';
import { chooseScriptAction, SCRIPT_NAME, TARGETS } from './soloScript.js';

/** 当前 pending 窗口是否轮到脚本决策 */
function shouldScriptResolve(state, scriptIndex) {
  const p = state.pending;
  if (!p) return false;
  switch (p.type) {
    case 'REDIRECT': return p.candidates.includes(scriptIndex);
    case 'COUNTER': return p.counterP === scriptIndex;
    case 'REARRANGE': return p.owner === scriptIndex;
    case 'PASS_LEFT': return p.playerIndices[p.current] === scriptIndex;
    default: return false;
  }
}

export class SoloController {
  /**
   * @param {{playerName:string, seed:number, first?:'player'|'script'}} opts
   */
  constructor({ playerName, seed, first = 'player' }) {
    const names = first === 'player' ? [playerName, SCRIPT_NAME] : [SCRIPT_NAME, playerName];
    this.state = createInitialState({ seed, playerNames: names });
    this.playerIndex = first === 'player' ? 0 : 1;
    this.scriptIndex = first === 'player' ? 1 : 0;
    this.seed = seed;
    this.onUpdate = null; // (state) => void
    this.onGameOver = null; // () => void
  }

  isPlayerTurn() {
    return this.state.currentPlayer === this.playerIndex && this.state.phase !== PHASE.GAME_OVER;
  }

  isScriptTurn() {
    return this.state.currentPlayer === this.scriptIndex && this.state.phase !== PHASE.GAME_OVER;
  }

  /** 玩家派发动作（返回错误信息或 null） */
  dispatch(action) {
    if (!this.isPlayerTurn()) return '还没轮到你行动';
    const res = applyAction(this.state, action);
    if (res.error) return res.error;
    this.state = res.state;
    this.drainScriptPending();
    this.onUpdate?.(this.state);
    if (this.state.phase === PHASE.GAME_OVER) this.onGameOver?.();
    return null;
  }

  /** 脚本执行一个动作（确定性剧本决策，含让脚本自动消解其反应窗口） */
  runScriptAction() {
    if (!this.isScriptTurn()) return false;
    const action = chooseScriptAction(this.state);
    if (!action) return false;
    const res = applyAction(this.state, action);
    if (res.error) return false;
    this.state = res.state;
    this.drainScriptPending();
    this.onUpdate?.(this.state);
    if (this.state.phase === PHASE.GAME_OVER) this.onGameOver?.();
    return true;
  }

  /** 玩家/脚本动作后，自动消解轮到脚本的 pending 窗口（避免 Solo 卡死） */
  drainScriptPending() {
    let guard = 0;
    while (this.state.phase === PHASE.PENDING && shouldScriptResolve(this.state, this.scriptIndex) && guard++ < 20) {
      const res = applyAction(this.state, { type: ACTION.RESOLVE, resolution: autoResolution(this.state) });
      if (res.error) break;
      this.state = res.state;
    }
  }

  /**
   * 实时特色目标进度（对局中展示；终局时与 getEvaluation 一致），见 RULES.md 11.6。
   * 每项目标带三态 status：progress（进行中）/ failed（已失败）/ done（已达成）。
   * 注意 noFoul 为"全程型"目标：开局 0 条污秽不算达成，只有终局且全程无污秽才算；
   * 一旦钓到污秽立即转 failed。
   */
  getLiveGoals() {
    const s = this.state;
    const me = s.players[this.playerIndex];
    const results = getResults(s);
    const myScore = results.find((r) => r.playerIndex === this.playerIndex).score;
    const scriptScore = results.find((r) => r.playerIndex === this.scriptIndex).score;
    const grabbed = me.caught.filter((id) => TARGETS.includes(id)).length;
    const foulCount = me.caught.filter((id) => CARD_BY_ID[id].type === 'foul').length;
    const over = s.phase === PHASE.GAME_OVER;
    const krakenCaught = me.caught.includes('kraken');
    const beat = myScore > scriptScore;
    return {
      beatScript: { done: beat, status: beat ? 'done' : over ? 'failed' : 'progress', text: `${myScore} > ${scriptScore}` },
      caughtKraken: { done: krakenCaught, status: krakenCaught ? 'done' : over ? 'failed' : 'progress', text: krakenCaught ? '已钓到' : '未钓到' },
      noFoul: {
        done: over && foulCount === 0,
        status: foulCount > 0 ? 'failed' : over ? 'done' : 'progress',
        text: foulCount > 0 ? `已钓 ${foulCount} 条污秽` : over ? '全程无污秽' : '暂无污秽',
      },
      grabbedTargets: { done: grabbed >= 3, status: grabbed >= 3 ? 'done' : over ? 'failed' : 'progress', text: `${grabbed}/3` },
    };
  }

  /** 结算评价：特色目标达成情况 + 星级 + 等级（见 RULES.md 11.6） */
  getEvaluation() {
    const live = this.getLiveGoals();
    const goals = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, v.done]));
    const stars = Object.values(goals).filter(Boolean).length;
    const rank = stars <= 1 ? '浅滩之耻' : stars === 2 ? '勉强及格' : stars === 3 ? '合格渔夫' : '深海传奇';
    const results = getResults(this.state);
    return {
      goals,
      stars,
      rank,
      myResult: results.find((r) => r.playerIndex === this.playerIndex),
      scriptResult: results.find((r) => r.playerIndex === this.scriptIndex),
    };
  }
}
