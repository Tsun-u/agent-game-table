import assert from "node:assert/strict";
import test from "node:test";

import { bigTwoPlayBeats, classifyBigTwoPlay, enumerateLegalBigTwoPlays } from "../src/big-two.js";
import { createDeck, parseCard } from "../src/cards.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";

const cards = (...codes: string[]) => codes.map(parseCard);

test("a deck contains 52 unique cards in Big Two rank and suit order", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.code)).size, 52);
  assert.equal(deck[0]?.code, "♦3");
  assert.equal(deck.at(-1)?.code, "♠2");
});

test("singles and pairs compare by rank then suit", () => {
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♠9")), classifyBigTwoPlay(cards("♥9"))), true);
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♦10")), classifyBigTwoPlay(cards("♠9"))), true);
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♦K", "♠K")), classifyBigTwoPlay(cards("♣K", "♥K"))), true);
});

test("all supported five-card hands are classified and ranked", () => {
  const straight = classifyBigTwoPlay(cards("♦3", "♣4", "♥5", "♠6", "♦7"));
  const flush = classifyBigTwoPlay(cards("♥3", "♥6", "♥8", "♥J", "♥K"));
  const fullHouse = classifyBigTwoPlay(cards("♦9", "♣9", "♥9", "♦4", "♣4"));
  const fourKind = classifyBigTwoPlay(cards("♦Q", "♣Q", "♥Q", "♠Q", "♦3"));
  const straightFlush = classifyBigTwoPlay(cards("♠6", "♠7", "♠8", "♠9", "♠10"));
  assert.equal(bigTwoPlayBeats(flush, straight), true);
  assert.equal(bigTwoPlayBeats(fullHouse, flush), true);
  assert.equal(bigTwoPlayBeats(fourKind, fullHouse), true);
  assert.equal(bigTwoPlayBeats(straightFlush, fourKind), true);
  assert.equal(
    bigTwoPlayBeats(straight, classifyBigTwoPlay(cards("♦A", "♣2", "♥3", "♠4", "♦5"))),
    true,
    "A-2-3-4-5 is the lowest straight",
  );
  assert.throws(() => classifyBigTwoPlay(cards("♦2", "♣3", "♥4", "♠5", "♦6")), /不是順子/);
});

test("legal play enumeration follows the opening card and current pile", () => {
  const hand = cards("♦3", "♣3", "♥3", "♦4", "♣4", "♥5", "♠6", "♦7");
  const opening = enumerateLegalBigTwoPlays(hand, null, "♦3");
  assert.equal(opening.length > 0, true);
  assert.equal(opening.every((play) => play.cards.some((card) => card.code === "♦3")), true);
  assert.equal(opening.some((play) => play.cards.map((card) => card.code).join(" ") === "♦3 ♣3"), true);

  const current = classifyBigTwoPlay(cards("♣4"));
  const replies = enumerateLegalBigTwoPlays(hand, current, null);
  assert.equal(replies.every((play) => play.cards.length === 1 && bigTwoPlayBeats(play, current)), true);
  assert.deepEqual(replies.map((play) => play.cards[0]?.code), ["♥5", "♠6", "♦7"]);
});

test("four mixed human and Agent seats never expose opponents' cards", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  const friend = store.joinHuman(owner.table.join_code, "小明");
  const agentA = store.joinAgent(owner.table.join_code, "Agent A");
  const agentB = store.joinAgent(owner.table.join_code, "Agent B");
  const opened = store.startRound(owner.human_token, agentB.table.version, "bigtwo-start-001");
  const views = [
    store.getHumanView(owner.human_token),
    store.getHumanView(friend.human_token),
    store.getAgentView(agentA.agent_token),
    store.getAgentView(agentB.agent_token),
  ];
  for (const view of views) {
    const you = view.players.find((seat) => seat.is_you)!;
    assert.equal(you.cards.length, 13);
    for (const opponent of view.players.filter((seat) => !seat.is_you)) assert.deepEqual(opponent.cards, []);
    assert.equal(JSON.stringify(view).includes('"deck"'), false);
  }
  const activeView = views.find((view) => view.viewer_seat_id === opened.active_seat_id)!;
  assert.equal(activeView.players.find((seat) => seat.is_you)?.cards.includes("♦3"), true);
});
