# 撿紅點 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 執行紀錄：2026-09-05 完成；前端仍在 app.js 內依 mode 分路、未拆檔；Chrome 手動打完 4 人一局結算正確，2 人局只跑單元測試。
> 規則依據：`docs/specs/2026-09-05-jianhongdian-rules.md`（童童 2026-09-05 核可，含三個設計取捨）。引擎介面：`src/engine/types.ts`。

**目標：** 大廳可以開 2 到 4 人的撿紅點桌，人類與 AI 都能打完整局（出牌配對、翻牌自動配、叨牌、黑 A 三段計分），結束條件沿用分數制／局數制。

**方法：** 先寫規則模組與純函式計分並用測試釘住，再寫引擎流程（一個 `play_card` 動作完成出牌與翻牌），登錄後前端加第三條分路（點手牌→桌面可配的牌亮起→點桌面牌或放到桌上）。每個任務結束都跑 `npm test`。

**工具／技術：** TypeScript、node:test、Chrome 手動驗、既有 PAT push 流程。

---

### 任務 1：規則模組與計分

**檔案：** 新增 `src/engine/jianhongdian-rules.ts`

- [x] 步驟 1：`JianhongdianOptions`（`end_mode`／`end_score`／`end_rounds`／`black_ace`／`peek_bottom`）、預設值（局數制 4 局、分數制 100、`both`、叨牌開）、`OPTION_DESCRIPTIONS`（結束欄位帶 `visibleWhen`）、`normalizeJianhongdianOptions`
- [x] 步驟 2：`cardPoints(card, options)`（紅 A 20、紅 9 到 K 10、紅 2 到 8 牌面、♠A 30／♣A 40 依 `black_ace`）、`totalPoints(options)`、`baseline(options, playerCount)`（一位小數）
- [x] 步驟 3：`buildJianhongdianRules` 與 `formatJianhongdianRules`（規則表文字：目標、人數、發牌表、一手的流程、配對表、分數表、計分與基準、叨牌、整場結束、本桌選項、Agent 協定）；選項值用 `displayOptionValue`

### 任務 2：引擎

**檔案：** 新增 `src/engine/jianhongdian-engine.ts`；修改 `src/engine/registry.ts`

- [x] 步驟 1：`JianhongdianState`（phase／order／hands／table／pile／captured／active／lastFlip／lastRoundScores）與 `JianhongdianBoard`
- [x] 步驟 2：`deal`：依人數發 6／8／12 張、桌面 4 張、牌堆 24 張；`order` 依 `round` 輪替首家；首家 active
- [x] 步驟 3：`pairs(a, b)`：A 到 9 湊十、10/J/Q/K 同點；`legalPlays`：每張手牌 `[手牌]` 一筆＋每張可配桌面牌 `[手牌, 桌面牌]` 一筆
- [x] 步驟 4：`apply("play_card")`：驗證→出牌（配或放桌）→翻牌自動配（多張可配取分數最高、同分取先攤）→事件文字→下一家或結算
- [x] 步驟 5：`scoreRound(captured, order, options)`：實得減基準、一位小數、`-0` 歸 0；`settle` 帶 `last_round_scores`
- [x] 步驟 6：`isGameOver`（局數制 `round >= end_rounds`、分數制任一家 `>= end_score`）、`onSeatRemoved`（局中 abort）、`transferSeat`、`view`（`bottom_card` 只給尾家且 `peek_bottom` 開）、`hand`、`serialize`／`restore`
- [x] 步驟 7：`registry.ts` 登錄 `jianhongdian`

### 任務 3：測試

**檔案：** 新增 `test/jianhongdian-engine.test.ts`

- [x] 步驟 1：配對表（五組湊十、四組同點、不配的例子）
- [x] 步驟 2：分數表與基準（`black_ace` 三種 × 2／3／4 人、一位小數）
- [x] 步驟 3：發牌張數（2／3／4 人）與首家逐局輪替
- [x] 步驟 4：`legal_plays` 同一張手牌同時有 `[hand]` 與 `[hand, table]`
- [x] 步驟 5：出牌配對＋翻牌自動配（多張可配取分數最高）、翻不到留桌、放桌不配
- [x] 步驟 6：整局打完自動結算、桌面剩牌不計、分數零和
- [x] 步驟 7：叨牌只有尾家視角有 `bottom_card`、關閉時沒有
- [x] 步驟 8：`isGameOver` 兩種模式、局中離桌 abort、serialize／restore
- [x] 步驟 9：`npm test` 全過

### 任務 4：牌桌層與 MCP

**檔案：** 修改 `src/mcp-server.ts`、`test/mcp-server.test.ts`、`docs/MCP.md`

- [x] 步驟 1：instructions 補「撿紅點的 legal_plays 每筆一張或兩張，原樣送 play_card」
- [x] 步驟 2：MCP 測試加一案：開撿紅點桌、兩個 AI 入座、開局、首家依 legal_plays 出一手，view 的 board 有 table 與 pile_count
- [x] 步驟 3：`docs/MCP.md` 補撿紅點的 board 形狀與動作說明

### 任務 5：前端

**檔案：** 修改 `web/app.js`、`web/index.html`、`web/styles.css`

- [x] 步驟 1：`isPickGame(table)`（mode `jianhongdian`）分路：`renderPickBoard`（桌面明牌、牌堆張數、叨牌、翻牌結果一行字）、`pickHandCard`（點手牌選起→桌面可配的亮起→點桌面牌配對／「放到桌上」鈕）
- [x] 步驟 2：玩家列顯示已收分數牌與本局實得分（沿用 captured chips）
- [x] 步驟 3：`describeRuleOptions` 補 choice 型選項的標籤（黑 A 計分）；`DEFAULT_RULE_TEXT` 加撿紅點
- [x] 步驟 4：本機起 Host，用 Chrome 開一桌撿紅點（一人類＋假人類）打完一局看結算；2 人局也走一次
- [x] 步驟 5：`npm test` 與 e2e 全過

### 任務 6：文件與交付

- [x] 步驟 1：`README.md`、`web/index.html`／`web/connect.html` 副標與 FAQ 加撿紅點
- [x] 步驟 2：commit、PAT push；更新 memory `project_agent_game_table.md` 與 SWITCHBOARD_STATUS

---

## 自審

- 規則覆蓋：發牌表、配對表、分數表、黑 A 三段、基準一位小數、叨牌、結束兩制、離桌流局（任務 1、2）。
- 一致性：動作名 `play_card`、board 欄位名以規格第三節為準；`bottom_card` 走 `view(state, viewerSeatId)` 的 viewer 判斷。
- 佔位符：無。
