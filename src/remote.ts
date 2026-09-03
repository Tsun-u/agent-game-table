#!/usr/bin/env node

import { startAgentGameTableHost } from "./host-server.js";
import { MultiplayerTableStore } from "./multiplayer-store.js";
import { createRemoteAuthenticatorFromEnv, type RemoteAuthenticator } from "./remote-auth.js";
import { RemoteMcpGateway } from "./remote-mcp.js";
import { BuiltinOAuthServer, CompositeAuthenticator } from "./remote-oauth.js";
import { EncryptedFileTablePersistence } from "./store-persistence.js";

const port = integerEnvironment("AGENT_GAME_TABLE_REMOTE_PORT", 3210, 1, 65_535);
const hostname = process.env.AGENT_GAME_TABLE_REMOTE_HOST?.trim() || "127.0.0.1";
const publicUrl = process.env.AGENT_GAME_TABLE_PUBLIC_URL?.trim();
if (!publicUrl) throw new Error("Remote MCP 必須設定 AGENT_GAME_TABLE_PUBLIC_URL，例如 https://game-table.example.com。");
const parsedPublicUrl = new URL(publicUrl);
if (parsedPublicUrl.protocol !== "https:" && process.env.AGENT_GAME_TABLE_ALLOW_INSECURE_HTTP !== "1") {
  throw new Error("Remote MCP 的 AGENT_GAME_TABLE_PUBLIC_URL 必須使用 HTTPS；本機測試可暫設 AGENT_GAME_TABLE_ALLOW_INSECURE_HTTP=1。");
}
const stateKey = process.env.AGENT_GAME_TABLE_STATE_KEY?.trim();
if (!stateKey) throw new Error("Remote MCP 必須設定 AGENT_GAME_TABLE_STATE_KEY，避免牌堆與座位憑證以明文落地。");
const statePath = process.env.AGENT_GAME_TABLE_STATE_PATH?.trim() || "data/agent-game-table-state.enc.json";
const humanAccessKey = process.env.AGENT_GAME_TABLE_HUMAN_ACCESS_KEY?.trim();
if (!humanAccessKey) throw new Error("Remote MCP 必須設定 AGENT_GAME_TABLE_HUMAN_ACCESS_KEY，避免公開訪客任意建立牌桌。");

const persistence = new EncryptedFileTablePersistence(statePath, stateKey);
const store = new MultiplayerTableStore(undefined, { persistence });
const membersFile = process.env.AGENT_GAME_TABLE_MEMBERS_FILE?.trim();
const loginPassphrase = process.env.AGENT_GAME_TABLE_LOGIN_PASSPHRASE?.trim();
if (Boolean(membersFile) !== Boolean(loginPassphrase)) {
  throw new Error("內建 OAuth 登入必須同時設定 AGENT_GAME_TABLE_MEMBERS_FILE 與 AGENT_GAME_TABLE_LOGIN_PASSPHRASE。");
}
const oauth = membersFile && loginPassphrase
  ? await BuiltinOAuthServer.create({
    publicUrl,
    membersFile,
    passphrase: loginPassphrase,
    clientsFile: process.env.AGENT_GAME_TABLE_OAUTH_CLIENTS_PATH?.trim() || "data/oauth-clients.json",
    requiredScope: process.env.AGENT_GAME_TABLE_OIDC_REQUIRED_SCOPE?.trim() || "game-table:play",
  })
  : null;
const hasStaticOrOidc = Boolean(
  process.env.AGENT_GAME_TABLE_REMOTE_KEYS_FILE || process.env.AGENT_GAME_TABLE_REMOTE_KEYS_JSON
  || process.env.AGENT_GAME_TABLE_OIDC_ISSUER || process.env.AGENT_GAME_TABLE_OIDC_AUDIENCE,
);
const authenticators: RemoteAuthenticator[] = [];
if (hasStaticOrOidc || !oauth) authenticators.push(await createRemoteAuthenticatorFromEnv());
if (oauth) authenticators.push(oauth);
const authenticator = authenticators.length === 1 ? authenticators[0]! : new CompositeAuthenticator(authenticators);
const gateway = new RemoteMcpGateway({
  store,
  authenticator,
  publicUrl,
  humanAccessKey,
  ...(oauth ? { oauth } : {}),
  allowedOrigins: csvEnvironment("AGENT_GAME_TABLE_ALLOWED_ORIGINS"),
  allowedHosts: csvEnvironment("AGENT_GAME_TABLE_ALLOWED_HOSTS"),
});
const host = await startAgentGameTableHost({ hostname, port, store, extension: gateway });

console.log(`Agent Game Table Remote MCP listening on ${host.url}`);
console.log(`Public MCP endpoint: ${new URL("/mcp", publicUrl)}`);
console.log(`Authentication: ${[
  hasStaticOrOidc || !oauth ? (process.env.AGENT_GAME_TABLE_OIDC_ISSUER ? "OIDC bearer tokens" : "static bearer keys") : null,
  oauth ? "built-in OAuth login (members + passphrase)" : null,
].filter(Boolean).join(" + ")}`);
if (oauth) console.log(`OAuth login page: ${new URL("/oauth/authorize", publicUrl)}`);
console.log(`Encrypted state: ${statePath}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void gateway
      .close()
      .then(() => host.close())
      .finally(() => process.exit(0));
  });
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必須是 ${minimum} 到 ${maximum} 的整數。`);
  }
  return value;
}

function csvEnvironment(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
