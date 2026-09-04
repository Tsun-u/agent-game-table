import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createDeck } from "../src/cards.js";
import { AgentGameTableHostClient } from "../src/host-client.js";
import { startAgentGameTableHost } from "../src/host-server.js";
import { createAgentGameTableMcpServer } from "../src/mcp-server.js";
import { MultiplayerTableStore, type PublicTableView } from "../src/multiplayer-store.js";

test("multiple MCP Agents play Big Two with isolated capabilities and event cursors", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  context.after(() => host.close());
  const first = await connectMcp(new AgentGameTableHostClient(host.url), "agent-a", context);
  const second = await connectMcp(new AgentGameTableHostClient(host.url), "agent-b", context);
  const replacement = await connectMcp(new AgentGameTableHostClient(host.url), "agent-a-reconnected", context);

  const tools = await first.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "accept_substitute", "get_game_rules", "get_table_view", "invite_substitute", "join_table", "leave_seat", "leave_table", "say_at_table", "take_action", "take_seat", "wait_for_table_event",
  ]);
  const schemas = JSON.stringify(tools);
  assert.equal(schemas.includes('"deck"'), false);
  assert.equal(schemas.includes('"seed"'), false);
  assert.equal((await first.callTool({ name: "get_table_view", arguments: {} })).isError, true);

  const rules = await first.callTool({ name: "get_game_rules", arguments: {} });
  assert.equal((rules.structuredContent as { rules?: { rules_version?: string } }).rules?.rules_version, "bigtwo-tw-5");
  assert.equal(JSON.stringify(rules).includes("A-2-3-4-5"), true);

  const created = store.createTable("阿童");
  const firstJoin = await first.callTool({ name: "join_table", arguments: { join_code: created.table.join_code, agent_name: "小葵" } });
  const secondJoin = await second.callTool({ name: "join_table", arguments: { join_code: created.table.join_code, agent_name: "阿宇" } });
  assert.equal(JSON.stringify(firstJoin).includes("agent_token"), false);
  assert.equal((firstJoin.structuredContent as { rules?: { rules_version?: string } }).rules?.rules_version, "bigtwo-tw-5");
  assert.equal(tableFrom(firstJoin).viewer_role, "spectator");
  store.humanTakeSeat(created.human_token, tableFrom(secondJoin).version, "owner-seat-mcp");
  await seatVia(first, "agent-a-seat-mcp");
  const secondSeated = await seatVia(second, "agent-b-seat-mcp");
  assert.deepEqual(secondSeated.players.map((seat) => seat.name), ["阿童", "小葵", "阿宇"]);
  const optionTable = store.createTable("房主", { bombs_beat_anything: true, five_card_same_kind_only: false });
  const optionClient = await connectMcp(new AgentGameTableHostClient(host.url), "agent-options", context);
  const optionJoin = await optionClient.callTool({ name: "join_table", arguments: { join_code: optionTable.table.join_code, agent_name: "阿宇選項" } });
  const optionRules = (optionJoin.structuredContent as { rules: { table_options: Array<{ key: string; enabled: boolean }> } }).rules.table_options;
  assert.deepEqual(optionRules.map((option) => [option.key, option.enabled]), [["bombs_beat_anything", true], ["five_card_same_kind_only", false]]);
  assert.equal(JSON.stringify(optionJoin.content).includes("鐵支同花順全壓：開"), true);
  await optionClient.callTool({ name: "leave_table", arguments: {} });
  const opened = store.startRound(created.human_token, store.getHumanView(created.human_token).version, "mcp-start-01");
  await first.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  store.humanAction(created.human_token, "play_cards", opened.version, "mcp-owner-play-01", ["♣3"]);

  const firstNotice = await first.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const firstTurn = tableFrom(firstNotice);
  assert.equal(firstTurn.active_seat_id, firstTurn.viewer_seat_id);
  assert.deepEqual(firstTurn.legal_actions, ["play_cards", "pass"]);
  assert.equal(firstTurn.legal_plays.length > 0, true);
  assert.equal(firstTurn.legal_plays.every((play) => play.cards.length === 1), true);
  assert.equal(eventKinds(firstNotice).includes("cards_played"), true);
  for (const opponent of firstTurn.players.filter((seat) => !seat.is_you)) assert.deepEqual(opponent.cards, []);

  const ticket = store.createAgentReconnectTicket(created.human_token, firstTurn.viewer_seat_id);
  const rejoined = await replacement.callTool({
    name: "join_table",
    arguments: { join_code: created.table.join_code, agent_name: "小葵", reconnect_code: ticket.reconnect_code },
  });
  assert.deepEqual(tableFrom(rejoined).legal_actions, ["play_cards", "pass"]);
  assert.equal((await first.callTool({ name: "get_table_view", arguments: {} })).isError, true);

  const earlySecond = await second.callTool({
    name: "take_action",
    arguments: { action: "pass", expected_version: firstTurn.version, idempotency_key: "agent-b-early-mcp" },
  });
  assert.equal(earlySecond.isError, true);

  const firstPlay = await replacement.callTool({
    name: "take_action",
    arguments: { action: "play_cards", cards: ["♣4"], expected_version: firstTurn.version, idempotency_key: "agent-a-play-mcp" },
  });
  assert.equal(firstPlay.isError, undefined);
  const secondNotice = await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const secondTurn = tableFrom(secondNotice);
  assert.equal(secondTurn.active_seat_id, secondTurn.viewer_seat_id);

  await replacement.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  await second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 0 } });
  const waitingForChat = second.callTool({ name: "wait_for_table_event", arguments: { timeout_seconds: 2 } });
  await replacement.callTool({ name: "say_at_table", arguments: { message: "換你了。", idempotency_key: "agent-a-chat-mcp1" } });
  assert.equal(eventKinds(await waitingForChat).includes("message"), true);

  const departure = await replacement.callTool({ name: "leave_table", arguments: {} });
  assert.equal((departure.structuredContent as { departure?: { left?: boolean } }).departure?.left, true);
  assert.deepEqual((await replacement.callTool({ name: "leave_table", arguments: {} })).structuredContent, departure.structuredContent);

  const freshTable = store.createTable("另一位人類");
  const moved = await first.callTool({ name: "join_table", arguments: { join_code: freshTable.table.join_code, agent_name: "小葵換桌" } });
  assert.equal(moved.isError, undefined);
});

async function connectMcp(host: AgentGameTableHostClient, name: string, context: TestContext): Promise<Client> {
  const server = createAgentGameTableMcpServer(host);
  const client = new Client({ name, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  context.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function tableFrom(result: unknown): PublicTableView {
  const table = (result as { structuredContent?: { table?: PublicTableView } }).structuredContent?.table;
  assert.ok(table);
  return table;
}

function eventKinds(result: unknown): string[] {
  return ((result as { structuredContent?: { events?: Array<{ kind: string }> } }).structuredContent?.events ?? []).map((event) => event.kind);
}

async function seatVia(client: Client, idempotencyKey: string): Promise<PublicTableView> {
  const current = tableFrom(await client.callTool({ name: "get_table_view", arguments: {} }));
  return tableFrom(await client.callTool({ name: "take_seat", arguments: { expected_version: current.version, idempotency_key: idempotencyKey } }));
}

test("MCP Agents can play a Gong Zhu trick and get that table's rules", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  context.after(() => host.close());
  const created = store.createTable("阿童", undefined, "gongzhu");
  const clients = [];
  for (const name of ["小光", "小燈", "小葵"]) {
    const client = await connectMcp(new AgentGameTableHostClient(host.url), `gz-${name}`, context);
    const joined = await client.callTool({ name: "join_table", arguments: { join_code: created.table.join_code, agent_name: name } });
    assert.equal(joined.isError, undefined);
    assert.equal((joined.structuredContent as { rules: { rules_version: string } }).rules.rules_version, "gongzhu-tw-1");
    clients.push(client);
  }
  const rules = await clients[0]!.callTool({ name: "get_game_rules", arguments: {} });
  assert.equal((rules.structuredContent as { rules: { game: string } }).rules.game, "拱豬", "get_game_rules follows the table's game once joined");
  store.humanTakeSeat(created.human_token, store.getHumanView(created.human_token).version, "gz-owner-seat");
  for (const [index, client] of clients.entries()) await seatVia(client, `gz-seat-${index}`);
  const opened = store.startRound(created.human_token, store.getHumanView(created.human_token).version, "gz-start");
  assert.equal(opened.phase, "in_round");
  const views = await Promise.all(clients.map(async (client) => tableFrom(await client.callTool({ name: "get_table_view", arguments: {} }))));
  const leaderIndex = views.findIndex((view) => view.legal_plays.some((play) => play.cards[0] === "♣2"));
  if (leaderIndex >= 0) {
    const leaderView = views[leaderIndex]!;
    assert.deepEqual(leaderView.legal_actions, ["play_card"]);
    const played = await clients[leaderIndex]!.callTool({ name: "take_action", arguments: { action: "play_card", cards: ["♣2"], expected_version: leaderView.version, idempotency_key: "gz-play-clubs-2" } });
    assert.equal(played.isError, undefined, JSON.stringify(played.content));
    const board = (played.structuredContent as { table: { board: { trick: { plays: unknown[] } } } }).table.board;
    assert.equal(board.trick.plays.length, 1);
  } else {
    const view = store.getHumanView(created.human_token);
    assert.equal(view.legal_plays[0]?.cards[0], "♣2", "the human owner holds ♣2 in this deal");
  }
});

test("MCP Agents see every seat pending during Hearts passing and can pass three cards", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  context.after(() => host.close());
  const created = store.createTable("阿童", undefined, "hearts");
  const clients = [];
  for (const name of ["小光", "小燈", "小葵"]) {
    const client = await connectMcp(new AgentGameTableHostClient(host.url), `hz-${name}`, context);
    await client.callTool({ name: "join_table", arguments: { join_code: created.table.join_code, agent_name: name } });
    clients.push(client);
  }
  store.humanTakeSeat(created.human_token, store.getHumanView(created.human_token).version, "hz-owner-seat");
  for (const [index, client] of clients.entries()) await seatVia(client, `hz-seat-${index}`);
  store.startRound(created.human_token, store.getHumanView(created.human_token).version, "hz-start");
  const view = tableFrom(await clients[0]!.callTool({ name: "get_table_view", arguments: {} }));
  assert.equal(view.pending_seat_ids.length, 4);
  assert.equal(view.board.phase, "passing");
  assert.deepEqual(view.legal_actions, ["pass_cards"]);
  const cards = view.legal_plays.slice(0, 3).map((play) => play.cards[0]!);
  const passed = await clients[0]!.callTool({ name: "take_action", arguments: { action: "pass_cards", cards, expected_version: view.version, idempotency_key: "hz-pass-three" } });
  assert.equal(passed.isError, undefined, JSON.stringify(passed.content));
  assert.equal(tableFrom(passed).pending_seat_ids.length, 3);
});
