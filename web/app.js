(() => {
  "use strict";

  const TOKENS_KEY = "agent_game_table_human_tokens_v1";
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
    busy: false,
    remote: false,
    selectedCards: new Set(),
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let roundAnimation = null;
  let celebrationTimer = null;
  const elements = Object.fromEntries(
    [
      "connectionBadge", "setupPanel", "createForm", "joinForm", "joinHumanName", "humanJoinCode", "humanName", "tablePanel", "joinCode", "copyInvite",
      "pileZone", "pileLabel", "pileCards", "roundLabel", "turnLabel", "playerSeats", "startRound", "playCards", "pass", "selectedCount",
      "seatCount", "roster", "chatLog", "chatForm", "chatInput", "statusLine", "remoteAccessLabel", "remoteAccessKey",
      "managementPanel", "managementList", "managedTableCount", "managementHint", "refreshTables", "backToTables",
      "tableStatus", "roundCelebration", "roundCelebrationAnimation", "roundCelebrationLabel", "optionBombs", "optionSameKind", "ruleOptions", "tableName", "railToggle", "rail", "handDock", "seatButton", "unseatButton", "dockNote", "spectatorList", "spectatorCount",
    ].map((id) => [id, document.getElementById(id)]),
  );

  elements.seatButton.addEventListener("click", () => void changeSeat("/api/human/seat", "已入座，等房主開局。"));
  elements.unseatButton.addEventListener("click", () => void changeSeat("/api/human/unseat", "已到觀戰區。"));

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

  elements.railToggle.addEventListener("click", () => {
    const open = elements.rail.classList.toggle("open");
    elements.railToggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  elements.createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await run(async () => {
      const result = await api("/api/tables", {
        method: "POST",
        body: {
          human_name: elements.humanName.value.trim(),
          options: {
            bombs_beat_anything: elements.optionBombs.checked,
            five_card_same_kind_only: elements.optionSameKind.checked,
          },
        },
        authenticated: false,
        humanAccess: true,
      });
      rememberHumanToken(result.table.table_id, result.human_token);
      selectTable(result.table.table_id, result.human_token);
      setTable(result.table);
      setStatus("牌桌建立完成，把邀請碼交給 Agent 就能入座。");
      startPolling();
    });
  });

  elements.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await run(async () => {
      const result = await api("/api/human/join", {
        method: "POST",
        body: { join_code: elements.humanJoinCode.value.trim(), human_name: elements.joinHumanName.value.trim() },
        authenticated: false,
        humanAccess: true,
      });
      rememberHumanToken(result.table.table_id, result.human_token);
      selectTable(result.table.table_id, result.human_token);
      setTable(result.table);
      setStatus(`已加入 ${result.table.join_code}，等開桌者開始牌局。`);
      startPolling();
    });
  });

  elements.refreshTables.addEventListener("click", () => void run(loadManagement));
  elements.backToTables.addEventListener("click", () => {
    showManagement();
    void loadManagement().catch((error) => setStatus(error.message, true));
  });

  elements.copyInvite.addEventListener("click", async () => {
    if (!state.table) return;
    const prompt = `Agent Game Table 牌桌邀請碼：${state.table.join_code}\n\n人類玩家：開啟 ${window.location.origin}${window.location.pathname}，在「加入朋友的桌」輸入名字與邀請碼，進桌後按「入座」。\n\nAI Agent：請使用 agent-game-table MCP，先呼叫 get_game_rules 讀取完整大老二規則，再以你的名字 join_table 加入牌桌 ${state.table.join_code}，接著呼叫 take_seat 入座。輪到你時只從 legal_plays 選一組 cards 原樣傳給 play_cards，或在 legal_actions 允許時 PASS；不是你的回合時呼叫 wait_for_table_event。局間若人類請你讓位，用 leave_seat 到觀戰區繼續看牌聊天。`;
    await navigator.clipboard.writeText(prompt);
    setStatus("邀請詞已複製，可以直接貼給 Codex 或 Claude Code。");
  });

  elements.startRound.addEventListener("click", () => gameWrite("/api/human/start-round", {}));
  elements.playCards.addEventListener("click", () => gameWrite("/api/human/action", { action: "play_cards", cards: [...state.selectedCards] }));
  elements.pass.addEventListener("click", () => gameWrite("/api/human/action", { action: "pass", cards: [] }));

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
    const result = await api("/api/human/table", { method: "GET" });
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

  function describeRuleOptions(options) {
    const enabled = [];
    if (options?.bombs_beat_anything) enabled.push("鐵支同花順全壓");
    if (options?.five_card_same_kind_only) enabled.push("五張同牌型互壓");
    return enabled.length ? `房主選項：${enabled.join("、")}` : "房主選項：台灣標準（五張只能被五張壓、葫蘆可壓順子）";
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
    elements.setupPanel.hidden = true;
    elements.managementPanel.hidden = true;
    elements.tablePanel.hidden = false;
    elements.connectionBadge.textContent = state.remote ? "Remote 共桌已連線" : "本機共桌已連線";
    elements.connectionBadge.classList.add("online");
    elements.joinCode.textContent = table.join_code;
    elements.tableName.textContent = `${table.owner_name}的牌桌`;
    elements.ruleOptions.textContent = describeRuleOptions(table.rule_options);
    elements.roundLabel.textContent = table.round ? `第 ${table.round} 局 · ${table.rule_label}` : `${table.rule_label} · 等待開局`;
    elements.seatCount.textContent = String(table.players.length);

    const active = table.players.find((seat) => seat.seat_id === table.active_seat_id);
    elements.turnLabel.textContent = table.phase === "lobby"
      ? "等待玩家入座"
      : table.phase === "ended"
        ? "本局結束，可以再開一局"
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
    elements.seatButton.disabled = state.busy;
    elements.unseatButton.disabled = state.busy;
    elements.dockNote.hidden = !spectating;
    elements.dockNote.textContent = table.phase === "player_turns"
      ? "你在觀戰區看這一局。等這局結束就可以入座。"
      : table.players.length >= 4
        ? "你在觀戰區。四個座位都滿了，等有人起身再入座。"
        : "你在觀戰區。按「入座」加入下一局。";
    elements.startRound.hidden = !table.legal_actions.includes("start_round");
    elements.playCards.hidden = table.phase !== "player_turns";
    elements.pass.hidden = table.phase !== "player_turns";
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
    elements.managementPanel.hidden = false;
    elements.tablePanel.hidden = true;
    elements.connectionBadge.textContent = "多桌營運台";
    elements.connectionBadge.classList.remove("online");
  }

  function selectTable(tableId, token) {
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
    const changed = previousTable?.pile?.cards.join("|") !== table.pile.cards.join("|");
    elements.pileCards.replaceChildren(...table.pile.cards.map((code, index) => cardElement(code, changed ? index : -1)));
    elements.pileLabel.textContent = table.pile.hand_type
      ? `${table.pile.hand_type} · ${table.pile.played_by_name}`
      : table.set_aside_cards.length
        ? `新墩 · 留牌 ${table.set_aside_cards.join(" ")}`
        : "新墩，自由領牌";
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
      } else {
        cards.replaceChildren(...seat.cards.map((code, index) => cardElement(
          code,
          shouldAnimate && index >= previousCount ? index - previousCount : -1,
          seat.is_you && table.legal_actions.includes("play_cards"),
        )));
      }
      const result = document.createElement("p");
      result.className = "seat-result";
      result.textContent = resultText(seat, table.phase);
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
      const prompt = `請使用 agent-game-table MCP，先呼叫 get_game_rules 讀取完整大老二規則，再以「${seat.name}」重新連回牌桌 ${state.table.join_code}，並在 join_table 傳入 reconnect_code「${ticket.reconnect_code}」。輪到你時只從 legal_plays 選一組 cards 原樣送出，或在 legal_actions 允許時 PASS；不是你的回合時呼叫 wait_for_table_event，並持續參與後續牌局直到阿童結束測試。`;
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

  function resultText(seat, phase) {
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
    elements.roundCelebrationLabel.textContent = you?.hand_count === 0 ? "漂亮，這局是你的！" : "本局結束，再接再厲";
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
    if (options.humanAccess && state.remote) headers["X-Agent-Game-Table-Human-Key"] = elements.remoteAccessKey.value;
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

  fetch("/api/remote-config", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((config) => {
      state.remote = Boolean(config?.remote);
      elements.remoteAccessLabel.hidden = !state.remote;
      elements.remoteAccessKey.required = state.remote;
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
