# 多遊戲引擎介面 設計文件

> 狀態：草稿，等童童審閱。審閱通過後才寫實作計畫。
> 範圍：只做「把大老二抽成通用引擎介面」這一步。拱豬、傷心小棧、撿紅點、三種橋牌各自另開規則文件與計畫。

## 目標

把牌桌主機分成兩層：

- **牌桌層（store）**：成員、席位、憑證、身分、版本號、冪等收據、等待喚醒、事件信封、聊天、大廳、持久化。這層不知道桌上在玩什麼。
- **引擎層（engine）**：從發牌到結算的一切：每局狀態、手牌、牌堆、合法動作、桌面視角、規則選項、規則文字與版本。

完成定義：**純抽取，大老二是唯一引擎，使用者看不出任何差別**。既有 32 個單元測試與 4 個 e2e 全過，最多只允許改名。拱豬的任何功能都不在這一步做。

## 路線圖（童童 2026-09-04 定案）

拱豬 → 撿紅點 → 雙人橋牌 → 戲谷橋牌 → 正規橋牌。傷心小棧併進拱豬當第二種計分模式。

拱豬排第一的理由：拱豬、傷心小棧、三種橋牌都是「跟花色、比大小收墩、累積收到的牌」，這段可以做成第二層共用核心（`trick-taking-core.ts`），引擎各自組合它；撿紅點不用這層。拱豬先做等於把橋牌的打牌階段先做掉，之後橋牌只剩叫牌是新的。

## 現況：大老二長在牌桌層裡的地方

| 位置 | 內容 | 去向 |
|---|---|---|
| `Table.deck / currentPlay / currentPlaySeatId / passedSeatIds / openingRequiredCard / setAsideCards` | 大老二每局狀態 | 引擎狀態 |
| `Seat.cards`、`Seat.status`（`active/passed/finished` 是大老二用語） | 手牌與回合狀態 | 引擎狀態；牌桌層只留 `seated` |
| `#deal / #takeAction / #advance / #settle / #reassignOpeningLeader` | 發牌、出牌、輪轉、結算、離桌重算首攻 | 引擎方法 |
| `#view` 裡的 `pile / set_aside_cards / legal_plays` 與 `enumerateLegalBigTwoPlays` | 桌面視角 | 引擎的 `view` |
| `PublicTableView.rule_label / rules_version / rule_options` 寫死大老二型別 | 視圖信封 | 改成引擎回報 |
| `mcp-server.ts` 的 instructions 寫死 `bigtwo-tw-5`、`cards.max(5)`、事件種類列舉 | MCP 介面 | 改成由引擎提供／放寬 |
| `Table.activeSeatId` 單一行動者 | 回合模型 | 改成多人可行動（見下） |

## 方案比較

| 方案 | 做法 | 取捨 |
|---|---|---|
| **A. 純函式引擎（推薦）** | 引擎是一個模組，匯出對「狀態物件」操作的純函式；狀態是可序列化的普通物件 | 測試最容易（給狀態、看輸出）、快照直接存狀態、沒有隱藏欄位；代價是每個函式都要把狀態傳來傳去 |
| B. 引擎類別持有狀態 | 每桌 `new BigTwoEngine()`，方法改自己的欄位 | 寫起來直覺，但序列化要另外寫、測試要先建物件、狀態藏在實例裡不好比對 |
| C. 不抽層，用 `if (mode === ...)` 分支 | 在 store 裡每個方法加分支 | 第二款遊戲就會讓 store 變成兩千行，第三款開始沒人敢改 |

選 A。理由：牌桌層本來就有「版本號＋冪等收據＋快照」這套機制，純函式引擎跟它最合得來；橋牌的夢家、拱豬的亮牌都是「狀態轉換」，純函式最好推理。

## 引擎介面

```ts
// src/engine/types.ts
export interface GameEngine<State, Options> {
  readonly mode: string;                       // "bigtwo" | "gongzhu" | ...
  readonly label: string;                      // "大老二"
  readonly rulesVersion: string;               // "bigtwo-tw-5"
  readonly seats: { min: number; max: number; fixed: boolean };   // 拱豬 4/4/true、大老二 2/4/false
  readonly optionDescriptions: OptionDescription[];               // 開桌表單用
  normalizeOptions(value: unknown): Options;   // 缺欄位補預設、型別錯就拒絕（沿用現有 normalizeRuleOptions）
  buildRules(options: Options): GameRules;     // get_game_rules 與 join_table 回傳的規則物件
  formatRules(rules: GameRules): string;       // 給人看的規則表

  deal(input: { deck: Card[]; seatIds: string[]; options: Options; round: number }): { state: State; events: EngineEvent[] };
  pendingSeatIds(state: State): string[];      // 現在可以行動的席位；大老二永遠 0 或 1 個
  legalActions(state: State, seatId: string): LegalAction[];
  legalPlays(state: State, seatId: string): LegalPlay[];
  apply(state: State, seatId: string, action: SeatAction): { state: State; events: EngineEvent[]; result: RoundResult | null };
  onSeatRemoved(state: State, seatId: string): { state: State; events: EngineEvent[]; result: RoundResult | null } | "abort";
  view(state: State, viewerSeatId: string | null): GameBoardView;   // null = 純觀戰視角
  handCount(state: State, seatId: string): number;
  serialize(state: State): unknown;
  restore(saved: unknown): State;
}

export interface SeatAction { action: string; cards: string[]; hand_seat_id?: string }  // hand_seat_id 留給橋牌莊家替夢家出牌，本階段不實作
export interface LegalAction { action: string; label: string }
export interface LegalPlay { action: string; cards: string[]; label: string }            // action 預設 play_cards；亮牌、傳牌也走這裡
export interface RoundResult { winnerSeatId: string | null; scoreDelta: Record<string, number>; gameOver: boolean; text: string }
export interface EngineEvent { kind: string; seatId: string | null; text: string }
```

牌桌層的職責邊界：

- `startRound`：洗牌後呼叫 `engine.deal`，把 `state` 放進 `table.game`，事件包成 TableEvent。
- `humanAction / agentAction`：檢查版本、冪等、席位可行動（`pendingSeatIds` 包含它），再呼叫 `engine.apply`；結果有 `RoundResult` 就寫分數、標記局結束、`gameOver` 時把牌桌 phase 設成 `game_over`（大老二永遠不會）。
- `#removeSeat`：呼叫 `engine.onSeatRemoved`；回 `"abort"` 就結束本局不計分並公告。四人固定的吃墩遊戲預期一律 abort，大老二維持現在的重算首攻。
- `#view`：牌桌信封（成員、席位、分數、聊天、事件游標）＋ `engine.view` 的 `board` ＋ `legal_actions / legal_plays`。
- `#flushWaiters`：喚醒所有等待中的 Agent（現況就是全喚醒，不變）。

## 回合模型：從單一行動者改成「待行動集合」

現況 `activeSeatId` 只能有一個人行動。拱豬的亮牌、傷心小棧的傳三張、戲谷橋牌的「要求倒牌」都是**多人同時行動**的階段。這不是大老二風格的問題，是模型錯了，在這一步就改：

- `Table.activeSeatId` 改成由 `engine.pendingSeatIds(state)` 即時算出，不再存。
- `PublicTableView` 新增 `pending_seat_ids: string[]`，保留 `active_seat_id`（等於 `pending_seat_ids[0] ?? null`，讓現有 UI 與 connector 文件不用改）。
- Agent 的判斷句從「`active_seat_id === 我`」改成「`pending_seat_ids` 包含我」；工具說明同步改字。

牌桌 phase 縮成 `lobby | in_round | ended | game_over`；局內細分階段（亮牌中、傳牌中、出牌中、叫牌中）是引擎狀態自己的 `phase` 字串，透過 `board.phase` 露出。`player_turns` 改名 `in_round`，UI 與測試同步改。

## 視圖：信封不變，桌面換成 board

```ts
interface PublicTableView {
  // 牌桌信封（不變）：table_id, join_code, mode, rule_label, rules_version, rule_options, phase, version, round,
  // viewer_*, owner_name, players（seat_id, name, kind, hand_count, game_score, rounds_won, is_you）, spectators, recent_chat, last_event_id
  active_seat_id: string | null;      // 相容欄位
  pending_seat_ids: string[];         // 新
  hand: string[];                     // 你自己的手牌（原本藏在 players[].cards 裡）
  board: GameBoardView;               // 引擎決定形狀
  legal_actions: LegalAction[];
  legal_plays: LegalPlay[];
}

// 大老二的 board 就是現在的欄位搬家：
interface BigTwoBoard { phase: "opening" | "trick"; pile: { cards; hand_type; played_by_seat_id; played_by_name }; set_aside_cards: string[]; opening_required_card: string | null }
// 拱豬會是：phase、本墩已出的牌、各家收到的分牌、亮過的牌；撿紅點會是：桌面明牌、牌堆剩幾張、各家收牌
```

相容策略：`players[].cards`、`pile`、`set_aside_cards` 在這一步**保留**並從 `board` 複製一份，前端與 connector 都不用動；下一款遊戲上線時再拿掉舊欄位。

## MCP 工具：名稱不變，內容改成引擎提供

claude.ai 與 ChatGPT 會快取工具 schema，所以工具名稱與必填欄位一律不動，只做加法：

- `get_game_rules`：改成回「這桌」的規則；沒進桌時回大老二預設（相容）。多引擎後 join_table 回的規則本來就已依桌。
- `take_action`：`action` 從列舉改成字串（引擎驗證），`cards` 拿掉 `.max(5)`，新增選填 `hand_seat_id`。
- 事件種類（`mcp-server.ts` 的固定列舉）改成 `z.string()`；引擎事件種類前綴遊戲名（`bigtwo:cards_played`），牌桌層事件維持現名。
- server `instructions` 不再寫死 `bigtwo-tw-5`，改成「規則版本以 join_table 回傳為準」。

## 開桌與大廳

- `POST /api/tables` 新增 `mode`（預設 `bigtwo`），`options` 交給該引擎的 `normalizeOptions`。
- 開桌表單的規則選項由 `engine.optionDescriptions` 產生（現在是寫死在 index.html 的兩個 checkbox）。
- 大廳與營運台的摘要多一個 `rule_label`，已經有了；只要確認它來自引擎。
- 網頁前端：`app.js` 的桌面渲染拆成 `web/games/bigtwo.js`（renderPile、手牌選取、出牌按鈕），共用層負責大廳、席位、聊天、觀戰、入座、房主操作。這一步只是搬家。

## 持久化：快照升到版本 2

Remote Host 的加密狀態檔裡有真實牌桌與累積分數，不能在重構上線時消失。

- 快照 `version: 2`，每桌多 `mode` 與 `game`（引擎 `serialize` 的結果）；`Seat.cards / status` 與大老二欄位從桌層移除。
- 載入到 `version: 1` 時做一次遷移：把舊欄位組成 `BigTwoState`，跟今天早上 principal 遷移一樣的做法。遷移寫測試：用現在的程式產一份 v1 快照存進測試夾具，新程式載入後 `getHumanView` 結果一致。

## 不做的事

- 不在這一步加任何第二款遊戲的程式碼，`trick-taking-core.ts` 也留到拱豬。
- 不做搭檔制（橋牌）的分數模型，`RoundResult.scoreDelta` 是每席位的，搭檔算分留給橋牌自己在引擎內合併。
- 不動 OAuth、身分、大廳、限速這些今天剛穩定的東西。

## 檔案盤點（預計）

- 新增 `src/engine/types.ts`（介面）、`src/engine/big-two-engine.ts`（把 `big-two.ts` 的規則函式與 store 裡的流程組成引擎）、`src/engine/registry.ts`（mode → 引擎）。
- 修改 `src/multiplayer-store.ts`（拿掉大老二欄位與流程、接引擎、快照 v2 與遷移）、`src/mcp-server.ts`（schema 放寬、instructions）、`src/host-server.ts`（開桌帶 mode）、`web/app.js`＋新增 `web/games/bigtwo.js`、`web/index.html`（規則選項改成產生）。
- 測試：既有 36 個全保留；新增快照 v1→v2 遷移測試、引擎介面的純函式測試（把 `#deal / #takeAction / #advance / #settle` 的行為用引擎 API 再驗一次）。

## 給童童確認的三個決定

1. `active_seat_id` 保留為相容欄位、新增 `pending_seat_ids`。同意嗎？
2. 四人固定的吃墩遊戲有人局中離桌一律流局不計分（大老二維持現在的接續打）。同意嗎？
3. 快照升版並遷移，重構上線不清桌。這會多花半天寫遷移與測試；另一個選項是上線時清桌、妳重新開桌。妳選哪個？
