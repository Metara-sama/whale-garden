/* 赛博棋牌室 · AI 引擎
   ┌ 规则引擎是权威，LLM 只做「从合法动作里挑一个」
   ├ 挑不合法 → 纠正重试一次 → 再不行用本地兜底 AI
   └ 决策可缓存，同局面同角色不重复烧 token
*/
import { getSettings, getPersona, cacheKey, cacheGet, cacheSet, LEVELS } from './store.js';
import { extractJSON, shuffle } from './util.js';

/* ---------------- 底层请求 ---------------- */
function normBase(u) {
  let s = (u || '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(s)) s = s.replace(/\/chat\/completions$/, '');
  return s;
}

export async function chatRequest(messages, opt = {}) {
  const s = getSettings().api;
  const base = normBase(s.baseUrl);
  if (!base) throw new Error('还没填 API 地址');
  if (!s.key) throw new Error('还没填 API Key');
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), Math.max(10, s.timeout || 45) * 1000);
  const body = {
    model: opt.model || s.model,
    messages,
    temperature: opt.temperature ?? s.temperature,
    max_tokens: opt.maxTokens || s.maxTokens || 700,
  };
  if (opt.json) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + s.key,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(to);
    if (e.name === 'AbortError') throw new Error('请求超时（' + (s.timeout || 45) + 's）');
    throw new Error('连不上 API：' + (e.message || '网络/CORS 被拦'));
  }
  clearTimeout(to);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j).slice(0, 200); }
    catch { detail = await res.text().catch(() => ''); }
    throw new Error('API 返回 ' + res.status + (detail ? '：' + detail.slice(0, 180) : ''));
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('API 返回内容为空');
  return String(text);
}

/* ---------------- 提示词 ---------------- */
const LEVEL_GUIDE = {
  0: '你只是个刚学会规则的新手，看不太懂局势，凭直觉随便挑一个还行的动作，不要深入分析，也经常看不出对手的威胁。',
  1: '你懂基本规则，会挑合乎常理的动作，但偶尔漏算、偶尔贪心。',
  2: '你是认真在打的对手，会算牌、会留后手、会看对手的动向，尽量挑最有利的一步。',
  3: '你是高手：先在脑子里推演一两步后果，再挑最有利的一步。候选动作已按本地算力评估排序（越靠前通常越好），但你要自己判断。',
};

function personaBlock(persona) {
  const p = persona || getPersona('p_dafeiyu');
  return [
    `你的角色：${p.name}${p.tag ? '（' + p.tag + '）' : ''}`,
    p.persona ? `人设：${p.persona}` : '',
    p.style ? `说话风格：${p.style}` : '',
  ].filter(Boolean).join('\n');
}

function buildSystem(game, persona, level, extra = '') {
  return [
    personaBlock(persona),
    '',
    `你正在棋牌室里玩【${game.name}】。`,
    game.rulesBrief ? `规则要点：${game.rulesBrief}` : '',
    '',
    '【怎么做决定】',
    LEVEL_GUIDE[level] ?? LEVEL_GUIDE[1],
    '',
    '【输出格式｜必须严格遵守】',
    '只输出一个 JSON 对象，不要输出任何其它文字、不要代码块标记：',
    '{"pick": <动作编号数字>, "say": "<一句台词>"}',
    'say 是你在牌桌上顺口说的话：不超过 30 字，符合人设，别复述规则，别解释 JSON。',
    extra,
  ].filter(Boolean).join('\n');
}

/* ---------------- 动作表 ---------------- */
function buildActionList(game, state, seat, legal, level, rand) {
  let list = legal.slice();
  if (typeof game.rankActions === 'function' && level >= 3) {
    try { list = game.rankActions(state, seat, list) || list; } catch {}
  }
  const caps = { 0: 8, 1: 26, 2: 60, 3: 16 };
  const cap = caps[level] ?? 26;
  let shown = list;
  if (list.length > cap) {
    // 新手：给一小撮并随机化；高智商：给本地算力排好序的前 N
    shown = level === 0 || (level < 3 && typeof game.rankActions !== 'function')
      ? shuffle(list, rand).slice(0, cap)
      : list.slice(0, cap);
  }
  return shown;
}

function actionLine(a, i) {
  return `${i + 1}. ${a.label || a.k}`;
}

/* ---------------- 主决策 ---------------- */
/**
 * @returns {Promise<{action:any, say:string, source:'api'|'cache'|'fallback'}>}
 */
export async function decide({ game, state, seat, persona, level, rand = Math.random, chatContext }) {
  const legal = game.legal(state, seat);
  if (!legal || legal.length === 0) return { action: null, say: '', source: 'fallback' };

  const settings = getSettings();
  const lv = Number.isFinite(level) ? level : settings.ai.level;
  const p = persona || getPersona('p_dafeiyu');

  const obs = game.view(state, seat);
  const shown = buildActionList(game, state, seat, legal, lv, rand);

  const promptParts = [
    `【当前局面】\n${obs}`,
    '',
    `【你可以选的动作】（共 ${shown.length} 个）`,
    shown.map(actionLine).join('\n'),
  ];
  if (chatContext) promptParts.push('', `【牌桌近况】\n${chatContext}`);
  const userPrompt = promptParts.join('\n');

  const cKey = cacheKey(game.id, settings.api.model, lv, p.id + '|' + userPrompt);
  if (settings.ai.useCache) {
    const hit = cacheGet(cKey);
    if (hit && hit.pick >= 1 && hit.pick <= shown.length) {
      return { action: shown[hit.pick - 1], say: hit.say || '', source: 'cache' };
    }
  }

  const messages = [
    { role: 'system', content: buildSystem(game, p, lv) },
    { role: 'user', content: userPrompt },
  ];

  const apply = (parsed) => {
    if (!parsed) return null;
    const raw = parsed.pick ?? parsed.action ?? parsed.move ?? parsed.choose ?? parsed.number;
    let idx = null;
    if (typeof raw === 'number') idx = raw - 1;
    else if (typeof raw === 'string') {
      const t = raw.trim();
      if (/^\d+$/.test(t)) idx = parseInt(t, 10) - 1;
      else {
        const byKey = shown.findIndex((a) => String(a.k) === t);
        if (byKey >= 0) idx = byKey;
      }
    }
    if (idx === null || idx < 0 || idx >= shown.length) return null;
    return { action: shown[idx], say: String(parsed.say || parsed.talk || parsed.speech || '').slice(0, 80) };
  };

  const finish = (ok) => {
    if (settings.ai.useCache) cacheSet(cKey, { pick: shown.indexOf(ok.action) + 1, say: ok.say });
    return { ...ok, source: 'api', asked: shown.length, total: legal.length };
  };

  try {
    const txt = await chatRequest(messages, { json: true });
    const ok = apply(extractJSON(txt));
    if (ok) return finish(ok);

    if (settings.ai.autoRetry) {
      const retryMsgs = [
        ...messages,
        { role: 'assistant', content: String(txt).slice(0, 400) },
        { role: 'user', content: `你上次的回答不是一个合法的动作编号。请只输出 {"pick": 数字, "say": "台词"}，pick 必须是 1 到 ${shown.length} 之间的整数。` },
      ];
      const txt2 = await chatRequest(retryMsgs, { json: true });
      const ok2 = apply(extractJSON(txt2));
      if (ok2) return finish(ok2);
    }
  } catch (err) {
    const fb = game.fallback ? game.fallback(state, seat, lv) : legal[Math.floor(rand() * legal.length)];
    return { action: fb, say: '', source: 'fallback', error: err.message };
  }

  const fb = game.fallback ? game.fallback(state, seat, lv) : legal[Math.floor(rand() * legal.length)];
  return { action: fb, say: '', source: 'fallback' };
}

/* ---------------- 闲聊回复 ---------------- */
export async function reply({ game, state, seat, persona, level, history, text, chatContext }) {
  const p = persona || getPersona('p_dafeiyu');
  const lv = Number.isFinite(level) ? level : getSettings().ai.level;
  const obs = state ? game.view(state, seat) : '';
  const sys = [
    personaBlock(p),
    '',
    game ? `你现在在牌桌上跟人玩【${game.name}】。` : '你现在在牌桌旁聊天。',
    '回答要口语、自然、短（一般不超过 40 字），像真人顺口回一句，不要列点、不要加解释。',
    lv >= 2 ? '你可以顺便透露一点你对局面的判断，但不要说出你不该知道的牌。' : '',
    '绝对不要输出 JSON、不要输出动作。',
  ].filter(Boolean).join('\n');
  const msgs = [{ role: 'system', content: sys }];
  if (obs) msgs.push({ role: 'system', content: '【你看到的局面】\n' + obs });
  for (const h of (history || []).slice(-6)) {
    msgs.push({ role: h.role === 'me' ? 'user' : 'assistant', content: String(h.text).slice(0, 300) });
  }
  if (chatContext) msgs.push({ role: 'system', content: '【最近牌桌动态】\n' + chatContext });
  msgs.push({ role: 'user', content: text });
  const out = await chatRequest(msgs, { temperature: 0.85, maxTokens: 260 });
  return String(out).trim().replace(/^["「『]|["」』]$/g, '').slice(0, 200);
}

/* ---------------- 连通性测试 ---------------- */
export async function testAPI() {
  const t0 = performance.now();
  const txt = await chatRequest([{ role: 'user', content: '只回复两个字：在线' }], { maxTokens: 16, temperature: 0 });
  const ms = Math.round(performance.now() - t0);
  return { ok: true, ms, text: txt.trim().slice(0, 40) };
}

export { LEVELS };