import { randomInt } from "node:crypto";
import { legalFollows, trickWinner, suitOf, sortTrickCards, type TrickPlay } from "./trick-taking-core.js";
import { BIDS, bidRank, bidStrain, buildHoneymoonRules, formatHoneymoonRules, normalizeHoneymoonOptions,
  HONEYMOON_LABEL, HONEYMOON_RULES_VERSION, HONEYMOON_OPTION_DESCRIPTIONS, scoreHoneymoonRound,
  type HoneymoonOptions, type HoneymoonRules, type HoneymoonContract } from "./honeymoon-rules.js";
import type { EngineEvent, EngineTransition, GameBoardView, GameEngine, LegalAction, LegalPlay } from "./types.js";

export interface HoneymoonState {
  phase: "bidding" | "draw" | "play" | "ended";
  order: [string, string];
  hands: Record<string, string[]>;
  bids: { seatId: string; call: string }[];
  contract: HoneymoonContract | null;
  trump: string | null;
  stock: string[];
  trick: { leader: string; plays: TrickPlay[] } | null;
  tricksWon: Record<string, number>;
  drawRound: number;
  active: string | null;
  lastTrick: { winnerSeatId: string; plays: TrickPlay[]; drewCard: string | null } | null;
  lastRoundScores: Record<string, number> | null;
  lastRoundDetail: string | null;
}
type PublicPlay = { seat_id: string; card: string };
export interface HoneymoonBoard extends GameBoardView {
  readonly phase: HoneymoonState["phase"];
  readonly dealer_seat_id: string;
  readonly contract: { seat_id: string; bid: string; doubled: 0 | 1 | 2 } | null;
  readonly trump: string | null;
  readonly bids: { seat_id: string; call: string }[];
  readonly legal_bids_count: number;
  readonly stock_count: number;
  readonly stock_top: string | null;
  readonly draw_round: number;
  readonly trick: { leader_seat_id: string; plays: PublicPlay[] } | null;
  readonly tricks_won: Record<string, number>;
  readonly last_trick: { winner_seat_id: string; plays: PublicPlay[]; drew_card: string | null } | null;
  readonly seat_status: Record<string, "waiting" | "active">;
  readonly last_round_scores: Record<string, number> | null;
  readonly last_round_detail: string | null;
}

// 叫牌紀錄是叫牌階段的唯一來源；contract 留到叫牌結束才建立。
function highestCall(state: HoneymoonState): HoneymoonContract | null {
  let highest: HoneymoonContract | null = null;
  for (const { seatId, call } of state.bids) {
    if (bidRank(call) >= 0) highest = { seatId, bid: call, doubled: 0 };
    else if (highest && call === "X") highest.doubled = 1;
    else if (highest && call === "XX") highest.doubled = 2;
  }
  return highest;
}
const otherSeat = (state: HoneymoonState, seat: string): string => state.order.find((id) => id !== seat)!;
const availableBids = (state: HoneymoonState): readonly string[] => BIDS.slice(bidRank(highestCall(state)?.bid ?? "") + 1);
function legalPlays(state: HoneymoonState, seatId: string): LegalPlay[] {
  if (state.active !== seatId || state.phase === "ended") return [];
  if (state.phase === "bidding") return availableBids(state).map((bid) => ({ action: "bid", cards: [bid], label: "可叫" }));
  const hand = state.hands[seatId]!;
  const first = state.trick!.plays[0];
  return (first ? legalFollows(hand, suitOf(first.card)) : hand).map((card) => ({ action: "play_card", cards: [card], label: "可出" }));
}
function legalActions(state: HoneymoonState, seatId: string, options: HoneymoonOptions): LegalAction[] {
  if (state.active !== seatId || state.phase === "ended") return [];
  if (state.phase !== "bidding") return [{ action: "play_card", label: "出牌" }];
  const actions: LegalAction[] = availableBids(state).length ? [{ action: "bid", label: "叫牌" }] : [];
  actions.push({ action: "pass", label: "PASS" });
  const highest = highestCall(state);
  if (options.doubling && highest) {
    if (highest.seatId !== seatId && highest.doubled === 0) actions.push({ action: "double", label: "Double" });
    if (highest.seatId === seatId && highest.doubled === 1 && state.bids.at(-1)?.seatId !== seatId) actions.push({ action: "redouble", label: "Redouble" });
  }
  return actions;
}
function dealState(deck: readonly string[], seats: readonly string[], order: [string, string]): HoneymoonState {
  return { phase: "bidding", order, hands: { [seats[0]!]: sortTrickCards(deck.slice(0, 13)), [seats[1]!]: sortTrickCards(deck.slice(13, 26)) },
    bids: [], contract: null, trump: null, stock: deck.slice(26), trick: null, tricksWon: Object.fromEntries(order.map((seat) => [seat, 0])),
    drawRound: 0, active: order[0], lastTrick: null, lastRoundScores: null, lastRoundDetail: null };
}
export const honeymoonEngine: GameEngine<HoneymoonState, HoneymoonOptions> = {
  mode: "honeymoon", label: HONEYMOON_LABEL, rulesVersion: HONEYMOON_RULES_VERSION,
  seats: { min: 2, max: 2, fixed: true }, optionDescriptions: HONEYMOON_OPTION_DESCRIPTIONS,
  normalizeOptions: normalizeHoneymoonOptions, buildRules: buildHoneymoonRules, formatRules: (rules) => formatHoneymoonRules(rules as HoneymoonRules),
  deal(input) {
    const dealer = (input.round - 1) % 2;
    const order: [string, string] = [input.seatIds[dealer]!, input.seatIds[1 - dealer]!];
    return { state: dealState(input.deck.map((card) => card.code), input.seatIds, order),
      events: [{ kind: "turn_started", seatId: order[0], text: `第 ${input.round} 局開始，由 {name} 發牌並先叫牌。` }], result: null };
  },
  pendingSeatIds: (state) => state.phase !== "ended" && state.active ? [state.active] : [],
  legalActions, legalPlays,
  apply(state, seatId, action, options) {
    if (state.active !== seatId || state.phase === "ended") throw new Error("現在不是你的回合。");
    if (!legalActions(state, seatId, options).some((legal) => legal.action === action.action)) throw new Error("現在不能執行這個動作。");
    if (action.action === "bid" || action.action === "play_card") {
      if (action.cards.length !== 1 || !legalPlays(state, seatId).some((play) => play.cards[0] === action.cards[0])) throw new Error("請從合法清單選一個叫品或一張牌；出牌必須跟花色。");
    } else if (action.cards.length !== 0) throw new Error("PASS／Double／Redouble 不帶牌。");
    const next = structuredClone(state);
    const events: EngineEvent[] = [];
    if (action.action === "play_card") return applyCard(next, seatId, action.cards[0]!, options);
    const highest = highestCall(state);
    const call = action.action === "bid" ? action.cards[0]! : action.action === "pass" ? "PASS" : action.action === "double" ? "X" : "XX";
    next.bids.push({ seatId, call });
    next.active = otherSeat(state, seatId);
    if (action.action !== "pass") {
      events.push({ kind: action.action, seatId, text: action.action === "bid" ? `{name} 叫 ${call}。` : `{name} ${action.action === "double" ? "Double" : "Redouble"}。` });
    } else if (highest) {
      next.contract = highest;
      next.trump = bidStrain(highest.bid) === "NT" ? null : bidStrain(highest.bid);
      next.phase = "draw";
      next.active = highest.seatId;
      next.trick = { leader: highest.seatId, plays: [] };
      const suffix = highest.doubled === 1 ? "（Double）" : highest.doubled === 2 ? "（Redouble）" : "";
      events.push({ kind: "pass", seatId, text: "{name} PASS。" }, { kind: "contract", seatId: highest.seatId, text: `合約 ${highest.bid}${suffix} 由 {name} 主打。` });
    } else if (next.bids.length === 2) {
      const deck = [...state.hands[state.order[0]]!, ...state.hands[state.order[1]]!, ...state.stock];
      for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      const order: [string, string] = [state.order[1], state.order[0]];
      return { state: dealState(deck, state.order, order), events: [{ kind: "redeal", seatId: order[0], text: "雙方都 PASS，重新發牌，改由 {name} 發牌。" }], result: null };
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
    next.order = [rekey(state.order[0]), rekey(state.order[1])];
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
  view(state): HoneymoonBoard {
    const plays = (value: TrickPlay[]): PublicPlay[] => value.map((play) => ({ seat_id: play.seatId, card: play.card }));
    return { phase: state.phase, dealer_seat_id: state.order[0], contract: state.contract ? { seat_id: state.contract.seatId, bid: state.contract.bid, doubled: state.contract.doubled } : null,
      trump: state.trump, bids: state.bids.map((bid) => ({ seat_id: bid.seatId, call: bid.call })), legal_bids_count: state.phase === "bidding" ? availableBids(state).length : 0,
      stock_count: state.stock.length, stock_top: state.phase === "draw" ? state.stock[0] ?? null : null, draw_round: state.drawRound,
      trick: state.trick ? { leader_seat_id: state.trick.leader, plays: plays(state.trick.plays) } : null, tricks_won: { ...state.tricksWon },
      last_trick: state.lastTrick ? { winner_seat_id: state.lastTrick.winnerSeatId, plays: plays(state.lastTrick.plays), drew_card: state.lastTrick.drewCard } : null,
      seat_status: Object.fromEntries(state.order.map((seat) => [seat, seat === state.active ? "active" : "waiting"])),
      last_round_scores: state.lastRoundScores ? { ...state.lastRoundScores } : null, last_round_detail: state.lastRoundDetail };
  },
  hand: (state, seatId) => state.hands[seatId] ?? [],
  serialize: (state) => state,
  restore: (saved) => structuredClone(saved) as HoneymoonState,
};

function applyCard(state: HoneymoonState, seatId: string, card: string, options: HoneymoonOptions): EngineTransition<HoneymoonState> {
  state.hands[seatId] = state.hands[seatId]!.filter((held) => held !== card);
  state.trick!.plays.push({ seatId, card });
  const events: EngineEvent[] = [{ kind: "card_played", seatId, text: `{name} 出 ${card}。` }];
  const plays = state.trick!.plays;
  if (plays.length === 1) {
    state.active = otherSeat(state, seatId);
    return { state, events, result: null };
  }
  const winner = trickWinner(plays, suitOf(plays[0]!.card), state.trump);
  const loser = otherSeat(state, winner);
  state.lastTrick = { winnerSeatId: winner, plays: [...plays], drewCard: null };
  let leader = winner;
  if (state.phase === "draw") {
    const faceUp = state.stock[0]!;
    state.hands[winner] = sortTrickCards([...state.hands[winner]!, faceUp]);
    state.hands[loser] = sortTrickCards([...state.hands[loser]!, state.stock[1]!]);
    state.stock.splice(0, 2);
    state.drawRound += 1;
    state.lastTrick.drewCard = faceUp;
    events.push({ kind: "draw_won", seatId: winner, text: `{name} 贏得這輪，拿走 ${faceUp}。` });
    if (state.drawRound === 13) {
      state.phase = "play"; leader = loser;
      events.push({ kind: "draw_finished", seatId: loser, text: "換牌結束，由 {name} 先出。" });
    }
  } else {
    state.tricksWon[winner]! += 1;
    const count = Object.values(state.tricksWon).reduce((sum, n) => sum + n, 0);
    events.push({ kind: "trick_won", seatId: winner, text: `{name} 贏得第 ${count} 墩。` });
    if (count === 13) {
      const scored = scoreHoneymoonRound(state.contract!, state.tricksWon, state.order, options);
      const scoringSeat = state.order.find((seat) => scored.scores[seat]! > 0)!;
      state.phase = "ended"; state.active = null;
      state.lastRoundScores = scored.scores; state.lastRoundDetail = scored.detail;
      const verb = options.scoring === "trick_diff" ? "墩數較多" : scored.made ? "成約" : "打垮合約";
      return { state, events, result: { winnerSeatId: scoringSeat, scoreDelta: scored.scores, gameOver: false, text: `{name} ${verb}，得 ${scored.scores[scoringSeat]} 分。` } };
    }
  }
  state.trick = { leader, plays: [] }; state.active = leader;
  return { state, events, result: null };
}
