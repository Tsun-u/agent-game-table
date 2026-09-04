import assert from "node:assert/strict";
import test from "node:test";

import { createDeck, parseCard, type Card } from "../src/cards.js";
import { jianhongdianEngine, pairs, scoreJianhongdianRound, type JianhongdianBoard, type JianhongdianState } from "../src/engine/jianhongdian-engine.js";
import { baselinePoints, cardPoints, DEFAULT_JIANHONGDIAN_OPTIONS, normalizeJianhongdianOptions, totalPoints, type JianhongdianOptions } from "../src/engine/jianhongdian-rules.js";
import { engineFor } from "../src/engine/registry.js";

const SEATS = ["north", "east", "south", "west"];
const OPTS = DEFAULT_JIANHONGDIAN_OPTIONS;
const engine = jianhongdianEngine;

/** 前 28 張照順序給：24 張輪流發手牌（第 i 張給第 i % 4 席）、4 張桌面，接著是牌堆最上面幾張；其餘補滿。 */
function deckFrom(front: string[]): Card[] {
  const rest = createDeck().filter((card) => !front.includes(card.code));
  return [...front.map(parseCard), ...rest];
}

const NORTH = ["♥3", "♣2", "♣3", "♣4", "♣5", "♣6"];
const EAST = ["♠2", "♠5", "♠6", "♠8", "♠J", "♠Q"];
const SOUTH = ["♠3", "♣J", "♣Q", "♣K", "♦2", "♦3"];
const WEST = ["♠4", "♦4", "♦5", "♦6", "♦8", "♦10"];
const TABLE = ["♠7", "♦7", "♣9", "♥9"];
const roundRobin = Array.from({ length: 6 }, (_, index) => [NORTH[index]!, EAST[index]!, SOUTH[index]!, WEST[index]!]).flat();

function dealFixture(pileTop: string[], round = 1): JianhongdianState {
  return engine.deal({ deck: deckFrom([...roundRobin, ...TABLE, ...pileTop]), seatIds: SEATS, round }, OPTS).state;
}

test("pairing: A to 9 add to ten, tens and faces match their own rank, suits never matter", () => {
  for (const [left, right] of [["♥A", "♠9"], ["♦2", "♣8"], ["♥3", "♠7"], ["♦4", "♣6"], ["♥5", "♦5"], ["♠10", "♥10"], ["♠J", "♦J"], ["♣Q", "♥Q"], ["♠K", "♦K"]]) {
    assert.equal(pairs(left!, right!), true, `${left} pairs ${right}`);
  }
  assert.equal(pairs("♠10", "♥A"), false);
  assert.equal(pairs("♥A", "♠A"), false, "two aces add to 2, not 10");
  assert.equal(pairs("♠K", "♥Q"), false);
  assert.equal(pairs("♥9", "♠A"), true);
});

test("points: red cards by the table, black aces by the black_ace option, totals and baselines", () => {
  assert.equal(cardPoints("♥A", OPTS), 20);
  assert.equal(cardPoints("♦K", OPTS), 10);
  assert.equal(cardPoints("♦9", OPTS), 10);
  assert.equal(cardPoints("♥8", OPTS), 8);
  assert.equal(cardPoints("♥2", OPTS), 2);
  assert.equal(cardPoints("♠K", OPTS), 0);
  assert.equal(cardPoints("♠A", OPTS), 30);
  assert.equal(cardPoints("♣A", OPTS), 40);
  assert.equal(cardPoints("♣A", { black_ace: "spade" }), 0);
  assert.equal(cardPoints("♠A", { black_ace: "spade" }), 30);
  assert.equal(cardPoints("♠A", { black_ace: "none" }), 0);
  for (const blackAce of ["both", "spade", "none"] as const) {
    const options = { black_ace: blackAce };
    assert.equal(createDeck().reduce((sum, card) => sum + cardPoints(card.code, options), 0), totalPoints(options), `deck total for ${blackAce}`);
  }
  assert.equal(baselinePoints({ black_ace: "both" }, 4), 70);
  assert.equal(baselinePoints({ black_ace: "both" }, 3), 93.3);
  assert.equal(baselinePoints({ black_ace: "none" }, 4), 52.5);
  assert.equal(baselinePoints({ black_ace: "spade" }, 2), 120);
  const scores = scoreJianhongdianRound({ north: ["♥A", "♠A"], east: ["♦9"], south: [], west: ["♥2"] }, SEATS, OPTS);
  assert.deepEqual(scores, { north: -20, east: -60, south: -70, west: -68 });
});

test("options: defaults are rounds mode, 4 rounds, both black aces, peek on; bad values are rejected", () => {
  assert.deepEqual(normalizeJianhongdianOptions(undefined), { end_mode: "rounds", end_score: 100, end_rounds: 4, black_ace: "both", peek_bottom: true });
  assert.equal(normalizeJianhongdianOptions({ black_ace: "none", end_mode: "score", end_score: "150" }).end_score, 150);
  assert.throws(() => normalizeJianhongdianOptions({ black_ace: "red" }), /black_ace/);
  assert.throws(() => normalizeJianhongdianOptions({ end_rounds: 0 }), /end_rounds/);
  assert.equal(engineFor("jianhongdian").label, "撿紅點");
  assert.match(engine.formatRules(engine.buildRules(OPTS)), /叨牌：尾家看得到/);
});

test("dealing: hand sizes per player count, four table cards, a 24-card pile, first player rotates each round", () => {
  for (const [count, size] of [[2, 12], [3, 8], [4, 6]] as const) {
    const state = engine.deal({ deck: createDeck(), seatIds: SEATS.slice(0, count), round: 1 }, OPTS).state;
    for (const seatId of SEATS.slice(0, count)) assert.equal(state.hands[seatId]!.length, size, `${count} players get ${size} cards`);
    assert.equal(state.table.length, 4);
    assert.equal(state.pile.length, 24);
    assert.equal(state.active, "north");
  }
  const second = engine.deal({ deck: createDeck(), seatIds: SEATS, round: 2 }, OPTS).state;
  assert.equal(second.active, "east");
  assert.deepEqual(second.order, ["east", "south", "west", "north"]);
  assert.throws(() => engine.deal({ deck: createDeck(), seatIds: ["solo"], round: 1 }, OPTS), /2 到 4 位/);
});

test("legal plays: every hand card can be laid down, and each matching table card is a separate capture option", () => {
  const state = dealFixture(["♠A"]);
  const plays = engine.legalPlays(state, "north", OPTS);
  const heartThree = plays.filter((play) => play.cards[0] === "♥3").map((play) => play.cards);
  assert.deepEqual(heartThree, [["♥3"], ["♥3", "♠7"], ["♥3", "♦7"]]);
  assert.deepEqual(plays.filter((play) => play.cards[0] === "♣2").map((play) => play.cards), [["♣2"]], "♣2 pairs nothing on the table");
  assert.deepEqual(engine.legalPlays(state, "east", OPTS), [], "only the active seat has plays");
  assert.deepEqual(engine.legalActions(state, "north", OPTS).map((action) => action.action), ["play_card"]);
});

test("a turn captures with the hand card, then the flip takes the richest matching table card", () => {
  const state = dealFixture(["♠A"]);
  const turn = engine.apply(state, "north", { action: "play_card", cards: ["♥3", "♦7"] }, OPTS);
  assert.deepEqual(turn.state.captured.north, ["♥3", "♦7", "♠A", "♥9"], "♠A pairs both nines and prefers ♥9 (10 points) over ♣9");
  assert.deepEqual(turn.state.table, ["♠7", "♣9"]);
  assert.deepEqual(turn.state.lastFlip, { seatId: "north", card: "♠A", captured: "♥9" });
  assert.equal(turn.state.active, "east");
  assert.equal(turn.state.pile.length, 23);
  assert.match(turn.events[0]!.text, /用 ♥3 收走 ♦7，翻出 ♠A 收走 ♥9/);
  const board = engine.view(turn.state, "north", OPTS) as JianhongdianBoard;
  assert.equal(board.points_so_far.north, 50);
  assert.deepEqual(board.captured_points.north, ["♥3", "♦7", "♠A", "♥9"]);
  assert.equal(board.baseline, 70);
});

test("a turn may lay the card down instead, and a flip with no partner stays on the table", () => {
  const state = dealFixture(["♠K"]);
  const turn = engine.apply(state, "north", { action: "play_card", cards: ["♣2"] }, OPTS);
  assert.deepEqual(turn.state.table, [...TABLE, "♣2", "♠K"]);
  assert.deepEqual(turn.state.captured.north, []);
  assert.deepEqual(turn.state.lastFlip, { seatId: "north", card: "♠K", captured: null });
  assert.match(turn.events[0]!.text, /把 ♣2 放到桌上，翻出 ♠K 留在桌上/);
  assert.throws(() => engine.apply(state, "north", { action: "play_card", cards: ["♣2", "♠7"] }, OPTS), /配不起來/);
  assert.throws(() => engine.apply(state, "north", { action: "play_card", cards: ["♥3", "♠K"] }, OPTS), /桌面上沒有/);
  assert.throws(() => engine.apply(state, "east", { action: "play_card", cards: ["♠2"] }, OPTS), /不是你的回合/);
});

test("a full round ends when the pile and hands are empty; leftovers stay on the table and scores sum to zero", () => {
  let state = engine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, OPTS).state;
  let turns = 0;
  let result = null;
  while (state.phase === "play") {
    const seatId = state.active!;
    const plays = engine.legalPlays(state, seatId, OPTS);
    const capture = plays.find((play) => play.cards.length === 2) ?? plays[0]!;
    const transition = engine.apply(state, seatId, { action: "play_card", cards: capture.cards }, OPTS);
    state = transition.state;
    result = transition.result;
    turns += 1;
  }
  assert.equal(turns, 24);
  assert.equal(state.pile.length, 0);
  for (const seatId of SEATS) assert.equal(state.hands[seatId]!.length, 0);
  const capturedTotal = SEATS.reduce((sum, seatId) => sum + state.captured[seatId]!.length, 0);
  assert.equal(capturedTotal + state.table.length, 52, "every card is either captured or left on the table");
  assert.ok(result, "the last turn settles the round");
  const sum = Object.values(result!.scoreDelta).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(sum) < 0.2, `scores are zero-sum, got ${sum}`);
  assert.equal(state.lastRoundScores !== null, true);
  assert.equal(engine.pendingSeatIds(state).length, 0);
});

test("peeking at the bottom card is only for the last seat, and only when the option is on", () => {
  const state = dealFixture(["♠A"]);
  const bottom = state.pile[state.pile.length - 1]!;
  const last = engine.view(state, "west", OPTS) as JianhongdianBoard;
  assert.equal(last.last_seat_id, "west");
  assert.equal(last.bottom_card, bottom);
  assert.equal((engine.view(state, "north", OPTS) as JianhongdianBoard).bottom_card, null);
  assert.equal((engine.view(state, null, OPTS) as JianhongdianBoard).bottom_card, null, "spectators never see it");
  const noPeek: JianhongdianOptions = { ...OPTS, peek_bottom: false };
  assert.equal((engine.view(state, "west", noPeek) as JianhongdianBoard).bottom_card, null);
  const rotated = dealFixture(["♠A"], 2);
  assert.equal((engine.view(rotated, "north", OPTS) as JianhongdianBoard).bottom_card, rotated.pile[rotated.pile.length - 1], "in round 2 north acts last");
});

test("game end, leaving mid-round, seat transfer and snapshot round-trip", () => {
  assert.equal(engine.isGameOver(OPTS, { round: 4, scores: {} }), true);
  assert.equal(engine.isGameOver(OPTS, { round: 3, scores: {} }), false);
  const byScore: JianhongdianOptions = { ...OPTS, end_mode: "score", end_score: 100 };
  assert.equal(engine.isGameOver(byScore, { round: 1, scores: { north: 100.5, east: -20 } }), true);
  assert.equal(engine.isGameOver(byScore, { round: 9, scores: { north: 40 } }), false);

  const state = dealFixture(["♠A"]);
  assert.equal(engine.onSeatRemoved(state, "east", OPTS), "abort");
  const moved = engine.transferSeat(state, "north", "sub");
  assert.equal(moved.active, "sub");
  assert.deepEqual(moved.hands.sub, state.hands.north);
  assert.equal(moved.order[0], "sub");
  const restored = engine.restore(JSON.parse(JSON.stringify(engine.serialize(state))));
  assert.deepEqual(restored, state);
});
