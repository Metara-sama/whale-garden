# 浅滩鱼悔 · 规则核心（vendored）

这一段代码**不是**本页写的，是原样拷贝的开源实现：

- 上游：https://github.com/Jeko-jike/shallow-regrets
- 许可：MIT（见上游 `package.json`）
- 取用版本：`main` 分支（2026-11）
- 取用文件：`js/core/{cards,gameState,rules,stateMachine,abilities,scoring}.js`、`js/ai/heuristicAI.js`、`js/utils/rng.js`

规则权威来源（上游声明）：https://www.thefamilygamers.com/shallow-regrets/ —— 本页未改动任何规则数值。

## 本页只做了这些改动（全部标注在代码注释里）

| 文件 | 改动 | 原因 |
|---|---|---|
| `cards.js` | `CARD_BY_ID` 改为 Proxy；新增 `buildDeck(mult)`、`baseIdOf()` | 支持「n 倍牌组」：同一种鱼会有 `kraken#0`、`kraken#1` 多个实例，Proxy 让其余代码继续按 `CARD_BY_ID[id]` 查基础卡 |
| `gameState.js` | `createInitialState` 接受 `mult`，浅滩数按牌组自动算；state 增加 `mult` 字段 | 1 副 = 6 堆 / 2 副 = 12 堆 / 3 副 = 18 堆，每堆仍固定 4 张 |
| `abilities.js` | `shuffle_all` 用 `state.shoals.length` 代替常量 `NUM_SHOALS`；`REDIRECT` 改向时取候选人真正持有的女妖实例 id；狮子鱼判定用 `baseIdOf` | 多副牌组下常量会错；实例 id 带后缀，硬编码 `'banshee'`/`'lionfish'` 会失配 |
| `heuristicAI.js` | `id === 'lionfish'` → `baseIdOf(id) === 'lionfish'` | 同上 |

其余逻辑（三段回合、抽 2 张、钩数/难度、放回优先级、15 种能力、女妖/僧帽/眼球团/腐鱼四类反应窗口、停滞保护终局、污秽 -2）**一行未改**。

上一层的适配代码在 `../regrets.js`：把 `applyAction(state, action) → {state, events}` 的纯函数状态机接到赛博棋牌室的通用对局外壳上，并生成给 LLM 的合法动作清单。
