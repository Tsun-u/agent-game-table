# Agent Game Table

一張讓多位人類與多個 AI Agent 混坐的大老二網頁遊戲桌。

這是從零建立的獨立 repository。共桌 Host、STDIO／Remote MCP、多席位權限、加密持久化、網頁 UI 與 Lottie 動畫皆屬本專案；不包含其他牌桌專案的程式、素材或 Git 歷史。

## 第一階段功能

- 一組邀請碼進桌，人和 AI 進來都先在觀戰區，自己選擇入座；最多 4 席、觀戰不限人數，局間可以換人輪流打；
- ♣3 起手、單張／一對／順子／葫蘆／鐵支／同花順（台灣慣例：不打同花與三條，五張只能被五張壓）；房主開桌時可另外開啟「鐵支同花順全壓」與「五張同牌型互壓」；
- 獨立牌桌邀請碼、人類座位憑證與 Agent capability；
- Server authoritative state，對手只看得到剩餘張數；
- `expected_version`、冪等寫入與每位 Agent 各自的事件游標；
- 本機 STDIO MCP，以及可自行架設的 Streamable HTTP Remote MCP；
- 遊戲引擎層（純函式、可序列化）與牌桌層分離；已有大老二、拱豬、傷心小棧（規則版 bigtwo-tw-5／gongzhu-tw-1／hearts-tw-1，家規做成開桌選項），撿紅點、橋牌排隊中；
- 多桌營運台、AES-256-GCM 加密持久化及 Remote principal 綁定；
- 卡牌互動、回合提示與同源 Lottie 結算動畫，支援 `prefers-reduced-motion`。
- 介面字體用 justfont 的粉圓（Huninn，OFL），透過 jsDelivr 的 Fontsource 分段載入；Host 的 CSP 已放行 `cdn.jsdelivr.net` 的樣式與字體，離線時退回系統黑體。

大老二規則採台灣民間常見玩法，寫成 TypeScript 規則模組並以 `get_game_rules` 公開（目前版本 `bigtwo-tw-5`）：

- 花色 ♣ 梅花 < ♦ 方塊 < ♥ 紅心 < ♠ 黑桃，點數 3 最小、2 最大；首局由持有 ♣3 的玩家先攻且第一手必須包含 ♣3；
- 牌型只有單張、一對、順子、葫蘆、鐵支、同花順，沒有同花與三條；
- 順子以 A-2-3-4-5 最小、2-3-4-5-6 最大，2 不得出現在其他順子；
- 跟牌張數必須相同，五張牌只能被五張牌壓過，鐵支與同花順不能跨張數壓牌；
- PASS 後本墩不再行動，回合回到最後出牌者時重新領牌；
- 輸家以剩牌張數計分，手上每留一張 2 就加倍一次；
- 三人局每人 17 張、留 1 張公開；兩人局每人 13 張、其餘不使用。

房主開桌時可以開啟兩個選項，整桌固定、寫進 `join_table` 回傳的規則表與牌桌視角的 `rule_options`：

- **鐵支同花順全壓**：鐵支與同花順不受張數限制，可壓桌上任何非鐵支／同花順的牌組，同花順壓鐵支；
- **五張同牌型互壓**：順子只能被更大的順子壓、葫蘆只能被更大的葫蘆壓（預設是高階牌型可壓低階牌型）。兩個選項同時開啟時，鐵支與同花順仍可壓其他五張牌型。

專案早期曾參考 MIT 授權的 [XavionM/Big_Two](https://github.com/XavionM/Big_Two) 建立牌型分類的骨架，現行規則已依台灣玩法重新定義，與該專案的 house rules 不同。

## 本機開桌

需求：Node.js 20 以上。

```powershell
npm install
npm start
```

瀏覽器開啟 `http://127.0.0.1:3210`。其他真人輸入名字與邀請碼即可加入。

把 STDIO MCP 加入 Codex：

```powershell
codex mcp add agent-game-table -- node D:\絕對路徑\agent-game-table\dist\src\index.js
```

或加入 Claude Code：

```powershell
claude mcp add --transport stdio --scope user agent-game-table -- node D:\絕對路徑\agent-game-table\dist\src\index.js
```

在人類 UI 按「複製邀請詞」交給 Agent。Agent 會先呼叫 `get_game_rules` 讀取版本化完整規則，再用 `join_table` 進桌（先在觀戰區）、`take_seat` 入座；局間可用 `leave_seat` 回觀戰區讓位；`join_table` 的成功回傳也會附上同一份規則，確保第一次出牌前已收到規則表。輪到 Agent 時，Host 會在 `legal_plays` 列出所有可合法送出的牌組；Agent 應從中選一組原樣傳給 `play_cards`，或依 `legal_actions` 使用 `pass`／`wait_for_table_event`。

## Remote MCP

先產生本機部署需要的秘密：

```powershell
npm run generate:remote-secrets -- friend-1 friend-2 friend-3 friend-4
```

正式環境至少需要：

```powershell
$env:AGENT_GAME_TABLE_PUBLIC_URL="https://game-table.example.com"
$env:AGENT_GAME_TABLE_STATE_KEY="產生的狀態金鑰"
$env:AGENT_GAME_TABLE_HUMAN_ACCESS_KEY="產生的營運管理密碼（列出與關閉牌桌用）"
$env:AGENT_GAME_TABLE_REMOTE_KEYS_FILE="$PWD\data\remote-keys.json"
npm run start:remote
```

服務應置於 HTTPS reverse proxy 後方；每位 Agent 使用不同的 Bearer token，不能共享身分。要讓 claude.ai／ChatGPT 的自訂 connector 或 Claude Code／Codex 用 OAuth 登入，再設定 `AGENT_GAME_TABLE_MEMBERS_FILE`（email 白名單）與 `AGENT_GAME_TABLE_LOGIN_PASSPHRASE`，Host 會自帶登入頁與 OAuth 端點；人類在網頁開新桌也填同一組通關密語，拿邀請碼加入朋友的桌則不用密碼。完整威脅模型、OIDC 與部署設定請看 [`docs/MCP.md`](docs/MCP.md)。

Windows＋Docker Compose 也可使用：

```powershell
.\scripts\Start-AgentGameTableRemote.ps1
.\scripts\Stop-AgentGameTableRemote.ps1
```

兩支腳本支援 `-WhatIf`；`.ps1` 皆使用 UTF-8 BOM，以相容 Windows PowerShell。

## 驗證

```powershell
npm test
npm run test:e2e
npm run typecheck
npm audit --audit-level=high
```

測試範圍與人工視覺 QA 記錄在 [`docs/QA.md`](docs/QA.md)。

## 這不是公開服務

這個 repo 只有程式，沒有任何公開的伺服器。作者只在自己的電腦上開 Remote 模式給拿到 token 的朋友玩；fork 之後請自己架 Host（本機模式或依上面的 Remote 章節自行部署、自行發 token），本專案不代管、也不提供公用的邀請碼或 MCP 端點。

## 專案邊界與授權

- 這個 repo 有自己的 Git 歷史、套件名稱、MCP 名稱、環境變數、Docker service 與瀏覽器儲存鍵。
- 專案目前只包含大老二；沒有其他牌類遊戲或相容層。
- 程式以 MIT 授權提供，詳見 [`LICENSE`](LICENSE)。
