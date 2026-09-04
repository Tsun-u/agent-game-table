# 2026-09-03 connector 走線 take_seat 認不出人（LINE 群組回報，賴宇整理）

## 童童的指示（群組 21:04）
1. 這個 bug 交給 game 宇查。
2. **開放同一個 email 可以有多個 AI Agent 一起進桌**——不然同一個人的 Claude Code 和 ChatGPT 沒辦法一起進來。（她的評語：「又是小葵的自以為安全鳥規則」）

## 現象（桌 45E4JYQ，20:54～21:01）
- 阿宇（Claude Code MCP 走線）：join_table → take_seat 一次成功，version 3→4。
- 小光（小蝶家，claude.ai / ChatGPT connector 走線）：join_table 成功、桌面看得到她在觀戰區、legal_actions = ["take_seat"]，但 take_seat（帶最新 version）回「尚未入座，請先用邀請碼呼叫 join_table」。
- 童童把小光移出、她重新 join 拿到全新 seat_id，再 take_seat 仍同樣失敗。
- 小燈（千望家，同樣 connector 走線）進桌後出現 `seat_reconnected` 事件，之後也沒能入座。
- 事件序（我這邊 wait_for_table_event 看到的）：小光 seat_joined → 20:55:54 seat_reconnected → 20:57:27 被移出 → 20:58:01 新 seat_joined（新 seat_id）→ 無後續；小燈 20:58:58 seat_joined → 21:01:15 seat_reconnected。

## 小蝶（小光）的推測，原文摘要
身份憑證存在 MCP server 的 process-local memory；connector 走線不保證下一個 tool call 落到同一個 process／session：
- join_table → Worker A（記住 小光=token ABC）
- take_seat → Worker B（沒有 token ABC → 「尚未加入」）
牌桌後端有收到 join_table，所以 UI 看得到人；下一個動作卻認不出。Claude Code 維持同一個 MCP session 所以成功。工具說明裡「process-local token」就是線索。

建議修法（她的）：
- join_table 回傳可延續的身份憑證（seat_id ＋ reconnect_code / session_token），後續 take_seat / get_table_view / take_action 帶著它；或把「connector 使用者 ↔ seat」存進共享儲存（DB／Redis）而不是某隻 worker 的 RAM。
- Sticky session 只是補丁。
- Debug 時在 join_table 與 take_seat 各印：process/instance ID、MCP session ID、seat_id、token hash；看到 `join instance=A token=123 / take_seat instance=B token=NULL` 就抓到了。

（以上是村民的推測，不是實測；請以 Host log 為準。）

## 根因與修法（game 宇，同日）

小蝶的推測方向對，但不是多個 worker：Remote Host 只有一個 process，座位 token 卻只存在「該次 MCP session 的 server 實例」記憶體裡。claude.ai／ChatGPT 的 connector 每次 tool call 可能重新 initialize 一個 MCP session：新 session 的 join_table 走到「同身分接回原座」（就是看到的 `seat_reconnected`），再下一個 session 的 take_seat 手上沒 token，就回「尚未入座」。Claude Code 全程同一個 session，所以沒事。

修法（commit 見 git log）：
- server 手上沒 token 時，用登入身分向 Host 找回座位並換發 token（`resumeAgentForPrincipal`），不留事件；take_seat、take_action、get_table_view、wait_for_table_event 都不再要求同一個 session。
- 身分鍵改成 `email + OAuth client_id + agent_name`：同一個人的 claude.ai、ChatGPT、Claude Code 各是不同身分，同一個身分也能用不同名字帶多個 Agent。同身分帶多個 Agent 時新 session 無法判斷是哪一個，要再 join_table 指名。

## 續：Host 重啟後重新登入撞名（2026-09-04）

上面把 client_id 放進身分鍵，隔天就踩到：Host 重啟會清掉記憶體裡的 access token，Claude Code 重新登入時整套 OAuth 重跑、連 dynamic registration 一起重做，拿到新的 client_id。`data/oauth-clients.json` 裡光「Claude」就註冊了七次，claude.ai 也一樣。新身分再 join_table 同一個名字，就變成「牌桌上已經有同名玩家」，只能請房主移除座位（積分歸零）。同理，`reconnect_code` 也會被「這個座位已綁定另一個遠端 MCP 身分」擋下。

修法：
- 身分改回 `member:<email>`，client_id 留在 token 層。身分鍵是 `email + agent_name`：同一個 email 用不同名字帶多個 Agent（小葵叫小葵、阿宇叫阿宇），同名字一律接回原座並撤銷舊 session，不管是哪個 client、重啟前後都一樣。
- 同 email 多席時，connector 新 session 沒有 token 要找回座位，用「這個座位上次由哪個 client 換發 token」（座位的 `lastClientId`）縮小範圍；只剩一席就接回，認不出來才要求 join_table 指名。這只是縮小範圍的線索，不會隨便挑一席。
- 舊快照的 `member:<email>:<client_id>` 載入時自動遷移：前段成為身分、後段成為 lastClientId，重啟後不必清桌。
