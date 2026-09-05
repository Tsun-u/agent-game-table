# 台灣輕橋牌 規則文件

> 狀態：依童童 2026-09-05 的四項答覆撰寫（合約、倒牌、計分、結束條件），第六節取捨照預設實作，她若要改再調。實作計畫：`docs/plans/2026-09-05-lightbridge.md`。實作分工：引擎、規則模組、測試派小葵；前端、`src/mcp-server.ts` 與文件由阿宇做。
> 出處：2000～2020 年間流行於台灣各大校園的版本。叫牌憑默契、沒有夢家、點力太差可倒牌，是拿掉制度與夢家的輕量版橋牌。公開資料只找得到旁證（`docs/research/2026-09-04-funtown-casual-bridge.md`），規則以童童口述為準。
> 同型參考：`docs/specs/2026-09-05-honeymoon-bridge-rules.md`（叫品、橋牌分、賭倍的寫法沿用）。

## 一、基本玩法

- **人數**：固定 4 人（`seats: { min: 4, max: 4, fixed: true }`）。沒有搭檔、沒有夢家，四家各打各的手牌；只有「對家分數合計」開關開啟時，對面兩家的分數才合起來算。
- **牌**：52 張，每人 13 張。A 最大、2 最小。
- **發牌者**：第 1 局是席位順序第一位，之後每局輪換（`seatIds[(round - 1) % 4]`）；倒牌或全 PASS 重發時，發牌者換給下一位。發牌者先叫牌，依席位順序輪流。
- 一局分兩個階段：叫牌 → 打牌。

### 1. 叫牌

- 叫品格式與順序同蜜月橋：線位 1 到 7 ＋ ♣、♦、♥、♠、NT，共 35 種，1♣ 最低、7NT 最高。每次叫牌必須比目前最高叫品高。**沒有點力限制、沒有制度**，伺服器只管合法性。
- 輪到的人可以叫牌、PASS，或在符合條件時倒牌（見下）。
- **叫牌結束**：有人叫過之後，**連續三家 PASS** 就結束。最後的叫品是合約，叫出它的人是主打方，合約花色是王牌（NT 無王）。
- **四家全 PASS**（沒人叫過）：整桌重發，發牌者換下一位，這局不計分、局數不增加。事件：「四家都 PASS，重新發牌，改由 {name} 發牌。」
- **倒牌**：輪到自己叫牌、**自己還沒叫過任何一聲**（第一次開口）、而且手牌大牌點小於 4（A 4、K 3、Q 2、J 1）時，可以要求倒牌：整桌重發，發牌者換下一位，不用其他人同意，次數不限。伺服器驗點數，不符合就沒有這個動作。事件：「{name} 點力不足，要求倒牌，改由 {name} 發牌。」（拆成兩個事件，各提一個人）。
- **賭倍**（選項 `doubling`，預設關）：主打方以外的人在最高叫品是別人叫的時可以 Double；被 Double 的主打方可以 Redouble；之後任一人再叫更高就清掉倍數。「對家分數合計」開啟時，主打方的對家不能 Double 自己人。

### 2. 打牌

- 第一墩由**主打方的下家**（席位順序的下一位）先出。
- 必須跟花色，沒有該花色才可出別的牌（含王牌）。有人出王牌就王牌大，否則同花色點數大者贏（`trickWinner(plays, leadSuit, trump)`）。
- 贏家收該墩、下一墩先出。打滿 13 墩結算。

### 3. 計分（選項 `scoring`）

主打方需要贏 6 ＋ 合約線位墩才成約。

**`contract`（預設）「合約制」**：

| 項目 | 分數 |
|---|---|
| 每墩 | 誰贏誰得 10 分，四家各算各的 |
| 主打方成約獎分 | 用合約墩分判斷（♣♦ 每墩 20、♥♠ 每墩 30、NT 第一墩 40 之後 30，賭倍時 ×2／×4）：墩分 < 100 部分合約 +50；≥ 100 成局 +300；合約 6 線再 +500、7 線再 +1000 |
| 主打方倒約 | 每倒一墩 −50（賭倍時 −100／−200），防守方不另外得分 |
| 賭倍成約侮辱分 | Double +50、Redouble +100 |

**`tricks`「純墩數」**：只有每墩 10 分，不看合約、不算賭倍。

**對家分數合計**（選項 `pair_scoring`，預設關）：一局結算後把對面兩家的本局分數相加，兩家各記這個合計分（兩人同分）。整場結束時同一對的兩人並列。

### 4. 累積與結束

分數逐局累加。沿用局數制（預設，4 局）或分數制（任一家累積分 ≥ `end_score`，預設 500）。整場結束時累積分最高者勝。

## 二、桌面選項

| key | 名稱 | 型別 | 說明 |
|---|---|---|---|
| `scoring` | 計分方式 | choice | `contract`（預設）「合約制」／`tricks`「純墩數」 |
| `pair_scoring` | 對家分數合計 | boolean | 預設關。開啟時對面兩家的分數合起來算 |
| `doubling` | 賭倍 | boolean | 預設關。只影響合約制 |
| `end_mode` | 結束方式 | choice | `rounds`（預設）／`score` |
| `end_rounds` | 結束局數 | number | 預設 4，只在局數制顯示 |
| `end_score` | 結束分數 | number | 預設 500，只在分數制顯示 |

## 三、引擎對應

- mode `lightbridge`、label「台灣輕橋牌」、`rules_version: "lightbridge-tw-1"`。
- 檔案：`src/engine/lightbridge-rules.ts`（選項、計分、規則文字）與 `src/engine/lightbridge-engine.ts`（流程）。叫品常數 `BIDS`／`bidRank`／`bidLevel`／`bidStrain` 直接從 `honeymoon-rules.ts` 匯入，不要複製一份。跟花色、比牌用 `trick-taking-core.ts`。
- 不做的事：叫品合理性、身價、rubber、夢家、搭檔互通訊息。

### 動作字串

- `bid`：`cards: ["2♥"]`。
- `pass`：`cards: []`。
- `redeal`：`cards: []`，倒牌；只在叫牌階段、輪到自己、自己還沒叫過、大牌點 < 4 時列在 `legal_actions`（label「倒牌」）。
- `double` / `redouble`：`cards: []`，只在 `doubling` 開啟且合法時出現。
- `play_card`：`cards: ["♠A"]`。
- `legal_plays`：叫牌階段每個合法叫品一筆 `{ action: "bid", cards: [叫品], label: "可叫" }`；打牌階段每張可出的牌一筆 `play_card`。

### 狀態

```ts
interface LightbridgeState {
  phase: "bidding" | "play" | "ended";
  order: string[];                          // 席位順序（固定 4 個，順時針），跟入座順序相同
  dealer: string;                           // 本局發牌者；倒牌或全 PASS 後換下一位
  hands: Record<string, string[]>;
  bids: { seatId: string; call: string }[]; // 叫品字串或 "PASS" / "X" / "XX"
  contract: { seatId: string; bid: string; doubled: 0 | 1 | 2 } | null;
  trump: string | null;
  trick: { leader: string; plays: { seatId: string; card: string }[] } | null;
  tricksWon: Record<string, number>;
  active: string | null;
  lastTrick: { winnerSeatId: string; plays: { seatId: string; card: string }[] } | null;
  lastRoundScores: Record<string, number> | null;
  lastRoundDetail: string | null;
}
```

### 發牌

- `deal`：deck 依序每人 13 張，`dealer = seatIds[(round - 1) % 4]`，發牌者 active，phase `bidding`。
- **重發**（倒牌或四家全 PASS）：引擎用 `node:crypto` 的 `randomInt` 做 Fisher-Yates 重洗 52 張重新發，`dealer` 換成 `order` 裡的下一位，`bids` 清空，回到 `bidding`，不回傳 result。測試用 `restore` 建狀態、斷言不變量（四手各 13 張、52 張不重複、發牌者換人、`bids` 清空），不斷言確切牌面。

### legal_actions

- 叫牌階段輪到的人：`bid`（有可叫的才列）、`pass`、`redeal`（符合條件才列）、`double`／`redouble`（`doubling` 開啟且合法）。
- 打牌階段輪到的人：`play_card`。

### apply

- `bid`：驗證 → 追加 → 倍數歸 0 → 下一位。事件「{name} 叫 2♥。」
- `pass`：追加 "PASS"。若有人叫過且最近三聲都是 PASS → 叫牌結束：設 `contract`／`trump`，phase `play`，`trick.leader` 是主打方的下家。事件「{name} PASS。」＋「合約 2♥ 由 {name} 主打。」（後者 seatId 是主打方）。若沒人叫過且四家都 PASS → 重發。否則下一位。
- `redeal`：驗證條件 → 重發。
- `double`／`redouble`：同蜜月橋，下一位。
- `play_card`：驗證跟花色 → 四張到齊判贏家 → `tricksWon += 1`、`lastTrick` 記下 → 贏家先出；13 墩打完結算。事件「{name} 出 ♠A。」「{name} 贏得第 N 墩。」

### 結算

`scoreLightbridgeRound(contract, tricksWon, order, options)` 純函式匯出，回傳 `{ scores, made, detail }`；`detail` 是一句算式（例：「3♥ 成約：主打方 9 墩 90 + 部分合約 50 = 140；其餘各家每墩 10」）。`pair_scoring` 開啟時在同一函式內把對家（`order[i]` 與 `order[(i + 2) % 4]`）的分數相加後兩人各記合計。`RoundResult.winnerSeatId` 是本局分數最高者（同分取 `order` 較前）；`text`「本局結束，{name} 拿最多分。」`isGameOver` 同蜜月橋。

### board

```ts
{
  phase, dealer_seat_id, contract, trump, bids,
  viewer_hcp: number | null,                // 只在叫牌階段給觀看者自己的大牌點；觀戰者 null
  trick: { leader_seat_id, plays: { seat_id, card }[] } | null,
  tricks_won, last_trick: { winner_seat_id, plays } | null,
  seat_status, last_round_scores, last_round_detail,
}
```

### 離桌與代打

局中離桌一律 `"abort"`；`transferSeat` 換 id 不換位（`order`、`dealer`、`hands`、`bids`、`contract`、`trick`、`tricksWon`、`lastTrick`、`lastRoundScores` 一併改）。

## 四、前端（阿宇做）

- 叫牌格與叫牌紀錄沿用蜜月橋的元件，叫牌紀錄改成四欄（發牌者在最左）；叫牌鈕列多一顆「倒牌」，只在 `legal_actions` 有 `redeal` 時顯示；叫牌階段在自己的手牌區顯示「大牌點 N」。
- 打牌階段中央顯示本墩四張（本墩空著時淡化畫上一墩，標「上一墩 X 收下」）、合約與王牌、主打方墩數與還差幾墩。
- 玩家列顯示主打／各家墩數；局結束顯示 `last_round_detail`。
- `src/mcp-server.ts`：instructions 補台灣輕橋牌（`redeal` 是倒牌）；`summarizeBoard` 走蜜月橋那支分支再加大牌點與四家墩數；座位說明加「台灣輕橋牌 4 席」。

## 五、童童的答覆（2026-09-05）

1. 有合約，主打方拿 6＋線位墩；三家連續 PASS 結束；四家全 PASS 重發；賭倍預設關。對。
2. 大牌點小於 4（A 4、K 3、Q 2、J 1）可在自己第一次叫牌時倒牌，整桌重發、不用同意、次數不限。對。
3. 四家各算各的每墩 10 分，主打方成約加獎分、倒約扣 50 × 倒墩，備選純墩數做開關。對，另外也玩過對家分數合計，做成開關。
4. 局數制／分數制沿用，預設 4 局。OK。

## 六、設計取捨（預設照這裡實作，童童要改再調）

1. **首攻是主打方的下家**：正規橋牌的慣例，沒有夢家時也說得通。另一條路是主打方自己首攻。
2. **對家合計時兩人各記合計分**：牌桌累積分跟席位走，沒有「隊伍」的概念，所以讓對家兩人分數永遠相同、整場結束並列。另一條路是各記一半。
3. **倒牌只限自己第一次開口**：叫過（含 PASS 過）就不能再回頭要求，避免看到別人叫牌後才倒。
4. **倒約不給防守方分數**：四家各打各的，倒約只罰主打方，其餘三家靠搶墩的 10 分。
