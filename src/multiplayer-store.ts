import { createHash, randomBytes, randomUUID } from "node:crypto";

import { parseCard, shuffledDeck, type Card } from "./cards.js";
import {
  bigTwoHandLabel,
  bigTwoPlayBeats,
  classifyBigTwoPlay,
  enumerateLegalBigTwoPlays,
  lowestBigTwoCard,
  sortBigTwoCards,
  type BigTwoPlay,
} from "./big-two.js";
import { BIG_TWO_RULES_VERSION } from "./big-two-rules.js";

export type GameMode = "bigtwo";
export type TablePhase = "lobby" | "player_turns" | "ended";
export type SeatKind = "human" | "agent";
export type SeatStatus = "waiting" | "active" | "passed" | "finished";
export type TurnAction = "play_cards" | "pass";
export type PublicAction = TurnAction | "start_round";
export type TableEventKind =
  | "table_created"
  | "seat_joined"
  | "seat_left"
  | "seat_reconnected"
  | "round_started"
  | "turn_started"
  | "cards_played"
  | "player_passed"
  | "trick_started"
  | "round_ended"
  | "message";

export interface PublicSeatView {
  readonly seat_id: string;
  readonly name: string;
  readonly kind: SeatKind;
  readonly cards: string[];
  readonly hand_count: number;
  readonly game_score: number;
  readonly rounds_won: number;
  readonly status: SeatStatus;
  readonly is_you: boolean;
}

export interface PublicChatMessage {
  readonly event_id: number;
  readonly seat_id: string;
  readonly speaker: string;
  readonly speaker_kind: SeatKind;
  readonly text: string;
  readonly at: string;
}

export interface TableEvent {
  readonly event_id: number;
  readonly kind: TableEventKind;
  readonly round: number;
  readonly actor_seat_id: string | null;
  readonly actor_name: string | null;
  readonly text: string;
  readonly at: string;
}

export interface PublicTableView {
  readonly table_id: string;
  readonly join_code: string;
  readonly mode: GameMode;
  readonly rule_label: "大老二";
  readonly rules_version: typeof BIG_TWO_RULES_VERSION;
  readonly phase: TablePhase;
  readonly version: number;
  readonly round: number;
  readonly viewer_seat_id: string;
  readonly active_seat_id: string | null;
  readonly players: PublicSeatView[];
  readonly pile: {
    readonly cards: string[];
    readonly hand_type: string | null;
    readonly played_by_seat_id: string | null;
    readonly played_by_name: string | null;
  };
  readonly set_aside_cards: string[];
  readonly legal_actions: PublicAction[];
  readonly legal_plays: Array<{
    readonly cards: string[];
    readonly hand_type: string;
  }>;
  readonly recent_chat: PublicChatMessage[];
  readonly last_event_id: number;
}

export interface AgentJoinResult {
  readonly agent_token: string;
  readonly table: PublicTableView;
}

export interface AgentReconnectTicket {
  readonly reconnect_code: string;
  readonly expires_at: string;
  readonly seat_id: string;
  readonly agent_name: string;
}

export interface AgentLeaveResult {
  readonly left: true;
  readonly table_id: string;
  readonly join_code: string;
  readonly seat_id: string;
  readonly agent_name: string;
}

export interface HumanTableResult {
  readonly human_token: string;
  readonly table: PublicTableView;
}

export interface ManagedTableSummary {
  readonly table_id: string;
  readonly join_code: string;
  readonly mode: GameMode;
  readonly rule_label: "大老二";
  readonly phase: TablePhase;
  readonly round: number;
  readonly version: number;
  readonly player_count: number;
  readonly max_seats: 4;
  readonly human_name: string;
  readonly active_player_name: string | null;
  readonly players: Array<{ readonly name: string; readonly kind: SeatKind }>;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CloseTableResult {
  readonly closed: true;
  readonly table: ManagedTableSummary;
}

export interface AgentEventResult {
  readonly timed_out: boolean;
  readonly events: TableEvent[];
  readonly table: PublicTableView;
}

interface Seat {
  readonly id: string;
  readonly kind: SeatKind;
  readonly name: string;
  readonly cards: Card[];
  status: SeatStatus;
  gameScore: number;
  roundsWon: number;
  humanTokenHash: string | null;
  principalId: string | null;
}

interface Receipt<T> {
  readonly operation: string;
  readonly value: T;
}

interface AgentSession {
  readonly tokenHash: string;
  readonly seatId: string;
  cursor: number;
}

interface Waiter {
  readonly resolve: (result: AgentEventResult) => void;
  readonly timer: NodeJS.Timeout;
}

interface ReconnectTicket {
  readonly seatId: string;
  readonly expiresAtMs: number;
}

interface Table {
  readonly id: string;
  readonly joinCode: string;
  readonly ownerSeatId: string;
  phase: TablePhase;
  version: number;
  round: number;
  deck: Card[];
  activeSeatId: string | null;
  currentPlay: BigTwoPlay | null;
  currentPlaySeatId: string | null;
  passedSeatIds: Set<string>;
  openingRequiredCard: string | null;
  setAsideCards: Card[];
  previousWinnerSeatId: string | null;
  readonly seats: Seat[];
  readonly agentSessions: Map<string, AgentSession>;
  readonly events: TableEvent[];
  readonly chat: PublicChatMessage[];
  nextEventId: number;
  readonly receipts: Map<string, Receipt<unknown>>;
  readonly waiters: Map<string, Waiter>;
  readonly reconnectTickets: Map<string, ReconnectTicket>;
}

export interface MultiplayerTablePersistence {
  load(): unknown | null;
  save(snapshot: unknown): void;
}

export interface MultiplayerTableStoreOptions {
  readonly persistence?: MultiplayerTablePersistence;
}

export type MultiplayerDeckFactory = (round: number, seatCount: number) => readonly (Card | string)[];

const GAME_MODE: GameMode = "bigtwo";
const MAX_SEATS = 4;
const EVENT_CAP = 500;
const CHAT_CAP = 100;
const RECONNECT_TICKET_TTL_MS = 10 * 60 * 1000;
const LEAVE_RECEIPT_CAP = 1_000;

export class MultiplayerTableStore {
  readonly #tables = new Map<string, Table>();
  readonly #joinCodes = new Map<string, string>();
  readonly #agentTokens = new Map<string, string>();
  readonly #humanTokens = new Map<string, { tableId: string; seatId: string }>();
  readonly #departedAgentTokens = new Map<string, AgentLeaveResult>();
  readonly #principalSeats = new Map<string, { tableId: string; seatId: string }>();
  readonly #deckFactory: MultiplayerDeckFactory;
  readonly #persistence: MultiplayerTablePersistence | undefined;

  constructor(deckFactory: MultiplayerDeckFactory = () => shuffledDeck(), options: MultiplayerTableStoreOptions = {}) {
    this.#deckFactory = deckFactory;
    this.#persistence = options.persistence;
    const snapshot = this.#persistence?.load();
    if (snapshot) this.#restore(snapshot);
  }

  createTable(humanName: string): HumanTableResult {
    const id = randomUUID();
    const joinCode = this.#newJoinCode();
    const humanToken = capabilityToken();
    const humanTokenHash = capabilityHash(humanToken);
    const humanSeat: Seat = {
      id: randomUUID(), kind: "human", name: normalizeName(humanName, "玩家"), cards: [], status: "waiting",
      gameScore: 0, roundsWon: 0, humanTokenHash, principalId: null,
    };
    const table: Table = {
      id, joinCode, ownerSeatId: humanSeat.id, phase: "lobby", version: 1, round: 0, deck: [], activeSeatId: null,
      currentPlay: null, currentPlaySeatId: null, passedSeatIds: new Set(), openingRequiredCard: null,
      setAsideCards: [], previousWinnerSeatId: null, seats: [humanSeat], agentSessions: new Map(), events: [], chat: [],
      nextEventId: 1, receipts: new Map(), waiters: new Map(), reconnectTickets: new Map(),
    };
    this.#tables.set(id, table);
    this.#joinCodes.set(joinCode, id);
    this.#humanTokens.set(humanTokenHash, { tableId: id, seatId: humanSeat.id });
    this.#appendEvent(table, "table_created", humanSeat, `${humanSeat.name} 建立了大老二牌桌。`);
    this.#persist();
    return { human_token: humanToken, table: this.#view(table, humanSeat.id) };
  }

  joinHuman(joinCode: string, humanName: string): HumanTableResult {
    const table = this.#tableForJoinCode(joinCode);
    if (table.phase === "player_turns") throw new Error("本局已經開始，請等牌局結束後再加入。");
    this.#assertSeatAvailable(table);
    const name = this.#availableName(table, humanName, "玩家");
    const token = capabilityToken();
    const tokenHash = capabilityHash(token);
    const seat: Seat = {
      id: randomUUID(), kind: "human", name, cards: [], status: "waiting", gameScore: 0, roundsWon: 0,
      humanTokenHash: tokenHash, principalId: null,
    };
    table.seats.push(seat);
    this.#humanTokens.set(tokenHash, { tableId: table.id, seatId: seat.id });
    table.version += 1;
    this.#appendEvent(table, "seat_joined", seat, `${seat.name} 加入了牌桌。`);
    this.#flushWaiters(table);
    this.#persist();
    return { human_token: token, table: this.#view(table, seat.id) };
  }

  listTables(): ManagedTableSummary[] {
    return [...this.#tables.values()].map((table) => this.#managedSummary(table)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  closeTable(tableId: string): CloseTableResult {
    const table = this.#requireTable(tableId);
    const summary = this.#managedSummary(table);
    for (const [tokenHash, waiter] of table.waiters) {
      const session = table.agentSessions.get(tokenHash);
      clearTimeout(waiter.timer);
      table.waiters.delete(tokenHash);
      if (session) waiter.resolve(this.#eventResult(table, session, [], true));
    }
    this.#joinCodes.delete(table.joinCode);
    for (const seat of table.seats) {
      if (seat.humanTokenHash) this.#humanTokens.delete(seat.humanTokenHash);
      if (seat.principalId) this.#principalSeats.delete(seat.principalId);
    }
    for (const [tokenHash] of table.agentSessions) this.#agentTokens.delete(tokenHash);
    this.#tables.delete(table.id);
    this.#persist();
    return { closed: true, table: summary };
  }

  joinAgent(joinCode: string, agentName: string): AgentJoinResult {
    return this.#joinNewAgent(this.#tableForJoinCode(joinCode), agentName, null);
  }

  joinAgentForPrincipal(joinCode: string, agentName: string, principalId: string): AgentJoinResult {
    const principal = normalizePrincipal(principalId);
    const table = this.#tableForJoinCode(joinCode);
    const binding = this.#principalSeats.get(principal);
    if (binding) {
      const boundTable = this.#tables.get(binding.tableId);
      const boundSeat = boundTable?.seats.find((seat) => seat.id === binding.seatId);
      if (!boundTable || !boundSeat || boundSeat.kind !== "agent") this.#principalSeats.delete(principal);
      else {
        if (boundTable.id !== table.id) throw new Error("這個遠端 MCP 身分已經綁定另一張牌桌的座位。");
        if (boundSeat.name !== normalizeName(agentName, "AI 玩家")) throw new Error("這個遠端 MCP 身分與既有 Agent 名稱不符。");
        return this.#reconnectSeat(table, boundSeat, principal);
      }
    }
    return this.#joinNewAgent(table, agentName, principal);
  }

  #joinNewAgent(table: Table, agentName: string, principalId: string | null): AgentJoinResult {
    if (table.phase === "player_turns") throw new Error("本局已經開始，請等牌局結束後再加入。");
    this.#assertSeatAvailable(table);
    const seat: Seat = {
      id: randomUUID(), kind: "agent", name: this.#availableName(table, agentName, "AI 玩家"), cards: [], status: "waiting",
      gameScore: 0, roundsWon: 0, humanTokenHash: null, principalId,
    };
    const token = capabilityToken();
    const tokenHash = capabilityHash(token);
    const session: AgentSession = { tokenHash, seatId: seat.id, cursor: table.nextEventId - 1 };
    table.seats.push(seat);
    table.agentSessions.set(tokenHash, session);
    this.#agentTokens.set(tokenHash, table.id);
    if (principalId) this.#principalSeats.set(principalId, { tableId: table.id, seatId: seat.id });
    table.version += 1;
    this.#appendEvent(table, "seat_joined", seat, `${seat.name} 加入了牌桌。`);
    session.cursor = table.nextEventId - 1;
    this.#flushWaiters(table);
    this.#persist();
    return { agent_token: token, table: this.#view(table, seat.id) };
  }

  createAgentReconnectTicket(humanToken: string, seatId: string): AgentReconnectTicket {
    const { table, seat: humanSeat } = this.#tableForHuman(humanToken);
    if (humanSeat.id !== table.ownerSeatId) throw new Error("只有開桌的人可以產生 Agent 重連碼。");
    const seat = this.#requireSeat(table, seatId);
    if (seat.kind !== "agent") throw new Error("只能替 Agent 座位產生重連碼。");
    for (const [code, ticket] of table.reconnectTickets) {
      if (ticket.seatId === seat.id || ticket.expiresAtMs <= Date.now()) table.reconnectTickets.delete(code);
    }
    let code: string;
    do code = randomBytes(9).toString("base64url").toUpperCase();
    while (table.reconnectTickets.has(capabilityHash(code)));
    const expiresAtMs = Date.now() + RECONNECT_TICKET_TTL_MS;
    table.reconnectTickets.set(capabilityHash(code), { seatId: seat.id, expiresAtMs });
    this.#persist();
    return { reconnect_code: code, expires_at: new Date(expiresAtMs).toISOString(), seat_id: seat.id, agent_name: seat.name };
  }

  rejoinAgent(joinCode: string, agentName: string, reconnectCode: string): AgentJoinResult {
    return this.#rejoinAgent(joinCode, agentName, reconnectCode, null);
  }

  rejoinAgentForPrincipal(joinCode: string, agentName: string, reconnectCode: string, principalId: string): AgentJoinResult {
    return this.#rejoinAgent(joinCode, agentName, reconnectCode, normalizePrincipal(principalId));
  }

  #rejoinAgent(joinCode: string, agentName: string, reconnectCode: string, principalId: string | null): AgentJoinResult {
    const table = this.#tableForJoinCode(joinCode);
    const codeHash = capabilityHash(reconnectCode.trim().toUpperCase());
    const ticket = table.reconnectTickets.get(codeHash);
    if (!ticket || ticket.expiresAtMs <= Date.now()) {
      if (ticket) table.reconnectTickets.delete(codeHash);
      throw new Error("重連碼無效或已過期，請由人類玩家重新產生。");
    }
    const seat = this.#requireSeat(table, ticket.seatId);
    if (seat.kind !== "agent" || seat.name !== normalizeName(agentName, "AI 玩家")) throw new Error("重連碼與 Agent 座位不符。");
    if (seat.principalId && seat.principalId !== principalId) throw new Error("這個座位已綁定另一個遠端 MCP 身分。");
    if (principalId) {
      const existing = this.#principalSeats.get(principalId);
      if (existing && (existing.tableId !== table.id || existing.seatId !== seat.id)) throw new Error("這個遠端 MCP 身分已經綁定另一個座位。");
    }
    table.reconnectTickets.delete(codeHash);
    return this.#reconnectSeat(table, seat, principalId);
  }

  #reconnectSeat(table: Table, seat: Seat, principalId: string | null): AgentJoinResult {
    for (const [tokenHash, session] of table.agentSessions) {
      if (session.seatId !== seat.id) continue;
      const waiter = table.waiters.get(tokenHash);
      if (waiter) {
        clearTimeout(waiter.timer);
        table.waiters.delete(tokenHash);
        waiter.resolve(this.#eventResult(table, session, [], true));
      }
      table.agentSessions.delete(tokenHash);
      this.#agentTokens.delete(tokenHash);
    }
    const token = capabilityToken();
    const tokenHash = capabilityHash(token);
    const session: AgentSession = { tokenHash, seatId: seat.id, cursor: table.nextEventId - 1 };
    seat.principalId = principalId;
    table.agentSessions.set(tokenHash, session);
    this.#agentTokens.set(tokenHash, table.id);
    if (principalId) this.#principalSeats.set(principalId, { tableId: table.id, seatId: seat.id });
    this.#appendEvent(table, "seat_reconnected", seat, `${seat.name} 已安全接回原座位。`);
    session.cursor = table.nextEventId - 1;
    this.#flushWaiters(table);
    this.#persist();
    return { agent_token: token, table: this.#view(table, seat.id) };
  }

  getHumanView(humanToken: string): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#view(table, seat.id);
  }

  getAgentView(agentToken: string): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#view(table, session.seatId);
  }

  leaveAgent(agentToken: string): AgentLeaveResult {
    const tokenHash = capabilityHash(agentToken);
    const replay = this.#departedAgentTokens.get(tokenHash);
    if (replay) return structuredClone(replay);
    const { table, session } = this.#tableForAgent(agentToken);
    const seat = this.#requireSeat(table, session.seatId);
    const result = this.#leaveResult(table, seat);
    this.#removeAgentSeat(table, seat, `${seat.name} 離開了牌桌。`, result);
    this.#persist();
    return result;
  }

  removeAgentSeat(humanToken: string, seatId: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, seat: humanSeat } = this.#tableForHuman(humanToken);
    if (humanSeat.id !== table.ownerSeatId) throw new Error("只有開桌的人可以移除 Agent 座位。");
    const operation = `remove_agent:${seatId}`;
    const replay = this.#replay<PublicTableView>(table, humanSeat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    const seat = this.#requireSeat(table, seatId);
    if (seat.kind !== "agent") throw new Error("只能移除 Agent 座位。");
    this.#removeAgentSeat(table, seat, `${seat.name} 被人類玩家移出牌桌。`, this.#leaveResult(table, seat));
    const result = this.#remember(table, humanSeat.id, idempotencyKey, operation, this.#view(table, humanSeat.id));
    this.#persist();
    return result;
  }

  startRound(humanToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, seat: humanSeat } = this.#tableForHuman(humanToken);
    if (humanSeat.id !== table.ownerSeatId) throw new Error("只有開桌的人可以開始新局。");
    const operation = "start_round";
    const replay = this.#replay<PublicTableView>(table, humanSeat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    if (table.phase === "player_turns") throw new Error("目前牌局還沒結束。");
    if (table.seats.length < 2 || table.seats.length > MAX_SEATS) throw new Error("大老二需要 2 到 4 位玩家才能開始。");
    table.round += 1;
    table.deck = this.#deckFactory(table.round, table.seats.length).map((card) => typeof card === "string" ? parseCard(card) : card);
    table.activeSeatId = null;
    table.currentPlay = null;
    table.currentPlaySeatId = null;
    table.passedSeatIds.clear();
    table.openingRequiredCard = null;
    table.setAsideCards = [];
    for (const seat of table.seats) {
      seat.cards.splice(0);
      seat.status = "waiting";
    }
    table.phase = "player_turns";
    table.version += 1;
    this.#appendEvent(table, "round_started", null, `第 ${table.round} 局開始。`);
    this.#deal(table);
    const result = this.#remember(table, humanSeat.id, idempotencyKey, operation, this.#view(table, humanSeat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  humanAction(humanToken: string, action: TurnAction, expectedVersion: number, idempotencyKey: string, cards: readonly string[] = []): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#seatAction(table, seat, action, expectedVersion, idempotencyKey, cards);
  }

  agentAction(agentToken: string, action: TurnAction, expectedVersion: number, idempotencyKey: string, cards: readonly string[] = []): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#seatAction(table, this.#requireSeat(table, session.seatId), action, expectedVersion, idempotencyKey, cards);
  }

  humanSay(humanToken: string, text: string, idempotencyKey: string): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#say(table, seat, text, idempotencyKey);
  }

  agentSay(agentToken: string, text: string, idempotencyKey: string): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#say(table, this.#requireSeat(table, session.seatId), text, idempotencyKey);
  }

  async waitForAgentEvents(agentToken: string, timeoutMs: number): Promise<AgentEventResult> {
    const { table, session } = this.#tableForAgent(agentToken);
    const immediate = this.#consumeUnreadEvents(table, session);
    if (immediate.length) {
      this.#persist();
      return this.#eventResult(table, session, immediate, false);
    }
    if (table.waiters.has(session.tokenHash)) throw new Error("這個 Agent 已經有一個等待中的事件請求。");
    const boundedTimeout = Math.max(0, Math.min(timeoutMs, 25_000));
    if (boundedTimeout === 0) return this.#eventResult(table, session, [], true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        table.waiters.delete(session.tokenHash);
        resolve(this.#eventResult(table, session, [], true));
      }, boundedTimeout);
      table.waiters.set(session.tokenHash, { resolve, timer });
    });
  }

  #seatAction(table: Table, seat: Seat, action: TurnAction, expectedVersion: number, idempotencyKey: string, cards: readonly string[]): PublicTableView {
    const normalizedCards = cards.map((card) => card.trim()).filter(Boolean).sort();
    const operation = `take_action:${action}:${normalizedCards.join(",")}`;
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    if (table.phase !== "player_turns" || table.activeSeatId !== seat.id || seat.status !== "active") throw new Error("現在不是你的回合。");
    this.#takeAction(table, seat, action, normalizedCards);
    table.version += 1;
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  #deal(table: Table): void {
    if (table.deck.length !== 52 || new Set(table.deck.map((card) => card.code)).size !== 52) throw new Error("大老二需要一副完整且不重複的 52 張牌。");
    const cardsPerSeat = table.seats.length === 4 ? 13 : table.seats.length === 3 ? 17 : 13;
    for (let index = 0; index < cardsPerSeat; index += 1) for (const seat of table.seats) seat.cards.push(this.#draw(table));
    for (const seat of table.seats) seat.cards.splice(0, seat.cards.length, ...sortBigTwoCards(seat.cards));
    if (table.seats.length === 3) table.setAsideCards = [this.#draw(table)];
    const openingCard = lowestBigTwoCard(table.seats.flatMap((seat) => seat.cards));
    const previousWinner = table.round > 1 && table.previousWinnerSeatId
      ? table.seats.find((seat) => seat.id === table.previousWinnerSeatId)
      : null;
    const leader = previousWinner ?? table.seats.find((seat) => seat.cards.some((card) => card.code === openingCard.code))!;
    table.openingRequiredCard = table.round === 1 ? openingCard.code : null;
    leader.status = "active";
    table.activeSeatId = leader.id;
    this.#appendEvent(table, "turn_started", leader, `輪到 ${leader.name}；${table.openingRequiredCard ? `首手必須包含 ${table.openingRequiredCard}` : "由上局贏家先攻"}。`);
  }

  #takeAction(table: Table, seat: Seat, action: TurnAction, cardCodes: readonly string[]): void {
    if (action === "pass") {
      if (cardCodes.length) throw new Error("pass 時不要附帶牌面。");
      if (!table.currentPlay || table.currentPlaySeatId === seat.id) throw new Error("目前由你領出新墩，不能 pass。");
      table.passedSeatIds.add(seat.id);
      seat.status = "passed";
      if (table.seats.length === 2 && table.deck.length) {
        seat.cards.push(this.#draw(table));
        seat.cards.splice(0, seat.cards.length, ...sortBigTwoCards(seat.cards));
      }
      this.#appendEvent(table, "player_passed", seat, `${seat.name} pass。`);
      this.#advance(table, table.seats.indexOf(seat));
      return;
    }
    if (!cardCodes.length) throw new Error("請至少選一張牌。");
    if (new Set(cardCodes).size !== cardCodes.length) throw new Error("同一張牌不能重複選取。");
    const selected = cardCodes.map((code) => {
      const card = seat.cards.find((candidate) => candidate.code === code);
      if (!card) throw new Error(`你的手牌裡沒有 ${code}。`);
      return card;
    });
    const play = classifyBigTwoPlay(selected);
    if (table.openingRequiredCard && !selected.some((card) => card.code === table.openingRequiredCard)) throw new Error(`本局第一手必須包含 ${table.openingRequiredCard}。`);
    if (table.currentPlay && !bigTwoPlayBeats(play, table.currentPlay)) throw new Error(`這手 ${bigTwoHandLabel(play.kind)} 沒有大過桌面上的 ${bigTwoHandLabel(table.currentPlay.kind)}。`);
    const selectedCodes = new Set(selected.map((card) => card.code));
    seat.cards.splice(0, seat.cards.length, ...seat.cards.filter((card) => !selectedCodes.has(card.code)));
    table.currentPlay = play;
    table.currentPlaySeatId = seat.id;
    table.openingRequiredCard = null;
    seat.status = seat.cards.length ? "waiting" : "finished";
    this.#appendEvent(table, "cards_played", seat, `${seat.name} 出了 ${bigTwoHandLabel(play.kind)}：${play.cards.map((card) => card.code).join(" ")}。`);
    if (!seat.cards.length) this.#settle(table, seat);
    else this.#advance(table, table.seats.indexOf(seat));
  }

  #advance(table: Table, currentIndex: number): void {
    let next: Seat | null = null;
    for (let offset = 1; offset <= table.seats.length; offset += 1) {
      const candidate = table.seats[(currentIndex + offset) % table.seats.length]!;
      if (candidate.status === "finished" || table.passedSeatIds.has(candidate.id)) continue;
      next = candidate;
      break;
    }
    if (!next) throw new Error("找不到下一位可行動玩家。");
    if (table.currentPlaySeatId === next.id) {
      table.currentPlay = null;
      table.currentPlaySeatId = null;
      table.passedSeatIds.clear();
      for (const candidate of table.seats) if (candidate.status !== "finished") candidate.status = "waiting";
      this.#appendEvent(table, "trick_started", next, `${next.name} 收下這墩，重新領牌。`);
    }
    next.status = "active";
    table.activeSeatId = next.id;
    this.#appendEvent(table, "turn_started", next, `輪到 ${next.name}。`);
  }

  #settle(table: Table, winner: Seat): void {
    table.activeSeatId = null;
    table.previousWinnerSeatId = winner.id;
    let winnings = 0;
    for (const seat of table.seats) {
      if (seat.id === winner.id) continue;
      const stake = bigTwoStake(seat.cards.length, table.seats.length);
      seat.gameScore -= stake;
      winnings += stake;
    }
    winner.gameScore += winnings;
    winner.roundsWon += 1;
    for (const seat of table.seats) seat.status = "finished";
    table.phase = "ended";
    this.#appendEvent(table, "round_ended", winner, `${winner.name} 出完手牌，贏得第 ${table.round} 局。`);
  }

  #say(table: Table, seat: Seat, text: string, idempotencyKey: string): PublicTableView {
    const normalized = text.trim().slice(0, 500);
    if (!normalized) throw new Error("台詞不能是空白。");
    const operation = `say:${normalized}`;
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    const event = this.#appendEvent(table, "message", seat, normalized);
    table.chat.push({ event_id: event.event_id, seat_id: seat.id, speaker: seat.name, speaker_kind: seat.kind, text: normalized, at: event.at });
    if (table.chat.length > CHAT_CAP) table.chat.splice(0, table.chat.length - CHAT_CAP);
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  #removeAgentSeat(table: Table, seat: Seat, text: string, leaveResult: AgentLeaveResult): void {
    if (seat.kind !== "agent") throw new Error("只能移除 Agent 玩家。");
    const seatIndex = table.seats.indexOf(seat);
    if (seatIndex < 0) throw new Error("找不到這個座位。");
    const wasActive = table.phase === "player_turns" && table.activeSeatId === seat.id;
    for (const [tokenHash, session] of table.agentSessions) {
      if (session.seatId !== seat.id) continue;
      const waiter = table.waiters.get(tokenHash);
      if (waiter) {
        clearTimeout(waiter.timer);
        table.waiters.delete(tokenHash);
        waiter.resolve(this.#eventResult(table, session, [], true));
      }
      table.agentSessions.delete(tokenHash);
      this.#agentTokens.delete(tokenHash);
      this.#rememberDepartedToken(tokenHash, leaveResult);
    }
    for (const [code, ticket] of table.reconnectTickets) if (ticket.seatId === seat.id) table.reconnectTickets.delete(code);
    if (seat.principalId) this.#principalSeats.delete(seat.principalId);
    for (const key of table.receipts.keys()) if (key.startsWith(`${seat.id}:`)) table.receipts.delete(key);
    table.seats.splice(seatIndex, 1);
    table.passedSeatIds.delete(seat.id);
    if (table.previousWinnerSeatId === seat.id) table.previousWinnerSeatId = null;
    if (table.currentPlaySeatId === seat.id) {
      table.currentPlay = null;
      table.currentPlaySeatId = null;
      table.passedSeatIds.clear();
    }
    if (wasActive) table.activeSeatId = null;
    this.#appendEvent(table, "seat_left", seat, text);
    if (table.phase === "player_turns" && table.seats.length < 2) {
      table.phase = "ended";
      table.activeSeatId = null;
      this.#appendEvent(table, "round_ended", null, "玩家不足兩位，本局結束。");
    } else if (wasActive) this.#advance(table, seatIndex - 1);
    table.version += 1;
    this.#flushWaiters(table);
  }

  #leaveResult(table: Table, seat: Seat): AgentLeaveResult {
    return { left: true, table_id: table.id, join_code: table.joinCode, seat_id: seat.id, agent_name: seat.name };
  }

  #rememberDepartedToken(tokenHash: string, result: AgentLeaveResult): void {
    this.#departedAgentTokens.set(tokenHash, structuredClone(result));
    while (this.#departedAgentTokens.size > LEAVE_RECEIPT_CAP) {
      const oldest = this.#departedAgentTokens.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#departedAgentTokens.delete(oldest);
    }
  }

  #draw(table: Table): Card {
    const card = table.deck.shift();
    if (!card) throw new Error("牌堆已空，無法繼續這局。");
    return card;
  }

  #view(table: Table, viewerSeatId: string): PublicTableView {
    const viewer = this.#requireSeat(table, viewerSeatId);
    const legalActions: PublicAction[] = [];
    if (table.phase === "player_turns" && table.activeSeatId === viewer.id) {
      legalActions.push("play_cards");
      if (table.currentPlay && table.currentPlaySeatId !== viewer.id) legalActions.push("pass");
    }
    if (viewer.id === table.ownerSeatId && (table.phase === "lobby" || table.phase === "ended")) legalActions.push("start_round");
    const legalPlays = viewer.kind === "agent" && table.phase === "player_turns" && table.activeSeatId === viewer.id
      ? enumerateLegalBigTwoPlays(viewer.cards, table.currentPlay, table.openingRequiredCard).map((play) => ({
        cards: play.cards.map((card) => card.code),
        hand_type: bigTwoHandLabel(play.kind),
      }))
      : [];
    const pileSeat = table.currentPlaySeatId ? table.seats.find((seat) => seat.id === table.currentPlaySeatId) ?? null : null;
    return {
      table_id: table.id, join_code: table.joinCode, mode: GAME_MODE, rule_label: "大老二", rules_version: BIG_TWO_RULES_VERSION, phase: table.phase,
      version: table.version, round: table.round, viewer_seat_id: viewerSeatId, active_seat_id: table.activeSeatId,
      players: table.seats.map((seat) => ({
        seat_id: seat.id, name: seat.name, kind: seat.kind, cards: seat.id === viewerSeatId ? seat.cards.map((card) => card.code) : [],
        hand_count: seat.cards.length, game_score: seat.gameScore, rounds_won: seat.roundsWon, status: seat.status, is_you: seat.id === viewerSeatId,
      })),
      pile: {
        cards: table.currentPlay?.cards.map((card) => card.code) ?? [], hand_type: table.currentPlay ? bigTwoHandLabel(table.currentPlay.kind) : null,
        played_by_seat_id: pileSeat?.id ?? null, played_by_name: pileSeat?.name ?? null,
      },
      set_aside_cards: table.setAsideCards.map((card) => card.code), legal_actions: legalActions, legal_plays: legalPlays,
      recent_chat: table.chat.slice(-20).map((message) => ({ ...message })), last_event_id: table.nextEventId - 1,
    };
  }

  #managedSummary(table: Table): ManagedTableSummary {
    const activeSeat = table.activeSeatId ? table.seats.find((seat) => seat.id === table.activeSeatId) ?? null : null;
    const createdAt = table.events[0]?.at ?? new Date(0).toISOString();
    return {
      table_id: table.id, join_code: table.joinCode, mode: GAME_MODE, rule_label: "大老二", phase: table.phase,
      round: table.round, version: table.version, player_count: table.seats.length, max_seats: MAX_SEATS,
      human_name: this.#requireSeat(table, table.ownerSeatId).name, active_player_name: activeSeat?.name ?? null,
      players: table.seats.map((seat) => ({ name: seat.name, kind: seat.kind })), created_at: createdAt,
      updated_at: table.events.at(-1)?.at ?? createdAt,
    };
  }

  #appendEvent(table: Table, kind: TableEventKind, seat: Seat | null, text: string): TableEvent {
    const event: TableEvent = {
      event_id: table.nextEventId, kind, round: table.round, actor_seat_id: seat?.id ?? null,
      actor_name: seat?.name ?? null, text, at: new Date().toISOString(),
    };
    table.nextEventId += 1;
    table.events.push(event);
    if (table.events.length > EVENT_CAP) table.events.splice(0, table.events.length - EVENT_CAP);
    return event;
  }

  #flushWaiters(table: Table): void {
    for (const [tokenHash, waiter] of table.waiters) {
      const session = table.agentSessions.get(tokenHash);
      if (!session) continue;
      const unread = this.#consumeUnreadEvents(table, session);
      if (!unread.length) continue;
      clearTimeout(waiter.timer);
      table.waiters.delete(tokenHash);
      waiter.resolve(this.#eventResult(table, session, unread, false));
    }
  }

  #consumeUnreadEvents(table: Table, session: AgentSession): TableEvent[] {
    const unread = table.events.filter((event) => event.event_id > session.cursor);
    if (unread.length) session.cursor = unread.at(-1)!.event_id;
    return unread.filter((event) => event.actor_seat_id !== session.seatId).map((event) => ({ ...event }));
  }

  #eventResult(table: Table, session: AgentSession, events: TableEvent[], timedOut: boolean): AgentEventResult {
    return { timed_out: timedOut, events, table: this.#view(table, session.seatId) };
  }

  #tableForHuman(token: string): { table: Table; seat: Seat } {
    const binding = this.#humanTokens.get(capabilityHash(token));
    if (!binding) throw new Error("人類座位憑證無效。");
    const table = this.#requireTable(binding.tableId);
    return { table, seat: this.#requireSeat(table, binding.seatId) };
  }

  #tableForAgent(token: string): { table: Table; session: AgentSession } {
    const tokenHash = capabilityHash(token);
    const tableId = this.#agentTokens.get(tokenHash);
    if (!tableId) throw new Error("Agent 座位憑證無效，請重新加入牌桌。");
    const table = this.#requireTable(tableId);
    const session = table.agentSessions.get(tokenHash);
    if (!session) throw new Error("Agent 座位已失效。");
    return { table, session };
  }

  #requireTable(tableId: string): Table {
    const table = this.#tables.get(tableId);
    if (!table) throw new Error("找不到這張牌桌；牌桌可能已失效或未從持久化狀態恢復。");
    return table;
  }

  #tableForJoinCode(joinCode: string): Table {
    const tableId = this.#joinCodes.get(joinCode.trim().toUpperCase());
    if (!tableId) throw new Error("找不到這組邀請碼。");
    return this.#requireTable(tableId);
  }

  #requireSeat(table: Table, seatId: string): Seat {
    const seat = table.seats.find((candidate) => candidate.id === seatId);
    if (!seat) throw new Error("找不到這個座位。");
    return seat;
  }

  #assertSeatAvailable(table: Table): void {
    if (table.seats.length >= MAX_SEATS) throw new Error("這張大老二牌桌最多 4 個座位。");
  }

  #availableName(table: Table, value: string, fallback: string): string {
    const name = normalizeName(value, fallback);
    if (table.seats.some((seat) => seat.name === name)) throw new Error("牌桌上已經有同名玩家。");
    return name;
  }

  #assertVersion(table: Table, expectedVersion: number): void {
    if (table.version !== expectedVersion) throw new Error(`牌桌版本衝突：目前是 ${table.version}，不是 ${expectedVersion}。請重新讀取牌桌。`);
  }

  #receiptKey(actorId: string, idempotencyKey: string): string {
    return `${actorId}:${idempotencyKey}`;
  }

  #replay<T>(table: Table, actorId: string, idempotencyKey: string, operation: string): T | null {
    const receipt = table.receipts.get(this.#receiptKey(actorId, idempotencyKey));
    if (!receipt) return null;
    if (receipt.operation !== operation) throw new Error("同一個 idempotency_key 已用於不同操作。");
    return structuredClone(receipt.value) as T;
  }

  #remember<T>(table: Table, actorId: string, idempotencyKey: string, operation: string, value: T): T {
    table.receipts.set(this.#receiptKey(actorId, idempotencyKey), { operation, value: structuredClone(value) });
    return value;
  }

  #newJoinCode(): string {
    for (;;) {
      const code = randomBytes(5).toString("base64url").slice(0, 7).toUpperCase();
      if (!this.#joinCodes.has(code)) return code;
    }
  }

  #persist(): void {
    this.#persistence?.save({
      format: "agent-game-table-big-two-store", version: 1,
      tables: [...this.#tables.values()].map((table) => ({
        id: table.id, joinCode: table.joinCode, ownerSeatId: table.ownerSeatId, phase: table.phase, version: table.version,
        round: table.round, deck: table.deck.map((card) => card.code), activeSeatId: table.activeSeatId,
        currentPlay: table.currentPlay ? { cards: table.currentPlay.cards.map((card) => card.code), kind: table.currentPlay.kind, score: table.currentPlay.score } : null,
        currentPlaySeatId: table.currentPlaySeatId, passedSeatIds: [...table.passedSeatIds], openingRequiredCard: table.openingRequiredCard,
        setAsideCards: table.setAsideCards.map((card) => card.code), previousWinnerSeatId: table.previousWinnerSeatId,
        seats: table.seats.map((seat) => ({
          id: seat.id, kind: seat.kind, name: seat.name, cards: seat.cards.map((card) => card.code), status: seat.status,
          gameScore: seat.gameScore, roundsWon: seat.roundsWon, humanTokenHash: seat.humanTokenHash, principalId: seat.principalId,
        })),
        agentSessions: [...table.agentSessions.values()].map((session) => ({ ...session })), events: table.events, chat: table.chat,
        nextEventId: table.nextEventId, receipts: [...table.receipts.entries()], reconnectTickets: [...table.reconnectTickets.entries()],
      })),
      departedAgentTokens: [...this.#departedAgentTokens.entries()],
    });
  }

  #restore(value: unknown): void {
    const snapshot = value as { format?: unknown; version?: unknown; tables?: unknown[]; departedAgentTokens?: [string, AgentLeaveResult][] };
    if (snapshot.format !== "agent-game-table-big-two-store" || snapshot.version !== 1 || !Array.isArray(snapshot.tables)) throw new Error("Agent Game Table 持久化檔案格式無效或版本不支援。");
    for (const raw of snapshot.tables) {
      const saved = raw as Record<string, unknown>;
      if (typeof saved.id !== "string" || typeof saved.joinCode !== "string" || typeof saved.ownerSeatId !== "string") throw new Error("Agent Game Table 持久化牌桌資料不完整。");
      if (!Array.isArray(saved.seats) || !Array.isArray(saved.agentSessions)) throw new Error("Agent Game Table 持久化座位資料不完整。");
      const seats = (saved.seats as Array<Record<string, unknown>>).map((seat): Seat => ({
        id: String(seat.id), kind: seat.kind as SeatKind, name: String(seat.name), cards: (seat.cards as string[]).map(parseCard),
        status: seat.status as SeatStatus, gameScore: Number(seat.gameScore ?? 0), roundsWon: Number(seat.roundsWon ?? 0),
        humanTokenHash: typeof seat.humanTokenHash === "string" ? seat.humanTokenHash : null,
        principalId: typeof seat.principalId === "string" ? seat.principalId : null,
      }));
      if (!seats.some((seat) => seat.id === saved.ownerSeatId && seat.kind === "human")) throw new Error("Agent Game Table 開桌者資料無效。");
      const play = saved.currentPlay as { cards?: string[]; kind?: BigTwoPlay["kind"]; score?: number[] } | null;
      const table: Table = {
        id: saved.id, joinCode: saved.joinCode, ownerSeatId: saved.ownerSeatId, phase: saved.phase as TablePhase,
        version: Number(saved.version), round: Number(saved.round), deck: (saved.deck as string[]).map(parseCard),
        activeSeatId: typeof saved.activeSeatId === "string" ? saved.activeSeatId : null,
        currentPlay: play?.cards && play.kind && play.score ? { cards: play.cards.map(parseCard), kind: play.kind, score: play.score.map(Number) } : null,
        currentPlaySeatId: typeof saved.currentPlaySeatId === "string" ? saved.currentPlaySeatId : null,
        passedSeatIds: new Set(Array.isArray(saved.passedSeatIds) ? saved.passedSeatIds.map(String) : []),
        openingRequiredCard: typeof saved.openingRequiredCard === "string" ? saved.openingRequiredCard : null,
        setAsideCards: Array.isArray(saved.setAsideCards) ? saved.setAsideCards.map((card) => parseCard(String(card))) : [],
        previousWinnerSeatId: typeof saved.previousWinnerSeatId === "string" ? saved.previousWinnerSeatId : null,
        seats, agentSessions: new Map((saved.agentSessions as AgentSession[]).map((session) => [session.tokenHash, { ...session }])),
        events: structuredClone((saved.events ?? []) as TableEvent[]), chat: structuredClone((saved.chat ?? []) as PublicChatMessage[]),
        nextEventId: Number(saved.nextEventId), receipts: new Map(structuredClone((saved.receipts ?? []) as [string, Receipt<unknown>][])),
        waiters: new Map(), reconnectTickets: new Map(((saved.reconnectTickets ?? []) as [string, ReconnectTicket][]).filter(([, ticket]) => ticket.expiresAtMs > Date.now())),
      };
      this.#tables.set(table.id, table);
      this.#joinCodes.set(table.joinCode, table.id);
      for (const seat of table.seats) {
        if (seat.humanTokenHash) this.#humanTokens.set(seat.humanTokenHash, { tableId: table.id, seatId: seat.id });
        if (seat.principalId) this.#principalSeats.set(seat.principalId, { tableId: table.id, seatId: seat.id });
      }
      for (const [tokenHash] of table.agentSessions) this.#agentTokens.set(tokenHash, table.id);
    }
    for (const [tokenHash, departure] of snapshot.departedAgentTokens ?? []) this.#departedAgentTokens.set(tokenHash, structuredClone(departure));
  }
}

function capabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

function capabilityHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizePrincipal(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) throw new Error("遠端 MCP 身分無效。");
  return normalized;
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 80);
  return normalized || fallback;
}

function bigTwoStake(cardCount: number, playerCount: number): number {
  if (cardCount <= 0) return 0;
  const multiplier = playerCount === 4
    ? cardCount >= 13 ? 4 : cardCount >= 11 ? 3 : cardCount >= 8 ? 2 : 1
    : cardCount >= 17 ? 4 : cardCount >= 13 ? 3 : cardCount >= 10 ? 2 : 1;
  return cardCount * multiplier;
}
