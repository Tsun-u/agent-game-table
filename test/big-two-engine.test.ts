import assert from "node:assert/strict";
import test from "node:test";

import { createDeck } from "../src/cards.js";
import { DEFAULT_BIG_TWO_RULE_OPTIONS } from "../src/big-two.js";
import { bigTwoEngine, bigTwoStake, type BigTwoBoard, type BigTwoState } from "../src/engine/big-two-engine.js";
import { engineFor, listEngines } from "../src/engine/registry.js";

const OPTIONS = DEFAULT_BIG_TWO_RULE_OPTIONS;
const SEATS = ["seat-a", "seat-b", "seat-c"];

function dealt(seatIds = SEATS): BigTwoState {
  return bigTwoEngine.deal({ deck: createDeck(), seatIds, round: 1 }, OPTIONS).state;
}

function play(state: BigTwoState, seatId: string, cards: string[]) {
  return bigTwoEngine.apply(state, seatId, { action: "play_cards", cards }, OPTIONS);
}

function pass(state: BigTwoState, seatId: string) {
  return bigTwoEngine.apply(state, seatId, { action: "pass", cards: [] }, OPTIONS);
}

test("the registry exposes Big Two as the default engine", () => {
  assert.equal(engineFor("bigtwo"), bigTwoEngine);
  assert.deepEqual(listEngines().map((engine) => engine.mode), ["bigtwo"]);
  assert.throws(() => engineFor("mahjong"), /不支援的遊戲/);
});

test("dealing three players gives 17 cards each, one set-aside card, and the ♣3 holder the opening turn", () => {
  const { state, events } = bigTwoEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, OPTIONS);
  assert.equal(state.phase, "opening");
  for (const seatId of SEATS) assert.equal(state.hands[seatId]!.length, 17);
  assert.equal(state.setAside.length, 1);
  assert.equal(state.openingRequiredCard, "♣3");
  assert.equal(state.hands[state.active!]!.includes("♣3"), true);
  assert.deepEqual(bigTwoEngine.pendingSeatIds(state), [state.active]);
  assert.equal(events[0]!.kind, "turn_started");
  assert.deepEqual(bigTwoEngine.legalActions(state, state.active!, OPTIONS).map((action) => action.action), ["play_cards"]);
  assert.equal(bigTwoEngine.legalPlays(state, state.active!, OPTIONS).every((legal) => legal.cards.includes("♣3")), true);
});

test("the first play must include the opening card and a follow-up must beat the pile", () => {
  const state = dealt();
  const leader = state.active!;
  const other = state.hands[leader]!.find((code) => code !== "♣3")!;
  assert.throws(() => play(state, leader, [other]), /第一手必須包含 ♣3/);
  const opened = play(state, leader, ["♣3"]);
  assert.equal(opened.state.phase, "trick");
  assert.deepEqual(opened.state.currentPlay, ["♣3"]);
  const next = opened.state.active!;
  assert.notEqual(next, leader);
  assert.equal(opened.events.map((event) => event.kind).includes("cards_played"), true);
  const weakest = "♣3";
  assert.throws(() => play(opened.state, next, [weakest]), /沒有 ♣3|沒有大過/);
  assert.throws(() => play(opened.state, leader, ["♦3"]), /不是你的回合/);
});

test("passing around the table returns the lead to the last player who played", () => {
  const state = dealt();
  const leader = state.active!;
  const opened = play(state, leader, ["♣3"]).state;
  const second = opass(opened);
  const third = opass(second.state);
  assert.equal(third.state.active, leader, "after everyone else passes the leader leads again");
  assert.equal(third.state.currentPlay, null);
  assert.equal(third.events.some((event) => event.kind === "trick_started"), true);
  assert.throws(() => pass(third.state, leader), /不能 pass/);
  function opass(current: BigTwoState) {
    return pass(current, current.active!);
  }
});

test("emptying a hand settles the round with doubled stakes for each remaining 2", () => {
  const seatIds = ["winner", "loser"];
  const state = dealt(seatIds);
  const winner = state.active!;
  const loser = seatIds.find((seatId) => seatId !== winner)!;
  const rigged: BigTwoState = {
    ...state, phase: "trick", openingRequiredCard: null,
    hands: { [winner]: ["♦5"], [loser]: ["♠2", "♥2", "♣4"] },
    status: { [winner]: "active", [loser]: "waiting" },
  };
  const settled = play(rigged, winner, ["♦5"]);
  assert.equal(settled.state.phase, "ended");
  assert.equal(settled.result?.winnerSeatId, winner);
  assert.deepEqual(settled.result?.scoreDelta, { [winner]: 12, [loser]: -12 });
  assert.equal(settled.result?.gameOver, false);
  assert.deepEqual(bigTwoEngine.pendingSeatIds(settled.state), []);
  assert.equal(bigTwoStake(["♠2", "♥2", "♣4"]), 12);
});

test("a seat leaving mid-round voids the round; after the round it is simply dropped from the state", () => {
  const state = dealt();
  assert.equal(bigTwoEngine.onSeatRemoved(state, state.active!, OPTIONS), "abort", "before the first play");
  const opened = play(state, state.active!, ["♣3"]).state;
  assert.equal(bigTwoEngine.onSeatRemoved(opened, opened.order[1]!, OPTIONS), "abort", "during a trick");
  const ended: BigTwoState = { ...opened, phase: "ended", active: null };
  const dropped = bigTwoEngine.onSeatRemoved(ended, ended.order[1]!, OPTIONS);
  assert.notEqual(dropped, "abort");
  if (dropped === "abort") return;
  assert.equal(dropped.state.order.length, 2);
  assert.equal(ended.order[1]! in dropped.state.hands, false);
  assert.deepEqual(bigTwoEngine.onSeatRemoved(ended, "stranger", OPTIONS), { state: ended, events: [], result: null });
});

test("state survives a serialize/restore round trip and the board hides other hands", () => {
  const state = play(dealt(), dealt().active!, ["♣3"]).state;
  const restored = bigTwoEngine.restore(JSON.parse(JSON.stringify(bigTwoEngine.serialize(state))));
  assert.deepEqual(restored, state);
  const board = bigTwoEngine.view(state, null, OPTIONS) as BigTwoBoard;
  assert.deepEqual(board.pile.cards, ["♣3"]);
  assert.equal(board.pile.hand_type, "單張");
  assert.equal("hands" in board, false, "the board never carries hidden hands");
  assert.equal(bigTwoEngine.hand(state, state.order[0]!).length > 0, true);
});
