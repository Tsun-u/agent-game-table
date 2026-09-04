import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { clientAddress } from "./client-address.js";
import { MultiplayerTableStore, normalizeRuleOptions, type TurnAction } from "./multiplayer-store.js";

export interface AgentGameTableHostOptions {
  readonly hostname?: string;
  readonly port?: number;
  readonly store?: MultiplayerTableStore;
  readonly webRoot?: string;
  readonly extension?: AgentGameTableHostExtension;
}

export interface AgentGameTableHostExtension {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

export interface RunningAgentGameTableHost {
  readonly hostname: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

const DEFAULT_WEB_ROOT = fileURLToPath(new URL("../../web/", import.meta.url));
const BODY_LIMIT = 64 * 1024;
const JOIN_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const JOIN_THROTTLE_MAX_FAILURES = 5;

/** 大廳露出邀請碼首尾後，剩下的字元可以猜；同一來源連續猜錯就冷卻。 */
class JoinCodeThrottle {
  readonly #failures = new Map<string, { count: number; resetAt: number }>();

  assertAllowed(source: string): void {
    const record = this.#failures.get(source);
    if (record && record.resetAt > Date.now() && record.count >= JOIN_THROTTLE_MAX_FAILURES) {
      throw new Error("邀請碼猜錯太多次，請 10 分鐘後再試。");
    }
  }

  recordFailure(source: string): void {
    const now = Date.now();
    const record = this.#failures.get(source);
    if (!record || record.resetAt <= now) this.#failures.set(source, { count: 1, resetAt: now + JOIN_THROTTLE_WINDOW_MS });
    else record.count += 1;
    if (this.#failures.size > 10_000) {
      for (const [key, value] of this.#failures) if (value.resetAt <= now) this.#failures.delete(key);
    }
  }
}

export async function startAgentGameTableHost(options: AgentGameTableHostOptions = {}): Promise<RunningAgentGameTableHost> {
  const hostname = options.hostname ?? "127.0.0.1";
  const store = options.store ?? new MultiplayerTableStore();
  const webRoot = options.webRoot ?? DEFAULT_WEB_ROOT;
  const joinThrottle = new JoinCodeThrottle();
  const server = createServer((request, response) => {
    void routeRequest(store, webRoot, options.extension, joinThrottle, request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : "牌桌主機發生未知錯誤。";
      const status = message.includes("再試") ? 429 : message.includes("憑證") ? 401 : message.includes("找不到") ? 404 : 400;
      sendJson(response, status, { error: message });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 3210, hostname, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    hostname,
    port: address.port,
    url: `http://${hostname}:${address.port}`,
    // 瀏覽器與 fetch 的 keep-alive 連線會讓 server.close() 永遠等不到，所以一併關掉所有連線。
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    }),
  };
}

async function routeRequest(
  store: MultiplayerTableStore,
  webRoot: string,
  extension: AgentGameTableHostExtension | undefined,
  joinThrottle: JoinCodeThrottle,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (extension && (await extension.handle(request, response))) return;

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "agent-game-table-host", version: "0.1.0" });
    return;
  }
  if (method === "POST" && url.pathname === "/api/tables") {
    const body = await readJsonBody(request);
    const humanName = requireString(body.human_name, "human_name");
    sendJson(response, 201, store.createTable(humanName, normalizeRuleOptions(body.options)));
    return;
  }
  if (method === "GET" && url.pathname === "/api/lobby") {
    sendJson(response, 200, { tables: store.listLobby() });
    return;
  }
  if (method === "POST" && url.pathname === "/api/human/join") {
    const source = clientAddress(request);
    joinThrottle.assertAllowed(source);
    const body = await readJsonBody(request);
    const joinCode = requireString(body.join_code, "join_code");
    const humanName = requireString(body.human_name, "human_name");
    try {
      sendJson(response, 200, store.joinHuman(joinCode, humanName));
    } catch (error) {
      if (error instanceof Error && error.message.includes("找不到這組邀請碼")) joinThrottle.recordFailure(source);
      throw error;
    }
    return;
  }
  if (method === "GET" && url.pathname === "/api/admin/tables") {
    sendJson(response, 200, { tables: store.listTables() });
    return;
  }
  const managedTableMatch = /^\/api\/admin\/tables\/([^/]+)$/.exec(url.pathname);
  if (method === "DELETE" && managedTableMatch) {
    sendJson(response, 200, store.closeTable(decodeURIComponent(managedTableMatch[1]!)));
    return;
  }

  if (url.pathname.startsWith("/api/human/")) {
    const token = bearerToken(request);
    if (method === "GET" && url.pathname === "/api/human/table") {
      sendJson(response, 200, { table: store.getHumanView(token) });
      return;
    }
    const body = await readJsonBody(request);
    if (method === "POST" && url.pathname === "/api/human/seat") {
      sendJson(response, 200, {
        table: store.humanTakeSeat(token, requirePositiveInteger(body.expected_version, "expected_version"), requireIdempotencyKey(body.idempotency_key)),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/unseat") {
      sendJson(response, 200, {
        table: store.humanLeaveSeat(token, requirePositiveInteger(body.expected_version, "expected_version"), requireIdempotencyKey(body.idempotency_key)),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/start-round") {
      sendJson(response, 200, {
        table: store.startRound(
          token,
          requirePositiveInteger(body.expected_version, "expected_version"),
          requireIdempotencyKey(body.idempotency_key),
        ),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/action") {
      sendJson(response, 200, {
        table: store.humanAction(
          token,
          requireAction(body.action),
          requirePositiveInteger(body.expected_version, "expected_version"),
          requireIdempotencyKey(body.idempotency_key),
          requireCardList(body.cards),
        ),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/say") {
      sendJson(response, 200, {
        table: store.humanSay(
          token,
          requireString(body.message, "message"),
          requireIdempotencyKey(body.idempotency_key),
        ),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/reconnect-code") {
      sendJson(response, 200, store.createAgentReconnectTicket(token, requireString(body.seat_id, "seat_id")));
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/leave") {
      sendJson(response, 200, store.leaveHuman(token));
      return;
    }
    if (method === "POST" && url.pathname === "/api/human/remove-agent") {
      sendJson(response, 200, {
        table: store.removeAgentSeat(
          token,
          requireString(body.seat_id, "seat_id"),
          requirePositiveInteger(body.expected_version, "expected_version"),
          requireIdempotencyKey(body.idempotency_key),
        ),
      });
      return;
    }
  }

  if (method === "POST" && url.pathname === "/api/agent/join") {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      store.joinAgent(requireString(body.join_code, "join_code"), requireString(body.agent_name, "agent_name")),
    );
    return;
  }
  if (method === "POST" && url.pathname === "/api/agent/rejoin") {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      store.rejoinAgent(
        requireString(body.join_code, "join_code"),
        requireString(body.agent_name, "agent_name"),
        requireString(body.reconnect_code, "reconnect_code"),
      ),
    );
    return;
  }
  if (url.pathname.startsWith("/api/agent/")) {
    const token = bearerToken(request);
    if (method === "GET" && url.pathname === "/api/agent/table") {
      sendJson(response, 200, { table: store.getAgentView(token) });
      return;
    }
    if (method === "POST" && url.pathname === "/api/agent/leave") {
      sendJson(response, 200, store.leaveAgent(token));
      return;
    }
    const body = await readJsonBody(request);
    if (method === "POST" && url.pathname === "/api/agent/seat") {
      sendJson(response, 200, {
        table: store.agentTakeSeat(token, requirePositiveInteger(body.expected_version, "expected_version"), requireIdempotencyKey(body.idempotency_key)),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/agent/unseat") {
      sendJson(response, 200, {
        table: store.agentLeaveSeat(token, requirePositiveInteger(body.expected_version, "expected_version"), requireIdempotencyKey(body.idempotency_key)),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/agent/action") {
      sendJson(response, 200, {
        table: store.agentAction(
          token,
          requireAction(body.action),
          requirePositiveInteger(body.expected_version, "expected_version"),
          requireIdempotencyKey(body.idempotency_key),
          requireCardList(body.cards),
        ),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/agent/say") {
      sendJson(response, 200, {
        table: store.agentSay(
          token,
          requireString(body.message, "message"),
          requireIdempotencyKey(body.idempotency_key),
        ),
      });
      return;
    }
    if (method === "POST" && url.pathname === "/api/agent/wait") {
      const timeoutMs = Math.min(requireNonNegativeInteger(body.timeout_ms, "timeout_ms"), 100_000);
      sendJson(response, 200, await store.waitForAgentEvents(token, timeoutMs));
      return;
    }
  }

  if (method === "GET") {
    const asset = staticAsset(url.pathname);
    if (asset) {
      const data = await readFile(new URL(asset, pathToDirectoryUrl(webRoot)));
      sendBytes(response, 200, data, contentType(asset));
      return;
    }
  }
  sendJson(response, 404, { error: "找不到這個路徑。" });
}

function staticAsset(pathname: string): string | null {
  if (pathname === "/" || pathname === "/index.html") return "index.html";
  if (pathname === "/app.js") return "app.js";
  if (pathname === "/connect" || pathname === "/connect.html") return "connect.html";
  if (pathname === "/connect.js") return "connect.js";
  const guideImage = /^\/guide\/([a-z0-9-]+\.webp)$/.exec(pathname);
  if (guideImage) return `guide/${guideImage[1]}`;
  if (pathname === "/styles.css") return "styles.css";
  if (pathname === "/vendor/lottie-light.min.js") return "vendor/lottie-light.min.js";
  if (pathname === "/animations/round-complete.json") return "animations/round-complete.json";
  return null;
}

function pathToDirectoryUrl(path: string): URL {
  const normalized = path.replaceAll("\\", "/").replace(/\/?$/, "/");
  return new URL(`file:///${normalized}`);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error("請求內容太大。");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("請求不是有效的 JSON 物件。");
  }
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length <= 7) throw new Error("座位憑證無效。");
  return authorization.slice(7);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 必須是非空白字串。`);
  return value;
}

function requireAction(value: unknown): TurnAction {
  if (value !== "play_cards" && value !== "pass") throw new Error("action 必須是 play_cards 或 pass。");
  return value;
}

function requireCardList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5 || value.some((card) => typeof card !== "string")) {
    throw new Error("cards 必須是最多 5 張牌的字串陣列。");
  }
  return value as string[];
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${field} 必須是正整數。`);
  return value;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${field} 必須是非負整數。`);
  return value;
}

function requireIdempotencyKey(value: unknown): string {
  const key = requireString(value, "idempotency_key");
  if (key.length < 8 || key.length > 120) throw new Error("idempotency_key 長度必須介於 8 到 120 字元。");
  return key;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const data = Buffer.from(JSON.stringify(value), "utf8");
  sendBytes(response, status, data, "application/json; charset=utf-8");
}

function sendBytes(response: ServerResponse, status: number, data: Uint8Array, type: string): void {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": data.byteLength,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(data);
}

function contentType(filename: string): string {
  const extension = extname(filename);
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".webp") return "image/webp";
  return "text/html; charset=utf-8";
}
