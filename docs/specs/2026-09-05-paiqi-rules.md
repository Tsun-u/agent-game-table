# 排七 規則文件

> 狀態：依童童 2026-09-05 的六項答覆撰寫；第六節取捨照預設實作，她若要改再調。實作計畫：`docs/plans/2026-09-05-paiqi.md`。實作分工：引擎、規則模組、測試、MCP 說明派小葵；前端與文件由阿宇做。
> 依據：童童口述為準。多的牌兩種處理方式做成開關。

## 一、基本玩法（預設）

- **人數**：2 到 6 人（`seats: { min: 2, max: 6, fixed: false }`）。
- **牌**：52 張；6 人時加兩張鬼牌共 54 張。牌平分給玩家，分不完的牌依「多的牌」開關處理：

| 人數 | 每人手牌 | 多的牌 |
|---|---|---|
| 2 | 26 | 0 |
| 3 | 17 | 1 |
| 4 | 13 | 0 |
| 5 | 10 | 2 |
| 6 | 9（含鬼牌） | 0 |

- **首家**：拿到 ♠7 的人是首家，第一手一定出 ♠7；之後依席位順序輪流。
- **一手**：輪到的人出一張牌接在桌面上：
  - 任一花色的 7 可以直接出（開一條新的花色列）。
  - 其餘的牌要跟同花色已在桌上的牌相鄰：7 出了才能出 8 和 6，8 出了才能出 9，依此類推，往上到 K、往下到 A。
- **蓋牌**：**有牌可出就不能蓋牌**。手上完全沒有能接的牌時，自己挑一張手牌蓋下（面朝下，其他人只看得到張數），這張牌永遠不再出。
- **一局結束**：所有人手牌出完（含蓋完）才結束。人數不是 4 時各家手牌數本來就一樣，所以不採用「一人出完就結束」。

### 鬼牌（6 人局）

- 鬼牌是任意牌：出鬼牌時指定它代表哪一張牌，那個位置必須是當下可以接的位置（含任一還沒開的 7）。
- 真的那張牌出來時，直接替換掉鬼牌，鬼牌離開桌面（不回任何人手上）。出鬼牌的人和出正牌的人都沒有懲罰。
- 鬼牌不算蓋牌分數（就算蓋了也是 0 分）。

### 多的牌（3 人與 5 人局）

開關 `leftover_mode`：

- `deal_after_seven`（預設）：♠7 出了以後，多的牌從首家開始往下一人一張發到沒有為止。
- `open_pool`：多的牌攤在公共區。每一手出完後，公共區裡任何可以接的牌自動接上桌面（連鎖到沒有為止），不屬於任何人。

### 蓋牌計分

一局結束時每家攤開蓋牌，點數相加：A 算 1、2 到 10 照牌面、J 11、Q 12、K 13，鬼牌 0。張數不另外計分。**點數越少越好。**

### 一局的分數

牌桌的累積分沿用「高分者勝」的慣例，所以每局分數做零和換算：

每局分數 = 全桌平均蓋牌點數 − 自己的蓋牌點數，四捨五入到一位小數；全桌加總為 0，蓋得最少的人拿最高分。局結束時 `board.last_round_points` 同時給每家的原始蓋牌點數，前端與 AI 都看得到「蓋了幾點」。

### 累積與結束

分數逐局累加。結束條件沿用拱豬的桌面選項：局數制（預設，打滿 4 局結算）或分數制（任一家累積分 **≤ −`end_score`**，預設 100，也就是有人輸到 100 分就整場結束）。整場結束時累積分最高者勝。

## 二、桌面選項

| key | 名稱 | 型別 | 說明 |
|---|---|---|---|
| `end_mode` | 結束方式 | choice | `rounds`（預設）／`score` |
| `end_rounds` | 結束局數 | number | 預設 4，只在局數制顯示 |
| `end_score` | 結束分數 | number | 預設 100，只在分數制顯示；任一家累積分輸到這個數就結束 |
| `leftover_mode` | 多的牌 | choice | `deal_after_seven`（預設）：♠7 出了以後從首家往下發；`open_pool`：攤在公共區，可以接就自動接上。只影響 3 人與 5 人局 |

## 三、引擎對應

- mode `paiqi`、label「排七」、`rules_version: "paiqi-tw-1"`。
- 檔案：`src/engine/paiqi-rules.ts`（選項、計分、規則文字）與 `src/engine/paiqi-engine.ts`（流程）。不用 `trick-taking-core`。
- 牌桌層給引擎的 deck 固定 52 張；6 人局由引擎在 `deal` 裡自己加兩張鬼牌，牌碼 `🃏1`、`🃏2`。牌桌層不需要認得鬼牌（`parseCard` 不改）。

### 狀態

```ts
interface PaiqiState {
  phase: "play" | "ended";
  order: string[];                          // 席位順序，order[0] 是首家（♠7 持有者）
  hands: Record<string, string[]>;
  placed: Record<string, "card" | "joker">; // 桌面上已接的牌，key 是牌碼（鬼牌代表的牌），值標記這格是正牌還是鬼牌
  pool: string[];                           // open_pool 模式的公共區；其他模式永遠空
  leftover: string[];                       // deal_after_seven 模式等 ♠7 出了才發的牌；發完清空
  covered: Record<string, string[]>;        // 各家蓋下的牌（局中對其他人隱藏）
  active: string | null;
  lastPlay: { seatId: string; card: string; as: string | null; covered: boolean } | null;  // as 只在出鬼牌時有值
  lastRoundPoints: Record<string, number> | null;
  lastRoundScores: Record<string, number> | null;
}
```

### 發牌

- `deal`：依人數平分，多的牌取 deck 尾端、依 `leftover_mode` 放進 `leftover` 或 `pool`。
  - **♠7 不能落在多的牌裡**（否則沒有首家，這局開不了）：♠7 若在尾端的多牌區，先和 `deck[0]` 對調再發。測試要有一個 ♠7 排在 deck 最後的固定牌組。
  - 6 人局引擎自己把 `🃏1`、`🃏2` **隨機插入** deck 後再平分（接在尾端會固定發給同兩席）；鬼牌相關測試用 `restore` 建狀態，不靠 `deal`，保持確定性。
  - deck 順序由牌桌層決定，引擎除了插鬼牌之外不洗牌；測試用固定 deck。
- `order` 從 ♠7 持有者開始，依 `seatIds` 順序繞一圈。首家 active。

### legal_plays 與 legal_actions

- 有牌可出時 `legal_actions` 只有 `play_card`，`legal_plays` 每筆：
  - `[牌]`：出這張牌（含任一 7、可接的牌、替換鬼牌的正牌）。
  - `[鬼牌, 目標牌碼]`：鬼牌代表目標牌，目標必須是當下可接的位置。
- 沒牌可出時 `legal_actions` 只有 `cover_card`，`legal_plays` 每張手牌一筆 `{ action: "cover_card", cards: [牌] }`。
- 第一手只有 `[♠7]` 一筆。
- 伺服器驗證；AI 只從清單挑。

### apply

- `play_card`：驗證 → 放上桌面（正牌落在鬼牌格時把該格改成 `card`，鬼牌離開）→ 第一手之後若 `leftover` 非空就從首家開始一人一張發完 → `open_pool` 模式把公共區可接的牌連鎖接上 → 下一家；所有人手牌空就結算。
- `cover_card`：驗證「沒有任何合法出牌」→ 該牌進 `covered` → 下一家。
- 事件文字：「{name} 出 ♥8。」「{name} 用鬼牌當 ♦K。」「{name} 蓋了一張牌。」「公共區的 ♣6 接上了。」

### 結算

`scorePaiqiRound(covered, order)` 純函式匯出：各家點數、平均、零和換算一位小數、`-0` 歸 0。`RoundResult.winnerSeatId` 是蓋牌點數最少的人（同分取 `order` 較前者）。`isGameOver`：局數制 `round >= end_rounds`；分數制任一家累積分 `<= -end_score`。

### board

```ts
{
  phase, placed: Record<string, "card" | "joker">, pool: string[], leftover_count: number,
  covered_count: Record<seat, number>,
  covered_cards: Record<seat, string[]> | null,   // 只在 phase === "ended" 揭露
  last_play, seat_status: Record<seat, "waiting" | "active">,
  last_round_points: Record<seat, number> | null,
  last_round_scores: Record<seat, number> | null,
}
```

### 離桌與代打

局中離桌一律 `"abort"`（流局）；`transferSeat` 換 id 不換位。

## 四、前端（阿宇做）

- 桌面中央畫 4 列 × 13 格的牌陣，7 在中央欄；已接的牌顯示牌面，鬼牌格顯示 🃏 加「當 ♥8」小字；`open_pool` 模式在牌陣下方顯示公共區。
- 手牌可出的亮起；點一張可出的牌直接出。沒牌可出時出現「蓋牌」鈕：先點一張手牌再按蓋牌。
- 鬼牌：點鬼牌後所有可接的空格亮起，點空格就出。
- 玩家列顯示蓋牌張數；局結束顯示蓋牌點數與本局分數。
- 開桌表單由 `/api/games` 生成：多的牌是二段切換按鈕。
- `src/mcp-server.ts` 整檔由阿宇改（小葵不碰）：instructions 補排七的 legal_plays 說明（一張＝出牌、兩張＝鬼牌當目標牌、`cover_card` 是蓋牌）；`summarizeBoard` 加排七分支：各花色已接的範圍、公共區、各家蓋牌張數、上一手。
- 座位上限從 4 變 6，寫死「4」的地方一併改：mcp-server.ts 的 instructions「at most 4 seats」與 take_seat 描述、web/app.js 觀戰區「四個座位都滿了」（改用 `max_seats`）、web/connect.html FAQ、玩家列版面要放得下 6 席。

## 五、童童的答覆（2026-09-05）

1. 人數 2 到 6；6 人加兩張鬼牌，鬼牌是任意牌，正牌出來時替換鬼牌，兩邊都沒懲罰。多的牌兩種方式做成開關：♠7 出了從首家往下發；或攤在公共區可以接就補上。
2. 拿到 ♠7 的是首家，一定要出 ♠7。
3. 有牌可出就不能蓋牌。
4. 點數累加，J 11、Q 12、K 13，張數不算。
5. 沿用分數制和局數制。
6. 所有人沒手牌才結束，不然非四人局不公平。

## 六、待童童確認的設計取捨

1. **鬼牌算「有牌可出」**：照第 3 條字面，只要桌上還有可接的位置，拿鬼牌的人就不能蓋牌，鬼牌會在第一次沒牌接時被逼出來。另一條路是「鬼牌不強制，可以留著蓋別的牌」。預設照字面。
2. **零和換算**：每局分數 = 平均點數 − 自己點數，讓牌桌的「高分者勝」慣例不用改，`last_round_points` 另外給原始點數。另一條路是直接記負的蓋牌點數（畫面會是 −37 這種數字）。
3. **分數制的門檻用「輸到 end_score」**（累積分 ≤ −100）：因為換算後贏家分數很難衝到 100。
4. **公共區自動接上**：`open_pool` 模式的公共牌一旦可接就由伺服器接上，不佔任何人的一手。
