# 浅滩鱼悔 · 规则核心（vendored）

这一段代码**不是**本页写的，是原样拷贝的开源实现：

- 上游：https://github.com/Jeko-jike/shallow-regrets
- 许可：MIT（见上游 `package.json`）
- 取用版本：`main` 分支（2026-11）
- 取用文件：`js/core/{cards,gameState,rules,stateMachine,abilities,scoring}.js`、`js/ai/heuristicAI.js`、`js/solo/{soloScript,soloFlow}.js`、`js/utils/rng.js`

规则权威来源（上游声明）：https://www.thefamilygamers.com/shallow-regrets/ —— 本页未改动任何规则数值。

## 本页只做了这些改动（全部标注在代码注释里）

| 文件 | 改动 | 原因 |
|---|---|---|
| `cards.js` | `CARD_BY_ID` 改为 Proxy；新增 `buildDeck(mult)`、`baseIdOf()` | 支持「n 倍牌组」：同一种鱼会有 `kraken#0`、`kraken#1` 多个实例，Proxy 让其余代码继续按 `CARD_BY_ID[id]` 查基础卡 |
| `gameState.js` | `createInitialState` 接受 `mult`，浅滩数按牌组自动算；state 增加 `mult` 字段 | 1 副 = 6 堆 / 2 副 = 12 堆 / 3 副 = 18 堆，每堆仍固定 4 张 |
| `abilities.js` | `shuffle_all` 用 `state.shoals.length` 代替常量 `NUM_SHOALS`；`REDIRECT` 改向时取候选人真正持有的女妖实例 id；狮子鱼判定用 `baseIdOf` | 多副牌组下常量会错；实例 id 带后缀，硬编码 `'banshee'`/`'lionfish'` 会失配 |
| `heuristicAI.js` | `id === 'lionfish'` → `baseIdOf(id) === 'lionfish'` | 同上 |

其余逻辑（三段回合、抽 2 张、钩数/难度、放回优先级、15 种能力、女妖/僧帽/眼球团/腐鱼四类反应窗口、停滞保护终局、污秽 -2）**一行未改**。

## 关于两个「6 张卡」拓展

官方（Button Shy / 设计者 Judson Cowan）共出过两个小拓展，都是 6 张卡，别搞混：

| 拓展 | 内容 | 效果 |
|---|---|---|
| **Lingering Remorse** | **6 张新鱼卡** | 这些鱼带「lingering 永续效果」（常驻起效，除非被横置）；官方说明：*Add the 6 expansion cards to the core 18-card game*，支持第 4 名玩家，**4 人时发 8 堆** |
| **The Fisher & The Frod** | 6 张单人模式卡 | 脚本对手 Frod 的行动牌，不是新鱼 |

所以：**基础 18 张鱼 + Lingering Remorse 6 张新鱼 = 24 张**，这正是上游 `cards.js` 的 24 张。

Lingering Remorse 那 6 张新鱼，就是本卡池里**唯一带永续被动能力**的 6 张：

| 卡 | 能力（永续） |
|---|---|
| 海猴 seaMonkey | 你不能捕捉难度 0 的鱼 |
| 女妖 banshee | 他人选目标时，你可以把目标换成女妖 |
| 僧帽水母 manOWar | 他人以你为目标时，可横置他一条鱼 |
| 狮子鱼 lionfish | 他人与你交换鱼时必须选狮子鱼 |
| 巨型乌贼 giantSquid | 他人不能选它为目标 |
| 旧日支配者 elderThing | 有其他可选的鱼时，你不能钓难度 ≥3 的鱼 |

（`cards.js` 里的 `LINGERING_EXPANSION_IDS` 就是按这个判定的。）

本页的落地：

- 开局设置里「牌池」可选 **基础 18 张** 或 **24 张（含 Lingering Remorse）**；选 4 人时自动带拓展并改发 8 堆（官方规则）。
- 浅滩堆数/每堆张数按官方：2-3 人 6 堆、4 人 8 堆，每堆 = 总牌数 ÷ 堆数（18 张→3/堆、24 张→4/堆、4 人 24 张→3/堆）。
- 「对手」可选 **AI 角色卡** 或 **Frod（The Fisher & The Frod）**：1v1、固定剧本、不烧 token、终局给 4 项星级评价。

上一层的适配代码在 `../regrets.js`：把 `applyAction(state, action) → {state, events}` 的纯函数状态机接到赛博棋牌室的通用对局外壳上，并生成给 LLM 的合法动作清单。
