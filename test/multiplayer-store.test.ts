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

test("a seated player can hand the seat to a spectator mid-round; the finisher takes that round's score", () => {
  const store = new MultiplayerTableStore(() => twoPlayerDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  const friend = store.joinHuman(owner.table.join_code, "小蝶");
  let view = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-sub-01");
  assert.equal(view.legal_actions.includes("invite_substitute"), true, "a seated player with spectators around may invite one");
  assert.equal(store.getHumanView(friend.human_token).legal_actions.includes("invite_substitute"), false);
  view = store.humanAction(owner.human_token, "play_cards", view.version, "sub-owner-play-1", ["♣3"]);
  const ownerHand = view.hand;

  assert.throws(() => store.humanInviteSubstitute(owner.human_token, agent.table.viewer_seat_id, view.version, "sub-invite-seated"), /只能邀請觀戰區/);
  view = store.humanInviteSubstitute(owner.human_token, friend.table.viewer_seat_id, view.version, "sub-invite-01");
  const invited = store.getHumanView(friend.human_token);
  assert.deepEqual(invited.substitute_invite, { from_seat_id: owner.table.viewer_seat_id, from_name: "阿童" });
  assert.equal(invited.legal_actions.includes("accept_substitute"), true);
  assert.throws(() => store.humanAcceptSubstitute(agent.agent_token as string, invited.version, "sub-accept-wrong"), /憑證無效/);

  const accepted = store.humanAcceptSubstitute(friend.human_token, invited.version, "sub-accept-01");
  assert.equal(accepted.viewer_role, "seated");
  assert.deepEqual(accepted.hand, ownerHand, "the substitute inherits the hand");
  assert.equal(accepted.substitute_invite, null);
  assert.deepEqual(accepted.players.map((seat) => seat.name), ["小蝶", "小葵"]);
  const ownerAfter = store.getHumanView(owner.human_token);
  assert.equal(ownerAfter.viewer_role, "spectator");
  assert.equal(ownerAfter.viewer_is_owner, true, "the table owner keeps owning the table from the spectator area");
  assert.equal(ownerAfter.hand.length, 0);

  // 小葵 pass 之後輪回小蝶，她把剩下的牌打完，本局分數落在她身上。
  let turn = store.getAgentView(agent.agent_token);
  const ranks = ["4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
  let friendView = store.agentAction(agent.agent_token, "pass", turn.version, "sub-agent-pass-0");
  friendView = store.getHumanView(friend.human_token);
  for (let index = 0; index < ranks.length; index += 1) {
    friendView = store.humanAction(friend.human_token, "play_cards", friendView.version, `sub-friend-card-${index}`, [`♣${ranks[index]}`]);
    if (friendView.phase === "ended") break;
    turn = store.getAgentView(agent.agent_token);
    store.agentAction(agent.agent_token, "pass", turn.version, `sub-agent-pass-${index + 1}`);
    friendView = store.getHumanView(friend.human_token);
  }
  assert.equal(friendView.phase, "ended");
  const winner = friendView.players.find((seat) => seat.name === "小蝶")!;
  assert.equal(winner.rounds_won, 1);
  assert.equal(winner.game_score > 0, true, "the substitute who finished the round gets its score");
  assert.equal(store.getHumanView(owner.human_token).players.some((seat) => seat.name === "阿童"), false);
  assert.equal(store.listTables()[0]!.players.map((seat) => seat.name).includes("阿童"), false);
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
  assert.equal(opened.legal_plays.every((play) => play.cards.includes("♣3")), true, "humans get legal plays too so the UI can grey out illegal cards");

  await store.waitForAgentEvents(first.agent_token, 0);
  await store.waitForAgentEvents(second.agent_token, 0);
  const firstWait = store.waitForAgentEvents(first.agent_token, 2_000);
  const secondWait = store.waitForAgentEvents(second.agent_token, 2_000);
  store.humanAction(owner.human_token, "play_cards", opened.version, "owner-play-01", ["♣3"]);
  const [firstNotice, secondNotice] = await Promise.all([firstWait, secondWait]);
  assert.equal(secondNotice.timed_out, true, "another player's card alone does not wake a seat whose turn has not come");
  assert.deepEqual(secondNotice.events, []);
  assert.equal(firstNotice.timed_out, false);
  assert.equal(firstNotice.your_turn, true);
  assert.equal(firstNotice.events.some((event) => event.kind === "cards_played" && event.actor_name === "阿童"), true);
  const you = firstNotice.table.players.find((seat) => seat.is_you)!;
  assert.equal(you.cards.length, you.hand_count);
  for (const other of firstNotice.table.players.filter((seat) => !seat.is_you)) assert.deepEqual(other.cards, []);
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

test("a complete two-player round scores the winner and starts the next round with that winner", async () => {
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
  const heard = await store.waitForAgentEvents(agent.agent_token, 0);
  const texts = heard.events.map((event) => event.text);
  assert.equal(texts.some((text) => text === "阿童 出完手牌，贏得第 1 局。"), true, "engine events are worded with the actor's name, never as 你");
  assert.equal(texts.some((text) => text.startsWith("輪到 阿童")), true);
  assert.equal(texts.some((text) => text.includes("輪到你")), false);
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

test("the same principal and name still sitting at another table is told that table's join code", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const first = store.createTable("A 桌人類");
  const second = store.createTable("B 桌人類");
  const joined = store.joinAgentForPrincipal(first.table.join_code, "阿宇", "member:tsunu@example.com");
  assert.throws(
    () => store.joinAgentForPrincipal(second.table.join_code, "阿宇", "member:tsunu@example.com"),
    new RegExp(`邀請碼 ${first.table.join_code}`),
  );
  store.leaveAgent(joined.agent_token);
  const moved = store.joinAgentForPrincipal(second.table.join_code, "阿宇", "member:tsunu@example.com");
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

test("after game_over the owner can start a new match at the same table with scores reset", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童", { end_mode: "rounds", end_rounds: 1 }, "jianhongdian");
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  store.startRound(owner.human_token, tableVersion(store, owner.human_token), "jh-match-start");
  for (let turn = 0; turn < 60; turn += 1) {
    const view = store.getHumanView(owner.human_token);
    if (view.phase !== "in_round") break;
    if (view.active_seat_id === view.viewer_seat_id) {
      store.humanAction(owner.human_token, "play_card", view.version, `jh-human-${turn}`, [...view.legal_plays[0]!.cards]);
    } else {
      const agentView = store.getAgentView(agent.agent_token);
      store.agentAction(agent.agent_token, "play_card", agentView.version, `jh-agent-${turn}`, [...agentView.legal_plays[0]!.cards]);
    }
  }
  const finished = store.getHumanView(owner.human_token);
  assert.equal(finished.phase, "game_over");
  assert.equal(finished.legal_actions.includes("start_round"), true, "the owner may start a new match");
  assert.equal(finished.players.some((seat) => seat.game_score !== 0), true, "the finished match carries scores");

  const restarted = store.startRound(owner.human_token, finished.version, "jh-match-again");
  assert.equal(restarted.phase, "in_round");
  assert.equal(restarted.round, 1, "the round counter restarts");
  assert.deepEqual(restarted.players.map((seat) => [seat.game_score, seat.rounds_won]), [[0, 0], [0, 0]]);
  assert.equal(restarted.players.length, 2, "seats survive the reset");
});

test("play_cards is accepted as an alias of play_card outside Big Two, for clients holding an old tool list", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童", undefined, "jianhongdian");
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小回");
  seatAgent(store, agent.agent_token);
  store.startRound(owner.human_token, tableVersion(store, owner.human_token), "alias-start");
  const view = store.getHumanView(owner.human_token);
  const play = view.legal_plays[0]!;
  assert.equal(play.action, "play_card");
  const after = store.humanAction(owner.human_token, "play_cards", view.version, "alias-play", [...play.cards]);
  assert.equal(after.version, view.version + 1, "the aliased action was applied");
  assert.equal(after.hand.length, view.hand.length - 1);
});

test("有椅子的遊戲可以挑位置，對面是搭檔，被佔會報錯", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("房主", undefined, "gongzhu");
  const a = store.joinAgent(owner.table.join_code, "阿宇");
  const b = store.joinAgent(owner.table.join_code, "小葵");
  store.humanTakeSeat(owner.human_token, tableVersion(store, owner.human_token), "chair-1", 0);
  store.agentTakeSeat(a.agent_token, tableVersion(store, owner.human_token), "chair-2", 2);
  assert.throws(() => store.agentTakeSeat(b.agent_token, tableVersion(store, owner.human_token), "chair-3", 2), /有人了/);
  assert.throws(() => store.agentTakeSeat(b.agent_token, tableVersion(store, owner.human_token), "chair-4", 4), /0 到 3/);
  const view = store.agentTakeSeat(b.agent_token, tableVersion(store, owner.human_token), "chair-5");
  assert.deepEqual(view.players.map((seat) => [seat.name, seat.position, seat.chair]), [["房主", 0, "北"], ["小葵", 1, "東"], ["阿宇", 2, "南"]], "沒帶位置就坐最小的空椅");
  assert.deepEqual(view.chairs?.map((chair) => [chair.chair, chair.name]), [["北", "房主"], ["東", "小葵"], ["南", "阿宇"], ["西", null]]);
});

test("沒有椅子的遊戲忽略位置參數", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("房主");
  const view = store.humanTakeSeat(owner.human_token, tableVersion(store, owner.human_token), "chair-1", 3);
  assert.equal(view.players[0]!.position, null);
  assert.equal(view.chairs, null);
});

test("合約橋牌：入座宣告制度、可改、觀戰者不能宣告，其他遊戲沒有制度", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("房主", undefined, "bridge");
  const agent = store.joinAgent(owner.table.join_code, "阿宇");
  assert.throws(() => store.agentSetBiddingSystem(agent.agent_token, "sayc", "sys-spectator-01"), /先入座/);
  let view = store.humanTakeSeat(owner.human_token, tableVersion(store, owner.human_token), "sys-seat-owner", 0);
  assert.equal(view.players[0]!.bidding_system, "sayc", "沒帶就是預設 SAYC");
  view = store.agentTakeSeat(agent.agent_token, tableVersion(store, owner.human_token), "sys-seat-agent", 2, "taiwan_5542");
  assert.deepEqual(view.players.map((seat) => seat.bidding_system), ["sayc", "taiwan_5542"]);
  assert.match(view.players[1]!.bidding_system_label ?? "", /5542/);
  assert.throws(() => store.agentSetBiddingSystem(agent.agent_token, "precision", "sys-bad-value-01"), /叫牌制度要是/);
  view = store.agentSetBiddingSystem(agent.agent_token, "taiwan_5533", "sys-change-agent");
  assert.equal(view.players[1]!.bidding_system, "taiwan_5533");
  assert.equal(view.bid_hint, null, "還沒開局沒有建議");

  const bigtwo = store.createTable("房主二");
  const seated = store.humanTakeSeat(bigtwo.human_token, tableVersion(store, bigtwo.human_token), "sys-bigtwo-seat", 0, "sayc");
  assert.equal(seated.players[0]!.bidding_system, null, "大老二不記制度");
  assert.throws(() => store.humanSetBiddingSystem(bigtwo.human_token, "sayc", "sys-bigtwo-set"), /只有合約橋牌/);
});

test("合約橋牌：叫牌階段只有輪到的人拿到 bid_hint，而且建議一定合法", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("房主", undefined, "bridge");
  const tokens = [owner.human_token, ...["東", "南", "西"].map((name) => store.joinHuman(owner.table.join_code, name).human_token)];
  for (const [position, token] of tokens.entries()) store.humanTakeSeat(token, tableVersion(store, owner.human_token), `hint-seat-${position}`, position);
  store.startRound(owner.human_token, tableVersion(store, owner.human_token), "hint-start-01");
  const dealer = store.getHumanView(owner.human_token);
  assert.equal(dealer.legal_actions.includes("bid"), true);
  assert.notEqual(dealer.bid_hint, null, "輪到的人有建議");
  const hint = dealer.bid_hint!;
  const legal = hint.call === "PASS" ? dealer.legal_actions.includes("pass") : dealer.legal_plays.some((play) => play.cards[0] === hint.call);
  assert.equal(legal, true, `建議 ${hint.call} 要在合法清單裡`);
  assert.match(hint.reason, /點/);
  assert.equal(store.getHumanView(tokens[1]!).bid_hint, null, "還沒輪到的人沒有建議");
});

function wordTable(store: MultiplayerTableStore, mode = "saysamething", options: unknown = { turn_seconds: 30 }) {
  const owner = store.createTable("阿童", options, mode);
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  const spectator = store.joinHuman(owner.table.join_code, "小蝶");
  const view = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "start-word-game");
  return { owner, agent, spectator, view };
}

test("觀眾動作：人類與 Agent 的冪等、版本及入座者交由引擎拒絕", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  try {
    const { owner, agent, spectator, view } = wordTable(store, "syncquiz", { turn_seconds: 0 });
    const watcher = store.joinAgent(view.join_code, "觀眾阿宇");
    const version = store.getHumanView(spectator.human_token).version;
    const first = store.humanAudienceAction(spectator.human_token, "submit_question", version, "human-question-01", ["  野餐帶什麼？  "]);
    assert.equal(first.version, version + 1);
    assert.equal(first.board.queue_length, 1);
    assert.deepEqual(store.humanAudienceAction(spectator.human_token, "submit_question", version, "human-question-01", ["野餐帶什麼？"]), first);
    assert.equal(store.humanAudienceAction(spectator.human_token, "submit_question", version, "human-question-02", ["早餐？"]).board.queue_length, 2);
    assert.throws(() => store.humanAudienceAction(spectator.human_token, "submit_question", first.version, "human-question-01", ["不同題目"]), /不同操作/);
    const second = store.agentAudienceAction(watcher.agent_token, "submit_question", first.version, "agent-question-01", ["早餐吃什麼？"]);
    assert.equal(second.board.queue_length, 3);
    assert.deepEqual(store.agentAudienceAction(watcher.agent_token, "submit_question", first.version, "agent-question-01", ["早餐吃什麼？"]), second);
    assert.throws(() => store.agentAction(watcher.agent_token, "submit_question", second.version, "agent-question-01", ["早餐吃什麼？"]), /不同操作/);
    assert.throws(() => store.humanAudienceAction(owner.human_token, "submit_question", second.version, "seated-question-01", ["題目"]), /入座者不能出題/);
    assert.throws(() => store.agentAudienceAction(agent.agent_token, "submit_question", second.version, "seated-question-02", ["題目"]), /入座者不能出題/);
  } finally {
    store.close();
  }
});

test("觀眾動作：還沒開過局與沒有觀眾介面的遊戲報錯", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童", {}, "syncquiz");
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  const version = store.getHumanView(owner.human_token).version;
  assert.throws(() => store.humanAudienceAction(owner.human_token, "submit_question", version, "before-start-human", ["題目"]), /局開始後才能出題/);
  assert.throws(() => store.agentAudienceAction(agent.agent_token, "submit_question", version, "before-start-agent", ["題目"]), /局開始後才能出題/);
  const other = wordTable(store, "bigtwo", {});
  assert.throws(() => store.humanAudienceAction(other.spectator.human_token, "submit_question", other.view.version, "unsupported-game", ["題目"]), /這個遊戲不支援觀眾動作/);
  store.close();
});

test("觀眾出題：waiting_question 保持局中、出題啟動計時並喚醒 Agent", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, agent, spectator, view } = wordTable(store, "syncquiz", { audience_only: true });
  assert.equal(view.phase, "in_round");
  assert.equal(view.board.phase, "waiting_question");
  assert.equal(view.turn_deadline_at, null);
  await store.waitForAgentEvents(agent.agent_token, 0);
  const waiting = store.waitForAgentEvents(agent.agent_token, 90_000);
  const next = store.humanAudienceAction(spectator.human_token, "submit_question", view.version, "wake-question-01", ["午餐吃什麼？"]);
  assert.equal(next.board.phase, "answering");
  assert.match(next.turn_deadline_at!, /\+08:00$/);
  const notice = await waiting;
  assert.equal(notice.your_turn, true);
  assert.equal(notice.table.version, next.version);
  assert.deepEqual(next.board.question, { text: "午餐吃什麼？", author: "小蝶" });
  context.mock.timers.tick(30_000);
  const after = store.getHumanView(owner.human_token);
  assert.equal(after.board.phase, "waiting_question");
  assert.equal(after.turn_deadline_at, null);
});

test("默契考驗：局間出題、剩餘佇列與快照可帶到下一局及整場重來", () => {
  let snapshot: any;
  const persistence = { load: () => snapshot ? structuredClone(snapshot) : null, save: (value: unknown) => { snapshot = structuredClone(value); } };
  const store = new MultiplayerTableStore(() => createDeck(), { persistence });
  const { owner, agent, spectator } = wordTable(store, "syncquiz", { questions_per_round: 3, turn_seconds: 0 });
  let view = store.getHumanView(owner.human_token);
  for (let i = 0; i < 3; i++) {
    view = store.humanAction(owner.human_token, "submit_answer", view.version, `carry-human-${i}`, ["飯"]);
    view = store.agentAction(agent.agent_token, "submit_answer", view.version, `carry-agent-${i}`, ["飯"]);
  }
  view = store.humanAction(owner.human_token, "finish_round", view.version, "carry-finish-human");
  view = store.agentAction(agent.agent_token, "finish_round", view.version, "carry-finish-agent");
  assert.equal(view.phase, "ended");
  view = store.humanAudienceAction(spectator.human_token, "submit_question", view.version, "between-question-1", ["下一局題目"]);
  view = store.humanAudienceAction(spectator.human_token, "submit_question", view.version, "between-question-2", ["剩餘題目"]);
  snapshot.tables[0].phase = "game_over";
  store.close();
  const restored = new MultiplayerTableStore(() => createDeck(), { persistence });
  try {
    view = restored.startRound(owner.human_token, view.version, "carry-next-round");
    assert.equal(view.round, 1);
    assert.deepEqual(view.board.question, { text: "下一局題目", author: "小蝶" });
    assert.equal(view.board.queue_length, 1);
    assert.ok(view.players.every((seat) => seat.game_score === 0));
  } finally {
    restored.close();
  }
});

test("回合計時：已交卷不延後期限，逾時揭曉、版本加一、喚醒與存檔", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let saved: any;
  const store = new MultiplayerTableStore(() => createDeck(), { persistence: { load: () => null, save: (s) => { saved = structuredClone(s); } } });
  context.after(() => store.close());
  const { owner, agent, view } = wordTable(store);
  await store.waitForAgentEvents(agent.agent_token, 0);
  context.mock.timers.tick(10_000);
  const submitted = store.agentAction(agent.agent_token, "submit_word", view.version, "timed-word-submit", ["玉兔"]);
  assert.equal(submitted.turn_deadline_at, view.turn_deadline_at);
  await store.waitForAgentEvents(agent.agent_token, 0);
  const waiting = store.waitForAgentEvents(agent.agent_token, 90_000);
  context.mock.timers.tick(19_999);
  assert.equal(store.getHumanView(owner.human_token).version, submitted.version);
  context.mock.timers.tick(1);
  const after = store.getHumanView(owner.human_token);
  assert.equal(after.version, submitted.version + 1);
  const chain = after.board.chain as { words: Record<string, string | null> }[];
  assert.deepEqual(chain[0]!.words, { [owner.table.viewer_seat_id]: null, [agent.table.viewer_seat_id]: "玉兔" });
  assert.equal((await waiting).your_turn, true);
  assert.equal(saved.tables[0].version, after.version);
  assert.equal(saved.tables[0].turnDeadlineAt, after.turn_deadline_at);
  assert.ok(saved.tables[0].turnTimerKey);
});

test("回合計時：切換 key 取消舊計時，投票逾時後重新計時", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, agent, view } = wordTable(store);
  let next = store.humanAction(owner.human_token, "submit_word", view.version, "key-word-human", ["玉兔"]);
  next = store.agentAction(agent.agent_token, "submit_word", next.version, "key-word-agent", ["月兔"]);
  context.mock.timers.tick(10_000);
  next = store.humanAction(owner.human_token, "claim_same", next.version, "key-claim-same");
  const judgingVersion = next.version;
  const judgingDeadline = next.turn_deadline_at;
  context.mock.timers.tick(20_000);
  next = store.getHumanView(owner.human_token);
  assert.equal(next.board.phase, "judging");
  assert.equal(next.version, judgingVersion);
  assert.equal(next.turn_deadline_at, judgingDeadline);
  context.mock.timers.tick(10_000);
  next = store.getHumanView(owner.human_token);
  assert.equal(next.board.phase, "writing");
  assert.equal(next.version, judgingVersion + 1);
  assert.notEqual(next.turn_deadline_at, judgingDeadline);
});

for (const elapsed of [10_000, 40_000]) test(`快照還原：保留截止時間，經過 ${elapsed} 毫秒後重新排程或立即到期`, (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let snapshot: unknown = null;
  const persistence = { load: () => structuredClone(snapshot), save: (s: unknown) => { snapshot = structuredClone(s); } };
  const original = new MultiplayerTableStore(() => createDeck(), { persistence });
  const { owner, agent, view } = wordTable(original);
  const submitted = original.agentAction(agent.agent_token, "submit_word", view.version, "restore-word-submit", ["玉兔"]);
  original.close();
  context.mock.timers.tick(elapsed);
  const restored = new MultiplayerTableStore(() => createDeck(), { persistence });
  context.after(() => restored.close());
  if (elapsed < 30_000) {
    assert.equal(restored.getHumanView(owner.human_token).turn_deadline_at, submitted.turn_deadline_at);
    context.mock.timers.tick(19_999);
    assert.equal(restored.getHumanView(owner.human_token).version, submitted.version);
    context.mock.timers.tick(1);
  }
  const after = restored.getHumanView(owner.human_token);
  assert.equal(after.board.turn, 2);
  assert.equal(after.version, submitted.version + 1);
  assert.equal((after.board.chain as unknown[]).length, 1);
});

test("回合計時：結算、離桌、刪桌與 Host 關閉都清除計時", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MultiplayerTableStore(() => createDeck());
  const settled = wordTable(store);
  let view = store.humanAction(settled.owner.human_token, "submit_word", settled.view.version, "settle-human", ["同"]);
  view = store.agentAction(settled.agent.agent_token, "submit_word", view.version, "settle-agent", ["同"]);
  assert.equal(view.turn_deadline_at, null);
  const departed = wordTable(store);
  store.leaveAgent(departed.agent.agent_token);
  assert.equal(store.getHumanView(departed.owner.human_token).turn_deadline_at, null);
  const deleted = wordTable(store);
  store.closeTable(deleted.view.table_id);
  const closed = wordTable(store);
  const version = closed.view.version;
  store.close();
  context.mock.timers.tick(60_000);
  assert.equal(store.getHumanView(settled.owner.human_token).version, view.version);
  assert.equal(store.getHumanView(closed.owner.human_token).version, version);
  assert.throws(() => store.getHumanView(deleted.owner.human_token), /憑證無效|找不到/);
});

test("聯想收束：交卷後仍可提上一輪同義，投票可喚醒已等待的 Agent", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, agent, view } = wordTable(store, "saysamething", { turn_seconds: 0 });
  let next = store.humanAction(owner.human_token, "submit_word", view.version, "claim-word-human", ["玉兔"]);
  next = store.agentAction(agent.agent_token, "submit_word", next.version, "claim-word-agent", ["月兔"]);
  next = store.humanAction(owner.human_token, "submit_word", next.version, "claim-next-human", ["新詞"]);
  await store.waitForAgentEvents(agent.agent_token, 0);
  const waiting = store.waitForAgentEvents(agent.agent_token, 90_000);
  next = store.humanAction(owner.human_token, "claim_same", next.version, "claim-after-submit");
  assert.equal(next.board.phase, "judging");
  const notice = await waiting;
  assert.equal(notice.your_turn, true);
  assert.equal(notice.table.board.phase, "judging");
  next = store.agentAction(agent.agent_token, "agree_same", next.version, "claim-agent-agree");
  assert.equal(next.phase, "ended");
});

test("同時行動：兩人用同一版本交詞成功並揭曉", (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, agent, view } = wordTable(store, "saysamething", { turn_seconds: 0 });
  const first = store.humanAction(owner.human_token, "submit_word", view.version, "sync-word-a", ["玉兔"]);
  assert.equal(first.board.turn, 1);
  const revealed = store.agentAction(agent.agent_token, "submit_word", view.version, "sync-word-b", ["月兔"]);
  assert.equal(revealed.version, view.version + 2);
  assert.equal(revealed.board.turn, 2);
  assert.equal((revealed.board.chain as unknown[]).length, 1);
});

test("同時行動：揭曉後拒絕上一輪版本的交詞", (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, agent, view } = wordTable(store, "saysamething", { turn_seconds: 0 });
  const beforeReveal = store.humanAction(owner.human_token, "submit_word", view.version, "stale-word-a", ["玉兔"]);
  store.agentAction(agent.agent_token, "submit_word", beforeReveal.version, "stale-word-b", ["月兔"]);
  assert.throws(() => store.humanAction(owner.human_token, "submit_word", beforeReveal.version, "stale-next-word", ["兔子"]), /版本衝突/);
});

test("同時行動：計時揭曉後拒絕到期前版本的交詞", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, agent, view } = wordTable(store);
  const beforeTimeout = store.agentAction(agent.agent_token, "submit_word", view.version, "timeout-word", ["月兔"]);
  context.mock.timers.tick(30_000);
  assert.equal(store.getHumanView(owner.human_token).board.turn, 2);
  assert.throws(() => store.humanAction(owner.human_token, "submit_word", beforeTimeout.version, "timeout-stale-word", ["玉兔"]), /版本衝突/);
});

test("同時行動：三人提同義後另外兩人以同一版本投票成功", (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const owner = store.createTable("阿童", { turn_seconds: 0 }, "saysamething");
  seatHuman(store, owner.human_token);
  const agents = ["小葵", "阿宇"].map((name) => store.joinAgent(owner.table.join_code, name));
  for (const agent of agents) seatAgent(store, agent.agent_token);
  let view = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "vote-start");
  view = store.humanAction(owner.human_token, "submit_word", view.version, "vote-word-owner", ["玉兔"]);
  for (const [i, agent] of agents.entries()) view = store.agentAction(agent.agent_token, "submit_word", view.version, `vote-word-${i}`, [i ? "白兔" : "月兔"]);
  const beforeClaim = view.version;
  view = store.humanAction(owner.human_token, "claim_same", view.version, "vote-claim");
  assert.throws(() => store.agentAction(agents[0]!.agent_token, "agree_same", beforeClaim, "vote-before-claim"), /版本衝突/);
  const version = view.version;
  const first = store.agentAction(agents[0]!.agent_token, "agree_same", version, "vote-first");
  assert.equal(first.board.phase, "judging");
  const last = store.agentAction(agents[1]!.agent_token, "agree_same", version, "vote-last");
  assert.equal(last.phase, "ended");
});

test("同時行動：傷心小棧四人以同一版本傳牌，出牌時拒絕傳牌版本", (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const owner = store.createTable("阿童", {}, "hearts");
  const tokens = [owner.human_token];
  seatHuman(store, owner.human_token);
  for (const name of ["小葵", "阿宇", "小煜"]) {
    const player = store.joinHuman(owner.table.join_code, name);
    tokens.push(player.human_token);
    seatHuman(store, player.human_token);
  }
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "passing-start");
  assert.equal(opened.board.phase, "passing");
  for (const [i, token] of tokens.entries()) {
    const view = store.getHumanView(token);
    store.humanAction(token, "pass_cards", opened.version, `passing-${i}`, view.hand.slice(0, 3));
  }
  const current = store.getHumanView(owner.human_token);
  assert.equal(current.version, opened.version + 4);
  assert.equal(current.board.phase, "trick");
  const active = tokens.find((token) => store.getHumanView(token).viewer_seat_id === current.active_seat_id)!;
  const play = store.getHumanView(active).legal_plays[0]!;
  assert.throws(() => store.humanAction(active, "play_card", opened.version, "passing-stale-play", [...play.cards]), /版本衝突/);
});

test("版本回歸：大老二輪流出牌維持嚴格檢查", (context) => {
  const store = new MultiplayerTableStore(() => twoPlayerDeck());
  context.after(() => store.close());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const agent = store.joinAgent(owner.table.join_code, "小葵");
  seatAgent(store, agent.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "strict-start");
  store.humanAction(owner.human_token, "play_cards", opened.version, "strict-play", ["♣3"]);
  assert.throws(() => store.agentAction(agent.agent_token, "pass", opened.version, "strict-stale-pass"), /版本衝突/);
});

test("同時行動：默契考驗交答案後觀眾仍可以舊版本出題", (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  context.after(() => store.close());
  const { owner, spectator, view } = wordTable(store, "syncquiz", { turn_seconds: 0 });
  store.humanAction(owner.human_token, "submit_answer", view.version, "audience-answer", ["飯"]);
  const queued = store.humanAudienceAction(spectator.human_token, "submit_question", view.version, "audience-old-version", ["早餐吃什麼？"]);
  assert.equal(queued.board.queue_length, 1);
  assert.equal(queued.version, view.version + 2);
});
