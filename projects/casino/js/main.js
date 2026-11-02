/* 赛博棋牌室 · 入口 */
import { el, $, $$ } from './core/util.js';
import { openDrawer, closeDrawer, openSetup, toast, confirm } from './core/ui.js';
import { apiReady, getSettings } from './core/store.js';
import { Table } from './core/table.js';

import doudizhu from './games/doudizhu.js';
import mahjong from './games/mahjong.js';
import uno from './games/uno.js';
import regrets from './games/regrets.js';
import go from './games/go.js';
import xiangqi from './games/xiangqi.js';
import chess from './games/chess.js';
import gomoku from './games/gomoku.js';

const GAMES = [doudizhu, mahjong, uno, regrets, go, xiangqi, chess, gomoku];

let table = null;

window.__cgToast = (msg, type) => toast(msg, type);

/* 开发者自检：把所有游戏用本地 AI 快进一局，检查规则层是否会崩 */
window.__cgSelfTest = () => {
  const results = [];
  for (const g of GAMES) {
    try {
      const n = g.players.def || 2;
      const seats = Array.from({ length: n }, (_, i) => ({ kind: i === 0 ? 'human' : 'ai', personaId: 'p_dafeiyu', level: 2 }));
      const opt = {};
      (g.optionSpec || []).forEach((o) => { opt[o.key] = o.def; });
      const st = g.init(opt, n);
      let guard = 0;
      const errs = [];
      while (guard++ < 400) {
        const s2 = g.status(st);
        if (s2.over) break;
        const seat = g.turn(st);
        if (seat === null || seat === undefined) break;
        const la = g.legal(st, seat);
        if (!la.length) { errs.push('legal空@' + guard); break; }
        const a = g.fallback ? g.fallback(st, seat, 3) : la[0];
        if (!a) { errs.push('fallback空@' + guard); break; }
        const before = JSON.stringify(st).length;
        const r = g.apply(st, a);
        if (!r) { errs.push('apply拒绝@' + guard); }
        void before;
      }
      const end = g.status(st);
      results.push(`${g.id}: ${errs.length ? 'WARN ' + errs.slice(0, 3).join(',') : 'OK'} (${guard} 步, over=${end.over})`);
    } catch (e) {
      results.push(`${g.id}: FAIL ${e.message}`);
    }
  }
  return results;
};

/* ---------------- 大厅 ---------------- */
function renderLobby() {
  const grid = $('#gameGrid');
  grid.innerHTML = '';
  GAMES.forEach((g, i) => {
    const card = el('button.game-card', {
      style: { animationDelay: (i * 40) + 'ms' },
      onClick: () => startGame(g),
    },
      el('div.gc-top',
        el('div.gc-icon', { text: g.icon }),
        el('div',
          el('div.gc-name', { text: g.name }),
          el('div.gc-meta', { text: `${g.players.min === g.players.max ? g.players.min + ' 人' : g.players.min + '–' + g.players.max + ' 人'} · AI 对战` }),
        )
      ),
      el('div.gc-desc', { text: g.desc || '' }),
      el('div.gc-foot', ...(g.tags || []).map((t) => el('span.tag', { text: t }))),
    );
    grid.append(card);
  });
  updateApiDot();
}

function updateApiDot() {
  const dot = $('#apiDot');
  const txt = $('#apiText');
  if (!dot) return;
  dot.className = 'api-dot';
  if (!getSettings().api.key) {
    dot.classList.add('warn');
    txt.textContent = '未填 Key（AI 将用内置规则）';
  } else if (apiReady()) {
    dot.classList.add('ok');
    txt.textContent = getSettings().api.model || '已配置';
  }
}

/* ---------------- 视图切换 ---------------- */
function showTable(game) {
  $('#lobby').classList.remove('on');
  $('#tableview').classList.add('on');
  $('#gameTitle').textContent = game.name;
  $('#gameSub').textContent = game.desc || '';
  document.title = game.name + ' · 赛博棋牌室';
}

function backToLobby() {
  if (table) { table.destroy(); table = null; }
  $('#tableview').classList.remove('on');
  $('#lobby').classList.add('on');
  $('#chatpane').classList.remove('on');
  document.title = '赛博棋牌室';
  updateApiDot();
}

/* ---------------- 开局 ---------------- */
async function startGame(game) {
  try {
    let hasSave = false;
    try { hasSave = !!Table.resume(game.id); } catch {}
    const cfg = await openSetup(game, { hasSave });
    if (!cfg) return;
    let payload = null;
    if (cfg.resume) {
      payload = Table.resume(game.id);
      if (!payload) { toast('这局已经没有存档了', 'err'); return; }
    }
    const useCfg = payload?.cfg || cfg;
    if (!useCfg || !('seats' in useCfg) || !useCfg.seats?.length) { toast('存档损坏，开新局吧', 'err'); return; }

    showTable(game);
    table = new Table(game, useCfg);
    table.onExit = (again) => {
      backToLobby();
      if (again) setTimeout(() => startGame(game), 220);
    };
    table.mount().start(payload);
  } catch (e) {
    console.error('[casino] 开局失败', e);
    toast('开局失败：' + (e && e.message ? e.message : e), 'err');
    backToLobby();
  }
}

/* ---------------- 事件绑定 ---------------- */
function init() {
  renderLobby();

  $('#btnSettings')?.addEventListener('click', () => openDrawer('api'));
  $('#btnSettings2')?.addEventListener('click', () => openDrawer());
  $('#scrim')?.addEventListener('click', closeDrawer);
  $('#drawerClose')?.addEventListener('click', closeDrawer);
  $('#btnBack')?.addEventListener('click', async () => {
    if (table && !table.finished) {
      const ok = await confirm({ title: '离开这局？', text: '进度已经自动存档，下次可以从大厅继续。', okText: '离开', cancelText: '继续打' });
      if (!ok) return;
    }
    backToLobby();
  });
  $('#btnChatToggle')?.addEventListener('click', () => {
    $('#chatpane').classList.toggle('on');
  });

  // ESC 关闭抽屉
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDrawer();
      $('#chatpane')?.classList.remove('on');
    }
  });

  // 首次进入：没填 Key 就提示一次
  if (!getSettings().api.key) {
    setTimeout(() => toast('还没填 API Key：先点右上角 ⚙ 配置，或直接开打（AI 用内置规则）'), 700);
  }
}

document.addEventListener('DOMContentLoaded', init);