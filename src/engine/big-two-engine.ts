import { parseCard, type Card } from "../cards.js";
import {
  bigTwoHandLabel,
  bigTwoPlayBeats,
  classifyBigTwoPlay,
  DEFAULT_BIG_TWO_RULE_OPTIONS,
  enumerateLegalBigTwoPlays,
  lowestBigTwoCard,
  sortBigTwoCards,
  type BigTwoPlay,
  type BigTwoRuleOptions,
} from "../big-two.js";
import { BIG_TWO_RULES_VERSION, buildBigTwoRules, formatBigTwoRules, type BigTwoRules } from "../big-two-rules.js";
import type { DealInput, EngineEvent, EngineTransition, GameBoardView, GameEngine, GameRules, LegalAction, LegalPlay, SeatAction } from "./types.js";

export type BigTwoSeatStatus = "waiting" | "active" | "passed" | "finished";

/** 大老二一局的完整狀態；牌面一律用字串碼，序列化就是原樣存。 */
export interface BigTwoState {
  readonly phase: "opening" | "trick" | "ended";
  /** 入座順序，輪轉照這個走。 */
  readonly order: readonly string[];
  readonly hands: Readonly<Record<string, readonly string[]>>;
  readonly status: Readonly<Record<string, BigTwoSeatStatus>>;
  readonly currentPlay: readonly string[] | null;
  readonly currentPlaySeatId: string | null;
  readonly openingRequiredCard: string | null;
  readonly setAside: readonly string[];
  readonly active: string | null;
}

export interface BigTwoBoard extends GameBoardView {
  readonly phase: BigTwoState["phase"];
  readonly pile: { readonly cards: readonly string[]; readonly hand_type: string | null; readonly played_by_seat_id: string | null };
  readonly set_aside_cards: readonly string[];
  readonly opening_required_card: string | null;
  readonly hand_counts: Readonly<Record<string, number>>;
  readonly seat_status: Readonly<Record<string, BigTwoSeatStatus>>;
}

const MIN_SEATS = 2;
const MAX_SEATS = 4;

export const bigTwoEngine: GameEngine<BigTwoState, BigTwoRuleOptions> = {
  mode: "bigtwo",
  label: "大老二",
  rulesVersion: BIG_TWO_RULES_VERSION,
  seats: { min: MIN_SEATS, max: MAX_SEATS, fixed: false },
  optionDescriptions: [
    { key: "bombs_beat_anything", label: "鐵支同花順全壓", description: "鐵支與同花順可以壓任何非鐵支／同花順的牌組，不受張數限制。", default: false },
    { key: "five_card_same_kind_only", label: "五張同牌型互壓", description: "順子只能被順子壓、葫蘆只能被葫蘆壓；關閉時高階牌型可壓低階牌型。", default: false },
  ],

  normalizeOptions(value: unknown): BigTwoRuleOptions {
    if (value === undefined || value === null) return DEFAULT_BIG_TWO_RULE_OPTIONS;
    if (typeof value !== "object") throw new Error("options 必須是物件。");
    const raw = value as Record<string, unknown>;
    const read = (key: keyof BigTwoRuleOptions): boolean => {
      const field = raw[key];
      if (field === undefined) return DEFAULT_BIG_TWO_RULE_OPTIONS[key];
      if (typeof field !== "boolean") throw new Error(`options.${key} 必須是 true 或 false。`);
      return field;
    };
    return Object.freeze({ bombs_beat_anything: read("bombs_beat_anything"), five_card_same_kind_only: read("five_card_same_kind_only") });
  },

  buildRules(options: BigTwoRuleOptions): GameRules {
    return buildBigTwoRules(options);
  },

  formatRules(rules: GameRules): string {
    return formatBigTwoRules(rules as unknown as BigTwoRules);
  },

  deal(input: DealInput): EngineTransition<BigTwoState> {
    const deck = [...input.deck];
    if (deck.length !== 52 || new Set(deck.map((card) => card.code)).size !== 52) throw new Error("大老二需要一副完整且不重複的 52 張牌。");
    const seatIds = [...input.seatIds];
    if (seatIds.length < MIN_SEATS || seatIds.length > MAX_SEATS) throw new Error("大老二需要 2 到 4 位入座的玩家才能開始。");
    const cardsPerSeat = seatIds.length === 3 ? 17 : 13;
    const dealt = new Map<string, Card[]>(seatIds.map((seatId) => [seatId, []]));
    for (let index = 0; index < cardsPerSeat; index += 1) for (const seatId of seatIds) dealt.get(seatId)!.push(draw(deck));
    const setAside = seatIds.length === 3 ? [draw(deck).code] : [];
    const hands: Record<string, readonly string[]> = {};
    for (const [seatId, cards] of dealt) hands[seatId] = sortBigTwoCards(cards).map((card) => card.code);
    const openingCard = lowestBigTwoCard([...dealt.values()].flat());
    const leader = seatIds.find((seatId) => hands[seatId]!.includes(openingCard.code))!;
    const status: Record<string, BigTwoSeatStatus> = {};
    for (const seatId of seatIds) status[seatId] = seatId === leader ? "active" : "waiting";
    const state: BigTwoState = {
      phase: "opening", order: seatIds, hands, status, currentPlay: null, currentPlaySeatId: null,
      openingRequiredCard: openingCard.code, setAside, active: leader,
    };
    return { state, events: [turnStarted(leader, openingCard.code)], result: null };
  },

  pendingSeatIds(state: BigTwoState): readonly string[] {
    return state.active ? [state.active] : [];
  },

  legalActions(state: BigTwoState, seatId: string): readonly LegalAction[] {
    if (state.phase === "ended" || state.active !== seatId) return [];
    const actions: LegalAction[] = [{ action: "play_cards", label: "出牌" }];
    if (state.currentPlay && state.currentPlaySeatId !== seatId) actions.push({ action: "pass", label: "PASS" });
    return actions;
  },

  legalPlays(state: BigTwoState, seatId: string, options: BigTwoRuleOptions): readonly LegalPlay[] {
    if (state.phase === "ended" || state.active !== seatId) return [];
    const hand = (state.hands[seatId] ?? []).map(parseCard);
    const current = state.currentPlay ? classifyBigTwoPlay(state.currentPlay.map(parseCard)) : null;
    return enumerateLegalBigTwoPlays(hand, current, state.openingRequiredCard, options).map((play) => ({
      action: "play_cards", cards: play.cards.map((card) => card.code), label: bigTwoHandLabel(play.kind),
    }));
  },

  apply(state: BigTwoState, seatId: string, action: SeatAction, options: BigTwoRuleOptions): EngineTransition<BigTwoState> {
    if (state.phase === "ended" || state.active !== seatId || state.status[seatId] !== "active") throw new Error("現在不是你的回合。");
    if (action.action === "pass") return applyPass(state, seatId);
    if (action.action === "play_cards") return applyPlay(state, seatId, action.cards, options);
    throw new Error(`大老二沒有「${action.action}」這個動作。`);
  },

  /** 局中有人離桌一律流局（童童 2026-09-04 定案）；局已結束就只把座位從狀態裡拿掉。 */
  onSeatRemoved(state: BigTwoState, seatId: string): EngineTransition<BigTwoState> | "abort" {
    if (!state.order.includes(seatId)) return { state, events: [], result: null };
    if (state.phase !== "ended") return "abort";
    return {
      state: { ...state, order: state.order.filter((candidate) => candidate !== seatId), hands: omit(state.hands, seatId), status: omit(state.status, seatId) },
      events: [], result: null,
    };
  },

  view(state: BigTwoState, _viewerSeatId: string | null): BigTwoBoard {
    const handCounts: Record<string, number> = {};
    for (const seatId of state.order) handCounts[seatId] = state.hands[seatId]?.length ?? 0;
    return {
      phase: state.phase,
      pile: {
        cards: state.currentPlay ?? [],
        hand_type: state.currentPlay ? bigTwoHandLabel(classifyBigTwoPlay(state.currentPlay.map(parseCard)).kind) : null,
        played_by_seat_id: state.currentPlaySeatId,
      },
      set_aside_cards: state.setAside,
      opening_required_card: state.openingRequiredCard,
      hand_counts: handCounts,
      seat_status: state.status,
    };
  },

  hand(state: BigTwoState, seatId: string): readonly string[] {
    return state.hands[seatId] ?? [];
  },

  serialize(state: BigTwoState): unknown {
    return state;
  },

  restore(saved: unknown): BigTwoState {
    const raw = saved as Partial<BigTwoState>;
    if (!raw || !Array.isArray(raw.order) || typeof raw.hands !== "object") throw new Error("大老二局狀態格式無效。");
    return {
      phase: raw.phase === "opening" || raw.phase === "trick" || raw.phase === "ended" ? raw.phase : "trick",
      order: raw.order.map(String),
      hands: raw.hands as Record<string, readonly string[]>,
      status: (raw.status ?? {}) as Record<string, BigTwoSeatStatus>,
      currentPlay: Array.isArray(raw.currentPlay) ? raw.currentPlay.map(String) : null,
      currentPlaySeatId: typeof raw.currentPlaySeatId === "string" ? raw.currentPlaySeatId : null,
      openingRequiredCard: typeof raw.openingRequiredCard === "string" ? raw.openingRequiredCard : null,
      setAside: Array.isArray(raw.setAside) ? raw.setAside.map(String) : [],
      active: typeof raw.active === "string" ? raw.active : null,
    };
  },
};

/** 輸家以剩牌張數計分；每留一張 2 加倍一次。 */
export function bigTwoStake(remaining: readonly string[]): number {
  const twos = remaining.filter((code) => parseCard(code).rank === "2").length;
  return remaining.length * 2 ** twos;
}

function applyPass(state: BigTwoState, seatId: string): EngineTransition<BigTwoState> {
  if (!state.currentPlay || state.currentPlaySeatId === seatId) throw new Error("目前由你領出新墩，不能 pass。");
  const next: BigTwoState = { ...state, status: { ...state.status, [seatId]: "passed" } };
  const passed: EngineEvent = { kind: "player_passed", seatId, text: "{name} pass。" };
  const advanced = advance(next, state.order.indexOf(seatId), state.order);
  return { ...advanced, events: [passed, ...advanced.events] };
}

function applyPlay(state: BigTwoState, seatId: string, cardCodes: readonly string[], options: BigTwoRuleOptions): EngineTransition<BigTwoState> {
  if (!cardCodes.length) throw new Error("請至少選一張牌。");
  if (new Set(cardCodes).size !== cardCodes.length) throw new Error("同一張牌不能重複選取。");
  const hand = state.hands[seatId] ?? [];
  for (const code of cardCodes) if (!hand.includes(code)) throw new Error(`你的手牌裡沒有 ${code}。`);
  const play = classifyBigTwoPlay(cardCodes.map(parseCard));
  if (state.openingRequiredCard && !cardCodes.includes(state.openingRequiredCard)) throw new Error(`本局第一手必須包含 ${state.openingRequiredCard}。`);
  const current = state.currentPlay ? classifyBigTwoPlay(state.currentPlay.map(parseCard)) : null;
  if (current && !bigTwoPlayBeats(play, current, options)) throw new Error(`這手 ${bigTwoHandLabel(play.kind)} 沒有大過桌面上的 ${bigTwoHandLabel(current.kind)}。`);
  const remaining = hand.filter((code) => !cardCodes.includes(code));
  const finished = remaining.length === 0;
  const played: EngineEvent = { kind: "cards_played", seatId, text: `{name} 出了 ${bigTwoHandLabel(play.kind)}：${play.cards.map((card) => card.code).join(" ")}。` };
  const next: BigTwoState = {
    ...state, phase: "trick",
    hands: { ...state.hands, [seatId]: remaining },
    status: { ...state.status, [seatId]: finished ? "finished" : "waiting" },
    currentPlay: play.cards.map((card) => card.code), currentPlaySeatId: seatId, openingRequiredCard: null,
  };
  if (finished) return settle(next, seatId, played);
  const advanced = advance(next, state.order.indexOf(seatId), state.order);
  return { ...advanced, events: [played, ...advanced.events] };
}

/** currentIndex 是 order 裡的索引；回傳下一位可行動者，輪回領牌者時收墩重新領牌。 */
function advance(state: BigTwoState, currentIndex: number, order: readonly string[]): EngineTransition<BigTwoState> {
  let next: string | null = null;
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[((currentIndex + offset) % order.length + order.length) % order.length]!;
    const status = state.status[candidate];
    if (status === "finished" || status === "passed") continue;
    next = candidate;
    break;
  }
  if (!next) throw new Error("找不到下一位可行動玩家。");
  const events: EngineEvent[] = [];
  let result = state;
  if (state.currentPlaySeatId === next) {
    result = clearPasses({ ...result, currentPlay: null, currentPlaySeatId: null });
    events.push({ kind: "trick_started", seatId: next, text: "{name} 收下這墩，重新領牌。" });
  }
  result = { ...result, status: { ...result.status, [next]: "active" }, active: next };
  events.push({ kind: "turn_started", seatId: next, text: "輪到 {name}。" });
  return { state: result, events, result: null };
}

function clearPasses(state: BigTwoState): BigTwoState {
  const status: Record<string, BigTwoSeatStatus> = {};
  for (const [seatId, value] of Object.entries(state.status)) status[seatId] = value === "finished" ? "finished" : "waiting";
  return { ...state, status };
}

function settle(state: BigTwoState, winner: string, played: EngineEvent): EngineTransition<BigTwoState> {
  const scoreDelta: Record<string, number> = {};
  let winnings = 0;
  const status: Record<string, BigTwoSeatStatus> = {};
  for (const seatId of state.order) {
    status[seatId] = "finished";
    if (seatId === winner) continue;
    const stake = bigTwoStake(state.hands[seatId] ?? []);
    scoreDelta[seatId] = -stake;
    winnings += stake;
  }
  scoreDelta[winner] = winnings;
  return {
    state: { ...state, phase: "ended", status, active: null },
    events: [played],
    result: { winnerSeatId: winner, scoreDelta, gameOver: false, text: "{name} 出完手牌，贏得第 {round} 局。" },
  };
}

function turnStarted(seatId: string, openingCard: string): EngineEvent {
  return { kind: "turn_started", seatId, text: `輪到 {name}；首手必須包含 ${openingCard}。` };
}

function draw(deck: Card[]): Card {
  const card = deck.shift();
  if (!card) throw new Error("牌堆已空，無法繼續這局。");
  return card;
}

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy: Record<string, T> = { ...record };
  delete copy[key];
  return copy;
}

export type { BigTwoPlay };
