import assert from "node:assert/strict";
import test from "node:test";
import { createDeck } from "../src/cards.js";
import { saySameThingEngine as engine, type SaySameThingState, type SaySameThingOptions } from "../src/engine/saysamething-engine.js";
import { engineFor } from "../src/engine/registry.js";
const options = engine.normalizeOptions({});
const seats = ["a", "b"];
const deal = (ids = seats, o = options) => engine.deal({ deck: createDeck(), seatIds: ids, round: 1 }, o).state;
const act = (s: SaySameThingState, id: string, action: string, cards: string[] = [], o = options) => engine.apply(s, id, { action, cards }, o);
function words(s: SaySameThingState, values: string[], o = options) {
  let result;
  for (const [i, id] of s.order.entries()) { result = act(s, id, "submit_word", [values[i]!], o); s = result.state; }
  return result!;
}

test("聯想收束：註冊、規則、選項和空手牌", () => {
  assert.equal(engineFor("saysamething"), engine);
  assert.equal(engine.rulesVersion, "saysamething-1");
  assert.deepEqual(engine.seats, { min: 2, max: 4, fixed: false });
  assert.deepEqual(options, { max_turns: 30, turn_seconds: 0 });
  const timerOption = engine.optionDescriptions.find((option) => option.key === "turn_seconds")!;
  assert.equal(timerOption.default, 0);
  assert.ok(timerOption.description.includes("計時對 AI 玩家不友善，建議有 AI 玩家時不開。"));
  for (const value of [null, [], "abc", { max_turns: 4, turn_seconds: 29 }, { max_turns: 301, turn_seconds: 601 }]) assert.deepEqual(engine.normalizeOptions(value), options);
  assert.deepEqual(engine.normalizeOptions({ max_turns: "5", turn_seconds: "30" }), { max_turns: 5, turn_seconds: 30 });
  const text = engine.formatRules(engine.buildRules(options));
  for (const term of ["聯想收束", "saysamething-1", "submit_word", "claim_same", "agree_same", "reject_same", "最多輪數：30", "回合秒數：0"]) assert.ok(text.includes(term));
  assert.deepEqual(engine.hand(deal(), "a"), []); assert.deepEqual(engine.legalPlays(deal(), "a", options), []);
  assert.equal(engine.isGameOver(options, { round: 100, scores: { a: 999 } }), false);
});
for (const count of [2, 4]) test(`聯想收束：${count} 人第一輪撞詞，英文大小寫與空白比對`, () => {
  const ids = ["a", "b", "c", "d"].slice(0, count);
  const result = words(deal(ids), ids.map((_, i) => i ? "apple" : " Apple "));
  assert.equal(result.state.phase, "ended"); assert.equal(result.state.result?.points, 10);
  assert.deepEqual(result.result?.scoreDelta, Object.fromEntries(ids.map((id) => [id, 10])));
  assert.equal(result.result?.gameOver, false); assert.equal(result.result?.winnerSeatId, null);
  assert.match(result.result!.text, /第 1 輪撞到/);
  assert.deepEqual(engine.pendingSeatIds(result.state), []);
  assert.deepEqual(engine.legalActions(result.state, "a", options), []);
});
for (const turn of [2, 3, 10, 11, 12]) test(`聯想收束：第 ${turn} 輪計分`, () => {
  let s = deal();
  for (let i = 1; i < turn; i++) s = words(s, ["甲", "乙"]).state;
  assert.equal(s.turn, turn); assert.equal(s.chain.length, turn - 1);
  const result = words(s, ["玉兔", "玉兔"]);
  assert.equal(result.result!.scoreDelta.a, Math.max(1, 11 - turn));
  assert.equal(result.state.result!.turn, turn);
});
test("聯想收束：隱藏內容、不可改卷、空白與 code point 長度", () => {
  const initial = deal(), before = structuredClone(initial);
  assert.throws(() => act(initial, "a", "claim_same"));
  assert.throws(() => act(initial, "a", "finish_round"));
  for (const word of ["", "   ", "字".repeat(21), "😀".repeat(21)]) assert.throws(() => act(initial, "a", "submit_word", [word]));
  const result = act(initial, "a", "submit_word", ["😀".repeat(20)]), s = result.state;
  assert.deepEqual(initial, before); assert.deepEqual(result.events, []);
  assert.deepEqual(engine.pendingSeatIds(s), ["b"]);
  assert.throws(() => act(s, "a", "submit_word", ["改卷"]), /這一輪已經交過了/);
  assert.equal(engine.view(s, "a", options).your_word, "😀".repeat(20));
  for (const id of ["b", null]) { const view = engine.view(s, id, options); assert.equal(view.your_word, null); assert.ok(!JSON.stringify(view).includes("😀")); }
  assert.deepEqual(engine.view(s, null, options).submitted, ["a"]);
});
test("聯想收束：全員同意上一輪同義，以上一輪計分", () => {
  let s = words(deal(["a", "b", "c", "d"]), ["玉兔", "月兔", "玉兔", "月兔"]).state;
  s = act(s, "b", "submit_word", ["秘密"]).state;
  s = act(s, "a", "claim_same").state;
  assert.equal(s.phase, "judging"); assert.deepEqual(engine.pendingSeatIds(s), ["b", "c", "d"]);
  assert.throws(() => act(s, "b", "submit_word", ["新詞"]));
  assert.throws(() => act(s, "a", "agree_same"));
  for (const id of ["b", "c"]) { const result = act(s, id, "agree_same"); assert.equal(result.result, null); s = result.state; }
  const result = act(s, "d", "agree_same");
  assert.deepEqual(result.state.result, { matched: "玉兔／月兔", turn: 1, points: 10 });
  assert.deepEqual(result.result!.scoreDelta, { a: 10, b: 10, c: 10, d: 10 });
});
test("聯想收束：一票反對即否決、清空本輪、同輪只提一次", () => {
  let s = words(deal(), ["玉兔", "月兔"]).state;
  s = act(s, "b", "submit_word", ["秘密"]).state;
  s = act(s, "a", "claim_same").state;
  s = act(s, "b", "reject_same").state;
  assert.equal(s.phase, "writing"); assert.deepEqual(s.words, {});
  assert.deepEqual(engine.pendingSeatIds(s), seats);
  assert.throws(() => act(s, "a", "claim_same"));
  assert.ok(!engine.legalActions(s, "a", options).some((a) => a.action === "claim_same"));
  s = words(s, ["桌子", "椅子"]).state;
  assert.equal(act(s, "a", "claim_same").state.phase, "judging");
});
test("聯想收束：max_turns 流局且不再開放同義", () => {
  const o = { ...options, max_turns: 5 }; let s = deal(seats, o);
  for (let i = 1; i < 5; i++) s = words(s, ["甲", "乙"], o).state;
  const result = words(s, ["甲", "乙"], o);
  assert.equal(result.state.phase, "ended"); assert.equal(result.state.chain.length, 5);
  assert.deepEqual(result.result!.scoreDelta, { a: 0, b: 0 }); assert.match(result.result!.text, /流局/);
  assert.throws(() => act(result.state, "a", "claim_same", [], o));
});
test("聯想收束：序列化後接續與席位轉移、局中離桌", () => {
  let s = words(deal(), ["玉兔", "月兔"]).state; s = act(s, "a", "claim_same").state;
  const restored = engine.restore(JSON.parse(JSON.stringify(engine.serialize(s))));
  assert.deepEqual(restored, s); assert.equal(act(restored, "b", "agree_same").result!.scoreDelta.a, 10);
  const replacement = engine.transferSeat(restored, "a", "new");
  assert.deepEqual(replacement.order, ["new", "b"]); assert.equal(replacement.claim!.by, "new");
  assert.equal(replacement.chain[0]!.words.new, "玉兔"); assert.deepEqual(replacement.claim!.votes, { new: "agree" });
  assert.equal(engine.onSeatRemoved(s, "a", options), "abort");
  assert.notEqual(engine.onSeatRemoved(s, "visitor", options), "abort");
  assert.notEqual(engine.onSeatRemoved(act(s, "b", "agree_same").state, "a", options), "abort");
});
test("聯想收束：逾時揭曉缺交、不開同義、投票逾時反對及計時 key", () => {
  const o: SaySameThingOptions = { ...options, turn_seconds: 30 };
  let s = deal(seats, o);
  assert.equal(engine.turnTimer!(s, options), null);
  const timer = engine.turnTimer!(s, o)!;
  s = act(s, "a", "submit_word", ["玉兔"], o).state;
  assert.deepEqual(engine.turnTimer!(s, o), timer);
  const timeout = engine.onTimeout!(s, o); s = timeout.state;
  assert.deepEqual(s.chain[0]!.words, { a: "玉兔", b: null }); assert.equal(timeout.result, null);
  assert.throws(() => act(s, "a", "claim_same", [], o));
  assert.notEqual(engine.turnTimer!(s, o)!.key, timer.key);
  s = words(s, ["玉兔", "月兔"], o).state;
  const writing = engine.turnTimer!(s, o)!.key;
  s = act(s, "a", "claim_same", [], o).state;
  assert.notEqual(engine.turnTimer!(s, o)!.key, writing);
  s = engine.onTimeout!(s, o).state;
  assert.equal(s.phase, "writing"); assert.notEqual(engine.turnTimer!(s, o)!.key, writing);
  assert.throws(() => act(s, "a", "claim_same", [], o));
  const ended = words(s, ["同", "同"], o).state;
  assert.equal(engine.turnTimer!(ended, o), null);
  assert.equal(engine.onTimeout!(ended, o).result, null);
});
