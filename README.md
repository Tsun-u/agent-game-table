# Agent Game Table

一張讓多位人類與多個 AI Agent 混坐的大老二網頁遊戲桌。

這是從零建立的獨立 repository。共桌 Host、STDIO／Remote MCP、多席位權限、加密持久化、網頁 UI 與 Lottie 動畫皆屬本專案；不包含其他牌桌專案的程式、素材或 Git 歷史。

## 第一階段功能

- 2～4 位真人與 Agent 任意混搭的大老二；
- 3♦ 起手、單張／一對／三條／順子／同花／葫蘆／鐵支／同花順；
- 獨立牌桌邀請碼、人類座位憑證與 Agent capability；
- Server authoritative state，對手只看得到剩餘張數；
- `expected_version`、冪等寫入與每位 Agent 各自的事件游標；
- 本機 STDIO MCP，以及可自行架設的 Streamable HTTP Remote MCP；
- 多桌營運台、AES-256-GCM 加密持久化及 Remote principal 綁定；
- 卡牌互動、回合提示與同源 Lottie 結算動畫，支援 `prefers-reduced-motion`。

大老二規格參考 MIT 授權的 [XavionM/Big_Two](https://github.com/XavionM/Big_Two) 與其 [house rules](https://github.com/XavionM/Big_Two/blob/main/big-two-rules.md)，並重寫成 TypeScript 規則模組。

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

在人類 UI 按「複製邀請詞」交給 Agent。Agent 會使用 `join_table` 入座，再依 `legal_actions` 呼叫 `play_cards`、`pass` 或 `wait_for_table_event`。

## Remote MCP

先產生本機部署需要的秘密：

```powershell
npm run generate:remote-secrets -- friend-1 friend-2 friend-3 friend-4
```

正式環境至少需要：

```powershell
$env:AGENT_GAME_TABLE_PUBLIC_URL="https://game-table.example.com"
$env:AGENT_GAME_TABLE_STATE_KEY="產生的狀態金鑰"
$env:AGENT_GAME_TABLE_HUMAN_ACCESS_KEY="產生的營運管理密碼"
$env:AGENT_GAME_TABLE_REMOTE_KEYS_FILE="$PWD\data\remote-keys.json"
npm run start:remote
```

服務應置於 HTTPS reverse proxy 後方；每位 Agent 使用不同的 Bearer token，不能共享身分。完整威脅模型、OIDC 與部署設定請看 [`docs/MCP.md`](docs/MCP.md)。

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

## 專案邊界與授權

- 這個 repo 有自己的 Git 歷史、套件名稱、MCP 名稱、環境變數、Docker service 與瀏覽器儲存鍵。
- 專案目前只包含大老二；沒有其他牌類遊戲或相容層。
- 程式以 MIT 授權提供，詳見 [`LICENSE`](LICENSE)。
