# 合約橋牌引擎 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 規則依據：`docs/specs/2026-09-06-contract-bridge-rules.md` 第三節（童童 2026-09-06 六項答覆，第八節取捨照預設做）。引擎介面：`src/engine/types.ts`；同型範本：`src/engine/lightbridge-engine.ts`、`lightbridge-rules.ts`、`test/lightbridge-engine.test.ts`（四人叫牌、賭倍、重發、規則文字的寫法直接沿用；`BIDS`／`bidRank`／`bidLevel`／`bidStrain` 從 `honeymoon-rules.ts` 匯入）；共用工具：`src/engine/trick-taking-core.ts`；椅子常數 `CHAIRS` 在 `types.ts`。
> 執行紀錄：2026-09-06 完成。小葵 44 測試一次過、review 無需修改（她指出規則文件的計分簽名與計畫不一，文件改成四參數版）；全套 227＋e2e 4 全過；API 腳本跑過一般局、四家全 PASS 同人重發、Double 倒 4 墩、四局制第 2 局東西有身價、賭倍關不掉；Chrome 看到夢家攤牌與莊家代出（docs/screenshots/bridge-dummy.png）。取捨：本墩維持橫排＋名字（跟輕橋牌同款），沒改成十字排。
> 分工：任務 1～3 派小葵（只碰列出的檔案，不 commit 不 push）；任務 4～6 阿宇自己做。制度宣告與叫品提示不在這份（`docs/plans/2026-09-06-bridge-hints.md`）。

**目標：** 大廳可以開 4 人的合約橋牌桌：北南對東西、叫牌合法性由伺服器管、莊家是主打方最先叫出合約花色的人、首攻後夢家攤牌並由莊家操作、複式計分表含身價（無身價／四局制）、賭倍預設開。

**方法：** 規則模組先釘住選項、身價判定與計分純函式，再寫引擎流程（`bid`／`pass`／`double`／`redouble`／`play_card`，夢家的回合 `active` 填莊家），登錄後阿宇做前端夢家區、MCP 摘要與文件。每個任務結束都跑 `npm run build && node --test dist/test/*.test.js`。

**工具／技術：** TypeScript（exactOptionalPropertyTypes）、node:test、Chrome 手動驗、既有 PAT push 流程。

---

### 任務 1：規則模組與計分（小葵）

**檔案：** 新增 `src/engine/bridge-rules.ts`

- [x] 步驟 1：`BridgeOptions`（`vulnerability: "none" | "chicago"`、`doubling`、`end_mode`、`end_rounds`、`end_score`）、預設值（`none`、開、局數制 4 局、分數制 1500）、`BRIDGE_OPTION_DESCRIPTIONS`（`doubling` 的 `visibleWhen: { key: "vulnerability", value: "none" }`）、`normalizeBridgeOptions`：壞值退回預設；**`vulnerability` 是 `chicago` 時 `doubling` 一律 true**，不管傳什麼
- [x] 步驟 2：`vulnerabilityFor(options, round, dealerIndex) → { ns: boolean; ew: boolean }`：`none` 全 false；`chicago` 依 `(round - 1) % 4`：0 都無、1 與 2 發牌方有（`dealerIndex` 0 或 2 是北南）、3 都有
- [x] 步驟 3：`sideOf(order, seatId) → "ns" | "ew"`（`order` 索引 0、2 是 ns）；`partnerOf(order, seatId)`
- [x] 步驟 4：`scoreBridgeRound(contract, tricksWon: { ns, ew }, vulnerable, order) → { scores, made, detail }` 純函式，`contract = { bid, doubled: 0|1|2, declarer }`：
  - 需要墩數 `6 + level`；墩分 ♣♦ 20、♥♠ 30、NT 40+30，× `2 ** doubled`；部分合約 +50、成局（墩分 ≥ 100）無身價 +300／有身價 +500；小滿貫 +500／+750、大滿貫 +1000／+1500；超墩未加倍每墩合約墩分，Double 100／200（無／有身價）、Redouble 200／400；侮辱分 Double +50、Redouble +100
  - 倒約：未加倍每墩 50／100；Double 無身價 100、200、200、300…（第 4 墩起 300），有身價 200、300、300…；Redouble 是 Double 的兩倍
  - 成約主打方那隊得分、倒約防守方那隊得分；`scores` 四個席位都有值，同隊兩人相同、另一隊 0
  - `detail` 一句算式，例：「4♠X 有身價成約：墩分 240 + 成局 500 + 侮辱分 50 = 790，北南得分」、「3NT 無身價倒 2 墩：50 × 2 = 100，東西得分」
- [x] 步驟 5：`buildBridgeRules` 與 `formatBridgeRules`：目標「四人搭檔的正規合約橋牌：北南對東西，叫牌合法性由伺服器管、制度各自宣告，莊家主打、夢家攤牌，複式計分表含身價。」；人數與椅子、發牌與身價、叫牌（三家 PASS 結束、四家全 PASS 同一人重發、賭倍規則）、莊家與夢家、打牌、計分表兩欄、整場結束、本桌選項、Agent 協定（`play_card` 可能是夢家的牌，從 `legal_plays` 照抄；`bid_hint` 只是建議）

### 任務 2：引擎（小葵）

**檔案：** 新增 `src/engine/bridge-engine.ts`；修改 `src/engine/registry.ts`（只加一行登錄）；修改 `src/engine/types.ts`（拿掉 `SeatAction.hand_seat_id` 與它的註解，其他引擎沒有用到）

- [x] 步驟 1：`BridgeState` 與 board 照規格三.8／三.9（board 不含 `bid_hint`，那是牌桌層的事）；`seats: { min: 4, max: 4, fixed: true, chairs: CHAIRS }`；mode `bridge`、label「合約橋牌」、`rulesVersion "bridge-tw-1"`
- [x] 步驟 2：`deal`：每人 13 張排序，`dealer = seatIds[(round - 1) % 4]`，`vulnerable = vulnerabilityFor(...)`，發牌者 active，phase `bidding`；事件「第 N 局開始，{name} 發牌並先叫牌。」＋身價一句（「本局北南有身價。」／「本局都無身價。」，seatId null）
- [x] 步驟 3：`legalActions`／`legalPlays`：叫牌階段 `bid`（有可叫的才列）、`pass`、`double`（最高叫品是對手那隊叫的、`doubled === 0`）、`redouble`（最高叫品是自己隊叫的、`doubled === 1`）；`doubling` 關時不列。打牌階段：輪到自己 `play_card` 用 `legalFollows`；**輪到夢家時 `active` 是莊家**，`legalPlays(state, 莊家)` 列夢家手上的合法牌、label「替夢家出」；夢家本人永遠空
- [x] 步驟 4：`apply("bid"|"pass"|"double"|"redouble")`：照規格；有人叫過且最近三聲 PASS → 結束：合約＝最高叫品＋倍數，**莊家＝該隊最先叫出這個花色（strain）的人**，`trump`，phase `play`，`trick.leader` 是莊家下家、`active` 同；事件「{name} PASS。」＋「合約 4♠X 由 {name} 主打，{name} 是夢家。」（拆兩個事件各提一個人）。四家全 PASS → `randomInt` 重洗重發、**dealer 與 vulnerable 不變**、`bids` 清空，事件「四家都 PASS，重新發牌，仍由 {name} 發牌。」
- [x] 步驟 5：`apply("play_card")`：出牌者是 `active`；牌在夢家手上時（只有莊家能送到）從夢家手牌移除、`plays` 記 `seatId` 為夢家；首攻那張落下後 `dummyRevealed = true`；四張到齊 `trickWinner` → 該隊 `tricksWon` +1（存在兩個席位上）、`lastTrick`、贏家先出（贏家是夢家時 `active` 填莊家）；13 墩打完結算 phase `ended`。事件「{name} 出 ♠A。」（夢家的牌 seatId 是夢家）、「{name} 贏得第 N 墩。」
- [x] 步驟 6：`settle` 用 `scoreBridgeRound`；`RoundResult.scoreDelta` 四席位；`winnerSeatId` 是得分那隊在 `order` 較前的人；`text`「本局結束，{name} 那隊得分。」；`lastRoundScores`／`lastRoundDetail` 存進狀態
- [x] 步驟 7：`isGameOver`（局數制／分數制，任一席位累積分 ≥ `end_score`）、`onSeatRemoved`（局中一律 `"abort"`）、`transferSeat`（含 `dealer`、`contract.declarer`、`active`、`tricksWon` 鍵）、`view`（`dummy_hand` 只在 `dummyRevealed` 後給、其他手牌不揭露；`viewer_hcp` 叫牌階段給入座者）、`hand`（夢家問自己仍拿到整手）、`serialize`／`restore`
- [x] 步驟 8：`registry.ts` 登錄 `bridge`

### 任務 3：測試（小葵）

**檔案：** 新增 `test/bridge-engine.test.ts`；修改 `test/big-two-engine.test.ts`（registry 清單加 `bridge`）

- [x] 步驟 1：選項預設與壞值、`chicago` 強制 `doubling`、`visibleWhen`；`vulnerabilityFor` 四局循環（發牌方北／東各驗）；`sideOf`／`partnerOf`
- [x] 步驟 2：`scoreBridgeRound` 表格案例（每案一個 test）：無身價 1♣ 7 墩 70、3NT 9 墩 400、4♠ 10 墩 420、4♠ 11 墩 450、6♥ 12 墩 980、7NT 13 墩 1520；有身價 3NT 9 墩 600、4♠ 10 墩 620、6♣ 12 墩 1370、7♠ 13 墩 2210；賭倍 2♥X 8 墩無身價 470、2♥X 9 墩無身價 570、2♥XX 8 墩無身價 640；倒約 3NT 7 墩無身價 100、有身價 200；3NTX 倒 3 無身價 500、有身價 800；3NTXX 倒 3 無身價 1000；同隊兩席位同分、另一隊 0
- [x] 步驟 3：發牌：四手各 13、發牌者依 round 輪換、身價事件
- [x] 步驟 4：叫牌：只列比目前高的叫品；兩家 PASS 不結束、三家才結束；莊家是最先叫該花色的人（用 `restore` 建 `bids`：北 1♠、東 PASS、南 2♠、西 PASS、北 4♠、三 PASS → 莊家北；北 1♣、東 PASS、南 1♠、西 PASS、北 4♠ → 莊家南）；首攻是莊家下家
- [x] 步驟 5：賭倍：只有對手隊能 Double、被 Double 的隊能 Redouble、更高叫品清倍數；`doubling` 關時都不列
- [x] 步驟 6：四家全 PASS：重發、dealer 與 vulnerable 不變、四手各 13、52 張不重複、沒有 result
- [x] 步驟 7：打牌與夢家：首攻前 `dummy_hand` 是 null、首攻後所有視角都有；輪到夢家時 `pendingSeatIds` 是莊家、莊家的 `legalPlays` 是夢家的牌、夢家自己 `legalActions` 空；莊家送夢家的牌成功、送自己的牌被拒；夢家贏墩後 `active` 仍是莊家；13 墩打完 `tricks_won.ns + ew === 13`、`last_round_scores` 與 `last_round_detail` 對得上
- [x] 步驟 8：`isGameOver` 兩種模式、局中離桌 abort、`transferSeat`（換莊家席位後 `contract.declarer` 與 `active` 跟著換）、serialize／restore
- [x] 步驟 9：`npm run build && node --test dist/test/*.test.js` 全過（既有測試不能壞；`hand_seat_id` 拿掉後 typecheck 要過）

### 任務 4：牌桌層與 MCP（阿宇）

**檔案：** 修改 `src/mcp-server.ts`、`test/mcp-server.test.ts`、`docs/MCP.md`

- [x] 步驟 1：`take_action` inputSchema 拿掉 `hand_seat_id`；instructions 補合約橋牌（夢家由莊家操作：輪到夢家時你的 legal_plays 是夢家的牌、照抄送 `play_card`；`position` 選椅子、對面是搭檔；四家全 PASS 同一人重發）
- [x] 步驟 2：`summarizeBridgeBoard` 加 mode `bridge`：身價、合約與莊家夢家、夢家手牌（攤牌後）、兩隊墩數與還差幾墩
- [x] 步驟 3：MCP 測試加一案：開合約橋牌桌、三 AI＋房主用 position 入座、發牌者叫 1NT、三家 PASS、board 有 `contract` 且 `dummy_seat_id` 是莊家對面
- [x] 步驟 4：`docs/MCP.md` 補 board 形狀與夢家出牌說明

### 任務 5：前端（阿宇）

**檔案：** 修改 `web/app.js`、`web/index.html`、`web/styles.css`、`web/rules.js`（若規則頁列遊戲）

- [x] 步驟 1：`BRIDGE_MODES` 加 `bridge`；叫牌紀錄四欄（發牌者最左、有身價的隊名標紅）；`DEFAULT_RULE_TEXT`、副標、`agentTurnInstructions` 加合約橋牌
- [x] 步驟 2：打牌階段畫夢家區：`board.dummy_hand` 在夢家那一側攤開；自己是莊家且 `legal_plays` 含夢家的牌時，夢家區的牌可點（送 `play_card`）；本墩四張依北東南西擺（自己在下）、上一墩殘影；合約、莊家、兩隊墩數與還差幾墩
- [x] 步驟 3：玩家列顯示隊別（北南／東西）與身價；局結束顯示 `last_round_detail`
- [x] 步驟 4：本機起 Host，API 腳本跑：一般局到結算、四家全 PASS 重發、Double 後三 PASS、四局制第 2 局發牌方有身價；Chrome 走完叫牌到夢家攤牌、莊家替夢家出一張。截圖 `docs/screenshots/bridge-dummy.png`
- [x] 步驟 5：`npm test` 與 e2e 全過

### 任務 6：文件與交付（阿宇）

- [x] 步驟 1：`README.md` 遊戲表加合約橋牌（八款）；`docs/specs/2026-09-04-multi-game-engine.md` 的 `hand_seat_id` 那行標已移除
- [x] 步驟 2：commit、PAT push；更新 memory `project_agent_game_table.md` 與 SWITCHBOARD_STATUS；通知童童重啟 Host

---

## 自審

- 規則覆蓋：椅子與隊伍、發牌者輪換、身價循環、三家 PASS 結束、全 PASS 同人重發、賭倍與隊伍限制、莊家判定、夢家攤牌與代出、13 墩、含身價計分表、結束兩制、離桌流局、代打換莊家（任務 1、2）。
- 佔位符：無。
- 一致性：`tricksWon` 在狀態裡是四席位鍵（同隊同值），board 給 `{ ns, ew }`；`scoreBridgeRound` 收 `{ ns, ew }`。`contract.declarer` 是席位 id，board 給 `declarer_seat_id`／`dummy_seat_id`。
