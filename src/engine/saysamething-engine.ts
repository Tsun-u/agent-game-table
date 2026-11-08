import { displayOptionValue } from "./option-format.js";
import { claimOutcome, normalizedAnswer, pendingVotes, startClaim, timeoutClaim, voteSame, type SameClaim } from "./same-claim.js";
import type { EngineTransition, GameEngine, GameRules, OptionDescription } from "./types.js";

export interface SaySameThingOptions { max_turns: number; turn_seconds: number }
export interface SaySameThingState {
  phase: "writing" | "judging" | "ended";
  order: string[];
  turn: number;
  timerStep: number;
  words: Record<string, string>;
  chain: { turn: number; words: Record<string, string | null> }[];
  claimed: boolean;
  claim: SameClaim | null;
  result: { matched: string; turn: number; points: number } | null;
}
const optionDescriptions: readonly OptionDescription[] = [
  { key: "max_turns", type: "number", label: "最多輪數", description: "5～300 輪。", default: 30, min: 5, max: 300 },
  { key: "turn_seconds", type: "number", label: "回合秒數", description: "0 不計時，或 30～600 秒。計時對 AI 玩家不友善，建議有 AI 玩家時不開。", default: 0, min: 0, max: 600 },
];
interface Rules extends GameRules { options: SaySameThingOptions; instructions: string[] }
const transition = (state: SaySameThingState): EngineTransition<SaySameThingState> => ({ state, events: [], result: null });
function canClaim(state: SaySameThingState): boolean {
  const last = state.chain.at(-1);
  return state.phase === "writing" && !!last && !state.claimed && Object.values(last.words).every((word) => word !== null);
}
function allWordsMatch(words: Record<string, string | null>, first: string | null): first is string {
  return first !== null && Object.values(words).every((word) => word !== null && normalizedAnswer(word) === normalizedAnswer(first));
}
function settle(state: SaySameThingState, matched: string | null, turn: number): EngineTransition<SaySameThingState> {
  state.phase = "ended";
  const points = matched === null ? 0 : Math.max(1, 11 - turn);
  state.result = matched === null ? null : { matched, turn, points };
  const text = matched === null ? `第 ${turn} 輪仍未撞詞，本局流局，每人 0 分。` : `第 ${turn} 輪撞到『${matched}』！每人 +${points} 分`;
  return {
    state, events: [{ kind: "saysamething:round_ended", seatId: null, text }], result: {
      winnerSeatId: null, scoreDelta: Object.fromEntries(state.order.map((id) => [id, points])), gameOver: false, text,
    }
  };
}
function reveal(state: SaySameThingState, options: SaySameThingOptions): EngineTransition<SaySameThingState> {
  const words = Object.fromEntries(state.order.map((id) => [id, state.words[id] ?? null]));
  state.chain.push({ turn: state.turn, words });
  const first = words[state.order[0]!]!;
  if (allWordsMatch(words, first)) return settle(state, first, state.turn);
  if (state.turn === options.max_turns) return settle(state, null, state.turn);
  state.turn++;
  state.timerStep++;
  state.words = {};
  state.claimed = false;
  state.claim = null;
  return { state, events: [{ kind: "saysamething:revealed", seatId: null, text: `第 ${state.turn - 1} 輪揭曉：${Object.values(words).map((word) => word ?? "（沒交）").join("／")}。` }], result: null };
}
function resolveClaim(state: SaySameThingState): EngineTransition<SaySameThingState> {
  const outcome = claimOutcome(state.claim!, state.order);
  if (outcome === null) return transition(state);
  if (outcome) {
    const last = state.chain.at(-1)!;
    return settle(state, [...new Set(Object.values(last.words))].join("／"), last.turn);
  }
  state.phase = "writing";
  state.timerStep++;
  state.words = {};
  state.claim = null;
  return { state, events: [{ kind: "saysamething:claim_rejected", seatId: null, text: "同義認定未通過，這一輪重新交詞。" }], result: null };
}
export const saySameThingEngine: GameEngine<SaySameThingState, SaySameThingOptions> = {
  mode: "saysamething", label: "聯想收束", rulesVersion: "saysamething-1", seats: { min: 2, max: 4, fixed: false }, optionDescriptions,
  normalizeOptions(value) {
    const raw = (value ?? {}) as Record<string, unknown>;
    const max = Number(raw.max_turns);
    const seconds = Number(raw.turn_seconds);
    return {
      max_turns: Number.isInteger(max) && max >= 5 && max <= 300 ? max : 30,
      turn_seconds: Number.isInteger(seconds) && (seconds === 0 || seconds >= 30 && seconds <= 600) ? seconds : 0
    };
  },
  buildRules(options): Rules {
    return {
      rules_version: this.rulesVersion, game: this.label, options, instructions: [
        "2～4 人各自 submit_word，cards 第一格放 1～20 字的詞，交了不能改；全員交齊才揭曉。比對去頭尾空白、英文轉小寫。",
        "不同詞就從上一輪的詞繼續聯想；上一輪可 claim_same（不帶 cards）一次，提出者自動同意，其他人 agree_same／reject_same，全員同意才算撞詞。反對後清空這輪重交。",
        "第 N 輪撞詞每人 max(1, 11 − N) 分；最多輪數到仍不同就流局，不再開放同義認定。整場由人類決定何時結束。",
        "計時到期用已交的揭曉，沒交記為（沒交），不能撞詞或提同義；投票逾時算反對。",
      ]
    };
  },
  formatRules(rules) {
    const r = rules as Rules;
    return [r.game, r.rules_version, ...r.instructions, ...optionDescriptions.map((o) => `${o.label}：${displayOptionValue(o, r.options[o.key as keyof SaySameThingOptions])}`)].join("\n");
  },
  deal(input) {
    return transition({ phase: "writing", order: [...input.seatIds], turn: 1, timerStep: 0, words: {}, chain: [], claimed: false, claim: null, result: null });
  },
  pendingSeatIds(state) {
    if (state.phase === "judging") return pendingVotes(state.claim!, state.order);
    return state.phase === "writing" ? state.order.filter((id) => !(id in state.words)) : [];
  },
  legalActions(state, id) {
    if (!state.order.includes(id) || state.phase === "ended") return [];
    if (state.phase === "judging") return id in state.claim!.votes ? [] : [{ action: "agree_same", label: "同意" }, { action: "reject_same", label: "反對" }];
    return [...(id in state.words ? [] : [{ action: "submit_word", label: "交詞" }]), ...(canClaim(state) ? [{ action: "claim_same", label: "意思一樣" }] : [])];
  },
  legalPlays: () => [],
  apply(state, id, action, options) {
    const next = structuredClone(state);
    if (next.phase === "judging") {
      voteSame(next.claim!, id, action);
      return resolveClaim(next);
    }
    if (next.phase !== "writing") throw new Error("現在不能送出這個動作。");
    if (action.action === "claim_same") {
      if (!canClaim(next)) throw new Error("上一輪不能提同義認定。");
      next.claimed = true;
      next.claim = startClaim(id);
      next.phase = "judging";
      next.timerStep++;
      return transition(next);
    }
    if (action.action !== "submit_word") throw new Error("現在只能交詞或提同義認定。");
    if (id in next.words) throw new Error("這一輪已經交過了");
    const word = action.cards[0] ?? "";
    if (!normalizedAnswer(word) || [...word].length > 20) throw new Error("詞要填 1～20 字。");
    next.words[id] = word;
    return next.order.every((seat) => seat in next.words) ? reveal(next, options) : transition(next);
  },
  onSeatRemoved(state, id) {
    if (state.phase !== "ended" && state.order.includes(id)) return "abort";
    return transition({ ...state, order: state.order.filter((seat) => seat !== id) });
  },
  transferSeat(state, from, to) {
    const next = structuredClone(state);
    const rekey = <T>(r: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(r).map(([id, value]) => [id === from ? to : id, value]));
    next.order = next.order.map((id) => id === from ? to : id);
    next.words = rekey(next.words);
    for (const row of next.chain) row.words = rekey(row.words);
    if (next.claim) {
      if (next.claim.by === from) next.claim.by = to;
      next.claim.votes = rekey(next.claim.votes);
    }
    return next;
  },
  isGameOver: () => false,
  view(state, viewer, options) {
    return structuredClone({
      phase: state.phase, turn: state.turn, max_turns: options.max_turns, chain: state.chain,
      submitted: Object.keys(state.words), your_word: viewer === null ? null : state.words[viewer] ?? null, claim: state.claim, result: state.result
    });
  },
  hand: () => [], serialize: (state) => state, restore: (saved) => structuredClone(saved) as SaySameThingState,
  turnTimer(state, options) {
    return !options.turn_seconds || state.phase === "ended" ? null : { key: `${state.phase}:${state.turn}:${state.timerStep}`, seconds: options.turn_seconds };
  },
  onTimeout(state, options) {
    const next = structuredClone(state);
    if (next.phase === "writing") return reveal(next, options);
    if (next.phase === "judging") {
      timeoutClaim(next.claim!, next.order);
      return resolveClaim(next);
    }
    return transition(next);
  },
};
