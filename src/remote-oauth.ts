import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";

import type { RemoteAuthenticator, RemotePrincipal } from "./remote-auth.js";

/**
 * Host 自帶的小型 OAuth 2.1 Authorization Server：
 * 動態註冊（RFC 7591）、授權碼＋PKCE S256、refresh token 輪替。
 * 登入只有兩個欄位：名單裡的 email 與大家共用的通關密語。
 * 適用對象是 claude.ai／ChatGPT 的自訂 connector 與 Claude Code／Codex 的 OAuth 登入。
 */
export interface BuiltinOAuthOptions {
  readonly publicUrl: string;
  /** JSON 檔：{ "email": "顯示名稱" }，每次登入重新讀取，加人不用重啟。 */
  readonly membersFile: string;
  readonly passphrase: string;
  /** 動態註冊的 client 落地位置（公開 client，沒有秘密），重啟後 claude.ai 的 client_id 才仍有效。 */
  readonly clientsFile: string;
  readonly requiredScope?: string;
  readonly accessTokenTtlMs?: number;
  readonly refreshTokenTtlMs?: number;
  readonly now?: () => number;
}

interface RegisteredClient {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: string[];
  readonly client_id_issued_at: number;
}

interface PendingAuthorization {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string | null;
  readonly expiresAt: number;
}

interface IssuedCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly email: string;
  readonly expiresAt: number;
}

interface IssuedToken {
  readonly email: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

const MAX_CLIENTS = 200;
const PENDING_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const THROTTLE_MAX_FAILURES = 5;
const MAX_BODY_BYTES = 16 * 1024;

export class BuiltinOAuthServer implements RemoteAuthenticator {
  readonly authorizationServers: string[];
  readonly requiredScope: string;
  readonly #issuer: string;
  readonly #publicUrl: URL;
  readonly #membersFile: string;
  readonly #clientsFile: string;
  readonly #passphraseHash: Buffer;
  readonly #accessTtlMs: number;
  readonly #refreshTtlMs: number;
  readonly #now: () => number;
  readonly #clients = new Map<string, RegisteredClient>();
  readonly #pending = new Map<string, PendingAuthorization>();
  readonly #codes = new Map<string, IssuedCode>();
  readonly #accessTokens = new Map<string, IssuedToken>();
  readonly #refreshTokens = new Map<string, IssuedToken>();
  readonly #failures = new Map<string, { count: number; resetAt: number }>();

  private constructor(options: BuiltinOAuthOptions) {
    this.#publicUrl = new URL(options.publicUrl);
    this.#issuer = this.#publicUrl.origin;
    this.authorizationServers = [this.#issuer];
    this.requiredScope = options.requiredScope ?? "game-table:play";
    this.#membersFile = options.membersFile;
    this.#clientsFile = options.clientsFile;
    if (options.passphrase.trim().length < 8) throw new Error("AGENT_GAME_TABLE_LOGIN_PASSPHRASE 至少需要 8 個字元。");
    this.#passphraseHash = sha256(options.passphrase.trim());
    this.#accessTtlMs = options.accessTokenTtlMs ?? 8 * 60 * 60 * 1000;
    this.#refreshTtlMs = options.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.#now = options.now ?? Date.now;
  }

  static async create(options: BuiltinOAuthOptions): Promise<BuiltinOAuthServer> {
    const server = new BuiltinOAuthServer(options);
    await server.#readMembers();
    await server.#loadClients();
    return server;
  }

  async authenticate(token: string): Promise<RemotePrincipal | null> {
    this.#sweep();
    const issued = this.#accessTokens.get(hash(token));
    if (!issued || issued.expiresAt <= this.#now()) return null;
    return {
      id: `member:${issued.email}:${issued.clientId}`,
      clientId: issued.clientId,
      scopes: [this.requiredScope],
      expiresAt: Math.floor(issued.expiresAt / 1000),
    };
  }

  /** 回 true 表示這個請求屬於 OAuth 端點且已處理。 */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", this.#publicUrl);
    const method = request.method ?? "GET";
    if (method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      sendJson(response, 200, this.metadata());
      return true;
    }
    if (!url.pathname.startsWith("/oauth/")) return false;
    this.#sweep();
    if (method === "POST" && url.pathname === "/oauth/register") return this.#register(request, response);
    if (method === "GET" && url.pathname === "/oauth/authorize") return this.#authorizeForm(url, response);
    if (method === "POST" && url.pathname === "/oauth/authorize") return this.#authorizeSubmit(request, response);
    if (method === "POST" && url.pathname === "/oauth/token") return this.#token(request, response);
    sendJson(response, 404, { error: "not_found" });
    return true;
  }

  metadata(): Record<string, unknown> {
    return {
      issuer: this.#issuer,
      authorization_endpoint: `${this.#issuer}/oauth/authorize`,
      token_endpoint: `${this.#issuer}/oauth/token`,
      registration_endpoint: `${this.#issuer}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [this.requiredScope],
      service_documentation: `${this.#issuer}/`,
    };
  }

  async #register(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(request)) || "{}") as Record<string, unknown>;
    } catch {
      sendJson(response, 400, { error: "invalid_client_metadata", error_description: "註冊內容必須是 JSON。" });
      return true;
    }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
    if (!redirectUris.length || !redirectUris.every(isAcceptableRedirectUri)) {
      sendJson(response, 400, {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris 只接受 https 網址，或 localhost／127.0.0.1 的 http 回呼。",
      });
      return true;
    }
    const clientName = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 120) : "";
    const client: RegisteredClient = {
      client_id: randomBytes(16).toString("base64url"),
      client_name: clientName || "MCP client",
      redirect_uris: redirectUris,
      client_id_issued_at: Math.floor(this.#now() / 1000),
    };
    this.#clients.set(client.client_id, client);
    while (this.#clients.size > MAX_CLIENTS) {
      const oldest = this.#clients.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#clients.delete(oldest);
    }
    await this.#saveClients();
    sendJson(response, 201, {
      ...client,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    return true;
  }

  #authorizeForm(url: URL, response: ServerResponse): boolean {
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const client = this.#clients.get(clientId);
    if (!client || !redirectAllowed(client.redirect_uris, redirectUri)) {
      sendHtml(response, 400, this.#page("這個登入連結無效", "<p class=\"login-error\">client_id 或 redirect_uri 不在註冊名單裡。請回到 AI 那邊重新連線一次。</p>"));
      return true;
    }
    const state = url.searchParams.get("state");
    const problem = url.searchParams.get("response_type") !== "code"
      ? "unsupported_response_type"
      : url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")
        ? "invalid_request"
        : null;
    if (problem) {
      redirect(response, withParams(redirectUri, { error: problem, error_description: "需要 response_type=code 與 PKCE S256。", state }));
      return true;
    }
    const requestId = randomBytes(18).toString("base64url");
    this.#pending.set(requestId, {
      clientId,
      redirectUri,
      codeChallenge: url.searchParams.get("code_challenge")!,
      state,
      expiresAt: this.#now() + PENDING_TTL_MS,
    });
    sendHtml(response, 200, this.#page("登入牌桌", this.#loginForm(requestId, client.client_name, null)));
    return true;
  }

  async #authorizeSubmit(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const form = parseForm(await readBody(request));
    const requestId = form.get("request") ?? "";
    const pending = this.#pending.get(requestId);
    if (!pending || pending.expiresAt <= this.#now()) {
      this.#pending.delete(requestId);
      sendHtml(response, 400, this.#page("登入逾時", "<p class=\"login-error\">這個登入頁已經過期，請回到 AI 那邊重新連線一次。</p>"));
      return true;
    }
    const client = this.#clients.get(pending.clientId);
    const source = clientAddress(request);
    const email = (form.get("email") ?? "").trim().toLowerCase();
    const passphrase = form.get("passphrase") ?? "";
    const members = await this.#readMembers();
    const name = members.get(email);
    const passphraseOk = passphrase.length > 0 && timingSafeEqual(sha256(passphrase.trim()), this.#passphraseHash);
    if (this.#throttled(source) || !name || !passphraseOk) {
      this.#recordFailure(source);
      const message = this.#throttled(source)
        ? "嘗試太多次了，十分鐘後再試。"
        : "email 不在名單裡，或通關密語不對。";
      sendHtml(response, 200, this.#page("登入牌桌", this.#loginForm(requestId, client?.client_name ?? "MCP client", message)));
      return true;
    }
    this.#failures.delete(source);
    this.#pending.delete(requestId);
    const code = randomBytes(32).toString("base64url");
    this.#codes.set(hash(code), {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      email,
      expiresAt: this.#now() + CODE_TTL_MS,
    });
    redirect(response, withParams(pending.redirectUri, { code, state: pending.state }));
    return true;
  }

  async #token(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const form = parseForm(await readBody(request));
    const grantType = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    if (!this.#clients.has(clientId)) {
      sendJson(response, 401, { error: "invalid_client", error_description: "client_id 未註冊。" });
      return true;
    }
    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const issued = this.#codes.get(hash(code));
      this.#codes.delete(hash(code));
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (
        !issued || issued.expiresAt <= this.#now() || issued.clientId !== clientId
        || issued.redirectUri !== (form.get("redirect_uri") ?? "") || !verifier || challenge !== issued.codeChallenge
      ) {
        sendJson(response, 400, { error: "invalid_grant", error_description: "授權碼無效、過期，或 PKCE 驗證失敗。" });
        return true;
      }
      sendJson(response, 200, this.#issueTokens(issued.email, clientId));
      return true;
    }
    if (grantType === "refresh_token") {
      const presented = form.get("refresh_token") ?? "";
      const issued = this.#refreshTokens.get(hash(presented));
      if (!issued || issued.expiresAt <= this.#now() || issued.clientId !== clientId) {
        this.#refreshTokens.delete(hash(presented));
        sendJson(response, 400, { error: "invalid_grant", error_description: "refresh token 無效或已過期，請重新登入。" });
        return true;
      }
      const members = await this.#readMembers();
      if (!members.has(issued.email)) {
        this.#refreshTokens.delete(hash(presented));
        sendJson(response, 400, { error: "invalid_grant", error_description: "這個 email 已不在名單裡。" });
        return true;
      }
      this.#refreshTokens.delete(hash(presented));
      sendJson(response, 200, this.#issueTokens(issued.email, clientId));
      return true;
    }
    sendJson(response, 400, { error: "unsupported_grant_type" });
    return true;
  }

  #issueTokens(email: string, clientId: string): Record<string, unknown> {
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const now = this.#now();
    this.#accessTokens.set(hash(accessToken), { email, clientId, expiresAt: now + this.#accessTtlMs });
    this.#refreshTokens.set(hash(refreshToken), { email, clientId, expiresAt: now + this.#refreshTtlMs });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(this.#accessTtlMs / 1000),
      refresh_token: refreshToken,
      scope: this.requiredScope,
    };
  }

  #throttled(source: string): boolean {
    const record = this.#failures.get(source);
    return Boolean(record && record.resetAt > this.#now() && record.count >= THROTTLE_MAX_FAILURES);
  }

  #recordFailure(source: string): void {
    const now = this.#now();
    const record = this.#failures.get(source);
    if (!record || record.resetAt <= now) this.#failures.set(source, { count: 1, resetAt: now + THROTTLE_WINDOW_MS });
    else record.count += 1;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [key, value] of this.#pending) if (value.expiresAt <= now) this.#pending.delete(key);
    for (const [key, value] of this.#codes) if (value.expiresAt <= now) this.#codes.delete(key);
    for (const [key, value] of this.#accessTokens) if (value.expiresAt <= now) this.#accessTokens.delete(key);
    for (const [key, value] of this.#refreshTokens) if (value.expiresAt <= now) this.#refreshTokens.delete(key);
    for (const [key, value] of this.#failures) if (value.resetAt <= now) this.#failures.delete(key);
  }

  async #readMembers(): Promise<Map<string, string>> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.#membersFile, "utf8"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`無法讀取 AGENT_GAME_TABLE_MEMBERS_FILE：${detail}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("成員名單必須是 { \"email\": \"名字\" } 的物件。");
    const members = new Map<string, string>();
    for (const [email, name] of Object.entries(raw as Record<string, unknown>)) {
      const normalized = email.trim().toLowerCase();
      if (!normalized.includes("@") || typeof name !== "string" || !name.trim()) throw new Error(`成員名單有無效的項目：${email}`);
      members.set(normalized, name.trim());
    }
    return members;
  }

  async #loadClients(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.#clientsFile, "utf8");
    } catch {
      return;
    }
    const parsed = JSON.parse(raw) as { clients?: RegisteredClient[] };
    for (const client of parsed.clients ?? []) {
      if (typeof client.client_id === "string" && Array.isArray(client.redirect_uris)) this.#clients.set(client.client_id, client);
    }
  }

  async #saveClients(): Promise<void> {
    await mkdir(dirname(this.#clientsFile), { recursive: true });
    await writeFile(this.#clientsFile, JSON.stringify({ version: 1, clients: [...this.#clients.values()] }, null, 2), "utf8");
  }

  #loginForm(requestId: string, clientName: string, message: string | null): string {
    return `
      <p class="login-lead">${escapeHtml(clientName)} 想代你進入這張牌桌。填名單上的 email 和通關密語就好。</p>
      ${message ? `<p class="login-error" role="alert">${escapeHtml(message)}</p>` : ""}
      <form method="post" action="/oauth/authorize" class="create-form">
        <input type="hidden" name="request" value="${escapeHtml(requestId)}" />
        <label>email<input name="email" type="email" autocomplete="email" required /></label>
        <label>通關密語<input name="passphrase" type="password" autocomplete="current-password" required /></label>
        <button class="primary-button" type="submit">登入並回到 AI</button>
      </form>`;
  }

  #page(title: string, body: string): string {
    return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · Agent Game Table</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/huninn@5.3.0/index.css" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="app-shell login-shell">
      <header class="topbar"><div class="brand"><strong>Agent Game Table</strong><span>人類和 AI 坐同一桌打大老二</span></div></header>
      <section class="setup-panel login-panel">
        <h1>${escapeHtml(title)}</h1>
        ${body}
      </section>
    </main>
  </body>
</html>`;
  }
}

export class CompositeAuthenticator implements RemoteAuthenticator {
  readonly authorizationServers: string[];
  readonly requiredScope: string;
  readonly #authenticators: RemoteAuthenticator[];

  constructor(authenticators: RemoteAuthenticator[]) {
    if (!authenticators.length) throw new Error("至少要有一種遠端驗證方式。");
    this.#authenticators = authenticators;
    this.authorizationServers = [...new Set(authenticators.flatMap((authenticator) => authenticator.authorizationServers))];
    this.requiredScope = authenticators[0]!.requiredScope;
  }

  async authenticate(token: string): Promise<RemotePrincipal | null> {
    for (const authenticator of this.#authenticators) {
      const principal = await authenticator.authenticate(token);
      if (principal) return principal;
    }
    return null;
  }
}

/** https 一律完整比對；localhost／127.0.0.1／[::1] 的 http 回呼忽略 port（Claude Code 每次用不同的 port）。 */
export function redirectAllowed(registered: readonly string[], candidate: string): boolean {
  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    return false;
  }
  if (target.protocol === "http:" && isLoopback(target.hostname)) {
    return registered.some((uri) => {
      try {
        const known = new URL(uri);
        return known.protocol === "http:" && known.hostname === target.hostname && known.pathname === target.pathname;
      } catch {
        return false;
      }
    });
  }
  return registered.includes(candidate);
}

function isAcceptableRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopback(url.hostname);
  } catch {
    return false;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function withParams(base: string, params: Record<string, string | null>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

function clientAddress(request: IncomingMessage): string {
  const cloudflare = request.headers["cf-connecting-ip"];
  if (typeof cloudflare === "string" && cloudflare.trim()) return cloudflare.trim();
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]!.trim();
  return request.socket.remoteAddress ?? "unknown";
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const data = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.byteLength,
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  response.end(data);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  const data = Buffer.from(html);
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": data.byteLength,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'none'; style-src 'self' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(data);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}
