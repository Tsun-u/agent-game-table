import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { createDeck } from "../src/cards.js";
import { startAgentGameTableHost } from "../src/host-server.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";

test("separate compiled STDIO Agent processes share one human-hosted table", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  const first = await connectStdio(host.url, "stdio-a", context);
  const second = await connectStdio(host.url, "stdio-b", context);
  context.after(() => host.close());

  const tools = await first.listTools();
  assert.equal(tools.tools.some((tool) => tool.name === "join_table"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "wait_for_table_event"), true);
  assert.equal(tools.tools.some((tool) => tool.name === "list_tables"), false);

  const created = store.createTable("阿童");
  await first.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "小葵" },
  });
  const joined = await second.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "阿宇" },
  });
  assert.equal(joined.isError, undefined);
  assert.equal(JSON.stringify(joined).includes("agent_token"), false);

  const version = (joined.structuredContent as { table: { version: number } }).table.version;
  store.startRound(created.human_token, version, "human-start-stdio");
  const firstEvents = await first.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const secondEvents = await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  assert.equal(JSON.stringify(firstEvents).includes("阿宇 加入了牌桌"), true);
  assert.equal(JSON.stringify(secondEvents).includes("第 1 局開始"), true);
});

async function connectStdio(hostUrl: string, name: string, context: TestContext): Promise<Client> {
  const serverPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { AGENT_GAME_TABLE_HOST_URL: hostUrl },
  });
  const client = new Client({ name, version: "1.0.0" });
  context.after(() => client.close());
  await client.connect(transport);
  return client;
}
