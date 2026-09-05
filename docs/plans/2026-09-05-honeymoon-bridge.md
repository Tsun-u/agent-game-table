# 雙人橋牌（蜜月橋） 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 規則依據：`docs/specs/2026-09-05-honeymoon-bridge-rules.md`（童童 2026-09-05 三項答覆，第六節取捨照預設做）。引擎介面：`src/engine/types.ts`；同型範本：`src/engine/gongzhu-engine.ts`（吃墩流程）、`src/engine/paiqi-rules.ts`（選項與結束條件）、`test/paiqi-engine.test.ts`（測試寫法）；共用工具：`src/engine/trick-taking-core.ts`。
> 執行紀錄：2026-09-05 完成。小葵做任務 1～3（42 測試、全套 129 全過），阿宇 review 後拿掉引擎裡重複牌桌層的人數檢查；前端在 app.js 內依 mode 分路；Chrome 走完叫牌（含 Double／Redouble）、換牌一輪、結算畫面，API 腳本跑完一般局、雙 PASS 重發、賭倍局、墩數差局各一。
> 分工：任務 1～3 派小葵（只碰列出的檔案，不 commit 不 push）；任務 4～6 阿宇自己做。

**目標：** 大廳可以開雙人橋牌桌，人類與 AI 都能打完整局（叫牌、雙 PASS 重發、賭倍、13 輪換牌、13 墩打牌、橋牌分或墩數差計分），結束條件沿用分數制／局數制。

**方法：** 先寫規則模組（叫品順序、純函式計分、規則文字）並用測試釘住，再寫引擎流程（`bid`／`pass`／`double`／`redouble`／`play_card`），登錄後阿宇接前端叫牌格與 MCP 摘要。每個任務結束都跑 `npm run build && node --test dist/test/*.test.js`。

**工具／技術：** TypeScript（exactOptionalPropertyTypes）、node:test、Chrome 手動驗、既有 PAT push 流程。

---

### 任務 1：規則模組與計分（小葵）

**檔案：** 新增 `src/engine/honeymoon-rules.ts`

- [x] 步驟 1：`HoneymoonOptions`（`scoring`／`doubling`／`end_mode`／`end_rounds`／`end_score`）、預設值（`bridge`、關、局數制 4 局、分數制 500）、`HONEYMOON_OPTION_DESCRIPTIONS`（結束欄位帶 `visibleWhen`，計分是 choice）、`normalizeHoneymoonOptions`（照 `normalizePaiqiOptions`：壞值退回預設，不丟錯）
- [x] 步驟 2：`BIDS`（35 個叫品字串，`1♣` 到 `7NT`，由低到高）、`bidRank(bid)`（不在清單回 -1）、`bidLevel(bid)`、`bidStrain(bid)`（`♣`／`♦`／`♥`／`♠`／`NT`）
- [x] 步驟 3：`scoreHoneymoonRound(contract, tricksWon, order, options)` 純函式：橋牌分照規格第一節第 4 段的表（基本分、部分合約／成局、滿貫、超墩、倒約記給防守方、賭倍的倍數與侮辱分）；`trick_diff` 模式墩數差 ×10 給多的一方。回傳 `{ scores, declarerTricks, made, detail }`，`detail` 是一句算式（例：「2♥ 成約 +1 超墩：60 + 50 + 30 = 140」）
- [x] 步驟 4：`buildHoneymoonRules` 與 `formatHoneymoonRules`（目標、人數、叫牌與雙 PASS、賭倍、換牌、打牌、計分表、整場結束、本桌選項、Agent 協定：動作名與 cards 形狀）；選項值用 `displayOptionValue`

### 任務 2：引擎（小葵）

**檔案：** 新增 `src/engine/honeymoon-engine.ts`；修改 `src/engine/registry.ts`（只加一行登錄）

- [x] 步驟 1：`HoneymoonState` 與 board 照規格第三節；`seats: { min: 2, max: 2, fixed: true }`；mode `honeymoon`、label「雙人橋牌」、`rulesVersion "honeymoon-tw-1"`
- [x] 步驟 2：`deal`：前 13 張給 `seatIds[0]`、次 13 張給 `seatIds[1]`、其餘 26 張依序進 `stock`；`order[0] = seatIds[(round - 1) % 2]` 是發牌者且 active；phase `bidding`
- [x] 步驟 3：`legalActions`／`legalPlays`：叫牌階段列 `bid`（每個高於目前最高叫品的叫品一筆）、`pass`、`doubling` 開啟時視情況 `double`／`redouble`；換牌與打牌階段輪到的人 `play_card`，可出的牌用 `legalFollows`
- [x] 步驟 4：`apply("bid")`／`("double")`／`("redouble")`／`("pass")`：照規格；雙 PASS 用 `node:crypto` 的 `randomInt` 做 Fisher-Yates 重洗 52 張重新發、`order` 對調、`bids` 清空、事件 kind `redeal`；有人叫過之後 PASS → 設 `contract`／`trump`、翻開 `stock[0]`、phase `draw`、主打方先出，事件拆成兩個（PASS 的人一個、主打方一個）
- [x] 步驟 5：`apply("play_card")`：驗證跟花色→兩張到齊用 `trickWinner(plays, leadSuit, trump)` 判贏家。換牌階段：贏家拿 `stock[0]`、輸家拿 `stock[1]`、`drawRound += 1`、`lastTrick.drewCard` 記明牌、贏家先出；第 13 輪結束 phase `play`、**輸家**先出。打牌階段：`tricksWon += 1`、贏家先出；13 墩打完結算 phase `ended`。事件文字照規格
- [x] 步驟 6：`settle` 用 `scoreHoneymoonRound`；`RoundResult.winnerSeatId` 是得分方；`text` 成約「{name} 成約，得 140 分。」／倒約「{name} 打垮合約，得 100 分。」（seatId 是得分方）；`lastRoundScores`／`lastRoundDetail` 存進狀態
- [x] 步驟 7：`isGameOver`（局數制 `round >= end_rounds`、分數制任一家 `>= end_score`）、`onSeatRemoved`（局中一律 `"abort"`）、`transferSeat`（`order`、`hands`、`bids`、`contract`、`trick`、`tricksWon`、`lastTrick` 的 seatId 一併改）、`view`（不揭露對手手牌與換牌池未翻開的牌；`stock_top` 只在 draw 階段有值）、`hand`、`serialize`／`restore`
- [x] 步驟 8：`registry.ts` 登錄 `honeymoon`

### 任務 3：測試（小葵）

**檔案：** 新增 `test/honeymoon-engine.test.ts`（固定 deck 用 `deckFrom` 的寫法，見 `test/paiqi-engine.test.ts`）

- [x] 步驟 1：選項預設與壞值；`BIDS` 順序與 `bidRank`；`scoreHoneymoonRound`：部分合約（2♥ 剛好成約 60+50）、成局（3NT 100+300）、小滿貫、大滿貫、超墩、倒約記給防守方、Double／Redouble 的基本分與侮辱分與倒約罰分、`trick_diff` 模式
- [x] 步驟 2：發牌：13／13／26、發牌者依 round 輪換、發牌者先叫
- [x] 步驟 3：叫牌：只列比目前高的叫品、叫低的被拒、輪錯人被拒；有人叫過後 PASS 結束叫牌，合約與王牌正確、`stock_top` 翻開、主打方先出；NT 合約 `trump` 是 null
- [x] 步驟 4：雙 PASS（用 `restore` 建發牌者已 PASS 的狀態）：第二個 PASS 後仍在 bidding、`bids` 清空、發牌者對調、兩手各 13 張、換牌池 26 張、52 張不重複、沒有 result
- [x] 步驟 5：賭倍：`doubling` 關時沒有 `double`；開時只有對手叫牌後才能 Double、Double 後對方才能 Redouble、再叫更高就清倍數
- [x] 步驟 6：換牌：必須跟花色、王牌可吃、贏家拿明牌（在贏家手上、事件有寫）、輸家拿暗牌（在輸家手上、對手視角與 board 都看不到）、13 輪後 phase `play` 且由末輪輸家先出、手牌仍各 13 張
- [x] 步驟 7：打牌：13 墩打完自動結算、`tricks_won` 加總 13、`last_round_scores` 與 `last_round_detail` 對得上
- [x] 步驟 8：`isGameOver` 兩種模式、局中離桌 abort、`transferSeat`、serialize／restore
- [x] 步驟 9：`npm run build && node --test dist/test/*.test.js` 全過（既有測試不能壞）

### 任務 4：牌桌層與 MCP（阿宇）

**檔案：** 修改 `src/mcp-server.ts`、`test/mcp-server.test.ts`、`docs/MCP.md`、`test/big-two-engine.test.ts`（registry 清單加 `honeymoon`）

- [x] 步驟 1：instructions 補雙人橋牌（`bid` 帶一個叫品字串、`pass`、`double`／`redouble` 不帶牌、`play_card` 換牌與打牌共用）；座位上限說明加「雙人橋牌 2 席」
- [x] 步驟 2：`summarizeLegalPlays` 叫牌階段印範圍「可叫 1♦ 到 7NT」；`summarizeBoard` 加分支（叫牌紀錄、合約與王牌、明牌與換牌進度、本墩、雙方墩數、主打方還差幾墩）
- [x] 步驟 3：MCP 測試加一案：開雙人橋牌桌、兩個 AI 入座、發牌者叫 1♣、對方 PASS、board 有 `contract` 與 `stock_top`
- [x] 步驟 4：`docs/MCP.md` 補 board 形狀與動作說明

### 任務 5：前端（阿宇）

**檔案：** 修改 `web/app.js`、`web/index.html`、`web/styles.css`、`web/connect.html`

- [x] 步驟 1：`isBridgeGame(table)`（mode `honeymoon`）分路：叫牌格 7×5 只有合法叫品可按、PASS 鈕、賭倍開啟時 Double／Redouble 鈕、叫牌紀錄兩欄
- [x] 步驟 2：換牌階段中央顯示明牌與剩餘張數、本輪兩人的牌；剛拿到的牌高亮；打牌階段顯示本墩、合約與王牌、墩數、還差幾墩
- [x] 步驟 3：局結束顯示 `last_round_detail`；`DEFAULT_RULE_TEXT` 加雙人橋牌；副標與 FAQ 加雙人橋牌與 2 席說明
- [x] 步驟 4：本機起 Host，用 Chrome 開一桌（一人類＋一 AI 走 API）打完一局看結算；跑一次雙 PASS 重發、一次賭倍、一次墩數差模式
- [x] 步驟 5：`npm test` 與 e2e 全過

### 任務 6：文件與交付（阿宇）

- [x] 步驟 1：`README.md` 遊戲清單加雙人橋牌
- [x] 步驟 2：commit、PAT push；更新 memory `project_agent_game_table.md` 與 SWITCHBOARD_STATUS；通知童童等重啟

---

## 自審

- 規則覆蓋：發牌者輪換、叫牌合法性、雙 PASS 重發、賭倍、換牌明暗牌、末輪輸家首引、13 墩、兩種計分、結束兩制、離桌流局（任務 1、2）。
- 一致性：動作名 `bid`／`pass`／`double`／`redouble`／`play_card`、叫品字串線位在前、board 欄位以規格第三節為準。
- 佔位符：無。
