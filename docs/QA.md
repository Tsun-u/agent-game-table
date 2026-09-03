# Agent Game Table 驗證報告

驗證日期：2026-09-03
驗證範圍：大老二規則、版本化 Agent 規則表、伺服器計算的合法出牌候選、多人類／多 Agent 共桌、STDIO MCP、Streamable HTTP Remote MCP、加密持久化、網頁 UI 與 Lottie 動畫。

## 結論

目前自動化驗證為 **PASS**。專案只包含大老二規則；伺服器保存唯一權威狀態，每個玩家只收到自己的牌面，其他玩家僅公開手牌張數。

## 執行方式

```powershell
npm run typecheck
npm test
npm run test:e2e
npm audit --audit-level=high
git diff --check
```

## 自動化覆蓋

- 20 個 Node 測試：完整牌組、牌型判定、牌型比較、2～4 人入座、發牌、首手、出牌、PASS、計分及次局仍由最低牌先攻；
- 四人真人／Agent 混桌的逐座位隱私視角；
- optimistic concurrency、冪等寫入與獨立事件游標；
- Agent 離桌、管理員移除、一次性重連碼及 Remote principal 綁定；
- HTTP Host、獨立 STDIO MCP processes 與 Streamable HTTP MCP；
- AES-256-GCM 狀態恢復、錯誤金鑰 fail closed，以及明文秘密／手牌不落地；
- OIDC protected-resource metadata、Bearer 認證、Origin 限制與跨身分 MCP session 阻擋；
- 4 個真實 Chrome E2E：瀏覽器續桌、失效 token 清理、多桌分頁管理，以及 Remote Host 重啟續桌。

## 隱私與介面檢查

- API 與 MCP 輸出不包含 `deck`；
- 對手 `cards` 永遠是空陣列，只提供 `hand_count`；
- 營運台不顯示手牌、牌堆、座位 token 或重連碼；
- MCP tool schema 不接受 deck、seed 或測試牌序；
- `get_game_rules` 與 `join_table` 都會把完整規則送給 Agent，輪到 Agent 時 `legal_plays` 只包含可通過 Host 判定的牌組；
- 每位 Agent 有獨立 capability 與事件游標，無法使用別人的 MCP session。

## 前端與動畫

- 真實瀏覽器已操作建桌、發牌、選牌、出牌、Agent 離桌／移除及多桌管理；
- 結算 Lottie 由 Host 同源提供，沒有第三方 CDN；
- `prefers-reduced-motion: reduce` 時會停用結算動畫；
- build 每次先刪除 `dist/`，避免已刪除的舊程式或測試殘留在輸出目錄。

## 尚待公開部署驗證

- 實際 HTTPS staging 與第三方 OIDC provider 相容性；
- reverse proxy 的連線數、request body 與速率限制；
- 多副本部署前，將單檔持久化替換為具交易與 row lock 的資料庫。
