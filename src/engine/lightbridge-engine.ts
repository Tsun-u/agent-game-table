import { randomInt } from "node:crypto";
import { legalFollows, trickWinner, suitOf, sortTrickCards, type TrickPlay } from "./trick-taking-core.js";
import { BIDS, bidRank, bidStrain } from "./honeymoon-rules.js";
import { highCardPoints, REDEAL_THRESHOLD, buildLightbridgeRules, formatLightbridgeRules, normalizeLightbridgeOptions,
  LIGHTBRIDGE_LABEL, LIGHTBRIDGE_RULES_VERSION, LIGHTBRIDGE_OPTION_DESCRIPTIONS, scoreLightbridgeRound,
  type LightbridgeOptions, type LightbridgeRules, type LightbridgeContract } from "./lightbridge-rules.js";
import type { EngineEvent, EngineTransition, GameBoardView, GameEngine, LegalAction, LegalPlay } from "./types.js";

export interface LightbridgeState {
  phase: "bidding" | "play" | "ended";
  order: string[];
  dealer: string;
  hands: Record<string, string[]>;
  bids: { seatId: string; call: string }[];
  contract: LightbridgeContract | null;
  trump: string | null;
  trick: { leader: string; plays: TrickPlay[] } | null;
  tricksWon: Record<string, number>;
  active: string | null;
  lastTrick: { winnerSeatId: string; plays: TrickPlay[] } | null;
  lastRoundScores: Record<string, number> | null;
  lastRoundDetail: string | null;
}
type PublicPlay = { seat_id: string; card: string };
export interface LightbridgeBoard extends GameBoardView {
  readonly phase: LightbridgeState["phase"];
  readonly dealer_seat_id: string;
  readonly contract: { seat_id: string; bid: string; doubled: 0 | 1 | 2 } | null;
  readonly trump: string | null;
  readonly bids: { seat_id: string; call: string }[];
  readonly viewer_hcp: number | null;
  readonly trick: { leader_seat_id: string; plays: PublicPlay[] } | null;
  readonly tricks_won: Record<string, number>;
  readonly last_trick: { winner_seat_id: string; plays: PublicPlay[] } | null;
  readonly seat_status: Record<string, "waiting" | "active">;
  readonly last_round_scores: Record<string, number> | null;
  readonly last_round_detail: string | null;
}

// 叫牌紀錄是叫牌階段的唯一來源；contract 留到叫牌結束才建立。
function highestCall(state: LightbridgeState): LightbridgeContract | null {
  let highest: LightbridgeContract | null = null;
  for (const { seatId, call } of state.bids) {
    if (bidRank(call) >= 0) highest = { seatId, bid: call, doubled: 0 };
    else if (highest && call === "X") highest.doubled = 1;
    else if (highest && call === "XX") highest.doubled = 2;
  }
  return highest;
}
const nextSeat = (state: LightbridgeState, seat: string): string => state.order[(state.order.indexOf(seat) + 1) % 4]!;
const availableBids = (state: LightbridgeState): readonly string[] => BIDS.slice(bidRank(highestCall(state)?.bid ?? "") + 1);
function legalPlays(state: LightbridgeState, seatId: string): LegalPlay[] {
  if (state.active !== seatId || state.phase === "ended") return [];
  if (state.phase === "bidding") return availableBids(state).map((bid) => ({ action: "bid", cards: [bid], label: "可叫" }));
  const hand = state.hands[seatId]!;
  const first = state.trick!.plays[0];
  return (first ? legalFollows(hand, suitOf(first.card)) : hand).map((card) => ({ action: "play_card", cards: [card], label: "可出" }));
}
function legalActions(state: LightbridgeState, seatId: string, options: LightbridgeOptions): LegalAction[] {
  if (state.active !== seatId || state.phase === "ended") return [];
  if (state.phase !== "bidding") return [{ action: "play_card", label: "出牌" }];
  const actions: LegalAction[] = availableBids(state).length ? [{ action: "bid", label: "叫牌" }] : [];
  actions.push({ action: "pass", label: "PASS" });
  if (!state.bids.some((bid) => bid.seatId === seatId) && highCardPoints(state.hands[seatId]!) < REDEAL_THRESHOLD) actions.push({ action: "redeal", label: "倒牌" });
  const highest = highestCall(state);
  if (options.doubling && highest) {
    if (highest.seatId !== seatId && highest.doubled === 0 && (!options.pair_scoring || state.order[(state.order.indexOf(highest.seatId) + 2) % 4] !== seatId)) actions.push({ action: "double", label: "Double" });
    if (highest.seatId === seatId && highest.doubled === 1 && state.bids.at(-1)?.seatId !== seatId) actions.push({ action: "redouble", label: "Redouble" });
  }
  return actions;
}
function dealState(deck: readonly string[], seats: readonly string[], dealer: string): LightbridgeState {
  return { phase: "bidding", order: [...seats], dealer,
    hands: Object.fromEntries(seats.map((seat, i) => [seat, sortTrickCards(deck.slice(i * 13, (i + 1) * 13))])),
    bids: [], contract: null, trump: null, trick: null, tricksWon: Object.fromEntries(seats.map((seat) => [seat, 0])),
    active: dealer, lastTrick: null, lastRoundScores: null, lastRoundDetail: null };
}
function redeal(state: LightbridgeState): LightbridgeState {
  const deck = state.order.flatMap((seat) => state.hands[seat]!);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return dealState(deck, state.order, nextSeat(state, state.dealer));
}
export const lightbridgeEngine: GameEngine<LightbridgeState, LightbridgeOptions> = {
  mode: "lightbridge", label: LIGHTBRIDGE_LABEL, rulesVersion: LIGHTBRIDGE_RULES_VERSION,
  seats: { min: 4, max: 4, fixed: true }, optionDescriptions: LIGHTBRIDGE_OPTION_DESCRIPTIONS,
  normalizeOptions: normalizeLightbridgeOptions, buildRules: buildLightbridgeRules, formatRules: (rules) => formatLightbridgeRules(rules as LightbridgeRules),
  deal(input) {
    const dealer = input.seatIds[(input.round - 1) % 4]!;
    return { state: dealState(input.deck.map((card) => card.code), input.seatIds, dealer),
      events: [{ kind: "turn_started", seatId: dealer, text: `第 ${input.round} 局開始，由 {name} 發牌並先叫牌。` }], result: null };
  },
  pendingSeatIds: (state) => state.phase !== "ended" && state.active ? [state.active] : [],
  legalActions, legalPlays,
  apply(state, seatId, action, options) {
    if (state.active !== seatId || state.phase === "ended") throw new Error("現在不是你的回合。");
    if (!legalActions(state, seatId, options).some((legal) => legal.action === action.action)) throw new Error("現在不能執行這個動作。");
    if (action.action === "bid" || action.action === "play_card") {
      if (action.cards.length !== 1 || !legalPlays(state, seatId).some((play) => play.cards[0] === action.cards[0])) throw new Error("請從合法清單選一個叫品或一張牌；出牌必須跟花色。");
    } else if (action.cards.length !== 0) throw new Error("PASS／倒牌／Double／Redouble 不帶牌。");
    if (action.action === "redeal") {
      const next = redeal(state);
      return { state: next, events: [
        { kind: "redeal", seatId, text: "{name} 點力不足，要求倒牌。" },
        { kind: "redeal", seatId: next.dealer, text: "重新發牌，改由 {name} 發牌。" },
      ], result: null };
    }
    const next = structuredClone(state);
    const events: EngineEvent[] = [];
    if (action.action === "play_card") return applyCard(next, seatId, action.cards[0]!, options);
    const highest = highestCall(state);
    const call = action.action === "bid" ? action.cards[0]! : action.action === "pass" ? "PASS" : action.action === "double" ? "X" : "XX";
    next.bids.push({ seatId, call });
    next.active = nextSeat(state, seatId);
    if (action.action !== "pass") {
      events.push({ kind: action.action, seatId, text: action.action === "bid" ? `{name} 叫 ${call}。` : `{name} ${action.action === "double" ? "Double" : "Redouble"}。` });
    } else if (highest && next.bids.slice(-3).length === 3 && next.bids.slice(-3).every((bid) => bid.call === "PASS")) {
      next.contract = highest;
      next.trump = bidStrain(highest.bid) === "NT" ? null : bidStrain(highest.bid);
      next.phase = "play";
      next.active = nextSeat(state, highest.seatId);
      next.trick = { leader: next.active, plays: [] };
      const suffix = highest.doubled === 1 ? "（Double）" : highest.doubled === 2 ? "（Redouble）" : "";
      events.push({ kind: "pass", seatId, text: "{name} PASS。" }, { kind: "contract", seatId: highest.seatId, text: `合約 ${highest.bid}${suffix} 由 {name} 主打。` });
    } else if (!highest && next.bids.length === 4) {
      const dealt = redeal(state);
      return { state: dealt, events: [{ kind: "redeal", seatId: dealt.dealer, text: "四家都 PASS，重新發牌，改由 {name} 發牌。" }], result: null };
    } else events.push({ kind: "pass", seatId, text: "{name} PASS。" });
    return { state: next, events, result: null };
  },
  onSeatRemoved(state, seatId) {
    return state.phase !== "ended" && state.order.includes(seatId) ? "abort" : { state, events: [], result: null };
  },
  transferSeat(state, fromSeatId, toSeatId) {
    if (!state.order.includes(fromSeatId)) return state;
    const next = structuredClone(state);
    const rekey = (seat: string): string => seat === fromSeatId ? toSeatId : seat;
    const record = <T>(value: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(value).map(([seat, data]) => [rekey(seat), data]));
    const plays = (value: TrickPlay[]): TrickPlay[] => value.map((play) => ({ ...play, seatId: rekey(play.seatId) }));
    next.order = state.order.map(rekey);
    next.dealer = rekey(state.dealer);
    next.hands = record(next.hands); next.tricksWon = record(next.tricksWon);
    next.bids = next.bids.map((bid) => ({ ...bid, seatId: rekey(bid.seatId) }));
    if (next.contract) next.contract.seatId = rekey(next.contract.seatId);
    if (next.active !== null) next.active = rekey(next.active);
    if (next.trick) next.trick = { leader: rekey(next.trick.leader), plays: plays(next.trick.plays) };
    if (next.lastTrick) next.lastTrick = { ...next.lastTrick, winnerSeatId: rekey(next.lastTrick.winnerSeatId), plays: plays(next.lastTrick.plays) };
    if (next.lastRoundScores) next.lastRoundScores = record(next.lastRoundScores);
    return next;
  },
  isGameOver: (options, summary) => options.end_mode === "rounds" ? summary.round >= options.end_rounds : Object.values(summary.scores).some((score) => score >= options.end_score),
  view(state, viewerSeatId): LightbridgeBoard {
    const plays = (value: TrickPlay[]): PublicPlay[] => value.map((play) => ({ seat_id: play.seatId, card: play.card }));
    return { phase: state.phase, dealer_seat_id: state.dealer, contract: state.contract ? { seat_id: state.contract.seatId, bid: state.contract.bid, doubled: state.contract.doubled } : null,
      trump: state.trump, bids: state.bids.map((bid) => ({ seat_id: bid.seatId, call: bid.call })),
      viewer_hcp: state.phase === "bidding" && viewerSeatId !== null && state.order.includes(viewerSeatId) ? highCardPoints(state.hands[viewerSeatId]!) : null,
      trick: state.trick ? { leader_seat_id: state.trick.leader, plays: plays(state.trick.plays) } : null, tricks_won: { ...state.tricksWon },
      last_trick: state.lastTrick ? { winner_seat_id: state.lastTrick.winnerSeatId, plays: plays(state.lastTrick.plays) } : null,
      seat_status: Object.fromEntries(state.order.map((seat) => [seat, seat === state.active ? "active" : "waiting"])),
      last_round_scores: state.lastRoundScores ? { ...state.lastRoundScores } : null, last_round_detail: state.lastRoundDetail };
  },
  hand: (state, seatId) => state.hands[seatId] ?? [],
  serialize: (state) => state,
  restore: (saved) => structuredClone(saved) as LightbridgeState,
};

function applyCard(state: LightbridgeState, seatId: string, card: string, options: LightbridgeOptions): EngineTransition<LightbridgeState> {
  state.hands[seatId] = state.hands[seatId]!.filter((held) => held !== card);
  state.trick!.plays.push({ seatId, card });
  const events: EngineEvent[] = [{ kind: "card_played", seatId, text: `{name} 出 ${card}。` }];
  const plays = state.trick!.plays;
  if (plays.length < 4) {
    state.active = nextSeat(state, seatId);
    return { state, events, result: null };
  }
  const winner = trickWinner(plays, suitOf(plays[0]!.card), state.trump);
  state.lastTrick = { winnerSeatId: winner, plays: [...plays] };
  state.tricksWon[winner]! += 1;
  const count = Object.values(state.tricksWon).reduce((sum, n) => sum + n, 0);
  events.push({ kind: "trick_won", seatId: winner, text: `{name} 贏得第 ${count} 墩。` });
  if (count === 13) {
    const scored = scoreLightbridgeRound(state.contract!, state.tricksWon, state.order, options);
    const scoringSeat = state.order.reduce((best, seat) => scored.scores[seat]! > scored.scores[best]! ? seat : best);
    state.phase = "ended"; state.active = null;
    state.lastRoundScores = scored.scores; state.lastRoundDetail = scored.detail;
    return { state, events, result: { winnerSeatId: scoringSeat, scoreDelta: scored.scores, gameOver: false, text: "本局結束，{name} 拿最多分。" } };
  }
  state.trick = { leader: winner, plays: [] }; state.active = winner;
  return { state, events, result: null };
}
