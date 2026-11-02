/**
 * 24 张鱼卡定义 —— 全项目唯一数据源。
 * 字段：
 *   id        唯一键（也是卡图 key：public/cards/{id}.jpg）
 *   name      中文名
 *   nameEn    英文名
 *   points    积分（可负：污秽惩罚之外的负分鱼）
 *   strength  难度（所需钩数，0-5）
 *   hooks     钓获后提供的钩数
 *   type      fair 正品 | foul 邪秽
 *   ability   能力键（null 表示无能力；见 js/core/abilities.js 的 ABILITIES 表）
 *
 * 能力频率（已与作者确认）：
 *   active  一次性主动：整局仅一次，发动后横置（exhausted）
 *   passive 永续被动：常驻起效；被横置（无论自用与否）后失效
 *   能力阶段（每回合开始，该玩家钓到的未横置主动牌逐个发动）。
 *
 * 钩子机构：钓到鱼后其 hooks 计入你的钩池；捕鱼要求 当前钩数 ≥ 目标难度。
 *   分值 > 3 的大鱼与部分中鱼不供钩（单卡钩子数显式给出，不沿用"分值>3不供钩"旧规则）。
 */
export const CARDS = [
  // —— 小鱼（strength 0，开局易钓）——
  { id: 'lamprey', name: '七鳃鳗', nameEn: 'Lamprey', points: 1, strength: 0, hooks: 1, type: 'fair', ability: 'draw_plus1' },
  { id: 'seaBishop', name: '海主教', nameEn: 'Sea Bishop', points: 1, strength: 0, hooks: 1, type: 'foul', ability: 'shuffle_all' },
  { id: 'seaMonkey', name: '海猴', nameEn: 'Sea Monkey', points: -2, strength: 0, hooks: 3, type: 'foul', ability: 'catch_restrict_zero' },
  { id: 'severedFoot', name: '断脚', nameEn: 'Severed Foot', points: -1, strength: 0, hooks: 2, type: 'foul', ability: 'give_card' },
  { id: 'eyeballBlob', name: '眼球团', nameEn: 'Eyeball Blob', points: 1, strength: 0, hooks: 1, type: 'foul', ability: 'rearrange_shoal' },
  { id: 'rotfish', name: '腐鱼', nameEn: 'Rotfish', points: -1, strength: 0, hooks: 2, type: 'foul', ability: 'pass_left' },
  { id: 'dayOctopus', name: '日间章鱼', nameEn: 'Day Octopus', points: 1, strength: 0, hooks: 0, type: 'fair', ability: 'swap_zero' },
  { id: 'barracuda', name: '梭子鱼', nameEn: 'Barracuda', points: 0, strength: 0, hooks: 1, type: 'fair', ability: 'remove_zero' },
  { id: 'whiptailStingray', name: '鞭尾魟鱼', nameEn: 'Whiptail Stingray', points: 0, strength: 0, hooks: 1, type: 'fair', ability: 'exhaust_any' },

  // —— 低中鱼（strength 1）——
  { id: 'oarfish', name: '皇带鱼', nameEn: 'Oarfish', points: 2, strength: 1, hooks: 1, type: 'fair', ability: 'draw_plus2' },
  { id: 'mermaid', name: '美人鱼', nameEn: 'Mermaid', points: 2, strength: 1, hooks: 1, type: 'foul', ability: 'peek_multi' },
  { id: 'snowEel', name: '雪鳗', nameEn: 'Snow Eel', points: 2, strength: 1, hooks: 1, type: 'fair', ability: 'snow_guard' },
  { id: 'manOWar', name: '僧帽水母', nameEn: "Man o' War", points: 0, strength: 1, hooks: 1, type: 'fair', ability: 'counter_exhaust' },
  { id: 'lionfish', name: '狮子鱼', nameEn: 'Lionfish', points: 0, strength: 1, hooks: 1, type: 'fair', ability: 'force_swap_lionfish' },

  // —— 中鱼（strength 2）——
  { id: 'sealMan', name: '海豹人', nameEn: 'Seal Man', points: 3, strength: 2, hooks: 1, type: 'foul', ability: 'swap_any' },
  { id: 'banshee', name: '女妖', nameEn: 'Banshee', points: 3, strength: 2, hooks: 1, type: 'foul', ability: 'redirect_target' },
  { id: 'everSquid', name: '永动鱿鱼', nameEn: 'Ever-Squid', points: 2, strength: 2, hooks: 0, type: 'foul', ability: 'exhaust_fair' },
  { id: 'giantOctopus', name: '巨型章鱼', nameEn: 'Giant Octopus', points: 2, strength: 2, hooks: 1, type: 'fair', ability: 'swap_fair' },

  // —— 大鱼（strength 3-5）——
  { id: 'swordfish', name: '旗鱼', nameEn: 'Swordfish', points: 3, strength: 3, hooks: 0, type: 'fair', ability: 'exhaust_foul' },
  { id: 'giantSquid', name: '巨型乌贼', nameEn: 'Giant Squid', points: 3, strength: 3, hooks: 0, type: 'fair', ability: 'untargetable' },
  { id: 'greatWhite', name: '大白鲨', nameEn: 'Great White Shark', points: 3, strength: 3, hooks: 0, type: 'fair', ability: 'power_plus3' },
  { id: 'elderThing', name: '旧日支配者', nameEn: 'Elder Thing', points: 5, strength: 4, hooks: 0, type: 'foul', ability: 'catch_restrict_high' },
  { id: 'kelpie', name: '凯尔派', nameEn: 'Kelpie', points: 4, strength: 4, hooks: 0, type: 'foul', ability: 'reveal_all' },
  { id: 'kraken', name: '挪威海怪', nameEn: 'Norwegian Kraken', points: 5, strength: 5, hooks: 0, type: 'foul', ability: null },
];

/**
 * 卡牌索引。
 *
 * 原实现：`Object.fromEntries(CARDS.map(c => [c.id, c]))`。
 * 本页要做「n 倍牌组」，同一种鱼会出现多个实例（id 形如 `kraken#1`），
 * 因此这里改成 Proxy：查 `kraken#1` 时自动落到基础卡 `kraken` 上，
 * 其余代码（rules / abilities / scoring / AI）无需改动即可照旧 `CARD_BY_ID[id]`。
 */
const CARD_INDEX = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const CARD_BY_ID = new Proxy(Object.create(null), {
  get(_t, key) {
    if (typeof key !== 'string') return undefined;
    const base = key.includes('#') ? key.slice(0, key.indexOf('#')) : key;
    return CARD_INDEX[base];
  },
  has(_t, key) {
    if (typeof key !== 'string') return false;
    return !!CARD_INDEX[key.includes('#') ? key.slice(0, key.indexOf('#')) : key];
  },
  ownKeys() { return Object.keys(CARD_INDEX); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});

export const TOTAL_CARDS = CARDS.length; // 24

/**
 * 拓展《Lingering Remorse》的 6 张卡。
 *
 * 官方描述：「Add the 6 expansion cards to the core 18-card game … the new expansion
 * creatures feature lingering effects. These ongoing abilities remain active unless the
 * creature is exhausted.」
 *
 * 判定依据：这 6 张正是本卡池里唯一带「永续被动」能力的 6 张
 * （catch_restrict_zero / catch_restrict_high / untargetable / redirect_target /
 *   counter_exhaust / force_swap_lionfish），与「lingering effects」一一对应。
 */
export const LINGERING_EXPANSION_IDS = ['seaMonkey', 'banshee', 'manOWar', 'lionfish', 'giantSquid', 'elderThing'];
export const isExpansionCard = (id) => LINGERING_EXPANSION_IDS.includes(String(id).split('#')[0]);

/**
 * 生成一副（或多副）牌组：mult=1 时 id 就是卡牌 id；
 * mult>1 时同种鱼各带 `#k` 后缀，成为互相独立的实例。
 * @param {number} mult 牌组倍数
 * @param {boolean} includeExpansion 是否加入《Lingering Remorse》的 6 张拓展卡
 */
export function buildDeck(mult = 1, includeExpansion = true) {
  const out = [];
  const m = Math.max(1, Math.min(3, mult | 0 || 1));
  for (let k = 0; k < m; k++) {
    for (const c of CARDS) {
      if (!includeExpansion && LINGERING_EXPANSION_IDS.includes(c.id)) continue;
      out.push(m === 1 ? c.id : `${c.id}#${k}`);
    }
  }
  return out;
}

/** 方便 UI 判断一张牌是不是狮子鱼（含多副实例） */
export const baseIdOf = (id) => (String(id).includes('#') ? String(id).slice(0, String(id).indexOf('#')) : String(id));