# 台灣輕橋牌 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 規則依據：`docs/specs/2026-09-05-lightbridge-rules.md`（童童 2026-09-05 四項答覆，第六節取捨照預設做）。引擎介面：`src/engine/types.ts`；同型範本：`src/engine/honeymoon-engine.ts`、`honeymoon-rules.ts`、`test/honeymoon-engine.test.ts`（叫牌、賭倍、重發、橋牌分的寫法都在那，直接沿用；`BIDS`／`bidRank`／`bidLevel`／`bidStrain` 從 `honeymoon-rules.ts` 匯入）；共用工具：`src/engine/trick-taking-core.ts`。
> 執行紀錄：2026-09-05 完成。小葵做任務 1～3（49 測試、全套 179 全過，review 無需修改）；前端把蜜月橋的叫牌元件擴成依人數排欄、加倒牌鈕與大牌點；API 腳本跑完一般局、四家全 PASS 重發、Double 後三 PASS 結束＋對家合計、純墩數、倒牌重發各一，Chrome 走完叫牌到第一墩。
> 分工：任務 1～3 派小葵（只碰列出的檔案，不 commit 不 push）；任務 4～6 阿宇自己做。

**目標：** 大廳可以開 4 人的台灣輕橋牌桌，人類與 AI 都能打完整局（自由叫牌、倒牌、四家全 PASS 重發、賭倍、13 墩、合約制或純墩數計分、對家合計），結束條件沿用分數制／局數制。

**方法：** 先寫規則模組（選項、大牌點、純函式計分、規則文字）並用測試釘住，再寫引擎流程（`bid`／`pass`／`redeal`／`double`／`redouble`／`play_card`），登錄後阿宇把蜜月橋的前端元件擴成四人版並補 MCP 摘要。每個任務結束都跑 `npm run build && node --test dist/test/*.test.js`。

**工具／技術：** TypeScript（exactOptionalPropertyTypes）、node:test、Chrome 手動驗、既有 PAT push 流程。

---

### 任務 1：規則模組與計分（小葵）

**檔案：** 新增 `src/engine/lightbridge-rules.ts`

- [x] 步驟 1：`LightbridgeOptions`（`scoring`／`pair_scoring`／`doubling`／`end_mode`／`end_rounds`／`end_score`）、預設值（`contract`、關、關、局數制 4 局、分數制 500）、`LIGHTBRIDGE_OPTION_DESCRIPTIONS`、`normalizeLightbridgeOptions`（壞值退回預設，不丟錯）
- [x] 步驟 2：`highCardPoints(hand)`（A 4、K 3、Q 2、J 1）、`REDEAL_THRESHOLD = 4`
- [x] 步驟 3：`scoreLightbridgeRound(contract, tricksWon, order, options)` 純函式：每墩 10 分；`contract` 模式主打方成約加獎分（墩分判部分合約 +50／成局 +300，6 線 +500、7 線 +1000，賭倍侮辱分 +50／+100）、倒約每墩 −50（賭倍 −100／−200）；`tricks` 模式只有墩分；`pair_scoring` 開啟時 `order[i]` 與 `order[(i + 2) % 4]` 合計後兩人各記。回傳 `{ scores, made, detail }`
- [x] 步驟 4：`buildLightbridgeRules` 與 `formatLightbridgeRules`（目標那行寫「2000～2020 年間流行於台灣各大校園的版本：叫牌憑默契、沒有夢家、點力太差可倒牌」；人數、發牌與順序、叫牌與倒牌與全 PASS、賭倍、打牌、計分表、整場結束、本桌選項、Agent 協定）

### 任務 2：引擎（小葵）

**檔案：** 新增 `src/engine/lightbridge-engine.ts`；修改 `src/engine/registry.ts`（只加一行登錄）

- [x] 步驟 1：`LightbridgeState` 與 board 照規格第三節；`seats: { min: 4, max: 4, fixed: true }`；mode `lightbridge`、label「台灣輕橋牌」、`rulesVersion "lightbridge-tw-1"`
- [x] 步驟 2：`deal`：每人 13 張，`dealer = seatIds[(round - 1) % 4]`，發牌者 active，phase `bidding`
- [x] 步驟 3：`legalActions`／`legalPlays`：叫牌階段 `bid`（有可叫的才列）、`pass`、`redeal`（輪到自己、自己還沒叫過、大牌點 < 4）、`double`／`redouble`（`doubling` 開啟且合法；`pair_scoring` 開啟時主打方的對家不能 Double）；打牌階段 `play_card` 用 `legalFollows`
- [x] 步驟 4：`apply("bid")`／`("pass")`／`("redeal")`／`("double")`／`("redouble")`：照規格；重發用 `node:crypto` 的 `randomInt` 重洗、`dealer` 換下一位、`bids` 清空、事件 kind `redeal`；有人叫過且最近三聲都 PASS → 設 `contract`／`trump`、phase `play`、主打方下家先出，事件拆兩個
- [x] 步驟 5：`apply("play_card")`：跟花色 → 四張到齊 `trickWinner` → `tricksWon += 1`、`lastTrick` 記下、贏家先出；13 墩打完結算 phase `ended`
- [x] 步驟 6：`settle` 用 `scoreLightbridgeRound`；`RoundResult.winnerSeatId` 是本局最高分（同分取 `order` 較前）；`text`「本局結束，{name} 拿最多分。」；`lastRoundScores`／`lastRoundDetail` 存進狀態
- [x] 步驟 7：`isGameOver`、`onSeatRemoved`（局中一律 `"abort"`）、`transferSeat`（含 `dealer`）、`view`（`viewer_hcp` 只在叫牌階段給入座的觀看者；不揭露他人手牌）、`hand`、`serialize`／`restore`
- [x] 步驟 8：`registry.ts` 登錄 `lightbridge`

### 任務 3：測試（小葵）

**檔案：** 新增 `test/lightbridge-engine.test.ts`

- [x] 步驟 1：選項預設與壞值；`highCardPoints`；`scoreLightbridgeRound`：純墩數、成約部分合約、成局、滿貫、倒約扣分、賭倍、`pair_scoring` 合計兩人同分
- [x] 步驟 2：發牌：四手各 13、發牌者依 round 輪換且先叫
- [x] 步驟 3：叫牌：只列比目前高的叫品、輪錯人被拒；有人叫過後連續三家 PASS 才結束（兩家 PASS 不結束）、合約與王牌正確、主打方下家先出；NT 合約 `trump` 是 null
- [x] 步驟 4：四家全 PASS（用 `restore` 建三家已 PASS 的狀態）：第四個 PASS 後仍在 bidding、`bids` 清空、發牌者換下一位、四手各 13 張、52 張不重複、沒有 result
- [x] 步驟 5：倒牌：大牌點 < 4 且第一次開口才有 `redeal`；叫過或 PASS 過就沒有；點數 ≥ 4 沒有；執行後重發不變量同上
- [x] 步驟 6：賭倍：關時沒有；開時只有非主打方可 Double、主打方可 Redouble、再叫更高清倍數；`pair_scoring` 開時主打方對家不能 Double
- [x] 步驟 7：打牌：跟花色、王牌可吃、13 墩打完自動結算、`tricks_won` 加總 13、`last_trick` 留著、`last_round_scores` 與 `last_round_detail` 對得上
- [x] 步驟 8：`isGameOver` 兩種模式、局中離桌 abort、`transferSeat`（含 `dealer`）、serialize／restore
- [x] 步驟 9：`npm run build && node --test dist/test/*.test.js` 全過（既有測試不能壞）

### 任務 4：牌桌層與 MCP（阿宇）

**檔案：** 修改 `src/mcp-server.ts`、`test/mcp-server.test.ts`、`docs/MCP.md`、`test/big-two-engine.test.ts`（registry 清單加 `lightbridge`）

- [x] 步驟 1：instructions 補台灣輕橋牌（`redeal` 是倒牌、三家 PASS 結束）；座位上限說明加「台灣輕橋牌 4 席」
- [x] 步驟 2：`summarizeBoard` 讓蜜月橋分支同時服務 lightbridge，加大牌點與四家墩數
- [x] 步驟 3：MCP 測試加一案：開台灣輕橋牌桌、三個 AI＋房主入座、發牌者叫 1♣、三家 PASS、board 有 `contract`
- [x] 步驟 4：`docs/MCP.md` 補 board 形狀與動作說明

### 任務 5：前端（阿宇）

**檔案：** 修改 `web/app.js`、`web/index.html`、`web/styles.css`、`web/connect.html`

- [x] 步驟 1：`isBridgeGame` 涵蓋 `honeymoon` 與 `lightbridge`；叫牌紀錄依人數排欄（發牌者最左）；叫牌鈕列多「倒牌」（`legal_actions` 有 `redeal` 才顯示）；叫牌階段手牌區顯示「大牌點 N」
- [x] 步驟 2：打牌階段四張本墩（沿用上一墩殘影）、合約與王牌、主打方墩數與還差幾墩；換牌相關的顯示只在 `honeymoon` 出現
- [x] 步驟 3：`DEFAULT_RULE_TEXT`、副標、FAQ 加台灣輕橋牌
- [x] 步驟 4：本機起 Host，Chrome 開一桌（房主＋三假人類走 API）走完叫牌（含倒牌）到結算；API 腳本跑一般局、全 PASS 重發、倒牌、賭倍、對家合計各一
- [x] 步驟 5：`npm test` 與 e2e 全過

### 任務 6：文件與交付（阿宇）

- [x] 步驟 1：`README.md` 遊戲表加台灣輕橋牌
- [x] 步驟 2：commit、PAT push；更新 memory `project_agent_game_table.md` 與 SWITCHBOARD_STATUS；通知童童等重啟

---

## 自審

- 規則覆蓋：發牌者輪換、三家 PASS 結束、全 PASS 重發、倒牌條件、賭倍與對家限制、首攻、13 墩、兩種計分與對家合計、結束兩制、離桌流局（任務 1、2）。
- 一致性：動作名 `bid`／`pass`／`redeal`／`double`／`redouble`／`play_card`；board 欄位以規格第三節為準；叫品常數從 `honeymoon-rules.ts` 匯入不複製。
- 佔位符：無。
