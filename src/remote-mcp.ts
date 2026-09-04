import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { AgentGameTableAgentHost } from "./host-client.js";
import { createAgentGameTableMcpServer } from "./mcp-server.js";
import type {
  AgentEventResult,
  AgentJoinResult,
  AgentLeaveResult,
  MultiplayerTableStore,
  PublicTableView,
  TurnAction,
} from "./multiplayer-store.js";
import type { RemoteAuthenticator, RemotePrincipal } from "./remote-auth.js";

interface RemoteSession {
  readonly principalId: string;
  readonly transport: StreamableHTTPServerTransport;
  readonly server: McpServer;
}

export interface RemoteOAuthEndpoints {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

export interface RemoteMcpGatewayOptions {
  readonly store: MultiplayerTableStore;
  readonly authenticator: RemoteAuthenticator;
  /** Host 自帶的 OAuth Authorization Server；有設定時 /oauth/* 與 AS metadata 由它處理。 */
  readonly oauth?: RemoteOAuthEndpoints;
  readonly publicUrl: string;
  readonly allowedOrigins?: string[];
  readonly allowedHosts?: string[];
  /** 營運管理密碼：列出與關閉牌桌（/api/admin/*）專用。 */
  readonly humanAccessKey: string;
  /** 開桌通關密語：和 OAuth 登入共用同一組；沒設定時，開桌欄位填營運管理密碼也可以。 */
  readonly createPassphrase?: string;
}

export class RemoteMcpGateway {
  readonly #store: MultiplayerTableStore;
  readonly #authenticator: RemoteAuthenticator;
  readonly #publicUrl: URL;
  readonly #mcpUrl: URL;
  readonly #metadataUrl: URL;
  readonly #allowedOrigins: Set<string>;
  readonly #allowedHosts: Set<string>;
  readonly #humanAccessKeyHash: Buffer;
  readonly #createPassphraseHash: Buffer | null;
  readonly #oauth: RemoteOAuthEndpoints | null;
  readonly #sessions = new Map<string, RemoteSession>();

  constructor(options: RemoteMcpGatewayOptions) {
    this.#store = options.store;
    this.#authenticator = options.authenticator;
    this.#publicUrl = new URL(options.publicUrl);
    if (!['https:', 'http:'].includes(this.#publicUrl.protocol)) throw new Error("AGENT_GAME_TABLE_PUBLIC_URL 必須是 HTTP 或 HTTPS URL。");
    this.#mcpUrl = new URL("/mcp", this.#publicUrl);
    this.#metadataUrl = new URL("/.well-known/oauth-protected-resource", this.#publicUrl);
    this.#allowedOrigins = new Set([this.#publicUrl.origin, ...(options.allowedOrigins ?? [])]);
    this.#allowedHosts = new Set([this.#publicUrl.host.toLowerCase(), ...(options.allowedHosts ?? []).map((host) => host.toLowerCase())]);
    if (options.humanAccessKey.trim().length < 32) throw new Error("AGENT_GAME_TABLE_HUMAN_ACCESS_KEY 至少需要 32 個字元。");
    this.#humanAccessKeyHash = hashSecret(options.humanAccessKey.trim());
    this.#createPassphraseHash = options.createPassphrase?.trim() ? hashSecret(options.createPassphrase.trim()) : null;
    this.#oauth = options.oauth ?? null;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", this.#publicUrl);
    if (this.#oauth && (url.pathname.startsWith("/oauth/") || url.pathname === "/.well-known/oauth-authorization-server")) {
      if (!this.#validHost(request)) {
        sendJson(response, 403, { error: "untrusted_host" });
        return true;
      }
      return this.#oauth.handle(request, response);
    }
    if (request.method === "GET" && url.pathname === "/api/remote-config") {
      sendJson(response, 200, { remote: true, create_passphrase_required: true, table_management: true });
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/remote-health") {
      sendJson(response, 200, {
        ok: true,
        service: "agent-game-table-remote-mcp",
        transport: "streamable-http",
        auth: this.#authenticator.authorizationServers.length ? "oauth" : "bearer",
        persistence: "encrypted-file",
      });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/tables") {
      if (!this.#adminKeyMatches(request) && !this.#createPassphraseMatches(request)) {
        sendJson(response, 401, { error: "通關密語不對，開桌前先向站長拿。" });
        return true;
      }
      return false;
    }
    if (url.pathname.startsWith("/api/admin/")) {
      if (!this.#adminKeyMatches(request)) {
        sendJson(response, 401, { error: "營運管理密碼不正確。" });
        return true;
      }
      return false;
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp")
    ) {
      if (!this.#authenticator.authorizationServers.length) {
        sendJson(response, 404, { error: "Static bearer mode does not provide OAuth metadata." });
        return true;
      }
      sendJson(response, 200, {
        resource: this.#mcpUrl.toString(),
        authorization_servers: this.#authenticator.authorizationServers,
        scopes_supported: [this.#authenticator.requiredScope],
        bearer_methods_supported: ["header"],
        resource_documentation: new URL("/", this.#publicUrl).toString(),
      });
      return true;
    }
    if (url.pathname !== "/mcp") return false;

    if (!this.#validHost(request) || !this.#validOrigin(request)) {
      sendRpcError(response, 403, -32003, "Untrusted Host or Origin header.");
      return true;
    }
    const contentLength = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
      sendRpcError(response, 413, -32013, "MCP request body is too large.");
      return true;
    }
    const bearer = bearerToken(request);
    const principal = bearer ? await this.#authenticator.authenticate(bearer) : null;
    if (!principal) {
      response.setHeader("WWW-Authenticate", this.#challenge());
      sendRpcError(response, 401, -32001, "Authentication required.");
      return true;
    }
    const sessionId = singleHeader(request.headers["mcp-session-id"]);
    if (sessionId) {
      const session = this.#sessions.get(sessionId);
      if (!session) {
        sendRpcError(response, 404, -32004, "Unknown or expired MCP session.");
        return true;
      }
      if (session.principalId !== principal.id) {
        sendRpcError(response, 403, -32003, "This MCP session belongs to another authenticated caller.");
        return true;
      }
      attachAuth(request, bearer!, principal, this.#mcpUrl);
      await session.transport.handleRequest(request as IncomingMessage & { auth?: AuthInfo }, response);
      return true;
    }
    if (request.method !== "POST") {
      sendRpcError(response, 400, -32000, "Initialize an MCP session with POST before using GET or DELETE.");
      return true;
    }

    let initializedSessionId: string | null = null;
    let record: RemoteSession;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        initializedSessionId = id;
        this.#sessions.set(id, record);
      },
      onsessionclosed: async (id) => {
        const closed = this.#sessions.get(id);
        this.#sessions.delete(id);
        if (closed) await closed.server.close();
      },
    });
    const server = createAgentGameTableMcpServer(new PrincipalStoreHost(this.#store, principal));
    record = { principalId: principal.id, transport, server };
    transport.onclose = () => {
      if (initializedSessionId) this.#sessions.delete(initializedSessionId);
    };
    // SDK 1.30's Node wrapper and shared Transport declarations disagree under
    // exactOptionalPropertyTypes even though the runtime class implements Transport.
    await server.connect(transport as unknown as Transport);
    attachAuth(request, bearer!, principal, this.#mcpUrl);
    try {
      await transport.handleRequest(request as IncomingMessage & { auth?: AuthInfo }, response);
    } finally {
      if (!initializedSessionId) {
        await transport.close();
        await server.close();
      }
    }
    return true;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.flatMap((session) => [session.transport.close(), session.server.close()]));
  }

  #challenge(): string {
    const scope = this.#authenticator.requiredScope.replace(/["\\]/g, "");
    if (this.#authenticator.authorizationServers.length) {
      return `Bearer resource_metadata="${this.#metadataUrl}", scope="${scope}"`;
    }
    return `Bearer realm="agent-game-table", scope="${scope}"`;
  }

  #adminKeyMatches(request: IncomingMessage): boolean {
    const key = singleHeader(request.headers["x-agent-game-table-human-key"]);
    return Boolean(key) && safeSecretEqual(key!, this.#humanAccessKeyHash);
  }

  #createPassphraseMatches(request: IncomingMessage): boolean {
    const passphrase = singleHeader(request.headers["x-agent-game-table-passphrase"]);
    if (!passphrase) return false;
    return safeSecretEqual(passphrase, this.#createPassphraseHash ?? this.#humanAccessKeyHash);
  }

  #validHost(request: IncomingMessage): boolean {
    const host = request.headers.host?.trim().toLowerCase();
    return Boolean(host && this.#allowedHosts.has(host));
  }

  #validOrigin(request: IncomingMessage): boolean {
    const origin = singleHeader(request.headers.origin);
    if (!origin) return true;
    try {
      return this.#allowedOrigins.has(new URL(origin).origin);
    } catch {
      return false;
    }
  }
}

class PrincipalStoreHost implements AgentGameTableAgentHost {
  readonly #store: MultiplayerTableStore;
  readonly #principalId: string;
  readonly #clientId: string;

  constructor(store: MultiplayerTableStore, principal: RemotePrincipal) {
    this.#store = store;
    this.#principalId = principal.id;
    this.#clientId = principal.clientId;
  }

  async joinAgent(joinCode: string, agentName: string): Promise<AgentJoinResult> {
    return this.#store.joinAgentForPrincipal(joinCode, agentName, this.#principalId, this.#clientId);
  }

  async rejoinAgent(joinCode: string, agentName: string, reconnectCode: string): Promise<AgentJoinResult> {
    return this.#store.rejoinAgentForPrincipal(joinCode, agentName, reconnectCode, this.#principalId, this.#clientId);
  }

  async getAgentView(agentToken: string): Promise<PublicTableView> {
    return this.#store.getAgentView(agentToken);
  }

  async leaveAgent(agentToken: string): Promise<AgentLeaveResult> {
    return this.#store.leaveAgent(agentToken);
  }

  async agentAction(
    agentToken: string,
    action: TurnAction,
    expectedVersion: number,
    idempotencyKey: string,
    cards: readonly string[] = [],
  ): Promise<PublicTableView> {
    return this.#store.agentAction(agentToken, action, expectedVersion, idempotencyKey, cards);
  }

  async agentSay(agentToken: string, message: string, idempotencyKey: string): Promise<PublicTableView> {
    return this.#store.agentSay(agentToken, message, idempotencyKey);
  }

  async takeSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView> {
    return this.#store.agentTakeSeat(agentToken, expectedVersion, idempotencyKey);
  }

  async leaveSeat(agentToken: string, expectedVersion: number, idempotencyKey: string): Promise<PublicTableView> {
    return this.#store.agentLeaveSeat(agentToken, expectedVersion, idempotencyKey);
  }

  async waitForEvents(agentToken: string, timeoutMs: number): Promise<AgentEventResult> {
    return this.#store.waitForAgentEvents(agentToken, timeoutMs);
  }

  async resumeAgent(): Promise<AgentJoinResult | null> {
    return this.#store.resumeAgentForPrincipal(this.#principalId, this.#clientId);
  }
}

function attachAuth(request: IncomingMessage & { auth?: AuthInfo }, token: string, principal: RemotePrincipal, resource: URL): void {
  request.auth = {
    token,
    clientId: principal.clientId,
    scopes: principal.scopes,
    ...(principal.expiresAt ? { expiresAt: principal.expiresAt } : {}),
    resource,
    extra: { principal_id: principal.id },
  };
}

function bearerToken(request: IncomingMessage): string | null {
  const authorization = singleHeader(request.headers.authorization);
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0]! : null;
  return value?.trim() || null;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function sendRpcError(response: ServerResponse, status: number, code: number, message: string): void {
  sendJson(response, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeSecretEqual(value: string, expectedHash: Buffer): boolean {
  return timingSafeEqual(hashSecret(value), expectedHash);
}
