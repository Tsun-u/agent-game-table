import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createDeck } from "../src/cards.js";
import { startAgentGameTableHost } from "../src/host-server.js";
import { MultiplayerTableStore, type PublicTableView } from "../src/multiplayer-store.js";
import { StaticTokenAuthenticator } from "../src/remote-auth.js";
import { RemoteMcpGateway } from "../src/remote-mcp.js";

const XIAOKUI_TOKEN = "xiaokui-remote-token-0000000000000001";
const AYU_TOKEN = "ayu-remote-token-00000000000000000002";
const HUMAN_KEY = "human-remote-access-key-00000000000001";

test("Streamable HTTP authenticates every request and binds one remote caller to one double-blind seat", async (context) => {
  const port = await availablePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  const store = new MultiplayerTableStore(() => createDeck());
  const created = store.createTable("阿童");
  const authenticator = new StaticTokenAuthenticator({ xiaokui: XIAOKUI_TOKEN, ayu: AYU_TOKEN });
  const gateway = new RemoteMcpGateway({ store, authenticator, publicUrl, humanAccessKey: HUMAN_KEY });
  const host = await startAgentGameTableHost({ hostname: "127.0.0.1", port, store, extension: gateway });
  context.after(async () => {
    await gateway.close();
    await host.close();
  });

  const unauthenticated = await fetch(`${publicUrl}/mcp`, { method: "POST" });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get("www-authenticate") ?? "", /^Bearer /);

  const untrustedOrigin = await fetch(`${publicUrl}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${XIAOKUI_TOKEN}`, Origin: "https://attacker.example" },
  });
  assert.equal(untrustedOrigin.status, 403);

  const unprotectedCreate = await fetch(`${publicUrl}/api/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ human_name: "訪客" }),
  });
  assert.equal(unprotectedCreate.status, 401);
  const protectedCreate = await fetch(`${publicUrl}/api/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Game-Table-Human-Key": HUMAN_KEY },
    body: JSON.stringify({ human_name: "遠端人類" }),
  });
  assert.equal(protectedCreate.status, 201);
  const unauthorizedManagement = await fetch(`${publicUrl}/api/admin/tables`);
  assert.equal(unauthorizedManagement.status, 401);
  const managed = await fetch(`${publicUrl}/api/admin/tables`, {
    headers: { "X-Agent-Game-Table-Human-Key": HUMAN_KEY },
  });
  assert.equal(managed.status, 200);
  const managedPayload = await managed.json() as { tables: Array<{ table_id: string }> };
  assert.equal(managedPayload.tables.length, 2);
  assert.equal(JSON.stringify(managedPayload).includes('"deck"'), false);

  const first = await connectRemote(publicUrl, XIAOKUI_TOKEN, "remote-first");
  context.after(() => first.client.close());
  const joined = await first.client.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "小葵" },
  });
  const firstView = tableFrom(joined);
  assert.equal(firstView.players.length, 2);
  assert.equal(firstView.viewer_seat_id, firstView.players.find((seat) => seat.name === "小葵")?.seat_id);

  const second = await connectRemote(publicUrl, AYU_TOKEN, "remote-second");
  context.after(() => second.client.close());
  const secondJoined = await second.client.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "阿宇" },
  });
  assert.equal(tableFrom(secondJoined).players.length, 3);

  const opened = store.startRound(created.human_token, tableFrom(secondJoined).version, "remote-start-round-1");
  store.humanAction(created.human_token, "play_cards", opened.version, "remote-human-play-1", ["♦3"]);
  const firstTurn = await first.client.callTool({ name: "get_table_view", arguments: {} });
  const serialized = JSON.stringify(firstTurn);
  assert.equal(serialized.includes('"deck"'), false);
  assert.equal(serialized.includes("♦5"), false, "another player's card must not cross the remote MCP boundary");

  const hijack = await fetch(`${publicUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AYU_TOKEN}`,
      "Mcp-Session-Id": first.transport.sessionId!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(hijack.status, 403, "another bearer identity must not reuse an MCP session");

  const replacement = await connectRemote(publicUrl, XIAOKUI_TOKEN, "remote-replacement");
  context.after(() => replacement.client.close());
  const resumed = await replacement.client.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "小葵" },
  });
  assert.equal(tableFrom(resumed).viewer_seat_id, firstView.viewer_seat_id);
  assert.equal(tableFrom(resumed).legal_actions.includes("play_cards"), true);

  const staleSession = await first.client.callTool({ name: "get_table_view", arguments: {} });
  assert.equal(staleSession.isError, true, "reconnecting the principal revokes the older seat capability");
});

test("OAuth mode advertises RFC 9728 protected resource metadata", async (context) => {
  const port = await availablePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  const store = new MultiplayerTableStore();
  const gateway = new RemoteMcpGateway({
    store,
    publicUrl,
    humanAccessKey: HUMAN_KEY,
    authenticator: {
      authorizationServers: ["https://auth.example.com"],
      requiredScope: "game-table:play",
      authenticate: async () => null,
    },
  });
  const host = await startAgentGameTableHost({ hostname: "127.0.0.1", port, store, extension: gateway });
  context.after(async () => {
    await gateway.close();
    await host.close();
  });

  const challenge = await fetch(`${publicUrl}/mcp`, { method: "POST" });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  const metadata = (await fetch(`${publicUrl}/.well-known/oauth-protected-resource`).then((response) =>
    response.json(),
  )) as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
  assert.equal(metadata.resource, `${publicUrl}/mcp`);
  assert.deepEqual(metadata.authorization_servers, ["https://auth.example.com"]);
  assert.deepEqual(metadata.scopes_supported, ["game-table:play"]);
});

async function connectRemote(publicUrl: string, token: string, name: string) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${publicUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as unknown as Transport);
  return { client, transport };
}

function tableFrom(result: Awaited<ReturnType<Client["callTool"]>>): PublicTableView {
  return (result.structuredContent as { table: PublicTableView }).table;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a TCP port.");
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
