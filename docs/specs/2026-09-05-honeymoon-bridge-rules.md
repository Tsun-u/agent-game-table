# 雙人橋牌（蜜月橋）規則文件

> 狀態：依童童 2026-09-05 的答覆撰寫（計分、賭倍、雙 PASS 三項確認 OK）。實作計畫：`docs/plans/2026-09-05-honeymoon-bridge.md`。實作分工：引擎、規則模組、測試派小葵；前端、`src/mcp-server.ts` 與文件由阿宇做。
> 依據：`docs/research/2026-09-05-honeymoon-bridge-original-rules.md`（童童的原始 prompt）為家規來源；台灣部落格 airainjoey《橋牌的基本玩法(四)雙人橋牌-蜜月橋》流程與它一致。計分：所有公開來源都寫「與一般橋牌相同」，沒有蜜月橋專用計分，本文採複式橋牌的無身價計分再簡化。

## 一、基本玩法

- **人數**：固定 2 人（`seats: { min: 2, max: 2, fixed: true }`）。
- **牌**：52 張，每人 13 張，剩下 26 張面朝下當換牌池。牌的大小 A 最大、2 最小（`TRICK_RANK_ORDER`）。
- **發牌者**：第 1 局是席位順序第一位，之後每局輪換（`seatIds[(round - 1) % 2]`）。發牌者先叫牌。
- 一局分三個階段：叫牌 → 換牌 → 打牌。

### 1. 叫牌

- 叫品格式：線位 1 到 7 ＋ 花色 ♣、♦、♥、♠、NT，共 35 種。順序 1♣ < 1♦ < 1♥ < 1♠ < 1NT < 2♣ … < 7NT。
- 每次叫牌必須比上一個叫品高。伺服器只管合法性（比上一個高），**不判斷叫品合不合理**，沒有點力限制。
- 兩人輪流。**只要有人叫過，一方 PASS 叫牌就結束**，最後的叫品是合約，叫到的人是主打方，合約花色是王牌（NT 無王）。
- **雙 PASS（流局）**：發牌者開口 PASS、另一家也 PASS，代表沒人叫過就結束。引擎自己重洗重發，發牌者換另一人，這局不計分、局數不增加。事件文字：「雙方都 PASS，重新發牌，改由 {name} 發牌。」
- **賭倍**（選項 `doubling`，預設關）：開啟時，對手叫牌之後可以 Double，被 Double 的一方可以 Redouble；之後任一方再叫更高的叫品就把倍數清掉。Double / Redouble 之後對方 PASS，叫牌結束。

### 2. 換牌

- 叫牌結束後翻開換牌池第一張，主打方先出牌。
- 共 13 輪，每輪兩人各出一張：**必須跟花色**，沒有該花色才可出別的花色（含王牌）。比牌照吃墩規則：有人出王牌就王牌大，否則同花色點數大者贏（`trickWinner(plays, leadSuit, trump)`，NT 時 `trump` 傳 `null`）。
- 贏的人拿翻開的那張（雙方都看得到），輸的人拿下一張暗牌（只有拿的人看得到，對手與 board 都不揭露）。接著再翻開新的一張。
- 下一輪由上一輪贏家先出。13 輪結束時換牌池清空，兩人各 13 張。
- 換牌階段打出的牌不算墩數，只決定誰拿明牌。

### 3. 打牌

- 由**換牌最後一輪的輸家**先出。
- 跟花色規則與比大小同換牌階段。贏家收該墩、下一墩先出。
- **打滿 13 墩才結算**（超墩要算分，所以不提前結束）。

### 4. 計分（選項 `scoring`）

主打方需要贏 6 ＋ 合約線位墩才成約。

**`bridge`（預設）「橋牌分」**：複式橋牌無身價計分。

| 項目 | 分數 |
|---|---|
| 每墩基本分（合約線位內的墩） | ♣♦ 每墩 20；♥♠ 每墩 30；NT 第一墩 40、之後每墩 30 |
| 成約獎分 | 基本分合計 < 100：部分合約 +50；≥ 100：成局 +300 |
| 滿貫獎分（成約時） | 合約 6 線 +500；7 線 +1000（另加在成局獎分上） |
| 超墩 | 每墩加合約花色的墩分（♣♦ 20、♥♠ 30、NT 30） |
| 倒約 | 每倒一墩 50 分，**記給防守方**（正數） |

賭倍開啟時：Double 基本分 ×2、Redouble ×4（獎分門檻用加倍後的基本分算）；成約另加「侮辱分」Double +50、Redouble +100；超墩 Double 每墩 100、Redouble 每墩 200；倒約 Double 第一墩 100、之後每墩 200，Redouble 全部 ×2。

一局結束只有一方得分：成約主打方得分、倒約防守方得分，另一方 0。不做零和換算，牌桌「累積分最高者勝」直接成立。

**`trick_diff`「墩數差 ×10」**：不看合約。墩數多的一方得（自己墩數 − 對方墩數）× 10，另一方 0；6 對 7 這種只差一墩也算。同為 13 墩不可能（總共 13 墩），不用處理平手。

### 5. 累積與結束

分數逐局累加。結束條件沿用排七的桌面選項：局數制（預設，打滿 4 局）或分數制（任一家累積分 **≥ `end_score`**，預設 500，橋牌分是正數所以門檻方向和排七相反）。整場結束時累積分最高者勝。

## 二、桌面選項

| key | 名稱 | 型別 | 說明 |
|---|---|---|---|
| `scoring` | 計分方式 | choice | `bridge`（預設）「橋牌分」／`trick_diff`「墩數差 ×10」 |
| `doubling` | 賭倍 | boolean | 預設關。開啟可 Double／Redouble，只影響橋牌分 |
| `end_mode` | 結束方式 | choice | `rounds`（預設）／`score` |
| `end_rounds` | 結束局數 | number | 預設 4，只在局數制顯示 |
| `end_score` | 結束分數 | number | 預設 500，只在分數制顯示；任一家累積分達到就結束 |

## 三、引擎對應

- mode `honeymoon`、label「雙人橋牌」、`rules_version: "honeymoon-tw-1"`。
- 檔案：`src/engine/honeymoon-rules.ts`（選項、叫品順序、計分、規則文字）與 `src/engine/honeymoon-engine.ts`（流程）。跟花色、比牌用 `src/engine/trick-taking-core.ts` 的 `legalFollows`、`trickWinner`、`suitOf`、`sortTrickCards`。
- 不做的事（別加）：叫品合理性檢查、身價、rubber、夢家（`SeatAction.hand_seat_id` 不用）。

### 叫品與動作字串

- 叫品字串：`"1♣"`、`"3NT"`、`"7♠"`（線位在前、花色在後，跟牌碼 `♠A` 花色在前不會撞）。`honeymoon-rules.ts` 匯出 `BIDS`（35 個，由低到高）與 `bidRank(bid)`。
- 動作：
  - `bid`：`cards: ["2♥"]` 一個叫品。
  - `pass`：`cards: []`。
  - `double` / `redouble`：`cards: []`，只在 `doubling` 開啟且合法時出現。
  - `play_card`：`cards: ["♠A"]`，換牌與打牌階段共用。
- `legal_actions`：叫牌階段列 `bid`（有可叫的才列）、`pass`、視情況 `double` / `redouble`；換牌與打牌階段輪到的人 `play_card`。
- `legal_plays`：叫牌階段每個合法叫品一筆 `{ action: "bid", cards: [叫品], label: "可叫" }`；出牌階段每張可出的牌一筆 `{ action: "play_card", cards: [牌], label: "可出" }`。伺服器驗證；AI 只從清單挑。

### 狀態

```ts
interface HoneymoonState {
  phase: "bidding" | "draw" | "play" | "ended";
  order: [string, string];                  // order[0] 是本局發牌者
  hands: Record<string, string[]>;
  bids: { seatId: string; call: string }[]; // call 是叫品字串或 "PASS" / "X" / "XX"
  contract: { seatId: string; bid: string; doubled: 0 | 1 | 2 } | null;  // 叫牌結束才有值
  trump: string | null;                     // 合約花色；NT 是 null
  stock: string[];                          // 換牌池，stock[0] 是目前翻開的那張
  trick: { leader: string; plays: { seatId: string; card: string }[] } | null;
  tricksWon: Record<string, number>;        // 只算打牌階段
  drawRound: number;                        // 換牌已完成的輪數 0..13
  active: string | null;
  lastTrick: { winnerSeatId: string; plays: { seatId: string; card: string }[]; drewCard: string | null } | null;  // drewCard 是贏家拿到的明牌（換牌階段）
  lastRoundScores: Record<string, number> | null;
}
```

### 發牌

- `deal`：deck 前 13 張給 `seatIds[0]`、次 13 張給 `seatIds[1]`，其餘 26 張依序進 `stock`（不重排；deck 順序由牌桌層決定，測試用固定 deck）。發牌者 `order[0] = seatIds[(round - 1) % 2]`，`active` 是發牌者，phase `bidding`。
- **流局重發**：`apply` 收到讓叫牌變成雙 PASS 的第二個 `pass` 時，引擎用 Fisher-Yates 重洗 52 張（`node:crypto` 的 `randomInt`）重新發，`order` 對調，回到 `bidding`，**不回傳 result**。事件 kind `redeal`。測試用 `restore` 建雙 PASS 前的狀態，斷言重發後的不變量（兩手各 13 張、換牌池 26 張、52 張不重複、發牌者對調、`bids` 清空），不斷言確切牌面。

### apply

- `bid`：phase 必須是 `bidding` 且輪到自己；叫品必須在 `BIDS` 且高於目前最高叫品 → 追加到 `bids`、倍數歸 0 → 換人。事件：「{name} 叫 2♥。」
- `pass`：有人叫過 → 叫牌結束：設 `contract`、`trump`，翻開 `stock[0]`，phase `draw`，`trick = { leader: 主打方, plays: [] }`，`active` 主打方。事件：「{name} PASS，合約 2♥ 由 {主打方} 主打。」（Double 狀態時加「（Double）」）。沒人叫過 → 若是發牌者 PASS 就換人；若已是第二個 PASS 就流局重發。
- `double`：`doubling` 開啟、目前最高叫品是對手叫的、倍數 0 → 倍數 1，換人。`redouble`：倍數 1 且對手 Double 的 → 倍數 2，換人。事件：「{name} Double。」「{name} Redouble。」
- `play_card`：phase `draw` 或 `play`，輪到自己，牌在手上且符合 `legalFollows` → 放進 `trick.plays`。兩張到齊：
  - `draw`：贏家拿 `stock[0]`（明牌）、輸家拿 `stock[1]`，兩張從 `stock` 移除，`drawRound += 1`，`lastTrick.drewCard` 記明牌。事件：「{name} 贏得這輪，拿走 ♠Q。」第 13 輪結束後：phase `play`，`trick.leader` 是這輪**輸家**，事件「換牌結束，由 {name} 先出。」
  - `play`：贏家 `tricksWon += 1`，下一墩由贏家先出。事件：「{name} 贏得第 N 墩。」13 墩打完 → 結算，phase `ended`，回傳 `RoundResult`。
- 事件文字的 `{name}` 由牌桌層代入 `seatId` 那一席的名字，引擎不知道名字，所以**一個事件只提一個人**。要提到兩個人就拆成兩個事件，例如叫牌結束：「{name} PASS。」（seatId 是 PASS 的人）＋「合約 2♥ 由 {name} 主打。」（seatId 是主打方）。

### 結算

`scoreHoneymoonRound(contract, tricksWon, options)` 純函式匯出，回傳 `{ scores: Record<seat, number>, declarerTricks, made: boolean, detail: string }`，`detail` 是一句人看的算式（例：「2♥ 成約 +1 超墩：60 + 50 + 30 = 140」）。`RoundResult.winnerSeatId` 是得分方；`text`：「{name} 成約，得 140 分。」／「{name} 倒約 2 墩，對方得 100 分。」（後者 seatId 給防守方，文字改成「{name} 打垮合約，得 100 分。」）。`isGameOver`：局數制 `round >= end_rounds`；分數制任一家累積分 `>= end_score`。

### board

```ts
{
  phase, dealer_seat_id, contract: { seat_id, bid, doubled } | null, trump,
  bids: { seat_id, call }[],
  legal_bids_count: number,                   // 叫牌階段給前端顯示用，其餘 0
  stock_count: number, stock_top: string | null,   // 換牌階段翻開的那張；其他階段 null
  draw_round: number,                         // 已完成的換牌輪數
  trick: { leader_seat_id, plays: { seat_id, card }[] } | null,
  tricks_won: Record<seat, number>,
  last_trick: { winner_seat_id, plays, drew_card } | null,
  seat_status: Record<seat, "waiting" | "active">,
  last_round_scores: Record<seat, number> | null,
  last_round_detail: string | null,
}
```

`hand(state, seatId)` 回該席位手牌（含換牌拿到的暗牌）；`view` 對任何 viewer 都不揭露對手手牌或換牌池未翻開的牌。

### 離桌與代打

局中離桌一律 `"abort"`（流局）；`transferSeat` 換 id 不換位（`order`、`hands`、`bids`、`contract`、`trick`、`tricksWon`、`lastTrick` 的 seatId 一併改）。

## 四、前端（阿宇做）

- 叫牌階段：桌面中央畫 7 線 × 5 花色的叫品格，只有合法叫品可按（直接點選，不做循環切換）；旁邊 PASS 鈕，`doubling` 開啟時再加 Double／Redouble 鈕；叫牌紀錄兩欄顯示。
- 換牌階段：中央顯示翻開的明牌與換牌池剩餘張數、本輪兩人出的牌；自己剛拿到的牌在手牌裡高亮一下。
- 打牌階段：中央顯示本墩、合約與王牌、雙方墩數、主打方還差幾墩。
- 局結束顯示 `last_round_detail`。
- 開桌表單由 `/api/games` 生成，`scoring` 是二段切換。
- `src/mcp-server.ts` 由阿宇改：instructions 補雙人橋牌的動作說明（`bid` 帶一個叫品、`pass`、`double`／`redouble`、`play_card`）；`summarizeLegalPlays` 在叫牌階段改印「可叫 1♦ 到 7NT」這種範圍而不是列 35 筆；`summarizeBoard` 加分支：叫牌紀錄、合約與王牌、明牌、換牌進度、本墩、墩數。
- 座位上限說明改成「大多數遊戲 4 席、排七 6 席、雙人橋牌 2 席」（mcp-server.ts instructions、docs/MCP.md、web/connect.html FAQ）。

## 五、童童的答覆（2026-09-05）

1. 計分：預設簡化橋牌分、墩數差 ×10 做備選。OK。
2. 賭倍預設關。OK。
3. 叫牌階段雙 PASS（沒人叫過）重發、不計分、發牌者換人。OK。
4. 輸家拿的暗牌只有自己看得到、發牌者輪流先叫：她沒反對，照 prompt 與部落格寫法實作。

## 六、設計取捨（預設照這裡實作，童童要改再調）

1. **打滿 13 墩**：prompt 寫「先達到合約墩數或使對手達不到的一方獲勝」可以提前結束，但橋牌分要算超墩，所以打滿。墩數差模式也打滿，規則一致。
2. **倒約分記給防守方**（正數），不記主打方負分：牌桌慣例是高分者勝，橋牌本來就是單方得分。
3. **流局在引擎內重發**而不是回傳無結果的局：這樣局數制不會被流局吃掉一局，玩家也不用再按開局。
4. **分數制門檻預設 500**：一局成約大約 100 到 500 分，4 局左右分出勝負，跟局數制的手感接近。
