import assert from "node:assert/strict";
import test from "node:test";

import { createDeck, type Card } from "../src/cards.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";

test("2 to 4 humans and Agents can join, while a fifth seat is rejected", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  store.joinHuman(owner.table.join_code, "朋友");
  store.joinAgent(owner.table.join_code, "小葵");
  store.joinAgent(owner.table.join_code, "阿宇");
  assert.throws(() => store.joinAgent(owner.table.join_code, "第五位"), /最多 4/);
  assert.equal(store.getHumanView(owner.human_token).players.length, 4);
});

test("each Agent receives independent turn events and only its own hand", async () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  const first = store.joinAgent(owner.table.join_code, "小葵");
  const second = store.joinAgent(owner.table.join_code, "阿宇");
  const opened = store.startRound(owner.human_token, second.table.version, "start-events-01");
  assert.equal(opened.active_seat_id, opened.viewer_seat_id);
  assert.deepEqual(opened.legal_actions, ["play_cards"]);

  await store.waitForAgentEvents(first.agent_token, 0);
  await store.waitForAgentEvents(second.agent_token, 0);
  const firstWait = store.waitForAgentEvents(first.agent_token, 2_000);
  const secondWait = store.waitForAgentEvents(second.agent_token, 2_000);
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-play-01", ["♦3"]);
  const [firstNotice, secondNotice] = await Promise.all([firstWait, secondWait]);
  for (const notice of [firstNotice, secondNotice]) {
    assert.equal(notice.timed_out, false);
    assert.equal(notice.events.some((event) => event.kind === "cards_played" && event.actor_name === "阿童"), true);
    const you = notice.table.players.find((seat) => seat.is_you)!;
    assert.equal(you.cards.length, you.hand_count);
    for (const other of notice.table.players.filter((seat) => !seat.is_you)) assert.deepEqual(other.cards, []);
  }
  assert.equal(firstNotice.table.active_seat_id, first.table.viewer_seat_id);
  assert.deepEqual(firstNotice.table.legal_actions, ["play_cards", "pass"]);
});

test("card actions are idempotent and chat does not change the table version", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  const opened = store.startRound(owner.human_token, agent.table.version, "start-idempotent-01");
  const chatted = store.agentSay(agent.agent_token, "想一下喔。", "chat-idempotent-01");
  assert.equal(chatted.version, opened.version);
  const played = store.humanAction(owner.human_token, "play_cards", opened.version, "play-idempotent-01", ["♦3"]);
  const replay = store.humanAction(owner.human_token, "play_cards", opened.version, "play-idempotent-01", ["♦3"]);
  assert.deepEqual(replay, played);
  assert.equal(played.players.find((seat) => seat.is_you)?.hand_count, 12);
});

test("an authorized reconnect replaces the old Agent capability", async () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  const original = store.joinAgent(owner.table.join_code, "小葵");
  const opened = store.startRound(owner.human_token, original.table.version, "start-reconnect-01");
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-reconnect-play", ["♦3"]);
  await store.waitForAgentEvents(original.agent_token, 0);
  const pending = store.waitForAgentEvents(original.agent_token, 2_000);
  const ticket = store.createAgentReconnectTicket(owner.human_token, original.table.viewer_seat_id);
  const rejoined = store.rejoinAgent(owner.table.join_code, "小葵", ticket.reconnect_code);
  assert.equal((await pending).timed_out, true);
  assert.deepEqual(rejoined.table.legal_actions, ["play_cards", "pass"]);
  assert.throws(() => store.getAgentView(original.agent_token), /憑證無效/);
  assert.throws(() => store.rejoinAgent(owner.table.join_code, "小葵", ticket.reconnect_code), /無效或已過期/);
});

test("leaving or removing an Agent revokes its seat without stalling a round", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  const first = store.joinAgent(owner.table.join_code, "小葵");
  const second = store.joinAgent(owner.table.join_code, "阿宇");
  const opened = store.startRound(owner.human_token, second.table.version, "start-leave-01");
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-leave-play", ["♦3"]);
  const departure = store.leaveAgent(first.agent_token);
  assert.deepEqual(store.leaveAgent(first.agent_token), departure);
  assert.throws(() => store.getAgentView(first.agent_token), /憑證無效/);
  const afterLeave = store.getAgentView(second.agent_token);
  assert.equal(afterLeave.active_seat_id, second.table.viewer_seat_id);

  const removed = store.removeAgentSeat(owner.human_token, second.table.viewer_seat_id, afterLeave.version, "remove-agent-01");
  assert.deepEqual(removed.players.map((seat) => seat.name), ["阿童"]);
  assert.equal(removed.phase, "ended");
  assert.throws(() => store.getAgentView(second.agent_token), /憑證無效/);
});

test("a complete two-player round scores the winner and starts the next round with that winner", () => {
  const store = new MultiplayerTableStore(() => twoPlayerDeck());
  const owner = store.createTable("阿童");
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  let view = store.startRound(owner.human_token, agent.table.version, "start-finish-01");
  const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  for (let index = 0; index < ranks.length; index += 1) {
    view = store.humanAction(owner.human_token, "play_cards", view.version, `owner-card-${index}`, [`♦${ranks[index]}`]);
    if (view.phase === "ended") break;
    const agentView = store.getAgentView(agent.agent_token);
    view = store.agentAction(agent.agent_token, "pass", agentView.version, `agent-pass-${index}`);
  }
  assert.equal(view.phase, "ended");
  const winner = view.players.find((seat) => seat.is_you)!;
  assert.equal(winner.hand_count, 0);
  assert.equal(winner.rounds_won, 1);
  assert.equal(winner.game_score > 0, true);
  const next = store.startRound(owner.human_token, view.version, "start-finish-02");
  assert.equal(next.active_seat_id, owner.table.viewer_seat_id);
});

test("management closes one table without exposing cards or affecting another", async () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const first = store.createTable("A 桌人類");
  const second = store.createTable("B 桌人類");
  const joined = store.joinAgentForPrincipal(first.table.join_code, "小葵", "friend-xiaokui");
  const summaries = store.listTables();
  assert.equal(summaries.length, 2);
  assert.equal(JSON.stringify(summaries).includes('"cards"'), false);
  const waiting = store.waitForAgentEvents(joined.agent_token, 2_000);
  store.closeTable(first.table.table_id);
  assert.equal((await waiting).timed_out, true);
  assert.throws(() => store.getHumanView(first.human_token), /憑證無效/);
  const moved = store.joinAgentForPrincipal(second.table.join_code, "小葵", "friend-xiaokui");
  assert.equal(moved.table.table_id, second.table.table_id);
});

function twoPlayerDeck(): Card[] {
  const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  const codes = ranks.flatMap((rank) => [`♦${rank}`, `♣${rank}`]);
  codes.push(...ranks.map((rank) => `♥${rank}`), ...ranks.map((rank) => `♠${rank}`));
  return codes.map((code) => createDeck().find((card) => card.code === code)!);
}
