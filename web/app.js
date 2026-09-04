(() => {
  "use strict";

  const TOKENS_KEY = "agent_game_table_human_tokens_v1";
  const PASSPHRASE_KEY = "agent_game_table_create_passphrase_v1";
  const tokens = readTokenMap();
  const requestedTableId = new URL(window.location.href).searchParams.get("table") || "";
  const soleTableId = Object.keys(tokens).length === 1 ? Object.keys(tokens)[0] : "";
  const initialTableId = requestedTableId && tokens[requestedTableId] ? requestedTableId : soleTableId;
  const state = {
    tokens,
    tableId: initialTableId,
    token: (initialTableId && tokens[initialTableId]) || "",
    table: null,
    polling: null,
    lobbyPolling: null,
    busy: false,
    remote: false,
    selectedCards: new Set(),
    /** GET /api/games 的結果：mode → { label, options[] }，開桌表單與規則說明都靠它。 */
    games: {},
    defaultMode: "bigtwo",
    selectedMode: "",
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let roundAnimation = null;
  let celebrationTimer = null;
  const elements = Object.fromEntries(
    [
      "connectionBadge", "setupPanel", "createForm", "joinForm", "joinHumanName", "humanJoinCode", "humanName", "tablePanel", "joinCode", "copyInvite", "rulesLink",
      "pileZone", "pileLabel", "pileCards", "roundLabel", "turnLabel", "playerSeats", "startRound", "playCards", "pass", "selectedCount", "passCards", "passCount", "layDown",
      "seatCount", "roster", "chatLog", "chatForm", "chatInput", "statusLine", "passphraseLabel", "createPassphrase", "adminKeyLabel", "adminKey",
      "managementPanel", "managementList", "managedTableCount", "managementHint", "refreshTables", "backToTables", "leaveTable",
      "lobbyPanel", "lobbyList", "lobbyCount", "lobbyHint",
      "tableStatus", "roundCelebration", "roundCelebrationAnimation", "roundCelebrationLabel", "gameModeLabel", "gameMode", "ruleOptionFields", "ruleOptions", "tableName", "railToggle", "rail", "railClose", "railBackdrop", "handDock", "seatButton", "unseatButton", "acceptSubstitute", "dockNote", "spectatorList", "spectatorCount",
    ].map((id) => [id, document.getElementById(id)]),
  );

  elements.seatButton.addEventListener("click", () => void changeSeat("/api/human/seat", "已入座，等房主開局。"));
  elements.unseatButton.addEventListener("click", () => void changeSeat("/api/human/unseat", "已到觀戰區。"));
  elements.acceptSubstitute.addEventListener("click", () => void changeSeat("/api/human/accept-substitute", "你接手了這個座位，接著打。"));

  async function inviteSubstitute(seat) {
    await run(async () => {
      const result = await api("/api/human/invite-substitute", {
        method: "POST",
        body: { seat_id: seat.seat_id, expected_version: state.table.version, idempotency_key: operationKey("human-invite-substitute") },
      });
      setTable(result.table);
      setStatus(`已邀請 ${seat.name} 代打，對方按「接手代打」就會坐進你的位置。`);
    });
  }

  async function changeSeat(path, message) {
    await run(async () => {
      const result = await api(path, {
        method: "POST",
        body: { expected_version: state.table.version, idempotency_key: `seat-${crypto.randomUUID()}` },
      });
      state.selectedCards.clear();
      setTable(result.table);
      setStatus(message);
    });
  }

  /** 窄螢幕時右欄是抽屜，會蓋住開關鈕，所以抽屜裡有關閉鈕、點背景也能關。 */
  function setRailOpen(open) {
    elements.rail.classList.toggle("open", open);
    elements.railBackdrop.hidden = !open;
    elements.railToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  elements.railToggle.addEventListener("click", () => setRailOpen(!elements.rail.classList.contains("open")));
  elements.railClose.addEventListener("click", () => setRailOpen(false));
  elements.railBackdrop.addEventListener("click", () => setRailOpen(false));

  elements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await run(async () => {
      const result = await api("/api/tables", {
        method: "POST",
        body: {
          human_name: elements.humanName.value.trim(),
          mode: state.selectedMode || state.defaultMode,
          options: Object.fromEntries(
            [...elements.ruleOptionFields.querySelectorAll("[data-key]")]
              .filter((field) => !field.closest("[hidden]"))
              .map((field) => [field.dataset.key, ruleOptionValue(field)]),
          ),
        },
        authenticated: false,
        createPassphrase: true,
      });
      rememberPassphrase();
      rememberHumanToken(result.table.table_id, result.human_token);
      selectTable(result.table.table_id, result.human_token);
      setTable(result.table);
      setStatus("牌桌建立完成，把邀請碼交給 Agent 就能入座。");
      startPolling();
    });
  });

  elements.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await run(() => joinWithCode(elements.humanJoinCode.value, elements.joinHumanName.value));
  });

  async function joinWithCode(joinCode, humanName) {
    const result = await api("/api/human/join", {
      method: "POST",
      body: { join_code: joinCode.trim(), human_name: humanName.trim() },
      authenticated: false,
    });
    rememberHumanToken(result.table.table_id, result.human_token);
    selectTable(result.table.table_id, result.human_token);
    setTable(result.table);
    setStatus(`已加入 ${result.table.join_code}，等開桌者開始牌局。`);
    startPolling();
  }

  async function enterKnownTable(tableId) {
    selectTable(tableId, state.tokens[tableId]);
    await refresh(true);
    startPolling();
  }

  elements.refreshTables.addEventListener("click", () => void run(loadManagement));
  elements.leaveTable.addEventListener("click", () => {
    const table = state.table;
    const midRound = table && table.phase === "in_round" && table.viewer_role === "seated";
    if (midRound && !window.confirm("這局還在打，離桌會讓你的牌作廢。確定要離桌嗎？")) return;
    void run(async () => {
      const result = await api("/api/human/leave", { method: "POST" });
      forgetHumanToken(result.table_id);
      showManagement();
      setStatus(result.table_closed ? "你是最後一位人類，牌桌已關閉。" : "已離開牌桌。");
      if (!state.remote || elements.adminKey.value) await loadManagement();
    });
  });
  elements.backToTables.addEventListener("click", () => {
    showManagement();
    elements.lobbyPanel.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
    if (state.remote && !elements.adminKey.value) return;
    void loadManagement().catch((error) => setStatus(error.message, true));
  });

  let lobbySignature = "";

  async function loadLobby() {
    const result = await api("/api/lobby", { method: "GET", authenticated: false });
    // 有人正在卡片裡填邀請碼時不重畫，免得把打到一半的字清掉；內容沒變也不重畫。
    const editing = elements.lobbyList.contains(document.activeElement) || elements.lobbyList.querySelector(".lobby-join-form:not([hidden])");
    const signature = JSON.stringify([result.tables, Object.keys(state.tokens).sort()]);
    if (editing || signature === lobbySignature) return;
    lobbySignature = signature;
    renderLobby(result.tables);
  }

  function renderLobby(tables) {
    elements.lobbyCount.textContent = `${tables.length} 桌`;
    elements.lobbyHint.textContent = tables.length
      ? "已加入的桌直接進；其他桌向開桌者要邀請碼，點卡片輸入。"
      : "目前沒有牌桌，開一桌吧。";
    elements.lobbyList.replaceChildren(...tables.map((table) => {
      const article = document.createElement("article");
      article.className = "lobby-card";
      const joined = Boolean(state.tokens[table.table_id]);

      const heading = document.createElement("div");
      heading.className = "management-card-heading";
      const title = document.createElement("div");
      const owner = document.createElement("strong");
      owner.textContent = `${table.human_name} 的桌`;
      const status = document.createElement("span");
      status.textContent = `${table.rule_label} · ${phaseLabel(table)}`;
      title.append(owner, status);
      const count = document.createElement("span");
      count.className = "count-pill";
      count.textContent = `${table.player_count}/${table.max_seats} 入座 · ${table.spectator_count} 觀戰`;
      heading.append(title, count);

      const code = document.createElement("p");
      code.className = "lobby-code";
      code.textContent = table.join_code_hint;
      if (joined) {
        const badge = document.createElement("span");
        badge.className = "lobby-joined";
        badge.textContent = "已加入";
        code.append(badge);
      }

      const actions = document.createElement("div");
      actions.className = "lobby-actions";
      if (joined) {
        const enter = document.createElement("button");
        enter.type = "button";
        enter.className = "secondary-button";
        enter.textContent = "進桌";
        enter.addEventListener("click", () => void run(() => enterKnownTable(table.table_id)));
        actions.append(enter);
      } else {
        const form = document.createElement("form");
        form.className = "lobby-join-form";
        form.hidden = true;
        const name = document.createElement("input");
        name.maxLength = 80;
        name.placeholder = "你的暱稱";
        name.required = true;
        name.value = elements.joinHumanName.value;
        name.setAttribute("aria-label", "你的暱稱");
        const input = document.createElement("input");
        input.maxLength = 20;
        input.placeholder = "完整邀請碼";
        input.required = true;
        input.autocomplete = "off";
        input.setAttribute("aria-label", "完整邀請碼");
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.className = "secondary-button";
        submit.textContent = "進桌";
        form.append(name, input, submit);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void run(() => joinWithCode(input.value, name.value));
        });
        const reveal = document.createElement("button");
        reveal.type = "button";
        reveal.className = "ghost-button";
        reveal.textContent = "輸入邀請碼進桌";
        reveal.addEventListener("click", () => {
          form.hidden = false;
          reveal.hidden = true;
          (name.value ? input : name).focus();
        });
        actions.append(reveal, form);
      }

      article.append(heading, code, actions);
      return article;
    }));
  }

  function startLobbyPolling() {
    lobbySignature = "";
    clearInterval(state.lobbyPolling);
    state.lobbyPolling = setInterval(() => void loadLobby().catch(() => undefined), 10_000);
    void loadLobby().catch((error) => setStatus(error.message, true));
  }

  elements.copyInvite.addEventListener("click", async () => {
    if (!state.table) return;
    const prompt = `Agent Game Table 牌桌邀請碼：${state.table.join_code}

人類玩家：開啟 ${window.location.origin}${window.location.pathname}，在「加入朋友的桌」輸入名字與邀請碼，進桌後按「入座」。

AI Agent：請使用 agent-game-table MCP，以你的名字 join_table 加入牌桌 ${state.table.join_code}（回應會附上這桌的完整${state.table.rule_label}規則），接著呼叫 take_seat 入座。${agentTurnInstructions(state.table.mode)}局間若人類請你讓位，用 leave_seat 到觀戰區繼續看牌聊天。`;
    await navigator.clipboard.writeText(prompt);
    setStatus("邀請詞已複製，可以直接貼給 Codex 或 Claude Code。");
  });

  elements.startRound.addEventListener("click", () => gameWrite("/api/human/start-round", {}));
  elements.playCards.addEventListener("click", () => gameWrite("/api/human/action", { action: "play_cards", cards: [...state.selectedCards] }));
  elements.pass.addEventListener("click", () => gameWrite("/api/human/action", { action: "pass", cards: [] }));
  elements.passCards.addEventListener("click", () => gameWrite("/api/human/action", { action: "pass_cards", cards: [...state.selectedCards] }));
  elements.layDown.addEventListener("click", () => gameWrite("/api/human/action", { action: "play_card", cards: [...state.selectedCards] }));

  /** 撿紅點：選一張手牌後，桌面可配的牌會亮起，點桌面牌配對收走，或按「放到桌上」不配。 */
  const PICK_MODES = new Set(["jianhongdian"]);
  function isPickGame(table) {
    return PICK_MODES.has(table.mode);
  }

  /** 吃墩型遊戲（拱豬、傷心小棧）的桌面與手牌跟大老二不同，依 mode 分路。 */
  const TRICK_MODES = new Set(["gongzhu", "hearts"]);
  function isTrickGame(table) {
    return TRICK_MODES.has(table.mode);
  }

  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.chatInput.value.trim();
    if (!message) return;
    await run(async () => {
      const result = await api("/api/human/say", {
        method: "POST",
        body: { message, idempotency_key: operationKey("human-chat") },
      });
      elements.chatInput.value = "";
      setTable(result.table);
    });
  });

  async function loadManagement() {
    const result = await api("/api/admin/tables", {
      method: "GET",
      authenticated: false,
      humanAccess: true,
    });
    renderManagement(result.tables);
    setStatus(`已載入 ${result.tables.length} 張牌桌。`);
  }

  function renderManagement(tables) {
    elements.managedTableCount.textContent = `${tables.length} 桌`;
    elements.managementHint.textContent = tables.length
      ? "每張牌桌可另開分頁；只有保存在這個瀏覽器裡的人類座位能進桌操作。"
      : "目前沒有牌桌。建立後會在這裡顯示，但不會列出暗牌或任何座位憑證。";
    elements.managementList.replaceChildren(...tables.map((table) => {
      const article = document.createElement("article");
      article.className = "management-card";

      const heading = document.createElement("div");
      heading.className = "management-card-heading";
      const title = document.createElement("div");
      const code = document.createElement("strong");
      code.textContent = table.join_code;
      const rule = document.createElement("span");
      rule.textContent = `${table.rule_label} · ${phaseLabel(table)}`;
      title.append(code, rule);
      const count = document.createElement("span");
      count.className = "count-pill";
      count.textContent = `${table.player_count}/${table.max_seats}`;
      heading.append(title, count);

      const players = document.createElement("p");
      players.className = "management-players";
      players.textContent = table.players.map((seat) => `${seat.name}${seat.kind === "human" ? "（人類）" : ""}`).join("、");

      const actions = document.createElement("div");
      actions.className = "management-actions";
      const token = state.tokens[table.table_id];
      if (token) {
        const open = document.createElement("a");
        open.className = "secondary-button management-open";
        open.href = tableUrl(table.table_id);
        open.target = "_blank";
        open.rel = "noopener";
        open.textContent = "另開牌桌";
        actions.append(open);
      } else {
        const unavailable = document.createElement("span");
        unavailable.className = "management-unavailable";
        unavailable.textContent = "此瀏覽器沒有該桌人類座位";
        actions.append(unavailable);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.className = "danger-button";
      close.textContent = "關閉牌桌";
      close.addEventListener("click", () => void closeManagedTable(table));
      actions.append(close);

      article.append(heading, players, actions);
      return article;
    }));
  }

  async function closeManagedTable(table) {
    if (!window.confirm(`確定要關閉牌桌 ${table.join_code} 嗎？所有人類與 Agent 座位都會立即失效。`)) return;
    await run(async () => {
      await api(`/api/admin/tables/${encodeURIComponent(table.table_id)}`, {
        method: "DELETE",
        authenticated: false,
        humanAccess: true,
      });
      forgetHumanToken(table.table_id);
      if (state.tableId === table.table_id) showManagement();
      await loadManagement();
      setStatus(`牌桌 ${table.join_code} 已關閉，所有座位憑證均已撤銷。`);
    });
  }

  function phaseLabel(table) {
    if (table.phase === "lobby") return "等待開局";
    if (table.phase === "ended") return `第 ${table.round} 局已結束`;
    return table.active_player_name ? `輪到 ${table.active_player_name}` : "進行中";
  }

  async function gameWrite(path, extra) {
    if (!state.table) return;
    await run(async () => {
      try {
        const result = await api(path, {
          method: "POST",
          body: { ...extra, expected_version: state.table.version, idempotency_key: operationKey("human-game") },
        });
        if (extra.action) state.selectedCards.clear();
        setTable(result.table);
      } catch (error) {
        await refresh(true);
        throw error;
      }
    });
  }

  async function refresh(force = false) {
    if (!state.token || (state.busy && !force)) return;
    const token = state.token;
    const result = await api("/api/human/table", { method: "GET" });
    // 等回應期間使用者可能已回大廳或換桌，舊桌的回應就不畫了。
    if (state.token !== token) return;
    if (!force && isSameSnapshot(state.table, result.table)) return;
    setTable(result.table);
  }

  // 輪詢拿到一模一樣的牌桌就不重畫，手牌捲軸和選牌狀態才不會每 0.8 秒被重置。
  function isSameSnapshot(previous, next) {
    return Boolean(previous)
      && previous.table_id === next.table_id
      && previous.version === next.version
      && previous.last_event_id === next.last_event_id
      && previous.phase === next.phase;
  }

  function startPolling() {
    clearInterval(state.polling);
    state.polling = setInterval(() => void refresh().catch((error) => {
      if (error.status === 401) {
        clearHumanSession();
        return;
      }
      setStatus(error.message, true);
    }), 800);
  }

  const DEFAULT_RULE_TEXT = {
    bigtwo: "台灣標準（五張只能被五張壓、葫蘆可壓順子）",
    jianhongdian: "台灣標準（♠A 30＋♣A 40、叨牌）",
    gongzhu: "台灣標準（紅心照牌面、♥4 -10、變壓器獨得 +50）",
    hearts: "台灣標準（每張紅心 -1、♠Q -13、射月）",
  };

  /** 邀請詞裡給 AI 的出牌指示，動作名依遊戲不同：大老二是 play_cards 可 PASS，吃墩遊戲是 play_card，傷心小棧多一段傳牌。 */
  function agentTurnInstructions(mode) {
    if (mode === "hearts") return "傳牌階段從 legal_plays 挑三張一起送 pass_cards；輪到你出牌時只從 legal_plays 選一張原樣傳給 play_card；不是你的回合時呼叫 wait_for_table_event。";
    if (mode === "gongzhu") return "輪到你時只從 legal_plays 選一張原樣傳給 play_card；不是你的回合時呼叫 wait_for_table_event。";
    return "輪到你時只從 legal_plays 選一組 cards 原樣傳給 play_cards，或在 legal_actions 允許時 PASS；不是你的回合時呼叫 wait_for_table_event。";
  }

  function describeRuleOptions(table) {
    const game = state.games[table.mode];
    const options = game?.options ?? [];
    const parts = options.filter((option) => option.type === "boolean" && table.rule_options?.[option.key]).map((option) => option.label);
    for (const option of options) {
      if (option.type !== "choice" || option.key === "end_mode") continue;
      const chosen = option.choices.find((choice) => choice.value === table.rule_options?.[option.key]);
      if (chosen && chosen.value !== option.default) parts.push(`${option.label}：${chosen.label}`);
    }
    const endMode = table.rule_options?.end_mode;
    if (endMode === "score") parts.unshift(`打到 ${table.rule_options.end_score} 分結束`);
    if (endMode === "rounds") parts.unshift(`打 ${table.rule_options.end_rounds} 局結束`);
    return parts.length ? `房主選項：${parts.join("、")}` : `房主選項：${DEFAULT_RULE_TEXT[table.mode] || "預設規則"}`;
  }

  async function loadGames() {
    const result = await api("/api/games", { method: "GET", authenticated: false });
    state.defaultMode = result.default_mode;
    state.games = Object.fromEntries(result.games.map((game) => [game.mode, game]));
    elements.gameMode.replaceChildren(...result.games.map((game) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.mode = game.mode;
      button.textContent = game.label;
      button.addEventListener("click", () => selectGameMode(game.mode));
      return button;
    }));
    elements.gameModeLabel.hidden = result.games.length < 2;
    selectGameMode(result.default_mode);
  }

  /** 規則的多選一：一排切換按鈕，選到的值放在 group 的 dataset.value，送出時和 input 一樣用 data-key 收。 */
  function segmentedChoice(option) {
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "radiogroup");
    group.dataset.value = option.default;
    group.replaceChildren(...option.choices.map((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", choice.value === option.default ? "true" : "false");
      button.textContent = choice.label;
      button.addEventListener("click", () => {
        group.dataset.value = choice.value;
        for (const sibling of group.children) sibling.setAttribute("aria-checked", sibling === button ? "true" : "false");
        syncRuleOptionVisibility();
      });
      return button;
    }));
    return group;
  }

  /** 遊戲切換按鈕群：選中的那顆標 aria-checked，並換成該遊戲的規則選項。 */
  function selectGameMode(mode) {
    state.selectedMode = mode;
    for (const button of elements.gameMode.querySelectorAll("button")) {
      const checked = button.dataset.mode === mode;
      button.setAttribute("aria-checked", checked ? "true" : "false");
      button.tabIndex = checked ? 0 : -1;
    }
    renderRuleOptions(mode);
  }
  elements.gameMode.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const modes = [...elements.gameMode.querySelectorAll("button")].map((button) => button.dataset.mode);
    const index = modes.indexOf(state.selectedMode);
    const next = modes[(index + (event.key === "ArrowRight" ? 1 : modes.length - 1)) % modes.length];
    event.preventDefault();
    selectGameMode(next);
    elements.gameMode.querySelector(`[data-mode="${next}"]`).focus();
  });

  function renderRuleOptions(mode) {
    const game = state.games[mode];
    const legend = elements.ruleOptionFields.querySelector("legend");
    elements.ruleOptionFields.replaceChildren(legend, ...(game?.options ?? []).map((option) => {
      const label = document.createElement(option.type === "choice" ? "div" : "label");
      label.className = `rule-option rule-option-${option.type}`;
      const field = ruleOptionField(option);
      field.dataset.key = option.key;
      const text = document.createElement("span");
      text.textContent = option.label;
      const small = document.createElement("small");
      small.textContent = option.description;
      text.append(small);
      if (option.type === "boolean") label.append(field, text);
      else label.append(text, field);
      if (option.visibleWhen) label.dataset.visibleWhen = JSON.stringify(option.visibleWhen);
      return label;
    }));
    syncRuleOptionVisibility();
  }

  function ruleOptionValue(field) {
    return field.type === "checkbox" ? field.checked : field.type === "number" ? Number(field.value) : field.dataset.value;
  }

  /** 帶 visibleWhen 的選項，只在它依賴的選項等於指定值時顯示；隱藏的欄位送出時一起略過。 */
  function syncRuleOptionVisibility() {
    const values = Object.fromEntries([...elements.ruleOptionFields.querySelectorAll("[data-key]")].map((field) => [field.dataset.key, ruleOptionValue(field)]));
    for (const row of elements.ruleOptionFields.querySelectorAll("[data-visible-when]")) {
      const condition = JSON.parse(row.dataset.visibleWhen);
      row.hidden = values[condition.key] !== condition.value;
    }
  }
  elements.ruleOptionFields.addEventListener("change", syncRuleOptionVisibility);

  function ruleOptionField(option) {
    if (option.type === "choice") return segmentedChoice(option);
    const input = document.createElement("input");
    if (option.type === "number") {
      input.type = "number";
      input.value = String(option.default);
      if (option.min !== undefined) input.min = String(option.min);
      if (option.max !== undefined) input.max = String(option.max);
      return input;
    }
    input.type = "checkbox";
    input.checked = option.default;
    return input;
  }

  function setTable(table) {
    const previousTable = state.table;
    if (!state.tableId || state.tableId !== table.table_id) {
      state.tableId = table.table_id;
      if (state.token) rememberHumanToken(table.table_id, state.token);
    }
    state.table = table;
    const you = table.players.find((seat) => seat.is_you);
    const ownedCards = new Set(you?.cards ?? []);
    for (const code of state.selectedCards) if (!ownedCards.has(code)) state.selectedCards.delete(code);
    if (previousTable && previousTable.board?.phase !== table.board?.phase) state.selectedCards.clear();
    elements.setupPanel.hidden = true;
    elements.managementPanel.hidden = true;
    elements.lobbyPanel.hidden = true;
    elements.tablePanel.hidden = false;
    elements.connectionBadge.textContent = state.remote ? "Remote 共桌已連線" : "本機共桌已連線";
    elements.connectionBadge.classList.add("online");
    elements.joinCode.textContent = table.join_code;
    elements.tableName.textContent = `${table.owner_name}的牌桌`;
    elements.ruleOptions.textContent = describeRuleOptions(table);
    elements.rulesLink.href = `/rules?mode=${encodeURIComponent(table.mode)}&options=${encodeURIComponent(JSON.stringify(table.rule_options ?? {}))}`;
    elements.roundLabel.textContent = table.round ? `第 ${table.round} 局 · ${table.rule_label}` : `${table.rule_label} · 等待開局`;
    elements.seatCount.textContent = String(table.players.length);

    const active = table.players.find((seat) => seat.seat_id === table.active_seat_id);
    elements.turnLabel.textContent = table.phase === "lobby"
      ? "等待玩家入座"
      : table.phase === "game_over"
        ? "整場結束"
      : table.phase === "ended"
        ? "本局結束，可以再開一局"
      : table.board.phase === "passing"
        ? `傳牌中，還有 ${table.pending_seat_ids.length} 人`
        : active
          ? `輪到 ${active.name}`
          : "牌局結算中";

    renderPile(table, previousTable);
    renderPlayers(table, previousTable);
    renderRoster(table);
    renderChat(table);
    animateTableUpdate(previousTable, table);

    syncActionButtons(table);
  }

  function syncActionButtons(table) {
    const spectating = table.viewer_role === "spectator";
    elements.seatButton.hidden = !table.legal_actions.includes("take_seat");
    elements.unseatButton.hidden = !table.legal_actions.includes("leave_seat");
    elements.acceptSubstitute.hidden = !table.legal_actions.includes("accept_substitute");
    elements.acceptSubstitute.disabled = state.busy;
    elements.seatButton.disabled = state.busy;
    elements.unseatButton.disabled = state.busy;
    elements.dockNote.hidden = !spectating;
    elements.dockNote.textContent = table.substitute_invite
      ? `${table.substitute_invite.from_name} 邀請你代打：接手後你會坐進對方的位置，接著打完這局。`
      : table.phase === "in_round"
      ? "你在觀戰區看這一局。等這局結束就可以入座。"
      : table.players.length >= 4
        ? "你在觀戰區。四個座位都滿了，等有人起身再入座。"
        : "你在觀戰區。按「入座」加入下一局。";
    elements.startRound.hidden = !table.legal_actions.includes("start_round");
    const trick = isTrickGame(table) || isPickGame(table);
    elements.playCards.hidden = trick || table.phase !== "in_round";
    elements.pass.hidden = trick || table.phase !== "in_round";
    elements.layDown.hidden = !isPickGame(table) || !table.legal_actions.includes("play_card");
    elements.layDown.disabled = state.busy || state.selectedCards.size !== 1;
    elements.passCards.hidden = !table.legal_actions.includes("pass_cards");
    elements.passCards.disabled = state.busy || state.selectedCards.size !== 3;
    elements.passCount.textContent = String(state.selectedCards.size);
    elements.playCards.disabled = state.busy || !table.legal_actions.includes("play_cards") || state.selectedCards.size === 0;
    elements.pass.disabled = state.busy || !table.legal_actions.includes("pass");
    elements.selectedCount.textContent = String(state.selectedCards.size);
    elements.startRound.disabled = state.busy;
  }

  function showManagement() {
    clearInterval(state.polling);
    state.polling = null;
    state.table = null;
    state.tableId = "";
    state.token = "";
    state.selectedCards.clear();
    hideRoundCelebration();
    const url = new URL(window.location.href);
    url.searchParams.delete("table");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    elements.setupPanel.hidden = false;
    elements.lobbyPanel.hidden = false;
    elements.managementPanel.hidden = false;
    elements.tablePanel.hidden = true;
    setRailOpen(false);
    elements.connectionBadge.textContent = "牌桌大廳";
    elements.connectionBadge.classList.remove("online");
    startLobbyPolling();
  }

  function selectTable(tableId, token) {
    clearInterval(state.lobbyPolling);
    state.lobbyPolling = null;
    state.tableId = tableId;
    state.token = token;
    const url = new URL(window.location.href);
    url.searchParams.set("table", tableId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function tableUrl(tableId) {
    const url = new URL(window.location.href);
    url.searchParams.set("table", tableId);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function readTokenMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TOKENS_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([tableId, token]) => tableId && typeof token === "string" && token));
    } catch {
      return {};
    }
  }

  function rememberPassphrase() {
    if (!state.remote) return;
    try { localStorage.setItem(PASSPHRASE_KEY, elements.createPassphrase.value); } catch { /* 私密模式沒有儲存空間也沒關係 */ }
  }

  function restorePassphrase() {
    try { elements.createPassphrase.value = localStorage.getItem(PASSPHRASE_KEY) || ""; } catch { /* 同上 */ }
  }

  function rememberHumanToken(tableId, token) {
    state.tokens[tableId] = token;
    localStorage.setItem(TOKENS_KEY, JSON.stringify(state.tokens));
  }

  function forgetHumanToken(tableId) {
    delete state.tokens[tableId];
    if (Object.keys(state.tokens).length) localStorage.setItem(TOKENS_KEY, JSON.stringify(state.tokens));
    else localStorage.removeItem(TOKENS_KEY);
  }

  function renderPile(table, previousTable) {
    elements.pileCards.classList.toggle("pick-table", isPickGame(table));
    if (isTrickGame(table)) return renderTrickBoard(table);
    if (isPickGame(table)) return renderPickBoard(table);
    const changed = previousTable?.pile?.cards.join("|") !== table.pile.cards.join("|");
    elements.pileCards.replaceChildren(...table.pile.cards.map((code, index) => cardElement(code, changed ? index : -1)));
    elements.pileLabel.textContent = table.pile.hand_type
      ? `${table.pile.hand_type} · ${table.pile.played_by_name}`
      : table.set_aside_cards.length
        ? `新墩 · 留牌 ${table.set_aside_cards.join(" ")}`
        : "新墩，自由領牌";
  }

  function renderTrickBoard(table) {
    const board = table.board;
    const nameOf = (seatId) => table.players.find((seat) => seat.seat_id === seatId)?.name ?? "";
    const plays = board.trick?.plays ?? [];
    elements.pileCards.replaceChildren(...plays.map((play, index) => {
      const wrap = document.createElement("div");
      wrap.className = `trick-play${play.seatId === board.trick.leader ? " leader" : ""}`;
      wrap.append(cardElement(play.card, index));
      const label = document.createElement("small");
      label.textContent = nameOf(play.seatId);
      wrap.append(label);
      return wrap;
    }));
    if (board.phase === "passing") {
      const target = nameOf(board.pass_targets?.[table.viewer_seat_id]);
      elements.pileLabel.textContent = target ? `傳牌中：選 3 張傳給 ${target}` : "傳牌中：其他人正在選牌";
    } else if (board.phase === "ended" && board.last_round_scores) {
      elements.pileLabel.textContent = `本局結算：${table.players.map((seat) => `${seat.name} ${formatDelta(board.last_round_scores[seat.seat_id] ?? 0)}`).join("、")}`;
    } else if (board.phase === "trick") {
      elements.pileLabel.textContent = plays.length
        ? `第 ${(board.tricks_played ?? 0) + 1} 墩 · ${nameOf(board.trick.leader)} 首出`
        : `第 ${(board.tricks_played ?? 0) + 1} 墩 · 等 ${nameOf(board.trick.leader)} 首出${board.hearts_broken ? "（紅心已破）" : ""}`;
    } else {
      elements.pileLabel.textContent = "等待開局";
    }
  }

  function renderPickBoard(table) {
    const board = table.board;
    const nameOf = (seatId) => table.players.find((seat) => seat.seat_id === seatId)?.name ?? "";
    const selected = state.selectedCards.size === 1 ? [...state.selectedCards][0] : null;
    const canPlay = table.legal_actions.includes("play_card");
    const matchable = new Set(selected ? table.legal_plays.filter((play) => play.cards[0] === selected && play.cards.length === 2).map((play) => play.cards[1]) : []);
    const tableCards = (board.table ?? []).map((code) => {
      const card = cardElement(code);
      if (canPlay && matchable.has(code)) {
        card.classList.add("selectable", "matchable");
        card.addEventListener("click", () => void gameWrite("/api/human/action", { action: "play_card", cards: [selected, code] }));
      }
      return card;
    });
    const pile = document.createElement("div");
    pile.className = "pile-stack";
    pile.append(hiddenCard());
    const count = document.createElement("small");
    count.textContent = `牌堆 ${board.pile_count ?? 0}`;
    pile.append(count);
    if (board.bottom_card) {
      const peek = cardElement(board.bottom_card);
      peek.classList.add("peek");
      peek.title = "叨牌：牌堆最後一張，只有你看得到";
      const peekLabel = document.createElement("small");
      peekLabel.textContent = "叨牌";
      pile.append(peek, peekLabel);
    }
    elements.pileCards.replaceChildren(pile, ...tableCards);
    if (board.phase === "ended" && board.last_round_scores) {
      elements.pileLabel.textContent = `本局結算：${table.players.map((seat) => `${seat.name} ${formatDelta(board.last_round_scores[seat.seat_id] ?? 0)}`).join("、")}`;
    } else if (board.phase === "play") {
      const flip = board.last_flip
        ? `${nameOf(board.last_flip.seat_id)} 翻出 ${board.last_flip.card}${board.last_flip.captured ? `，收走 ${board.last_flip.captured}` : "，留在桌上"}`
        : "";
      const hint = canPlay ? (selected ? (matchable.size ? "點亮起的桌面牌配對，或按「放到桌上」" : "沒有可配的牌，按「放到桌上」") : "先點一張手牌") : "";
      elements.pileLabel.textContent = [flip, hint].filter(Boolean).join(" · ") || "桌面";
    } else {
      elements.pileLabel.textContent = "等待開局";
    }
  }

  function pickHandCard(table, code) {
    const card = cardElement(code);
    if (!table.legal_actions.includes("play_card")) return card;
    card.classList.add("selectable");
    card.classList.toggle("selected", state.selectedCards.has(code));
    card.setAttribute("aria-pressed", state.selectedCards.has(code) ? "true" : "false");
    card.addEventListener("click", () => {
      const wasSelected = state.selectedCards.has(code);
      state.selectedCards.clear();
      if (!wasSelected) state.selectedCards.add(code);
      for (const sibling of card.parentElement?.querySelectorAll(".playing-card") ?? []) {
        sibling.classList.toggle("selected", sibling === card && !wasSelected);
        sibling.setAttribute("aria-pressed", sibling === card && !wasSelected ? "true" : "false");
      }
      renderPickBoard(state.table);
      syncActionButtons(state.table);
    });
    return card;
  }

  function formatDelta(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function trickHandCard(table, code) {
    const legal = table.legal_plays.some((play) => play.cards[0] === code);
    const passing = table.board.phase === "passing" && table.legal_actions.includes("pass_cards");
    const card = cardElement(code);
    card.classList.toggle("illegal", !legal && (passing || table.legal_actions.includes("play_card")));
    if (passing) {
      card.classList.add("selectable");
      card.classList.toggle("selected", state.selectedCards.has(code));
      card.setAttribute("aria-pressed", state.selectedCards.has(code) ? "true" : "false");
      card.addEventListener("click", () => {
        if (state.selectedCards.has(code)) state.selectedCards.delete(code);
        else if (state.selectedCards.size < 3) state.selectedCards.add(code);
        else return;
        card.classList.toggle("selected", state.selectedCards.has(code));
        card.setAttribute("aria-pressed", state.selectedCards.has(code) ? "true" : "false");
        syncActionButtons(state.table);
      });
    } else if (legal && table.legal_actions.includes("play_card")) {
      card.classList.add("selectable");
      card.addEventListener("click", () => void gameWrite("/api/human/action", { action: "play_card", cards: [code] }));
    }
    return card;
  }

  function renderPlayers(table, previousTable) {
    const previousHand = elements.handDock.querySelector(".player-seat.yours .cards");
    const handScrollLeft = previousHand ? previousHand.scrollLeft : 0;
    const seats = table.players.map((seat) => {
      const article = document.createElement("article");
      const active = seat.seat_id === table.active_seat_id;
      const turnEntered = active && previousTable && previousTable.active_seat_id !== table.active_seat_id;
      article.className = `player-seat${active ? " active" : ""}${seat.is_you ? " yours" : ""}${turnEntered ? " turn-enter" : ""}`;
      article.dataset.status = seat.status;
      const heading = document.createElement("div");
      heading.className = "seat-heading";
      const name = document.createElement("strong");
      name.dataset.kind = seat.kind === "human" ? "人" : "AI";
      name.textContent = `${seat.name}${seat.is_you ? "（你）" : ""}`;
      const points = document.createElement("span");
      points.textContent = `${seat.hand_count} 張 · ${seat.game_score} 分`;
      heading.append(name, points);
      if (isTrickGame(table) || isPickGame(table)) {
        const captured = table.board.captured_points?.[seat.seat_id] ?? [];
        const chips = document.createElement("span");
        chips.className = "captured-chips";
        const earned = isPickGame(table) ? `（${table.board.points_so_far?.[seat.seat_id] ?? 0} 點）` : "";
        chips.textContent = captured.length ? `收：${captured.join(" ")}${earned}` : earned;
        heading.append(chips);
      }
      const cards = document.createElement("div");
      cards.className = "cards compact";
      const previousSeat = previousTable?.round === table.round
        ? previousTable.players.find((candidate) => candidate.seat_id === seat.seat_id)
        : null;
      const previousCount = previousSeat?.cards.length ?? 0;
      const shouldAnimate = Boolean(previousTable && previousTable.version !== table.version);
      if (!seat.is_you && seat.hand_count > 0) {
        cards.classList.add("opponent-hand");
        cards.replaceChildren(...Array.from({ length: Math.min(seat.hand_count, 7) }, (_, index) => hiddenCard(index === 0 && shouldAnimate ? 0 : -1)));
      } else if (seat.is_you && isTrickGame(table)) {
        cards.replaceChildren(...seat.cards.map((code) => trickHandCard(table, code)));
      } else if (seat.is_you && isPickGame(table)) {
        cards.replaceChildren(...seat.cards.map((code) => pickHandCard(table, code)));
      } else {
        cards.replaceChildren(...seat.cards.map((code, index) => cardElement(
          code,
          shouldAnimate && index >= previousCount ? index - previousCount : -1,
          seat.is_you && table.legal_actions.includes("play_cards"),
        )));
      }
      const result = document.createElement("p");
      result.className = "seat-result";
      result.textContent = resultText(seat, table);
      article.append(heading, cards, result);
      return article;
    });
    // 自己的座位放在底部手牌區，其他人是舞台上的一排名牌。
    elements.playerSeats.replaceChildren(...seats.filter((article) => !article.classList.contains("yours")));
    elements.handDock.querySelector(".player-seat.yours")?.remove();
    const yours = seats.find((article) => article.classList.contains("yours"));
    if (yours) elements.handDock.prepend(yours);
    const hand = elements.handDock.querySelector(".player-seat.yours .cards");
    if (hand && handScrollLeft) hand.scrollLeft = handScrollLeft;
  }

  function renderRoster(table) {
    elements.spectatorCount.textContent = String(table.spectators.length);
    elements.roster.replaceChildren(...table.players.map((seat) => rosterRow(table, seat, "seated")));
    elements.spectatorList.replaceChildren(...table.spectators.map((seat) => rosterRow(table, seat, "spectator")));
  }

  function rosterRow(table, seat, role) {
    {
      const row = document.createElement("div");
      row.className = `roster-row ${role}`;
      const dot = document.createElement("span");
      dot.className = `roster-dot ${seat.kind}`;
      const label = document.createElement("span");
      label.textContent = seat.name;
      const kind = document.createElement("small");
      kind.textContent = `${seat.kind === "human" ? "人類" : "Agent"}${seat.is_you ? "（你）" : ""}`;
      row.append(dot, label, kind);
      if (role === "spectator" && !seat.is_you && table.legal_actions.includes("invite_substitute")) {
        const invite = document.createElement("button");
        invite.type = "button";
        invite.className = "seat-reconnect";
        invite.textContent = "請他代打";
        invite.title = `邀請 ${seat.name} 接手你的座位`;
        invite.disabled = state.busy;
        invite.addEventListener("click", () => void inviteSubstitute(seat));
        row.append(invite);
      }
      if (seat.kind === "agent" && table.viewer_is_owner) {
        const reconnect = document.createElement("button");
        reconnect.type = "button";
        reconnect.className = "seat-reconnect";
        reconnect.textContent = "重連";
        reconnect.title = `替 ${seat.name} 產生一次性重連邀請`;
        reconnect.disabled = state.busy;
        reconnect.addEventListener("click", () => void createReconnectPrompt(seat));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "seat-remove";
        remove.textContent = "移除";
        remove.title = `將 ${seat.name} 永久移出牌桌`;
        remove.disabled = state.busy;
        remove.addEventListener("click", () => void removeAgentSeat(seat));
        row.append(reconnect, remove);
      }
      return row;
    }
  }

  async function createReconnectPrompt(seat) {
    await run(async () => {
      const ticket = await api("/api/human/reconnect-code", {
        method: "POST",
        body: { seat_id: seat.seat_id },
      });
      const prompt = `請使用 agent-game-table MCP，以「${seat.name}」重新連回牌桌 ${state.table.join_code}，並在 join_table 傳入 reconnect_code「${ticket.reconnect_code}」（回應會附上這桌的完整${state.table.rule_label}規則）。${agentTurnInstructions(state.table.mode)}請持續參與後續牌局直到人類結束。`;
      await navigator.clipboard.writeText(prompt);
      setStatus(`${seat.name} 的一次性重連邀請已複製，10 分鐘內有效。`);
    });
  }

  async function removeAgentSeat(seat) {
    if (!window.confirm(`確定要將 ${seat.name} 永久移出牌桌嗎？進行中的牌局會自動交棒給下一位玩家。`)) return;
    await run(async () => {
      const result = await api("/api/human/remove-agent", {
        method: "POST",
        body: {
          seat_id: seat.seat_id,
          expected_version: state.table.version,
          idempotency_key: operationKey("human-remove-agent"),
        },
      });
      setTable(result.table);
      setStatus(`${seat.name} 已離開牌桌。`);
    });
  }

  function renderChat(table) {
    const nearBottom = elements.chatLog.scrollHeight - elements.chatLog.scrollTop - elements.chatLog.clientHeight < 40;
    elements.chatLog.replaceChildren(...table.recent_chat.map((message) => {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${message.speaker_kind}${message.speaker_role === "spectator" ? " spectator" : ""}`;
      const name = document.createElement("strong");
      name.textContent = message.speaker;
      const text = document.createElement("p");
      text.textContent = message.text;
      bubble.append(name, text);
      return bubble;
    }));
    if (nearBottom) elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  }

  function cardElement(code, dealOrder = -1, selectable = false) {
    const card = document.createElement(selectable ? "button" : "div");
    const suit = code.slice(0, 1);
    card.className = `playing-card${suit === "♥" || suit === "♦" ? " red" : ""}`;
    if (selectable) {
      card.type = "button";
      card.classList.add("selectable");
      card.classList.toggle("selected", state.selectedCards.has(code));
      card.setAttribute("aria-pressed", state.selectedCards.has(code) ? "true" : "false");
      card.addEventListener("click", () => {
        if (state.selectedCards.has(code)) state.selectedCards.delete(code);
        else state.selectedCards.add(code);
        card.classList.toggle("selected", state.selectedCards.has(code));
        card.setAttribute("aria-pressed", state.selectedCards.has(code) ? "true" : "false");
        syncActionButtons(state.table);
      });
    }
    if (dealOrder >= 0) {
      card.classList.add("dealt");
      card.style.setProperty("--deal-order", String(Math.min(dealOrder, 6)));
    }
    const rank = document.createElement("strong");
    rank.textContent = code.slice(1);
    const mark = document.createElement("span");
    mark.textContent = suit;
    card.append(rank, mark);
    return card;
  }

  function hiddenCard(dealOrder = -1) {
    const card = document.createElement("div");
    card.className = "playing-card hidden-card";
    if (dealOrder >= 0) {
      card.classList.add("dealt");
      card.style.setProperty("--deal-order", String(Math.min(dealOrder, 6)));
    }
    card.setAttribute("aria-label", "暗牌");
    return card;
  }

  function resultText(seat, table) {
    const phase = table.phase;
    if (phase === "ended" && table.board.phase === "idle") return "本局流局";
    if (isTrickGame(table) || isPickGame(table)) {
      if (phase === "ended" || phase === "game_over") return table.board.last_round_scores ? `本局 ${formatDelta(table.board.last_round_scores[seat.seat_id] ?? 0)}` : "";
      return ({ active: table.board.phase === "passing" ? "選牌中" : "正在行動", waiting: "等待", sent: "已傳牌" })[seat.status] || "";
    }
    if (phase === "ended") return seat.hand_count === 0 ? "本局勝出" : `剩下 ${seat.hand_count} 張`;
    return ({ active: "正在行動", waiting: "等待回合", passed: "本墩已 PASS", finished: "已出完手牌" })[seat.status] || "";
  }

  function animateTableUpdate(previousTable, table) {
    if (!previousTable) return;
    if (previousTable.active_seat_id !== table.active_seat_id && table.active_seat_id) {
      elements.tableStatus.classList.remove("turn-shift");
      void elements.tableStatus.offsetWidth;
      elements.tableStatus.classList.add("turn-shift");
    }
    if (table.phase !== "ended") {
      hideRoundCelebration();
      return;
    }
    if (previousTable.phase !== "ended") playRoundCelebration(table);
  }

  function playRoundCelebration(table) {
    if (reducedMotion.matches || !window.lottie) return;
    const you = table.players.find((seat) => seat.is_you);
    elements.roundCelebrationLabel.textContent = table.board.phase === "idle"
      ? "本局流局，重新來過"
      : you?.hand_count === 0 ? "漂亮，這局是你的！" : "本局結束，再接再厲";
    clearTimeout(celebrationTimer);
    elements.roundCelebration.hidden = false;
    requestAnimationFrame(() => elements.roundCelebration.classList.add("is-visible"));
    if (!roundAnimation) {
      roundAnimation = window.lottie.loadAnimation({
        container: elements.roundCelebrationAnimation,
        renderer: "svg",
        loop: false,
        autoplay: true,
        path: "/animations/round-complete.json",
        rendererSettings: { preserveAspectRatio: "xMidYMid meet", progressiveLoad: true },
      });
    } else {
      roundAnimation.goToAndPlay(0, true);
    }
    celebrationTimer = setTimeout(hideRoundCelebration, 1800);
  }

  function hideRoundCelebration() {
    clearTimeout(celebrationTimer);
    celebrationTimer = null;
    elements.roundCelebration.classList.remove("is-visible");
    elements.roundCelebration.hidden = true;
    roundAnimation?.stop();
  }

  async function api(path, options) {
    const headers = { Accept: "application/json" };
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.authenticated !== false) headers.Authorization = `Bearer ${state.token}`;
    if (options.humanAccess && state.remote) headers["X-Agent-Game-Table-Human-Key"] = elements.adminKey.value;
    if (options.createPassphrase && state.remote) headers["X-Agent-Game-Table-Passphrase"] = elements.createPassphrase.value;
    const response = await fetch(path, {
      method: options.method,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function run(operation) {
    if (state.busy) return;
    state.busy = true;
    if (state.table) syncActionButtons(state.table);
    try {
      await operation();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    } finally {
      state.busy = false;
      if (state.table) syncActionButtons(state.table);
    }
  }

  function operationKey(prefix) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  function setStatus(message, error = false) {
    elements.statusLine.textContent = message;
    elements.statusLine.classList.toggle("error", error);
  }

  function clearHumanSession() {
    clearInterval(state.polling);
    state.polling = null;
    if (state.tableId) forgetHumanToken(state.tableId);
    state.token = "";
    state.tableId = "";
    state.table = null;
    showManagement();
    setStatus("原本的牌桌已不存在，請重新開桌。", true);
  }

  void loadGames().catch((error) => setStatus(error.message, true));
  fetch("/api/remote-config", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      state.remote = Boolean(config?.remote);
      elements.passphraseLabel.hidden = !state.remote;
      elements.createPassphrase.required = state.remote;
      elements.adminKeyLabel.hidden = !state.remote;
      if (state.remote) restorePassphrase();
      if (!state.token && !state.remote) return loadManagement();
      return null;
    })
    .catch((error) => {
      if (!state.remote) setStatus(error instanceof Error ? error.message : String(error), true);
    });

  if (state.token) {
    refresh().then(() => {
      if (state.table && state.token) {
        rememberHumanToken(state.table.table_id, state.token);
        selectTable(state.table.table_id, state.token);
      }
      startPolling();
    }).catch(() => clearHumanSession());
  } else {
    showManagement();
  }
  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) hideRoundCelebration();
  });
})();
