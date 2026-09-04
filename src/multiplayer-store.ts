import { createHash, randomBytes, randomUUID } from "node:crypto";

import { parseCard, shuffledDeck, type Card } from "./cards.js";
import type { BigTwoRuleOptions } from "./big-two.js";
import { bigTwoEngine, type BigTwoState } from "./engine/big-two-engine.js";
import { DEFAULT_GAME_MODE, engineFor } from "./engine/registry.js";
import type { EngineEvent, EngineTransition, GameBoardView, GameEngine } from "./engine/types.js";

/** 引擎登錄表裡的 mode 字串；目前只有 bigtwo。 */
export type GameMode = string;
export type TablePhase = "lobby" | "in_round" | "ended" | "game_over";
export type SeatKind = "human" | "agent";
/** 座位在局內的狀態，由引擎的 board.seat_status 提供；沒有就是 waiting。 */
export type SeatStatus = string;
export type TurnAction = string;
export type PublicAction = string;
export type MemberRole = "seated" | "spectator";
/** 牌桌層的事件種類固定；引擎事件種類由各引擎定義。 */
export type TableEventKind = string;

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

export interface PublicSpectatorView {
  readonly seat_id: string;
  readonly name: string;
  readonly kind: SeatKind;
  readonly is_you: boolean;
}

export interface PublicChatMessage {
  readonly event_id: number;
  readonly seat_id: string;
  readonly speaker: string;
  readonly speaker_kind: SeatKind;
  readonly speaker_role: MemberRole;
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
  readonly rule_label: string;
  readonly rules_version: string;
  readonly rule_options: Readonly<Record<string, unknown>>;
  readonly phase: TablePhase;
  readonly version: number;
  readonly round: number;
  readonly viewer_seat_id: string;
  readonly viewer_role: MemberRole;
  readonly viewer_is_owner: boolean;
  readonly owner_name: string;
  /** 相容欄位：pending_seat_ids 的第一個。 */
  readonly active_seat_id: string | null;
  /** 現在可以行動的席位；傳牌、叫牌類階段可以同時多個。 */
  readonly pending_seat_ids: string[];
  readonly players: PublicSeatView[];
  readonly spectators: PublicSpectatorView[];
  /** 有人邀你代打時才有值；接受後你會坐進對方的位置，對方退到觀戰區。 */
  readonly substitute_invite: { readonly from_seat_id: string; readonly from_name: string } | null;
  /** 你自己的手牌。 */
  readonly hand: string[];
  /** 引擎決定形狀的桌面。 */
  readonly board: GameBoardView;
  /** 相容欄位：大老二 board 的 pile 複本。 */
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

export interface HumanLeaveResult {
  readonly left: true;
  readonly table_id: string;
  readonly join_code: string;
  /** 房主是最後一位人類時，離桌等於關桌。 */
  readonly table_closed: boolean;
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
  readonly rule_label: string;
  readonly phase: TablePhase;
  readonly round: number;
  readonly version: number;
  readonly player_count: number;
  readonly spectator_count: number;
  readonly max_seats: number;
  readonly human_name: string;
  readonly active_player_name: string | null;
  readonly players: Array<{ readonly name: string; readonly kind: SeatKind }>;
  readonly created_at: string;
  readonly updated_at: string;
}

/** 大廳公開資訊：誰開的桌、幾個人、打到哪；邀請碼只露首尾兩碼。 */
export interface LobbyTableSummary {
  readonly table_id: string;
  readonly join_code_hint: string;
  readonly rule_label: string;
  readonly phase: TablePhase;
  readonly round: number;
  readonly player_count: number;
  readonly spectator_count: number;
  readonly max_seats: number;
  readonly human_name: string;
  readonly active_player_name: string | null;
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
  seated: boolean;
  seatIndex: number | null;
  gameScore: number;
  roundsWon: number;
  humanTokenHash: string | null;
  principalId: string | null;
  /** 最後一次為這個座位換發 token 的 OAuth client；同一個身分多個 Agent 時用來認出是哪一個。 */
  lastClientId: string | null;
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

interface SubstituteInvite {
  readonly fromSeatId: string;
  readonly expiresAtMs: number;
}

interface Table {
  readonly id: string;
  readonly joinCode: string;
  ownerSeatId: string;
  readonly mode: GameMode;
  readonly options: unknown;
  nextSeatIndex: number;
  phase: TablePhase;
  version: number;
  round: number;
  /** 引擎的一局狀態；lobby 或還沒開過局時是 null。 */
  game: unknown | null;
  readonly seats: Seat[];
  readonly agentSessions: Map<string, AgentSession>;
  readonly events: TableEvent[];
  readonly chat: PublicChatMessage[];
  nextEventId: number;
  readonly receipts: Map<string, Receipt<unknown>>;
  readonly waiters: Map<string, Waiter>;
  readonly reconnectTickets: Map<string, ReconnectTicket>;
  /** 鍵是被邀請者的席位 id；邀請不落地，重啟就清掉。 */
  readonly substituteInvites: Map<string, SubstituteInvite>;
}

export interface MultiplayerTablePersistence {
  load(): unknown | null;
  save(snapshot: unknown): void;
}

export interface MultiplayerTableStoreOptions {
  readonly persistence?: MultiplayerTablePersistence;
}

export type MultiplayerDeckFactory = (round: number, seatCount: number) => readonly (Card | string)[];

const MAX_MEMBERS = 16;
const EVENT_CAP = 500;
/** long poll 上限；Cloudflare 代理 125 秒就回 524，所以留在 100 秒以內。 */
const MAX_WAIT_MS = 100_000;
const CHAT_CAP = 100;
const RECONNECT_TICKET_TTL_MS = 10 * 60 * 1000;
const SUBSTITUTE_INVITE_TTL_MS = 10 * 60 * 1000;
const LEAVE_RECEIPT_CAP = 1_000;

export class MultiplayerTableStore {
  readonly #tables = new Map<string, Table>();
  readonly #joinCodes = new Map<string, string>();
  readonly #agentTokens = new Map<string, string>();
  readonly #humanTokens = new Map<string, { tableId: string; seatId: string }>();
  readonly #departedAgentTokens = new Map<string, AgentLeaveResult>();
  /** 鍵是 principalBindingKey(身分, Agent 名字)：同一個登入身分可以帶多個名字不同的 Agent。 */
  readonly #principalSeats = new Map<string, { tableId: string; seatId: string }>();
  readonly #deckFactory: MultiplayerDeckFactory;
  readonly #persistence: MultiplayerTablePersistence | undefined;

  constructor(deckFactory: MultiplayerDeckFactory = () => shuffledDeck(), options: MultiplayerTableStoreOptions = {}) {
    this.#deckFactory = deckFactory;
    this.#persistence = options.persistence;
    const snapshot = this.#persistence?.load();
    if (snapshot) this.#restore(snapshot);
  }

  createTable(humanName: string, options: unknown = undefined, mode: GameMode = DEFAULT_GAME_MODE): HumanTableResult {
    const engine = engineFor(mode);
    const id = randomUUID();
    const joinCode = this.#newJoinCode();
    const humanToken = capabilityToken();
    const humanTokenHash = capabilityHash(humanToken);
    const humanSeat: Seat = {
      id: randomUUID(), kind: "human", name: normalizeName(humanName, "玩家"), seated: false, seatIndex: null,
      gameScore: 0, roundsWon: 0, humanTokenHash, principalId: null, lastClientId: null,
    };
    const table: Table = {
      id, joinCode, ownerSeatId: humanSeat.id, mode: engine.mode, options: engine.normalizeOptions(options), nextSeatIndex: 0, phase: "lobby", version: 1, round: 0,
      game: null, seats: [humanSeat], agentSessions: new Map(), events: [], chat: [],
      nextEventId: 1, receipts: new Map(), waiters: new Map(), reconnectTickets: new Map(), substituteInvites: new Map(),
    };
    this.#tables.set(id, table);
    this.#joinCodes.set(joinCode, id);
    this.#humanTokens.set(humanTokenHash, { tableId: id, seatId: humanSeat.id });
    this.#appendEvent(table, "table_created", humanSeat, `${humanSeat.name} 建立了${engine.label}牌桌。`);
    this.#persist();
    return { human_token: humanToken, table: this.#view(table, humanSeat.id) };
  }

  joinHuman(joinCode: string, humanName: string): HumanTableResult {
    const table = this.#tableForJoinCode(joinCode);
    this.#assertMemberAvailable(table);
    const name = this.#availableName(table, humanName, "玩家");
    const token = capabilityToken();
    const tokenHash = capabilityHash(token);
    const seat: Seat = {
      id: randomUUID(), kind: "human", name, seated: false, seatIndex: null, gameScore: 0, roundsWon: 0,
      humanTokenHash: tokenHash, principalId: null, lastClientId: null,
    };
    table.seats.push(seat);
    this.#humanTokens.set(tokenHash, { tableId: table.id, seatId: seat.id });
    table.version += 1;
    this.#appendEvent(table, "seat_joined", seat, `${seat.name} 加入了牌桌，先在觀戰區。`);
    this.#flushWaiters(table);
    this.#persist();
    return { human_token: token, table: this.#view(table, seat.id) };
  }

  listTables(): ManagedTableSummary[] {
    return [...this.#tables.values()].map((table) => this.#managedSummary(table)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  listLobby(): LobbyTableSummary[] {
    return this.listTables().map(({ join_code, mode: _mode, version: _version, players: _players, created_at: _createdAt, ...summary }) => ({
      ...summary, join_code_hint: joinCodeHint(join_code),
    }));
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
      if (seat.principalId) this.#principalSeats.delete(principalBindingKey(seat.principalId, seat.name));
    }
    for (const [tokenHash] of table.agentSessions) this.#agentTokens.delete(tokenHash);
    this.#tables.delete(table.id);
    this.#persist();
    return { closed: true, table: summary };
  }

  joinAgent(joinCode: string, agentName: string): AgentJoinResult {
    return this.#joinNewAgent(this.#tableForJoinCode(joinCode), agentName, null);
  }

  joinAgentForPrincipal(joinCode: string, agentName: string, principalId: string, clientId: string | null = null): AgentJoinResult {
    const principal = normalizePrincipal(principalId);
    const table = this.#tableForJoinCode(joinCode);
    const bindingKey = principalBindingKey(principal, normalizeName(agentName, "AI 玩家"));
    const binding = this.#principalSeats.get(bindingKey);
    if (binding) {
      const boundTable = this.#tables.get(binding.tableId);
      const boundSeat = boundTable?.seats.find((seat) => seat.id === binding.seatId);
      if (!boundTable || !boundSeat || boundSeat.kind !== "agent") this.#principalSeats.delete(bindingKey);
      else {
        if (boundTable.id !== table.id) throw new Error("這個名字的 Agent 已經在另一張牌桌上，請先 leave_table。");
        return this.#reconnectSeat(table, boundSeat, principal, clientId);
      }
    }
    return this.#joinNewAgent(table, agentName, principal, clientId);
  }

  /**
   * 給每次 tool call 都可能換 MCP session 的 client（claude.ai／ChatGPT connector）用：
   * server 手上沒有座位 token 時，用登入身分找回唯一的座位並換發新 token，不留事件。
   * 同一個身分帶了多個 Agent 時，只認得出「上次由同一個 OAuth client 操作」的那一個；
   * 認不出來就要求重新 join_table 指名。
   */
  resumeAgentForPrincipal(principalId: string, clientId: string | null = null): AgentJoinResult | null {
    const principal = normalizePrincipal(principalId);
    const prefix = principalBindingKey(principal, "");
    const bound = [...this.#principalSeats.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, binding]) => {
        const table = this.#tables.get(binding.tableId);
        const seat = table?.seats.find((candidate) => candidate.id === binding.seatId);
        return table && seat && seat.kind === "agent" ? { table, seat } : null;
      })
      .filter((entry): entry is { table: Table; seat: Seat } => entry !== null);
    if (bound.length === 0) return null;
    const candidates = bound.length === 1 ? bound : bound.filter(({ seat }) => clientId !== null && seat.lastClientId === clientId);
    if (candidates.length !== 1) throw new Error("這個登入身分帶了多個 Agent 在桌上，請帶 agent_name 重新呼叫 join_table 指明是哪一個。");
    const { table, seat } = candidates[0]!;
    return this.#issueAgentSession(table, seat, principal, clientId);
  }

  #joinNewAgent(table: Table, agentName: string, principalId: string | null, clientId: string | null = null): AgentJoinResult {
    this.#assertMemberAvailable(table);
    const seat: Seat = {
      id: randomUUID(), kind: "agent", name: this.#availableName(table, agentName, "AI 玩家"), seated: false, seatIndex: null,
      gameScore: 0, roundsWon: 0, humanTokenHash: null, principalId, lastClientId: clientId,
    };
    const token = capabilityToken();
    const tokenHash = capabilityHash(token);
    const session: AgentSession = { tokenHash, seatId: seat.id, cursor: table.nextEventId - 1 };
    table.seats.push(seat);
    table.agentSessions.set(tokenHash, session);
    this.#agentTokens.set(tokenHash, table.id);
    if (principalId) this.#principalSeats.set(principalBindingKey(principalId, seat.name), { tableId: table.id, seatId: seat.id });
    table.version += 1;
    this.#appendEvent(table, "seat_joined", seat, `${seat.name} 加入了牌桌，先在觀戰區。`);
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

  rejoinAgentForPrincipal(joinCode: string, agentName: string, reconnectCode: string, principalId: string, clientId: string | null = null): AgentJoinResult {
    return this.#rejoinAgent(joinCode, agentName, reconnectCode, normalizePrincipal(principalId), clientId);
  }

  #rejoinAgent(joinCode: string, agentName: string, reconnectCode: string, principalId: string | null, clientId: string | null = null): AgentJoinResult {
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
      const existing = this.#principalSeats.get(principalBindingKey(principalId, seat.name));
      if (existing && (existing.tableId !== table.id || existing.seatId !== seat.id)) throw new Error("這個遠端 MCP 身分已經綁定另一個座位。");
    }
    table.reconnectTickets.delete(codeHash);
    return this.#reconnectSeat(table, seat, principalId, clientId);
  }

  #reconnectSeat(table: Table, seat: Seat, principalId: string | null, clientId: string | null = null): AgentJoinResult {
    const result = this.#issueAgentSession(table, seat, principalId, clientId);
    this.#appendEvent(table, "seat_reconnected", seat, `${seat.name} 已安全接回原座位。`);
    this.#flushWaiters(table);
    this.#persist();
    return { agent_token: result.agent_token, table: this.#view(table, seat.id) };
  }

  /** 撤銷這個座位既有的 session、換發新 token；不寫事件，讓 reconnect 與靜默 resume 共用。 */
  #issueAgentSession(table: Table, seat: Seat, principalId: string | null, clientId: string | null = null): AgentJoinResult {
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
    seat.lastClientId = clientId;
    table.agentSessions.set(tokenHash, session);
    this.#agentTokens.set(tokenHash, table.id);
    if (principalId) this.#principalSeats.set(principalBindingKey(principalId, seat.name), { tableId: table.id, seatId: seat.id });
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

  /** 人類離桌：房主離開時把房主交給最早進桌的另一位人類，沒有其他人類就關桌。 */
  leaveHuman(humanToken: string): HumanLeaveResult {
    const { table, seat } = this.#tableForHuman(humanToken);
    const result: HumanLeaveResult = { left: true, table_id: table.id, join_code: table.joinCode, table_closed: false };
    if (seat.id === table.ownerSeatId) {
      const successor = table.seats.find((candidate) => candidate.kind === "human" && candidate.id !== seat.id);
      if (!successor) {
        this.closeTable(table.id);
        return { ...result, table_closed: true };
      }
      table.ownerSeatId = successor.id;
      this.#appendEvent(table, "message", successor, `${seat.name} 離桌，房主交給 ${successor.name}。`);
    }
    this.#removeSeat(table, seat, `${seat.name} 離開了牌桌。`, null);
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

  humanTakeSeat(humanToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#takeSeat(table, seat, expectedVersion, idempotencyKey);
  }

  agentTakeSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#takeSeat(table, this.#requireSeat(table, session.seatId), expectedVersion, idempotencyKey);
  }

  humanLeaveSeat(humanToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#leaveSeat(table, seat, expectedVersion, idempotencyKey);
  }

  agentLeaveSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#leaveSeat(table, this.#requireSeat(table, session.seatId), expectedVersion, idempotencyKey);
  }

  humanInviteSubstitute(humanToken: string, targetSeatId: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#inviteSubstitute(table, seat, targetSeatId, expectedVersion, idempotencyKey);
  }

  agentInviteSubstitute(agentToken: string, targetSeatId: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#inviteSubstitute(table, this.#requireSeat(table, session.seatId), targetSeatId, expectedVersion, idempotencyKey);
  }

  humanAcceptSubstitute(humanToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, seat } = this.#tableForHuman(humanToken);
    return this.#acceptSubstitute(table, seat, expectedVersion, idempotencyKey);
  }

  agentAcceptSubstitute(agentToken: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const { table, session } = this.#tableForAgent(agentToken);
    return this.#acceptSubstitute(table, this.#requireSeat(table, session.seatId), expectedVersion, idempotencyKey);
  }

  /** 座位上的人邀觀戰區的人代打；同一個人同時只有一張有效邀請，新的蓋掉舊的。 */
  #inviteSubstitute(table: Table, seat: Seat, targetSeatId: string, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const operation = `invite_substitute:${targetSeatId}`;
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    if (!seat.seated) throw new Error("你不在座位上，沒有位置可以請人代打。");
    if (table.phase === "game_over") throw new Error("這場已經結束。");
    const target = this.#requireSeat(table, targetSeatId);
    if (target.id === seat.id) throw new Error("不能邀請自己代打。");
    if (target.seated) throw new Error(`${target.name} 已經在座位上，只能邀請觀戰區的人。`);
    for (const [inviteeId, invite] of table.substituteInvites) if (invite.fromSeatId === seat.id) table.substituteInvites.delete(inviteeId);
    table.substituteInvites.set(target.id, { fromSeatId: seat.id, expiresAtMs: Date.now() + SUBSTITUTE_INVITE_TTL_MS });
    table.version += 1;
    this.#appendEvent(table, "substitute_invited", seat, `${seat.name} 邀請 ${target.name} 代打。`);
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  /** 接手：接手者帶著自己的分數坐進邀請者的位置，邀請者退到觀戰區；局中的手牌與輪次一起轉過去。 */
  #acceptSubstitute(table: Table, seat: Seat, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const operation = "accept_substitute";
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    const invite = this.#validSubstituteInvite(table, seat.id);
    if (!invite) throw new Error("沒有人邀請你代打，或邀請已過期。");
    if (seat.seated) throw new Error("你已經在座位上。");
    const from = this.#requireSeat(table, invite.fromSeatId);
    if (!from.seated) throw new Error(`${from.name} 已經不在座位上了。`);
    if (table.game !== null) table.game = this.#engine(table).transferSeat(table.game, from.id, seat.id);
    seat.seated = true;
    seat.seatIndex = from.seatIndex;
    from.seated = false;
    from.seatIndex = null;
    table.substituteInvites.delete(seat.id);
    for (const [inviteeId, pending] of table.substituteInvites) if (pending.fromSeatId === from.id) table.substituteInvites.delete(inviteeId);
    table.version += 1;
    this.#appendEvent(table, "substitute_accepted", seat, `${seat.name} 接手 ${from.name} 的座位。`);
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  #validSubstituteInvite(table: Table, inviteeSeatId: string): SubstituteInvite | null {
    const invite = table.substituteInvites.get(inviteeSeatId);
    if (!invite) return null;
    if (invite.expiresAtMs <= Date.now() || !table.seats.some((seat) => seat.id === invite.fromSeatId && seat.seated)) {
      table.substituteInvites.delete(inviteeSeatId);
      return null;
    }
    return invite;
  }

  #takeSeat(table: Table, seat: Seat, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const operation = "take_seat";
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    if (table.phase === "in_round") throw new Error("本局進行中，等這局結束再入座。");
    if (seat.seated) throw new Error("你已經在座位上。");
    const maxSeats = this.#engine(table).seats.max;
    if (seatedMembers(table).length >= maxSeats) throw new Error(`${chineseCount(maxSeats)}個座位都有人了，請先觀戰。`);
    seat.seated = true;
    seat.seatIndex = table.nextSeatIndex;
    table.nextSeatIndex += 1;
    table.version += 1;
    this.#appendEvent(table, "seat_taken", seat, `${seat.name} 入座。`);
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  #leaveSeat(table: Table, seat: Seat, expectedVersion: number, idempotencyKey: string): PublicTableView {
    const operation = "leave_seat";
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    this.#assertVersion(table, expectedVersion);
    if (table.phase === "in_round") throw new Error("本局進行中不能起身；要離開牌桌請用 leave_table。");
    if (!seat.seated) throw new Error("你已經在觀戰區。");
    seat.seated = false;
    seat.seatIndex = null;
    if (table.game !== null) {
      const pruned = this.#engine(table).onSeatRemoved(table.game, seat.id, table.options);
      table.game = pruned === "abort" ? null : pruned.state;
    }
    for (const [inviteeId, invite] of table.substituteInvites) if (invite.fromSeatId === seat.id) table.substituteInvites.delete(inviteeId);
    table.version += 1;
    this.#appendEvent(table, "seat_vacated", seat, `${seat.name} 起身到觀戰區。`);
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
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
    if (table.phase === "in_round") throw new Error("目前牌局還沒結束。");
    if (table.phase === "game_over") throw new Error("這場已經結束，請開新桌。");
    const engine = this.#engine(table);
    const seated = seatedMembers(table);
    if (seated.length < engine.seats.min || seated.length > engine.seats.max) throw new Error(`${engine.label}需要 ${engine.seats.min} 到 ${engine.seats.max} 位入座的玩家才能開始。`);
    const round = table.round + 1;
    const deck = this.#deckFactory(round, seated.length).map((card) => typeof card === "string" ? parseCard(card) : card);
    const dealt = engine.deal({ deck, seatIds: seated.map((seat) => seat.id), round }, table.options);
    table.round = round;
    table.game = dealt.state;
    table.phase = "in_round";
    table.version += 1;
    this.#appendEvent(table, "round_started", null, `第 ${table.round} 局開始。`);
    this.#applyTransition(table, dealt);
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
    const boundedTimeout = Math.max(0, Math.min(timeoutMs, MAX_WAIT_MS));
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
    const engine = this.#engine(table);
    if (table.phase !== "in_round" || table.game === null || !engine.pendingSeatIds(table.game).includes(seat.id)) throw new Error("現在不是你的回合。");
    this.#applyTransition(table, engine.apply(table.game, seat.id, { action, cards: normalizedCards }, table.options));
    table.version += 1;
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  #engine(table: Table): GameEngine<unknown, unknown> {
    return engineFor(table.mode);
  }

  /** 把引擎的轉換結果寫回牌桌：狀態、事件、以及有結果時的分數與局結束。 */
  #applyTransition(table: Table, transition: EngineTransition<unknown>): void {
    const engine = this.#engine(table);
    table.game = transition.state;
    for (const event of transition.events) this.#appendEngineEvent(table, event);
    if (transition.result) {
      const { result } = transition;
      for (const [seatId, delta] of Object.entries(result.scoreDelta)) {
        const seat = table.seats.find((candidate) => candidate.id === seatId);
        if (seat) seat.gameScore += delta;
      }
      const winner = result.winnerSeatId ? table.seats.find((seat) => seat.id === result.winnerSeatId) ?? null : null;
      if (winner) winner.roundsWon += 1;
      const seated = seatedMembers(table);
      const scores = Object.fromEntries(seated.map((seat) => [seat.id, seat.gameScore]));
      const gameOver = result.gameOver || engine.isGameOver(table.options, { round: table.round, scores });
      table.phase = gameOver ? "game_over" : "ended";
      this.#appendEvent(table, "round_ended", winner, fillEventText(result.text, winner?.name ?? null, table.round));
      if (gameOver) {
        const champion = [...seated].sort((left, right) => right.gameScore - left.gameScore)[0] ?? null;
        this.#appendEvent(table, "game_over", champion, champion ? `整場結束，${champion.name} 以 ${champion.gameScore} 分獲勝。` : "整場結束。");
      }
      return;
    }
    // 沒有結果卻沒人可以行動：本局無結果地結束（例如玩家不足）。
    if (table.phase === "in_round" && engine.pendingSeatIds(transition.state).length === 0) table.phase = "ended";
  }

  #appendEngineEvent(table: Table, event: EngineEvent): void {
    const seat = event.seatId ? table.seats.find((candidate) => candidate.id === event.seatId) ?? null : null;
    this.#appendEvent(table, event.kind, seat, fillEventText(event.text, seat?.name ?? null, table.round));
  }

  #say(table: Table, seat: Seat, text: string, idempotencyKey: string): PublicTableView {
    const normalized = text.trim().slice(0, 500);
    if (!normalized) throw new Error("台詞不能是空白。");
    const operation = `say:${normalized}`;
    const replay = this.#replay<PublicTableView>(table, seat.id, idempotencyKey, operation);
    if (replay) return replay;
    const event = this.#appendEvent(table, "message", seat, normalized);
    table.chat.push({ event_id: event.event_id, seat_id: seat.id, speaker: seat.name, speaker_kind: seat.kind, speaker_role: seat.seated ? "seated" : "spectator", text: normalized, at: event.at });
    if (table.chat.length > CHAT_CAP) table.chat.splice(0, table.chat.length - CHAT_CAP);
    const result = this.#remember(table, seat.id, idempotencyKey, operation, this.#view(table, seat.id));
    this.#flushWaiters(table);
    this.#persist();
    return result;
  }

  #removeAgentSeat(table: Table, seat: Seat, text: string, leaveResult: AgentLeaveResult): void {
    if (seat.kind !== "agent") throw new Error("只能移除 Agent 玩家。");
    this.#removeSeat(table, seat, text, leaveResult);
  }

  /** 把任一成員移出牌桌：撤銷憑證、清座位相關狀態，正在進行的局視情況結束或輪到下一位。 */
  #removeSeat(table: Table, seat: Seat, text: string, leaveResult: AgentLeaveResult | null): void {
    const seatIndex = table.seats.indexOf(seat);
    if (seatIndex < 0) throw new Error("找不到這個座位。");
    const wasSeated = seat.seated;
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
      if (leaveResult) this.#rememberDepartedToken(tokenHash, leaveResult);
    }
    if (seat.humanTokenHash) this.#humanTokens.delete(seat.humanTokenHash);
    for (const [code, ticket] of table.reconnectTickets) if (ticket.seatId === seat.id) table.reconnectTickets.delete(code);
    for (const [inviteeId, invite] of table.substituteInvites) if (inviteeId === seat.id || invite.fromSeatId === seat.id) table.substituteInvites.delete(inviteeId);
    if (seat.principalId) this.#principalSeats.delete(principalBindingKey(seat.principalId, seat.name));
    for (const key of table.receipts.keys()) if (key.startsWith(`${seat.id}:`)) table.receipts.delete(key);
    table.seats.splice(seatIndex, 1);
    this.#appendEvent(table, "seat_left", seat, text);
    if (table.phase === "in_round" && wasSeated && table.game !== null) {
      const transition = this.#engine(table).onSeatRemoved(table.game, seat.id, table.options);
      if (transition === "abort") {
        table.phase = "ended";
        table.game = null;
        this.#appendEvent(table, "round_ended", null, `${seat.name} 離桌，本局流局不計分。`);
      } else this.#applyTransition(table, transition);
    }
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

  #view(table: Table, viewerSeatId: string): PublicTableView {
    const viewer = this.#requireSeat(table, viewerSeatId);
    const engine = this.#engine(table);
    const seated = seatedMembers(table);
    const inRound = table.phase === "in_round" && table.game !== null;
    const state = table.game;
    const pending = inRound ? [...engine.pendingSeatIds(state)] : [];
    const legalActions: PublicAction[] = inRound && viewer.seated ? engine.legalActions(state, viewer.id, table.options).map((action) => action.action) : [];
    if (!inRound && table.phase !== "game_over") {
      if (viewer.id === table.ownerSeatId) legalActions.push("start_round");
      if (viewer.seated) legalActions.push("leave_seat");
      else if (seated.length < engine.seats.max) legalActions.push("take_seat");
    }
    const invite = viewer.seated ? null : this.#validSubstituteInvite(table, viewer.id);
    if (invite) legalActions.push("accept_substitute");
    if (viewer.seated && table.phase !== "game_over" && table.seats.some((seat) => !seat.seated)) legalActions.push("invite_substitute");
    const inviter = invite ? this.#requireSeat(table, invite.fromSeatId) : null;
    const legalPlays = viewer.seated && inRound && pending.includes(viewer.id)
      ? engine.legalPlays(state, viewer.id, table.options).map((play) => ({ cards: [...play.cards], hand_type: play.label }))
      : [];
    const board = state !== null ? engine.view(state, viewer.id, table.options) : { phase: "idle" };
    const seatStatus = (board.seat_status ?? {}) as Record<string, SeatStatus>;
    const hand = state !== null && viewer.seated ? [...engine.hand(state, viewer.id)] : [];
    const rawPile = (board.pile ?? {}) as { cards?: readonly string[]; hand_type?: string | null; played_by_seat_id?: string | null };
    const pileSeat = rawPile.played_by_seat_id ? table.seats.find((seat) => seat.id === rawPile.played_by_seat_id) ?? null : null;
    return {
      table_id: table.id, join_code: table.joinCode, mode: table.mode, rule_label: engine.label, rules_version: engine.rulesVersion,
      rule_options: table.options as Readonly<Record<string, unknown>>, phase: table.phase,
      version: table.version, round: table.round, viewer_seat_id: viewerSeatId, viewer_role: viewer.seated ? "seated" : "spectator", viewer_is_owner: viewer.id === table.ownerSeatId,
      owner_name: this.#requireSeat(table, table.ownerSeatId).name, active_seat_id: pending[0] ?? null, pending_seat_ids: pending,
      players: seated.map((seat) => ({
        seat_id: seat.id, name: seat.name, kind: seat.kind, cards: seat.id === viewerSeatId ? [...hand] : [],
        hand_count: state !== null ? engine.hand(state, seat.id).length : 0, game_score: seat.gameScore, rounds_won: seat.roundsWon,
        status: seatStatus[seat.id] ?? "waiting", is_you: seat.id === viewerSeatId,
      })),
      spectators: table.seats.filter((seat) => !seat.seated).map((seat) => ({ seat_id: seat.id, name: seat.name, kind: seat.kind, is_you: seat.id === viewerSeatId })),
      substitute_invite: inviter ? { from_seat_id: inviter.id, from_name: inviter.name } : null,
      hand, board,
      pile: {
        cards: [...(rawPile.cards ?? [])], hand_type: rawPile.hand_type ?? null,
        played_by_seat_id: pileSeat?.id ?? null, played_by_name: pileSeat?.name ?? null,
      },
      set_aside_cards: [...((board.set_aside_cards as readonly string[] | undefined) ?? [])], legal_actions: legalActions, legal_plays: legalPlays,
      recent_chat: table.chat.slice(-20).map((message) => ({ ...message })), last_event_id: table.nextEventId - 1,
    };
  }

  #managedSummary(table: Table): ManagedTableSummary {
    const engine = this.#engine(table);
    const pendingSeatId = table.phase === "in_round" && table.game !== null ? engine.pendingSeatIds(table.game)[0] ?? null : null;
    const activeSeat = pendingSeatId ? table.seats.find((seat) => seat.id === pendingSeatId) ?? null : null;
    const createdAt = table.events[0]?.at ?? new Date(0).toISOString();
    return {
      table_id: table.id, join_code: table.joinCode, mode: table.mode, rule_label: engine.label, phase: table.phase,
      round: table.round, version: table.version, player_count: seatedMembers(table).length, spectator_count: table.seats.filter((seat) => !seat.seated).length, max_seats: engine.seats.max,
      human_name: this.#requireSeat(table, table.ownerSeatId).name, active_player_name: activeSeat?.name ?? null,
      players: seatedMembers(table).map((seat) => ({ name: seat.name, kind: seat.kind })), created_at: createdAt,
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

  #assertMemberAvailable(table: Table): void {
    if (table.seats.length >= MAX_MEMBERS) throw new Error(`這張牌桌最多 ${MAX_MEMBERS} 人（含觀戰）。`);
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
      format: "agent-game-table-big-two-store", version: 2,
      tables: [...this.#tables.values()].map((table) => ({
        id: table.id, joinCode: table.joinCode, ownerSeatId: table.ownerSeatId, mode: table.mode, options: table.options, nextSeatIndex: table.nextSeatIndex, phase: table.phase, version: table.version,
        round: table.round, game: table.game === null ? null : this.#engine(table).serialize(table.game),
        seats: table.seats.map((seat) => ({
          id: seat.id, kind: seat.kind, name: seat.name, seated: seat.seated, seatIndex: seat.seatIndex,
          gameScore: seat.gameScore, roundsWon: seat.roundsWon, humanTokenHash: seat.humanTokenHash, principalId: seat.principalId, lastClientId: seat.lastClientId,
        })),
        agentSessions: [...table.agentSessions.values()].map((session) => ({ ...session })), events: table.events, chat: table.chat,
        nextEventId: table.nextEventId, receipts: [...table.receipts.entries()], reconnectTickets: [...table.reconnectTickets.entries()],
      })),
      departedAgentTokens: [...this.#departedAgentTokens.entries()],
    });
  }

  #restore(value: unknown): void {
    const snapshot = value as { format?: unknown; version?: unknown; tables?: unknown[]; departedAgentTokens?: [string, AgentLeaveResult][] };
    if (snapshot.format !== "agent-game-table-big-two-store" || (snapshot.version !== 1 && snapshot.version !== 2) || !Array.isArray(snapshot.tables)) {
      throw new Error("Agent Game Table 持久化檔案格式無效或版本不支援。");
    }
    for (const raw of snapshot.tables) {
      const saved = raw as Record<string, unknown>;
      if (typeof saved.id !== "string" || typeof saved.joinCode !== "string" || typeof saved.ownerSeatId !== "string") throw new Error("Agent Game Table 持久化牌桌資料不完整。");
      if (!Array.isArray(saved.seats) || !Array.isArray(saved.agentSessions)) throw new Error("Agent Game Table 持久化座位資料不完整。");
      const mode = typeof saved.mode === "string" ? saved.mode : DEFAULT_GAME_MODE;
      const engine = engineFor(mode);
      // 舊快照沒有 seated 欄位：當時所有成員都是入座者，座位順序就是陣列順序。
      const seats = (saved.seats as Array<Record<string, unknown>>).map((seat, index): Seat => ({
        id: String(seat.id), kind: seat.kind as SeatKind, name: String(seat.name),
        seated: typeof seat.seated === "boolean" ? seat.seated : true,
        seatIndex: typeof seat.seatIndex === "number" ? seat.seatIndex : typeof seat.seated === "boolean" && !seat.seated ? null : index,
        gameScore: Number(seat.gameScore ?? 0), roundsWon: Number(seat.roundsWon ?? 0),
        humanTokenHash: typeof seat.humanTokenHash === "string" ? seat.humanTokenHash : null,
        ...restoreSeatIdentity(seat.principalId, seat.lastClientId),
      }));
      if (!seats.some((seat) => seat.id === saved.ownerSeatId && seat.kind === "human")) throw new Error("Agent Game Table 開桌者資料無效。");
      const phase = restoreTablePhase(saved.phase);
      const game = snapshot.version === 1
        ? migrateBigTwoV1(saved, seats, phase)
        : saved.game === null || saved.game === undefined ? null : engine.restore(saved.game);
      const table: Table = {
        id: saved.id, joinCode: saved.joinCode, ownerSeatId: saved.ownerSeatId, mode, options: engine.normalizeOptions(saved.options),
        nextSeatIndex: typeof saved.nextSeatIndex === "number" ? saved.nextSeatIndex : seats.length, phase,
        version: Number(saved.version), round: Number(saved.round), game,
        seats, agentSessions: new Map((saved.agentSessions as AgentSession[]).map((session) => [session.tokenHash, { ...session }])),
        events: structuredClone((saved.events ?? []) as TableEvent[]), chat: structuredClone((saved.chat ?? []) as PublicChatMessage[]),
        nextEventId: Number(saved.nextEventId), receipts: new Map(structuredClone((saved.receipts ?? []) as [string, Receipt<unknown>][])),
        waiters: new Map(), reconnectTickets: new Map(((saved.reconnectTickets ?? []) as [string, ReconnectTicket][]).filter(([, ticket]) => ticket.expiresAtMs > Date.now())),
        substituteInvites: new Map(),
      };
      this.#tables.set(table.id, table);
      this.#joinCodes.set(table.joinCode, table.id);
      for (const seat of table.seats) {
        if (seat.humanTokenHash) this.#humanTokens.set(seat.humanTokenHash, { tableId: table.id, seatId: seat.id });
        if (seat.principalId) this.#principalSeats.set(principalBindingKey(seat.principalId, seat.name), { tableId: table.id, seatId: seat.id });
      }
      for (const [tokenHash] of table.agentSessions) this.#agentTokens.set(tokenHash, table.id);
    }
    for (const [tokenHash, departure] of snapshot.departedAgentTokens ?? []) this.#departedAgentTokens.set(tokenHash, structuredClone(departure));
  }
}

function restoreTablePhase(value: unknown): TablePhase {
  if (value === "player_turns") return "in_round";
  if (value === "lobby" || value === "in_round" || value === "ended" || value === "game_over") return value;
  throw new Error("Agent Game Table 持久化牌桌階段無效。");
}

/**
 * 版本 1 快照把大老二的局狀態攤在牌桌與座位欄位裡；組回引擎狀態。
 * 沒開過局（round 0 或沒人有牌）就回 null。
 */
function migrateBigTwoV1(saved: Record<string, unknown>, seats: readonly Seat[], phase: TablePhase): BigTwoState | null {
  const rawSeats = saved.seats as Array<Record<string, unknown>>;
  const seated = seats.filter((seat) => seat.seated);
  const hasCards = rawSeats.some((seat) => Array.isArray(seat.cards) && seat.cards.length > 0);
  if (!hasCards && phase !== "in_round") return null;
  const hands: Record<string, readonly string[]> = {};
  const status: Record<string, string> = {};
  for (const raw of rawSeats) {
    const id = String(raw.id);
    if (!seated.some((seat) => seat.id === id)) continue;
    hands[id] = Array.isArray(raw.cards) ? raw.cards.map(String) : [];
    status[id] = typeof raw.status === "string" ? raw.status : "waiting";
  }
  const passed = Array.isArray(saved.passedSeatIds) ? saved.passedSeatIds.map(String) : [];
  for (const id of passed) if (id in status) status[id] = "passed";
  const currentPlay = saved.currentPlay as { cards?: unknown[] } | null | undefined;
  const openingRequiredCard = typeof saved.openingRequiredCard === "string" ? saved.openingRequiredCard : null;
  return bigTwoEngine.restore({
    phase: phase !== "in_round" ? "ended" : openingRequiredCard ? "opening" : "trick",
    order: seated.map((seat) => seat.id),
    hands, status,
    currentPlay: currentPlay?.cards ? currentPlay.cards.map(String) : null,
    currentPlaySeatId: typeof saved.currentPlaySeatId === "string" ? saved.currentPlaySeatId : null,
    openingRequiredCard,
    setAside: Array.isArray(saved.setAsideCards) ? saved.setAsideCards.map(String) : [],
    active: phase === "in_round" && typeof saved.activeSeatId === "string" ? saved.activeSeatId : null,
  });
}

/** 入座者依入座順序排列；觀戰者不在牌局輪轉裡。 */
function seatedMembers(table: Table): Seat[] {
  return table.seats.filter((seat) => seat.seated).sort((left, right) => (left.seatIndex ?? 0) - (right.seatIndex ?? 0));
}

function capabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

function capabilityHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function joinCodeHint(joinCode: string): string {
  if (joinCode.length < 3) return "•".repeat(joinCode.length);
  return `${joinCode[0]}${"•".repeat(joinCode.length - 2)}${joinCode.at(-1)}`;
}

function principalBindingKey(principalId: string, seatName: string): string {
  return `${principalId}\u0000${seatName}`;
}

/**
 * 舊快照的會員身分是 `member:<email>:<client_id>`；client_id 每次重新登入都會換，
 * 所以身分只留 email，client_id 降級成座位的 lastClientId。
 */
function restoreSeatIdentity(principalId: unknown, lastClientId: unknown): Pick<Seat, "principalId" | "lastClientId"> {
  const savedClientId = typeof lastClientId === "string" ? lastClientId : null;
  if (typeof principalId !== "string") return { principalId: null, lastClientId: savedClientId };
  const legacy = principalId.match(/^(member:[^:]+):(.+)$/);
  if (!legacy) return { principalId, lastClientId: savedClientId };
  return { principalId: legacy[1]!, lastClientId: savedClientId ?? legacy[2]! };
}

function normalizePrincipal(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) throw new Error("遠端 MCP 身分無效。");
  return normalized;
}

/** 大老二規則選項的正規化；保留給 HTTP 層與測試沿用，實作在引擎裡。 */
export function normalizeRuleOptions(value: unknown): BigTwoRuleOptions {
  return bigTwoEngine.normalizeOptions(value);
}

function fillEventText(text: string, name: string | null, round: number): string {
  return text.replaceAll("{name}", name ?? "").replaceAll("{round}", String(round)).replace(/^\s+/, "");
}

function chineseCount(value: number): string {
  return ["零", "一", "兩", "三", "四", "五", "六", "七", "八"][value] ?? String(value);
}

function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 80);
  return normalized || fallback;
}
