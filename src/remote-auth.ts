import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface RemotePrincipal {
  readonly id: string;
  readonly clientId: string;
  readonly scopes: string[];
  readonly expiresAt?: number;
}

export interface RemoteAuthenticator {
  readonly authorizationServers: string[];
  readonly requiredScope: string;
  authenticate(token: string): Promise<RemotePrincipal | null>;
}

export class StaticTokenAuthenticator implements RemoteAuthenticator {
  readonly authorizationServers: string[] = [];
  readonly requiredScope: string;
  readonly #principalsByTokenHash = new Map<string, RemotePrincipal>();

  constructor(entries: Record<string, string>, requiredScope = "game-table:play") {
    this.requiredScope = requiredScope;
    for (const [name, token] of Object.entries(entries)) {
      const normalizedName = name.trim();
      const normalizedToken = token.trim();
      if (!normalizedName || normalizedName.length > 120) throw new Error("遠端 MCP key 名稱無效。");
      if (normalizedToken.length < 32) throw new Error(`遠端 MCP key「${normalizedName}」至少需要 32 個字元。`);
      const tokenHash = hashToken(normalizedToken);
      if (this.#principalsByTokenHash.has(tokenHash)) throw new Error("遠端 MCP key 不可重複使用同一組 token。");
      this.#principalsByTokenHash.set(tokenHash, {
        id: `static:${normalizedName}`,
        clientId: `static:${normalizedName}`,
        scopes: [requiredScope],
      });
    }
    if (!this.#principalsByTokenHash.size) throw new Error("至少要設定一組遠端 MCP key。");
  }

  async authenticate(token: string): Promise<RemotePrincipal | null> {
    return this.#principalsByTokenHash.get(hashToken(token)) ?? null;
  }
}

export class OidcJwtAuthenticator implements RemoteAuthenticator {
  readonly authorizationServers: string[];
  readonly requiredScope: string;
  readonly #issuer: string;
  readonly #audience: string;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  private constructor(issuer: string, audience: string, jwksUri: string, requiredScope: string) {
    this.#issuer = issuer;
    this.#audience = audience;
    this.#jwks = createRemoteJWKSet(new URL(jwksUri));
    this.requiredScope = requiredScope;
    this.authorizationServers = [issuer];
  }

  static async create(
    issuer: string,
    audience: string,
    requiredScope = "game-table:play",
    fetchImplementation: typeof fetch = fetch,
  ): Promise<OidcJwtAuthenticator> {
    const normalizedIssuer = issuer.replace(/\/$/, "");
    if (!normalizedIssuer.startsWith("https://")) throw new Error("AGENT_GAME_TABLE_OIDC_ISSUER 必須使用 HTTPS。");
    if (!audience.trim()) throw new Error("AGENT_GAME_TABLE_OIDC_AUDIENCE 不可為空白。");
    const discoveryUrl = oidcDiscoveryUrl(normalizedIssuer);
    const response = await fetchImplementation(discoveryUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`無法讀取 OIDC discovery metadata（HTTP ${response.status}）。`);
    const metadata = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
    if (metadata.issuer !== normalizedIssuer || typeof metadata.jwks_uri !== "string") {
      throw new Error("OIDC discovery metadata 的 issuer 或 jwks_uri 無效。");
    }
    return new OidcJwtAuthenticator(normalizedIssuer, audience.trim(), metadata.jwks_uri, requiredScope);
  }

  async authenticate(token: string): Promise<RemotePrincipal | null> {
    try {
      const { payload } = await jwtVerify(token, this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience,
      });
      if (!payload.sub) return null;
      const scopes = scopesFrom(payload);
      if (this.requiredScope && !scopes.includes(this.requiredScope)) return null;
      const clientId = claimString(payload.client_id) ?? claimString(payload.azp) ?? "subject";
      return {
        id: `oidc:${this.#issuer}:${payload.sub}:${clientId}`,
        clientId,
        scopes,
        ...(typeof payload.exp === "number" ? { expiresAt: payload.exp } : {}),
      };
    } catch {
      return null;
    }
  }
}

export async function createRemoteAuthenticatorFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RemoteAuthenticator> {
  const requiredScope = environment.AGENT_GAME_TABLE_OIDC_REQUIRED_SCOPE?.trim() || "game-table:play";
  if (environment.AGENT_GAME_TABLE_OIDC_ISSUER || environment.AGENT_GAME_TABLE_OIDC_AUDIENCE) {
    if (!environment.AGENT_GAME_TABLE_OIDC_ISSUER || !environment.AGENT_GAME_TABLE_OIDC_AUDIENCE) {
      throw new Error("OIDC 模式必須同時設定 AGENT_GAME_TABLE_OIDC_ISSUER 與 AGENT_GAME_TABLE_OIDC_AUDIENCE。");
    }
    return OidcJwtAuthenticator.create(
      environment.AGENT_GAME_TABLE_OIDC_ISSUER,
      environment.AGENT_GAME_TABLE_OIDC_AUDIENCE,
      requiredScope,
    );
  }
  const inlineKeys = environment.AGENT_GAME_TABLE_REMOTE_KEYS_JSON?.trim();
  if (inlineKeys) {
    try {
      return new StaticTokenAuthenticator(JSON.parse(inlineKeys) as Record<string, string>, requiredScope);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`AGENT_GAME_TABLE_REMOTE_KEYS_JSON 無效：${detail}`);
    }
  }
  const keyFile = environment.AGENT_GAME_TABLE_REMOTE_KEYS_FILE?.trim();
  if (!keyFile) {
    throw new Error("請設定 AGENT_GAME_TABLE_REMOTE_KEYS_FILE／AGENT_GAME_TABLE_REMOTE_KEYS_JSON，或改用 OIDC issuer／audience。");
  }
  let entries: Record<string, string>;
  try {
    entries = JSON.parse(await readFile(keyFile, "utf8")) as Record<string, string>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`無法讀取 AGENT_GAME_TABLE_REMOTE_KEYS_FILE：${detail}`);
  }
  return new StaticTokenAuthenticator(entries, requiredScope);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function scopesFrom(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") return payload.scope.split(/\s+/).filter(Boolean);
  const scopes = payload.scp;
  if (Array.isArray(scopes)) return scopes.filter((scope): scope is string => typeof scope === "string");
  return [];
}

function claimString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function oidcDiscoveryUrl(issuer: string): string {
  const url = new URL(issuer);
  const issuerPath = url.pathname.replace(/\/$/, "");
  url.pathname = `/.well-known/openid-configuration${issuerPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
