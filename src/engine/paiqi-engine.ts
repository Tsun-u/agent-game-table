import { randomInt } from "node:crypto";
import { CARD_SUITS } from "../cards.js";
import {
  buildPaiqiRules, formatPaiqiRules, normalizePaiqiOptions, PAIQI_JOKERS, PAIQI_LABEL,
  PAIQI_OPTION_DESCRIPTIONS, PAIQI_RANKS, PAIQI_RULES_VERSION, scorePaiqiRound,
  type PaiqiOptions, type PaiqiRules,
} from "./paiqi-rules.js";
import type { EngineEvent, EngineTransition, GameBoardView, GameEngine, LegalPlay } from "./types.js";

export interface PaiqiState {
  readonly phase: "play" | "ended";
  readonly order: readonly string[];
  readonly hands: Readonly<Record<string, readonly string[]>>;
  readonly placed: Readonly<Record<string, "card" | "joker">>;
  readonly pool: readonly string[];
  readonly leftover: readonly string[];
  readonly covered: Readonly<Record<string, readonly string[]>>;
  readonly active: string | null;
  readonly lastPlay: { readonly seatId: string; readonly card: string; readonly as: string | null; readonly covered: boolean } | null;
  readonly lastRoundPoints: Readonly<Record<string, number>> | null;
  readonly lastRoundScores: Readonly<Record<string, number>> | null;
}

export interface PaiqiBoard extends GameBoardView {
  readonly phase: PaiqiState["phase"];
  readonly placed: PaiqiState["placed"];
  readonly pool: readonly string[];
  readonly leftover_count: number;
  readonly covered_count: Readonly<Record<string, number>>;
  readonly covered_cards: PaiqiState["covered"] | null;
  readonly last_play: { readonly seat_id: string; readonly card: string | null; readonly as: string | null; readonly covered: boolean } | null;
  readonly seat_status: Readonly<Record<string, "waiting" | "active">>;
  readonly last_round_points: PaiqiState["lastRoundPoints"];
  readonly last_round_scores: PaiqiState["lastRoundScores"];
}

const POSITIONS = CARD_SUITS.flatMap((suit) => PAIQI_RANKS.map((rank) => `${suit}${rank}`));
const isJoker = (card: string): boolean => PAIQI_JOKERS.some((joker) => joker === card);

export function placeable(state: PaiqiState, card: string): boolean {
  if (!POSITIONS.includes(card)) return false;
  if (state.placed[card]) return state.placed[card] === "joker";
  const suit = card.slice(0, 1);
  const rank = PAIQI_RANKS.indexOf(card.slice(1) as typeof PAIQI_RANKS[number]);
  return rank === 6
    || (rank > 0 && !!state.placed[`${suit}${PAIQI_RANKS[rank - 1]}`])
    || (rank < 12 && !!state.placed[`${suit}${PAIQI_RANKS[rank + 1]}`]);
}

function legalPlays(state: PaiqiState, seatId: string): LegalPlay[] {
  if (state.phase !== "play" || state.active !== seatId) return [];
  const hand = state.hands[seatId] ?? [];
  if (!state.placed["♠7"]) return hand.includes("♠7") ? [{ action: "play_card", cards: ["♠7"], label: "首出 ♠7" }] : [];
  const plays: LegalPlay[] = [];
  for (const card of hand) {
    if (isJoker(card)) {
      for (const target of POSITIONS) {
        if (!state.placed[target] && placeable(state, target)) plays.push({ action: "play_card", cards: [card, target], label: `鬼牌當 ${target}` });
      }
    } else if (placeable(state, card)) plays.push({ action: "play_card", cards: [card], label: `出 ${card}` });
  }
  return plays.length ? plays : hand.map((card) => ({ action: "cover_card", cards: [card], label: `蓋 ${card}` }));
}

export const paiqiEngine: GameEngine<PaiqiState, PaiqiOptions> = {
  mode: "paiqi", label: PAIQI_LABEL, rulesVersion: PAIQI_RULES_VERSION,
  seats: { min: 2, max: 6, fixed: false }, optionDescriptions: PAIQI_OPTION_DESCRIPTIONS,
  normalizeOptions: normalizePaiqiOptions,
  buildRules: buildPaiqiRules,
  formatRules: (rules) => formatPaiqiRules(rules as PaiqiRules),

  deal(input, options) {
    const seatIds = [...input.seatIds];
    if (seatIds.length < 2 || seatIds.length > 6) throw new Error("排七需要 2 到 6 位入座的玩家才能開始。");
    const deck = input.deck.map((card) => card.code);
    if (seatIds.length === 6) for (const joker of PAIQI_JOKERS) deck.splice(randomInt(deck.length + 1), 0, joker);
    const dealt = Math.floor(deck.length / seatIds.length) * seatIds.length;
    const seven = deck.indexOf("♠7");
    if (seven >= dealt) [deck[0], deck[seven]] = [deck[seven]!, deck[0]!];
    const hands: Record<string, string[]> = Object.fromEntries(seatIds.map((seat) => [seat, []]));
    for (let i = 0; i < dealt; i += 1) hands[seatIds[i % seatIds.length]!]!.push(deck[i]!);
    const first = seatIds.findIndex((seat) => hands[seat]!.includes("♠7"));
    const order = [...seatIds.slice(first), ...seatIds.slice(0, first)];
    return {
      state: {
        phase: "play", order, hands, placed: {},
        pool: options.leftover_mode === "open_pool" ? deck.slice(dealt) : [],
        leftover: options.leftover_mode === "deal_after_seven" ? deck.slice(dealt) : [],
        covered: Object.fromEntries(order.map((seat) => [seat, []])), active: order[0]!,
        lastPlay: null, lastRoundPoints: null, lastRoundScores: null,
      },
      events: [{ kind: "turn_started", seatId: order[0]!, text: `第 ${input.round} 局開始，輪到 {name} 首出 ♠7。` }], result: null,
    };
  },

  pendingSeatIds: (state) => state.phase === "play" && state.active ? [state.active] : [],
  legalPlays,
  legalActions(state, seatId) {
    const play = legalPlays(state, seatId)[0];
    return play ? [{ action: play.action, label: play.action === "cover_card" ? "蓋牌" : "出牌" }] : [];
  },

  apply(state, seatId, action) {
    if (!state.order.includes(seatId)) throw new Error("你不在這局裡。");
    if (state.phase !== "play" || state.active !== seatId) throw new Error("現在不是你的回合。");
    if (action.action !== "play_card" && action.action !== "cover_card") throw new Error(`排七沒有「${action.action}」這個動作。`);
    const legal = legalPlays(state, seatId);
    if (!legal.some((play) => play.action === action.action && play.cards.length === action.cards.length && play.cards.every((card, i) => card === action.cards[i]))) {
      throw new Error(action.action === "cover_card" ? "有牌可出時不能蓋牌，請從合法蓋牌清單選一張手牌。" : "這組牌不能出，請從合法出牌清單選擇。");
    }
    const card = action.cards[0]!;
    const covered = action.action === "cover_card";
    const target = !covered && isJoker(card) ? action.cards[1]! : null;
    const hands: Record<string, readonly string[]> = { ...state.hands, [seatId]: state.hands[seatId]!.filter((held) => held !== card) };
    const placed = { ...state.placed };
    const covers = { ...state.covered };
    if (covered) covers[seatId] = [...(covers[seatId] ?? []), card];
    else placed[target ?? card] = target ? "joker" : "card";
    const events: EngineEvent[] = [{ kind: covered ? "card_covered" : "card_played", seatId, text: covered ? "{name} 蓋了一張牌。" : target ? `{name} 用鬼牌當 ${target}。` : `{name} 出 ${card}。` }];
    let leftover = [...state.leftover];
    if (!state.placed["♠7"] && !covered) {
      leftover.forEach((extra, i) => {
        const seat = state.order[i % state.order.length]!;
        hands[seat] = [...hands[seat]!, extra];
      });
      leftover = [];
    }
    const pool = [...state.pool];
    let index: number;
    while ((index = pool.findIndex((extra) => placeable({ ...state, placed }, extra))) !== -1) {
      const extra = pool.splice(index, 1)[0]!;
      placed[extra] = "card";
      events.push({ kind: "card_played", seatId: null, text: `公共區的 ${extra} 接上了。` });
    }
    let active: string | null = null;
    for (let step = 1; step <= state.order.length; step += 1) {
      const next = state.order[(state.order.indexOf(seatId) + step) % state.order.length]!;
      if (hands[next]!.length) { active = next; break; }
    }
    const next: PaiqiState = { ...state, hands, placed, pool, leftover, covered: covers, active, lastPlay: { seatId, card, as: target, covered } };
    if (active === null) return settle(next, events);
    return { state: next, events: [...events, { kind: "turn_started", seatId: active, text: "輪到 {name}。" }], result: null };
  },

  onSeatRemoved(state, seatId) {
    if (!state.order.includes(seatId)) return { state, events: [], result: null };
    if (state.phase === "play") return "abort";
    return { state: { ...state, order: state.order.filter((seat) => seat !== seatId), hands: omit(state.hands, seatId), covered: omit(state.covered, seatId) }, events: [], result: null };
  },

  transferSeat(state, fromSeatId, toSeatId) {
    if (!state.order.includes(fromSeatId)) return state;
    const rekey = (seat: string | null): string | null => seat === fromSeatId ? toSeatId : seat;
    const rekeyRecord = <T>(record: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(record).map(([seat, value]) => [rekey(seat)!, value]));
    return {
      ...state, order: state.order.map((seat) => rekey(seat)!), hands: rekeyRecord(state.hands), covered: rekeyRecord(state.covered), active: rekey(state.active),
      lastPlay: state.lastPlay ? { ...state.lastPlay, seatId: rekey(state.lastPlay.seatId)! } : null,
      lastRoundPoints: state.lastRoundPoints ? rekeyRecord(state.lastRoundPoints) : null,
      lastRoundScores: state.lastRoundScores ? rekeyRecord(state.lastRoundScores) : null,
    };
  },

  isGameOver(options, summary) {
    return options.end_mode === "rounds" ? summary.round >= options.end_rounds : Object.values(summary.scores).some((score) => score <= -options.end_score);
  },

  view(state): PaiqiBoard {
    return {
      phase: state.phase, placed: state.placed, pool: state.pool, leftover_count: state.leftover.length,
      covered_count: Object.fromEntries(state.order.map((seat) => [seat, state.covered[seat]?.length ?? 0])),
      covered_cards: state.phase === "ended" ? state.covered : null,
      last_play: state.lastPlay ? { seat_id: state.lastPlay.seatId, card: state.lastPlay.covered ? null : state.lastPlay.card, as: state.lastPlay.as, covered: state.lastPlay.covered } : null,
      seat_status: Object.fromEntries(state.order.map((seat) => [seat, state.active === seat ? "active" : "waiting"])),
      last_round_points: state.lastRoundPoints, last_round_scores: state.lastRoundScores,
    };
  },
  hand: (state, seatId) => state.hands[seatId] ?? [],
  serialize: (state) => state,
  restore(saved) {
    const raw = saved as Partial<PaiqiState>;
    if (!raw || !Array.isArray(raw.order) || !raw.hands) throw new Error("排七局狀態格式無效。");
    return {
      phase: raw.phase === "ended" ? "ended" : "play", order: [...raw.order], hands: raw.hands,
      placed: { ...raw.placed }, pool: [...(raw.pool ?? [])], leftover: [...(raw.leftover ?? [])], covered: raw.covered ?? {},
      active: raw.active ?? null, lastPlay: raw.lastPlay ?? null, lastRoundPoints: raw.lastRoundPoints ?? null, lastRoundScores: raw.lastRoundScores ?? null,
    };
  },
};

function settle(state: PaiqiState, events: EngineEvent[]): EngineTransition<PaiqiState> {
  const result = scorePaiqiRound(state.covered, state.order);
  return {
    state: { ...state, phase: "ended", active: null, lastRoundPoints: result.points, lastRoundScores: result.scores }, events,
    result: { winnerSeatId: result.winnerSeatId, scoreDelta: result.scores, gameOver: false, text: "本局結束，{name} 蓋牌最少。" },
  };
}

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}
