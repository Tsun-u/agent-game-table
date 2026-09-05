import assert from "node:assert/strict";
import test from "node:test";
import { createDeck, parseCard, type Card } from "../src/cards.js";
import { paiqiEngine as engine, placeable, type PaiqiBoard, type PaiqiState } from "../src/engine/paiqi-engine.js";
import { coverPoints, DEFAULT_PAIQI_OPTIONS as OPTS, normalizePaiqiOptions, PAIQI_OPTION_DESCRIPTIONS, PAIQI_RANKS, scorePaiqiRound, type PaiqiOptions } from "../src/engine/paiqi-rules.js";
import { engineFor } from "../src/engine/registry.js";

const SEATS = ["north", "east", "south", "west", "fifth", "sixth"];
function deckFrom(front: string[]): Card[] {
  return [...front.map(parseCard), ...createDeck().filter((card) => !front.includes(card.code))];
}
function fixture(patch: Partial<PaiqiState> = {}): PaiqiState {
  return engine.restore({
    phase: "play", order: SEATS.slice(0, 2), hands: { north: ["♥7", "♣K"], east: ["♠8", "♦K"] },
    placed: { "♠7": "card" }, pool: [], leftover: [], covered: { north: [], east: [] },
    active: "north", lastPlay: null, lastRoundPoints: null, lastRoundScores: null, ...patch,
  });
}

test("paiqi options: defaults, invalid values fall back, valid numeric strings and visibility", () => {
  for (const value of [undefined, null, false, 7, "bad", [], { end_mode: "bad", end_score: NaN, end_rounds: 0, leftover_mode: "bad" }]) assert.deepEqual(normalizePaiqiOptions(value), OPTS);
  for (const bad of [true, null, Infinity, -1, 1.5, {}, "", "abc", 100001]) assert.equal(normalizePaiqiOptions({ end_score: bad }).end_score, 100);
  assert.equal(normalizePaiqiOptions({ end_rounds: 100 }).end_rounds, 4);
  assert.deepEqual(normalizePaiqiOptions({ end_mode: "score", end_score: "150", end_rounds: "9", leftover_mode: "open_pool" }), { end_mode: "score", end_score: 150, end_rounds: 9, leftover_mode: "open_pool" });
  assert.deepEqual(PAIQI_OPTION_DESCRIPTIONS.find((option) => option.key === "end_rounds")!.visibleWhen, { key: "end_mode", value: "rounds" });
  assert.deepEqual(PAIQI_OPTION_DESCRIPTIONS.find((option) => option.key === "end_score")!.visibleWhen, { key: "end_mode", value: "score" });
  assert.equal(engineFor("paiqi"), engine);
  for (const leftover_mode of ["deal_after_seven", "open_pool"] as const) {
    const text = engine.formatRules(engine.buildRules({ ...OPTS, leftover_mode }));
    assert.match(text, /paiqi-tw-1/);
    assert.match(text, /2 到 6 人/);
    assert.match(text, /cover_card/);
    assert.match(text, /尾差，不另行調整/);
    assert.ok(!text.includes(`多的牌：${leftover_mode}`));
  }
  assert.match(engine.formatRules(engine.buildRules({ ...OPTS, end_mode: "score" })), /≤ −100/);
});

test("paiqi scoring: every rank and suit, jokers zero, invalid cards rejected", () => {
  for (const suit of ["♣", "♦", "♥", "♠"]) PAIQI_RANKS.forEach((rank, index) => assert.equal(coverPoints(`${suit}${rank}`), index + 1));
  assert.equal(coverPoints("🃏1"), 0);
  assert.equal(coverPoints("🃏2"), 0);
  for (const card of ["♠14", "bad", "🃏3"]) assert.throws(() => coverPoints(card), /無效的牌/);
});

test("paiqi scores: raw points, average, order tie break, independent rounding and no negative zero", () => {
  const result = scorePaiqiRound({ north: ["♥K"], east: ["♣A"], south: ["🃏1"] }, SEATS.slice(0, 3));
  assert.deepEqual(result.points, { north: 13, east: 1, south: 0 });
  assert.equal(result.average, 14 / 3);
  assert.deepEqual(result.scores, { north: -8.3, east: 3.7, south: 4.7 });
  assert.equal(result.winnerSeatId, "south");
  const tied = scorePaiqiRound({ north: ["🃏2"], east: [] }, ["east", "north"]);
  assert.equal(tied.winnerSeatId, "east");
  assert.ok(Object.values(tied.scores).every((value) => !Object.is(value, -0)));
  for (const count of [2, 3, 4, 5, 6]) for (let points = 0; points <= 13; points += 1) {
    const round = scorePaiqiRound({ north: points ? [`♠${PAIQI_RANKS[points - 1]}`] : [] }, SEATS.slice(0, count));
    assert.ok(Math.abs(Object.values(round.scores).reduce((sum, value) => sum + value, 0)) <= 0.1 * count);
    for (const seat of SEATS.slice(0, count)) {
      const rounded = Math.round((round.average - round.points[seat]!) * 10) / 10;
      assert.equal(round.scores[seat], rounded === 0 ? 0 : rounded);
    }
    for (const value of Object.values(round.scores)) assert.ok(Math.abs(value * 10 - Math.round(value * 10)) < 1e-9);
  }
});

test("paiqi dealing: 2 to 6 players, leftover modes, unique cards, rotated opener and unchanged input deck", () => {
  for (const [count, size, extra] of [[2, 26, 0], [3, 17, 1], [4, 13, 0], [5, 10, 2], [6, 9, 0]] as const) {
    for (const leftover_mode of ["deal_after_seven", "open_pool"] as const) {
      const deck = deckFrom(["♥A", "♠7"]);
      const original = [...deck];
      const seats = SEATS.slice(0, count);
      const state = engine.deal({ deck, seatIds: seats, round: 2 }, { ...OPTS, leftover_mode }).state;
      for (const seat of seats) assert.equal(state.hands[seat]!.length, size);
      assert.equal(state.leftover.length, leftover_mode === "deal_after_seven" ? extra : 0);
      assert.equal(state.pool.length, leftover_mode === "open_pool" ? extra : 0);
      assert.ok(state.hands[state.active!]!.includes("♠7"));
      const first = seats.indexOf(state.active!);
      assert.deepEqual(state.order, [...seats.slice(first), ...seats.slice(0, first)]);
      const all = [...Object.values(state.hands).flat(), ...state.pool, ...state.leftover];
      assert.equal(new Set(all).size, count === 6 ? 54 : 52);
      assert.equal(all.filter((card) => card.startsWith("🃏")).length, count === 6 ? 2 : 0);
      assert.deepEqual(deck, original);
    }
  }
  assert.throws(() => engine.deal({ deck: createDeck(), seatIds: ["solo"], round: 1 }, OPTS), /2 到 6/);
});

test("paiqi dealing: spade seven at the tail swaps with deck zero before dealing", () => {
  const deck = [...createDeck().filter((card) => card.code !== "♠7"), parseCard("♠7")];
  for (const count of [3, 5]) for (const leftover_mode of ["deal_after_seven", "open_pool"] as const) {
    const state = engine.deal({ deck, seatIds: SEATS.slice(0, count), round: 1 }, { ...OPTS, leftover_mode }).state;
    assert.equal(state.active, "north");
    assert.ok(state.hands.north!.includes("♠7"));
    assert.ok([...state.pool, ...state.leftover].includes(deck[0]!.code));
    assert.ok(![...state.pool, ...state.leftover].includes("♠7"));
  }
});

test("paiqi opening: only spade seven, wrong turn and illegal cards rejected without mutation", () => {
  const state = engine.deal({ deck: deckFrom(["♠7", "♣A", "♥7"]), seatIds: SEATS.slice(0, 2), round: 1 }, OPTS).state;
  const before = JSON.stringify(state);
  assert.deepEqual(engine.legalPlays(state, "north", OPTS).map((play) => play.cards), [["♠7"]]);
  assert.deepEqual(engine.legalActions(state, "north", OPTS).map((play) => play.action), ["play_card"]);
  assert.deepEqual(engine.legalPlays(state, "east", OPTS), []);
  for (const action of [{ action: "play_card", cards: ["♥7"] }, { action: "cover_card", cards: ["♥7"] }, { action: "play_card", cards: [] }, { action: "play_card", cards: ["bad"] }, { action: "play_card", cards: ["♠7", "♥7"] }]) assert.throws(() => engine.apply(state, "north", action, OPTS));
  assert.throws(() => engine.apply(state, "east", { action: "play_card", cards: ["♣A"] }, OPTS), /不是你的回合/);
  assert.throws(() => engine.apply(state, "outsider", { action: "play_card", cards: ["♠7"] }, OPTS), /不在這局/);
  assert.equal(JSON.stringify(state), before);
});

test("paiqi placement: sevens, same-suit adjacency, A and K boundaries and compulsory play", () => {
  const state = fixture({ hands: { north: ["♥7", "♠6", "♠8", "♠9", "♣6"], east: ["♣K"] } });
  assert.deepEqual(engine.legalPlays(state, "north", OPTS).map((play) => play.cards), [["♥7"], ["♠6"], ["♠8"]]);
  for (const card of ["♠7", "♠9", "♣6", "bad", "🃏1"]) assert.equal(placeable(state, card), false);
  assert.throws(() => engine.apply(state, "north", { action: "cover_card", cards: ["♣6"] }, OPTS), /不能蓋牌/);
  assert.equal(placeable(fixture({ placed: { "♠2": "card" } }), "♠A"), true);
  assert.equal(placeable(fixture({ placed: { "♠Q": "card" } }), "♠K"), true);
  assert.equal(placeable(fixture({ placed: { "♠K": "card" } }), "♠A"), false);
});

test("paiqi cover: only when stuck, card removed forever, views and events hide its identity", () => {
  const state = fixture({ hands: { north: ["♣K", "♥A"], east: ["♠8"] } });
  assert.deepEqual(engine.legalActions(state, "north", OPTS), [{ action: "cover_card", label: "蓋牌" }]);
  assert.deepEqual(engine.legalPlays(state, "north", OPTS).map((play) => ({ action: play.action, cards: play.cards })), [{ action: "cover_card", cards: ["♣K"] }, { action: "cover_card", cards: ["♥A"] }]);
  assert.throws(() => engine.apply(state, "north", { action: "play_card", cards: ["♣K"] }, OPTS), /不能出/);
  const turn = engine.apply(state, "north", { action: "cover_card", cards: ["♣K"] }, OPTS);
  assert.deepEqual(engine.hand(turn.state, "north"), ["♥A"]);
  assert.deepEqual(turn.state.covered.north, ["♣K"]);
  for (const viewer of [null, "north", "east"]) {
    const board = engine.view(turn.state, viewer, OPTS) as PaiqiBoard;
    assert.equal(board.covered_count.north, 1);
    assert.equal(board.covered_cards, null);
    assert.equal(board.last_play!.card, null);
    assert.ok(!JSON.stringify(board).includes("♣K"));
  }
  assert.equal(turn.events[0]!.text, "{name} 蓋了一張牌。");
  assert.throws(() => engine.apply(turn.state, "north", { action: "cover_card", cards: ["♣K"] }, OPTS), /不是你的回合/);
  assert.deepEqual(state.covered.north, []);
});

test("paiqi leftovers: after opening deal from the rotated first seat exactly once", () => {
  const deck = [...createDeck().filter((card) => !["♠7", "♥A", "♦K"].includes(card.code))];
  deck.splice(2, 0, parseCard("♠7"));
  deck.push(parseCard("♥A"), parseCard("♦K"));
  const state = engine.deal({ deck, seatIds: SEATS.slice(0, 5), round: 1 }, OPTS).state;
  assert.equal(state.active, "south");
  const turn = engine.apply(state, "south", { action: "play_card", cards: ["♠7"] }, OPTS);
  assert.ok(turn.state.hands.south!.includes("♥A"));
  assert.ok(turn.state.hands.west!.includes("♦K"));
  assert.equal(turn.state.hands.south!.length, 10);
  assert.equal(turn.state.hands.west!.length, 11);
  assert.deepEqual(turn.state.leftover, []);
  const action = engine.legalPlays(turn.state, "west", OPTS)[0]!;
  const next = engine.apply(turn.state, "west", action, OPTS).state;
  assert.equal(next.hands.south!.length, 10);
  assert.equal(next.hands.west!.length, 10);
});

test("paiqi pool: remains untouched until opening, then chains even when earlier entries were blocked", () => {
  const state = fixture({ placed: {}, hands: { north: ["♠7", "♣A"], east: ["♥K"] }, pool: ["♠9", "♠8", "♦7", "♥A"] });
  assert.deepEqual(engine.legalPlays(state, "north", OPTS).map((play) => play.cards), [["♠7"]]);
  const turn = engine.apply(state, "north", { action: "play_card", cards: ["♠7"] }, { ...OPTS, leftover_mode: "open_pool" });
  assert.deepEqual(turn.state.placed, { "♠7": "card", "♠8": "card", "♠9": "card", "♦7": "card" });
  assert.deepEqual(turn.state.pool, ["♥A"]);
  assert.deepEqual(turn.events.slice(1, 4).map((event) => event.text), ["公共區的 ♠8 接上了。", "公共區的 ♠9 接上了。", "公共區的 ♦7 接上了。"]);
  assert.equal(turn.state.active, "east");
});

test("paiqi jokers: every playable empty position, compulsory use, actual cards replace without penalty", () => {
  const state = fixture({ hands: { north: ["🃏1", "🃏2", "♣K"], east: ["♠8", "♦A"] } });
  const plays = engine.legalPlays(state, "north", OPTS);
  for (const joker of ["🃏1", "🃏2"]) assert.deepEqual(plays.filter((play) => play.cards[0] === joker).map((play) => play.cards[1]), ["♣7", "♦7", "♥7", "♠6", "♠8"]);
  assert.ok(plays.every((play) => play.action === "play_card"));
  for (const cards of [["🃏1"], ["🃏1", "♠9"], ["🃏1", "♠7"], ["🃏1", "bad"]]) assert.throws(() => engine.apply(state, "north", { action: "play_card", cards }, OPTS));
  const joker = engine.apply(state, "north", { action: "play_card", cards: ["🃏1", "♠8"] }, OPTS);
  assert.equal(joker.state.placed["♠8"], "joker");
  assert.equal(joker.events[0]!.text, "{name} 用鬼牌當 ♠8。");
  assert.equal(placeable(joker.state, "♠9"), true);
  const replaced = engine.apply(joker.state, "east", { action: "play_card", cards: ["♠8"] }, OPTS);
  assert.equal(replaced.state.placed["♠8"], "card");
  assert.ok(!Object.values(replaced.state.hands).flat().includes("🃏1"));
  assert.deepEqual(replaced.state.covered, { north: [], east: [] });
  const occupied = fixture({ hands: { north: ["🃏2"], east: ["♣A"] }, placed: { "♠7": "card", "♠8": "joker" } });
  assert.ok(!engine.legalPlays(occupied, "north", OPTS).some((play) => play.cards[1] === "♠8"));
  const pool = fixture({ hands: { north: ["🃏1"], east: ["♣A"] }, pool: ["♥7"] });
  const auto = engine.apply(pool, "north", { action: "play_card", cards: ["🃏1", "♥7"] }, { ...OPTS, leftover_mode: "open_pool" });
  assert.equal(auto.state.placed["♥7"], "card");
});

test("paiqi joker cover: full board leaves no position and covered joker scores zero", () => {
  const placed = Object.fromEntries(createDeck().map((card) => [card.code, "card" as const]));
  const state = fixture({ placed, hands: { north: ["🃏1"], east: [] } });
  assert.equal(engine.legalPlays(state, "north", OPTS)[0]!.action, "cover_card");
  const turn = engine.apply(state, "north", { action: "cover_card", cards: ["🃏1"] }, OPTS);
  assert.equal(turn.state.phase, "ended");
  assert.equal(turn.state.lastRoundPoints!.north, 0);
  assert.equal((engine.view(turn.state, null, OPTS) as PaiqiBoard).last_play!.card, null);
  assert.deepEqual((engine.view(turn.state, null, OPTS) as PaiqiBoard).covered_cards!.north, ["🃏1"]);
});

test("paiqi full rounds: all player counts and modes terminate, skip empty seats, reveal points and rounded scores", () => {
  for (const count of [2, 3, 4, 5, 6]) for (const leftover_mode of ["deal_after_seven", "open_pool"] as const) {
    const options: PaiqiOptions = { ...OPTS, leftover_mode };
    let state = engine.deal({ deck: createDeck(), seatIds: SEATS.slice(0, count), round: 1 }, options).state;
    let result = null;
    let turns = 0;
    while (state.phase === "play") {
      assert.ok(turns < 54);
      const action = engine.legalPlays(state, state.active!, options)[0]!;
      assert.ok(action);
      const turn = engine.apply(state, state.active!, action, options);
      state = turn.state;
      result = turn.result;
      turns += 1;
    }
    assert.equal(turns, count === 6 ? 54 : leftover_mode === "open_pool" ? Math.floor(52 / count) * count : 52);
    assert.ok(Object.values(state.hands).every((hand) => hand.length === 0));
    const expected = scorePaiqiRound(state.covered, state.order);
    assert.deepEqual(state.lastRoundPoints, expected.points);
    assert.deepEqual(result!.scoreDelta, expected.scores);
    assert.equal(result!.winnerSeatId, expected.winnerSeatId);
    assert.equal(result!.text, "本局結束，{name} 蓋牌最少。");
    assert.ok(Math.abs(Object.values(result!.scoreDelta).reduce((sum, value) => sum + value, 0)) <= 0.1 * count);
    const board = engine.view(state, null, options) as PaiqiBoard;
    assert.deepEqual(board.covered_cards, state.covered);
    assert.deepEqual(board.last_round_points, expected.points);
    assert.deepEqual(board.last_round_scores, expected.scores);
    assert.deepEqual(engine.pendingSeatIds(state), []);
    assert.deepEqual(engine.legalActions(state, state.order[0]!, options), []);
    assert.deepEqual(engine.legalPlays(state, state.order[0]!, options), []);
  }
});

test("paiqi duplicate move after turn wraps is rejected and empty seats are skipped", () => {
  const state = fixture({ hands: { north: ["♠8", "♠9"], east: [] } });
  const action = { action: "play_card", cards: ["♠8"] };
  const turn = engine.apply(state, "north", action, OPTS);
  assert.equal(turn.state.active, "north");
  assert.equal(turn.result, null);
  assert.throws(() => engine.apply(turn.state, "north", action, OPTS), /不能出/);
  assert.equal(engine.apply(turn.state, "north", { action: "play_card", cards: ["♠9"] }, OPTS).state.phase, "ended");
});

test("paiqi lifecycle: game end thresholds, abort, seat transfer including results and snapshots", () => {
  assert.equal(engine.isGameOver(OPTS, { round: 3, scores: { north: -200 } }), false);
  assert.equal(engine.isGameOver(OPTS, { round: 4, scores: {} }), true);
  const score: PaiqiOptions = { ...OPTS, end_mode: "score" };
  assert.equal(engine.isGameOver(score, { round: 99, scores: { north: 100, east: -99.9 } }), false);
  assert.equal(engine.isGameOver(score, { round: 1, scores: { east: -100 } }), true);
  assert.equal(engine.isGameOver(score, { round: 1, scores: { east: -100.1 } }), true);
  const state = fixture({ covered: { north: ["♣A"], east: [] }, lastPlay: { seatId: "north", card: "♣A", as: null, covered: true }, lastRoundPoints: { north: 1, east: 0 }, lastRoundScores: { north: -0.5, east: 0.5 } });
  assert.equal(engine.onSeatRemoved(state, "east", OPTS), "abort");
  const moved = engine.transferSeat(state, "north", "sub");
  assert.deepEqual(moved.order, ["sub", "east"]);
  assert.equal(moved.active, "sub");
  assert.deepEqual(moved.hands.sub, state.hands.north);
  assert.deepEqual(moved.covered.sub, ["♣A"]);
  assert.equal(moved.lastPlay!.seatId, "sub");
  assert.deepEqual(moved.lastRoundPoints, { sub: 1, east: 0 });
  assert.deepEqual(moved.lastRoundScores, { sub: -0.5, east: 0.5 });
  assert.equal(moved.hands.north, undefined);
  assert.deepEqual(engine.restore(JSON.parse(JSON.stringify(engine.serialize(moved)))), moved);
  const removed = engine.onSeatRemoved({ ...state, phase: "ended" }, "north", OPTS);
  assert.notEqual(removed, "abort");
  if (removed !== "abort") assert.deepEqual(removed.state.order, ["east"]);
});
