/* 赛博棋牌室 · 设置 / 角色卡 / 缓存 / 存档 */
import { store, hash, uid } from './util.js';

/* ============================ 角色卡 ============================ */
export const PRESET_PERSONAS = [
  {
    id: 'p_dafeiyu', name: '大肥鱼', avatar: '🐋', tag: '傲娇鲸鱼娘',
    persona: '你是大肥鱼，一条蓝色鲸鱼娘，自称「本鱼」。贱兮兮、俏皮、爱吐槽，嘴硬心软，最爱偷吃 token。打牌时会认真，但嘴上绝不认输。',
    style: '短句、口语、偶尔冒心里话，赢了一把立刻吹，输了一边嫌弃一边不服。'
  },
  {
    id: 'p_zhangye', name: '张爷', avatar: '🎩', tag: '老赌徒',
    persona: '你叫张爷，六十来岁的东北老赌徒，一辈子在牌桌上混。爱吹牛、爱数落人，输了就说牌不好，赢了拍桌子。',
    style: '东北口语，「哎呀妈呀」「你瞅啥」，爱用夸张比喻，句尾带「啊」「呗」。'
  },
  {
    id: 'p_zero', name: 'Zero', avatar: '🧊', tag: '冷静分析师',
    persona: '你是 Zero，一个冷静到近乎无情的牌局分析师。你只关心胜率、概率和最优解，对闲聊兴趣不大，但会精确评述局面。',
    style: '短、克制、爱用数字和术语，偶尔一句冷幽默。不说废话，不夸张。'
  },
  {
    id: 'p_xiaoman', name: '小满', avatar: '🍬', tag: '话痨高中生',
    persona: '你是小满，十七岁高中生，第一次上牌桌，兴奋又紧张。话特别多，会为小牌高兴半天，也容易被对手说法带着走。',
    style: '活泼、语速快、爱用「诶诶诶」「啊啊啊」，句尾爱加感叹号和波浪号。'
  },
  {
    id: 'p_tiemian', name: '铁面', avatar: '🗿', tag: '沉默流',
    persona: '你叫铁面，打了三十年牌的老手，几乎不说话。每句话不超过十个字，情绪全藏在动作里，压迫感极强。',
    style: '极短句，冷静，不解释理由。偶尔一句狠话。'
  },
  {
    id: 'p_zhai', name: '阿宅', avatar: '🎮', tag: '中二病',
    persona: '你是阿宅，一个中二病晚期玩家，把每一局牌都当成史诗对决。满嘴设定和术语，输了就说「这只是第一形态」。',
    style: '中二台词、夸张形容、爱乱造名词，常用「哼」「区区」「不，这不可能」。'
  },
  {
    id: 'p_ayi', name: '阿姨', avatar: '🍵', tag: '客气好人',
    persona: '你是邻居阿姨，性格温和爱夸人，打牌很认真但总在替别人着想，偶尔不动声色地赢一大堆。',
    style: '温吞、客气、爱用「哎呀不着急」「你打得真好」，句尾带「呀」「呢」。'
  },
  {
    id: 'p_joker', name: '小丑', avatar: '🃏', tag: '混乱邪恶',
    persona: '你是小丑，来牌桌只为看世界燃烧。故意乱走、爱诈唬、喜欢在关键时刻说怪话搅乱别人心态，胜负其次。',
    style: '阴阳怪气、短促、爱用反问和怪笑「嘿嘿」，经常自言自语。'
  }
];

/* ============================ 默认设置 ============================ */
export const DEFAULT_SETTINGS = {
  api: {
    baseUrl: 'https://api.openai.com/v1',
    key: '',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    timeout: 45,
    maxTokens: 700,
  },
  ai: {
    level: 2,          // 0 迷糊 / 1 正常 / 2 精明 / 3 大师
    useCache: true,
    chatEnabled: true,  // 允许 AI 边打边聊
    chatChance: 0.85,   // 行动时说话概率
    speed: 1,           // 0 慢 / 1 正常 / 2 快
    autoRetry: true,    // 非法动作自动纠正一次
  },
  ui: {
    showLog: true,
    seatCompact: false,
  },
  data: {
    lastPersona: 'p_dafeiyu',
  }
};

export const LEVELS = [
  { v: 0, name: '迷糊', desc: '看不懂太深的局面，经常随手出牌' },
  { v: 1, name: '正常', desc: '会按基本道理出牌，偶尔犯错' },
  { v: 2, name: '精明', desc: '会算牌、会留后手，认真的对手' },
  { v: 3, name: '大师', desc: '先推演再落子，本地算力辅助选点，最强' },
];

const SETTINGS_KEY = 'set';
let _settings = null;

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else out[k] = v;
  }
  return out;
}

export function getSettings() {
  if (!_settings) _settings = deepMerge(DEFAULT_SETTINGS, store.get(SETTINGS_KEY, {}));
  return _settings;
}

export function saveSettings(patch) {
  _settings = deepMerge(getSettings(), patch || {});
  store.set(SETTINGS_KEY, _settings);
  return _settings;
}

export const apiReady = () => {
  const s = getSettings().api;
  return !!(s.baseUrl && s.model);
};

/* ============================ 角色卡库 ============================ */
const PERSONA_KEY = 'personas';

export function getPersonas() {
  const custom = store.get(PERSONA_KEY, []);
  return [...PRESET_PERSONAS, ...custom];
}

export function getPersona(id) {
  return getPersonas().find((p) => p.id === id) || PRESET_PERSONAS[0];
}

export function savePersona(p) {
  const custom = store.get(PERSONA_KEY, []);
  const obj = { ...p };
  if (!obj.id) obj.id = 'c_' + uid(6);
  const i = custom.findIndex((x) => x.id === obj.id);
  if (i >= 0) custom[i] = obj;
  else custom.push(obj);
  store.set(PERSONA_KEY, custom);
  return obj;
}

export function deletePersona(id) {
  const custom = store.get(PERSONA_KEY, []).filter((p) => p.id !== id);
  store.set(PERSONA_KEY, custom);
}

export const isPresetPersona = (id) => PRESET_PERSONAS.some((p) => p.id === id);

/* ============================ AI 决策缓存 ============================ */
const CACHE_PREFIX = 'ai:';
const CACHE_INDEX = 'ai_index';
const CACHE_MAX = 500;

function cacheIndex() { return store.get(CACHE_INDEX, []); }
function saveIndex(idx) { store.set(CACHE_INDEX, idx); }

export function cacheKey(gameId, model, level, prompt) {
  return CACHE_PREFIX + hash(gameId + '|' + model + '|' + level + '|' + prompt);
}

export function cacheGet(key) {
  const rec = store.get(key, null);
  if (!rec) return null;
  rec.hits = (rec.hits || 0) + 1;
  store.set(key, rec);
  return rec.value;
}

export function cacheSet(key, value) {
  const idx = cacheIndex();
  if (!idx.includes(key)) {
    idx.push(key);
    // 超限：删最老的
    while (idx.length > CACHE_MAX) {
      const old = idx.shift();
      store.del(old);
    }
    saveIndex(idx);
  }
  store.set(key, { value, at: Date.now(), hits: 0 });
}

export function cacheStats() {
  const idx = cacheIndex();
  let hits = 0, bytes = 0;
  for (const k of idx) {
    const rec = store.get(k, null);
    if (rec) { hits += rec.hits || 0; bytes += (localStorage.getItem('cg:' + k) || '').length; }
  }
  return { count: idx.length, hits, bytes };
}

export function cacheClear() {
  for (const k of cacheIndex()) store.del(k);
  store.del(CACHE_INDEX);
}

/* ============================ 对局存档 ============================ */
const SAVE_PREFIX = 'save:';

export function saveGame(gameId, payload) {
  store.set(SAVE_PREFIX + gameId, { at: Date.now(), payload });
}

export function loadGame(gameId) {
  return store.get(SAVE_PREFIX + gameId, null);
}

export function clearGame(gameId) {
  store.del(SAVE_PREFIX + gameId);
}

export function listSaves() {
  return store.keys(SAVE_PREFIX).map((k) => {
    const rec = store.get(k, null) || {};
    return { gameId: k.slice(SAVE_PREFIX.length), at: rec.at || 0 };
  }).sort((a, b) => b.at - a.at);
}

export function clearAllData() {
  cacheClear();
  for (const k of store.keys(SAVE_PREFIX)) store.del(k);
}