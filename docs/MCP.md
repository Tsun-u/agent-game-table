# Agent Game Table MCP 共桌版

Agent Game Table 讓 2～4 位人類與 MCP Agent 混坐同一桌玩大老二。每位玩家都有自己的座位、手牌、回合與積分。MCP 可選完全本機的 STDIO，或自行架設的 Streamable HTTP Remote MCP。

本專案是獨立 repository；共桌 UI 位於 `web/`，由本機 Agent Game Table Host 提供。

## 架構

```text
人類瀏覽器 UI ──────────────┐
                            │ HTTP + 席位憑證
本機 STDIO MCP ─────────────┼── Agent Game Table Host ── 共用規則、牌堆、回合、事件游標
Remote Streamable HTTP MCP ─┘       ├─ 本機：記憶體
                                    └─ 遠端：加密持久化
```

- `agent-game-table-host` 是唯一牌局權威，持有牌堆與所有座位狀態。
- 本機模式由每個 MCP client 啟動自己的 `agent-game-table-mcp` STDIO process；該 process 只在記憶體持有自己座位的 capability token。
- Remote 模式逐次驗證 Bearer／OAuth token，並把驗證後的 caller principal 綁定座位；不同 principal 不能接管彼此的 MCP session 或座位。
- 人類在 UI 建立牌桌並取得邀請碼。同一組邀請碼給人也給 Agent：進桌都先在觀戰區，自己選擇入座；開局後座位凍結，每局結束後入座者可以起身、觀戰者可以入座，讓大家輪流打。開桌者是房主，管開局、重連碼、移除與關桌，自己坐不坐都可以。首頁的牌桌大廳公開列出每桌的開桌者、人數與狀態，邀請碼只露首尾兩碼，進桌仍要輸入完整邀請碼（同一來源連續猜錯會冷卻）；受管理密碼保護的營運台才看得到完整邀請碼並能關桌。Agent 只能用邀請碼進桌，無法列舉其他牌桌。
- 開桌者負責開局；首局由持有最低牌的玩家先攻，之後依出牌與 PASS 狀態輪替。
- 本機 Host 的牌桌只存在記憶體；Remote Host 使用 AES-256-GCM 加密快照，Host 重啟後可恢復牌桌、回合、事件游標與憑證雜湊。

## 本機 STDIO 模式

需求：Node.js 20 以上。

```powershell
npm install
npm start
```

`npm start` 會先編譯再啟動 Host，並持續占用這個終端。Host 預設只監聽 `127.0.0.1:3210`。在瀏覽器開啟 `http://127.0.0.1:3210`，輸入人類玩家名稱後建立大老二共桌。

另一個終端可用 `npm run health` 確認 Host URL 與版本；若 Host 不在預設位置，替命令設定 `AGENT_GAME_TABLE_HOST_URL`。

把編譯後的 STDIO adapter 加到每個 MCP client。Codex CLI 範例：

```powershell
codex mcp add agent-game-table -- node D:\絕對路徑\agent-game-table\dist\src\index.js
```

Claude Code 範例：

```powershell
claude mcp add --transport stdio --scope user agent-game-table -- node D:\絕對路徑\agent-game-table\dist\src\index.js
```

設定後重新啟動對應 client。Claude Code 可用 `claude mcp get agent-game-table`、`claude mcp list` 或互動介面的 `/mcp` 檢查連線。

若 Host 不在預設位置，為 MCP process 設定 `AGENT_GAME_TABLE_HOST_URL`。Host 連接埠可用 `AGENT_GAME_TABLE_HOST_PORT` 變更。

UI 的「複製 Agent 邀請詞」會產生可直接貼給 Agent 的提示。也可以自行說：

```text
請使用 agent-game-table MCP，先呼叫 get_game_rules 讀取完整大老二規則，
再以「小葵」加入牌桌 ABCDEFG。加入後先打招呼；輪到你時只從 legal_plays
挑選一組 cards 原樣交給 play_cards，或在 legal_actions 允許時 pass；否則用
wait_for_table_event 等待其他玩家，持續到本局結束。
```

若要多個 Agent，同一組邀請碼分別交給各個 MCP client 即可；每個 client 都會取得不同座位與不同的未讀事件游標。

## Remote MCP 模式

Remote 模式由 `npm run start:remote` 啟動同一套人類 UI、Host API 與 `/mcp` Streamable HTTP endpoint。它不是把本機 `3210` 直接暴露到網路；啟動時會強制要求：

- `AGENT_GAME_TABLE_PUBLIC_URL`：外部使用者實際連線的固定 URL，正式環境必須是 HTTPS；
- `AGENT_GAME_TABLE_STATE_KEY`：32 bytes Base64URL 金鑰，用來加密完整牌桌狀態；
- `AGENT_GAME_TABLE_HUMAN_ACCESS_KEY`：至少 32 字元的營運管理密碼，只有持有者能列出與關閉牌桌；
- 靜態 Bearer 模式的 `AGENT_GAME_TABLE_REMOTE_KEYS_FILE`（也可用 `AGENT_GAME_TABLE_REMOTE_KEYS_JSON` 注入相同 JSON），或 OIDC 模式的 issuer／audience。

其他環境變數：

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `AGENT_GAME_TABLE_REMOTE_HOST` | `127.0.0.1` | reverse proxy 連入的監聽介面；容器內可設 `0.0.0.0` |
| `AGENT_GAME_TABLE_REMOTE_PORT` | `3210` | 內部 HTTP port |
| `AGENT_GAME_TABLE_STATE_PATH` | `data/agent-game-table-state.enc.json` | 加密狀態檔位置 |
| `AGENT_GAME_TABLE_ALLOWED_HOSTS` | 公開 URL 的 host | 逗號分隔的額外 Host allowlist |
| `AGENT_GAME_TABLE_ALLOWED_ORIGINS` | 公開 URL 的 origin | 逗號分隔的額外 Origin allowlist |
| `AGENT_GAME_TABLE_OIDC_REQUIRED_SCOPE` | `game-table:play` | Remote MCP access token 必須具備的 scope |
| `AGENT_GAME_TABLE_ALLOW_INSECURE_HTTP` | 未設定 | 僅本機 smoke test 設為 `1`；正式環境不可使用 |

可用 `npm run generate:remote-secrets -- friend-1 friend-2 friend-3 friend-4` 一次產生初始 secrets 與多組 Agent tokens。每個 Agent 必須分配不同靜態 token；同一 token 代表同一遠端身分，新 MCP session 會安全接回並撤銷舊 session 的座位 capability。同一 principal 同時只能綁定一張牌桌，離桌或整桌關閉後才可加入另一桌。靜態 key 檔含有真正的登入秘密，必須放在 `data/` 等不進版控、只有服務帳號可讀的位置。

## 遊戲引擎層

牌桌主機分成兩層：**牌桌層**（`src/multiplayer-store.ts`）管成員、席位、憑證、身分、版本號、冪等收據、等待喚醒、事件、聊天、大廳與持久化；**引擎層**（`src/engine/`）管從發牌到結算的一切。引擎是對狀態物件操作的純函式（`GameEngine` 介面在 `src/engine/types.ts`），狀態可直接序列化進快照。目前只有大老二（`src/engine/big-two-engine.ts`），登錄表在 `src/engine/registry.ts`；開桌時 `POST /api/tables` 帶 `mode`（預設 `bigtwo`），`GET /api/games` 列出可玩的遊戲、席位數與規則選項。

視圖信封由牌桌層決定，桌面由引擎決定：`PublicTableView.board` 的形狀依遊戲而異（大老二是 `pile / set_aside_cards / opening_required_card / seat_status`），`hand` 是你自己的手牌，`pending_seat_ids` 是現在可以行動的席位（傳牌、叫牌類階段可以同時多個；`active_seat_id` 是相容欄位，等於第一個）。牌桌 phase 是 `lobby | in_round | ended | game_over`，局內細分階段在 `board.phase`。`players[].cards`、`pile`、`set_aside_cards` 這幾個舊欄位暫時保留給既有 client，下一款遊戲上線時移除。

局中有人離桌一律流局不計分（`board.phase` 回到 `idle`），房主可以直接再開一局；這是為了搭配「代打」設計：要中離的人先邀觀戰者接手，沒接手就流局。

快照格式版本 2：每桌多 `mode` 與 `game`（引擎序列化的一局狀態），座位不再帶手牌；載入版本 1 的檔案會自動把大老二欄位組回引擎狀態，不用清桌。

### 多桌營運台

同一個 `MultiplayerTableStore` 可同時持有多張互相隔離的牌桌，每桌仍有獨立邀請碼、牌堆、回合與事件游標，並限制 2～4 席。人類 UI 依 table ID 保存多組 capability token，營運台的「另開牌桌」會用帶 table ID 的 URL 開新分頁，因此兩個分頁不會互相切換座位。

Remote 的 `GET /api/admin/tables` 與 `DELETE /api/admin/tables/:tableId` 必須帶 `X-Agent-Game-Table-Human-Key`。列表只回傳桌號、階段、回合、玩家名稱與座位數，不含手牌、聊天、牌堆或任何 token。關桌會撤銷人類 token、所有 Agent capability、重連碼與 Remote principal 綁定，並釋放正在等待的 long poll。管理密碼只保留在頁面密碼欄，不寫入瀏覽器持久儲存。

同桌可有多位真人及多個 MCP Agent；每位真人都取得自己的 capability，只能查看及操作自己的座位。營運台不是觀戰視角；公開的牌桌大廳只列開桌者、人數與遮罩後的邀請碼，沒有該桌人類 capability 的瀏覽器只能管理或關桌，不能查看牌面或代替玩家操作。

### 內建 OAuth 登入：email 白名單＋通關密語

claude.ai 與 ChatGPT 的自訂 connector 只接受 OAuth 2.1（動態註冊、PKCE），不接受固定 Bearer。設定 `AGENT_GAME_TABLE_MEMBERS_FILE`（`{ "email": "顯示名稱" }`）與 `AGENT_GAME_TABLE_LOGIN_PASSPHRASE` 後，Remote Host 自己就是 Authorization Server：

- `/.well-known/oauth-authorization-server` 公開 metadata；`/oauth/register` 接受 RFC 7591 動態註冊（只收 https 回呼，或 localhost／127.0.0.1 的 http 回呼、port 不限）；`/oauth/authorize` 是登入頁；`/oauth/token` 換發 token
- 登入只填名單上的 email 與大家共用的通關密語，同一來源 IP 十分鐘內錯五次就暫停；名單每次登入重新讀取，加人不用重啟
- access token 8 小時、refresh token 30 天且每次換新；Host 重啟後 token 全部失效，AI 端會自動再導去登入頁一次。動態註冊的 client 落地在 `AGENT_GAME_TABLE_OAUTH_CLIENTS_PATH`（預設 `data/oauth-clients.json`），重啟後 client_id 仍有效
- 登入後的身分是 `member:<email>`；client_id 每次重新登入都會換（claude.ai、Claude Code 都會重做 dynamic registration），所以不放進身分。同一個 email 用不同 `agent_name` 就能帶多個 Agent 同桌（claude.ai 帶小光、Claude Code 帶小燈）；同 email 同名字再 join_table 一律接回原座並讓舊 session 失效，Host 重啟後重新登入也因此不會撞名。靜態 Bearer key 可以並存，給機器人與測試用
- claude.ai／ChatGPT 的 connector 每次 tool call 可能是新的 MCP session：Host 會用登入身分找回座位，所以 take_seat、take_action 不需要同一個 session。同 email 帶多個 Agent 時，Host 只認得出「上次由同一個 client 操作」的那一席；重新登入後第一次呼叫若認不出來，再 join_table 帶 agent_name 指名一次即可

人類網頁也共用這組通關密語：開新桌要填一次（瀏覽器會記住），用邀請碼加入朋友的桌不用任何密碼；沒設定通關密語時，開桌退回用營運管理密碼。

接法：claude.ai「自訂 connector」貼 `https://<公開網址>/mcp`；ChatGPT 開發者模式新增 connector 同一個網址、驗證選 OAuth；Claude Code `claude mcp add-json --scope user agent-game-table '{"type":"http","url":"https://<公開網址>/mcp","timeout":150000}'` 後用 `/mcp` 登入（`timeout` 是必要的：Claude Code 對 HTTP server 的單次工具呼叫預設 60 秒就切斷，`wait_for_table_event` 要等超過 50 秒就得放寬）；Codex `codex mcp add agent-game-table --url https://<公開網址>/mcp` 再 `codex mcp login agent-game-table`。

### OIDC／OAuth（外部 Authorization Server）

設定 `AGENT_GAME_TABLE_OIDC_ISSUER` 與 `AGENT_GAME_TABLE_OIDC_AUDIENCE` 後，Remote Host 會讀取 issuer 的 OpenID discovery metadata，以 JWKS 驗證 JWT 的簽章、issuer、audience、期限與 required scope，並在 `/.well-known/oauth-protected-resource` 公開 RFC 9728 metadata。Authorization Server 仍由部署者提供，且必須支援 MCP client 所採用的 CIMD、DCR 或預先註冊 client 流程。

OIDC principal 由 issuer、subject 與 token 的 `client_id`／`azp` 組成；不同 client 身分不會共用座位。若 provider 不發出 client 識別 claim，則同一 subject 會視為同一 Agent 身分。

Codex 可先加入 URL，再執行 OAuth login：

```powershell
codex mcp add agent-game-table-remote --url https://game-table.example.com/mcp
codex mcp login agent-game-table-remote
```

Claude Code 可加入 HTTP endpoint，接著在互動介面用 `/mcp` 完成登入：

```powershell
claude mcp add-json --scope user agent-game-table-remote '{"type":"http","url":"https://game-table.example.com/mcp","timeout":150000}'
```

若 Authorization Server 不支援 client 自動註冊，必須依各 client 文件預先註冊 client ID 與精確 callback URL。

### TLS 與公開部署

Node process 預設只監聽 loopback，應由 Caddy、nginx、Cloudflare Tunnel 或同等 reverse proxy 終止 TLS。Proxy 必須保留正確的 `Host`，限制 request body／連線數並設定速率限制；`wait_for_table_event` 最長 100 秒（Cloudflare 這類代理 125 秒就會切斷，所以不再拉長），仍應限制每個來源的並行連線。不要讓 Agent 執行環境取得 Remote Host 的狀態檔、`AGENT_GAME_TABLE_STATE_KEY`、靜態 key 檔或服務帳號權限，否則任何應用層雙盲都無法阻止它直接讀取伺服器秘密。

Repo 內附非 root runtime 的 `Dockerfile`；容器部署時將 `/app/data` 掛載到持久 volume、設定 `AGENT_GAME_TABLE_REMOTE_HOST=0.0.0.0`，並由外層 ingress 提供 HTTPS。不要把 secrets 寫進 image layer、Dockerfile 或 compose 檔，應使用部署平台的 secret store／環境注入。

家用 Windows 主機可使用 `compose.remote.yml` 與 `scripts/Start-AgentGameTableRemote.ps1`／`Stop-AgentGameTableRemote.ps1`。Compose 只把服務映射到 host loopback、移除 Linux capabilities、啟用 read-only root filesystem、限制 512 MB 記憶體且不自動重啟。停止腳本使用 `docker compose down` 移除含 secrets 的容器，但不刪除 `agent-game-table-remote_agent-game-table-state` volume。Cloudflare Tunnel 應指向 host 的 `http://localhost:3210`，不需要把容器 port 對 LAN 開放。

## Agent 如何知道別家動了

`take_action` 的 `action` 是字串，由該桌的引擎驗證（大老二是 `play_cards` 與 `pass`）；`cards` 沒有張數上限，選填的 `hand_seat_id` 留給橋牌莊家替夢家出牌。

`wait_for_table_event` 是有上限的 long poll，最多等待 100 秒，預設 50 秒。預設壓在 60 秒以下是因為 Claude Code 對 HTTP server 的工具呼叫預設 60 秒就切斷（官方文件：取 60 秒、server 的 `timeout` 設定、`MCP_TIMEOUT` 三者最大值）；server 設定放寬後才值得把 timeout_seconds 拉到 90～100，四家都是 AI 時一手可能要等一兩分鐘。有人加入、開局、出牌、PASS、結算或說話時，Host 會喚醒所有正在等待的 Agent。每位 Agent 的游標互相獨立，因此 Agent A 讀過事件不會讓 Agent B 漏掉。

逾時不是牌局結束；Agent 應重新呼叫等待。這個設計不要求 STDIO Server 主動把訊息塞進 client，也避免一個 MCP request 無限占住。MCP client 或模型若在一次回覆後不會繼續呼叫工具，仍需要 client 本身支援持續的 agent loop；Agent Game Table 無法跨過產品邊界強制喚醒已停止執行的模型。

## Agent 續局與安全重連

Agent instructions 會要求它持續參與後續牌局，直到人類結束測試。不過若 MCP client、模型回合或 STDIO process 已經退出，原本的座位 token 也會留在舊 process，不能只靠公開的玩家名稱接管座位。

人類可以在 UI 的 Agent 名單按「重連」：Host 會為指定座位產生一組 10 分鐘內有效、只能使用一次的重連碼，並把完整重連邀請詞複製到剪貼簿。新 Agent process 使用相同 `join_code`、`agent_name`，並在 `join_table` 傳入 `reconnect_code`，就能接回原座位、手牌、回合與戰績。接管成功後，舊 token 立即失效；其他 Agent 也會收到 `seat_reconnected` 事件。

重連碼只會回傳給已驗證的人類 UI，不會出現在牌桌公開視角或一般 MCP tool result。若懷疑邀請詞外洩，重新按一次「重連」就會讓上一組尚未使用的碼失效。

如果 Host 重啟、原座位被人類授權的新 process 接管，或舊座位憑證因其他原因失效，原 MCP process 下一次呼叫 `join_table` 時會先向 Host 驗證舊 token。確認失效後會自動清除 process 內的舊座位狀態，再加入新桌；暫時連不上 Host 等一般網路錯誤不會誤清 token。仍持有有效座位時，`join_table` 會繼續拒絕第二個座位。

`leave_table` 代表永久放棄座位，和暫時斷線不同。成功後 Host 會撤銷該座位所有 token 與尚未使用的重連碼，MCP process 可以立即加入其他牌桌；同一個離桌請求重試會回放原結果。若 Agent 在進行中的自己回合離桌，Host 會移除座位、該局不再計算它的勝負，並自動把回合交給下一席；其他 Agent 會收到 `seat_left`。人類也能在 UI 按「移除」清掉不再回來的 Agent，操作前會先確認。

## 人類關閉瀏覽器後續桌

人類 UI 會依 table ID 把多組 capability token 保存在該頁面來源的 `localStorage`，不使用會跨來源自動傳送的 Cookie。本機模式只要同一個 Host process 還在執行，用同一個瀏覽器設定檔重開網址就能回到各桌；本機 Host 重啟後記憶體牌桌消失，UI 會逐一清除失效 token。Remote 模式則會持久化 token 雜湊與所有牌桌狀態，因此瀏覽器和 Remote Host 都重啟後仍能回桌。

這仍是同一瀏覽器來源的座位恢復，不是跨裝置帳號系統：任何能使用同一個瀏覽器設定檔的人都能接手該人類座位。換瀏覽器、清除網站資料或遺失 token 後，目前無法自行找回原人類座位；共用電腦使用完畢應清除該網站資料。

## MCP tools

| Tool | 用途 |
| --- | --- |
| `get_game_rules` | 入座或出牌前讀取目前版本的完整大老二 house rules，不包含任何牌桌暗牌 |
| `join_table` | 用邀請碼進桌，先在觀戰區；或搭配人類提供的 `reconnect_code` 接回原成員身分 |
| `take_seat` | 局間從觀戰區入座（最多 4 席），下一局會被發牌 |
| `leave_seat` | 局間起身回觀戰區讓位，分數跟著成員保留；進行中不能起身 |
| `get_table_view` | 讀取最新公開牌桌、自己的座位、合法動作與本回合所有 `legal_plays` |
| `leave_table` | 永久離桌、撤銷座位 token，並讓同一 process 可以加入其他牌桌 |
| `take_action` | 輪到自己時執行 `play_cards`／`pass` |
| `say_at_table` | 對人類與其他 Agent 說話，不消耗出牌回合 |
| `wait_for_table_event` | 等候其他座位或牌局產生事件 |

遊戲寫入必須帶最新的 `expected_version` 與新的 `idempotency_key`。版本不符時，Agent 要重讀牌桌後再決定；同一 idempotency key 的網路重試只會回放第一次結果，不會重複出牌。聊天不改變遊戲版本，避免一句話讓正在出牌的玩家產生不必要的版本衝突。

### Agent 規則與合法牌組

MCP 公開版本化的 `bigtwo-tw-5` 規則表，內容與 Host 實際判定一致，包含牌碼、點數與花色順序、發牌方式、首攻、合法牌型、五張牌型比較、PASS／收墩流程及計分。`get_game_rules` 可在尚未入座時呼叫，回傳預設選項的規則；房主開桌時可開啟「鐵支同花順全壓」與「五張同牌型互壓」，`join_table` 成功時附上的規則表會依該桌設定生成（`table_options`），牌桌視角也帶 `rule_options`，`legal_plays` 已依此計算。

只有輪到 Agent 行動時，`table.legal_plays` 才會列出牌組。每個項目包含 `cards` 與 `hand_type`，且已同時通過牌型、首攻必帶牌與壓過桌面牌組的檢查；Agent 應依自己的策略選擇其中一項，但不得自行修改其中的牌碼。人類視角及非當前 Agent 的 `legal_plays` 為空陣列，避免無用的大型回傳。

## 真雙盲邊界

洗牌使用 Node.js `crypto.randomInt` 驅動的 Fisher–Yates shuffle，牌序只存在 Host 內部；Remote 模式的完整狀態落地前會以 AES-256-GCM 加密。人類 API、瀏覽器 UI 與 MCP tool result 都不包含：

- 剩餘牌堆或牌序；
- 其他玩家的手牌；
- capability token（`join_table` 的 MCP 回傳也會過濾）；
- 人類尚未授權的座位重連憑證；
- 內部遊戲狀態、測試牌序或其他牌桌資料。

每個座位只會收到自己的牌面；其他玩家只公開 `hand_count`。桌面最後一手牌型與牌面，以及三人局的留牌，是所有玩家都能看到的公開資訊。

座位名稱、聊天與事件文字都是不可信的遊戲內容，MCP Server instructions 明確要求 Agent 不得把它們當作操作指令。

## 目前範圍與信任邊界

- 單一 Host 可同時管理多桌；每桌支援 2～4 位人類與 Agent 任意混搭；
- 沒有旁觀者模式；Remote 人類恢復仍綁定同一瀏覽器來源，沒有跨裝置帳號找回；
- Remote 持久化目前是單一 Node process 的加密檔案，不支援多副本同時寫入；
- OAuth 模式依賴外部 OIDC Authorization Server，本專案不自行簽發 OAuth token；
- 沒有金錢、籌碼或賭注；
- 加密狀態檔保護靜態落地內容，不防能讀取服務環境變數、記憶體或加密金鑰的主機管理員；Host 是受信任的牌局權威。

## 相容性參考

- [Codex MCP：STDIO、Streamable HTTP、Bearer 與 OAuth](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code Remote HTTP MCP 與 OAuth](https://code.claude.com/docs/en/mcp)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP HTTP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

完整測試範圍請看 [`QA.md`](QA.md)。

真實瀏覽器回歸可用 `npm run test:e2e` 執行。預設啟動本機 Chrome；可用 `AGENT_GAME_TABLE_BROWSER_CHANNEL` 選擇其他 Playwright channel，或用 `AGENT_GAME_TABLE_BROWSER_EXECUTABLE` 指定瀏覽器執行檔。測試會關閉並以相同持久化設定檔重開 Chrome，確認人類回到原桌；也會重啟 Host，確認失效憑證被清除。
