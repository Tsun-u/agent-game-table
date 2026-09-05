import assert from "node:assert/strict";
import test from "node:test";
import { createDeck } from "../src/cards.js";
import { lightbridgeEngine as engine, type LightbridgeState, type LightbridgeBoard } from "../src/engine/lightbridge-engine.js";
import { BIDS } from "../src/engine/honeymoon-rules.js";
import { DEFAULT_LIGHTBRIDGE_OPTIONS as OPTS, LIGHTBRIDGE_OPTION_DESCRIPTIONS, normalizeLightbridgeOptions,
  highCardPoints, REDEAL_THRESHOLD, scoreLightbridgeRound, type LightbridgeOptions } from "../src/engine/lightbridge-rules.js";
import { engineFor } from "../src/engine/registry.js";

const SEATS = ["north", "east", "south", "west"];
function deal(round = 1): LightbridgeState { return engine.deal({ deck: createDeck(), seatIds: SEATS, round }, OPTS).state; }
function fixture(patch: Partial<LightbridgeState> = {}): LightbridgeState { return engine.restore({ ...deal(), ...patch }); }
function act(state: LightbridgeState, action: string, cards: string[] = [], options = OPTS, seat = state.active!) {
  return engine.apply(state, seat, { action, cards }, options);
}
function board(state: LightbridgeState, viewer: string | null = null): LightbridgeBoard { return engine.view(state, viewer, OPTS) as LightbridgeBoard; }
function actions(state: LightbridgeState, options = OPTS): string[] { return engine.legalActions(state, state.active!, options).map((a) => a.action); }
function passes(state: LightbridgeState, count = 3, options = OPTS): LightbridgeState {
  for (let i = 0; i < count; i++) state = act(state, "pass", [], options).state;
  return state;
}
function start(bid = "1NT", options = OPTS): LightbridgeState { return passes(act(deal(), "bid", [bid], options).state, 3, options); }

test("lightbridge options: defaults, invalid values, numeric strings, visibility and registry", () => {
  for (const value of [undefined, null, false, 7, "bad", [], { scoring: "bad", pair_scoring: "true", doubling: "true", end_mode: "bad", end_rounds: 0, end_score: NaN }]) assert.deepEqual(normalizeLightbridgeOptions(value), OPTS);
  for (const bad of [true, null, Infinity, -1, 1.5, {}, "", "abc", 100001]) assert.equal(normalizeLightbridgeOptions({ end_score: bad }).end_score, 500);
  assert.equal(normalizeLightbridgeOptions({ end_rounds: 100 }).end_rounds, 4);
  assert.deepEqual(normalizeLightbridgeOptions({ scoring: "tricks", pair_scoring: true, doubling: true, end_mode: "score", end_rounds: "9", end_score: "700" }),
    { scoring: "tricks", pair_scoring: true, doubling: true, end_mode: "score", end_rounds: 9, end_score: 700 });
  for (const [key, value] of [["end_rounds", "rounds"], ["end_score", "score"]]) assert.deepEqual(LIGHTBRIDGE_OPTION_DESCRIPTIONS.find((o) => o.key === key)!.visibleWhen, { key: "end_mode", value });
  assert.equal(engineFor("lightbridge"), engine); assert.deepEqual(engine.seats, { min: 4, max: 4, fixed: true });
  assert.equal(engine.label, "台灣輕橋牌"); assert.equal(engine.rulesVersion, "lightbridge-tw-1");
});
test("lightbridge rules: readable rules, options and all six actions", () => {
  const text = engine.formatRules(engine.buildRules(OPTS));
  for (const pattern of [/lightbridge-tw-1/, /固定 4 人/, /2000～2020 年間流行於台灣各大校園的版本：叫牌憑默契、沒有夢家、點力太差可倒牌/, /連續三家 PASS/, /四家全 PASS/, /第一次開口/, /主打方的下家/, /13 墩/, /bid/, /play_card/, /pass／redeal／double／redouble/, /賭倍：關/, /計分方式：合約制/, /對家分數合計：關/, /4 局/]) assert.match(text, pattern);
  const alternate = engine.formatRules(engine.buildRules({ ...OPTS, scoring: "tricks", doubling: true, pair_scoring: true, end_mode: "score" }));
  for (const pattern of [/計分方式：純墩數/, /賭倍：開/, /對家分數合計：開/, /≥ 500/]) assert.match(alternate, pattern);
});
test("lightbridge high card points: A K Q J and threshold", () => {
  assert.equal(REDEAL_THRESHOLD, 4); assert.equal(highCardPoints([]), 0);
  assert.equal(highCardPoints(["♠A", "♥K", "♦Q", "♣J", "♠10", "♥2"]), 10);
  assert.equal(highCardPoints(createDeck().map((c) => c.code)), 40);
  assert.equal(highCardPoints(["♣K"]), 3); assert.equal(highCardPoints(["♣A"]), 4);
});

const scoringCases: [string, number, 0 | 1 | 2, number][] = [
  ["1♣", 7, 0, 120], ["2♦", 9, 0, 140], ["3♥", 9, 0, 140], ["3NT", 9, 0, 390], ["2NT", 8, 0, 130],
  ["4♠", 10, 0, 400], ["4♦", 10, 0, 150], ["5♣", 11, 0, 410],
  ["6NT", 12, 0, 920], ["6♣", 13, 0, 930], ["7NT", 13, 0, 1430], ["7♦", 13, 0, 1430],
  ["2♥", 6, 0, -40], ["1♣", 7, 1, 170], ["2♥", 8, 1, 430], ["2♥", 9, 1, 440],
  ["1♣", 7, 2, 220], ["2♥", 8, 2, 480], ["2♥", 9, 2, 490],
  ["3NT", 9, 1, 440], ["3NT", 10, 2, 500], ["6♥", 12, 1, 970], ["7♠", 13, 2, 1530],
  ["2♥", 7, 1, -30], ["2♥", 6, 1, -140], ["2♥", 4, 1, -360],
  ["2♥", 7, 2, -130], ["2♥", 6, 2, -340], ["2♥", 4, 2, -760],
];
for (const [bid, tricks, doubled, expected] of scoringCases) test(`lightbridge scoring: ${bid} doubled=${doubled}, ${tricks} tricks`, () => {
  const won = { north: tricks, east: 13 - tricks, south: 0, west: 0 }; const saved = { ...won };
  const result = scoreLightbridgeRound({ seatId: "north", bid, doubled }, won, SEATS, { ...OPTS, doubling: true });
  assert.deepEqual(result.scores, { north: expected, east: (13 - tricks) * 10, south: 0, west: 0 });
  assert.equal(result.made, tricks >= 6 + Number(bid[0])); assert.match(result.detail, new RegExp(`= ${expected}`));
  assert.deepEqual(won, saved);
});
test("lightbridge scoring: exact formula, disabled doubling and tricks ignore contract", () => {
  const contract = { seatId: "north", bid: "3♥", doubled: 2 as const };
  assert.equal(scoreLightbridgeRound(contract, { north: 9, east: 2, south: 1, west: 1 }, SEATS, OPTS).detail, "3♥ 成約：主打方 9 墩 90 + 部分合約 50 = 140；其餘各家每墩 10");
  for (let tricks = 0; tricks <= 13; tricks++) {
    const result = scoreLightbridgeRound(contract, { north: tricks, east: 13 - tricks, south: 0, west: 0 }, SEATS, { ...OPTS, doubling: true, scoring: "tricks" });
    assert.deepEqual(result.scores, { north: tricks * 10, east: (13 - tricks) * 10, south: 0, west: 0 });
  }
});
test("lightbridge pair scoring: sums opposite seats after individual scoring, including negative scores", () => {
  for (const scoring of ["contract", "tricks"] as const) for (const tricks of [3, 9]) for (const declarer of SEATS) {
    const won = { north: 0, east: 0, south: 0, west: 0 } as Record<string, number>;
    won[declarer] = tricks; won[SEATS[(SEATS.indexOf(declarer) + 2) % 4]!] = 13 - tricks;
    const contract = { seatId: declarer, bid: "3♥", doubled: 1 as const };
    const options = { ...OPTS, scoring, doubling: true };
    const individual = scoreLightbridgeRound(contract, won, SEATS, options);
    const paired = scoreLightbridgeRound(contract, won, SEATS, { ...options, pair_scoring: true });
    for (let i = 0; i < 4; i++) assert.equal(paired.scores[SEATS[i]!], individual.scores[SEATS[i]!]! + individual.scores[SEATS[(i + 2) % 4]!]!);
    assert.equal(paired.made, tricks >= 9); assert.match(paired.detail, /對家合計/);
  }
});
test("lightbridge deal: contiguous 13-card hands, fixed order and rotating dealer", () => {
  const deck = createDeck();
  for (let round = 1; round <= 8; round++) {
    const state = deal(round);
    for (let i = 0; i < 4; i++) assert.deepEqual(new Set(state.hands[SEATS[i]!]!), new Set(deck.slice(i * 13, (i + 1) * 13).map((c) => c.code)));
    assert.deepEqual(state.order, SEATS); assert.equal(state.dealer, SEATS[(round - 1) % 4]);
    assert.equal(state.active, state.dealer); assert.deepEqual(engine.pendingSeatIds(state), [state.dealer]);
    assert.equal(state.phase, "bidding"); assert.equal(board(state).dealer_seat_id, state.dealer);
  }
});
test("lightbridge bidding: legal calls, turn and payload validation, immutable transitions", () => {
  const state = deal(); const saved = structuredClone(state);
  assert.equal(engine.legalPlays(state, "north", OPTS).length, 35);
  assert.deepEqual(engine.legalPlays(state, "east", OPTS), []); assert.deepEqual(engine.legalActions(state, "visitor", OPTS), []);
  assert.throws(() => act(state, "bid", ["1♣"], OPTS, "east"));
  for (const cards of [[], ["2♥", "3NT"], ["♥2"], ["8NT"]]) assert.throws(() => act(state, "bid", cards));
  assert.throws(() => act(state, "pass", ["♠A"])); assert.throws(() => act(state, "play_card", ["♠A"]));
  const next = act(state, "bid", ["2♥"]).state; assert.deepEqual(state, saved);
  assert.equal(next.contract, null); assert.equal(next.active, "east");
  assert.deepEqual(engine.legalPlays(next, "east", OPTS), BIDS.slice(8).map((bid) => ({ action: "bid", cards: [bid], label: "可叫" })));
  for (const bid of ["1NT", "2♥"]) assert.throws(() => act(next, "bid", [bid]));
  const top = act(next, "bid", ["7NT"]).state;
  assert.ok(!actions(top).includes("bid")); assert.deepEqual(engine.legalPlays(top, top.active!, OPTS), []);
});
test("lightbridge bidding: three consecutive passes, contract events and declarer's next seat leads", () => {
  for (let round = 1; round <= 4; round++) {
    const opening = act(deal(round), "pass").state;
    const called = act(opening, "bid", ["2♥"]).state;
    const twice = passes(called, 2); assert.equal(twice.phase, "bidding"); assert.equal(twice.contract, null);
    const result = act(twice, "pass"); const state = result.state; const declarer = opening.active!;
    assert.deepEqual(state.contract, { seatId: declarer, bid: "2♥", doubled: 0 }); assert.equal(state.trump, "♥");
    assert.equal(state.phase, "play"); assert.equal(state.active, SEATS[(SEATS.indexOf(declarer) + 1) % 4]);
    assert.deepEqual(state.trick, { leader: state.active, plays: [] }); assert.deepEqual(result.events.map((e) => e.seatId), [twice.active, declarer]);
    assert.deepEqual(board(state).contract, { seat_id: declarer, bid: "2♥", doubled: 0 });
    assert.throws(() => act(state, "bid", ["3NT"]));
  }
  assert.equal(start().trump, null);
  const raised = act(passes(act(deal(), "bid", ["1♣"]).state, 2), "bid", ["2♦"]).state;
  assert.equal(passes(raised, 2).phase, "bidding"); assert.equal(passes(raised).contract!.seatId, "west");
});

function assertRedealt(before: LightbridgeState, action: "pass" | "redeal"): LightbridgeState {
  const saved = structuredClone(before); const result = act(before, action); const state = result.state;
  assert.deepEqual(before, saved); assert.equal(result.result, null); assert.equal(state.phase, "bidding");
  assert.deepEqual(state.order, SEATS); assert.equal(state.dealer, SEATS[(SEATS.indexOf(before.dealer) + 1) % 4]);
  assert.equal(state.active, state.dealer); assert.deepEqual(state.bids, []);
  for (const seat of SEATS) assert.equal(state.hands[seat]!.length, 13);
  const all = Object.values(state.hands).flat(); assert.equal(all.length, 52); assert.equal(new Set(all).size, 52);
  assert.deepEqual(new Set(all), new Set(createDeck().map((c) => c.code)));
  assert.equal(state.contract, null); assert.equal(state.trump, null); assert.equal(state.trick, null);
  assert.equal(state.lastTrick, null); assert.equal(state.lastRoundScores, null); assert.equal(state.lastRoundDetail, null);
  assert.deepEqual(state.tricksWon, { north: 0, east: 0, south: 0, west: 0 });
  if (action === "pass") assert.deepEqual(result.events, [{ kind: "redeal", seatId: state.dealer, text: "四家都 PASS，重新發牌，改由 {name} 發牌。" }]);
  else assert.deepEqual(result.events, [{ kind: "redeal", seatId: before.active, text: "{name} 點力不足，要求倒牌。" }, { kind: "redeal", seatId: state.dealer, text: "重新發牌，改由 {name} 發牌。" }]);
  return state;
}
test("lightbridge all PASS: restored auction redeals, including dealer wraparound", () => {
  for (let i = 0; i < 4; i++) {
    const state = fixture({ dealer: SEATS[i]!, active: SEATS[(i + 3) % 4]!, bids: [0, 1, 2].map((n) => ({ seatId: SEATS[(i + n) % 4]!, call: "PASS" })) });
    assertRedealt(state, "pass");
  }
});
const LOW_HAND = ["♣2", "♣3", "♣4", "♣5", "♣6", "♣7", "♣8", "♣9", "♣10", "♦2", "♦3", "♦4", "♣K"];
function lowHands(): Record<string, string[]> {
  const rest = createDeck().map((c) => c.code).filter((card) => !LOW_HAND.includes(card));
  return { north: [...LOW_HAND], east: rest.slice(0, 13), south: rest.slice(13, 26), west: rest.slice(26) };
}
test("lightbridge redeal: first utterance only, strict HCP threshold, turn and payload validation", () => {
  const low = fixture({ hands: lowHands() }); assert.ok(actions(low).includes("redeal"));
  assert.equal(engine.legalActions(low, "north", OPTS).find((a) => a.action === "redeal")!.label, "倒牌");
  assert.throws(() => act(low, "redeal", ["♣2"])); assert.throws(() => act(low, "redeal", [], OPTS, "east"));
  for (const call of ["PASS", "1♣", "X", "XX"]) {
    const spoken = fixture({ hands: lowHands(), bids: [{ seatId: "north", call }] });
    assert.ok(!actions(spoken).includes("redeal")); assert.throws(() => act(spoken, "redeal"));
  }
  const enough = fixture({ hands: { ...lowHands(), north: ["♣A"] } });
  assert.ok(!actions(enough).includes("redeal")); assert.throws(() => act(enough, "redeal"));
  assert.ok(!actions(start()).includes("redeal"));
  const afterOthers = fixture({ hands: lowHands(), dealer: "south", bids: [{ seatId: "south", call: "2♥" }, { seatId: "west", call: "PASS" }] });
  assert.ok(actions(afterOthers).includes("redeal")); assertRedealt(afterOthers, "redeal");
  assertRedealt(low, "redeal");
});
test("lightbridge doubling: availability, redouble, three-pass closure and higher calls reset", () => {
  const options = { ...OPTS, doubling: true };
  assert.ok(!actions(deal(), options).includes("double")); assert.throws(() => act(deal(), "double", [], options));
  const called = act(deal(), "bid", ["2♥"], options).state;
  assert.ok(!actions(called).includes("double")); assert.throws(() => act(called, "double"));
  assert.ok(actions(called, options).includes("double")); assert.ok(!actions(called, options).includes("redouble"));
  assert.throws(() => act(called, "double", ["♠A"], options));
  const doubled = act(called, "double", [], options).state;
  assert.equal(doubled.contract, null); assert.ok(!actions(doubled, options).includes("double"));
  assert.ok(!actions(doubled, options).includes("redouble")); assert.throws(() => act(doubled, "redouble", [], options));
  const back = passes(doubled, 2, options); assert.equal(back.active, "north"); assert.ok(actions(back, options).includes("redouble"));
  assert.equal(act(back, "pass", [], options).state.contract!.doubled, 1);
  assert.throws(() => act(back, "redouble", ["♠A"], options));
  const redoubled = act(back, "redouble", [], options).state;
  assert.ok(!actions(redoubled, options).includes("double")); assert.ok(!actions(redoubled, options).includes("redouble"));
  assert.equal(passes(redoubled, 2, options).phase, "bidding");
  assert.equal(passes(redoubled, 3, options).contract!.doubled, 2);
  for (const state of [doubled, redoubled]) {
    const raised = act(state, "bid", ["3NT"], options).state;
    assert.ok(actions(raised, options).includes("double")); assert.equal(passes(raised, 3, options).contract!.doubled, 0);
  }
  const lateDouble = act(passes(called, 2, options), "double", [], options).state;
  assert.equal(passes(lateDouble, 2, options).phase, "bidding"); assert.equal(passes(lateDouble, 3, options).contract!.doubled, 1);
});
test("lightbridge pair scoring: opposite declarer cannot Double, other defenders can", () => {
  for (let i = 0; i < 4; i++) for (let offset = 0; offset < 4; offset++) {
    const seat = SEATS[(i + offset) % 4]!;
    const state = fixture({ bids: [{ seatId: SEATS[i]!, call: "2♥" }], active: seat });
    assert.equal(actions(state, { ...OPTS, doubling: true }).includes("double"), offset !== 0);
    const options = { ...OPTS, doubling: true, pair_scoring: true };
    assert.equal(actions(state, options).includes("double"), offset === 1 || offset === 3);
    if (offset === 0 || offset === 2) assert.throws(() => act(state, "double", [], options));
  }
});
test("lightbridge play: follow suit, four-card trick, trump and NT winners", () => {
  for (const trump of ["♠", null]) {
    const state = fixture({ phase: "play", contract: { seatId: "west", bid: trump ? "1♠" : "1NT", doubled: 0 }, trump,
      hands: { north: ["♣A", "♦2"], east: ["♣2", "♠A"], south: ["♠2", "♦A"], west: ["♣K", "♥A"] }, trick: { leader: "north", plays: [] } });
    const first = act(state, "play_card", ["♣A"]).state;
    assert.deepEqual(engine.legalPlays(first, "east", OPTS).map((p) => p.cards[0]), ["♣2"]);
    for (const cards of [["♠A"], ["♥2"], [], ["♣2", "♠A"]]) assert.throws(() => act(first, "play_card", cards));
    const second = act(first, "play_card", ["♣2"]).state;
    assert.deepEqual(engine.legalPlays(second, "south", OPTS).map((p) => p.cards[0]), ["♠2", "♦A"]);
    const third = act(second, "play_card", ["♠2"]).state;
    assert.equal(third.lastTrick, null); assert.equal(third.active, "west");
    const result = act(third, "play_card", ["♣K"]); const next = result.state; const winner = trump ? "south" : "north";
    assert.equal(next.lastTrick!.winnerSeatId, winner); assert.equal(next.lastTrick!.plays.length, 4);
    assert.equal(next.active, winner); assert.deepEqual(next.trick, { leader: winner, plays: [] }); assert.equal(next.tricksWon[winner], 1);
    assert.deepEqual(result.events, [{ kind: "card_played", seatId: "west", text: "{name} 出 ♣K。" }, { kind: "trick_won", seatId: winner, text: "{name} 贏得第 1 墩。" }]);
    assert.equal(state.hands.north!.length, 2); assert.equal(state.trick!.plays.length, 0);
  }
});
for (const scoring of ["contract", "tricks"] as const) for (const pair_scoring of [false, true]) test(`lightbridge complete round: 13 tricks (${scoring}, pair=${pair_scoring})`, () => {
  const options: LightbridgeOptions = { ...OPTS, scoring, pair_scoring };
  let state = start("2♥", options);
  for (let i = 0; i < 52; i++) {
    const play = engine.legalPlays(state, state.active!, options)[0]!;
    const result = engine.apply(state, state.active!, play, options); state = result.state;
    assert.equal(Object.values(state.tricksWon).reduce((sum, n) => sum + n, 0), Math.floor((i + 1) / 4));
    if (i < 51) { assert.equal(result.result, null); assert.equal(state.phase, "play"); }
    else {
      assert.equal(state.phase, "ended"); assert.ok(result.result);
      const expected = scoreLightbridgeRound(state.contract!, state.tricksWon, SEATS, options);
      assert.deepEqual(result.result.scoreDelta, expected.scores); assert.equal(result.result.gameOver, false);
      assert.deepEqual(board(state).last_round_scores, expected.scores); assert.equal(board(state).last_round_detail, expected.detail);
      const max = Math.max(...Object.values(expected.scores));
      assert.equal(result.result.winnerSeatId, SEATS.find((seat) => expected.scores[seat] === max));
      assert.equal(result.result.text, "本局結束，{name} 拿最多分。");
    }
    if (i % 4 === 3 && i < 51) assert.equal(state.active, state.lastTrick!.winnerSeatId);
  }
  assert.ok(Object.values(state.hands).every((hand) => hand.length === 0)); assert.equal(state.active, null);
  assert.equal(board(state).last_trick!.plays.length, 4); assert.equal(board(state, "north").viewer_hcp, null);
  assert.deepEqual(engine.pendingSeatIds(state), []); assert.deepEqual(engine.legalActions(state, "north", options), []);
  assert.deepEqual(engine.legalPlays(state, "north", options), []); assert.throws(() => act(state, "pass", [], options, "north"));
});
test("lightbridge settlement: highest score wins, tied defenders use fixed seat order", () => {
  const state = fixture({ phase: "play", dealer: "west", contract: { seatId: "north", bid: "3NT", doubled: 0 },
    hands: { north: ["♣A"], east: ["♣2"], south: ["♣3"], west: ["♣4"] },
    tricksWon: { north: 3, east: 3, south: 3, west: 3 }, trick: { leader: "north", plays: [] } });
  let next = state;
  for (const card of ["♣A", "♣2", "♣3"]) next = act(next, "play_card", [card]).state;
  const result = act(next, "play_card", ["♣4"]);
  assert.deepEqual(result.result!.scoreDelta, { north: -210, east: 30, south: 30, west: 30 });
  assert.equal(result.result!.winnerSeatId, "east");
});
test("lightbridge board: exact public fields and HCP visible only to seated viewer during bidding", () => {
  const state = fixture({ hands: lowHands() });
  assert.deepEqual(Object.keys(board(state)).sort(), ["phase", "dealer_seat_id", "contract", "trump", "bids", "viewer_hcp", "trick", "tricks_won", "last_trick", "seat_status", "last_round_scores", "last_round_detail"].sort());
  for (const viewer of [...SEATS, null, "visitor"]) {
    const view = board(state, viewer);
    assert.equal(view.viewer_hcp, viewer !== null && SEATS.includes(viewer) ? highCardPoints(state.hands[viewer]!) : null);
    for (const card of Object.values(state.hands).flat()) assert.ok(!JSON.stringify(view).includes(card));
  }
  assert.deepEqual(engine.hand(state, "north"), LOW_HAND); assert.deepEqual(engine.hand(state, "visitor"), []);
  assert.equal(board(start(), "north").viewer_hcp, null);
});
test("lightbridge lifecycle: game end, leave, serialization and all seat references transfer", () => {
  assert.equal(engine.isGameOver(OPTS, { round: 3, scores: { north: 999 } }), false);
  assert.equal(engine.isGameOver(OPTS, { round: 4, scores: {} }), true); assert.equal(engine.isGameOver(OPTS, { round: 5, scores: {} }), true);
  for (const [score, expected] of [[499, false], [500, true], [501, true], [-500, false]] as const) assert.equal(engine.isGameOver({ ...OPTS, end_mode: "score" }, { round: 99, scores: { north: 0, west: score } }), expected);
  for (const phase of ["bidding", "play"] as const) assert.equal(engine.onSeatRemoved(fixture({ phase }), "north", OPTS), "abort");
  assert.notEqual(engine.onSeatRemoved(deal(), "visitor", OPTS), "abort");
  assert.notEqual(engine.onSeatRemoved(fixture({ phase: "ended", active: null }), "north", OPTS), "abort");
  const state = fixture({ phase: "play", bids: [{ seatId: "north", call: "2♥" }, { seatId: "east", call: "PASS" }],
    contract: { seatId: "north", bid: "2♥", doubled: 0 }, trump: "♥", trick: { leader: "north", plays: [{ seatId: "north", card: "♣2" }] },
    lastTrick: { winnerSeatId: "north", plays: [{ seatId: "north", card: "♣A" }, { seatId: "east", card: "♣K" }] },
    lastRoundScores: { north: 140, east: 20, south: 10, west: 10 }, lastRoundDetail: "3♥ 成約：主打方 9 墩 90 + 部分合約 50 = 140；其餘各家每墩 10" });
  const saved = structuredClone(state);
  const restored = engine.restore(JSON.parse(JSON.stringify(engine.serialize(state)))); assert.deepEqual(restored, state);
  const next = engine.transferSeat(restored, "north", "replacement");
  assert.deepEqual(next.order, ["replacement", "east", "south", "west"]); assert.equal(next.dealer, "replacement");
  assert.deepEqual(next.hands.replacement, state.hands.north); assert.equal(next.active, "replacement");
  assert.equal(next.contract!.seatId, "replacement"); assert.equal(next.bids[0]!.seatId, "replacement");
  assert.equal(next.trick!.leader, "replacement"); assert.equal(next.trick!.plays[0]!.seatId, "replacement");
  assert.equal(next.lastTrick!.winnerSeatId, "replacement"); assert.equal(next.lastTrick!.plays[0]!.seatId, "replacement");
  assert.deepEqual(next.tricksWon, { replacement: 0, east: 0, south: 0, west: 0 });
  assert.deepEqual(next.lastRoundScores, { replacement: 140, east: 20, south: 10, west: 10 });
  assert.ok(!JSON.stringify(next).includes("north")); assert.deepEqual(state, saved); assert.deepEqual(restored, saved);
  assert.equal(engine.transferSeat(state, "visitor", "replacement"), state);
});
