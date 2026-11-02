/* 赛博棋牌室 · UI 组件（toast / 弹窗 / 设置抽屉 / 开局设置） */
import { el, $, $$, fmtBytes, pick } from './util.js';
import {
  getSettings, saveSettings, LEVELS, getPersonas, getPersona, savePersona, deletePersona, isPresetPersona,
  cacheStats, cacheClear, listSaves, clearGame, clearAllData, apiReady,
} from './store.js';
import { testAPI } from './ai.js';

/* ============================ Toast ============================ */
export function toast(msg, type = '') {
  const box = $('#toasts');
  if (!box) return;
  const t = el('div.toast' + (type ? '.' + type : ''), { text: msg });
  box.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, type === 'err' ? 4200 : 2400);
}

/* ============================ 弹窗 ============================ */
export function modal(content, { wide = false, onClose } = {}) {
  const scrim = el('div.modal-scrim');
  const box = el('div.modal', wide ? { style: { width: 'min(620px,100%)' } } : null, content);
  scrim.append(box);
  const close = () => {
    scrim.classList.remove('on');
    setTimeout(() => scrim.remove(), 260);
    onClose && onClose();
  };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  $('#modalRoot').append(scrim);
  requestAnimationFrame(() => scrim.classList.add('on'));
  return { close, box, scrim };
}

export function confirm({ title = '确认', text = '', okText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); m.close(); } };
    const body = el('div',
      el('h3', { text: title }),
      text ? el('p', { text }) : null,
      el('div.modal-foot',
        el('button.btn', { onClick: () => finish(false) }, cancelText),
        el('button.btn' + (danger ? '.danger' : '.primary'), { onClick: () => finish(true) }, okText),
      )
    );
    const m = modal(body, { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

export function alertBox({ title = '提示', text = '' }) {
  return new Promise((resolve) => {
    const body = el('div',
      el('h3', { text: title }),
      el('p', { text }),
      el('div.modal-foot', el('button.btn.primary', { onClick: () => { m.close(); resolve(); } }, '知道了'))
    );
    const m = modal(body);
  });
}

/* ============================ 抽屉 ============================ */
let drawerBuilt = false;

export function openDrawer(tab) {
  const drawer = $('#drawer');
  const scrim = $('#scrim');
  if (!drawer.built) { buildSettings(); drawer.built = true; }
  if (tab) {
    const acc = drawer.querySelector(`.acc[data-k="${tab}"]`);
    if (acc) { $$('.acc', drawer).forEach((a) => a.classList.remove('on')); acc.classList.add('on'); }
  }
  drawer.classList.add('on');
  scrim.classList.add('on');
}

export function closeDrawer() {
  $('#drawer').classList.remove('on');
  $('#scrim').classList.remove('on');
}

/* ---------- 控件工厂 ---------- */
function accGroup(key, title, icon, ...children) {
  const body = el('div.acc-b', el('div', el('div.acc-inner', ...children)));
  const node = el('div.acc', { dataset: { k: key } },
    el('div.acc-h', el('span', { text: icon }), el('span', { text: title }), el('span.chev', { text: '▶' })),
    body
  );
  node.querySelector('.acc-h').addEventListener('click', () => node.classList.toggle('on'));
  return node;
}

function field(label, control, hint) {
  return el('div.field', el('label', { text: label }), control, hint ? el('div.hint', { text: hint }) : null);
}

function segControl(options, value, onChange) {
  const wrap = el('div.seg');
  options.forEach((o) => {
    const b = el('button', { text: o.label, class: o.v === value ? 'on' : '' });
    b.addEventListener('click', () => {
      $$('button', wrap).forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(o.v);
    });
    wrap.append(b);
  });
  return wrap;
}

function swControl(value, onChange) {
  const node = el('div.sw' + (value ? '.on' : ''));
  node.addEventListener('click', () => {
    node.classList.toggle('on');
    onChange(node.classList.contains('on'));
  });
  return node;
}

function lineRow(label, control) {
  return el('div.line', el('span.lab', { text: label }), control);
}

/* ============================ 设置面板 ============================ */
function buildSettings() {
  const body = $('#drawerBody');
  body.innerHTML = '';
  const s = getSettings();

  /* ---- 1. AI 接口 ---- */
  const baseIn = el('input.input', { type: 'text', value: s.api.baseUrl, placeholder: 'https://api.openai.com/v1' });
  const keyIn = el('input.input', { type: 'password', value: s.api.key, placeholder: 'sk-...' });
  const modelIn = el('input.input', { type: 'text', value: s.api.model, placeholder: 'gpt-4o-mini / deepseek-chat ...' });
  const status = el('div.hint', { text: '' });
  const testBtn = el('button.btn.sm', { text: '测试连接' });
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    status.textContent = '正在测试…';
    status.style.color = '';
    try {
      const r = await testAPI();
      status.textContent = `✓ 通了，${r.ms}ms ·「${r.text}」`;
      status.style.color = 'var(--green)';
      toast('API 连接正常', 'ok');
    } catch (e) {
      status.textContent = '✗ ' + e.message;
      status.style.color = 'var(--coral)';
      toast('连接失败：' + e.message, 'err');
    } finally { testBtn.disabled = false; }
  });

  const saveApi = () => saveSettings({
    api: {
      baseUrl: baseIn.value.trim(), key: keyIn.value.trim(), model: modelIn.value.trim(),
    },
  });
  baseIn.addEventListener('change', saveApi);
  keyIn.addEventListener('change', saveApi);
  modelIn.addEventListener('change', saveApi);

  const presetRow = el('div.row.wrap');
  [
    { n: 'OpenAI', u: 'https://api.openai.com/v1', m: 'gpt-4o-mini' },
    { n: 'DeepSeek', u: 'https://api.deepseek.com/v1', m: 'deepseek-chat' },
    { n: '月之暗面', u: 'https://api.moonshot.cn/v1', m: 'moonshot-v1-8k' },
    { n: '智谱', u: 'https://open.bigmodel.cn/api/paas/v4', m: 'glm-4-flash' },
  ].forEach((p) => {
    const b = el('button.btn.sm.ghost', { text: p.n });
    b.addEventListener('click', () => {
      baseIn.value = p.u; modelIn.value = p.m; saveApi();
      toast('已切换到 ' + p.n + '（记得填自己的 Key）');
    });
    presetRow.append(b);
  });

  const tempIn = el('input.input', { type: 'number', step: '0.1', min: '0', max: '2', value: s.api.temperature });
  tempIn.addEventListener('change', () => saveSettings({ api: { temperature: Math.max(0, Math.min(2, Number(tempIn.value) || 0.7)) } }));
  const toIn = el('input.input', { type: 'number', min: '10', max: '180', value: s.api.timeout });
  toIn.addEventListener('change', () => saveSettings({ api: { timeout: Math.max(10, Math.min(180, Number(toIn.value) || 45)) } }));
  const mtIn = el('input.input', { type: 'number', min: '100', max: '4000', step: '50', value: s.api.maxTokens });
  mtIn.addEventListener('change', () => saveSettings({ api: { maxTokens: Math.max(100, Math.min(4000, Number(mtIn.value) || 700)) } }));

  body.append(accGroup('api', 'AI 接口', '🔌',
    field('API 地址（OpenAI 兼容）', baseIn, '中转站也行；末尾 /v1 一般要带。'),
    field('API Key', keyIn, '只存在你这台设备的本地缓存里，不会上传到别处。'),
    field('模型名', modelIn, '自定义模型名直接填。'),
    el('div.row.wrap', testBtn, el('span.grow', status)),
    el('div.hint', { text: '常用中转（点了自动填地址与模型）：' }),
    presetRow,
    el('div.divider'),
    field('温度（越高越随性）', tempIn),
    field('超时（秒）', toIn),
    field('单次最大输出 tokens', mtIn),
  ));

  /* ---- 2. 对战 AI ---- */
  body.append(accGroup('ai', '对战 AI', '🧠',
    field('默认智商（每个座位还能单独调）', segControl(
      LEVELS.map((l) => ({ v: l.v, label: l.name })), s.ai.level, (v) => saveSettings({ ai: { level: v } })
    ), LEVELS.map((l) => `${l.name}：${l.desc}`).join('\n')),
    lineRow('边打边聊', swControl(s.ai.chatEnabled, (v) => saveSettings({ ai: { chatEnabled: v } }))),
    field('说话频率', segControl(
      [{ v: 0.3, label: '话少' }, { v: 0.85, label: '正常' }, { v: 1, label: '话痨' }],
      s.ai.chatChance, (v) => saveSettings({ ai: { chatChance: v } })
    )),
    field('落子节奏', segControl(
      [{ v: 0.6, label: '慢' }, { v: 1, label: '正常' }, { v: 1.8, label: '快' }],
      s.ai.speed, (v) => saveSettings({ ai: { speed: v } })
    ), '快 = AI 的「思考中」动画更短。'),
    lineRow('决策缓存', swControl(s.ai.useCache, (v) => saveSettings({ ai: { useCache: v } }))),
    el('div.hint', { text: '缓存 = 同样的局面 + 同样的角色 + 同样的模型，第二次直接复用上次的决定，不花 token。' }),
    lineRow('非法动作自动纠正', swControl(s.ai.autoRetry, (v) => saveSettings({ ai: { autoRetry: v } }))),
  ));

  /* ---- 3. 角色卡 ---- */
  const plist = el('div.col');
  const renderPersonas = () => {
    plist.innerHTML = '';
    for (const p of getPersonas()) {
      const row = el('div.seat', { style: { padding: '8px 10px' } },
        el('div.seat-av', { text: p.avatar || '🙂' }),
        el('div.seat-info.grow',
          el('div.seat-name', { style: { maxWidth: 'none' } }, p.name, ' ', el('span.tiny.muted', { text: p.tag || '' })),
          el('div.seat-sub', { text: (p.persona || '').slice(0, 26) + '…' })
        ),
        el('button.btn.sm.ghost', { onClick: () => editPersona(p, renderPersonas) }, '改'),
        isPresetPersona(p.id)
          ? el('span.chip', { text: '预设' })
          : el('button.btn.sm.ghost', {
            onClick: async () => {
              if (await confirm({ title: '删除角色卡', text: `删掉「${p.name}」？`, danger: true, okText: '删除' })) {
                deletePersona(p.id); renderPersonas();
              }
            }
          }, '🗑')
      );
      plist.append(row);
    }
  };
  renderPersonas();

  body.append(accGroup('persona', '角色卡', '🎭',
    el('div.hint', { text: '每个 AI 玩家一张卡：决定他叫什么、怎么说话、怎么吐槽。多人牌局里各自独立行动。' }),
    plist,
    el('button.btn.sm.block', { onClick: () => editPersona(null, renderPersonas) }, '＋ 新建角色卡'),
  ));

  /* ---- 4. 缓存与存档 ---- */
  const cstat = cacheStats();
  const statLine = el('div.hint', { text: `已缓存 ${cstat.count} 条决策 · 命中 ${cstat.hits} 次 · 占用 ${fmtBytes(cstat.bytes)}` });
  const savesBox = el('div.col');
  const renderSaves = () => {
    savesBox.innerHTML = '';
    const saves = listSaves();
    if (!saves.length) { savesBox.append(el('div.hint', { text: '还没有存档。对局会自动存一份，刷新不丢。' })); return; }
    for (const sv of saves) {
      savesBox.append(el('div.line',
        el('span.lab', { text: sv.gameId + ' · ' + new Date(sv.at).toLocaleString('zh-CN', { hour12: false }) }),
        el('button.btn.sm.ghost', {
          onClick: () => { clearGame(sv.gameId); renderSaves(); toast('存档已删'); }
        }, '删')
      ));
    }
  };
  renderSaves();

  body.append(accGroup('data', '缓存与存档', '💾',
    statLine,
    el('div.row.wrap',
      el('button.btn.sm', {
        onClick: () => { cacheClear(); const c = cacheStats(); statLine.textContent = `已清空 · 现有 ${c.count} 条`; toast('决策缓存已清空', 'ok'); }
      }, '清空 AI 缓存'),
      el('button.btn.sm.danger', {
        onClick: async () => {
          if (await confirm({ title: '清空全部数据', text: 'AI 缓存、所有存档都会被删掉（设置和角色卡保留）。', danger: true, okText: '全清' })) {
            clearAllData(); statLine.textContent = '已全部清空'; renderSaves(); toast('已清空', 'ok');
          }
        }
      }, '清空全部')
    ),
    el('div.divider'),
    el('div.hint', { text: '存档：' }),
    savesBox,
  ));

  /* ---- 5. 说明 ---- */
  body.append(accGroup('about', '怎么玩', '🫧',
    el('div.hint', {
      html: '1. 先填 API 地址 + Key，点「测试连接」确认通了。<br>' +
        '2. 回大厅点一个游戏 → 选人数、角色卡、每人智商 → 开始。<br>' +
        '3. 桌上聊天框随时能跟对手搭话，他们有自己的脾气。<br>' +
        '4. 对局会自动存档；AI 决策会自动缓存，同样的局面不重复花钱。<br>' +
        '5. 不填 API 也能玩：AI 会退化成内置的规则 AI（弱一些，但不会崩）。'
    })
  ));
}

/* ============================ 角色卡编辑 ============================ */
function editPersona(p, after) {
  const isNew = !p;
  const d = p || { name: '', avatar: '🙂', tag: '', persona: '', style: '' };
  const nameIn = el('input.input', { value: d.name, placeholder: '名字' });
  const avIn = el('input.input', { value: d.avatar, placeholder: '一个 emoji', maxlength: '4' });
  const tagIn = el('input.input', { value: d.tag || '', placeholder: '一句话标签，如「老赌徒」' });
  const perIn = el('textarea.input', { style: { minHeight: '90px' }, placeholder: '人设：他是谁、什么性格、在意什么' }, d.persona || '');
  const styIn = el('textarea.input', { style: { minHeight: '60px' }, placeholder: '说话风格：口头禅、句子长短、语气' }, d.style || '');
  const body = el('div',
    el('h3', { text: isNew ? '新建角色卡' : '编辑角色卡' }),
    el('div.col',
      el('div.row', el('div', { style: { width: '84px' } }, field('头像', avIn)), el('div.grow', field('名字', nameIn))),
      field('标签', tagIn),
      field('人设', perIn),
      field('说话风格', styIn),
    ),
    el('div.modal-foot',
      el('button.btn', { onClick: () => m.close() }, '取消'),
      el('button.btn.primary', {
        onClick: () => {
          const name = nameIn.value.trim();
          if (!name) return toast('得有个名字', 'err');
          const obj = { ...d, name, avatar: (avIn.value || '🙂').trim().slice(0, 4), tag: tagIn.value.trim(), persona: perIn.value.trim(), style: styIn.value.trim() };
          if (isPresetPersona(obj.id)) delete obj.id; // 改预设 = 另存为新卡
          savePersona(obj);
          m.close();
          after && after();
          toast('角色卡已保存', 'ok');
        }
      }, '保存')
    )
  );
  const m = modal(body, { wide: true });
}

/* ============================ 开局设置 ============================ */
/**
 * 返回 {count, options:{}, seats:[{kind,personaId,level}]} 或 null
 */
export function openSetup(game, { hasSave = false } = {}) {
  return new Promise((resolve) => {
    const st = getSettings();
    const minP = game.players?.min ?? 2;
    const maxP = game.players?.max ?? 2;
    let count = Math.min(maxP, Math.max(minP, game.players?.def ?? minP));

    const options = {};
    (game.optionSpec || []).forEach((o) => { options[o.key] = o.def; });

    // 座位配置（跨局记忆）
    const memKey = 'seatcfg:' + game.id;
    const mem = JSON.parse(localStorage.getItem('cg:' + memKey) || 'null') || {};
    const personas = getPersonas();
    const seats = [];
    const ensureSeats = (n) => {
      while (seats.length < n) {
        const i = seats.length;
        if (i === 0) seats.push({ kind: 'human', personaId: null, level: st.ai.level });
        else {
          const prev = mem.seats?.[i];
          seats.push({
            kind: 'ai',
            personaId: prev?.personaId && personas.some((p) => p.id === prev.personaId) ? prev.personaId : (personas[i % personas.length]?.id ?? personas[0].id),
            level: Number.isFinite(prev?.level) ? prev.level : st.ai.level,
          });
        }
      }
      seats.length = n;
    };
    ensureSeats(count);

    const optBox = el('div.col');
    const seatsBox = el('div.col');
    let countControl = null;

    const renderSeats = () => {
      seatsBox.innerHTML = '';
      seats.forEach((seat, i) => {
        if (seat.kind === 'human') {
          seatsBox.append(el('div.seat',
            el('div.seat-av', { text: '🙋' }),
            el('div.seat-info.grow',
              el('div.seat-name', { style: { maxWidth: 'none' } }, '你'),
              el('div.seat-sub', { text: '人类玩家 —— 自己上手' })
            )
          ));
          return;
        }
        const pSel = el('select.input', { style: { maxWidth: '150px' } });
        personas.forEach((p) => pSel.append(el('option', { value: p.id, selected: p.id === seat.personaId }, `${p.avatar} ${p.name}`)));
        pSel.addEventListener('change', () => { seat.personaId = pSel.value; });
        const lSel = el('select.input', { style: { maxWidth: '92px' } });
        LEVELS.forEach((l) => lSel.append(el('option', { value: l.v, selected: l.v === seat.level }, l.name)));
        lSel.addEventListener('change', () => { seat.level = Number(lSel.value); });
        const cur = getPersona(seat.personaId);
        seatsBox.append(el('div.seat',
          el('div.seat-av', { text: cur.avatar }),
          el('div.grow', el('div.seat-sub', { text: `座位 ${i + 1}` }), pSel),
          lSel
        ));
      });
    };

    const renderOptions = () => {
      optBox.innerHTML = '';
      if (maxP > minP) {
        const opts = [];
        for (let n = minP; n <= maxP; n++) opts.push({ v: n, label: n + ' 人' });
        countControl = segControl(opts, count, (v) => {
          count = v;
          ensureSeats(v);
          renderSeats();
        });
        optBox.append(field('人数', countControl));
      }
      for (const o of (game.optionSpec || [])) {
        let control;
        if (o.type === 'seg') {
          control = segControl(o.options, options[o.key], (v) => { options[o.key] = v; });
        } else if (o.type === 'num') {
          control = el('input.input', { type: 'number', min: o.min, max: o.max, step: o.step || 1, value: options[o.key] });
          control.addEventListener('change', () => {
            const v = Math.max(o.min, Math.min(o.max, Number(control.value) || o.def));
            control.value = v; options[o.key] = v;
          });
        } else if (o.type === 'switch') {
          control = swControl(!!options[o.key], (v) => { options[o.key] = v; });
        }
        optBox.append(field(o.label, control, o.hint));
      }
    };

    renderOptions();
    renderSeats();

    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };

    const startBtn = el('button.btn.primary', {
      onClick: () => {
        const cfg = {
          count,
          options: { ...options },
          seats: seats.map((x) => ({ ...x })),
        };
        if (countControl === undefined) delete cfg.count;
        try { localStorage.setItem('cg:' + memKey, JSON.stringify({ seats })); } catch {}
        finish(cfg);
        m.close();
      }
    }, '开始对局');

    const body = el('div',
      el('h3', { text: game.name + ' · 开局设置' }),
      el('p.tiny.muted', { style: { marginBottom: '12px' } }, game.desc || ''),
      optBox,
      el('div.divider', { style: { margin: '12px 0 10px' } }),
      el('div.tiny.muted', { style: { marginBottom: '6px' } }, '座位与角色'),
      seatsBox,
      el('div.modal-foot',
        hasSave ? el('button.btn', {
          onClick: () => { finish({ resume: true }); m.close(); }
        }, '继续上次') : null,
        el('button.btn.ghost', { onClick: () => { finish(null); m.close(); } }, '取消'),
        startBtn
      )
    );
    const m = modal(body, { wide: true, onClose: () => finish(null) });
  });
}