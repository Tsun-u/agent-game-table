import assert from "node:assert/strict";
import test from "node:test";

import { createDeck, type Card } from "../src/cards.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";
import { seatAgent, seatHuman, tableVersion } from "./helpers.js";

test("everyone enters as a spectator, at most 4 sit, and seats only change between rounds", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  assert.deepEqual(owner.table.players, []);
  assert.equal(owner.table.viewer_role, "spectator");
  assert.equal(owner.table.legal_actions.includes("take_seat"), true);
  assert.equal(owner.table.legal_actions.includes("start_round"), true, "the owner manages the table without sitting");
  seatHuman(store, owner.human_token);
  const friend = store.joinHuman(owner.table.join_code, "朋友");
  const first = store.joinAgent(owner.table.join_code, "小葵");
  const second = store.joinAgent(owner.table.join_code, "阿宇");
  const fifth = store.joinAgent(owner.table.join_code, "第五位");
  seatHuman(store, friend.human_token);
  seatAgent(store, first.agent_token);
  seatAgent(store, second.agent_token);
  assert.throws(() => seatAgent(store, fifth.agent_token), /四個座位/);
  let view = store.getHumanView(owner.human_token);
  assert.equal(view.players.length, 4);
  assert.deepEqual(view.spectators.map((member) => member.name), ["第五位"]);
  assert.equal(store.getAgentView(fifth.agent_token).legal_actions.includes("take_seat"), false);

  store.humanLeaveSeat(friend.human_token, view.version, "friend-stands-up");
  seatAgent(store, fifth.agent_token);
  view = store.getHumanView(owner.human_token);
  assert.deepEqual(view.players.map((seat) => seat.name), ["阿童", "小葵", "阿宇", "第五位"], "seat order follows sitting order");
  assert.deepEqual(view.spectators.map((member) => member.name), ["朋友"]);

  const opened = store.startRound(owner.human_token, view.version, "start-seats-01");
  assert.throws(() => store.humanLeaveSeat(owner.human_token, opened.version, "leave-mid-round"), /進行中/);
  const late = store.joinAgent(owner.table.join_code, "中途進來");
  assert.equal(late.table.viewer_role, "spectator");
  assert.deepEqual(late.table.legal_actions, [], "spectators cannot sit while a round is running");
  assert.throws(() => store.agentTakeSeat(late.agent_token, late.table.version, "late-seat"), /進行中/);
  assert.equal(late.table.players.every((seat) => seat.cards.length === 0), true, "spectators never see a hand");
});

test("one email is one identity: a re-login with a new client_id reconnects the same named Agent", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const created = store.createTable("阿童");
  const first = store.joinAgentForPrincipal(created.table.join_code, "小光", "member:tong@example.com", "client-before-restart");
  const second = store.joinAgentForPrincipal(created.table.join_code, "小光", "member:tong@example.com", "client-after-restart");
  assert.equal(second.table.viewer_seat_id, first.table.viewer_seat_id);
  assert.throws(() => store.getAgentView(first.agent_token), /憑證無效/, "the older session is revoked");

  const other = store.joinAgentForPrincipal(created.table.join_code, "小燈", "member:tong@example.com", "claude-ai-client");
  assert.notEqual(other.table.viewer_seat_id, first.table.viewer_seat_id, "a different agent_name under the same email is a second Agent");
  assert.equal(store.resumeAgentForPrincipal("member:tong@example.com", "claude-ai-client")?.table.viewer_seat_id, other.table.viewer_seat_id);
  assert.equal(store.resumeAgentForPrincipal("member:tong@example.com", "client-after-restart")?.table.viewer_seat_id, first.table.viewer_seat_id);
  assert.throws(() => store.resumeAgentForPrincipal("member:tong@example.com", "unknown-client"), /多個 Agent/);
  assert.throws(() => store.resumeAgentForPrincipal("member:tong@example.com"), /多個 Agent/);
});

test("a human can leave the table; the owner hands over to the next human or closes an empty table", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  const friend = store.joinHuman(owner.table.join_code, "小蝶");
  const agent = store.joinAgent(owner.table.join_code, "小光");

  const handedOver = store.leaveHuman(owner.human_token);
  assert.equal(handedOver.table_closed, false);
  assert.throws(() => store.getHumanView(owner.human_token), /憑證無效/);
  const friendView = store.getHumanView(friend.human_token);
  assert.equal(friendView.viewer_is_owner, true);
  assert.equal(friendView.owner_name, "小蝶");
  assert.equal(friendView.spectators.some((member) => member.name === "阿童"), false);
  assert.equal(store.getAgentView(agent.agent_token).owner_name, "小蝶");

  const closed = store.leaveHuman(friend.human_token);
  assert.equal(closed.table_closed, true);
  assert.throws(() => store.getAgentView(agent.agent_token), /憑證無效|不存在/);
});

test("each Agent receives independent turn events and only its own hand", async () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const first = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, first.agent_token);
  const second = store.joinAgent(owner.table.join_code, "阿宇");
  seatAgent(store, second.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-events-01");
  assert.equal(opened.active_seat_id, opened.viewer_seat_id);
  assert.deepEqual(opened.legal_actions, ["play_cards"]);
  assert.deepEqual(opened.legal_plays, [], "human views do not need Agent move enumeration");

  await store.waitForAgentEvents(first.agent_token, 0);
  await store.waitForAgentEvents(second.agent_token, 0);
  const firstWait = store.waitForAgentEvents(first.agent_token, 2_000);
  const secondWait = store.waitForAgentEvents(second.agent_token, 2_000);
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-play-01", ["♣3"]);
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
  assert.equal(firstNotice.table.legal_plays.length > 0, true);
  assert.equal(firstNotice.table.legal_plays.every((play) => play.cards.length === 1), true);
  assert.equal(firstNotice.table.legal_plays.some((play) => play.cards[0] === "♣4"), true);
});

test("host options are fixed per table and drive Agent legal plays", () => {
  // 兩人局輪流發牌：偶數位給房主、奇數位給 Agent，讓 Agent 拿到四張 Q。
  const store = new MultiplayerTableStore(() => {
    const deck = createDeck();
    const pick = (code: string) => deck.splice(deck.findIndex((card) => card.code === code), 1)[0]!;
    const front = [pick("♣3"), pick("♦Q"), pick("♣4"), pick("♣Q"), pick("♣5"), pick("♥Q"), pick("♣6"), pick("♠Q")];
    return [...front, ...deck];
  });
  const owner = store.createTable("阿童", { bombs_beat_anything: true, five_card_same_kind_only: true });
  seatHuman(store, owner.human_token);
  assert.deepEqual(owner.table.rule_options, { bombs_beat_anything: true, five_card_same_kind_only: true });
  const plain = store.createTable("另一桌");
  assert.deepEqual(plain.table.rule_options, { bombs_beat_anything: false, five_card_same_kind_only: false });
  assert.throws(() => store.createTable("壞資料", { bombs_beat_anything: "yes" } as unknown as { bombs_beat_anything: boolean; five_card_same_kind_only: boolean }), /true 或 false/);

  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-options-01");
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-play-options", ["♣3"]);
  const view = store.getAgentView(agent.agent_token);
  assert.deepEqual(view.rule_options, owner.table.rule_options);
  assert.equal(view.legal_plays.some((play) => play.cards.length === 5), true, "with bombs on, a four of a kind is offered against a single");
  assert.equal(view.legal_plays.filter((play) => play.cards.length === 5).every((play) => play.hand_type === "鐵支" || play.hand_type === "同花順"), true);
});

test("card actions are idempotent and chat does not change the table version", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-idempotent-01");
  const chatted = store.agentSay(agent.agent_token, "想一下喔。", "chat-idempotent-01");
  assert.equal(chatted.version, opened.version);
  const played = store.humanAction(owner.human_token, "play_cards", opened.version, "play-idempotent-01", ["♣3"]);
  const replay = store.humanAction(owner.human_token, "play_cards", opened.version, "play-idempotent-01", ["♣3"]);
  assert.deepEqual(replay, played);
  assert.equal(played.players.find((seat) => seat.is_you)?.hand_count, 12);
});

test("an authorized reconnect replaces the old Agent capability", async () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const original = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, original.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-reconnect-01");
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-reconnect-play", ["♣3"]);
  await store.waitForAgentEvents(original.agent_token, 0);
  const pending = store.waitForAgentEvents(original.agent_token, 2_000);
  const ticket = store.createAgentReconnectTicket(owner.human_token, original.table.viewer_seat_id);
  const rejoined = store.rejoinAgent(owner.table.join_code, "小葵", ticket.reconnect_code);
  assert.equal((await pending).timed_out, true);
  assert.deepEqual(rejoined.table.legal_actions, ["play_cards", "pass"]);
  assert.throws(() => store.getAgentView(original.agent_token), /憑證無效/);
  assert.throws(() => store.rejoinAgent(owner.table.join_code, "小葵", ticket.reconnect_code), /無效或已過期/);
});

test("an Agent leaving mid-round voids the round without changing scores; removal after that just frees the seat", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const first = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, first.agent_token);
  const second = store.joinAgent(owner.table.join_code, "阿宇");
  seatAgent(store, second.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-leave-01");
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-leave-play", ["♣3"]);
  const departure = store.leaveAgent(first.agent_token);
  assert.deepEqual(store.leaveAgent(first.agent_token), departure);
  assert.throws(() => store.getAgentView(first.agent_token), /憑證無效/);
  const afterLeave = store.getAgentView(second.agent_token);
  assert.equal(afterLeave.phase, "ended", "leaving mid-round voids the round");
  assert.equal(afterLeave.active_seat_id, null);
  assert.deepEqual(afterLeave.pending_seat_ids, []);
  assert.equal(afterLeave.players.every((seat) => seat.game_score === 0), true, "a voided round scores nothing");

  const removed = store.removeAgentSeat(owner.human_token, second.table.viewer_seat_id, afterLeave.version, "remove-agent-01");
  assert.deepEqual(removed.players.map((seat) => seat.name), ["阿童"]);
  assert.equal(removed.phase, "ended");
  assert.throws(() => store.getAgentView(second.agent_token), /憑證無效/);
  assert.equal(removed.legal_actions.includes("start_round"), true, "the owner can deal again once enough players sit");
});

test("a complete two-player round scores the winner and starts the next round with that winner", () => {
  const store = new MultiplayerTableStore(() => twoPlayerDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  let view = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-finish-01");
  const ranks = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  for (let index = 0; index < ranks.length; index += 1) {
    view = store.humanAction(owner.human_token, "play_cards", view.version, `owner-card-${index}`, [`♣${ranks[index]}`]);
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
  assert.equal(next.legal_plays.every((play) => play.cards.includes("♣3")), true);
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
  const codes = ranks.flatMap((rank) => [`♣${rank}`, `♦${rank}`]);
  codes.push(...ranks.map((rank) => `♥${rank}`), ...ranks.map((rank) => `♠${rank}`));
  return codes.map((code) => createDeck().find((card) => card.code === code)!);
}

test("when the opening-card holder leaves before the first play, the round is voided and the owner can redeal", () => {
  const clubThree = createDeck().find((card) => card.code === "♣3")!;
  const others = createDeck().filter((card) => card.code !== "♣3");
  const deck: Card[] = [others[0]!, clubThree, ...others.slice(1)];
  const store = new MultiplayerTableStore(() => deck.map((card) => ({ ...card })));
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const leaver = store.joinAgent(owner.table.join_code, "小燈");
  seatAgent(store, leaver.agent_token);
  const stayer = store.joinAgent(owner.table.join_code, "阿宇");
  seatAgent(store, stayer.agent_token);
  store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-opening-leave-01");
  assert.equal(store.getAgentView(leaver.agent_token).active_seat_id, leaver.table.viewer_seat_id, "♣3 holder leads");

  store.leaveAgent(leaver.agent_token);
  const ownerView = store.getHumanView(owner.human_token);
  assert.equal(ownerView.phase, "ended");
  assert.equal(ownerView.round, 1);
  assert.equal(ownerView.players.every((seat) => seat.hand_count === 0), true, "hands are discarded after a voided round");
  assert.equal(store.getAgentView(stayer.agent_token).legal_plays.length, 0);
  const redeal = store.startRound(owner.human_token, ownerView.version, "start-opening-leave-02");
  assert.equal(redeal.round, 2);
  assert.equal(redeal.phase, "in_round");
  assert.equal(redeal.legal_plays.length === 0 || redeal.legal_plays.every((play) => play.cards.includes("♣3")), true);
});
