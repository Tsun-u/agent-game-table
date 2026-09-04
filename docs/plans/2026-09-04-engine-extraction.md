# 抽出通用遊戲引擎（大老二為唯一引擎） 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 執行紀錄：2026-09-04 完成，前端拆檔延後到第二款遊戲（只有一個渲染器時拆檔沒有驗證價值）。另依童童同日決定，局中離桌改為一律流局（取代原本的接續打）。
> 設計依據：`docs/specs/2026-09-04-multi-game-engine.md`（童童 2026-09-04 核可，三個決定採文件推薦：保留 active_seat_id 加 pending_seat_ids、四人固定吃墩遊戲局中離桌流局、快照升版並遷移）。

**目標：** 牌桌層不再知道大老二；大老二成為 `src/engine/` 下的純函式引擎。使用者看不出差別，既有 32 單元＋4 e2e 全過。

**方法：** 先把引擎介面與大老二引擎在旁邊做好並用測試釘住行為，再把 store 切過去，最後放寬 MCP schema、開桌帶 mode、快照升版。每個任務結束都跑 `npm test`。

**工具／技術：** TypeScript（exactOptionalPropertyTypes 開著）、node:test、Playwright e2e、既有的 PAT push 流程。

---

### 任務 1：引擎介面與登錄表

**檔案：**
- 新增：`src/engine/types.ts`（設計文件裡的 `GameEngine<State, Options>` 與周邊型別，原樣搬入）
- 新增：`src/engine/registry.ts`（`engineFor(mode: string): GameEngine`、`listEngines()`）

- [x] 步驟 1：建 `types.ts`，型別照設計文件；`SeatAction.hand_seat_id` 用 `hand_seat_id?: string`（exactOptionalPropertyTypes 下不要寫 `| undefined`）
- [x] 步驟 2：建 `registry.ts`，先只登錄 bigtwo（任務 2 完成後填入）
- [x] 步驟 3：`npm run build` 通過

### 任務 2：大老二引擎（純函式）

**檔案：**
- 新增：`src/engine/big-two-engine.ts`
- 修改：`src/big-two.ts`（不動邏輯，只 re-export 給引擎用）、`src/big-two-rules.ts`（`buildBigTwoRules` 接受引擎的 options）
- 新增測試：`test/big-two-engine.test.ts`

引擎狀態：
```ts
interface BigTwoState {
  phase: "opening" | "trick" | "ended";
  hands: Record<string, string[]>;         // seatId → 牌面碼（已排序）
  order: string[];                          // 入座順序（輪轉用）
  currentPlay: BigTwoPlay | null; currentPlaySeatId: string | null;
  passed: string[]; finished: string[];
  openingRequiredCard: string | null; setAside: string[];
  active: string | null;
}
```

- [x] 步驟 1：`deal`：從 store 的 `#deal` 搬邏輯（3 人 17 張留 1 張、其餘 13 張、最低牌者先攻）。事件 `turn_started`
- [x] 步驟 2：`apply`：搬 `#takeAction`＋`#advance`＋`#settle`。`RoundResult.scoreDelta` 用 `bigTwoStake`（從 store 搬到引擎）；`gameOver` 永遠 false
- [x] 步驟 3：`onSeatRemoved`：搬 `#removeSeat` 裡的大老二段（手牌作廢、pass 清單、`#reassignOpeningLeader`、輪轉到下一位、剩一人就結束）
- [x] 步驟 4：`legalActions / legalPlays / pendingSeatIds / view / handCount / serialize / restore`
- [x] 步驟 5：測試：把 `test/big-two.test.ts` 與 `test/multiplayer-store.test.ts` 裡直接驗規則行為的案例，用引擎 API 再寫一遍（首攻必含 ♣3、跟牌壓不過、pass 回到領牌者重新領牌、三人局留牌、出完結算加倍、首手前離桌重算先攻）
- [x] 步驟 6：`npm test` 通過（新測試加入後總數應為 32＋新增）

### 任務 3：store 切到引擎

**檔案：**
- 修改：`src/multiplayer-store.ts`

- [x] 步驟 1：`Table` 加 `mode: string` 與 `game: unknown | null`（引擎狀態）；移除 `deck / currentPlay / currentPlaySeatId / passedSeatIds / openingRequiredCard / setAsideCards / activeSeatId`；`Seat` 移除 `cards / status`
- [x] 步驟 2：`TablePhase` 改 `"lobby" | "in_round" | "ended" | "game_over"`；全檔 `player_turns` → `in_round`
- [x] 步驟 3：`createTable(humanName, options, mode = "bigtwo")`：`engineFor(mode).normalizeOptions(options)`；`seats.max` 取代 `MAX_SEATS` 的用法（大老二仍 4）
- [x] 步驟 4：`startRound`：洗牌後 `engine.deal`，`table.game = state`，事件包成 TableEvent（`kind` 前綴 `bigtwo:` 的先不做，維持現名，避免 UI 改動）
- [x] 步驟 5：`#seatAction`：可行動檢查改成 `engine.pendingSeatIds(state).includes(seat.id)`；呼叫 `engine.apply`；有 `result` 就寫 `gameScore / roundsWon`、phase → `ended`
- [x] 步驟 6：`#removeSeat`：局中呼叫 `engine.onSeatRemoved`；`"abort"` 時 phase → `ended` 並公告「本局流局」
- [x] 步驟 7：`#view`：信封＋`hand`＋`board`＋`pending_seat_ids`＋`active_seat_id`（相容）＋`legal_actions / legal_plays`；`players[].cards / pile / set_aside_cards` 從 board 複製一份（相容）
- [x] 步驟 8：`listTables / listLobby` 的 `rule_label / player_count / active_player_name` 改從引擎取
- [x] 步驟 9：`npm test`：預期只剩快照相關失敗（任務 4 處理）

### 任務 4：快照 v2 與 v1 遷移

**檔案：**
- 修改：`src/multiplayer-store.ts`（`#persist / #restore`）
- 新增：`test/fixtures/snapshot-v1.json`（用任務 3 之前的程式產生：一桌三人局中、一桌大廳，含分數）
- 修改：`test/store-persistence.test.ts`

- [x] 步驟 1：**在動任務 3 之前**先用現行程式產出 v1 快照夾具（明文 JSON，走 `MultiplayerTablePersistence` 介面的假實作抓 `save` 的參數）
- [x] 步驟 2：`#persist` 寫 `version: 2`，每桌 `mode` 與 `game: engine.serialize(state)`；seat 不再有 `cards / status`
- [x] 步驟 3：`#restore` 遇到 `version: 1`：把 `seats[].cards / status`、`currentPlay`、`passedSeatIds`、`openingRequiredCard`、`setAsideCards`、`activeSeatId`、`phase: player_turns` 組成 `BigTwoState`，再走 v2 路徑
- [x] 步驟 4：測試：載入夾具後 `getHumanView` 的 `phase / round / players[].hand_count / game_score / active_seat_id / pile` 與夾具內容一致；出一手牌不報錯
- [x] 步驟 5：`npm test` 全過

### 任務 5：MCP、HTTP、前端

**檔案：**
- 修改：`src/mcp-server.ts`、`src/host-server.ts`、`src/remote-mcp.ts`（只有型別）、`web/index.html`、`web/app.js`、新增 `web/games/bigtwo.js`、`src/host-server.ts` 的 `staticAsset` 加 `/games/bigtwo.js`

- [x] 步驟 1：`mcp-server.ts`：`take_action` 的 `action` 改 `z.string()`、`cards` 拿掉 `.max(5)`、加 `hand_seat_id: z.string().optional()`；事件 `kind` 改 `z.string()`；instructions 改成「規則版本以 join_table 回傳為準」；view schema 加 `hand / board / pending_seat_ids`
- [x] 步驟 2：`host-server.ts`：`POST /api/tables` 讀 `body.mode`（預設 bigtwo，未知 mode 回 400「不支援的遊戲」）；新增 `GET /api/games`（`listEngines()` 的 mode / label / optionDescriptions / seats）
- [x] 步驟 3：`web/index.html`：規則選項的兩個 checkbox 改成容器 `#ruleOptions`，由 `app.js` 依 `/api/games` 產生
- [ ] 步驟 4（延後到拱豬）：`web/app.js`：桌面渲染（`renderPile`、手牌選取、出牌／PASS 按鈕文字）搬到 `web/games/bigtwo.js`，以 `window.AgentGameTableGames.bigtwo = { renderBoard, ... }` 掛載；`app.js` 依 `table.mode` 取用
- [x] 步驟 5：`npm test` 與 `npm run test:e2e` 全過；本機起 Host 用 Chrome 走一次開桌→入座→開局→出牌

### 任務 6：文件與交付

- [x] 步驟 1：`docs/MCP.md`：新增「多遊戲引擎」段（介面、board、pending_seat_ids、快照 v2）；`take_action` 說明更新
- [x] 步驟 2：`README.md` 一句話提到引擎層
- [x] 步驟 3：commit（訊息說明純抽取、無使用者可見變更）、PAT push
- [x] 步驟 4：更新 memory `project_agent_game_table.md`（引擎介面落地、拱豬可開工）與 SWITCHBOARD_STATUS

---

## 自審

- 設計覆蓋：介面九項（任務 1、2）、待行動集合（任務 3 步驟 5、7）、board 與相容欄位（任務 3 步驟 7）、MCP 加法（任務 5）、快照 v2（任務 4）、前端拆檔（任務 5）。
- 一致性：引擎方法名以 `src/engine/types.ts` 為準；store 只透過 `engineFor(table.mode)` 取引擎。
- 佔位符：無。
