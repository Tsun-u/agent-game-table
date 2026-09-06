# 牌桌層選椅子 實作計畫

> **給執行者：** 使用「執行計畫」skill 逐步完成此計畫。步驟使用 checkbox（`- [ ]`）格式追蹤進度。
> 執行紀錄：2026-09-06 完成，182 測試全過；Chrome 驗過拱豬桌十字椅子與大老二桌原本的入座鈕（docs/screenshots/chair-picker.png）。
> 規格：`docs/specs/2026-09-06-contract-bridge-rules.md` 第一節（童童 2026-09-06 確認）。全部由阿宇本 session 做，不派小葵（都是牌桌層與前端）。
> 現況：`seat.seatIndex` 由 `table.nextSeatIndex` 單調遞增指派（`src/multiplayer-store.ts` 651～669 行 `#takeSeat`），`seatedMembers()`（1165 行）依它排序決定引擎拿到的席位順序；代打 `#acceptSubstitute`（628 行）已搬 `seatIndex`。引擎 `seats` 型別在 `src/engine/types.ts` 89 行。

**目標：** 拱豬、台灣輕橋牌（以及之後的合約橋牌）入座時可以挑北東南西四張椅子，對面是搭檔；其他遊戲維持入座順序。

**方法：** 引擎用 `seats.chairs` 宣告椅子名；牌桌層 `#takeSeat` 多一個可選 `position`，有椅子的桌把椅子編號直接寫進 `seatIndex`，其餘排序、代打、持久化全部沿用。API、MCP、前端各多帶一個參數與一組椅子按鈕。

**工具 / 技術：** TypeScript、`node --test`、Chrome 手動驗證。

---

### 任務 1：引擎宣告椅子

**檔案：**
- 修改：`src/engine/types.ts:89`
- 修改：`src/engine/gongzhu-engine.ts:69`、`src/engine/lightbridge-engine.ts:88`

- [x] **步驟 1：型別加 `chairs`**

```ts
/** chairs 有值代表位置有意義（對面是搭檔）；長度必須等於 max，入座時可挑椅子。 */
readonly seats: { readonly min: number; readonly max: number; readonly fixed: boolean; readonly chairs?: readonly string[] };
```

- [x] **步驟 2：拱豬與輕橋牌宣告**

兩個引擎的 `seats` 改為 `{ min: 4, max: 4, fixed: true, chairs: CHAIRS }`，`CHAIRS` 定義在 `src/engine/types.ts` 匯出：`export const CHAIRS = ["北", "東", "南", "西"] as const;`

- [x] **步驟 3：typecheck**

執行：`npm run typecheck`
預期：無錯誤。

### 任務 2：牌桌層入座帶位置

**檔案：**
- 修改：`src/multiplayer-store.ts`（`humanTakeSeat` 554、`agentTakeSeat` 559、`#takeSeat` 651、`#view` 920～935、`PublicSeatView` 約 30 行）
- 測試：`test/multiplayer-store.test.ts`

- [x] **步驟 1：寫測試**

```ts
test("有椅子的桌可以挑位置，對面是搭檔，被佔會報錯", () => {
  const store = new MultiplayerTableStore();
  const created = store.createTable("房主", "gongzhu");
  const owner = created.human_token;
  const a = store.joinAgent(created.table.join_code, "阿宇");
  const b = store.joinAgent(created.table.join_code, "小葵");
  store.humanTakeSeat(owner, tableVersion(store, owner), "seat-1", 0);
  store.agentTakeSeat(a.agent_token, tableVersion(store, owner), "seat-2", 2);
  assert.throws(() => store.agentTakeSeat(b.agent_token, tableVersion(store, owner), "seat-3", 2), /有人了/);
  const view = store.agentTakeSeat(b.agent_token, tableVersion(store, owner), "seat-4");   // 不帶位置 → 最小的空椅 1
  assert.deepEqual(view.players.map((seat) => [seat.name, seat.position, seat.chair]), [["房主", 0, "北"], ["小葵", 1, "東"], ["阿宇", 2, "南"]]);
  assert.deepEqual(view.chairs.map((chair) => chair.name), ["房主", "小葵", "阿宇", null]);
});

test("沒有椅子的桌忽略位置參數", () => {
  const store = new MultiplayerTableStore();
  const created = store.createTable("房主", "bigtwo");
  const view = store.humanTakeSeat(created.human_token, tableVersion(store, created.human_token), "seat-1", 3);
  assert.equal(view.players[0]!.position, null);
  assert.equal(view.chairs, null);
});
```

（`createTable` 的實際簽名以檔案為準，照既有測試的開桌寫法。）

- [x] **步驟 2：跑測試確認失敗**

執行：`npm test -- --test-name-pattern="椅子"`
預期：FAIL，`position` 不是已知參數。

- [x] **步驟 3：實作**

`#takeSeat(table, seat, expectedVersion, idempotencyKey, position?: number)`：

```ts
const chairs = this.#engine(table).seats.chairs;
if (chairs) {
  const taken = new Set(seatedMembers(table).map((member) => member.seatIndex));
  const wanted = position ?? chairs.findIndex((_, index) => !taken.has(index));
  if (!Number.isInteger(wanted) || wanted < 0 || wanted >= chairs.length) throw new Error(`位置要在 0 到 ${chairs.length - 1} 之間。`);
  if (taken.has(wanted)) throw new Error(`${chairs[wanted]}那張椅子有人了，換一張。`);
  seat.seatIndex = wanted;
} else {
  seat.seatIndex = table.nextSeatIndex;
  table.nextSeatIndex += 1;
}
```

事件文字有椅子時改「{name} 坐北。」。`humanTakeSeat`／`agentTakeSeat` 各多一個可選 `position` 透傳。冪等鍵重送時不看 `position`（收據照舊）。

- [x] **步驟 4：公開視角**

`PublicSeatView` 加 `position: number | null`、`chair: string | null`（沒椅子的桌都是 null）；`PublicTableView` 加 `chairs: { position: number; chair: string; seat_id: string | null; name: string | null }[] | null`。`players` 仍依 `seatedMembers` 排序。

- [x] **步驟 5：跑測試確認通過＋全套**

執行：`npm test`
預期：全部 PASS（既有測試的 `players` 多兩個欄位，用 `deepEqual` 比整個物件的要補上）。

### 任務 3：HTTP、MCP、遠端三條路透傳

**檔案：**
- 修改：`src/host-server.ts:182`（human）、`:292`（agent）
- 修改：`src/host-client.ts:78`、`src/remote-mcp.ts:283`、`src/mcp-server.ts:192～200`
- 測試：`test/host-server.test.ts`、`test/mcp-server.test.ts`

- [x] **步驟 1：host-server 兩個 seat 端點讀 `body.position`**

`optionalPosition(body.position)`：undefined 就 undefined，否則要是 0 以上整數，不合就 400。

- [x] **步驟 2：`HostClient.takeSeat` 與 `remote-mcp` 的 `takeSeat` 多 `position?: number`**，介面 `src/host-client.ts:16` 一起改。

- [x] **步驟 3：MCP `take_seat` inputSchema 加 `position: z.number().int().min(0).max(5).optional()`**，description 補一句：「Games with chairs (Gong Zhu, Taiwan Light Bridge, Contract Bridge) accept position 0–3 (北東南西); the seat across from you is your partner. Omit it to take the lowest free chair.」

- [x] **步驟 4：測試**

`test/mcp-server.test.ts`：拱豬桌用 `take_seat` 帶 `position: 2`，斷言回傳 `table.players` 裡自己的 `chair === "南"`。
執行：`npm test`
預期：PASS。

### 任務 4：人類網頁的椅子

**檔案：**
- 修改：`web/index.html:154`、`web/app.js:39～64、635～648`、`web/styles.css`

- [x] **步驟 1：標記**

`seatButton` 旁加 `<div id="chairPicker" class="chair-picker" hidden></div>`。

- [x] **步驟 2：渲染**

`table.chairs` 為 null → 顯示原本的「入座」鈕。有值 → 隱藏「入座」鈕、顯示 `chairPicker`，四顆按鈕依 `position` 排成 2×2 十字（北上、南下、西左、東右），有人的顯示名字並 disabled，空的顯示椅子名；點空椅呼叫 `changeSeat("/api/human/seat", "已坐北，等房主開局。", { position })`。`changeSeat` 的 body 合併第三個參數。只有 `legal_actions` 含 `take_seat` 時才顯示。

- [x] **步驟 3：樣式**

`.chair-picker` 用 grid `grid-template-areas: ". n ." "w . e" ". s ."`，按鈕沿用 `.secondary-button`。

- [x] **步驟 4：邀請詞**

`web/app.js:253～255` 的人類與 Agent 說明各補一句：有椅子的桌「入座時挑椅子，對面是搭檔」／「take_seat 可帶 position 0–3 選椅子」。只在 `table.chairs` 有值時加。

- [x] **步驟 5：Chrome 驗證**

本機 `npm run build && node dist/src/index.js`（或既有啟動方式），開拱豬桌：四張椅子顯示、點南入座、`players` 顯示「南」；再開大老二桌確認還是「入座」鈕。截圖存 `docs/screenshots/chair-picker.png`。

### 任務 5：文件與交付

- [x] **步驟 1：README 的拱豬、輕橋牌段落補「入座可挑椅子，對面是搭檔」**；`docs/specs/2026-09-04-multi-game-engine.md` 引擎介面段補 `chairs`。
- [x] **步驟 2：`npm run typecheck && npm test`** 全綠。
- [x] **步驟 3：commit**

```bash
git add src test web docs README.md
git commit -m "feat(table): 拱豬與台灣輕橋牌入座可挑北東南西椅子，對面是搭檔"
```

- [x] **步驟 4：push 到 Tsun-u/agent-game-table**（PAT 走 accounts.txt 的既有做法），通知童童重啟 Remote Host 才吃到。
- [x] **步驟 5：更新記憶 `project_agent_game_table.md`**（chairs 欄位、position 參數）。
