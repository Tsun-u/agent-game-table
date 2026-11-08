import assert from "node:assert/strict";
import test from "node:test";

import { createDeck } from "../src/cards.js";
import { AgentGameTableHostClient } from "../src/host-client.js";
import { startAgentGameTableHost } from "../src/host-server.js";
import { MultiplayerTableStore, type HumanTableResult, type PublicTableView } from "../src/multiplayer-store.js";

test("HTTP Host serves the Big Two table and shares one authority with Agent clients", async (context) => {
  const host = await startAgentGameTableHost({ port: 0, store: new MultiplayerTableStore(() => createDeck()) });
  context.after(() => host.close());

  const page = await fetch(host.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Agent Game Table 共桌牌局/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const animation = await fetch(`${host.url}/animations/round-complete.json`);
  const animationData = await animation.json() as { nm?: string; slots?: Record<string, unknown> };
  assert.equal(animationData.nm, "Agent Game Table round complete flourish");
  assert.equal(Boolean(animationData.slots?.bgColor), true);

  const created = await request<HumanTableResult>(host.url, "/api/tables", {
    method: "POST",
    body: { human_name: "阿童" },
  });
  assert.equal(created.table.mode, "bigtwo");
  const other = await request<HumanTableResult>(host.url, "/api/tables", {
    method: "POST",
    body: { human_name: "隔壁桌" },
  });
  const rules = await fetch(`${host.url}/api/games/hearts/rules?options=${encodeURIComponent(JSON.stringify({ end_mode: "rounds", end_rounds: 6 }))}`);
  assert.equal(rules.status, 200);
  const rulesPayload = await rules.json() as { label: string; text: string };
  assert.equal(rulesPayload.label, "傷心小棧");
  assert.match(rulesPayload.text, /打滿 6 局/);
  assert.equal((await fetch(`${host.url}/api/games/nope/rules`)).status, 404);
  assert.match(await (await fetch(`${host.url}/rules`)).text(), /本桌規則/);
  const managed = await fetch(`${host.url}/api/admin/tables`);
  assert.equal(managed.status, 200);
  assert.equal((await managed.json() as { tables: unknown[] }).tables.length, 2);
  const lobby = await fetch(`${host.url}/api/lobby`);
  assert.equal(lobby.status, 200);
  const lobbyTables = (await lobby.json() as { tables: Array<Record<string, unknown>> }).tables;
  assert.equal(lobbyTables.length, 2);
  const listed = lobbyTables.find((table) => table.table_id === created.table.table_id)!;
  assert.equal(listed.human_name, "阿童");
  assert.equal(listed.join_code_hint, `${created.table.join_code[0]}•••••${created.table.join_code.at(-1)}`);
  assert.equal("join_code" in listed, false, "the lobby never exposes a full invitation code");
  await fetch(`${host.url}/api/admin/tables/${other.table.table_id}`, { method: "DELETE" });

  assert.deepEqual(created.table.rule_options, { bombs_beat_anything: false, five_card_same_kind_only: false });
  const optioned = await request<{ table: PublicTableView }>(host.url, "/api/tables", {
    method: "POST", body: { human_name: "房主", options: { bombs_beat_anything: true } },
  });
  assert.deepEqual(optioned.table.rule_options, { bombs_beat_anything: true, five_card_same_kind_only: false });
  const agent = new AgentGameTableHostClient(host.url);
  const joined = await agent.joinAgent(created.table.join_code, "小葵");
  assert.equal(joined.table.viewer_role, "spectator");
  const ownerSeated = await request<{ table: PublicTableView }>(host.url, "/api/human/seat", {
    method: "POST", token: created.human_token, body: { expected_version: joined.table.version, idempotency_key: "human-seat-http-01" },
  });
  const agentSeated = await agent.takeSeat(joined.agent_token, ownerSeated.table.version, "agent-seat-http-01");
  assert.deepEqual(agentSeated.players.map((seat) => seat.name), ["阿童", "小葵"]);
  const opened = await request<{ table: PublicTableView }>(host.url, "/api/human/start-round", {
    method: "POST",
    token: created.human_token,
    body: { expected_version: agentSeated.version, idempotency_key: "human-start-http-01" },
  });
  assert.equal(opened.table.players.find((seat) => seat.is_you)?.cards.includes("♣3"), true);
  assert.equal(JSON.stringify(opened).includes("♣4"), false, "the Agent hand stays private");

  await agent.waitForEvents(joined.agent_token, 0);
  const waiting = agent.waitForEvents(joined.agent_token, 2_000);
  await request(host.url, "/api/human/action", {
    method: "POST",
    token: created.human_token,
    body: { action: "play_cards", cards: ["♣3"], expected_version: opened.table.version, idempotency_key: "human-play-http-01" },
  });
  const notice = await waiting;
  assert.equal(notice.events.some((event) => event.kind === "cards_played" && event.actor_name === "阿童"), true);
  assert.deepEqual(notice.table.legal_actions, ["play_cards", "pass"]);

  const ticket = await request<{ reconnect_code: string }>(host.url, "/api/human/reconnect-code", {
    method: "POST", token: created.human_token, body: { seat_id: joined.table.viewer_seat_id },
  });
  const rejoined = await new AgentGameTableHostClient(host.url).rejoinAgent(created.table.join_code, "小葵", ticket.reconnect_code);
  assert.deepEqual(rejoined.table.legal_actions, ["play_cards", "pass"]);
  await assert.rejects(() => agent.getAgentView(joined.agent_token), /憑證無效/);

  const departure = await new AgentGameTableHostClient(host.url).leaveAgent(rejoined.agent_token);
  assert.equal(departure.left, true);
  const afterLeave = await request<{ table: PublicTableView }>(host.url, "/api/human/table", {
    method: "GET", token: created.human_token,
  });
  assert.equal(afterLeave.table.phase, "ended");
  assert.deepEqual(afterLeave.table.players.map((seat) => seat.name), ["阿童"]);

  const removable = await agent.joinAgent(created.table.join_code, "阿宇");
  const removed = await request<{ table: PublicTableView }>(host.url, "/api/human/remove-agent", {
    method: "POST", token: created.human_token,
    body: { seat_id: removable.table.viewer_seat_id, expected_version: removable.table.version, idempotency_key: "human-remove-http-01" },
  });
  assert.deepEqual(removed.table.players.map((seat) => seat.name), ["阿童"]);
  await assert.rejects(() => agent.getAgentView(removable.agent_token), /憑證無效/);

  const unauthorized = await fetch(`${host.url}/api/human/table`, { headers: { Authorization: "Bearer wrong" } });
  assert.equal(unauthorized.status, 401);
  assert.equal(JSON.stringify(await unauthorized.json()).includes('"deck"'), false);
});

async function request<T>(baseUrl: string, path: string, options: { method: "GET" | "POST"; token?: string; body?: Record<string, unknown> }): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method, headers, ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload as T;
}

test("repeated wrong invitation codes from one address are throttled", async (context) => {
  const host = await startAgentGameTableHost({ port: 0, store: new MultiplayerTableStore(() => createDeck()) });
  context.after(() => host.close());
  const created = await request<HumanTableResult>(host.url, "/api/tables", { method: "POST", body: { human_name: "阿童" } });

  const guess = (code: string, address: string) => fetch(`${host.url}/api/human/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": address },
    body: JSON.stringify({ join_code: code, human_name: "路人" }),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await guess("WRONG00", "203.0.113.9")).status, 404);
  const blocked = await guess(created.table.join_code, "203.0.113.9");
  assert.equal(blocked.status, 429, "the correct code is refused too once the address is cooling down");
  const neighbour = await guess(created.table.join_code, "203.0.113.10");
  assert.equal(neighbour.status, 200, "another address is unaffected");
});

test("HTTP 人類觀眾端點：出題與冪等回放共用牌桌狀態", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  context.after(() => host.close());
  const owner = store.createTable("阿童", { audience_only: true, turn_seconds: 0 }, "syncquiz");
  store.humanTakeSeat(owner.human_token, owner.table.version, "http-quiz-owner-seat");
  const agentClient = new AgentGameTableHostClient(host.url);
  const agent = await agentClient.joinAgent(owner.table.join_code, "小葵");
  await agentClient.takeSeat(agent.agent_token, agent.table.version, "http-quiz-agent-seat");
  const spectator = store.joinHuman(owner.table.join_code, "小蝶");
  const view = store.startRound(owner.human_token, store.getHumanView(owner.human_token).version, "http-quiz-start");
  const options = { method: "POST" as const, token: spectator.human_token, body: { action: "submit_question", cards: ["  下雨想做什麼？  "], expected_version: view.version, idempotency_key: "http-audience-question" } };
  const first = await request<{ table: PublicTableView }>(host.url, "/api/human/audience", options);
  assert.deepEqual(first.table.board.question, { text: "下雨想做什麼？", author: "小蝶" });
  assert.equal(first.table.turn_deadline_at, null);
  assert.deepEqual(await request(host.url, "/api/human/audience", options), first);
  assert.deepEqual((await agentClient.getAgentView(agent.agent_token)).board.question, first.table.board.question);
});
