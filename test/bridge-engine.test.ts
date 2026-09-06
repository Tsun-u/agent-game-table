import assert from "node:assert/strict";
import test from "node:test";
import { createDeck } from "../src/cards.js";
import { bridgeEngine as engine, type BridgeState, type BridgeBoard } from "../src/engine/bridge-engine.js";
import { BIDS } from "../src/engine/honeymoon-rules.js";
import { highCardPoints } from "../src/engine/lightbridge-rules.js";
import { sortTrickCards } from "../src/engine/trick-taking-core.js";
import { DEFAULT_BRIDGE_OPTIONS as OPTS, BRIDGE_OPTION_DESCRIPTIONS, normalizeBridgeOptions,
  vulnerabilityFor, sideOf, partnerOf, scoreBridgeRound } from "../src/engine/bridge-rules.js";
import { engineFor } from "../src/engine/registry.js";
import { CHAIRS } from "../src/engine/types.js";

const SEATS = ["north", "east", "south", "west"];
function deal(round = 1, options = OPTS): BridgeState { return engine.deal({ deck: createDeck(), seatIds: SEATS, round }, options).state; }
function fixture(patch: Partial<BridgeState> = {}): BridgeState { return engine.restore({ ...deal(), ...patch }); }
function act(state: BridgeState, action: string, cards: string[] = [], options = OPTS, seat = state.active!) {
  return engine.apply(state, seat, { action, cards }, options);
}
function board(state: BridgeState, viewer: string | null = null): BridgeBoard { return engine.view(state, viewer, OPTS) as BridgeBoard; }
function actions(state: BridgeState, options = OPTS): string[] { return engine.legalActions(state, state.active!, options).map((a) => a.action); }
function passes(state: BridgeState, count = 3, options = OPTS): BridgeState {
  for (let i = 0; i < count; i++) state = act(state, "pass", [], options).state;
  return state;
}
function start(bid = "1NT", round = 1, options = OPTS): BridgeState { return passes(act(deal(round, options), "bid", [bid], options).state, 3, options); }

test("bridge options: defaults, invalid values, numeric strings, visibility and registry", () => {
  assert.deepEqual(OPTS, { vulnerability: "none", doubling: true, end_mode: "rounds", end_rounds: 4, end_score: 1500 });
  for (const value of [undefined, null, false, 7, "bad", [], { vulnerability: "bad", doubling: "false", end_mode: "bad", end_rounds: 0, end_score: NaN }]) assert.deepEqual(normalizeBridgeOptions(value), OPTS);
  for (const bad of [true, null, Infinity, -1, 1.5, {}, "", "abc", 100001]) assert.equal(normalizeBridgeOptions({ end_score: bad }).end_score, 1500);
  assert.equal(normalizeBridgeOptions({ end_rounds: 100 }).end_rounds, 4);
  assert.deepEqual(normalizeBridgeOptions({ vulnerability: "none", doubling: false, end_mode: "score", end_rounds: "8", end_score: "2000" }),
    { vulnerability: "none", doubling: false, end_mode: "score", end_rounds: 8, end_score: 2000 });
  for (const [key, value] of [["doubling", "none"], ["end_rounds", "rounds"], ["end_score", "score"]]) assert.deepEqual(BRIDGE_OPTION_DESCRIPTIONS.find((o) => o.key === key)!.visibleWhen, { key: key === "doubling" ? "vulnerability" : "end_mode", value });
  assert.equal(engineFor("bridge"), engine); assert.deepEqual(engine.seats, { min: 4, max: 4, fixed: true, chairs: CHAIRS });
  assert.equal(engine.label, "合約橋牌"); assert.equal(engine.rulesVersion, "bridge-tw-1");
});
test("bridge chicago: doubling is forced on regardless of input", () => {
  for (const doubling of [undefined, false, true, null, 0, "false", {}]) {
    const options = normalizeBridgeOptions({ vulnerability: "chicago", doubling });
    assert.equal(options.doubling, true);
    assert.ok(actions(act(deal(2, options), "bid", ["1♣"], options).state, options).includes("double"));
  }
});
test("bridge vulnerability: four-round cycle for north and east dealers, repeating", () => {
  const chicago = normalizeBridgeOptions({ vulnerability: "chicago" });
  for (let dealer = 0; dealer < 4; dealer++) for (let round = 1; round <= 8; round++) {
    assert.deepEqual(vulnerabilityFor(OPTS, round, dealer), { ns: false, ew: false });
    const cycle = (round - 1) % 4;
    const expected = cycle === 0 ? { ns: false, ew: false } : cycle === 3 ? { ns: true, ew: true } : { ns: dealer % 2 === 0, ew: dealer % 2 === 1 };
    assert.deepEqual(vulnerabilityFor(chicago, round, dealer), expected);
  }
});
test("bridge partnerships: opposite chairs, independent of seat ID spelling", () => {
  const order = ["a", "b", "c", "d"];
  for (let i = 0; i < 4; i++) {
    assert.equal(sideOf(order, order[i]!), i % 2 === 0 ? "ns" : "ew");
    assert.equal(partnerOf(order, order[i]!), order[(i + 2) % 4]);
  }
});
test("bridge rules: full two-column scoring table and agent protocol", () => {
  const text = engine.formatRules(engine.buildRules(OPTS));
  for (const pattern of [/bridge-tw-1/, /固定 4 人/, /北南對東西/, /連續三家 PASS/, /四家全 PASS 同一人重發/, /身價不變/, /最先叫出合約花色/, /首攻出牌後夢家攤牌/, /莊家的下家/, /13 墩/, /\| 項目 \| 無身價 \| 有身價 \|/, /第 4 墩起各 300/, /侮辱分/, /play_card/, /pass／double／redouble/, /legal_plays 照抄/, /bid_hint 只是建議/, /賭倍：開/, /4 局/, /4 的倍數/]) assert.match(text, pattern);
  const alternate = engine.formatRules(engine.buildRules(normalizeBridgeOptions({ vulnerability: "chicago", doubling: false, end_mode: "score" })));
  for (const pattern of [/身價：四局制/, /賭倍：開/, /≥ 1500/]) assert.match(alternate, pattern);
});

// 計畫任務 3 步驟 2 的 18 個期望值，原樣保留，每案獨立測試。
const scoringCases: readonly [string, number, boolean, 0 | 1 | 2, number][] = [
  ["1♣", 7, false, 0, 70], ["3NT", 9, false, 0, 400], ["4♠", 10, false, 0, 420],
  ["4♠", 11, false, 0, 450], ["6♥", 12, false, 0, 980], ["7NT", 13, false, 0, 1520],
  ["3NT", 9, true, 0, 600], ["4♠", 10, true, 0, 620], ["6♣", 12, true, 0, 1370], ["7♠", 13, true, 0, 2210],
  ["2♥", 8, false, 1, 470], ["2♥", 9, false, 1, 570], ["2♥", 8, false, 2, 640],
  ["3NT", 7, false, 0, 100], ["3NT", 7, true, 0, 200],
  ["3NT", 6, false, 1, 500], ["3NT", 6, true, 1, 800], ["3NT", 6, false, 2, 1000],
];
for (const [bid, tricks, vul, doubled, expected] of scoringCases) test(`bridge score: ${bid}${"X".repeat(doubled)}, ${tricks} tricks, vulnerable=${vul} => ${expected}`, () => {
  for (const declarer of SEATS) {
    const side = sideOf(SEATS, declarer);
    const tricksWon = side === "ns" ? { ns: tricks, ew: 13 - tricks } : { ns: 13 - tricks, ew: tricks };
    const vulnerable = side === "ns" ? { ns: vul, ew: !vul } : { ns: !vul, ew: vul };
    const contract = { bid, doubled, declarer };
    const saved = structuredClone({ contract, tricksWon, vulnerable });
    const result = scoreBridgeRound(contract, tricksWon, vulnerable, SEATS);
    const made = tricks >= 6 + Number(bid[0]);
    const scoringSide = made ? side : side === "ns" ? "ew" : "ns";
    assert.equal(result.made, made);
    assert.deepEqual(result.scores, Object.fromEntries(SEATS.map((seat) => [seat, sideOf(SEATS, seat) === scoringSide ? expected : 0])));
    assert.ok(result.detail.endsWith(`= ${expected}，${scoringSide === "ns" ? "北南" : "東西"}得分`));
    assert.deepEqual({ contract, tricksWon, vulnerable }, saved);
  }
});
test("bridge score: detail matches the specified arithmetic examples", () => {
  assert.equal(scoreBridgeRound({ bid: "4♠", doubled: 1, declarer: "north" }, { ns: 10, ew: 3 }, { ns: true, ew: false }, SEATS).detail, "4♠X 有身價成約：墩分 240 + 成局 500 + 侮辱分 50 = 790，北南得分");
  assert.equal(scoreBridgeRound({ bid: "3NT", doubled: 0, declarer: "north" }, { ns: 7, ew: 6 }, { ns: false, ew: true }, SEATS).detail, "3NT 無身價倒 2 墩：50 × 2 = 100，東西得分");
});
test("bridge score: overtrick rates and the fourth doubled undertrick", () => {
  const cases: readonly [string, number, boolean, 0 | 1 | 2, number][] = [
    ["1NT", 8, false, 0, 120], ["1♦", 8, false, 0, 90],
    ["2♥", 9, true, 1, 870], ["2♥", 9, true, 2, 1240], ["2♥", 9, false, 2, 840],
    ["3NT", 5, false, 1, 800], ["3NT", 5, true, 1, 1100], ["3NT", 5, false, 2, 1600],
  ];
  for (const [bid, tricks, vul, doubled, expected] of cases) {
    const scored = scoreBridgeRound({ bid, doubled, declarer: "north" }, { ns: tricks, ew: 13 - tricks }, { ns: vul, ew: false }, SEATS);
    assert.equal(Math.max(...Object.values(scored.scores)), expected);
  }
});
test("bridge deal: 13 sorted cards each, rotating dealer and public vulnerability events", () => {
  const options = normalizeBridgeOptions({ vulnerability: "chicago" });
  const texts = ["本局都無身價。", "本局東西有身價。", "本局北南有身價。", "本局都有身價。"];
  for (let round = 1; round <= 8; round++) {
    const input = { deck: createDeck().reverse(), seatIds: SEATS, round };
    const result = engine.deal(input, options); const state = result.state;
    assert.equal(result.result, null); assert.equal(state.phase, "bidding");
    assert.equal(state.dealer, SEATS[(round - 1) % 4]); assert.equal(state.active, state.dealer);
    assert.deepEqual(engine.pendingSeatIds(state), [state.dealer]);
    assert.deepEqual(state.vulnerable, vulnerabilityFor(options, round, (round - 1) % 4));
    for (const seat of SEATS) { assert.equal(state.hands[seat]!.length, 13); assert.deepEqual(state.hands[seat], sortTrickCards(state.hands[seat]!)); }
    assert.equal(new Set(Object.values(state.hands).flat()).size, 52);
    assert.deepEqual(result.events, [{ kind: "turn_started", seatId: state.dealer, text: `第 ${round} 局開始，{name} 發牌並先叫牌。` }, { kind: "vulnerability", seatId: null, text: texts[(round - 1) % 4] }]);
  }
});
test("bridge bidding: higher bids only, three passes and turn/payload legality", () => {
  const initial = deal(); assert.deepEqual(actions(initial), ["bid", "pass"]);
  assert.deepEqual(engine.legalPlays(initial, "north", OPTS).map((p) => p.cards[0]), BIDS);
  assert.deepEqual(engine.legalActions(initial, "east", OPTS), []);
  assert.throws(() => act(initial, "bid", ["1♣"], OPTS, "east"));
  for (const cards of [[], ["bad"], ["1♣", "1♦"]]) assert.throws(() => act(initial, "bid", cards));
  assert.throws(() => act(initial, "pass", ["♠A"])); assert.throws(() => act(initial, "redeal"));
  const next = act(initial, "bid", ["2♥"]).state;
  assert.deepEqual(engine.legalPlays(next, next.active!, OPTS), BIDS.slice(8).map((bid) => ({ action: "bid", cards: [bid], label: "可叫" })));
  for (const bid of ["1NT", "2♥"]) assert.throws(() => act(next, "bid", [bid]));
  const top = act(next, "bid", ["7NT"]).state;
  assert.ok(!actions(top).includes("bid")); assert.deepEqual(engine.legalPlays(top, top.active!, OPTS), []);
  const twice = passes(next, 2); assert.equal(twice.phase, "bidding"); assert.equal(twice.contract, null);
  const result = act(twice, "pass"); const state = result.state;
  assert.deepEqual(state.contract, { declarer: "north", bid: "2♥", doubled: 0 });
  assert.equal(state.phase, "play"); assert.equal(state.trump, "♥"); assert.equal(state.active, "east");
  assert.deepEqual(state.trick, { leader: "east", plays: [] });
  assert.deepEqual(result.events, [{ kind: "pass", seatId: "west", text: "{name} PASS。" }, { kind: "contract", seatId: "north", text: "合約 2♥ 由 {name} 主打。" }, { kind: "dummy", seatId: "south", text: "{name} 是夢家。" }]);
  assert.throws(() => act(state, "bid", ["3NT"])); assert.equal(start().trump, null);
});
for (const [opening, expected] of [["1♠", "north"], ["1♣", "south"]]) test(`bridge declarer: first team member to bid strain, opening ${opening} => ${expected}`, () => {
  const state = fixture({ bids: [{ seatId: "north", call: opening! }, { seatId: "east", call: "PASS" },
    { seatId: "south", call: opening === "1♠" ? "2♠" : "1♠" }, { seatId: "west", call: "PASS" }, { seatId: "north", call: "4♠" }], active: "east" });
  const next = passes(state);
  assert.equal(next.contract!.declarer, expected);
  assert.equal(next.active, expected === "north" ? "east" : "west");
  assert.deepEqual(board(next).contract, { bid: "4♠", doubled: 0, declarer_seat_id: expected, dummy_seat_id: expected === "north" ? "south" : "north" });
});
test("bridge declarer: opponents' earlier strain does not select declarer", () => {
  const state = fixture({ bids: [{ seatId: "north", call: "1♠" }, { seatId: "east", call: "2♠" }, { seatId: "south", call: "PASS" }, { seatId: "west", call: "4♠" }], active: "north" });
  const next = passes(state); assert.equal(next.contract!.declarer, "east"); assert.equal(next.active, "south");
});
test("bridge doubling: both partners can redouble, opponents can double, disabled option", () => {
  assert.ok(!actions(deal()).includes("double")); assert.throws(() => act(deal(), "double"));
  for (const bidder of SEATS) for (const seat of SEATS) {
    const state = fixture({ bids: [{ seatId: bidder, call: "2♥" }], active: seat });
    const opposing = sideOf(SEATS, bidder) !== sideOf(SEATS, seat);
    assert.equal(actions(state).includes("double"), opposing);
    if (!opposing) assert.throws(() => act(state, "double"));
    const doubled = fixture({ ...state, bids: [...state.bids, { seatId: SEATS[(SEATS.indexOf(bidder) + 1) % 4]!, call: "X" }] });
    assert.equal(actions(doubled).includes("redouble"), !opposing);
    assert.ok(!actions(doubled).includes("double"));
    if (opposing) assert.throws(() => act(doubled, "redouble"));
    for (const candidate of [state, doubled]) {
      const off = { ...OPTS, doubling: false };
      assert.ok(!actions(candidate, off).includes("double")); assert.ok(!actions(candidate, off).includes("redouble"));
      assert.throws(() => act(candidate, "double", [], off)); assert.throws(() => act(candidate, "redouble", [], off));
    }
  }
});
test("bridge doubling: pass streak resets, higher bids clear multipliers and contract events include X", () => {
  const called = act(deal(), "bid", ["2♥"]).state;
  assert.throws(() => act(called, "double", ["♠A"]));
  const doubled = act(passes(called, 2), "double").state;
  assert.equal(passes(doubled, 2).phase, "bidding");
  const closed = act(passes(doubled, 2), "pass");
  assert.equal(closed.state.contract!.doubled, 1); assert.match(closed.events[1]!.text, /2♥X/);
  assert.throws(() => act(doubled, "redouble", ["♠A"]));
  const redoubled = act(doubled, "redouble").state;
  assert.equal(passes(redoubled, 2).phase, "bidding"); assert.equal(passes(redoubled).contract!.doubled, 2);
  assert.ok(!actions(redoubled).includes("double")); assert.ok(!actions(redoubled).includes("redouble"));
  for (const candidate of [doubled, redoubled]) {
    const raised = act(candidate, "bid", ["3NT"]).state;
    assert.ok(actions(raised).includes("double")); assert.equal(passes(raised).contract!.doubled, 0);
  }
});
test("bridge all PASS: same dealer and vulnerability, fresh full deck, no result or stale auction", () => {
  const options = normalizeBridgeOptions({ vulnerability: "chicago" });
  for (let round = 1; round <= 4; round++) {
    let state = deal(round, options);
    for (let repeat = 0; repeat < 2; repeat++) {
      state = passes(state, 3, options); const saved = structuredClone(state);
      const result = act(state, "pass", [], options); const next = result.state;
      assert.deepEqual(state, saved); assert.equal(result.result, null); assert.equal(next.phase, "bidding");
      assert.equal(next.dealer, state.dealer); assert.equal(next.active, state.dealer); assert.deepEqual(next.vulnerable, state.vulnerable);
      assert.deepEqual(next.bids, []); assert.equal(next.contract, null); assert.equal(next.trump, null); assert.equal(next.trick, null);
      assert.equal(next.dummyRevealed, false); assert.equal(next.lastTrick, null); assert.equal(next.lastRoundScores, null); assert.equal(next.lastRoundDetail, null);
      assert.deepEqual(next.tricksWon, { north: 0, east: 0, south: 0, west: 0 });
      for (const hand of Object.values(next.hands)) { assert.equal(hand.length, 13); assert.deepEqual(hand, sortTrickCards(hand)); }
      const cards = Object.values(next.hands).flat(); assert.equal(cards.length, 52); assert.equal(new Set(cards).size, 52);
      assert.deepEqual(new Set(cards), new Set(createDeck().map((c) => c.code)));
      assert.deepEqual(result.events, [{ kind: "redeal", seatId: state.dealer, text: "四家都 PASS，重新發牌，仍由 {name} 發牌。" }]);
      state = next;
    }
  }
});

test("bridge dummy: revealed after opening lead, declarer operates dummy's cards with follow suit", () => {
  const state = fixture({ ...start(), hands: { north: ["♣A", "♦2"], east: ["♣2", "♠A"], south: ["♣K", "♥A"], west: ["♣3", "♦A"] } });
  for (const viewer of [...SEATS, null, "visitor"]) assert.equal(board(state, viewer).dummy_hand, null);
  const first = act(state, "play_card", ["♣2"]).state;
  assert.equal(state.dummyRevealed, false); assert.equal(first.dummyRevealed, true);
  assert.deepEqual(engine.pendingSeatIds(first), ["north"]); assert.equal(first.active, "north");
  assert.deepEqual(engine.legalActions(first, "south", OPTS), []); assert.deepEqual(engine.legalPlays(first, "south", OPTS), []);
  assert.deepEqual(engine.legalPlays(first, "north", OPTS), [{ action: "play_card", cards: ["♣K"], label: "替夢家出" }]);
  for (const viewer of [...SEATS, null, "visitor"]) {
    assert.deepEqual(board(first, viewer).dummy_hand, ["♣K", "♥A"]);
    const text = JSON.stringify(board(first, viewer));
    for (const seat of ["north", "east", "west"]) for (const card of first.hands[seat]!) assert.ok(!text.includes(card));
  }
  assert.deepEqual(engine.hand(first, "south"), ["♣K", "♥A"]);
  for (const cards of [["♣A"], ["♥A"], [], ["♣K", "♥A"]]) assert.throws(() => act(first, "play_card", cards));
  assert.throws(() => act(first, "play_card", ["♣K"], OPTS, "south"));
  const second = act(first, "play_card", ["♣K"]);
  assert.deepEqual(second.events, [{ kind: "card_played", seatId: "south", text: "{name} 出 ♣K。" }]);
  assert.deepEqual(second.state.trick!.plays, [{ seatId: "east", card: "♣2" }, { seatId: "south", card: "♣K" }]);
  assert.deepEqual(second.state.hands.north, state.hands.north); assert.deepEqual(board(second.state).dummy_hand, ["♥A"]);
  const third = act(second.state, "play_card", ["♣3"]).state;
  assert.equal(third.active, "north"); assert.deepEqual(engine.legalPlays(third, "north", OPTS), [{ action: "play_card", cards: ["♣A"], label: "可出" }]);
  assert.throws(() => act(third, "play_card", ["♥A"]));
});
for (const trump of ["♠", null]) test(`bridge trick: trump=${trump}, dummy winner is controlled by declarer`, () => {
  const state = fixture({ ...start(trump ? "1♠" : "1NT"), hands: { north: ["♣3", "♦2"], east: ["♣K", "♦3"], south: ["♠2", "♥A"], west: ["♣2", "♦A"] } });
  let next = state;
  for (const card of ["♣K", "♠2", "♣2"]) next = act(next, "play_card", [card]).state;
  const result = act(next, "play_card", ["♣3"]); next = result.state;
  const winner = trump ? "south" : "east";
  assert.equal(next.lastTrick!.winnerSeatId, winner); assert.equal(next.lastTrick!.plays.length, 4);
  assert.deepEqual(next.trick, { leader: winner, plays: [] }); assert.equal(next.active, trump ? "north" : "east");
  assert.equal(next.tricksWon[winner], 1); assert.equal(next.tricksWon[partnerOf(SEATS, winner)], 1);
  assert.deepEqual(board(next).tricks_won, trump ? { ns: 1, ew: 0 } : { ns: 0, ew: 1 });
  assert.deepEqual(result.events[1], { kind: "trick_won", seatId: winner, text: "{name} 贏得第 1 墩。" });
  assert.equal(board(next).last_trick!.winner_seat_id, winner);
  if (trump) {
    assert.deepEqual(engine.legalPlays(next, "north", OPTS), [{ action: "play_card", cards: ["♥A"], label: "替夢家出" }]);
    assert.deepEqual(engine.legalActions(next, "south", OPTS), []);
    assert.equal(act(next, "play_card", ["♥A"]).state.trick!.plays[0]!.seatId, "south");
  }
  assert.equal(state.trick!.plays.length, 0); assert.equal(state.hands.east!.length, 2);
});
for (const round of [1, 2, 3, 4]) test(`bridge complete round: 52 cards, 13 team tricks, settlement (dealer ${round})`, () => {
  const options = normalizeBridgeOptions({ vulnerability: "chicago" });
  let state = start("2♥", round, options);
  const dummy = partnerOf(SEATS, state.contract!.declarer);
  for (let i = 0; i < 52; i++) {
    assert.deepEqual(engine.legalActions(state, dummy, options), []);
    const play = engine.legalPlays(state, state.active!, options)[0]!;
    const result = engine.apply(state, state.active!, play, options); state = result.state;
    const counts = board(state).tricks_won;
    assert.equal(counts.ns + counts.ew, Math.floor((i + 1) / 4));
    assert.equal(state.tricksWon.north, state.tricksWon.south); assert.equal(state.tricksWon.east, state.tricksWon.west);
    assert.equal(Object.values(state.hands).flat().length, 51 - i);
    if (i < 51) { assert.equal(result.result, null); assert.equal(state.phase, "play"); }
    else {
      assert.equal(state.phase, "ended"); assert.ok(result.result);
      const expected = scoreBridgeRound(state.contract!, counts, state.vulnerable, SEATS);
      assert.deepEqual(result.result.scoreDelta, expected.scores); assert.equal(result.result.gameOver, false);
      assert.deepEqual(board(state).last_round_scores, expected.scores); assert.equal(board(state).last_round_detail, expected.detail);
      assert.equal(result.result.winnerSeatId, SEATS.find((seat) => expected.scores[seat]! > 0));
      assert.equal(result.result.text, "本局結束，{name} 那隊得分。");
    }
    if (i % 4 === 3 && i < 51) assert.equal(state.active, state.lastTrick!.winnerSeatId === dummy ? state.contract!.declarer : state.lastTrick!.winnerSeatId);
  }
  assert.equal(state.active, null); assert.equal(board(state).last_trick!.plays.length, 4); assert.deepEqual(board(state).dummy_hand, []);
  assert.deepEqual(engine.pendingSeatIds(state), []); assert.deepEqual(engine.legalActions(state, "north", options), []);
  assert.deepEqual(engine.legalPlays(state, "north", options), []); assert.throws(() => act(state, "pass", [], options, "north"));
});
test("bridge settlement: defenders score and winner is earlier team seat", () => {
  let state = fixture({ ...start("3NT"), hands: { north: ["♣A"], east: ["♣2"], south: ["♣3"], west: ["♣4"] },
    tricksWon: { north: 6, east: 6, south: 6, west: 6 } });
  for (const card of ["♣2", "♣3", "♣4"]) state = act(state, "play_card", [card]).state;
  const result = act(state, "play_card", ["♣A"]);
  assert.deepEqual(result.result!.scoreDelta, { north: 0, east: 100, south: 0, west: 100 });
  assert.equal(result.result!.winnerSeatId, "east");
});
test("bridge view: exact public fields, only seated bidding viewers get HCP, copied public data", () => {
  const state = deal();
  assert.deepEqual(Object.keys(board(state)).sort(), ["phase", "dealer_seat_id", "vulnerable", "contract", "dummy_hand", "trump", "bids", "viewer_hcp", "trick", "tricks_won", "last_trick", "seat_status", "last_round_scores", "last_round_detail"].sort());
  for (const viewer of [...SEATS, null, "visitor"]) {
    const view = board(state, viewer);
    assert.equal(view.viewer_hcp, viewer !== null && SEATS.includes(viewer) ? highCardPoints(state.hands[viewer]!) : null);
    for (const card of Object.values(state.hands).flat()) assert.ok(!JSON.stringify(view).includes(card));
  }
  assert.deepEqual(engine.hand(state, "north"), state.hands.north); assert.deepEqual(engine.hand(state, "visitor"), []);
  const play = start(); assert.equal(board(play, "north").viewer_hcp, null);
  const exposed = act(play, "play_card", [engine.legalPlays(play, play.active!, OPTS)[0]!.cards[0]!]).state;
  const view = board(exposed); view.dummy_hand!.pop(); view.vulnerable.ns = true; view.trick!.plays.pop();
  assert.equal(exposed.hands.south!.length, 13); assert.equal(exposed.vulnerable.ns, false); assert.equal(exposed.trick!.plays.length, 1);
});
test("bridge lifecycle: both game end modes and leaving during bidding/play aborts", () => {
  assert.equal(engine.isGameOver(OPTS, { round: 3, scores: { north: 9999 } }), false);
  assert.equal(engine.isGameOver(OPTS, { round: 4, scores: {} }), true); assert.equal(engine.isGameOver(OPTS, { round: 5, scores: {} }), true);
  for (const [score, expected] of [[1499, false], [1500, true], [1501, true], [-1500, false]] as const) assert.equal(engine.isGameOver({ ...OPTS, end_mode: "score" }, { round: 99, scores: { north: 0, west: score } }), expected);
  for (const state of [deal(), start()]) for (const seat of SEATS) assert.equal(engine.onSeatRemoved(state, seat, OPTS), "abort");
  assert.notEqual(engine.onSeatRemoved(deal(), "visitor", OPTS), "abort");
  assert.notEqual(engine.onSeatRemoved(fixture({ phase: "ended", active: null }), "north", OPTS), "abort");
});
test("bridge transfer and persistence: all references move, including declarer controlling dummy", () => {
  const state = fixture({ ...start("2♥"), active: "north", dummyRevealed: true, vulnerable: { ns: true, ew: false },
    trick: { leader: "north", plays: [] }, lastTrick: { winnerSeatId: "north", plays: [{ seatId: "north", card: "♣A" }, { seatId: "east", card: "♣K" }] },
    tricksWon: { north: 1, east: 0, south: 1, west: 0 }, lastRoundScores: { north: 140, east: 0, south: 140, west: 0 }, lastRoundDetail: "測試算式" });
  const saved = structuredClone(state);
  const restored = engine.restore(JSON.parse(JSON.stringify(engine.serialize(state)))); assert.deepEqual(restored, state);
  const next = engine.transferSeat(restored, "north", "replacement");
  assert.deepEqual(next.order, ["replacement", "east", "south", "west"]); assert.equal(next.dealer, "replacement");
  assert.equal(next.contract!.declarer, "replacement"); assert.equal(next.active, "replacement"); assert.equal(next.bids[0]!.seatId, "replacement");
  assert.equal(next.trick!.leader, "replacement"); assert.equal(next.lastTrick!.winnerSeatId, "replacement"); assert.equal(next.lastTrick!.plays[0]!.seatId, "replacement");
  assert.deepEqual(next.hands.replacement, state.hands.north); assert.deepEqual(next.tricksWon, { replacement: 1, east: 0, south: 1, west: 0 });
  assert.deepEqual(next.lastRoundScores, { replacement: 140, east: 0, south: 140, west: 0 }); assert.deepEqual(next.vulnerable, state.vulnerable);
  assert.ok(!JSON.stringify(next).includes("north")); assert.deepEqual(state, saved); assert.deepEqual(restored, saved);
  assert.equal(engine.transferSeat(state, "visitor", "replacement"), state);
  const lead = start(); const dummyTurn = act(lead, "play_card", [engine.legalPlays(lead, lead.active!, OPTS)[0]!.cards[0]!]).state;
  const replacement = engine.transferSeat(dummyTurn, "north", "replacement");
  assert.deepEqual(engine.pendingSeatIds(replacement), ["replacement"]); assert.equal(board(replacement).contract!.declarer_seat_id, "replacement");
  const legal = engine.legalPlays(replacement, "replacement", OPTS)[0]!;
  assert.equal(legal.label, "替夢家出"); assert.equal(engine.apply(replacement, "replacement", legal, OPTS).state.trick!.plays[1]!.seatId, "south");
  const newDummy = engine.transferSeat(replacement, "south", "new-dummy");
  assert.equal(board(newDummy).contract!.dummy_seat_id, "new-dummy");
  assert.equal(engine.apply(newDummy, "replacement", legal, OPTS).state.trick!.plays[1]!.seatId, "new-dummy");
  const midTrick = engine.transferSeat(dummyTurn, "east", "new-east");
  assert.equal(midTrick.trick!.leader, "new-east"); assert.equal(midTrick.trick!.plays[0]!.seatId, "new-east");
});
