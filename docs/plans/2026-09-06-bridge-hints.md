# 制度宣告與叫品提示 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 規格：`docs/specs/2026-09-06-contract-bridge-rules.md` 第二、四、五節（童童 2026-09-06 確認：每人自己宣告、公開、搭檔不同只提醒、三套制度 sayc／taiwan_5533／taiwan_5542）。制度數字：`docs/research/2026-09-06-sayc-reference.md`（依 ACBL SAYC 手冊 2006 版整理）。
> 現況：席位模型 `Seat`（`src/multiplayer-store.ts` 約 200 行）、`#takeSeat`（約 665 行，已有 `position`）、`#view`（約 930 行）、持久化 `#persist`／`restore`（約 1095～1150 行）、`agentSay`／`humanSay` 是「一個席位設定一件事」的範本；MCP `take_seat`／`say_at_table` 在 `src/mcp-server.ts`；人類 `/api/human/say` 在 `src/host-server.ts`。合約橋牌 board 已有 `bids`、`dealer_seat_id`、`viewer_hcp`（`src/engine/bridge-engine.ts`）。
> 執行紀錄：2026-09-06 完成。小葵 130 測試，她抓到計畫兩處規則衝突（平均牌 25–27 撞 2♣、SAYC 4-4-3-2 低花沒分支），改正後 367 全過；Chrome 驗過選制度入座、搭檔不同提醒、輪到時的建議與一鍵送出（docs/screenshots/bridge-hint.png）。
> 分工：任務 1～2（`suggestCall` 與測試）派小葵；任務 3～6 阿宇做。

**目標：** 合約橋牌桌上每個人宣告自己的叫牌制度（公開、記住、搭檔不同只提醒），輪到自己叫牌時視角多一句依制度算的「建議＋理由」。

**方法：** 制度清單與 `suggestCall` 純函式放 `src/engine/bridge-systems.ts`（引擎不用它）；牌桌層在席位上存宣告、在 `#view` 為輪到的觀看者算 `bid_hint`；Agent 的宣告以 principal 記在狀態檔，人類記瀏覽器。每個任務結束都跑 `npm run build && node --test dist/test/*.test.js`。

**工具／技術：** TypeScript、node:test、Chrome 手動驗、既有 PAT push 流程。

---

### 任務 1：制度清單與 `suggestCall`（小葵）

**檔案：** 新增 `src/engine/bridge-systems.ts`

- [x] 步驟 1：匯出

```ts
export type BiddingSystemKey = "sayc" | "taiwan_5533" | "taiwan_5542";
export const BIDDING_SYSTEMS: readonly { key: BiddingSystemKey; label: string; summary: string }[] = [
  { key: "sayc", label: "SAYC（5533、1NT 15-17）", summary: "五張高花、低花三張以上、2♣ 強牌、弱二" },
  { key: "taiwan_5533", label: "台灣自然制 5533（1NT 16-18）", summary: "1NT 16-18，其餘同 SAYC" },
  { key: "taiwan_5542", label: "台灣自然制 5542（1NT 15-17）", summary: "1♦ 四張以上、1♣ 可能只有兩張，其餘同 SAYC" },
];
export const DEFAULT_BIDDING_SYSTEM: BiddingSystemKey = "sayc";
export function isBiddingSystemKey(value: unknown): value is BiddingSystemKey;
export interface AuctionCall { seatId: string; call: string }        // 同 board.bids 的 seatId／call（"PASS"／"X"／"XX" 或叫品）
export interface BidHint { call: string; reason: string }            // call 是叫品字串或 "PASS"／"X"
export function suggestCall(system: BiddingSystemKey, hand: readonly string[], auction: readonly AuctionCall[], order: readonly string[], viewerSeatId: string): BidHint | null;
```

- [x] 步驟 2：手牌評估工具（同檔內部函式）：`hcp`（A4 K3 Q2 J1，從 `lightbridge-rules.ts` 匯入 `highCardPoints`）、各花色張數、`balanced`（無單張缺門、最多一個雙張）、最長花色（等長取高的）。牌碼格式 `♠A`（花色在前）。
- [x] 步驟 3：判斷觀看者的處境（只看 `auction`，`order` 決定搭檔＝隔一位、上下家）：
  - **開叫**：目前沒有任何人叫過牌（全 PASS 或還沒人開口）。
  - **應叫**：搭檔是第一個叫牌的人（開叫者）、自己還沒叫過。右手對手若有蓋叫仍照應叫規則，但建議的叫品若已不合法（低於目前最高叫品）就回 null。
  - **開叫者再叫**：自己是開叫者、搭檔有應叫、對手都 PASS、輪到自己第二次開口。
  - **爭叫**：對手開叫（一線花色開叫）、搭檔還沒叫、自己第一次開口。
  - 其餘（第三輪以後、對手 1NT 開叫、對弱二／2♣ 的應叫、對 Double 的應叫、對蓋叫的應叫）回 null。
- [x] 步驟 4：**開叫**規則（依序取第一個符合的）：
  1. 平均牌型：HCP 25–27 → `3NT`；20–21 → `2NT`；1NT 範圍（sayc／taiwan_5542 15–17、taiwan_5533 16–18）→ `1NT`「N 點平均牌型，開叫 1NT」
  2. HCP ≥ 22 → `2♣`「22 點以上，強牌開叫 2♣」（平均 25–27 已在上一條先叫 3NT）
  3. HCP ≥ 13，或 HCP ≥ 12 且 HCP＋兩門最長張數 ≥ 20 → 開一線花色：5+ 張高花開最長的高花（等長開 ♠）；否則低花：`sayc`／`taiwan_5533` 比兩門低花的張數，♦ 多 → `1♦`、♣ 多 → `1♣`、等長時 3-3 → `1♣`、4-4 以上 → `1♦`（所以 ♦3 ♣2 開 1♦、♦2 ♣3 開 1♣）；`taiwan_5542` 用 ♦ ≥ 4 → `1♦`、否則 `1♣`。理由：「13 點、五張黑桃，開叫 1♠」／「12 點、低花三張制開叫 1♣」
  4. HCP 5–11 且 6 張 ♦／♥／♠（不是 ♣）且沒有 4 張的另一門高花 → 弱二「7 點、六張紅心，弱二開叫 2♥」
  5. HCP ≤ 10 且 7+ 張 → 3 線阻擊（♣ 也可）
  6. 否則 `PASS`「N 點，不夠開叫」
- [x] 步驟 5：**對 1♥／1♠ 的應叫**（開叫花色 M）：
  1. HCP ≥ 13 且 M ≥ 4 張 → `2NT`「13 點四張支持，Jacoby 2NT」
  2. M ≥ 5 張、HCP < 10、有單張或缺門 → `4M`
  3. M ≥ 3 張、HCP 10–11 → `3M` 限制性加叫；M ≥ 3 張、HCP 6–10 → `2M`
  4. 開叫 1♥、♠ ≥ 4 張、HCP ≥ 6 → `1♠`
  5. HCP ≥ 10：♣／♦ ≥ 4 張（長的優先，等長叫 ♦）→ `2♣`／`2♦`；開叫 1♠ 且 ♥ ≥ 5 → `2♥`（比低花優先）
  6. HCP 15–17 平均、M 2 張 → `3NT`
  7. HCP 6–9 → `1NT`
  8. 否則 `PASS`
- [x] 步驟 6：**對 1♣／1♦ 的應叫**（開叫花色 m）：
  1. HCP ≥ 6 且有 4+ 張高花 → 一線高花往上叫（兩門都 4 張叫 `1♥`；5 張以上叫長的，等長叫 ♠）
  2. 開叫 1♣、♦ ≥ 4 張、HCP ≥ 6 → `1♦`
  3. 支持（♦ ≥ 4、♣ ≥ 5）：HCP 10–11 → `3m`；6–9 → `2m`
  4. 平均牌型：HCP 16–18 → `3NT`；13–15 → `2NT`；6–9 → `1NT`
  5. HCP ≥ 10 → 最長花色二線（不是高花時）
  6. 否則 `PASS`
- [x] 步驟 7：**對 1NT 的應叫**：
  1. ♥ ≥ 5 → `2♦`「五張紅心，Jacoby 轉換」；♠ ≥ 5 → `2♥`（兩門都 5 張叫 ♠ 的轉換）
  2. HCP ≥ 8 且有 4 張高花 → `2♣` Stayman
  3. HCP 16–17 → `4NT`；10–15 → `3NT`；8–9 → `2NT`
  4. 否則 `PASS`
- [x] 步驟 8：**對 2♣ 的應叫**：HCP ≥ 8 且有 5+ 張花色 → 該花色最低線（♣／♦ 在 3 線）；HCP ≥ 8 平均 → `2NT`；否則 `2♦`「等待叫品」。**對弱二的應叫**：回 null（第一版不做）。
- [x] 步驟 9：**開叫者再叫**（自己開 1 線花色 S，搭檔應叫 R，對手都 PASS）：
  - R 是加叫 2S：HCP 13–15 → `PASS`；16–18 → `3S`；19+ → `4S`（S 是低花時 19+ 且平均 → `3NT`）
  - R 是 3S（限制性）：HCP ≥ 14 → `4S`（低花 → `3NT`）；否則 `PASS`
  - R 是 2NT（Jacoby）：→ `4S`（第一版不做示牌）
  - R 是 1NT：S ≥ 6 張：13–15 → `2S`、16–18 → `3S`；HCP 19+ 平均 → `3NT`；第二門 ≥ 4 張且不反叫（比 S 低）→ 二線該花色；否則 `PASS`
  - R 是一線新花 T（含 1♦、1♥、1♠）：T ≥ 4 張支持：13–15 → `2T`、16–18 → `3T`、19+ → `4T`；平均：13–15 → `1NT`、19+ → `2NT`；第二門 ≥ 4 張：比 S 低或一線可叫 → 最低線，比 S 高（反叫）需 HCP ≥ 16；S ≥ 6 張：13–15 → `2S`、16–18 → `3S`；否則 `1NT`
  - R 是二線新花 T：T ≥ 4 張支持：13–15 → `3T`、16+ → `4T`；平均 13–15 → `2NT`；S ≥ 6 → `2S`／`3S`（16–18）；第二門 ≥ 4 張且不反叫 → 最低線；否則 `2NT`
  - 其他 → null
- [x] 步驟 10：**爭叫**（對手開一線花色 O，搭檔還沒叫、自己第一次開口）：
  1. HCP 15–18 平均且 O 花色 ≥ 2 張 → `1NT`
  2. HCP 5–11 且 6 張非 O 的花色 → 跳蓋叫（弱）：該花色在目前最高叫品之上跳一線
  3. HCP ≥ 12、O ≤ 2 張、其餘三門都 ≥ 3 張 → `X`「12 點、開叫花色短，技術性 Double」
  4. 5+ 張非 O 的花色（長的優先）：一線可叫（花色比 O 高）且 HCP ≥ 8 → `1x`；要到二線則 HCP ≥ 10 → `2x`
  5. 否則 `PASS`
- [x] 步驟 11：所有建議先驗合法（叫品要高於目前最高叫品；`X` 只在對手叫的最高叫品未加倍時），不合法回 null。理由字串一句話、含點數與關鍵張數。

### 任務 2：測試（小葵）

**檔案：** 新增 `test/bridge-systems.test.ts`

- [x] 步驟 1：`BIDDING_SYSTEMS` 三套、`isBiddingSystemKey`。
- [x] 步驟 2：開叫：22 點 → 2♣；16 點平均 → sayc `1NT`、taiwan_5533 `1NT`；15 點平均 → taiwan_5533 不是 1NT（走一線花色）；13 點五張 ♠ → 1♠；13 點 ♠3 ♥3 ♦4 ♣3 → sayc `1♦`、taiwan_5542 `1♦`；13 點 ♠4 ♥4 ♦3 ♣2 → sayc `1♦`；13 點 4-3-3-3 且 ♣3 ♦3 → `1♣`；13 點 ♠4 ♥4 ♦3 ♣2 → sayc `1♦`、taiwan_5542 `1♣`；7 點六張 ♥ → `2♥`；10 點 7 張 ♣ → `3♣`；9 點平均 → `PASS`；12 點 5-4（rule of 20 過）→ 開叫、12 點 4-3-3-3 → PASS。
- [x] 步驟 3：對 1♠：13 點四張 ♠ → 2NT；8 點三張 ♠ → 2♠；11 點三張 → 3♠；7 點四張 ♥ 兩張 ♠ → 1NT；11 點五張 ♥ → 2♥；11 點四張 ♦ 三張 ♥ 兩張 ♠ → 2♦；4 點 → PASS。對 1♥：7 點四張 ♠ → 1♠。
- [x] 步驟 4：對 1♣：7 點 4-4 高花 → 1♥；8 點四張 ♦ 無高花 → 1♦；14 點平均無高花 → 2NT；8 點五張 ♣ 無高花 → 2♣。對 1♦：7 點四張 ♦ 無高花 → 2♦。
- [x] 步驟 5：對 1NT：五張 ♥ 3 點 → 2♦；四張 ♠ 9 點 → 2♣；9 點平均無高花 → 2NT；12 點 → 3NT；6 點無高花 → PASS。對 2♣：5 點 → 2♦；9 點五張 ♠ → 2♠。
- [x] 步驟 6：再叫：1♠–2♠ 後 14 點 → PASS、17 點 → 3♠、19 點 → 4♠；1♠–1NT 後 14 點六張 ♠ → 2♠；1♥–1♠ 後 14 點四張 ♠ → 2♠、17 點 → 3♠、14 點平均 → 1NT、14 點四張 ♦ → 2♦、14 點五張 ♥ 四張 ♠2 ♦2 ♣… 反叫（♠ 比 ♥ 高的新花）需 16+；1♦–1♥ 後 13 點四張 ♠ → 1♠。
- [x] 步驟 7：爭叫：(1♦) 後 16 點平均 → 1NT；13 點 ♦ 單張其餘 4-4-4 → X；9 點五張 ♠ → 1♠；10 點五張 ♣ → 2♣；8 點五張 ♣ → PASS；7 點六張 ♠ → 2♠（跳蓋叫）。
- [x] 步驟 8：處境判斷：全 PASS 後仍是開叫；對手蓋叫後建議的叫品若低於最高叫品 → null；第三輪 → null；對弱二 → null。auction 用 `order` 四席位的 id 造。
- [x] 步驟 9：`npm run build && node --test dist/test/*.test.js` 全過。

### 任務 3：牌桌層宣告（阿宇）

**檔案：** 修改 `src/multiplayer-store.ts`、`src/host-server.ts`、`src/host-client.ts`、`src/remote-mcp.ts`；測試 `test/multiplayer-store.test.ts`、`test/store-persistence.test.ts`

- [x] 步驟 1：`Seat` 加 `biddingSystem: BiddingSystemKey | null`（建席位時 null）；`PublicSeatView` 加 `bidding_system: string | null`、`bidding_system_label: string | null`（只有 mode `bridge` 的入座者有值，其餘 null）；`PublicTableView` 加 `bid_hint: { call: string; reason: string } | null`。
- [x] 步驟 2：`#takeSeat` 多可選 `biddingSystem`：有帶就存；沒帶時 Agent 用 `#principalSystems.get(principalId)`，再沒有就 `DEFAULT_BIDDING_SYSTEM`；只在 `engine.mode === "bridge"` 時處理，其他遊戲一律 null。事件文字有制度時「{name} 坐北，打 SAYC。」。
- [x] 步驟 3：`humanSetBiddingSystem(token, system, idempotencyKey)`／`agentSetBiddingSystem(...)` → `#setBiddingSystem(table, seat, system, key)`：驗 `isBiddingSystemKey`、桌是 bridge、入座者才可設（觀戰者報錯「先入座再宣告制度」）、`in_round` 也允許（宣告不動牌局），改 `seat.biddingSystem`、Agent 一併寫 `#principalSystems`、version +1、事件「{name} 宣告制度：台灣自然制 5542。」、flushWaiters、persist。
- [x] 步驟 4：持久化：快照加 `principalSystems: [principalId, system][]`（缺就空）、席位加 `biddingSystem`（缺就 null）；`restore` 對應讀回。`test/store-persistence.test.ts` 加一案：宣告後存、重載、同 principal 在新桌入座預設帶上。
- [x] 步驟 5：`#view` 算 `bid_hint`：`table.mode === "bridge" && table.phase === "in_round" && board.phase === "bidding" && pending.includes(viewer.id)` 時，`suggestCall(seat.biddingSystem ?? DEFAULT, engine.hand(state, viewer.id), board.bids, seatedIds, viewer.id)`，再用 `legalPlays`／`legalActions` 過濾（`PASS` 要 `pass` 合法、`X` 要 `double` 合法、叫品要在 `legal_plays`），不合法 → null；其餘情況 null。
- [x] 步驟 6：HTTP：`POST /api/human/system`、`POST /api/agent/system`（`bidding_system`、`idempotency_key`）；`HostClient`／`remote-mcp` 加 `setBiddingSystem`；`takeSeat` 三條路多 `bidding_system` 可選。
- [x] 步驟 7：`test/multiplayer-store.test.ts` 加：bridge 桌入座預設 sayc、`take_seat` 帶 taiwan_5542、觀戰者宣告被拒、大老二桌 `bidding_system` 是 null、叫牌階段輪到的人 `bid_hint` 有值（用固定 deck 找一手能開叫的）且不輪到的人是 null。

### 任務 4：MCP（阿宇）

**檔案：** 修改 `src/mcp-server.ts`、`test/mcp-server.test.ts`、`docs/MCP.md`

- [x] 步驟 1：`take_seat` inputSchema 加 `bidding_system: z.enum(["sayc","taiwan_5533","taiwan_5542"]).optional()`；新工具 `set_bidding_system`（`bidding_system`、`idempotency_key`），description 說明三套制度、宣告是公開的、搭檔不同時請在聊天室協調。
- [x] 步驟 2：`seatSchema` 加 `bidding_system`／`bidding_system_label` nullable；`tableSchema` 加 `bid_hint` nullable；文字摘要在叫牌階段末尾加「建議：1♠（13 點、五張黑桃）」與各家制度，搭檔不同時加一句「你和搭檔的制度不同，先在聊天室橋一下」。
- [x] 步驟 3：instructions 補 `set_bidding_system` 與 `bid_hint`。
- [x] 步驟 4：MCP 測試：合約橋牌那案改成 `take_seat` 帶 `bidding_system: "taiwan_5542"`、`set_bidding_system` 換回 `sayc`、發牌者的視角 `bid_hint` 非 null 且 call 在 legal_plays 或是 PASS。
- [x] 步驟 5：`docs/MCP.md` 補工具與欄位。

### 任務 5：前端（阿宇）

**檔案：** 修改 `web/app.js`、`web/index.html`、`web/styles.css`

- [x] 步驟 1：合約橋牌桌的椅子選單上方加制度下拉（三套），預設讀 `localStorage` 的 `agent-game-table:bidding-system`，入座時帶 `bidding_system` 並存回 localStorage。
- [x] 步驟 2：入座後自己的名牌旁加一顆小按鈕「制度」→ 同一個下拉，改了送 `/api/human/system`。
- [x] 步驟 3：玩家列每人顯示制度短名（SAYC／台灣 5533／台灣 5542）；自己與搭檔不同時在手牌區上方標「你們的制度不同，先在聊天室橋一下」。
- [x] 步驟 4：叫牌階段在叫牌鈕列上方顯示 `bid_hint`：「建議 1♠：13 點、五張黑桃」，點建議的叫品直接送出（PASS／X 同理）；null 時顯示「這一輪沒有建議」。
- [x] 步驟 5：本機 Host＋Chrome：開合約橋牌桌、選 taiwan_5542 入座、對手宣告不同看到提醒、叫牌階段看到建議並點它送出。截圖 `docs/screenshots/bridge-hint.png`。

### 任務 6：文件與交付（阿宇）

- [x] 步驟 1：README 合約橋牌列補「每人宣告制度、叫牌有建議」；規則文件第五節補一句實際覆蓋範圍。
- [x] 步驟 2：`npm test`、e2e 全過；commit、PAT push；更新 memory 與 SWITCHBOARD_STATUS；通知童童重啟 Host。

---

## 自審

- 規格覆蓋：宣告（入座帶／局間改／公開／不擋／記住）、三套制度、提示四段（開叫、第一次應叫、開叫者再叫、爭叫）、超出範圍 null、提示不影響 legal_plays（任務 1、3、5）。
- 一致性：`BiddingSystemKey` 三個字串在 systems、store、MCP enum、前端下拉四處相同；`bid_hint` 形狀 `{ call, reason }` 在 systems、store、MCP schema、前端相同；`suggestCall` 的 `auction` 就是 board 的 `bids`（欄位名 `seatId`／`call`），牌桌層轉一次 `seat_id → seatId`。
- 佔位符：無。「第一版不做」的項目都明確寫回 null。
