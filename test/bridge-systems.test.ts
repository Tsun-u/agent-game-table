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
interface Case { name: string; p: number; shape: Shape; expected: string | null; system?: BiddingSystemKey; calls?: readonly string[]; start?: number }
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
  { name: "third turn", p: 14, shape: [5, 3, 3, 2], expected: null, calls: ["1♠", "PASS", "2♠", "PASS", "3♠", "PASS", "4♠", "PASS"] },
  { name: "weak two response", p: 14, shape: [5, 3, 3, 2], expected: "4♥", calls: ["2♥", "PASS"], start: 2 },
  { name: "opponent NT", p: 16, shape: [3, 3, 4, 3], expected: null, calls: ["1NT"], start: 3 },
  { name: "opponent strong club", p: 16, shape: [3, 3, 4, 3], expected: null, calls: ["2♣"], start: 3 },
  { name: "partner second utterance after opening doubled", p: 13, shape: [4, 4, 1, 4], expected: null, calls: ["1♦", "X", "PASS", "PASS", "2♦", "PASS"], start: 2 },
  { name: "opener rebid after double", p: 13, shape: [4, 4, 1, 4], expected: null, calls: ["1♦", "X", "1♥", "PASS"] },
  { name: "redoubled", p: 13, shape: [4, 4, 1, 4], expected: null, calls: ["1♦", "X", "XX"], start: 1 },
  { name: "response to partner overcall", p: 13, shape: [4, 4, 1, 4], expected: null, calls: ["1♦", "1♥", "PASS"], start: 1 },
  { name: "competitive opener rebid", p: 14, shape: [5, 3, 3, 2], expected: null, calls: ["1♠", "2♣", "2♠", "PASS"] },
  { name: "passed responder outside first utterance", p: 14, shape: [5, 3, 3, 2], expected: null, calls: ["PASS", "PASS", "1♥", "PASS"] },
  { name: "partner passed before overcall allowed", p: 13, shape: [4, 4, 1, 4], expected: "X", calls: ["1♦", "PASS", "PASS"], start: 1 },
  { name: "NT opener rebid unsupported", p: 16, shape: [4, 3, 3, 3], expected: null, calls: ["1NT", "PASS", "2♣", "PASS"] },
  { name: "unsupported jump new suit reply", p: 14, shape: [5, 3, 3, 2], expected: null, calls: ["1♠", "PASS", "3♣", "PASS"] },
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
  { name: "right opponent overcall unsupported", p: 15, shape: [4, 3, 3, 3], expected: null, calls: ["2♥", "2♠"] },
  { name: "right opponent double unsupported", p: 15, shape: [4, 3, 3, 3], expected: null, calls: ["2♥", "X"] },
  { name: "missing right pass unsupported", p: 15, shape: [4, 3, 3, 3], expected: null, calls: ["2♥"] },
  { name: "passed hand not first utterance", p: 15, shape: [4, 3, 3, 3], expected: null, calls: ["PASS", "PASS", "2♥", "PASS"], start: 0 },
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
  { name: "NT opening double unsupported", p: 11, shape: [2, 3, 4, 4], expected: null, calls: ["1NT", "X"] },
  { name: "two-level opening double unsupported", p: 11, shape: [2, 3, 4, 4], expected: null, calls: ["2♣", "X"] },
  { name: "auction must be exactly opening double", p: 11, shape: [2, 3, 4, 4], expected: null, calls: ["PASS", "1♠", "X"], start: 1 },
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
  { name: "right opponent redouble unsupported", p: 13, shape: [4, 3, 2, 4], expected: null, calls: ["1♦", "X", "XX"] },
  { name: "right opponent raises unsupported", p: 13, shape: [4, 3, 2, 4], expected: null, calls: ["1♦", "X", "2♦"] },
  { name: "NT opponent opening unsupported", p: 13, shape: [4, 3, 2, 4], expected: null, calls: ["1NT", "X", "PASS"] },
  { name: "two-level opponent opening unsupported", p: 13, shape: [4, 3, 2, 4], expected: null, calls: ["2♦", "X", "PASS"] },
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
