/* 赛博棋牌室 · 对局内核：回合循环 / 座位 / 聊天 / 存档 */
import { el, $, sleep, typewriter, pick } from './util.js';
import { getSettings, getPersona, saveGame, loadGame } from './store.js';
import { decide, reply } from './ai.js';
import { toast } from './ui.js';

const STORE_SLOT = 6;

export class Table {
  /**
   * @param game 游戏模块
   * @param cfg {options:{}, seats:[{kind,personaId,level}]}
   */
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.seats = cfg.seats.map((s, i) => {
      const fixed = game.fixedSeat ? game.fixedSeat(i, cfg.options || {}) : null;
      const personaId = fixed?.personaId || s.personaId;
      const persona = s.kind === 'human' ? null : getPersona(personaId);
      return {
        ...s,
        idx: i,
        persona,
        name: s.kind === 'human' ? '你' : (fixed?.name || persona.name),
        avatar: s.kind === 'human' ? '🙋' : (fixed?.avatar || persona.avatar),
        level: s.kind === 'human' ? 0 : (Number.isFinite(s.level) ? s.level : getSettings().ai.level),
      };
    });
    this.state = null;
    this.logs = [];
    this.chat = [];
    this.ui = {};          // 各游戏自己的临时交互状态
    this.busy = false;
    this.thinking = false;
    this.over = false;
    this.activeSeat = null;
    this.cacheHits = 0;
    this.apiMiss = 0;
  }

  /* ---------------- 生命周期 ---------------- */
  mount() {
    this.host = $('#gameHost');
    this.seatRow = $('#seatRow');
    this.actionbar = $('#actionbar');
    this.chatLog = $('#chatLog');
    this.chatBox = $('#chatBox');
    this.bindChat();
    return this;
  }

  start(resumePayload) {
    if (resumePayload) {
      this.state = resumePayload.state;
      this.logs = resumePayload.logs || [];
      this.chat = resumePayload.chat || [];
      this.renderChat();
    } else {
      this.state = this.game.init(this.cfg.options || {}, this.seats.length);
      this.pushLog(`对局开始 · ${this.game.name}`);
      // 每个游戏开局都在聊天室里打个招呼，让人知道这儿能说话
      const names = this.seats.filter((s) => s.kind === 'ai').map((s) => `${s.avatar}${s.name}`);
      if (names.length) {
        this.pushChat({ role: 'sys', text: `${this.game.name}开局：${names.join('、')} 已经坐好。想说话直接在下面发，他们会接。` });
      }
    }
    this.loop();
    return this;
  }

  destroy() {
    this.over = true;
    this.busy = false;
  }

  save() {
    try {
      saveGame(this.game.id, {
        state: this.state, logs: this.logs.slice(-80), chat: this.chat.slice(-40),
        cfg: this.cfg,
      });
    } catch {}
  }

  static resume(gameId) {
    const rec = loadGame(gameId);
    if (!rec?.payload?.state) return null;
    return rec.payload;
  }

  /* ---------------- 回合循环 ---------------- */
  async loop() {
    if (this.busy || this.over) return;
    this.busy = true;
    try {
      for (let guard = 0; guard < 4000; guard++) {
        if (this.over) return;
        const st = this.game.status(this.state);
        if (st.over) { this.finish(st); return; }
        const seat = this.game.turn(this.state);
        if (seat === null || seat === undefined) { this.render(); return; }
        this.activeSeat = seat;
        this.render();
        if (this.seats[seat]?.kind === 'human') {
          this.setBusyHint(false);
          return; // 等人类操作
        }
        await this.aiTurn(seat);
        if (this.over) return;
      }
    } finally {
      this.busy = false;
    }
  }

  /** 人类操作入口（游戏 render 里点牌/点格子都走这里） */
  act(action, bySeat = 0) {
    if (this.over) return;
    const holder = this.seats[bySeat];
    if (holder && holder.kind === 'human' && this.game.turn(this.state) !== bySeat) return;
    const r = this.game.apply(this.state, action);
    this.collectLog(r);
    this.save();
    this.render();
    if (this.over) return;
    if (!this.busy) this.loop();
  }

  async aiTurn(seat) {
    const S = this.seats[seat];
    if (!S) return;

    // 脚本对手（例如浅滩鱼悔的 Frod 单人拓展）：用游戏自带的确定性剧本，不走 LLM
    let scripted = null;
    if (typeof this.game.scriptAction === 'function') {
      try { scripted = this.game.scriptAction(this.state, seat); } catch { scripted = null; }
    }
    if (scripted) {
      const say = this.game.scriptLine ? this.game.scriptLine(this.state, seat) : '';
      if (say) this.pushChat({ role: 'ai', seat, text: say });
      const r = this.game.apply(this.state, scripted);
      this.collectLog(r);
      this.save();
      await sleep(300 / (getSettings().ai.speed || 1));
      this.render();
      return;
    }

    this.thinking = true;
    this.thinkLabel = `等待 ${S.name} 思考`;
    this.render();
    const t0 = performance.now();
    let res;
    try {
      res = await decide({
        game: this.game,
        state: this.state,
        seat,
        persona: S.persona,
        level: S.level,
        chatContext: this.recentFeed(),
      });
    } catch (e) {
      res = { action: this.game.fallback?.(this.state, seat, S.level) ?? this.game.legal(this.state, seat)[0], say: '', source: 'fallback', error: e.message };
    }
    if (this.over) return;

    // 节奏：不要瞬间连打
    const speed = getSettings().ai.speed || 1;
    const elapsed = performance.now() - t0;
    const minGap = (res.source === 'cache' ? 420 : 900) / speed;
    if (elapsed < minGap) await sleep(minGap - elapsed);

    this.thinking = false;
    if (res.source === 'cache') this.cacheHits++;
    if (res.source === 'fallback' && res.error) {
      this.apiMiss++;
      if (this.apiMiss === 1) toast('AI 接口没通，先用内置规则 AI 顶着：' + res.error, 'err');
    }

    if (res.say && getSettings().ai.chatEnabled && Math.random() < (getSettings().ai.chatChance ?? 0.85)) {
      this.pushChat({ role: 'ai', seat, text: res.say });
    }
    if (res.action) {
      const r = this.game.apply(this.state, res.action);
      this.collectLog(r);
      this.save();
    }
    this.render();
  }

  collectLog(r) {
    if (!r) return;
    const logs = Array.isArray(r) ? r : (r.log ? (Array.isArray(r.log) ? r.log : [r.log]) : []);
    for (const l of logs) if (l) this.pushLog(l);
  }

  /* ---------------- 渲染 ---------------- */
  render() {
    if (!this.host) return;
    // 座次条
    if (this.seatRow) this.seatRow.innerHTML = '';
    const st = this.game.status(this.state);
    for (const S of this.seats) {
      if (!this.seatRow) break;
      const info = this.game.seatInfo ? this.game.seatInfo(this.state, S.idx) : {};
      const isActive = this.activeSeat === S.idx && !st.over;
      this.seatRow.append(el('div.seat' + (isActive ? '.active' : '') + (info.out ? '.out' : ''),
        el('div.seat-av', { text: S.avatar }, isActive ? el('span.dot') : null),
        el('div.seat-info',
          el('div.seat-name', { text: S.name }),
          el('div.seat-sub', { text: info.sub || (S.kind === 'human' ? '人类' : `智商 ${S.level}`) })
        ),
        info.badge ? el('span.seat-badge', { text: info.badge }) : null
      ));
    }

    // 游戏桌面
    const ctx = {
      host: this.host,
      me: 0,
      seats: this.seats,
      state: this.state,
      act: (a) => this.act(a, 0),
      myTurn: this.game.turn(this.state) === 0 && !st.over,
      thinking: this.thinking,
      over: st.over,
      table: this,
      rerender: () => this.render(),
    };
    this.host.innerHTML = '';
    try {
      this.game.render(this.state, ctx);
    } catch (e) {
      this.host.append(el('div.muted.center', { text: '渲染出错：' + e.message }));
      console.error(e);
    }

    // 操作栏
    this.renderActionbar(st);
    if (st.over && !this.finished) this.finish(st);
  }

  renderActionbar(st) {
    if (!this.actionbar) return;
    this.actionbar.innerHTML = '';
    if (st.over) {
      this.actionbar.append(el('span.hintline', { text: '对局结束' }),
        el('button.btn.primary', { onClick: () => this.finish(st, true) }, '看结算'));
      return;
    }
    if (this.thinking) {
      this.actionbar.append(el('div.grow.thinking',
        el('span.spinner'),
        el('span', { text: this.thinkLabel || '思考中' }),
      ));
      return;
    }
    const seat = this.game.turn(this.state);
    const isMine = seat === 0;
    const hint = this.game.hint ? this.game.hint(this.state, seat) : (isMine ? '轮到你' : '');
    this.actionbar.append(el('span.hintline', { text: hint || '' }));
    if (isMine && this.game.extraButtons) {
      const bctx = {
        act: (a) => this.act(a, 0),
        table: this,
        host: this.host,
        me: 0,
        seats: this.seats,
        rerender: () => this.render(),
      };
      const btns = this.game.extraButtons(this.state, seat, bctx) || [];
      btns.forEach((b) => b && this.actionbar.append(b));
    }
    if (!isMine && seat !== null && this.seats[seat]) {
      this.actionbar.append(el('span.chip', { text: this.seats[seat].name + ' 行动中' }));
    }
  }

  /* ---------------- 结算 ---------------- */
  finish(st, force) {
    if (this.finished) return;
    this.finished = true;
    this.over = true;
    const res = st.result || {};
    const rows = (res.rows || []).map((r, i) => el('div.rank-row',
      el('span.no', { text: String(i + 1) }),
      el('span', { text: (this.seats[r.seat]?.avatar || '') + ' ' + (this.seats[r.seat]?.name || ('座位' + r.seat)) }),
      el('span.sc', { text: r.text ?? '' })
    ));
    const box = el('div',
      el('div.result-badge', { text: res.title || '对局结束' }),
      el('p.soft', { style: { margin: '8px 0 14px' } }, res.text || ''),
      el('div', ...rows),
      el('div.row', { style: { marginTop: '16px', gap: '8px', justifyContent: 'flex-end' } },
        el('button.btn', { onClick: () => { closeModal && closeModal(); this.onExit && this.onExit(); } }, '回大厅'),
        el('button.btn.primary', { onClick: () => { closeModal && closeModal(); this.onExit && this.onExit(true); } }, '再来一局'),
      )
    );
    // 延迟一点，让最后一手动画走完
    setTimeout(() => {
      const m = modalBox(box);
      closeModal = m.close;
    }, 620);
    this.save();
  }

  /* ---------------- 聊天 ---------------- */
  bindChat() {
    if (!this.chatBox || this.chatBound) return;
    this.chatBound = true;
    const send = async () => {
      const text = this.chatBox.value.trim();
      if (!text) return;
      this.chatBox.value = '';
      this.pushChat({ role: 'me', text });
      const s = getSettings();
      if (!s.ai.chatEnabled) return;
      const ais = this.seats.filter((x) => x.kind === 'ai');
      if (!ais.length) return;
      const target = pick(ais);
      this.pushChat({ role: 'sys', text: `${target.name} 正在组织语言…` });
      try {
        const out = await reply({
          game: this.game,
          state: this.state,
          seat: target.idx,
          persona: target.persona,
          level: target.level,
          history: this.chat.filter((c) => c.role !== 'sys').slice(-8).map((c) => ({ role: c.role, text: c.role === 'me' ? c.text : `${c.name || ''}${c.text}` })),
          text,
          chatContext: this.recentFeed(),
        });
        this.chat = this.chat.filter((c) => !(c.role === 'sys' && c.text.includes('正在组织语言')));
        this.renderChat();
        this.pushChat({ role: 'ai', seat: target.idx, text: out });
      } catch (e) {
        this.chat = this.chat.filter((c) => !(c.role === 'sys' && c.text.includes('正在组织语言')));
        this.renderChat();
        this.pushChat({ role: 'sys', text: '（' + target.name + '没接上话：' + e.message + '）' });
      }
    };
    $('#chatSend')?.addEventListener('click', send);
    this.chatBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  pushChat(msg) {
    const S = msg.seat !== undefined ? this.seats[msg.seat] : null;
    this.chat.push({
      ...msg,
      name: S ? S.name : '你',
      avatar: msg.role === 'me' ? '🙋' : (S ? S.avatar : '🫧'),
    });
    if (this.chat.length > 200) this.chat.shift();
    this.renderChat();
    this.save();
    this.bumpUnread(msg);
  }

  /** 聊天室没打开时，AI 说话要提示（每个游戏共用同一个聊天室） */
  bumpUnread(msg) {
    if (msg.role !== 'ai') return;
    const pane = document.getElementById('chatpane');
    const mobile = window.innerWidth <= 900;
    const shown = pane ? (!mobile || pane.classList.contains('on')) : false;
    if (!shown) {
      this.unread = (this.unread || 0) + 1;
      this.updateBadge();
    }
  }

  updateBadge() {
    const b = document.getElementById('chatBadge');
    if (!b) return;
    const n = this.unread || 0;
    if (n > 0) { b.hidden = false; b.textContent = n > 9 ? '9+' : String(n); }
    else b.hidden = true;
  }

  clearUnread() {
    this.unread = 0;
    this.updateBadge();
  }

  renderChat() {
    if (!this.chatLog) return;
    this.chatLog.innerHTML = '';
    for (const c of this.chat) {
      const mine = c.role === 'me';
      const node = el('div.msg' + (mine ? '.me' : ''),
        el('div.msg-av', { text: c.avatar || '🫧' }),
        el('div.msg-body',
          el('div.msg-who', { text: c.role === 'sys' ? '系统' : c.name }),
          el('div.bubble' + (c.role === 'sys' ? '.sys' : ''), { text: c.text })
        )
      );
      this.chatLog.append(node);
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  /** 给 AI 的上下文：最近动静 + 最近几句话 */
  recentFeed() {
    const lines = [];
    for (const l of this.logs.slice(-STORE_SLOT)) lines.push('· ' + l);
    const chats = this.chat.filter((c) => c.role !== 'sys').slice(-4)
      .map((c) => `${c.name}：${c.text}`);
    if (chats.length) lines.push('【刚才的对话】', ...chats);
    return lines.join('\n');
  }

  pushLog(text) {
    this.logs.push(text);
    if (this.logs.length > 260) this.logs.shift();
  }

  setBusyHint() {}
}

/* 结算弹窗（不复用 ui.modal，避免循环依赖时的时序问题） */
let closeModal = null;
function modalBox(content) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  const box = document.createElement('div');
  box.className = 'modal';
  box.append(content);
  scrim.append(box);
  document.getElementById('modalRoot').append(scrim);
  requestAnimationFrame(() => scrim.classList.add('on'));
  const close = () => { scrim.classList.remove('on'); setTimeout(() => scrim.remove(), 260); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  return { close };
}