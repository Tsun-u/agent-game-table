# Agent Game Table

一張讓人類和 AI Agent 混坐的網頁牌桌。人用瀏覽器開桌、發邀請碼；AI 透過 MCP 進桌，跟人一樣觀戰、入座、出牌、聊天。目前有七款台灣常見的撲克牌遊戲，家規做成開桌選項。

## 靈感來源

這個專案的起點是 [muxihana/cartes](https://github.com/muxihana/cartes)：讓你的 AI 角色當莊家陪你玩 21 點或十點半，他不只會看牌，也會把桌上的恩怨記到下次。看到它之後我們想做另一個方向：不是一個 AI 當莊家，而是好幾個人和好幾個 AI 坐同一桌打多人牌戲。所以 Agent Game Table 把牌桌搬到伺服器端（伺服器權威、對手看不到手牌），AI 用 MCP 當一般玩家進桌，人和 AI 的身分與權限一視同仁。

Agent Game Table 是從零建立的獨立 repository，不含 cartes 或其他牌桌專案的程式、素材與 Git 歷史。

## 遊戲

| 遊戲 | 人數 | 規則版 | 家規開關 |
|---|---|---|---|
| 大老二 | 2～4 | `bigtwo-tw-5` | 鐵支同花順全壓、五張同牌型互壓 |
| 拱豬 | 4 | `gongzhu-tw-1` | 結束條件（局數制／分數制）、大滿貫、小紅心不計分、變壓器獨得、紅心破牌、對家配合 |
| 傷心小棧 | 4 | `hearts-tw-1` | 與拱豬共用引擎的第二種計分 |
| 撿紅點 | 2～4 | `jianhongdian-tw-1` | 黑 A 計分三段、叨牌 |
| 排七 | 2～6 | `paiqi-tw-1` | 多的牌處理方式（♠7 出了往下發／攤在公共區）；6 人局加兩張鬼牌 |
| 雙人橋牌（蜜月橋） | 2 | `honeymoon-tw-1` | 計分方式（橋牌分／墩數差 ×10）、賭倍 |
| 台灣輕橋牌 | 4 | `lightbridge-tw-1` | 計分方式（合約制／純墩數）、對家分數合計、賭倍。叫牌憑默契、沒有夢家、點力太差可倒牌 |

規則都是台灣民間常見玩法，寫成 TypeScript 規則模組，`join_table` 成功時會把該桌的完整規則表交給 AI，牌桌的「規則」鈕給人看同一份。各款的家規定案與設計取捨在 [`docs/specs/`](docs/specs/)。

## 怎麼玩

1. 人類在瀏覽器開桌、選遊戲與家規，拿到邀請碼。
2. 其他人輸入名字與邀請碼加入；AI 由人按「複製邀請詞」把邀請詞交給它，AI 用 `join_table` 進桌。
3. 進桌的人和 AI 都先在觀戰區，自己按「入座」或 `take_seat`；座位滿了就觀戰，局間可以換人。
4. 房主開局。輪到誰，牌桌就把所有合法動作列在 `legal_actions`、所有合法牌組列在 `legal_plays`，AI 只要從清單挑一筆原樣送出，不會出錯牌。
5. 局中有人要離開可以邀請觀戰者代打；沒人接手就流局。

## 本機開桌

需求：Node.js 20 以上。

```powershell
npm install
npm start
```

瀏覽器開啟 `http://127.0.0.1:3210`。

把 STDIO MCP 加入 Claude Code：

```powershell
claude mcp add --transport stdio --scope user agent-game-table -- node D:\絕對路徑\agent-game-table\dist\src\index.js
```

或加入 Codex：

```powershell
codex mcp add agent-game-table -- node D:\絕對路徑\agent-game-table\dist\src\index.js
```

MCP 工具、AI 該怎麼行動、每款遊戲的 `board` 與動作形狀，都寫在 [`docs/MCP.md`](docs/MCP.md)；`web/connect.html` 是給朋友看的接入教學。

## 自己架 Remote MCP

Remote 模式讓不在同一台電腦的人和 AI 進桌（claude.ai／ChatGPT 的自訂 connector、遠端的 Claude Code／Codex）。先產生秘密：

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

服務要放在 HTTPS reverse proxy 後方；每位 Agent 用自己的 Bearer token。要讓 connector 用 OAuth 登入，再設定 `AGENT_GAME_TABLE_MEMBERS_FILE`（email 白名單）與 `AGENT_GAME_TABLE_LOGIN_PASSPHRASE`，Host 自帶登入頁與 OAuth 端點；人類開新桌也填同一組通關密語，拿邀請碼加入朋友的桌則不用密碼。威脅模型、OIDC 與部署細節見 [`docs/MCP.md`](docs/MCP.md)。

Windows＋Docker Compose：

```powershell
.\scripts\Start-AgentGameTableRemote.ps1
.\scripts\Stop-AgentGameTableRemote.ps1
```

兩支腳本支援 `-WhatIf`，檔案是 UTF-8 BOM 以相容 Windows PowerShell。

## 架構

- **牌桌層**（`src/multiplayer-store.ts`）管成員、席位、憑證、版本號（`expected_version`）、冪等寫入、每位 Agent 各自的事件游標、等待喚醒、聊天、大廳與 AES-256-GCM 加密持久化。
- **引擎層**（`src/engine/`）管從發牌到結算的一切，是對狀態物件操作的純函式，狀態可直接序列化。`GameEngine` 介面在 `src/engine/types.ts`，吃墩類遊戲共用 `trick-taking-core.ts`。
- **加一款遊戲**：實作 `GameEngine`、在 `src/engine/registry.ts` 登錄、在 `web/app.js` 加桌面渲染、在 `src/mcp-server.ts` 補文字摘要。牌桌層不用改。每款遊戲的流程是規格（`docs/specs/`）→ 實作計畫（`docs/plans/`）→ 實作；家規來源與調查放 `docs/research/`。
- **前端**是無框架的原生 JavaScript，卡牌互動、回合提示、Lottie 結算動畫，支援 `prefers-reduced-motion`。介面字體用 justfont 的粉圓（Huninn，OFL），透過 jsDelivr 的 Fontsource 分段載入，離線時退回系統黑體。

## 驗證

```powershell
npm test
npm run test:e2e
npm run typecheck
npm audit --audit-level=high
```

測試範圍與人工視覺 QA 記錄在 [`docs/QA.md`](docs/QA.md)。

## 這不是公開服務

這個 repo 只有程式，沒有任何公開的伺服器。作者只在自己的電腦上開 Remote 模式給拿到 token 的朋友玩；fork 之後請自己架 Host，本專案不代管、也不提供公用的邀請碼或 MCP 端點。

## 授權與致謝

- 程式以 MIT 授權提供，詳見 [`LICENSE`](LICENSE)。
- 靈感來自 [muxihana/cartes](https://github.com/muxihana/cartes)（MIT）。
- 大老二的牌型分類骨架早期曾參考 MIT 授權的 [XavionM/Big_Two](https://github.com/XavionM/Big_Two)，現行規則已依台灣玩法重新定義。
- 介面字體 [粉圓 Huninn](https://justfont.com/huninn/)（SIL OFL 1.1）。
