import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createDeck } from "../src/cards.js";
import { startAgentGameTableHost } from "../src/host-server.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";
import { StaticTokenAuthenticator } from "../src/remote-auth.js";
import { RemoteMcpGateway } from "../src/remote-mcp.js";
import { BuiltinOAuthServer, CompositeAuthenticator, redirectAllowed } from "../src/remote-oauth.js";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

test("loopback redirect URIs ignore the port while https URIs must match exactly", () => {
  const registered = ["http://localhost/callback", CLAUDE_CALLBACK];
  assert.equal(redirectAllowed(registered, "http://localhost:3118/callback"), true);
  assert.equal(redirectAllowed(registered, "http://localhost:9/other"), false);
  assert.equal(redirectAllowed(registered, CLAUDE_CALLBACK), true);
  assert.equal(redirectAllowed(registered, "https://claude.ai/api/mcp/auth_callback?x=1"), false);
  assert.equal(redirectAllowed(registered, "http://evil.example/callback"), false);
});

test("built-in OAuth: register, log in with email + passphrase, exchange with PKCE, refresh, and play", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-game-table-oauth-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const membersFile = join(directory, "members.json");
  const clientsFile = join(directory, "clients.json");
  await writeFile(membersFile, JSON.stringify({ "Tong@Example.com": "阿童", "friend@example.com": "村民" }), "utf8");

  let clock = Date.now();
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  const publicUrl = host.url;
  const oauth = await BuiltinOAuthServer.create({ publicUrl, membersFile, clientsFile, passphrase: "dragon-village-2026", now: () => clock });
  const authenticator = new CompositeAuthenticator([new StaticTokenAuthenticator({ bot: "b".repeat(40) }), oauth]);
  const gateway = new RemoteMcpGateway({ store, authenticator, publicUrl, humanAccessKey: "h".repeat(40), oauth, allowedHosts: [new URL(publicUrl).host] });
  await host.close();
  const remote = await startAgentGameTableHost({ port: Number(new URL(publicUrl).port), store, extension: gateway });
  context.after(() => remote.close());

  const metadata = await (await fetch(`${publicUrl}/.well-known/oauth-authorization-server`)).json() as Record<string, unknown>;
  assert.equal(metadata.issuer, new URL(publicUrl).origin);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
  const resource = await (await fetch(`${publicUrl}/.well-known/oauth-protected-resource`)).json() as { authorization_servers: string[] };
  assert.deepEqual(resource.authorization_servers, [new URL(publicUrl).origin]);

  const badRegistration = await fetch(`${publicUrl}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
  });
  assert.equal(badRegistration.status, 400);
  const registration = await fetch(`${publicUrl}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK, "http://localhost/callback"], token_endpoint_auth_method: "none" }),
  });
  assert.equal(registration.status, 201);
  const client = await registration.json() as { client_id: string };
  assert.equal(JSON.parse(await readFile(clientsFile, "utf8")).clients[0].client_id, client.client_id, "registrations are persisted");

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://localhost:3118/callback";
  const authorizeUrl = new URL(`${publicUrl}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code", client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", scope: "game-table:play",
  }).toString();
  const form = await fetch(authorizeUrl);
  assert.equal(form.status, 200);
  const html = await form.text();
  assert.equal(html.includes("通關密語"), true);
  assert.equal(html.includes("claude.ai"), false, "the login page never echoes redirect targets");
  const requestId = /name="request" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(requestId);

  const wrong = await fetch(`${publicUrl}/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request: requestId, email: "tong@example.com", passphrase: "nope" }), redirect: "manual",
  });
  assert.equal(wrong.status, 200);
  assert.equal((await wrong.text()).includes("通關密語不對"), true);

  const login = await fetch(`${publicUrl}/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request: requestId, email: "TONG@example.com", passphrase: "dragon-village-2026" }), redirect: "manual",
  });
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get("location")!);
  assert.equal(`${location.origin}${location.pathname}`, redirectUri);
  assert.equal(location.searchParams.get("state"), "xyz");
  const code = location.searchParams.get("code")!;

  const badVerifier = await fetch(`${publicUrl}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: redirectUri, code_verifier: "wrong" }),
  });
  assert.equal(badVerifier.status, 400);
  assert.equal((await badVerifier.json() as { error: string }).error, "invalid_grant");

  const relogin = await fetch(`${publicUrl}/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request: requestId, email: "tong@example.com", passphrase: "dragon-village-2026" }), redirect: "manual",
  });
  assert.equal(relogin.status, 400, "a login request cannot be replayed after it produced a code");

  const secondForm = await (await fetch(authorizeUrl)).text();
  const secondRequest = /name="request" value="([^"]+)"/.exec(secondForm)![1]!;
  const secondLogin = await fetch(`${publicUrl}/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request: secondRequest, email: "tong@example.com", passphrase: "dragon-village-2026" }), redirect: "manual",
  });
  const secondCode = new URL(secondLogin.headers.get("location")!).searchParams.get("code")!;
  const tokens = await (await fetch(`${publicUrl}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code: secondCode, redirect_uri: redirectUri, code_verifier: verifier }),
  })).json() as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 8 * 60 * 60);

  const principal = await authenticator.authenticate(tokens.access_token);
  assert.equal(principal?.id, "member:tong@example.com", "identity is the email alone; client_id changes on every login");
  assert.equal(principal?.clientId, client.client_id);

  const mcp = new Client({ name: "oauth-probe", version: "0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${publicUrl}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }) as unknown as Transport);
  context.after(() => mcp.close());
  const table = store.createTable("阿童");
  const joined = await mcp.callTool({ name: "join_table", arguments: { join_code: table.table.join_code, agent_name: "童童的 Claude" } });
  assert.equal(joined.isError, undefined);
  assert.equal((joined.structuredContent as { table: { viewer_role: string } }).table.viewer_role, "spectator");

  const refreshed = await (await fetch(`${publicUrl}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token }),
  })).json() as { access_token: string; refresh_token: string };
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token, "refresh tokens rotate");
  const replay = await fetch(`${publicUrl}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token }),
  });
  assert.equal(replay.status, 400, "a rotated refresh token is dead");

  clock += 9 * 60 * 60 * 1000;
  assert.equal(await authenticator.authenticate(tokens.access_token), null, "access tokens expire");
  assert.equal(await authenticator.authenticate(refreshed.access_token), null);
  assert.equal((await authenticator.authenticate("b".repeat(40)))?.id, "static:bot", "static keys keep working alongside OAuth");

  await writeFile(membersFile, JSON.stringify({ "friend@example.com": "村民" }), "utf8");
  const removed = await fetch(`${publicUrl}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: refreshed.refresh_token }),
  });
  assert.equal(removed.status, 400, "removing an email from the list ends the refresh chain");
});

test("built-in OAuth throttles repeated wrong passphrases per source address", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-game-table-oauth-throttle-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const membersFile = join(directory, "members.json");
  await writeFile(membersFile, JSON.stringify({ "tong@example.com": "阿童" }), "utf8");
  const store = new MultiplayerTableStore(() => createDeck());
  const probe = await startAgentGameTableHost({ port: 0, store });
  const publicUrl = probe.url;
  await probe.close();
  const oauth = await BuiltinOAuthServer.create({ publicUrl, membersFile, clientsFile: join(directory, "clients.json"), passphrase: "dragon-village-2026" });
  const gateway = new RemoteMcpGateway({ store, authenticator: oauth, publicUrl, humanAccessKey: "h".repeat(40), oauth, allowedHosts: [new URL(publicUrl).host] });
  const remote = await startAgentGameTableHost({ port: Number(new URL(publicUrl).port), store, extension: gateway });
  context.after(() => remote.close());

  const client = await (await fetch(`${publicUrl}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CLAUDE_CALLBACK] }),
  })).json() as { client_id: string };
  const authorizeUrl = `${publicUrl}/oauth/authorize?${new URLSearchParams({
    response_type: "code", client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK, code_challenge: "c".repeat(43), code_challenge_method: "S256",
  })}`;
  const requestId = /name="request" value="([^"]+)"/.exec(await (await fetch(authorizeUrl)).text())![1]!;
  let lastBody = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    lastBody = await (await fetch(`${publicUrl}/oauth/authorize`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.9" },
      body: new URLSearchParams({ request: requestId, email: "tong@example.com", passphrase: "wrong" }), redirect: "manual",
    })).text();
  }
  assert.equal(lastBody.includes("嘗試太多次"), true);
  const blocked = await fetch(`${publicUrl}/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.9" },
    body: new URLSearchParams({ request: requestId, email: "tong@example.com", passphrase: "dragon-village-2026" }), redirect: "manual",
  });
  assert.equal(blocked.status, 200, "even the right passphrase waits out the throttle window");
  const other = await fetch(`${publicUrl}/oauth/authorize`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.10" },
    body: new URLSearchParams({ request: requestId, email: "tong@example.com", passphrase: "dragon-village-2026" }), redirect: "manual",
  });
  assert.equal(other.status, 302, "another source is not affected");
});
