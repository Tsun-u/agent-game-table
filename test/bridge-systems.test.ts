import test from "node:test";
import assert from "node:assert/strict";
import { BIDDING_SYSTEMS, DEFAULT_BIDDING_SYSTEM, isBiddingSystemKey, suggestCall, type AuctionCall, type BiddingSystemKey } from "../src/engine/bridge-systems.js";
import { highCardPoints } from "../src/engine/lightbridge-rules.js";

const order = ["north-id", "east-id", "south-id", "west-id"] as const;
type Shape = readonly [number, number, number, number]; // ♠ ♥ ♦ ♣
const suits = ["♠", "♥", "♦", "♣"] as const;

// Construct real, distinct cards with the exact HCP and shape of each case.
function hand(points: number, shape: Shape): string[] {
  assert.equal(shape.reduce((a, b) => a + b, 0), 13);
  function choose(index: number, remaining: number): string[] | null {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = ["A", "K", "Q", "J"].filter((_, i) => mask & (1 << i));
      const count = shape[index]!;
      if (honors.length > count || count - honors.length > 9) continue;
      const cards = [...honors, ...["2", "3", "4", "5", "6", "7", "8", "9", "10"].slice(0, count - honors.length)].map((r) => `${suits[index]}${r}`);
      const hcp = highCardPoints(cards);
      if (hcp > remaining) continue;
      const rest = choose(index + 1, remaining - hcp);
      if (rest) return [...cards, ...rest];
    }
    return null;
  }
  const result = choose(0, points);
  assert.ok(result, `Cannot construct ${points} HCP ${shape}`);
  assert.equal(highCardPoints(result), points);
  assert.equal(new Set(result).size, 13);
  return result;
}
function auction(calls: readonly string[], start = 0): AuctionCall[] {
  return calls.map((call, i) => ({ seatId: order[(start + i) % 4]!, call }));
}
interface Case { name: string; p: number; shape: Shape; expected: string | null; system?: BiddingSystemKey; calls?: readonly string[]; start?: number; reason?: RegExp }
function cases(prefix: string, rows: readonly Case[], defaults: { calls?: readonly string[]; start?: number } = {}) {
  for (const row of rows) test(`${prefix}: ${row.name}`, () => {
    const cards = Object.freeze(hand(row.p, row.shape));
    const history = Object.freeze(auction(row.calls ?? defaults.calls ?? [], row.start ?? defaults.start ?? 0).map((call) => Object.freeze(call)));
    const result = suggestCall(row.system ?? "sayc", cards, history, order, order[0]);
    assert.equal(result?.call ?? null, row.expected);
    if (result) {
      assert.ok(result.reason.includes(`${row.p} 點`));
      assert.ok(result.reason.includes(result.call));
      assert.equal(result.reason.split(/[。！？\n]/).filter(Boolean).length, 1);
      if (row.reason) assert.match(result.reason, row.reason);
    }
  });
}

test("three declared systems and key guard", () => {
  assert.deepEqual(BIDDING_SYSTEMS.map((s) => s.key), ["sayc", "taiwan_5533", "taiwan_5542"]);
  assert.equal(DEFAULT_BIDDING_SYSTEM, "sayc");
  for (const system of BIDDING_SYSTEMS) {
    assert.ok(isBiddingSystemKey(system.key));
    assert.ok(system.label && system.summary);
  }
  for (const value of [null, undefined, "SAYC", "", "precision", 0, {}, ["sayc"]]) assert.equal(isBiddingSystemKey(value), false);
});

cases("opening", [
  { name: "22 strong", p: 22, shape: [4, 3, 3, 3], expected: "2♣" },
  { name: "26 balanced NT precedes strong club", p: 26, shape: [4, 3, 3, 3], expected: "3NT" },
  { name: "25 balanced", p: 25, shape: [4, 3, 3, 3], expected: "3NT" },
  { name: "27 balanced", p: 27, shape: [4, 3, 3, 3], expected: "3NT" },
  { name: "23 unbalanced strong club", p: 23, shape: [5, 4, 3, 1], expected: "2♣" },
  { name: "26 unbalanced strong club", p: 26, shape: [5, 4, 3, 1], expected: "2♣" },
  { name: "20 balanced", p: 20, shape: [3, 3, 4, 3], expected: "2NT" },
  { name: "21 balanced", p: 21, shape: [3, 3, 4, 3], expected: "2NT" },
  ...(["sayc", "taiwan_5533", "taiwan_5542"] as const).map((system): Case => ({ name: `${system} 16 balanced`, p: 16, shape: [4, 3, 3, 3], expected: "1NT", system })),
  { name: "SAYC 15", p: 15, shape: [4, 3, 3, 3], expected: "1NT" },
  { name: "5533 15", p: 15, shape: [4, 3, 3, 3], expected: "1♣", system: "taiwan_5533" },
  { name: "5533 18", p: 18, shape: [4, 3, 3, 3], expected: "1NT", system: "taiwan_5533" },
  { name: "SAYC 18", p: 18, shape: [4, 3, 3, 3], expected: "1♣" },
  { name: "five spades", p: 13, shape: [5, 3, 3, 2], expected: "1♠" },
  { name: "equal majors choose spades", p: 13, shape: [5, 5, 2, 1], expected: "1♠" },
  { name: "longer hearts", p: 13, shape: [5, 6, 1, 1], expected: "1♥" },
  { name: "SAYC diamonds four", p: 13, shape: [3, 3, 4, 3], expected: "1♦" },
  { name: "5542 diamonds four", p: 13, shape: [3, 3, 4, 3], expected: "1♦", system: "taiwan_5542" },
  { name: "SAYC three diamonds two clubs", p: 13, shape: [4, 4, 3, 2], expected: "1♦" },
  { name: "5533 three diamonds two clubs", p: 13, shape: [4, 4, 3, 2], expected: "1♦", system: "taiwan_5533" },
  { name: "SAYC two diamonds three clubs", p: 13, shape: [4, 4, 2, 3], expected: "1♣" },
  { name: "5533 two diamonds three clubs", p: 13, shape: [4, 4, 2, 3], expected: "1♣", system: "taiwan_5533" },
  { name: "three-three minors", p: 13, shape: [4, 3, 3, 3], expected: "1♣" },
  { name: "four-four minors", p: 13, shape: [3, 2, 4, 4], expected: "1♦" },
  { name: "SAYC longer clubs", p: 13, shape: [2, 2, 4, 5], expected: "1♣" },
  { name: "5542 diamonds despite longer clubs", p: 13, shape: [2, 2, 4, 5], expected: "1♦", system: "taiwan_5542" },
  { name: "5542 two clubs", p: 13, shape: [4, 4, 3, 2], expected: "1♣", system: "taiwan_5542" },
  { name: "weak hearts", p: 7, shape: [3, 6, 2, 2], expected: "2♥" },
  { name: "weak two lower bound", p: 5, shape: [3, 6, 2, 2], expected: "2♥" },
  { name: "weak two upper bound", p: 11, shape: [3, 6, 2, 2], expected: "2♥" },
  { name: "other four-card major forbids weak two", p: 7, shape: [4, 6, 2, 1], expected: "PASS" },
  { name: "no weak two clubs", p: 7, shape: [3, 2, 2, 6], expected: "PASS" },
  { name: "seven clubs preempt", p: 10, shape: [2, 2, 2, 7], expected: "3♣" },
  { name: "seven hearts not weak two", p: 7, shape: [2, 7, 2, 2], expected: "3♥" },
  { name: "nine balanced pass", p: 9, shape: [4, 3, 3, 3], expected: "PASS" },
  { name: "rule of twenty", p: 12, shape: [5, 4, 2, 2], expected: "1♠" },
  { name: "twelve balanced pass", p: 12, shape: [4, 3, 3, 3], expected: "PASS" },
  { name: "two doubletons not balanced", p: 16, shape: [5, 4, 2, 2], expected: "1♠" },
  { name: "NT precedes five-card major", p: 16, shape: [5, 3, 3, 2], expected: "1NT" },
]);

cases("major response", [
  { name: "Jacoby", p: 13, shape: [4, 3, 3, 3], expected: "2NT" },
  { name: "simple raise", p: 8, shape: [3, 3, 4, 3], expected: "2♠" },
  { name: "limit raise", p: 11, shape: [3, 3, 4, 3], expected: "3♠" },
  { name: "ten chooses limit before simple raise", p: 10, shape: [3, 3, 4, 3], expected: "3♠" },
  { name: "preemptive game", p: 7, shape: [5, 4, 3, 1], expected: "4♠" },
  { name: "four hearts insufficient for 2H", p: 7, shape: [2, 4, 4, 3], expected: "1NT" },
  { name: "five hearts", p: 11, shape: [2, 5, 4, 2], expected: "2♥" },
  { name: "diamonds", p: 11, shape: [2, 3, 4, 4], expected: "2♦" },
  { name: "longer clubs", p: 11, shape: [1, 3, 4, 5], expected: "2♣" },
  { name: "weak pass", p: 4, shape: [2, 3, 4, 4], expected: "PASS" },
  { name: "spades over hearts", p: 7, shape: [4, 2, 4, 3], expected: "1♠", calls: ["1♥", "PASS"] },
  { name: "minor response precedes balanced 3NT", p: 16, shape: [2, 3, 4, 4], expected: "2♦" },
], { calls: ["1♠", "PASS"], start: 2 });

cases("minor response", [
  { name: "four-four majors choose hearts", p: 7, shape: [4, 4, 3, 2], expected: "1♥" },
  { name: "five-five majors choose spades", p: 7, shape: [5, 5, 2, 1], expected: "1♠" },
  { name: "longer major", p: 7, shape: [4, 5, 2, 2], expected: "1♥" },
  { name: "four diamonds", p: 8, shape: [3, 3, 4, 3], expected: "1♦" },
  { name: "balanced fourteen", p: 14, shape: [3, 3, 3, 4], expected: "2NT" },
  { name: "balanced sixteen", p: 16, shape: [3, 3, 3, 4], expected: "3NT" },
  { name: "five clubs support", p: 8, shape: [3, 3, 2, 5], expected: "2♣" },
  { name: "five clubs limit", p: 11, shape: [3, 3, 2, 5], expected: "3♣" },
  { name: "four diamonds support", p: 7, shape: [3, 3, 4, 3], expected: "2♦", calls: ["1♦", "PASS"] },
  { name: "balanced eight", p: 8, shape: [3, 3, 3, 4], expected: "1NT" },
  { name: "long minor fallback", p: 12, shape: [2, 2, 3, 6], expected: "2♣", calls: ["1♦", "PASS"] },
  { name: "weak pass", p: 5, shape: [3, 3, 3, 4], expected: "PASS" },
], { calls: ["1♣", "PASS"], start: 2 });

cases("NT response", [
  { name: "weak heart transfer", p: 3, shape: [3, 5, 3, 2], expected: "2♦" },
  { name: "five-five spade transfer", p: 3, shape: [5, 5, 2, 1], expected: "2♥" },
  { name: "Stayman", p: 9, shape: [4, 3, 3, 3], expected: "2♣" },
  { name: "invitation", p: 9, shape: [3, 3, 4, 3], expected: "2NT" },
  { name: "game", p: 12, shape: [3, 3, 4, 3], expected: "3NT" },
  { name: "slam invitation", p: 16, shape: [3, 3, 4, 3], expected: "4NT" },
  { name: "weak pass", p: 6, shape: [3, 3, 4, 3], expected: "PASS" },
  { name: "transfer before Stayman and game", p: 12, shape: [4, 5, 2, 2], expected: "2♦" },
], { calls: ["1NT", "PASS"], start: 2 });

cases("strong club response", [
  { name: "waiting", p: 5, shape: [3, 3, 4, 3], expected: "2♦" },
  { name: "positive spades", p: 9, shape: [5, 3, 3, 2], expected: "2♠" },
  { name: "positive hearts", p: 8, shape: [3, 5, 3, 2], expected: "2♥" },
  { name: "positive diamonds at three", p: 8, shape: [3, 2, 5, 3], expected: "3♦" },
  { name: "positive clubs at three", p: 8, shape: [3, 2, 3, 5], expected: "3♣" },
  { name: "positive balanced", p: 8, shape: [4, 3, 3, 3], expected: "2NT" },
], { calls: ["2♣", "PASS"], start: 2 });

cases("rebid", [
  { name: "simple raise minimum", p: 14, shape: [5, 3, 3, 2], expected: "PASS" },
  { name: "simple raise medium", p: 17, shape: [5, 3, 3, 2], expected: "3♠" },
  { name: "simple raise maximum", p: 19, shape: [5, 3, 3, 2], expected: "4♠" },
  { name: "minor maximum balanced", p: 19, shape: [3, 3, 4, 3], expected: "3NT", calls: ["1♦", "PASS", "2♦", "PASS"] },
  { name: "limit accept", p: 14, shape: [5, 3, 3, 2], expected: "4♠", calls: ["1♠", "PASS", "3♠", "PASS"] },
  { name: "limit decline", p: 13, shape: [5, 3, 3, 2], expected: "PASS", calls: ["1♠", "PASS", "3♠", "PASS"] },
  { name: "minor limit accept", p: 14, shape: [3, 3, 4, 3], expected: "3NT", calls: ["1♦", "PASS", "3♦", "PASS"] },
  { name: "Jacoby game", p: 14, shape: [5, 3, 3, 2], expected: "4♠", calls: ["1♠", "PASS", "2NT", "PASS"] },
  { name: "six spades over NT", p: 14, shape: [6, 3, 2, 2], expected: "2♠", calls: ["1♠", "PASS", "1NT", "PASS"] },
  { name: "six spades medium", p: 17, shape: [6, 3, 2, 2], expected: "3♠", calls: ["1♠", "PASS", "1NT", "PASS"] },
  { name: "NT maximum", p: 19, shape: [5, 3, 3, 2], expected: "3NT", calls: ["1♠", "PASS", "1NT", "PASS"] },
  { name: "NT second suit", p: 14, shape: [5, 2, 4, 2], expected: "2♦", calls: ["1♠", "PASS", "1NT", "PASS"] },
  { name: "NT no reverse", p: 17, shape: [4, 5, 2, 2], expected: "PASS", calls: ["1♥", "PASS", "1NT", "PASS"] },
  { name: "spade support minimum", p: 14, shape: [4, 5, 2, 2], expected: "2♠", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "spade support medium", p: 17, shape: [4, 5, 2, 2], expected: "3♠", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "spade support maximum", p: 19, shape: [4, 5, 2, 2], expected: "4♠", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "balanced minimum", p: 14, shape: [2, 5, 3, 3], expected: "1NT", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "balanced maximum", p: 19, shape: [2, 5, 3, 3], expected: "2NT", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "second diamonds", p: 14, shape: [2, 5, 4, 2], expected: "2♦", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "reverse below threshold", p: 14, shape: [2, 4, 5, 2], expected: "1NT", calls: ["1♦", "PASS", "1♠", "PASS"] },
  { name: "reverse at threshold", p: 16, shape: [2, 4, 5, 2], expected: "2♥", calls: ["1♦", "PASS", "1♠", "PASS"] },
  { name: "one-level second suit not reverse", p: 13, shape: [4, 2, 5, 2], expected: "1♠", calls: ["1♦", "PASS", "1♥", "PASS"] },
  { name: "repeat after one-level new suit", p: 14, shape: [2, 6, 3, 2], expected: "2♥", calls: ["1♥", "PASS", "1♠", "PASS"] },
  { name: "two-level support minimum", p: 14, shape: [5, 2, 4, 2], expected: "3♦", calls: ["1♠", "PASS", "2♦", "PASS"] },
  { name: "two-level support medium", p: 16, shape: [5, 2, 4, 2], expected: "4♦", calls: ["1♠", "PASS", "2♦", "PASS"] },
  { name: "two-level balanced", p: 14, shape: [5, 3, 3, 2], expected: "2NT", calls: ["1♠", "PASS", "2♦", "PASS"] },
  { name: "two-level own suit", p: 14, shape: [6, 3, 2, 2], expected: "2♠", calls: ["1♠", "PASS", "2♦", "PASS"] },
  { name: "two-level own suit medium", p: 17, shape: [6, 3, 2, 2], expected: "3♠", calls: ["1♠", "PASS", "2♦", "PASS"] },
  { name: "two-level second suit lowest legal", p: 16, shape: [5, 2, 2, 4], expected: "3♣", calls: ["1♠", "PASS", "2♦", "PASS"] },
  { name: "two-level fallback", p: 16, shape: [5, 3, 3, 2], expected: "2NT", calls: ["1♠", "PASS", "2♦", "PASS"] },
], { calls: ["1♠", "PASS", "2♠", "PASS"] });

cases("overcall", [
  { name: "NT", p: 16, shape: [3, 3, 4, 3], expected: "1NT" },
  { name: "takeout", p: 13, shape: [4, 4, 1, 4], expected: "X" },
  { name: "one spade", p: 9, shape: [5, 3, 3, 2], expected: "1♠" },
  { name: "two clubs", p: 10, shape: [3, 3, 2, 5], expected: "2♣" },
  { name: "clubs insufficient points", p: 8, shape: [3, 3, 2, 5], expected: "PASS" },
  { name: "weak jump spades", p: 7, shape: [6, 3, 2, 2], expected: "2♠" },
  { name: "weak jump clubs", p: 7, shape: [3, 2, 2, 6], expected: "3♣" },
  { name: "own opening suit cannot overcall", p: 9, shape: [3, 2, 6, 2], expected: "PASS" },
], { calls: ["1♦"], start: 3 });

cases("scope and legality", [
  { name: "all passes opening", p: 13, shape: [5, 3, 3, 2], expected: "1♠", calls: ["PASS", "PASS", "PASS"], start: 1 },
  { name: "interference higher than suggestion", p: 7, shape: [4, 2, 4, 3], expected: null, calls: ["1♥", "2♦"], start: 2 },
  { name: "interference equal to suggestion", p: 7, shape: [4, 2, 4, 3], expected: null, calls: ["1♥", "1♠"], start: 2 },
  { name: "interference still legal", p: 13, shape: [4, 3, 3, 3], expected: "2NT", calls: ["1♠", "2♦"], start: 2 },
  { name: "third turn", p: 14, shape: [5, 3, 3, 2], expected: "PASS", calls: ["1♠", "PASS", "2♠", "PASS", "3♠", "PASS", "4♠", "PASS"] },
  { name: "weak two response", p: 14, shape: [5, 3, 3, 2], expected: "4♥", calls: ["2♥", "PASS"], start: 2 },
  { name: "opponent NT", p: 16, shape: [3, 3, 4, 3], expected: "X", calls: ["1NT"], start: 3 },
  { name: "opponent strong club", p: 16, shape: [3, 3, 4, 3], expected: "PASS", calls: ["2♣"], start: 3 },
  { name: "partner second utterance after opening doubled", p: 13, shape: [4, 4, 1, 4], expected: "PASS", calls: ["1♦", "X", "PASS", "PASS", "2♦", "PASS"], start: 2 },
  { name: "opener rebid after double", p: 13, shape: [4, 4, 1, 4], expected: "PASS", calls: ["1♦", "X", "1♥", "PASS"] },
  { name: "redoubled", p: 13, shape: [4, 4, 1, 4], expected: "PASS", calls: ["1♦", "X", "XX"], start: 1 },
  { name: "response to partner overcall", p: 13, shape: [4, 4, 1, 4], expected: "2♦", calls: ["1♦", "1♥", "PASS"], start: 1 },
  { name: "competitive opener rebid", p: 14, shape: [5, 3, 3, 2], expected: "PASS", calls: ["1♠", "2♣", "2♠", "PASS"] },
  { name: "passed responder outside first utterance", p: 14, shape: [5, 3, 3, 2], expected: "4♥", calls: ["PASS", "PASS", "1♥", "PASS"] },
  { name: "partner passed before overcall allowed", p: 13, shape: [4, 4, 1, 4], expected: "X", calls: ["1♦", "PASS", "PASS"], start: 1 },
  { name: "NT opener rebid general fallback", p: 16, shape: [4, 3, 3, 3], expected: "2♠", calls: ["1NT", "PASS", "2♣", "PASS"] },
  { name: "jump new suit reply general fallback", p: 14, shape: [5, 3, 3, 2], expected: "PASS", calls: ["1♠", "PASS", "3♣", "PASS"] },
  { name: "illegal rebid filtered without substituting", p: 14, shape: [2, 6, 3, 2], expected: null, calls: ["1♥", "PASS", "2♠", "PASS"] },
]);

cases("weak two response", [
  { name: "fifteen three hearts game", p: 15, shape: [4, 3, 3, 3], expected: "4♥" },
  { name: "eight three hearts preempt", p: 8, shape: [4, 3, 3, 3], expected: "3♥" },
  { name: "sixteen two hearts feature ask", p: 16, shape: [4, 2, 4, 3], expected: "2NT" },
  { name: "fourteen five spades RONF", p: 14, shape: [5, 2, 3, 3], expected: "2♠" },
  { name: "ten without support pass", p: 10, shape: [4, 2, 4, 3], expected: "PASS" },
  { name: "diamonds game at five", p: 15, shape: [4, 3, 3, 3], expected: "5♦", calls: ["2♦", "PASS"] },
  { name: "spades game at four", p: 14, shape: [3, 4, 3, 3], expected: "4♠", calls: ["2♠", "PASS"] },
  { name: "zero support still preempts", p: 0, shape: [4, 3, 3, 3], expected: "3♥" },
  { name: "thirteen support preempts", p: 13, shape: [4, 3, 3, 3], expected: "3♥" },
  { name: "fourteen support precedes new suit", p: 14, shape: [5, 3, 3, 2], expected: "4♥" },
  { name: "fifteen feature ask precedes new suit", p: 15, shape: [5, 2, 3, 3], expected: "2NT" },
  { name: "fourteen without long suit pass", p: 14, shape: [4, 2, 4, 3], expected: "PASS" },
  { name: "RONF clubs lowest is three", p: 14, shape: [3, 2, 3, 5], expected: "3♣" },
  { name: "RONF equal minors choose diamonds", p: 14, shape: [1, 2, 5, 5], expected: "3♦" },
  { name: "right opponent overcall general fallback", p: 15, shape: [4, 3, 3, 3], expected: "3♥", calls: ["2♥", "2♠"] },
  { name: "right opponent double general fallback", p: 15, shape: [4, 3, 3, 3], expected: "PASS", calls: ["2♥", "X"] },
  { name: "missing right pass general fallback", p: 15, shape: [4, 3, 3, 3], expected: "PASS", calls: ["2♥"] },
  { name: "passed hand not first utterance", p: 15, shape: [4, 3, 3, 3], expected: "PASS", calls: ["PASS", "PASS", "2♥", "PASS"], start: 0 },
], { calls: ["2♥", "PASS"], start: 2 });

cases("doubled opening response", [
  { name: "eleven three spades limit or better", p: 11, shape: [3, 3, 4, 3], expected: "2NT" },
  { name: "seven four spades preempt", p: 7, shape: [4, 3, 3, 3], expected: "3♠" },
  { name: "eight three spades raise", p: 8, shape: [3, 3, 4, 3], expected: "2♠" },
  { name: "seven four spades over hearts", p: 7, shape: [4, 2, 4, 3], expected: "1♠", calls: ["1♥", "X"] },
  { name: "eleven no fit redouble", p: 11, shape: [2, 3, 4, 4], expected: "XX" },
  { name: "seven balanced no fit NT", p: 7, shape: [2, 3, 4, 4], expected: "1NT" },
  { name: "four pass", p: 4, shape: [2, 3, 4, 4], expected: "PASS" },
  { name: "ten support precedes redouble", p: 10, shape: [3, 3, 4, 3], expected: "2NT" },
  { name: "zero four support preempts", p: 0, shape: [4, 3, 3, 3], expected: "3♠" },
  { name: "five three support passes", p: 5, shape: [3, 3, 4, 3], expected: "PASS" },
  { name: "six three support raises", p: 6, shape: [3, 3, 4, 3], expected: "2♠" },
  { name: "ten no fit redoubles", p: 10, shape: [2, 3, 4, 4], expected: "XX" },
  { name: "one-level major precedes redouble", p: 11, shape: [4, 2, 4, 3], expected: "1♠", calls: ["1♥", "X"] },
  { name: "four-four majors go up hearts first", p: 7, shape: [4, 4, 3, 2], expected: "1♥", calls: ["1♣", "X"] },
  { name: "three clubs support is sufficient", p: 10, shape: [4, 4, 2, 3], expected: "2NT", calls: ["1♣", "X"] },
  { name: "NT opening double general fallback", p: 11, shape: [2, 3, 4, 4], expected: "3NT", calls: ["1NT", "X"] },
  { name: "two-level opening double general fallback", p: 11, shape: [2, 3, 4, 4], expected: "3NT", calls: ["2♣", "X"] },
  { name: "auction must be exactly opening double", p: 11, shape: [2, 3, 4, 4], expected: "PASS", calls: ["PASS", "1♠", "X"], start: 1 },
], { calls: ["1♠", "X"], start: 2 });

cases("takeout double response", [
  { name: "thirteen cue bid", p: 13, shape: [4, 3, 2, 4], expected: "2♦" },
  { name: "eleven balanced two diamonds", p: 11, shape: [4, 3, 2, 4], expected: "2NT" },
  { name: "seven balanced", p: 7, shape: [4, 3, 2, 4], expected: "1NT" },
  { name: "ten five spades short diamonds jump", p: 10, shape: [5, 3, 1, 4], expected: "2♠" },
  { name: "three four hearts", p: 3, shape: [3, 4, 3, 3], expected: "1♥" },
  { name: "zero longest clubs", p: 0, shape: [3, 3, 2, 5], expected: "2♣" },
  { name: "twelve balanced cue precedes NT", p: 12, shape: [4, 3, 2, 4], expected: "2♦" },
  { name: "ten balanced NT precedes jump", p: 10, shape: [4, 3, 2, 4], expected: "1NT" },
  { name: "nine unbalanced jump", p: 9, shape: [5, 3, 1, 4], expected: "2♠" },
  { name: "eight unbalanced minimum", p: 8, shape: [5, 3, 1, 4], expected: "1♠" },
  { name: "equal major and minor chooses major", p: 9, shape: [3, 4, 2, 4], expected: "1NT" },
  { name: "equal major and minor unbalanced jump", p: 9, shape: [2, 5, 1, 5], expected: "2♥" },
  { name: "equal majors choose spades", p: 3, shape: [4, 4, 2, 3], expected: "1♠" },
  { name: "longer clubs before shorter major", p: 9, shape: [4, 3, 1, 5], expected: "3♣" },
  { name: "opening suit excluded even when longest", p: 0, shape: [3, 2, 6, 2], expected: "1♠" },
  { name: "right opponent redouble general fallback", p: 13, shape: [4, 3, 2, 4], expected: "3NT", calls: ["1♦", "X", "XX"] },
  { name: "right opponent raises general fallback", p: 13, shape: [4, 3, 2, 4], expected: "3NT", calls: ["1♦", "X", "2♦"] },
  { name: "NT opponent opening general fallback", p: 13, shape: [4, 3, 2, 4], expected: "PASS", calls: ["1NT", "X", "PASS"] },
  { name: "two-level opponent opening general fallback", p: 13, shape: [4, 3, 2, 4], expected: "PASS", calls: ["2♦", "X", "PASS"] },
], { calls: ["1♦", "X", "PASS"], start: 1 });

test("new responses are identical across systems and seat rotations, with immutable inputs", () => {
  const samples = [
    { p: 15, shape: [4, 3, 3, 3] as const, calls: ["2♥", "PASS"], offset: 2, expected: "4♥" },
    { p: 11, shape: [2, 3, 4, 4] as const, calls: ["1♠", "X"], offset: 2, expected: "XX" },
    { p: 0, shape: [3, 3, 2, 5] as const, calls: ["1♦", "X", "PASS"], offset: 1, expected: "2♣" },
  ];
  for (const sample of samples) for (const { key } of BIDDING_SYSTEMS) for (let viewer = 0; viewer < 4; viewer++) {
    const cards = Object.freeze(hand(sample.p, sample.shape));
    const history = Object.freeze(auction(sample.calls, (viewer + sample.offset) % 4).map((call) => Object.freeze(call)));
    const before = JSON.stringify({ cards, history });
    const result = suggestCall(key, cards, history, order, order[viewer]!);
    assert.equal(result?.call, sample.expected);
    assert.deepEqual(suggestCall(key, cards, history, order, order[viewer]!), result);
    assert.equal(JSON.stringify({ cards, history }), before);
  }
});

test("opposite seats use supplied IDs for every rotation and inputs stay unchanged", () => {
  const cards = Object.freeze(hand(13, [4, 3, 3, 3]));
  for (let viewer = 0; viewer < 4; viewer++) {
    const history = Object.freeze(auction(["1♠", "PASS"], (viewer + 2) % 4).map((call) => Object.freeze(call)));
    const before = JSON.stringify({ cards, history, order });
    const first = suggestCall("sayc", cards, history, order, order[viewer]!);
    assert.equal(first?.call, "2NT");
    assert.match(first!.reason, /四張黑桃/);
    assert.deepEqual(suggestCall("sayc", cards, history, order, order[viewer]!), first);
    assert.equal(JSON.stringify({ cards, history, order }), before);
  }
});

cases("high NT and three-level preempt responses", [
  { name: "2NT spade transfer", p: 2, shape: [5, 3, 3, 2], expected: "3♥" },
  { name: "2NT heart Stayman", p: 5, shape: [3, 4, 3, 3], expected: "3♣" },
  { name: "2NT six balanced game", p: 6, shape: [3, 3, 4, 3], expected: "3NT" },
  { name: "2NT two pass", p: 2, shape: [3, 3, 4, 3], expected: "PASS" },
  { name: "2NT Stayman threshold", p: 4, shape: [4, 3, 3, 3], expected: "3♣" },
  { name: "2NT transfer before Stayman", p: 5, shape: [4, 5, 2, 2], expected: "3♦" },
  { name: "3NT heart transfer", p: 0, shape: [3, 5, 3, 2], expected: "4♦", calls: ["3NT", "PASS"] },
  { name: "3NT spade transfer", p: 0, shape: [5, 3, 3, 2], expected: "4♥", calls: ["3NT", "PASS"] },
  { name: "3NT Stayman no point floor", p: 0, shape: [4, 3, 3, 3], expected: "4♣", calls: ["3NT", "PASS"] },
  { name: "3NT no major pass", p: 10, shape: [3, 3, 4, 3], expected: "PASS", calls: ["3NT", "PASS"] },
  { name: "3S sixteen two support", p: 16, shape: [2, 4, 4, 3], expected: "4♠", calls: ["3♠", "PASS"] },
  { name: "3S ten pass", p: 10, shape: [2, 4, 4, 3], expected: "PASS", calls: ["3♠", "PASS"] },
  { name: "3C fifteen two support", p: 15, shape: [4, 4, 3, 2], expected: "5♣", calls: ["3♣", "PASS"] },
  { name: "3D fifteen two support", p: 15, shape: [4, 4, 2, 3], expected: "5♦", calls: ["3♦", "PASS"] },
], { calls: ["2NT", "PASS"], start: 2 });

cases("partner overcall responses", [
  { name: "eleven support cue", p: 11, shape: [3, 3, 4, 3], expected: "2♦" },
  { name: "seven support raise", p: 7, shape: [3, 3, 4, 3], expected: "2♠" },
  // With two diamonds, a balanced hand must have 3+ spades: support takes priority over NT.
  { name: "ten balanced two diamonds prioritizes support", p: 10, shape: [4, 3, 2, 4], expected: "2♦" },
  { name: "ten balanced no spade fit NT", p: 10, shape: [2, 3, 4, 4], expected: "1NT" },
  { name: "nine five hearts", p: 9, shape: [2, 5, 4, 2], expected: "2♥" },
  { name: "five pass", p: 5, shape: [3, 3, 4, 3], expected: "PASS" },
  { name: "NT overcall uses Stayman", p: 9, shape: [4, 3, 3, 3], expected: "2♣", calls: ["1♥", "1NT", "PASS"] },
  { name: "NT overcall uses transfer", p: 3, shape: [3, 5, 3, 2], expected: "2♦", calls: ["1♠", "1NT", "PASS"] },
  { name: "two-level raise", p: 7, shape: [3, 3, 4, 3], expected: "3♣", calls: ["1♠", "2♣", "PASS"] },
  { name: "two-level NT", p: 10, shape: [3, 4, 4, 2], expected: "2NT", calls: ["1♠", "2♣", "PASS"] },
  { name: "cue already overtaken is filtered", p: 11, shape: [3, 3, 4, 3], expected: null, calls: ["1♦", "2♠", "PASS"] },
], { calls: ["1♦", "1♠", "PASS"], start: 1 });

cases("opponent 1NT overcall", [
  { name: "seventeen penalty", p: 17, shape: [4, 3, 3, 3], expected: "X" },
  { name: "nine six hearts", p: 9, shape: [3, 6, 2, 2], expected: "2♥" },
  { name: "eleven five-five", p: 11, shape: [5, 5, 2, 1], expected: "2♠" },
  { name: "ten balanced pass", p: 10, shape: [4, 3, 3, 3], expected: "PASS" },
  { name: "sixteen penalty before long suit", p: 16, shape: [3, 6, 2, 2], expected: "X" },
  { name: "eight six clubs", p: 8, shape: [3, 2, 2, 6], expected: "2♣" },
  { name: "nine five-five below floor", p: 9, shape: [5, 5, 2, 1], expected: "PASS" },
], { calls: ["1NT"], start: 3 });

cases("NT opener continuation", [
  { name: "Stayman hearts first", p: 16, shape: [4, 4, 3, 2], expected: "2♥" },
  { name: "Stayman only spades", p: 16, shape: [4, 3, 3, 3], expected: "2♠" },
  { name: "Stayman no major", p: 16, shape: [3, 3, 4, 3], expected: "2♦" },
  { name: "heart transfer superaccept", p: 17, shape: [3, 4, 3, 3], expected: "3♥", calls: ["1NT", "PASS", "2♦", "PASS"] },
  { name: "heart transfer minimum", p: 16, shape: [3, 4, 3, 3], expected: "2♥", calls: ["1NT", "PASS", "2♦", "PASS"] },
  { name: "spade transfer superaccept", p: 17, shape: [4, 3, 3, 3], expected: "3♠", calls: ["1NT", "PASS", "2♥", "PASS"] },
  { name: "17 invitation accept", p: 17, shape: [4, 3, 3, 3], expected: "3NT", calls: ["1NT", "PASS", "2NT", "PASS"] },
  { name: "15 invitation decline", p: 15, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1NT", "PASS", "2NT", "PASS"] },
  { name: "5533 18 accept", p: 18, shape: [4, 3, 3, 3], expected: "3NT", system: "taiwan_5533", calls: ["1NT", "PASS", "2NT", "PASS"] },
  { name: "5533 17 decline", p: 17, shape: [4, 3, 3, 3], expected: "PASS", system: "taiwan_5533", calls: ["1NT", "PASS", "2NT", "PASS"] },
  { name: "5533 18 superaccept", p: 18, shape: [3, 4, 3, 3], expected: "3♥", system: "taiwan_5533", calls: ["1NT", "PASS", "2♦", "PASS"] },
  { name: "club invitation accept", p: 17, shape: [4, 3, 3, 3], expected: "3NT", calls: ["1NT", "PASS", "3♣", "PASS"] },
  { name: "diamond invitation decline", p: 16, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1NT", "PASS", "3♦", "PASS"] },
  { name: "slam accept", p: 17, shape: [4, 3, 3, 3], expected: "6NT", calls: ["1NT", "PASS", "4NT", "PASS"] },
  { name: "slam decline", p: 16, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1NT", "PASS", "4NT", "PASS"] },
  { name: "left double still uses fixed transfer with right pass", p: 16, shape: [3, 4, 3, 3], expected: "2♥", calls: ["1NT", "X", "2♦", "PASS"] },
  ...["3NT", "4♥", "4♠"].map((call): Case => ({ name: `game ${call} pass`, p: 17, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1NT", "PASS", call, "PASS"] })),
], { calls: ["1NT", "PASS", "2♣", "PASS"] });

cases("strong club opener continuation", [
  { name: "23 balanced waiting", p: 23, shape: [4, 3, 3, 3], expected: "2NT" },
  { name: "26 balanced waiting", p: 26, shape: [4, 3, 3, 3], expected: "3NT" },
  { name: "23 six spades", p: 23, shape: [6, 3, 2, 2], expected: "2♠" },
  { name: "three hearts support", p: 23, shape: [4, 3, 3, 3], expected: "3♥", calls: ["2♣", "PASS", "2♥", "PASS"] },
  { name: "no support balanced lowest NT", p: 23, shape: [4, 2, 4, 3], expected: "2NT", calls: ["2♣", "PASS", "2♥", "PASS"] },
  { name: "no support unbalanced own suit", p: 23, shape: [6, 2, 3, 2], expected: "2♠", calls: ["2♣", "PASS", "2♥", "PASS"] },
], { calls: ["2♣", "PASS", "2♦", "PASS"] });

cases("weak opener continuation", [
  { name: "seven minimum", p: 7, shape: [3, 6, 2, 2], expected: "3♥" },
  { name: "eight minimum", p: 8, shape: [3, 6, 2, 2], expected: "3♥" },
  { name: "partner raise pass", p: 10, shape: [3, 6, 2, 2], expected: "PASS", calls: ["2♥", "PASS", "3♥", "PASS"] },
  { name: "partner game pass", p: 10, shape: [3, 6, 2, 2], expected: "PASS", calls: ["2♥", "PASS", "4♥", "PASS"] },
  { name: "partner new suit supported", p: 10, shape: [3, 6, 2, 2], expected: "3♠", calls: ["2♥", "PASS", "2♠", "PASS"] },
  { name: "partner new suit general fallback", p: 10, shape: [2, 6, 3, 2], expected: "3♥", calls: ["2♥", "PASS", "2♠", "PASS"] },
], { calls: ["2♥", "PASS", "2NT", "PASS"] });

test("weak opener feature uses actual A or K outside the opening suit", () => {
  const samples = [
    { cards: ["♠A", "♠2", "♠3", "♥K", "♥Q", "♥J", "♥2", "♥3", "♥4", "♦2", "♦3", "♣2", "♣3"], expected: "3♠" },
    { cards: ["♠2", "♠3", "♠4", "♥A", "♥K", "♥Q", "♥J", "♥2", "♥3", "♦2", "♦3", "♣2", "♣3"], expected: "3NT" },
    { cards: ["♠K", "♠2", "♠3", "♥A", "♥Q", "♥J", "♥2", "♥3", "♥4", "♦2", "♦3", "♣2", "♣3"], expected: "3♠" },
  ];
  for (const { cards, expected } of samples) {
    assert.equal(highCardPoints(cards), 10);
    assert.equal(new Set(cards).size, 13);
    assert.equal(suggestCall("sayc", cards, auction(["2♥", "PASS", "2NT", "PASS"]), order, order[0])?.call, expected);
  }
});

cases("responder second call", [
  { name: "opener simple raise eleven game", p: 11, shape: [4, 3, 3, 3], expected: "4♠" },
  { name: "opener simple raise eight invite", p: 8, shape: [4, 3, 3, 3], expected: "3♠" },
  { name: "opener simple raise six pass", p: 6, shape: [4, 3, 3, 3], expected: "PASS" },
  { name: "NT twelve five spades", p: 12, shape: [5, 3, 3, 2], expected: "4♠", calls: ["1♥", "PASS", "1♠", "PASS", "1NT", "PASS"] },
  { name: "NT ten five spades", p: 10, shape: [5, 3, 3, 2], expected: "3♠", calls: ["1♥", "PASS", "1♠", "PASS", "1NT", "PASS"] },
  { name: "NT eleven balanced", p: 11, shape: [4, 3, 3, 3], expected: "2NT", calls: ["1♥", "PASS", "1♠", "PASS", "1NT", "PASS"] },
  { name: "NT thirteen balanced", p: 13, shape: [4, 3, 3, 3], expected: "3NT", calls: ["1♥", "PASS", "1♠", "PASS", "1NT", "PASS"] },
  { name: "NT seven six spades", p: 7, shape: [6, 3, 2, 2], expected: "2♠", calls: ["1♥", "PASS", "1♠", "PASS", "1NT", "PASS"] },
  { name: "NT seven four spades", p: 7, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1♥", "PASS", "1♠", "PASS", "1NT", "PASS"] },
  { name: "opener repeat eleven two support", p: 11, shape: [2, 4, 4, 3], expected: "4♠", calls: ["1♠", "PASS", "1NT", "PASS", "2♠", "PASS"] },
  { name: "opener repeat nine invite", p: 9, shape: [2, 4, 4, 3], expected: "3♠", calls: ["1♠", "PASS", "1NT", "PASS", "2♠", "PASS"] },
  { name: "opener jump eight game", p: 8, shape: [4, 3, 3, 3], expected: "4♠", calls: ["1♥", "PASS", "1♠", "PASS", "3♠", "PASS"] },
  { name: "opener jump five pass", p: 5, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1♥", "PASS", "1♠", "PASS", "3♠", "PASS"] },
  { name: "minor simple raise balanced game", p: 11, shape: [3, 3, 4, 3], expected: "3NT", calls: ["1♣", "PASS", "1♦", "PASS", "2♦", "PASS"] },
], { calls: ["1♥", "PASS", "1♠", "PASS", "2♠", "PASS"], start: 2 });

cases("general round", [
  { name: "six spades plus raise competes", p: 14, shape: [6, 3, 2, 2], expected: "3♠", reason: /合計約 9 張/ },
  { name: "five spades plus raise insufficient", p: 14, shape: [5, 3, 3, 2], expected: "PASS" },
  { name: "responder three plus five insufficient", p: 8, shape: [3, 3, 4, 3], expected: "PASS", calls: ["1♠", "PASS", "2♠", "PASS", "PASS", "3♥"], start: 2 },
  { name: "invitation precedes competition despite opponent highest", p: 17, shape: [3, 5, 3, 2], expected: "3♥", reason: /合計約 23 點.*邀請成局/, calls: ["1♥", "1♠", "2♥", "2♠"] },
  { name: "limit raise estimates ten game", p: 15, shape: [3, 5, 3, 2], expected: "4♥", reason: /合計約 25 點/, calls: ["1♥", "1♠", "3♥", "3♠"] },
  { name: "already game despite opponent overbid", p: 18, shape: [5, 3, 3, 2], expected: "PASS", calls: ["1♠", "PASS", "4♠", "5♣"] },
  { name: "no fit twenty-six balanced game", p: 14, shape: [2, 3, 4, 4], expected: "3NT", reason: /合計約 26 點/, calls: ["1♠", "2♥", "2NT", "3♥"], start: 2 },
  { name: "no fit opponent shortness forbids NT", p: 14, shape: [2, 1, 5, 5], expected: "PASS", calls: ["1♠", "2♥", "2NT", "3♥"], start: 2 },
  { name: "our highest invitation once", p: 17, shape: [3, 5, 3, 2], expected: "3♥", calls: ["1♥", "1♠", "2♥", "PASS"] },
  { name: "already invited no repeat", p: 17, shape: [3, 5, 3, 2], expected: "PASS", calls: ["1♥", "1♠", "2♥", "PASS", "3♥", "PASS", "PASS", "PASS"] },
  { name: "low minor fit twenty-eight game", p: 18, shape: [2, 2, 4, 5], expected: "5♣", reason: /合計約 28 點/, calls: ["1♣", "1♠", "3♣", "3♠"] },
  { name: "low minor fit twenty-five balanced NT", p: 15, shape: [3, 3, 3, 4], expected: "3NT", calls: ["1♣", "1♠", "3♣", "3♠"] },
  { name: "game bid already overtaken passes", p: 18, shape: [3, 5, 3, 2], expected: "PASS", calls: ["1♥", "1♠", "3♥", "4♠"] },
  { name: "minor game overtaken goes to legality filter", p: 18, shape: [2, 2, 4, 5], expected: null, calls: ["1♣", "1♠", "3♣", "5♠"] },
  { name: "NT game overtaken goes to legality filter", p: 14, shape: [2, 3, 4, 4], expected: null, calls: ["1♠", "2♥", "2NT", "4♥"], start: 2 },
  { name: "no fit long suit competes at three", p: 12, shape: [6, 2, 2, 3], expected: "3♠", calls: ["1♦", "1♥", "2♦", "2♠", "3♦", "PASS", "PASS"], start: 1 },
  { name: "no fit long suit cannot compete at four", p: 12, shape: [6, 2, 2, 3], expected: "PASS", calls: ["1♦", "1♥", "2♦", "2♠", "4♦", "PASS", "PASS"], start: 1 },
  { name: "weak two promise six competes", p: 14, shape: [3, 3, 3, 4], expected: "3♥", reason: /合計約 9 張/, calls: ["2♥", "2♠"], start: 2 },
  { name: "transfer promises hearts rather than artificial diamonds", p: 16, shape: [3, 3, 4, 3], expected: "PASS", reason: /合計約 16 點/, calls: ["1NT", "PASS", "2♦", "2♠"] },
  { name: "transfer fit competes with five plus four", p: 16, shape: [3, 4, 3, 3], expected: "3♥", reason: /合計約 9 張/, calls: ["1NT", "PASS", "2♦", "2♠"] },
  { name: "minor opening five-card support fit", p: 13, shape: [2, 3, 3, 5], expected: "3NT", calls: ["PASS", "1♣", "X"], start: 1 },
  { name: "seven NT highest safe pass", p: 13, shape: [4, 3, 3, 3], expected: "PASS", calls: ["1♠", "PASS", "2♠", "7NT"] },
], { calls: ["1♠", "2♥", "2♠", "3♥"] });

cases("partner point floors through general hints", [
  { name: "one-level opening twelve", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 13 點/, calls: ["PASS", "1♠", "X"], start: 1 },
  { name: "NT opening fifteen", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 16 點/, calls: ["1NT", "X"], start: 2 },
  { name: "5533 NT opening sixteen", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 17 點/, calls: ["1NT", "X"], start: 2, system: "taiwan_5533" },
  { name: "strong club twenty-two", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 23 點/, calls: ["2♣", "X"], start: 2 },
  { name: "two NT twenty", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 21 點/, calls: ["2NT", "X"], start: 2 },
  { name: "three NT twenty-five", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 26 點/, calls: ["3NT", "X"], start: 2 },
  { name: "three-level preempt five", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 6 點/, calls: ["3♠", "X"], start: 2 },
  { name: "one-level overcall eight", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 9 點/, calls: ["1♦", "1♠", "2♦"], start: 1 },
  { name: "two-level overcall ten", p: 1, shape: [4, 3, 4, 2], expected: "PASS", reason: /合計約 11 點/, calls: ["1♠", "2♣", "2♠"], start: 1 },
  { name: "NT overcall fifteen even in 5533", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 16 點/, calls: ["1♦", "1NT", "2♦"], start: 1, system: "taiwan_5533" },
  { name: "takeout double twelve", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 13 點/, calls: ["1♦", "X", "2♦"], start: 1 },
  { name: "simple raise six", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 7 點/, calls: ["1♠", "2♥", "2♠", "3♥"] },
  { name: "Jacoby thirteen", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 14 點/, calls: ["1♠", "PASS", "2NT", "3♥"] },
  { name: "one-level new suit six", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 7 點/, calls: ["1♣", "PASS", "1♠", "2♥"] },
  { name: "two-level new suit ten", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 11 點/, calls: ["1♠", "PASS", "2♣", "2♥"] },
  { name: "NT invitation eight", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 9 點/, calls: ["1NT", "PASS", "2NT", "3♥"] },
  { name: "NT game response ten", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 11 點/, calls: ["1NT", "PASS", "3NT", "4♥"] },
  { name: "cue bid ten", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 11 點/, calls: ["1♠", "2♥", "3♥", "4♦"] },
  { name: "opener jump sixteen retained after pass", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 17 點/, calls: ["1♥", "PASS", "1♠", "PASS", "3♠", "4♦", "PASS", "PASS", "PASS", "4♥"], start: 2 },
  { name: "responder jump ten", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 11 點/, calls: ["1♥", "PASS", "2♠", "3♦"] },
  { name: "raise of partner overcall six", p: 1, shape: [2, 3, 4, 4], expected: "PASS", reason: /合計約 7 點/, calls: ["1♦", "1♠", "PASS", "2♠", "3♥"], start: 3 },
  { name: "waiting is not natural new suit", p: 23, shape: [4, 3, 3, 3], expected: "PASS", reason: /合計約 23 點/, calls: ["2♣", "PASS", "2♦", "2♠"] },
]);

// Vulnerability: preempts need two of the top three honors, two-level overcalls need 11.
const vulnerabilityCases: { name: string; cards: string[]; calls?: readonly string[]; vulnerable: boolean; expected: string; reason: RegExp }[] = [
  { name: "weak two non-vulnerable with a poor suit", cards: ["♠J", "♠9", "♠8", "♠7", "♠6", "♠5", "♥A", "♥K", "♥4", "♦Q", "♦4", "♦2", "♣3"], vulnerable: false, expected: "2♠", reason: /無身價/ },
  { name: "weak two vulnerable with a good suit", cards: ["♠K", "♠Q", "♠8", "♠7", "♠6", "♠5", "♥J", "♥4", "♥3", "♦J", "♦4", "♦2", "♣3"], vulnerable: true, expected: "2♠", reason: /有身價/ },
  { name: "weak two vulnerable with a poor suit passes", cards: ["♠J", "♠9", "♠8", "♠7", "♠6", "♠5", "♥A", "♥K", "♥4", "♦Q", "♦4", "♦2", "♣3"], vulnerable: true, expected: "PASS", reason: /有身價但沒有兩張大牌/ },
  { name: "preempt vulnerable with a good suit", cards: ["♠A", "♠Q", "♠9", "♠8", "♠7", "♠6", "♠5", "♥4", "♥3", "♥2", "♦4", "♦3", "♣2"], vulnerable: true, expected: "3♠", reason: /有身價.*阻擊/ },
  { name: "preempt vulnerable with a poor suit passes", cards: ["♠J", "♠9", "♠8", "♠7", "♠6", "♠5", "♠4", "♥4", "♥3", "♥2", "♦4", "♦3", "♣2"], vulnerable: true, expected: "PASS", reason: /不阻擊/ },
  { name: "weak jump overcall vulnerable with a good suit", cards: ["♠A", "♠K", "♠9", "♠8", "♠7", "♠6", "♥5", "♥4", "♥3", "♦4", "♦2", "♣3", "♣2"], calls: ["1♦"], vulnerable: true, expected: "2♠", reason: /有身價.*弱跳蓋叫/ },
  { name: "weak jump overcall vulnerable with a poor suit passes", cards: ["♠J", "♠9", "♠8", "♠7", "♠6", "♠5", "♥K", "♥4", "♥3", "♦4", "♦2", "♣Q", "♣3"], calls: ["1♦"], vulnerable: true, expected: "PASS", reason: /未符合爭叫條件/ },
  { name: "two-level overcall non-vulnerable with 10", cards: ["♠3", "♠2", "♥4", "♥3", "♥2", "♦J", "♦4", "♦3", "♣A", "♣K", "♣Q", "♣5", "♣4"], calls: ["1♠"], vulnerable: false, expected: "2♣", reason: /自然爭叫/ },
  { name: "two-level overcall vulnerable with 10 passes", cards: ["♠3", "♠2", "♥4", "♥3", "♥2", "♦J", "♦4", "♦3", "♣A", "♣K", "♣Q", "♣5", "♣4"], calls: ["1♠"], vulnerable: true, expected: "PASS", reason: /有身價二線爭叫要 11 點/ },
  { name: "two-level overcall vulnerable with 11", cards: ["♠3", "♠2", "♥4", "♥3", "♥2", "♦Q", "♦4", "♦3", "♣A", "♣K", "♣Q", "♣5", "♣4"], calls: ["1♠"], vulnerable: true, expected: "2♣", reason: /自然爭叫/ },
];
for (const row of vulnerabilityCases) test(`vulnerability: ${row.name}`, () => {
  const history = auction(row.calls ?? [], 3);
  const result = suggestCall("sayc", row.cards, history, order, order[0], row.vulnerable);
  assert.equal(result?.call, row.expected);
  assert.match(result!.reason, row.reason);
  assert.equal(result!.reason.split(/[。！？\n]/).filter(Boolean).length, 1);
});

test("vulnerability defaults to non-vulnerable", () => {
  const cards = hand(7, [6, 3, 2, 2]);
  assert.deepEqual(suggestCall("sayc", cards, [], order, order[0]), suggestCall("sayc", cards, [], order, order[0], false));
});
