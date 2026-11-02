/**
 * 可注入种子的伪随机数生成器（mulberry32）。
 * 同一 seed 必然产生同一序列，用于测试复现、对局回放与联机同步。
 * 纯函数式设计：不持有全局状态，所有随机操作都通过返回的 rng 实例。
 */

export function createRng(seed) {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9; // 避免 0 种子导致全 0 序列

  function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** 返回 [0, 1) 的浮点数 */
    next,
    /** 返回 [0, max) 的整数 */
    int(max) {
      return Math.floor(next() * max);
    },
    /** 从数组中随机取一个元素（不改原数组） */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    /** Fisher-Yates 洗牌，返回新数组，不改原数组 */
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
