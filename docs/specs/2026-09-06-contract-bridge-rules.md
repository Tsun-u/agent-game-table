# 合約橋牌 規則文件

> 狀態：依童童 2026-09-06 的答覆撰寫（選椅子、制度跟人、身價選項、制度清單、賭倍預設）。實作拆三份計畫：`docs/plans/2026-09-06-table-chairs.md`（牌桌層選椅子）、`docs/plans/2026-09-06-contract-bridge.md`（引擎）、`docs/plans/2026-09-06-bridge-hints.md`（制度宣告與叫品提示；宣告只有提示用到，跟提示放同一份）。分工照慣例：引擎、規則模組、測試派小葵；牌桌層、前端、`src/mcp-server.ts` 與文件由阿宇做。
> 同型參考：`docs/specs/2026-09-05-honeymoon-bridge-rules.md`（叫品、橋牌分、賭倍的寫法沿用）、`docs/specs/2026-09-05-lightbridge-rules.md`（四人叫牌流程沿用）。
> 取代先前的定案：路線圖原本寫「台灣自然制差異做桌面開關」，改成制度是**每位玩家自己的宣告**，不是桌面選項（第四節）。

## 零、範圍拆分

這份文件涵蓋三個獨立子系統，各自一份實作計畫、各自能獨立驗證：

1. **牌桌層：選椅子與制度宣告**。四人搭檔遊戲（拱豬、台灣輕橋牌、合約橋牌）入座時挑椅子，對家是對面那張；合約橋牌另外讓每位玩家宣告自己的叫牌制度。做完這步，拱豬「對家配合」與輕橋牌「對家合計」就能真的選搭檔。
2. **引擎：合約橋牌**。有搭檔、有夢家、有身價的正規橋牌，叫牌合法性由伺服器管。
3. **叫品提示**。依玩家宣告的制度，對輪到的人給一句「建議＋理由」，不強制。

## 一、牌桌層：選椅子

- 引擎介面 `seats` 多一個可選欄位 `chairs: readonly string[]`，有值代表這款遊戲的位置有意義。拱豬、台灣輕橋牌、合約橋牌宣告 `["北", "東", "南", "西"]`；大老二、排七、撿紅點、雙人橋牌不宣告，維持入座順序。
- `take_seat` 多一個可選參數 `position`（0 到 3，對應椅子）。有宣告椅子的桌：帶 `position` 就坐那張，被佔就報錯「那張椅子有人了」；不帶就坐編號最小的空椅。沒宣告椅子的桌忽略 `position`。
- 椅子編號直接寫進 `seat.seatIndex`，所以 `seatedMembers` 的排序、引擎拿到的 `seatIds` 順序、代打時 `transferSeat` 搬 `seatIndex` 全部不用改。對家＝`order[(i + 2) % 4]` 這條在四人坐滿時自然成立。
- 換椅子＝`leave_seat` 再 `take_seat`，都只能在局間做，不另外加動作。
- 人類網頁：有椅子的桌把「入座」鈕換成四張椅子（北東南西，坐了的顯示名字），點空椅入座；`POST /api/human/seat` 多帶 `position`。
- 公開視角每個入座者多 `position` 與 `chair`（椅子名），觀戰者為 null。邀請詞提到「入座時可用 position 選椅子，對面是搭檔」。

## 二、牌桌層：制度宣告

- 只有合約橋牌用到。每個入座者有一個 `bidding_system` 欄位，值是第四節清單的 key（`sayc`／`taiwan_5533`／`taiwan_5542`）；入座時可帶（`take_seat` 的可選參數 `bidding_system`），局間可改（MCP 工具 `set_bidding_system`、人類 `POST /api/human/system`）。沒宣告就是 `sayc`。
- **公開**：四家與觀戰者都看得到每個人的宣告（橋牌慣例是對手有權知道你們打什麼）。
- **搭檔不同不擋**：兩人宣告不同時，公開視角帶 `partner_system_mismatch: true`，前端在玩家列標「你們的制度不同」，Agent 的文字摘要也提一句；要不要協調交給聊天室。
- **記住**：Agent 的宣告以身分（principal＋agent_name）存進 Host 的狀態檔，下次入座任何橋牌桌預設帶上；人類存瀏覽器 `localStorage`，入座表單預設帶上。

## 三、引擎：合約橋牌

- mode `bridge`、label「合約橋牌」、`rules_version: "bridge-tw-1"`、`seats: { min: 4, max: 4, fixed: true, chairs: ["北", "東", "南", "西"] }`。
- 檔案：`src/engine/bridge-rules.ts`（選項、身價、計分、規則文字）與 `src/engine/bridge-engine.ts`（流程）。叫品常數從 `honeymoon-rules.ts` 匯入；跟花色、比牌用 `trick-taking-core.ts`。
- 搭檔：北南一隊、東西一隊。分數以隊為單位，兩人各記隊伍分（同輕橋牌「對家合計」的做法），整場同隊兩人並列。

### 1. 發牌與身價

- 52 張每人 13 張，A 最大、2 最小。發牌者第 1 局是北，之後每局順時針輪換（`order[(round - 1) % 4]`），發牌者先叫。
- 選項 `vulnerability`：
  - `none`（預設）「無身價」：每局都無身價。
  - `chicago`「四局制」：以四局為一輪，`(round - 1) % 4` 為 0 都無身價、1 與 2 發牌方有身價、3 都有身價。
- board 帶 `vulnerable: { ns: boolean, ew: boolean }`。

### 2. 叫牌

- 叫品同蜜月橋 35 種；每次必須高於目前最高叫品。伺服器只管合法性，制度不進引擎。
- 輪到的人可以叫牌、PASS、Double、Redouble。**賭倍一律開啟**，只有 `vulnerability = none` 時才出現 `doubling` 開關可關（`visibleWhen`），四局制不給關。
- Double：最高叫品是對手叫的、尚未加倍時可 Double。Redouble：最高叫品是自己方叫的、已被 Double 時可 Redouble。任何更高叫品清掉倍數。Double／Redouble 中斷連續 PASS。
- **結束**：有人叫過之後連續三家 PASS。合約＝最高叫品＋倍數；**莊家＝主打方裡最先叫出合約花色（或 NT）的人**，不一定是最後叫的人；夢家＝莊家的搭檔。
- **四家全 PASS**：引擎重洗重發，**同一人再發、身價不變、局數不增加**（ACBL 四局制的做法，身價循環不受影響）。事件：「四家都 PASS，重新發牌，仍由 {name} 發牌。」

### 3. 打牌與夢家

- 首攻＝莊家的下家（左手邊）。首攻打出後**夢家攤牌**：`view()` 從這一刻起對所有人揭露夢家整手牌（`dummy_hand`），之後夢家出過的牌從中移除。
- 輪到夢家出牌時，`pendingSeatIds` 回傳**莊家**；`legalPlays(state, 莊家)` 列的是夢家手上的合法牌，label「替夢家出」；`apply` 從莊家收到牌，牌不重複所以引擎自己認得是夢家的。夢家席位在自己的回合 `legalActions` 為空，只能看牌聊天。`SeatAction.hand_seat_id` 用不到，這次一併從介面拿掉（目前沒有引擎使用）。
- 跟花色、比大小同前兩款橋牌。贏家收墩、先出下一墩，13 墩打完結算。本墩空著時 board 帶 `last_trick`（殘影原則）。

### 4. 計分（複式計分表，含身價）

主打方需要贏 6 ＋ 線位墩。成約主打方隊得分、倒約防守方隊得分，另一隊 0，不做零和換算。

| 項目 | 無身價 | 有身價 |
|---|---|---|
| 墩分（線位內每墩） | ♣♦ 20、♥♠ 30、NT 第一墩 40 之後 30；Double ×2、Redouble ×4 | 同左 |
| 部分合約獎分（墩分 < 100） | +50 | +50 |
| 成局獎分（墩分 ≥ 100） | +300 | +500 |
| 小滿貫（6 線成約） | +500 | +750 |
| 大滿貫（7 線成約） | +1000 | +1500 |
| 超墩（未加倍） | 每墩照合約墩分 | 同左 |
| 超墩（Double／Redouble） | 每墩 100／200 | 每墩 200／400 |
| 侮辱分（成約） | Double +50、Redouble +100 | 同左 |
| 倒約（未加倍） | 每墩 50 | 每墩 100 |
| 倒約（Double） | 第 1 墩 100、第 2～3 墩各 200、第 4 墩起各 300 | 第 1 墩 200、之後各 300 |
| 倒約（Redouble） | Double 的兩倍 | Double 的兩倍 |

`scoreBridgeRound(contract, tricksWon, vulnerable, order)` 純函式匯出（`contract` 含 `declarer`），回傳 `{ scores, made, detail }`，`detail` 一句算式（例：「4♠X 有身價成約：墩分 240 + 成局 500 + 侮辱分 50 = 790，北南得分」）。

### 5. 累積與結束

沿用局數制（預設 4 局；四局制建議填 4 的倍數，規則表提醒）或分數制（任一隊累積分 ≥ `end_score`，預設 1500）。整場結束累積分最高的隊勝。

### 6. 桌面選項

| key | 名稱 | 型別 | 說明 |
|---|---|---|---|
| `vulnerability` | 身價 | choice | `none`（預設）「無身價」／`chicago`「四局制」 |
| `doubling` | 賭倍 | boolean | 預設開；只在無身價時顯示，四局制一律開 |
| `end_mode` | 結束方式 | choice | `rounds`（預設）／`score` |
| `end_rounds` | 結束局數 | number | 預設 4 |
| `end_score` | 結束分數 | number | 預設 1500，只在分數制顯示 |

### 7. 動作字串

- `bid`：`cards: ["2♥"]`；`pass`／`double`／`redouble`：`cards: []`；`play_card`：`cards: ["♠A"]`（自己的牌或夢家的牌，從 `legal_plays` 照抄）。
- `legal_plays`：叫牌階段每個合法叫品一筆 `{ action: "bid", cards: [叫品], label: "可叫" }`；打牌階段每張可出的牌一筆，替夢家出的 label 為「替夢家出」。

### 8. 狀態

```ts
interface BridgeState {
  phase: "bidding" | "play" | "ended";
  order: string[];                          // 北東南西的席位 id
  dealer: string;
  vulnerable: { ns: boolean; ew: boolean };
  hands: Record<string, string[]>;
  bids: { seatId: string; call: string }[]; // 叫品字串或 "PASS" / "X" / "XX"
  contract: { bid: string; doubled: 0 | 1 | 2; declarer: string } | null;
  trump: string | null;
  dummyRevealed: boolean;
  trick: { leader: string; plays: { seatId: string; card: string }[] } | null;
  tricksWon: Record<string, number>;        // 兩隊各記在兩個席位上（同隊兩人相同）
  active: string | null;                    // 輪到夢家時填莊家
  lastTrick: { winnerSeatId: string; plays: { seatId: string; card: string }[] } | null;
  lastRoundScores: Record<string, number> | null;
  lastRoundDetail: string | null;
}
```

### 9. board

```ts
{
  phase, dealer_seat_id, vulnerable, contract: { bid, doubled, declarer_seat_id, dummy_seat_id } | null, trump, bids,
  dummy_hand: string[] | null,              // 首攻後才有值
  trick, tricks_won: { ns, ew }, last_trick, seat_status, last_round_scores, last_round_detail,
}
```

### 10. 離桌與代打

局中離桌一律 `"abort"`；`transferSeat` 換 id 不換位，`contract.declarer`、`active`、`tricksWon` 一併改。

## 四、制度清單（第一版三套）

| key | 名稱 | 差異 |
|---|---|---|
| `sayc` | SAYC（5533、1NT 15-17） | 五張高花、低花三張以上（3-3 開 1♣、4-4 開 1♦）、2♣ 強牌、2♦♥♠ 弱二。依 ACBL《Standard American Yellow Card》手冊 |
| `taiwan_5533` | 台灣自然制 5533（1NT 16-18） | 1NT 16-18，其餘同 SAYC |
| `taiwan_5542` | 台灣自然制 5542（1NT 15-17） | 1♦ 四張以上、1♣ 可能只有兩張（短梅花），其餘同 SAYC |

精確制不做（非選手少人玩）。盤式（rubber）排第二階段，等無身價與四局制上線後再開規則文件。

## 五、叫品提示

- 檔案 `src/engine/bridge-systems.ts`：`suggestCall(system, hand, auction, seatRole) → { call, reason } | null`。純函式。**由牌桌層呼叫**（引擎看不到席位宣告的制度，制度也不進引擎）：`#view` 在 mode 為 `bridge`、叫牌階段、觀看者輪到時，用該席位的 `bidding_system`、`engine.hand()` 與 board 的 `bids` 算一次，掛在公開視角的 `bid_hint: { call, reason } | null`；夢家、打牌階段、觀戰者為 null。
- 覆蓋範圍：SAYC 手冊有寫的處境逐條照手冊（開叫、各種應叫、再叫、爭叫，三批計畫），手冊沒寫的後續輪次用通用規則；建議不合法時回 null，前端顯示「這一輪沒有建議」。
- 理由用一句人話：「13 點、五張黑桃，開叫 1♠」「8 點、四張紅心，Stayman 問高花」。
- 提示是建議，`legal_plays` 不因它變動；Agent 可以無視。
- 實作：`docs/plans/2026-09-06-bridge-hints.md`；規則數字摘要 `docs/research/2026-09-06-sayc-reference.md`。
- 第二批（童童 2026-09-06 要求先補）：搭檔開弱二的應叫、搭檔開叫後對手 Double 的應叫、搭檔技術性 Double 後的應叫，`docs/plans/2026-09-06-bridge-hints-2.md`。第三批（童童 2026-09-06 決定一次做完）：其餘固定處境＋第三輪以後的通用規則（估搭檔最低點數、配合判斷、成局／邀請／競叫／守住），`docs/plans/2026-09-06-bridge-hints-3.md`。至此任何局面都有建議。

## 六、前端（阿宇做）

- 有椅子的桌：觀戰區的「入座」換成四張椅子。
- 合約橋牌 board：四家依北東南西擺（自己永遠在下方）、叫牌紀錄四欄（發牌者在最左，身價方標紅）、合約與莊家、夢家攤牌區、本墩四張與上一墩殘影、兩隊墩數與還差幾墩、`bid_hint` 顯示在叫牌鈕列上方。玩家列顯示每人宣告的制度，搭檔不同時標「你們的制度不同」。
- `src/mcp-server.ts`：instructions 補合約橋牌（夢家由莊家操作、`position`、`bidding_system`、`bid_hint` 是建議）；`summarizeBoard` 加身價、合約、夢家手牌、兩隊墩數。
- 加新遊戲的四處（邀請詞、規則卡、前端 board、MCP 文字摘要）逐一檢查。

## 七、童童的答覆（2026-09-06）

1. 制度跟著玩家不跟著房間；要能選對家。
2. 選椅子至少開給輕橋牌與拱豬（連同合約橋牌三款）。
3. 每人自己宣告制度、公開、搭檔不同只提醒，協調交給聊天室。
4. 身價做房主選項：無身價、四局制；盤式之後再加。
5. 精確制不做。
6. 賭倍預設開，只有無身價桌可以關。

## 八、設計取捨（預設照這裡實作，童童要改再調）

1. **四家全 PASS 同一人重發**：ACBL 四局制的做法；輕橋牌是換下一位發牌，這裡不換是為了保住身價循環。
2. **莊家是最先叫出合約花色的人**：正規規則，跟輕橋牌「最後叫的人主打」不同。
3. **分數制門檻預設 1500**：有身價成局一局就 400 分以上，500 太快結束。
4. **換椅子要先起身**：不做「換位」動作，局間 `leave_seat` 再 `take_seat` 就好。
5. **人類的制度記在瀏覽器**：人類沒有跨桌身分，Host 不替人類存偏好。
