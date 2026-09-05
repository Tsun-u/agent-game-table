import assert from "node:assert/strict";
import test from "node:test";

import { createDeck } from "../src/cards.js";
import {
  gongzhuEngine,
  heartsEngine,
  heartValue,
  scoreGongzhuRound,
  scoreHeartsRound,
  type GongzhuBoard,
  type GongzhuState,
} from "../src/engine/gongzhu-engine.js";
import { DEFAULT_GONGZHU_OPTIONS, DEFAULT_HEARTS_OPTIONS, type GongzhuOptions } from "../src/engine/gongzhu-rules.js";
import { engineFor } from "../src/engine/registry.js";
import { legalFollows, rankValue, sortTrickCards, trickWinner } from "../src/engine/trick-taking-core.js";

const SEATS = ["north", "east", "south", "west"];
const GZ = DEFAULT_GONGZHU_OPTIONS;
const ALL_HEARTS = ["♥2", "♥3", "♥4", "♥5", "♥6", "♥7", "♥8", "♥9", "♥10", "♥J", "♥Q", "♥K", "♥A"];

function captured(entries: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(SEATS.map((seatId) => [seatId, entries[seatId] ?? []]));
}

test("trick-taking core: follow suit, discard when void, highest of the led suit wins, trump beats it", () => {
  assert.deepEqual(legalFollows(["♣5", "♦A", "♣K"], "♣"), ["♣5", "♣K"]);
  assert.deepEqual(legalFollows(["♦A", "♥2"], "♣"), ["♦A", "♥2"]);
  assert.equal(rankValue("♥2") < rankValue("♥10") && rankValue("♥10") < rankValue("♥A"), true);
  const plays = [{ seatId: "a", card: "♣5" }, { seatId: "b", card: "♠A" }, { seatId: "c", card: "♣K" }, { seatId: "d", card: "♣2" }];
  assert.equal(trickWinner(plays, "♣"), "c", "♠A does not follow so ♣K wins");
  assert.equal(trickWinner(plays, "♣", "♠"), "b", "with spades as trump the ♠A wins");
  assert.deepEqual(sortTrickCards(["♠2", "♣A", "♣2", "♥K"]), ["♣2", "♣A", "♥K", "♠2"]);
});

test("heart values: face value negative with ♥4 as -10, or the low-zero variant", () => {
  assert.equal(heartValue("♥2", GZ), -2);
  assert.equal(heartValue("♥4", GZ), -10);
  assert.equal(heartValue("♥9", GZ), -9);
  assert.equal(heartValue("♥A", GZ), -50);
  assert.equal(ALL_HEARTS.reduce((sum, card) => sum + heartValue(card, GZ), 0), -200);
  const low = { hearts_low_zero: true };
  assert.equal(heartValue("♥3", low), 0);
  assert.equal(heartValue("♥5", low), -10);
  assert.equal(ALL_HEARTS.reduce((sum, card) => sum + heartValue(card, low), 0), -200);
  assert.equal(heartValue("♠Q", GZ), 0);
});

test("Gong Zhu scoring: pig, sheep, transformer alone or doubling, all hearts, grand slam, partnership", () => {
  assert.deepEqual(scoreGongzhuRound(captured({ north: ["♠Q"], east: ["♦J"], south: ["♣10"], west: ["♥A", "♥4"] }), SEATS, GZ),
    { north: -100, east: 100, south: 50, west: -60 });
  assert.equal(scoreGongzhuRound(captured({ south: ["♣10"] }), SEATS, { ...GZ, transformer_alone_bonus: false }).south, 0);
  assert.equal(scoreGongzhuRound(captured({ north: ["♠Q", "♣10", "♥5"] }), SEATS, GZ).north, -210, "transformer doubles the others, not itself");
  assert.equal(scoreGongzhuRound(captured({ north: ["♦J", "♣10"] }), SEATS, GZ).north, 200);
  assert.equal(scoreGongzhuRound(captured({ west: ALL_HEARTS }), SEATS, GZ).west, 200, "all hearts flip positive");
  assert.equal(scoreGongzhuRound(captured({ west: [...ALL_HEARTS, "♠Q"] }), SEATS, GZ).west, 100);
  const slam = captured({ west: [...ALL_HEARTS, "♠Q", "♦J", "♣10"] });
  assert.equal(scoreGongzhuRound(slam, SEATS, GZ).west, 400, "without the option a slam is (200 - 100 + 100) × 2");
  assert.equal(scoreGongzhuRound(slam, SEATS, { ...GZ, grand_slam: true }).west, 800);
  const teams = scoreGongzhuRound(captured({ north: ["♠Q"], south: ["♦J"], east: ["♥A"] }), SEATS, { ...GZ, partnership: true });
  assert.deepEqual(teams, { north: 0, south: 0, east: -50, west: -50 });
});

test("Hearts scoring: one point per heart, thirteen for the queen, shooting the moon", () => {
  assert.deepEqual(scoreHeartsRound(captured({ north: ["♥2", "♥K"], east: ["♠Q"], south: ["♣3"] }), SEATS), { north: -2, east: -13, south: 0, west: 0 });
  assert.deepEqual(scoreHeartsRound(captured({ west: [...ALL_HEARTS, "♠Q", "♣5"] }), SEATS), { north: -26, east: -26, south: -26, west: 0 });
});

test("dealing Gong Zhu gives 13 each and the ♣2 holder must open with it", () => {
  const { state, events } = gongzhuEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, GZ);
  assert.equal(state.phase, "trick");
  for (const seatId of SEATS) assert.equal(state.hands[seatId]!.length, 13);
  assert.equal(state.hands[state.active!]!.includes("♣2"), true);
  assert.deepEqual(gongzhuEngine.legalPlays(state, state.active!, GZ), [{ action: "play_card", cards: ["♣2"], label: "可出" }]);
  assert.equal(events.at(-1)?.kind, "turn_started");
  assert.throws(() => gongzhuEngine.deal({ deck: createDeck(), seatIds: SEATS.slice(0, 3), round: 1 }, GZ), /剛好 4 位/);
});

test("a full Gong Zhu round follows suit, awards tricks, and settles with the round winner", () => {
  let state = gongzhuEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, GZ).state;
  let turns = 0;
  let result = null;
  while (state.phase === "trick" && turns < 60) {
    const seatId = state.active!;
    const legal = gongzhuEngine.legalPlays(state, seatId, GZ);
    assert.equal(legal.length > 0, true);
    if (state.trick.plays.length) {
      const leadSuit = state.trick.plays[0]!.card[0];
      const hasSuit = state.hands[seatId]!.some((card) => card[0] === leadSuit);
      if (hasSuit) assert.equal(legal.every((play) => play.cards[0]![0] === leadSuit), true, "must follow suit");
    }
    const transition = gongzhuEngine.apply(state, seatId, { action: "play_card", cards: legal[0]!.cards }, GZ);
    state = transition.state;
    result = transition.result ?? result;
    turns += 1;
    if (turns === 4) {
      assert.deepEqual(state.trick.plays, [], "the table is cleared after a trick");
      assert.equal(state.lastTrick?.plays.length, 4, "the finished trick stays as last_trick for the board");
      assert.equal(state.lastTrick?.winnerSeatId, state.active);
      assert.equal((gongzhuEngine.view(state, seatId, GZ).last_trick as { plays: unknown[] }).plays.length, 4);
    }
  }
  assert.equal(state.phase, "ended");
  assert.equal(turns, 52);
  assert.equal(state.tricksPlayed, 13);
  assert.equal(Object.values(state.captured).flat().length, 52);
  assert.ok(result);
  assert.equal(Object.keys(result!.scoreDelta).length, 4);
  assert.equal(result!.text.includes("{name}"), true);
  const board = gongzhuEngine.view(state, null, GZ) as GongzhuBoard;
  assert.deepEqual(board.last_round_scores, result!.scoreDelta);
  assert.equal(Object.values(board.captured_points).flat().every((card) => card[0] === "♥" || ["♠Q", "♦J", "♣10"].includes(card)), true);
});

test("illegal plays are refused with a reason", () => {
  const state = gongzhuEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, GZ).state;
  const leader = state.active!;
  const notOpening = state.hands[leader]!.find((card) => card !== "♣2")!;
  assert.throws(() => gongzhuEngine.apply(state, leader, { action: "play_card", cards: [notOpening] }, GZ), /第一墩必須出 ♣2/);
  assert.throws(() => gongzhuEngine.apply(state, SEATS.find((seatId) => seatId !== leader)!, { action: "play_card", cards: ["♣3"] }, GZ), /不是你的回合/);
  assert.throws(() => gongzhuEngine.apply(state, leader, { action: "pass_cards", cards: ["♣2", "♣3", "♣4"] }, GZ), /不是傳牌階段/);
});

test("heart_break_lead stops leading hearts until a heart has been played", () => {
  const options: GongzhuOptions = { ...GZ, heart_break_lead: true };
  const base = gongzhuEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, options).state;
  const rigged: GongzhuState = {
    ...base, tricksPlayed: 1, trick: { leader: "north", plays: [] }, active: "north",
    hands: { ...base.hands, north: ["♥A", "♥2", "♣5"] },
  };
  assert.deepEqual(gongzhuEngine.legalPlays(rigged, "north", options).map((play) => play.cards[0]), ["♣5"]);
  assert.deepEqual(gongzhuEngine.legalPlays(rigged, "north", GZ).map((play) => play.cards[0]).sort(), ["♣5", "♥2", "♥A"], "off by default");
  const broken: GongzhuState = { ...rigged, heartsBroken: true };
  assert.equal(gongzhuEngine.legalPlays(broken, "north", options).length, 3);
  const onlyHearts: GongzhuState = { ...rigged, hands: { ...rigged.hands, north: ["♥A", "♥2"] } };
  assert.equal(gongzhuEngine.legalPlays(onlyHearts, "north", options).length, 2, "a hand of nothing but hearts may lead one");
});

test("Hearts: passing rotates left, right, across, none; everyone passes at once; the first trick bans point cards", () => {
  const HZ = DEFAULT_HEARTS_OPTIONS;
  const first = heartsEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, HZ).state;
  assert.equal(first.phase, "passing");
  assert.equal(first.passDirection, "left");
  assert.deepEqual(heartsEngine.pendingSeatIds(first), SEATS, "all four seats act at once while passing");
  assert.equal(heartsEngine.legalActions(first, "north", HZ)[0]?.action, "pass_cards");
  assert.equal(heartsEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 2 }, HZ).state.passDirection, "right");
  assert.equal(heartsEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 3 }, HZ).state.passDirection, "across");
  const fourth = heartsEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 4 }, HZ).state;
  assert.equal(fourth.passDirection, "none");
  assert.equal(fourth.phase, "trick", "no passing on the fourth round");

  let state = first;
  const gifts: Record<string, string[]> = {};
  for (const seatId of SEATS) {
    gifts[seatId] = state.hands[seatId]!.slice(0, 3);
    assert.throws(() => heartsEngine.apply(state, seatId, { action: "pass_cards", cards: gifts[seatId]!.slice(0, 2) }, HZ), /剛好選 3 張/);
    state = heartsEngine.apply(state, seatId, { action: "pass_cards", cards: gifts[seatId]! }, HZ).state;
    if (state.phase === "passing") assert.throws(() => heartsEngine.apply(state, seatId, { action: "pass_cards", cards: gifts[seatId]! }, HZ), /已經傳過牌/);
  }
  assert.equal(state.phase, "trick");
  assert.deepEqual(heartsEngine.pendingSeatIds(state), [state.active]);
  for (const [index, giver] of SEATS.entries()) {
    const receiver = SEATS[(index + 1) % 4]!;
    for (const card of gifts[giver]!) {
      assert.equal(state.hands[receiver]!.includes(card), true, `${receiver} receives ${card} from ${giver} (left)`);
      assert.equal(state.hands[giver]!.includes(card), false);
    }
  }
  assert.equal(state.hands[state.active!]!.includes("♣2"), true);
  const board = heartsEngine.view(state, null, HZ) as GongzhuBoard;
  assert.equal(Object.values(board.passed).every(Boolean), true);
  const firstBoard = heartsEngine.view(first, null, HZ) as GongzhuBoard;
  assert.deepEqual(firstBoard.pass_targets, { north: "east", east: "south", south: "west", west: "north" }, "left means the next seat in order");
  assert.deepEqual((heartsEngine.view(fourth, null, HZ) as GongzhuBoard).pass_targets, {});
});

test("isGameOver honours score mode and round mode", () => {
  assert.equal(gongzhuEngine.isGameOver(GZ, { round: 1, scores: { north: -1000, east: 0, south: 0, west: 0 } }), true);
  assert.equal(gongzhuEngine.isGameOver(GZ, { round: 9, scores: { north: -999, east: 0, south: 0, west: 0 } }), false);
  const rounds: GongzhuOptions = { ...GZ, end_mode: "rounds", end_rounds: 4 };
  assert.equal(gongzhuEngine.isGameOver(rounds, { round: 3, scores: { north: -5000 } }), false);
  assert.equal(gongzhuEngine.isGameOver(rounds, { round: 4, scores: {} }), true);
  assert.equal(heartsEngine.isGameOver(DEFAULT_HEARTS_OPTIONS, { round: 1, scores: { north: -100 } }), true);
});

test("the registry serves gongzhu and hearts with their own labels, seats, and option shapes", () => {
  assert.equal(engineFor("gongzhu").label, "拱豬");
  assert.equal(engineFor("hearts").label, "傷心小棧");
  assert.deepEqual(engineFor("gongzhu").seats, { min: 4, max: 4, fixed: true });
  assert.equal(engineFor("hearts").optionDescriptions.length, 3);
  const normalized = engineFor("gongzhu").normalizeOptions({ end_mode: "rounds", end_rounds: "6", heart_break_lead: true }) as GongzhuOptions;
  assert.equal(normalized.end_rounds, 6);
  assert.equal(normalized.heart_break_lead, true);
  assert.throws(() => engineFor("gongzhu").normalizeOptions({ end_mode: "sudden" }), /end_mode/);
  const rules = engineFor("gongzhu").buildRules(normalized) as { rules_version: string; game: string };
  assert.equal(rules.rules_version, "gongzhu-tw-1");
  assert.match(engineFor("gongzhu").formatRules(rules), /局數制：打滿 6 局/);
});

test("transferSeat and onSeatRemoved behave like the other engines", () => {
  const state = gongzhuEngine.deal({ deck: createDeck(), seatIds: SEATS, round: 1 }, GZ).state;
  const moved = gongzhuEngine.transferSeat(state, state.active!, "sub");
  assert.equal(moved.active, "sub");
  assert.deepEqual(moved.hands["sub"], state.hands[state.active!]);
  assert.equal(gongzhuEngine.onSeatRemoved(state, "north", GZ), "abort");
  const ended: GongzhuState = { ...state, phase: "ended", active: null };
  const dropped = gongzhuEngine.onSeatRemoved(ended, "north", GZ);
  assert.notEqual(dropped, "abort");
  const restored = gongzhuEngine.restore(JSON.parse(JSON.stringify(gongzhuEngine.serialize(state))));
  assert.deepEqual(restored, state);
});
