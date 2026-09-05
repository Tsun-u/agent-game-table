import assert from "node:assert/strict";
import test from "node:test";
import { createDeck, parseCard, type Card } from "../src/cards.js";
import { honeymoonEngine as engine, type HoneymoonState, type HoneymoonBoard } from "../src/engine/honeymoon-engine.js";
import { BIDS, bidRank, bidLevel, bidStrain, DEFAULT_HONEYMOON_OPTIONS as OPTS, HONEYMOON_OPTION_DESCRIPTIONS,
  normalizeHoneymoonOptions, scoreHoneymoonRound, type HoneymoonOptions } from "../src/engine/honeymoon-rules.js";
import { engineFor } from "../src/engine/registry.js";

const SEATS = ["north", "south"];
function deckFrom(front: string[] = []): Card[] {
  return [...front.map(parseCard), ...createDeck().filter((card) => !front.includes(card.code))];
}
function deal(round = 1): HoneymoonState { return engine.deal({ deck: deckFrom(), seatIds: SEATS, round }, OPTS).state; }
function fixture(patch: Partial<HoneymoonState> = {}): HoneymoonState { return engine.restore({ ...deal(), ...patch }); }
function act(state: HoneymoonState, action: string, cards: string[] = [], options = OPTS, seat = state.active!) {
  return engine.apply(state, seat, { action, cards }, options);
}
function board(state: HoneymoonState, viewer: string | null = null): HoneymoonBoard { return engine.view(state, viewer, OPTS) as HoneymoonBoard; }
function start(bid = "1NT", options = OPTS): HoneymoonState { return act(act(deal(), "bid", [bid], options).state, "pass", [], options).state; }

test("honeymoon options: defaults, invalid values, numeric strings, visibility and registry", () => {
  for (const value of [undefined, null, false, 7, "bad", [], { scoring: "bad", doubling: "true", end_mode: "bad", end_rounds: 0, end_score: NaN }]) assert.deepEqual(normalizeHoneymoonOptions(value), OPTS);
  for (const bad of [true, null, Infinity, -1, 1.5, {}, "", "abc", 100001]) assert.equal(normalizeHoneymoonOptions({ end_score: bad }).end_score, 500);
  assert.equal(normalizeHoneymoonOptions({ end_rounds: 100 }).end_rounds, 4);
  assert.deepEqual(normalizeHoneymoonOptions({ scoring: "trick_diff", doubling: true, end_mode: "score", end_rounds: "9", end_score: "700" }), { scoring: "trick_diff", doubling: true, end_mode: "score", end_rounds: 9, end_score: 700 });
  for (const [key, value] of [["end_rounds", "rounds"], ["end_score", "score"]]) assert.deepEqual(HONEYMOON_OPTION_DESCRIPTIONS.find((o) => o.key === key)!.visibleWhen, { key: "end_mode", value });
  assert.equal(engineFor("honeymoon"), engine);
  assert.deepEqual(engine.seats, { min: 2, max: 2, fixed: true });
});
test("honeymoon rules: readable options and complete action protocol", () => {
  const text = engine.formatRules(engine.buildRules(OPTS));
  for (const pattern of [/honeymoon-tw-1/, /固定 2 人/, /雙方未叫牌就 PASS/, /末輪輸家/, /13 墩/, /bid/, /play_card/, /pass／double／redouble/, /賭倍：關/, /計分方式：橋牌分/, /4 局/]) assert.match(text, pattern);
  const alternate = engine.formatRules(engine.buildRules({ ...OPTS, scoring: "trick_diff", doubling: true, end_mode: "score" }));
  assert.match(alternate, /計分方式：墩數差 ×10/); assert.match(alternate, /賭倍：開/); assert.match(alternate, /≥ 500/);
});
test("honeymoon bids: all 35 level-first calls in order", () => {
  assert.equal(BIDS.length, 35); assert.equal(new Set(BIDS).size, 35);
  let index = 0;
  for (let level = 1; level <= 7; level++) for (const strain of ["♣", "♦", "♥", "♠", "NT"]) {
    const bid = `${level}${strain}`;
    assert.equal(BIDS[index], bid); assert.equal(bidRank(bid), index++);
    assert.equal(bidLevel(bid), level); assert.equal(bidStrain(bid), strain);
  }
  for (const invalid of ["", "NT3", "♥2", "0♣", "8NT", "PASS"]) assert.equal(bidRank(invalid), -1);
});

const scoringCases: [string, number, 0 | 1 | 2, number, number][] = [
  ["2♥", 8, 0, 110, 0], ["2♥", 9, 0, 140, 0], ["3NT", 9, 0, 400, 0], ["3NT", 10, 0, 430, 0],
  ["1♣", 7, 0, 70, 0], ["2♦", 9, 0, 110, 0], ["4♠", 10, 0, 420, 0],
  ["6NT", 12, 0, 990, 0], ["6♣", 13, 0, 940, 0], ["7NT", 13, 0, 1520, 0], ["7♦", 13, 0, 1440, 0],
  ["2♥", 6, 0, 0, 100], ["1♣", 7, 1, 140, 0], ["2♥", 8, 1, 470, 0], ["2♥", 9, 1, 570, 0],
  ["1♣", 7, 2, 230, 0], ["2♥", 8, 2, 640, 0], ["2♥", 9, 2, 840, 0],
  ["3NT", 9, 1, 550, 0], ["3NT", 10, 2, 1000, 0], ["6♥", 12, 1, 1210, 0], ["7♠", 13, 2, 2240, 0],
  ["2♥", 7, 1, 0, 100], ["2♥", 6, 1, 0, 300], ["2♥", 4, 1, 0, 700],
  ["2♥", 7, 2, 0, 200], ["2♥", 6, 2, 0, 600], ["2♥", 4, 2, 0, 1400],
];
for (const [bid, tricks, doubled, declarer, defender] of scoringCases) test(`honeymoon scoring: ${bid} doubled=${doubled}, ${tricks} tricks`, () => {
  const result = scoreHoneymoonRound({ seatId: "south", bid, doubled }, { north: 13 - tricks, south: tricks }, SEATS, { ...OPTS, doubling: true });
  assert.deepEqual(result.scores, { north: defender, south: declarer });
  assert.equal(result.declarerTricks, tricks); assert.equal(result.made, declarer > 0);
  assert.ok(result.detail.includes(`= ${declarer || defender}`));
});
test("honeymoon scoring: detail formula, disabled doubling and trick difference ignore contract", () => {
  const contract = { seatId: "north", bid: "2♥", doubled: 2 as const };
  assert.equal(scoreHoneymoonRound(contract, { north: 9, south: 4 }, SEATS, OPTS).detail, "2♥ 成約 +1 超墩：60 + 50 + 30 = 140");
  for (let tricks = 0; tricks <= 13; tricks++) {
    const result = scoreHoneymoonRound(contract, { north: tricks, south: 13 - tricks }, SEATS, { ...OPTS, doubling: true, scoring: "trick_diff" });
    assert.deepEqual(result.scores, { north: tricks >= 7 ? (2 * tricks - 13) * 10 : 0, south: tricks <= 6 ? (13 - 2 * tricks) * 10 : 0 });
  }
});
test("honeymoon deal: contiguous hands, ordered stock and alternating dealer", () => {
  const deck = deckFrom(["♠A", "♥2"]);
  for (const round of [1, 2, 3, 4]) {
    const state = engine.deal({ deck, seatIds: SEATS, round }, OPTS).state;
    assert.deepEqual(new Set(state.hands.north), new Set(deck.slice(0, 13).map((c) => c.code)));
    assert.deepEqual(new Set(state.hands.south), new Set(deck.slice(13, 26).map((c) => c.code)));
    assert.deepEqual(state.stock, deck.slice(26).map((c) => c.code));
    assert.equal(state.active, SEATS[(round - 1) % 2]); assert.equal(state.order[0], state.active);
    assert.deepEqual(engine.pendingSeatIds(state), [state.active]); assert.equal(board(state).stock_top, null);
  }
});
test("honeymoon bidding: legal calls, turn and payload validation, immutable transitions", () => {
  const state = deal(); const saved = structuredClone(state);
  assert.equal(engine.legalPlays(state, "north", OPTS).length, 35);
  assert.deepEqual(engine.legalPlays(state, "south", OPTS), []); assert.deepEqual(engine.legalActions(state, "visitor", OPTS), []);
  assert.throws(() => act(state, "bid", ["1♣"], OPTS, "south"));
  for (const cards of [[], ["2♥", "3NT"], ["♥2"], ["8NT"]]) assert.throws(() => act(state, "bid", cards));
  assert.throws(() => act(state, "pass", ["♠A"])); assert.throws(() => act(state, "play_card", ["♠A"]));
  const next = act(state, "bid", ["2♥"]).state; assert.deepEqual(state, saved);
  assert.equal(next.contract, null); assert.equal(next.active, "south");
  assert.deepEqual(engine.legalPlays(next, "south", OPTS), BIDS.slice(8).map((bid) => ({ action: "bid", cards: [bid], label: "可叫" })));
  assert.equal(board(next).legal_bids_count, 27);
  for (const bid of ["1NT", "2♥"]) assert.throws(() => act(next, "bid", [bid]));
  const top = act(next, "bid", ["7NT"]).state;
  assert.deepEqual(engine.legalActions(top, "north", OPTS).map((a) => a.action), ["pass"]); assert.equal(board(top).legal_bids_count, 0);
});
test("honeymoon bidding: opening pass then bid, suit and NT contracts, separate event seats", () => {
  const passed = act(deal(), "pass").state; assert.equal(passed.active, "south");
  const called = act(passed, "bid", ["2♥"]).state;
  const result = act(called, "pass"); const state = result.state;
  assert.deepEqual(state.contract, { seatId: "south", bid: "2♥", doubled: 0 }); assert.equal(state.trump, "♥");
  assert.equal(state.phase, "draw"); assert.equal(state.active, "south"); assert.deepEqual(state.trick, { leader: "south", plays: [] });
  assert.equal(board(state).stock_top, state.stock[0]); assert.equal(board(state).legal_bids_count, 0);
  assert.deepEqual(result.events.map((e) => e.seatId), ["north", "south"]);
  assert.deepEqual(board(state).contract, { seat_id: "south", bid: "2♥", doubled: 0 });
  assert.equal(start().trump, null); assert.throws(() => act(state, "bid", ["3NT"]));
});
test("honeymoon double PASS: restored state redeals with invariants and no round result", () => {
  const before = fixture({ bids: [{ seatId: "north", call: "PASS" }], active: "south" });
  const saved = structuredClone(before); const result = act(before, "pass"); const state = result.state;
  assert.deepEqual(before, saved); assert.equal(result.result, null); assert.equal(state.phase, "bidding");
  assert.deepEqual(state.order, ["south", "north"]); assert.equal(state.active, "south"); assert.deepEqual(state.bids, []);
  assert.equal(state.hands.north!.length, 13); assert.equal(state.hands.south!.length, 13); assert.equal(state.stock.length, 26);
  const all = [...state.hands.north!, ...state.hands.south!, ...state.stock];
  assert.equal(new Set(all).size, 52); assert.deepEqual(new Set(all), new Set(createDeck().map((c) => c.code)));
  assert.equal(state.contract, null); assert.equal(state.trick, null); assert.equal(board(state).stock_top, null);
  assert.deepEqual(result.events, [{ kind: "redeal", seatId: "south", text: "雙方都 PASS，重新發牌，改由 {name} 發牌。" }]);
});
test("honeymoon doubling: availability, redouble, higher bid resets and pass settles multiplier", () => {
  const options = { ...OPTS, doubling: true };
  const actions = (s: HoneymoonState, o = options) => engine.legalActions(s, s.active!, o).map((a) => a.action);
  assert.ok(!actions(deal()).includes("double")); assert.throws(() => act(deal(), "double", [], options));
  const called = act(deal(), "bid", ["2♥"], options).state;
  assert.ok(!actions(called, OPTS).includes("double")); assert.throws(() => act(called, "double"));
  assert.ok(actions(called).includes("double")); assert.ok(!actions(called).includes("redouble"));
  const doubled = act(called, "double", [], options).state;
  assert.equal(doubled.contract, null); assert.ok(actions(doubled).includes("redouble")); assert.ok(!actions(doubled).includes("double"));
  assert.equal(act(doubled, "pass", [], options).state.contract!.doubled, 1);
  const redoubled = act(doubled, "redouble", [], options).state;
  assert.ok(!actions(redoubled).includes("redouble")); assert.ok(!actions(redoubled).includes("double"));
  const settled = act(redoubled, "pass", [], options); assert.equal(settled.state.contract!.doubled, 2); assert.match(settled.events[1]!.text, /Redouble/);
  for (const state of [doubled, redoubled]) {
    const raised = act(state, "bid", ["3NT"], options).state;
    assert.ok(actions(raised).includes("double")); assert.equal(act(raised, "pass", [], options).state.contract!.doubled, 0);
  }
});
test("honeymoon draw: follow suit, trump winner, public draw and private loser card", () => {
  const state = fixture({ phase: "draw", hands: { north: ["♣A", "♦2"], south: ["♣2", "♠A"] },
    contract: { seatId: "north", bid: "1♠", doubled: 0 }, trump: "♠", stock: ["♥Q", "♥K", "♥J", "♥10"], trick: { leader: "north", plays: [] } });
  const first = act(state, "play_card", ["♣A"]).state;
  assert.deepEqual(engine.legalPlays(first, "south", OPTS).map((p) => p.cards[0]), ["♣2"]);
  assert.throws(() => act(first, "play_card", ["♠A"])); assert.throws(() => act(first, "play_card", ["♥A"]));
  assert.throws(() => act(first, "play_card", [])); assert.throws(() => act(first, "play_card", ["♣2", "♠A"]));
  const result = act(first, "play_card", ["♣2"]); const next = result.state;
  assert.ok(next.hands.north!.includes("♥Q")); assert.ok(next.hands.south!.includes("♥K"));
  assert.equal(next.drawRound, 1); assert.equal(next.active, "north"); assert.deepEqual(next.tricksWon, { north: 0, south: 0 });
  assert.equal(next.lastTrick!.drewCard, "♥Q"); assert.ok(result.events.some((e) => e.text.includes("♥Q")));
  for (const viewer of ["north", "south", null]) {
    const publicBoard = board(next, viewer);
    assert.equal(publicBoard.stock_top, "♥J"); assert.ok(!JSON.stringify(publicBoard).includes("♥K"));
    assert.ok(!JSON.stringify(publicBoard).includes("♥10")); assert.ok(!("hands" in publicBoard));
  }
  assert.ok(!JSON.stringify(result.events).includes("♥K")); assert.ok(!engine.hand(next, "north").includes("♥K")); assert.ok(engine.hand(next, "south").includes("♥K"));
  const voidState = fixture({ ...state, hands: { north: ["♣A"], south: ["♠2", "♦A"] } });
  const trumped = act(act(voidState, "play_card", ["♣A"]).state, "play_card", ["♠2"]).state;
  assert.equal(trumped.lastTrick!.winnerSeatId, "south"); assert.equal(trumped.active, "south");
  const ntState = fixture({ ...voidState, trump: null, contract: { seatId: "north", bid: "1NT", doubled: 0 } });
  assert.equal(act(act(ntState, "play_card", ["♣A"]).state, "play_card", ["♠2"]).state.lastTrick!.winnerSeatId, "north");
});

for (const scoring of ["bridge", "trick_diff"] as const) test(`honeymoon complete round: 13 draws then 13 tricks (${scoring})`, () => {
  const options: HoneymoonOptions = { ...OPTS, scoring };
  let state = start("2♥", options);
  for (let i = 0; i < 26; i++) {
    const play = engine.legalPlays(state, state.active!, options)[0]!;
    const result = engine.apply(state, state.active!, play, options); state = result.state;
    assert.equal(result.result, null); assert.equal(state.drawRound, Math.floor((i + 1) / 2));
    if (i % 2 === 1) for (const hand of Object.values(state.hands)) assert.equal(hand.length, 13);
    if (i < 25) assert.equal(state.phase, "draw");
  }
  assert.equal(state.phase, "play"); assert.equal(state.stock.length, 0);
  assert.notEqual(state.active, state.lastTrick!.winnerSeatId); assert.equal(state.trick!.leader, state.active);
  assert.equal(new Set([...state.hands.north!, ...state.hands.south!]).size, 26);
  assert.deepEqual(state.tricksWon, { north: 0, south: 0 }); assert.equal(board(state).stock_top, null);
  for (let i = 0; i < 26; i++) {
    const play = engine.legalPlays(state, state.active!, options)[0]!;
    const result = engine.apply(state, state.active!, play, options); state = result.state;
    assert.equal(Object.values(state.tricksWon).reduce((sum, n) => sum + n, 0), Math.floor((i + 1) / 2));
    if (i < 25) { assert.equal(result.result, null); assert.equal(state.phase, "play"); }
    else {
      assert.equal(state.phase, "ended"); assert.ok(result.result);
      const expected = scoreHoneymoonRound(state.contract!, state.tricksWon, SEATS, options);
      assert.deepEqual(result.result.scoreDelta, expected.scores); assert.equal(result.result.gameOver, false);
      assert.deepEqual(board(state).last_round_scores, expected.scores); assert.equal(board(state).last_round_detail, expected.detail);
      assert.ok(expected.scores[result.result.winnerSeatId!]! > 0);
    }
    if (i % 2 === 1 && i < 25) assert.equal(state.active, state.lastTrick!.winnerSeatId);
  }
  assert.deepEqual(state.hands, { north: [], south: [] }); assert.equal(state.active, null);
  assert.deepEqual(engine.pendingSeatIds(state), []); assert.deepEqual(engine.legalActions(state, "north", options), []);
  assert.deepEqual(engine.legalPlays(state, "north", options), []); assert.throws(() => act(state, "pass", [], options, "north"));
});
test("honeymoon settlement: result names the scoring seat for made and defeated contracts", () => {
  for (const [bid, north, south, winner, verb] of [["1NT", 6, 6, "north", "成約"], ["3NT", 6, 6, "south", "打垮合約"]] as const) {
    const state = fixture({ phase: "play", contract: { seatId: "north", bid, doubled: 0 }, hands: { north: ["♣A"], south: ["♣2"] },
      stock: [], drawRound: 13, tricksWon: { north, south }, trick: { leader: "north", plays: [] } });
    const result = act(act(state, "play_card", ["♣A"]).state, "play_card", ["♣2"]);
    assert.equal(result.result!.winnerSeatId, winner); assert.ok(result.result!.text.includes(verb));
  }
});
test("honeymoon lifecycle: end thresholds, leave, serialization and complete seat transfer", () => {
  assert.equal(engine.isGameOver(OPTS, { round: 3, scores: { north: 999 } }), false);
  assert.equal(engine.isGameOver(OPTS, { round: 4, scores: {} }), true);
  assert.equal(engine.isGameOver(OPTS, { round: 5, scores: {} }), true);
  for (const [score, expected] of [[499, false], [500, true], [501, true], [-500, false]] as const) assert.equal(engine.isGameOver({ ...OPTS, end_mode: "score" }, { round: 99, scores: { north: 0, south: score } }), expected);
  for (const phase of ["bidding", "draw", "play"] as const) assert.equal(engine.onSeatRemoved(fixture({ phase }), "north", OPTS), "abort");
  assert.notEqual(engine.onSeatRemoved(deal(), "visitor", OPTS), "abort");
  assert.notEqual(engine.onSeatRemoved(fixture({ phase: "ended", active: null }), "north", OPTS), "abort");
  const state = fixture({ phase: "draw", bids: [{ seatId: "north", call: "2♥" }, { seatId: "south", call: "PASS" }],
    contract: { seatId: "north", bid: "2♥", doubled: 0 }, trump: "♥", trick: { leader: "north", plays: [{ seatId: "north", card: "♣2" }] },
    lastTrick: { winnerSeatId: "north", plays: [{ seatId: "north", card: "♣A" }, { seatId: "south", card: "♣K" }], drewCard: "♥Q" }, lastRoundScores: { north: 110, south: 0 }, lastRoundDetail: "2♥ 成約：60 + 50 = 110" });
  const saved = structuredClone(state);
  const restored = engine.restore(JSON.parse(JSON.stringify(engine.serialize(state)))); assert.deepEqual(restored, state);
  const next = engine.transferSeat(restored, "north", "replacement");
  assert.deepEqual(next.order, ["replacement", "south"]); assert.deepEqual(next.hands.replacement, state.hands.north);
  assert.equal(next.active, "replacement"); assert.equal(next.contract!.seatId, "replacement"); assert.equal(next.bids[0]!.seatId, "replacement");
  assert.equal(next.trick!.leader, "replacement"); assert.equal(next.trick!.plays[0]!.seatId, "replacement");
  assert.equal(next.lastTrick!.winnerSeatId, "replacement"); assert.equal(next.lastTrick!.plays[0]!.seatId, "replacement");
  assert.deepEqual(next.tricksWon, { replacement: 0, south: 0 }); assert.deepEqual(next.lastRoundScores, { replacement: 110, south: 0 });
  assert.ok(!JSON.stringify(next).includes("north")); assert.deepEqual(state, saved); assert.deepEqual(restored, saved);
  assert.equal(engine.transferSeat(state, "visitor", "replacement"), state);
});
