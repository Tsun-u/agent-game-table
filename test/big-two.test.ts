import assert from "node:assert/strict";
import test from "node:test";

import { bigTwoPlayBeats, classifyBigTwoPlay, enumerateLegalBigTwoPlays } from "../src/big-two.js";
import { createDeck, parseCard } from "../src/cards.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";
import { seatAgent, seatHuman, tableVersion } from "./helpers.js";

const cards = (...codes: string[]) => codes.map(parseCard);

test("a deck contains 52 unique cards in Big Two rank and suit order", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((card) => card.code)).size, 52);
  assert.equal(deck[0]?.code, "♣3");
  assert.equal(deck.at(-1)?.code, "♠2");
});

test("singles and pairs compare by rank then suit", () => {
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♠9")), classifyBigTwoPlay(cards("♥9"))), true);
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♦10")), classifyBigTwoPlay(cards("♠9"))), true);
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♦K", "♠K")), classifyBigTwoPlay(cards("♣K", "♥K"))), true);
});

test("all supported five-card hands are classified and ranked", () => {
  const straight = classifyBigTwoPlay(cards("♦3", "♣4", "♥5", "♠6", "♦7"));
  const fullHouse = classifyBigTwoPlay(cards("♦9", "♣9", "♥9", "♦4", "♣4"));
  const fourKind = classifyBigTwoPlay(cards("♦Q", "♣Q", "♥Q", "♠Q", "♦3"));
  const straightFlush = classifyBigTwoPlay(cards("♠6", "♠7", "♠8", "♠9", "♠10"));
  assert.equal(bigTwoPlayBeats(fullHouse, straight), true);
  assert.throws(() => classifyBigTwoPlay(cards("♥3", "♥6", "♥8", "♥J", "♥K")), /不是順子/, "flush is not a Taiwanese Big Two hand");
  assert.throws(() => classifyBigTwoPlay(cards("♦9", "♣9", "♥9")), /1、2 或 5 張/, "triples are not allowed");
  assert.equal(bigTwoPlayBeats(fourKind, fullHouse), true);
  assert.equal(bigTwoPlayBeats(straightFlush, fourKind), true);
  assert.equal(
    bigTwoPlayBeats(straight, classifyBigTwoPlay(cards("♦A", "♣2", "♥3", "♠4", "♦5"))),
    true,
    "A-2-3-4-5 is the lowest straight",
  );
  const topStraight = classifyBigTwoPlay(cards("♦2", "♣3", "♥4", "♠5", "♦6"));
  assert.equal(bigTwoPlayBeats(topStraight, classifyBigTwoPlay(cards("♦10", "♣J", "♥Q", "♠K", "♠A"))), true, "2-3-4-5-6 is the highest straight");
  assert.throws(() => classifyBigTwoPlay(cards("♦J", "♣Q", "♥K", "♠A", "♦2")), /不是順子/, "J-Q-K-A-2 is not a straight");
});

test("host options change how five-card hands and bombs compare", () => {
  const single = classifyBigTwoPlay(cards("♠2"));
  const straight = classifyBigTwoPlay(cards("♦3", "♣4", "♥5", "♠6", "♦7"));
  const fullHouse = classifyBigTwoPlay(cards("♦9", "♣9", "♥9", "♦4", "♣4"));
  const fourKind = classifyBigTwoPlay(cards("♦Q", "♣Q", "♥Q", "♠Q", "♦3"));
  const straightFlush = classifyBigTwoPlay(cards("♠6", "♠7", "♠8", "♠9", "♠10"));

  assert.equal(bigTwoPlayBeats(fourKind, single), false, "default: five cards never beat a single");
  assert.equal(bigTwoPlayBeats(fullHouse, straight), true, "default: a full house beats a straight");

  const bombs = { bombs_beat_anything: true, five_card_same_kind_only: false };
  assert.equal(bigTwoPlayBeats(fourKind, single), false);
  assert.equal(bigTwoPlayBeats(fourKind, single, bombs), true, "bombs option: four of a kind beats a single 2");
  assert.equal(bigTwoPlayBeats(straightFlush, fourKind, bombs), true, "straight flush still beats four of a kind");
  assert.equal(bigTwoPlayBeats(fourKind, straightFlush, bombs), false, "four of a kind never beats a straight flush");
  assert.equal(bigTwoPlayBeats(fullHouse, single, bombs), false, "a full house is not a bomb");

  const sameKind = { bombs_beat_anything: false, five_card_same_kind_only: true };
  assert.equal(bigTwoPlayBeats(fullHouse, straight, sameKind), false, "same-kind option: a full house cannot beat a straight");
  assert.equal(bigTwoPlayBeats(fourKind, straight, sameKind), false, "same-kind option without bombs: four of a kind cannot beat a straight");
  assert.equal(bigTwoPlayBeats(classifyBigTwoPlay(cards("♦4", "♣5", "♥6", "♠7", "♦8")), straight, sameKind), true);

  const both = { bombs_beat_anything: true, five_card_same_kind_only: true };
  assert.equal(bigTwoPlayBeats(fourKind, straight, both), true, "both options: bombs still beat other five-card hands");
  assert.equal(bigTwoPlayBeats(straightFlush, fourKind, both), true, "both options: bombs still compare with each other");

  const hand = cards("♦Q", "♣Q", "♥Q", "♠Q", "♦3", "♥5");
  assert.equal(enumerateLegalBigTwoPlays(hand, single, null).length, 0, "default: nothing beats a single 2 with five cards");
  const bombPlays = enumerateLegalBigTwoPlays(hand, single, null, bombs);
  assert.equal(bombPlays.length, 2, "bombs option: both four-of-a-kind combinations are offered against a single");
  assert.equal(bombPlays.every((play) => play.kind === "four_kind"), true);
});

test("legal play enumeration follows the opening card and current pile", () => {
  const hand = cards("♦3", "♣3", "♥3", "♦4", "♣4", "♥5", "♠6", "♦7");
  const opening = enumerateLegalBigTwoPlays(hand, null, "♣3");
  assert.equal(opening.length > 0, true);
  assert.equal(opening.every((play) => play.cards.some((card) => card.code === "♣3")), true);
  assert.equal(opening.some((play) => play.cards.map((card) => card.code).join(" ") === "♣3 ♦3"), true);

  const current = classifyBigTwoPlay(cards("♣4"));
  const replies = enumerateLegalBigTwoPlays(hand, current, null);
  assert.equal(replies.every((play) => play.cards.length === 1 && bigTwoPlayBeats(play, current)), true);
  assert.deepEqual(replies.map((play) => play.cards[0]?.code), ["♦4", "♥5", "♠6", "♦7"]);
});

test("four mixed human and Agent seats never expose opponents' cards", () => {
  const store = new MultiplayerTableStore(() => createDeck());
  const owner = store.createTable("阿童");
  seatHuman(store, owner.human_token);
  const friend = store.joinHuman(owner.table.join_code, "小明");
  seatHuman(store, friend.human_token);
  const agentA = store.joinAgent(owner.table.join_code, "Agent A");
  seatAgent(store, agentA.agent_token);
  const agentB = store.joinAgent(owner.table.join_code, "Agent B");
  seatAgent(store, agentB.agent_token);
  const opened = store.startRound(owner.human_token, tableVersion(store, owner.human_token), "bigtwo-start-001");
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
  assert.equal(activeView.players.find((seat) => seat.is_you)?.cards.includes("♣3"), true);
});
