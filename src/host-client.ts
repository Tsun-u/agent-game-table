import type { AgentEventResult, AgentJoinResult, AgentLeaveResult, PublicTableView, TurnAction } from "./multiplayer-store.js";

export interface AgentGameTableAgentHost {
  joinAgent(joinCode: string, agentName: string): Promise<AgentJoinResult>;
  rejoinAgent(joinCode: string, agentName: string, reconnectCode: string): Promise<AgentJoinResult>;
  getAgentView(agentToken: string): Promise<PublicTableView>;
  leaveAgent(agentToken: string): Promise<AgentLeaveResult>;
  agentAction(
    agentToken: string,
    action: TurnAction,
    expectedVersion: number,
    idempotencyKey: string,
    cards?: readonly string[],
  ): Promise<PublicTableView>;
  agentSay(agentToken: string, message: string, idempotencyKey: string): Promise<PublicTableView>;
  takeSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView>;
  leaveSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView>;
  inviteSubstitute(agentToken: string, targetSeatId: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView>;
  acceptSubstitute(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView>;
  /** 有登入身分的 Host 可以在 server 沒有座位 token 時找回座位；STDIO 模式沒有這個能力。 */
  resumeAgent?(): Promise<AgentJoinResult | null>;
  waitForEvents(agentToken: string, timeoutMs: number): Promise<AgentEventResult>;
}

export class AgentGameTableHostClient implements AgentGameTableAgentHost {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl = process.env.AGENT_GAME_TABLE_HOST_URL ?? "http://127.0.0.1:3210", fetchImplementation: typeof fetch = fetch) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#fetch = fetchImplementation;
  }

  joinAgent(joinCode: string, agentName: string): Promise<AgentJoinResult> {
    return this.#request("/api/agent/join", {
      method: "POST",
      body: { join_code: joinCode, agent_name: agentName },
    });
  }

  rejoinAgent(joinCode: string, agentName: string, reconnectCode: string): Promise<AgentJoinResult> {
    return this.#request("/api/agent/rejoin", {
      method: "POST",
      body: { join_code: joinCode, agent_name: agentName, reconnect_code: reconnectCode },
    });
  }

  async getAgentView(agentToken: string): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/table", {
      method: "GET",
      token: agentToken,
    });
    return result.table;
  }

  leaveAgent(agentToken: string): Promise<AgentLeaveResult> {
    return this.#request("/api/agent/leave", {
      method: "POST",
      token: agentToken,
    });
  }

  async agentAction(
    agentToken: string,
    action: TurnAction,
    expectedVersion: number,
    idempotencyKey: string,
    cards: readonly string[] = [],
  ): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/action", {
      method: "POST",
      token: agentToken,
      body: { action, cards, expected_version: expectedVersion, idempotency_key: idempotencyKey },
    });
    return result.table;
  }

  async takeSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/seat", {
      method: "POST", token: agentToken, body: { expected_version: expectedVersion, idempotency_key: idempotencyKey },
    });
    return result.table;
  }

  async leaveSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/unseat", {
      method: "POST", token: agentToken, body: { expected_version: expectedVersion, idempotency_key: idempotencyKey },
    });
    return result.table;
  }

  async inviteSubstitute(agentToken: string, targetSeatId: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/invite-substitute", {
      method: "POST", token: agentToken, body: { seat_id: targetSeatId, expected_version: expectedVersion, idempotency_key: idempotencyKey },
    });
    return result.table;
  }

  async acceptSubstitute(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/accept-substitute", {
      method: "POST", token: agentToken, body: { expected_version: expectedVersion, idempotency_key: idempotencyKey },
    });
    return result.table;
  }

  async agentSay(agentToken: string, message: string, idempotencyKey: string): Promise<PublicTableView> {
    const result = await this.#request<{ table: PublicTableView }>("/api/agent/say", {
      method: "POST",
      token: agentToken,
      body: { message, idempotency_key: idempotencyKey },
    });
    return result.table;
  }

  waitForEvents(agentToken: string, timeoutMs: number): Promise<AgentEventResult> {
    return this.#request("/api/agent/wait", {
      method: "POST",
      token: agentToken,
      body: { timeout_ms: timeoutMs },
    });
  }

  async #request<T>(
    path: string,
    options: { readonly method: "GET" | "POST"; readonly token?: string; readonly body?: Record<string, unknown> },
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: options.method,
        headers,
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`無法連線到 Agent Game Table 牌桌主機（${this.#baseUrl}）：${detail}`);
    }
    const payload = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { error?: string } & T;
    if (!response.ok) throw new Error(payload.error ?? `牌桌主機回傳 HTTP ${response.status}。`);
    return payload;
  }
}
