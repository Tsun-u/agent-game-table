import type { Card } from "../cards.js";
import {
  baselinePoints,
  buildJianhongdianRules,
  cardPoints,
  DEFAULT_JIANHONGDIAN_OPTIONS,
  formatJianhongdianRules,
  JIANHONGDIAN_LABEL,
  JIANHONGDIAN_OPTION_DESCRIPTIONS,
  JIANHONGDIAN_RULES_VERSION,
  normalizeJianhongdianOptions,
  roundToTenth,
  type JianhongdianOptions,
  type JianhongdianRules,
} from "./jianhongdian-rules.js";
import type { DealInput, EngineEvent, EngineTransition, GameBoardView, GameEngine, GameRules, GameSummary, LegalAction, LegalPlay, SeatAction } from "./types.js";

export interface LastFlip {
  readonly seatId: string;
  readonly card: string;
  /** 翻出的牌收走的桌面牌；配不到是 null。 */
  readonly captured: string | null;
}

export interface JianhongdianState {
  readonly phase: "play" | "ended";
  /** 本局行動順序：order[0] 是首家、最後一位是尾家。 */
  readonly order: readonly string[];
  readonly hands: Readonly<Record<string, readonly string[]>>;
  /** 桌面明牌，依攤出順序。 */
  readonly table: readonly string[];
  /** 牌堆：pile[0] 是下一張要翻的、最後一張是叨牌看得到的。 */
  readonly pile: readonly string[];
  readonly captured: Readonly<Record<string, readonly string[]>>;
  readonly active: string | null;
  readonly lastFlip: LastFlip | null;
  readonly lastRoundScores: Readonly<Record<string, number>> | null;
}

export interface JianhongdianBoard extends GameBoardView {
  readonly phase: JianhongdianState["phase"];
  readonly table: readonly string[];
  readonly pile_count: number;
  readonly captured_points: Readonly<Record<string, readonly string[]>>;
  readonly captured_count: Readonly<Record<string, number>>;
  /** 各家本局到目前為止的實得分（還沒減基準）。 */
  readonly points_so_far: Readonly<Record<string, number>>;
  readonly baseline: number;
  readonly last_flip: { readonly seat_id: string; readonly card: string; readonly captured: string | null } | null;
  /** 只有尾家且本桌開叨牌時有值。 */
  readonly bottom_card: string | null;
  readonly last_seat_id: string | null;
  readonly seat_status: Readonly<Record<string, "waiting" | "active">>;
  readonly last_round_scores: Readonly<Record<string, number>> | null;
}

const TABLE_CARDS = 4;
const PILE_CARDS = 24;
const HAND_SIZE: Readonly<Record<number, number>> = { 2: 12, 3: 8, 4: 6 };
const RANK_ORDER = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_ORDER = ["♣", "♦", "♥", "♠"];

export const jianhongdianEngine: GameEngine<JianhongdianState, JianhongdianOptions> = {
  mode: "jianhongdian",
  label: JIANHONGDIAN_LABEL,
  rulesVersion: JIANHONGDIAN_RULES_VERSION,
  seats: { min: 2, max: 4, fixed: false },
  optionDescriptions: JIANHONGDIAN_OPTION_DESCRIPTIONS,

  normalizeOptions(value: unknown): JianhongdianOptions {
    return normalizeJianhongdianOptions(value);
  },

  buildRules(options: JianhongdianOptions): GameRules {
    return buildJianhongdianRules(options);
  },

  formatRules(rules: GameRules): string {
    return formatJianhongdianRules(rules as JianhongdianRules);
  },

  deal(input: DealInput): EngineTransition<JianhongdianState> {
    const deck = [...input.deck];
    if (deck.length !== 52 || new Set(deck.map((card) => card.code)).size !== 52) throw new Error("撿紅點需要一副完整且不重複的 52 張牌。");
    const seatIds = [...input.seatIds];
    const handSize = HAND_SIZE[seatIds.length];
    if (!handSize) throw new Error("撿紅點需要 2 到 4 位入座的玩家才能開始。");
    const shift = (Math.max(input.round, 1) - 1) % seatIds.length;
    const order = [...seatIds.slice(shift), ...seatIds.slice(0, shift)];
    const hands: Record<string, string[]> = Object.fromEntries(order.map((seatId) => [seatId, []]));
    for (let index = 0; index < handSize; index += 1) for (const seatId of order) hands[seatId]!.push(draw(deck).code);
    for (const seatId of order) hands[seatId] = sortByRank(hands[seatId]!);
    const table = Array.from({ length: TABLE_CARDS }, () => draw(deck).code);
    const pile = deck.map((card) => card.code);
    if (pile.length !== PILE_CARDS) throw new Error("撿紅點的牌堆應該剛好 24 張。");
    const first = order[0]!;
    return {
      state: {
        phase: "play", order, hands, table, pile,
        captured: Object.fromEntries(order.map((seatId) => [seatId, [] as string[]])),
        active: first, lastFlip: null, lastRoundScores: null,
      },
      events: [{ kind: "turn_started", seatId: first, text: `第 ${input.round} 局開始，桌面 ${table.join(" ")}；輪到 {name}。` }],
      result: null,
    };
  },

  pendingSeatIds(state: JianhongdianState): readonly string[] {
    return state.active ? [state.active] : [];
  },

  legalActions(state: JianhongdianState, seatId: string): readonly LegalAction[] {
    return state.phase === "play" && state.active === seatId ? [{ action: "play_card", label: "出牌" }] : [];
  },

  legalPlays(state: JianhongdianState, seatId: string): readonly LegalPlay[] {
    if (state.phase !== "play" || state.active !== seatId) return [];
    const plays: LegalPlay[] = [];
    for (const card of state.hands[seatId] ?? []) {
      plays.push({ action: "play_card", cards: [card], label: "放到桌上" });
      for (const tableCard of state.table) if (pairs(card, tableCard)) plays.push({ action: "play_card", cards: [card, tableCard], label: `配 ${tableCard}` });
    }
    return plays;
  },

  apply(state: JianhongdianState, seatId: string, action: SeatAction, options: JianhongdianOptions): EngineTransition<JianhongdianState> {
    if (!state.order.includes(seatId)) throw new Error("你不在這局裡。");
    if (action.action !== "play_card") throw new Error(`撿紅點沒有「${action.action}」這個動作。`);
    return applyPlay(state, seatId, action.cards, options);
  },

  onSeatRemoved(state: JianhongdianState, seatId: string): EngineTransition<JianhongdianState> | "abort" {
    if (!state.order.includes(seatId)) return { state, events: [], result: null };
    if (state.phase !== "ended") return "abort";
    return { state: { ...state, order: state.order.filter((candidate) => candidate !== seatId), hands: omit(state.hands, seatId), captured: omit(state.captured, seatId) }, events: [], result: null };
  },

  transferSeat(state: JianhongdianState, fromSeatId: string, toSeatId: string): JianhongdianState {
    if (!state.order.includes(fromSeatId)) return state;
    const rekey = (seatId: string | null): string | null => (seatId === fromSeatId ? toSeatId : seatId);
    const rekeyRecord = <T>(record: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(record).map(([seatId, value]) => [rekey(seatId)!, value]));
    return {
      ...state,
      order: state.order.map((seatId) => rekey(seatId)!),
      hands: rekeyRecord(state.hands), captured: rekeyRecord(state.captured),
      active: rekey(state.active),
      lastFlip: state.lastFlip ? { ...state.lastFlip, seatId: rekey(state.lastFlip.seatId)! } : null,
      lastRoundScores: state.lastRoundScores ? rekeyRecord(state.lastRoundScores) : null,
    };
  },

  isGameOver(options: JianhongdianOptions, summary: GameSummary): boolean {
    if (options.end_mode === "rounds") return summary.round >= options.end_rounds;
    return Object.values(summary.scores).some((score) => score >= options.end_score);
  },

  view(state: JianhongdianState, viewerSeatId: string | null, options: JianhongdianOptions): JianhongdianBoard {
    const capturedPoints: Record<string, readonly string[]> = {};
    const capturedCount: Record<string, number> = {};
    const pointsSoFar: Record<string, number> = {};
    const status: Record<string, "waiting" | "active"> = {};
    for (const seatId of state.order) {
      const cards = state.captured[seatId] ?? [];
      capturedPoints[seatId] = cards.filter((card) => cardPoints(card, options) > 0);
      capturedCount[seatId] = cards.length;
      pointsSoFar[seatId] = cards.reduce((sum, card) => sum + cardPoints(card, options), 0);
      status[seatId] = state.active === seatId ? "active" : "waiting";
    }
    const lastSeat = state.order[state.order.length - 1] ?? null;
    const canPeek = options.peek_bottom && viewerSeatId !== null && viewerSeatId === lastSeat && state.pile.length > 0;
    return {
      phase: state.phase, table: state.table, pile_count: state.pile.length,
      captured_points: capturedPoints, captured_count: capturedCount, points_so_far: pointsSoFar,
      baseline: baselinePoints(options, state.order.length),
      last_flip: state.lastFlip ? { seat_id: state.lastFlip.seatId, card: state.lastFlip.card, captured: state.lastFlip.captured } : null,
      bottom_card: canPeek ? state.pile[state.pile.length - 1]! : null,
      last_seat_id: lastSeat, seat_status: status, last_round_scores: state.lastRoundScores,
    };
  },

  hand(state: JianhongdianState, seatId: string): readonly string[] {
    return state.hands[seatId] ?? [];
  },

  serialize(state: JianhongdianState): unknown {
    return state;
  },

  restore(saved: unknown): JianhongdianState {
    const raw = saved as Partial<JianhongdianState>;
    if (!raw || !Array.isArray(raw.order) || typeof raw.hands !== "object") throw new Error("撿紅點局狀態格式無效。");
    return {
      phase: raw.phase === "ended" ? "ended" : "play",
      order: raw.order.map(String),
      hands: raw.hands as Record<string, readonly string[]>,
      table: [...(raw.table ?? [])].map(String),
      pile: [...(raw.pile ?? [])].map(String),
      captured: (raw.captured ?? {}) as Record<string, readonly string[]>,
      active: typeof raw.active === "string" ? raw.active : null,
      lastFlip: raw.lastFlip ? { seatId: String(raw.lastFlip.seatId), card: String(raw.lastFlip.card), captured: raw.lastFlip.captured ?? null } : null,
      lastRoundScores: (raw.lastRoundScores ?? null) as Record<string, number> | null,
    };
  },
};

// ---------- 配對與計分（純函式，獨立匯出方便測） ----------

/** A 到 9 湊十、10/J/Q/K 同點；花色不限。 */
export function pairs(left: string, right: string): boolean {
  const a = pairValue(left);
  const b = pairValue(right);
  if (a === null || b === null) return left.slice(1) === right.slice(1);
  return a + b === 10;
}

function pairValue(card: string): number | null {
  const rank = card.slice(1);
  if (rank === "A") return 1;
  const number = Number(rank);
  return Number.isInteger(number) && number >= 2 && number <= 9 ? number : null;
}

/** 一局各家分數：實得減基準，一位小數。 */
export function scoreJianhongdianRound(captured: Readonly<Record<string, readonly string[]>>, order: readonly string[], options: JianhongdianOptions): Record<string, number> {
  const baseline = baselinePoints(options, order.length);
  const scores: Record<string, number> = {};
  for (const seatId of order) {
    const earned = (captured[seatId] ?? []).reduce((sum, card) => sum + cardPoints(card, options), 0);
    scores[seatId] = roundToTenth(earned - baseline);
  }
  return scores;
}

// ---------- 流程 ----------

function applyPlay(state: JianhongdianState, seatId: string, cards: readonly string[], options: JianhongdianOptions): EngineTransition<JianhongdianState> {
  if (state.phase !== "play" || state.active !== seatId) throw new Error("現在不是你的回合。");
  if (cards.length < 1 || cards.length > 2) throw new Error("一手是一張手牌，或一張手牌加一張要配對的桌面牌。");
  const [handCard, target] = cards as [string, string | undefined];
  if (!(state.hands[seatId] ?? []).includes(handCard)) throw new Error(`你的手牌裡沒有 ${handCard}。`);
  if (target !== undefined) {
    if (!state.table.includes(target)) throw new Error(`桌面上沒有 ${target}。`);
    if (!pairs(handCard, target)) throw new Error(`${handCard} 和 ${target} 配不起來。`);
  }

  const hands = { ...state.hands, [seatId]: (state.hands[seatId] ?? []).filter((card) => card !== handCard) };
  let table = target === undefined ? [...state.table, handCard] : state.table.filter((card) => card !== target);
  let taken = target === undefined ? [] : [handCard, target];
  const playText = target === undefined ? `{name} 把 ${handCard} 放到桌上` : `{name} 用 ${handCard} 收走 ${target}`;

  const pile = [...state.pile];
  const flipped = pile.shift();
  let lastFlip: LastFlip | null = state.lastFlip;
  let flipText = "";
  if (flipped !== undefined) {
    const match = bestMatch(flipped, table, options);
    if (match === null) {
      table = [...table, flipped];
      flipText = `，翻出 ${flipped} 留在桌上`;
    } else {
      table = table.filter((card) => card !== match);
      taken = [...taken, flipped, match];
      flipText = `，翻出 ${flipped} 收走 ${match}`;
    }
    lastFlip = { seatId, card: flipped, captured: match };
  }
  const captured = { ...state.captured, [seatId]: [...(state.captured[seatId] ?? []), ...taken] };
  const played: EngineEvent = { kind: "card_played", seatId, text: `${playText}${flipText}。` };

  const next = nextSeatWithCards(state.order, seatId, hands);
  if (pile.length === 0 && next === null) return settle({ ...state, hands, table, pile, captured, lastFlip, active: null }, options, [played]);
  const active = next ?? seatId;
  return {
    state: { ...state, hands, table, pile, captured, lastFlip, active },
    events: [played, { kind: "turn_started", seatId: active, text: "輪到 {name}。" }],
    result: null,
  };
}

/** 翻出的牌多張可配時收分數最高的桌面牌，同分取先攤的。 */
function bestMatch(flipped: string, table: readonly string[], options: JianhongdianOptions): string | null {
  let best: string | null = null;
  for (const candidate of table) {
    if (!pairs(flipped, candidate)) continue;
    if (best === null || cardPoints(candidate, options) > cardPoints(best, options)) best = candidate;
  }
  return best;
}

function nextSeatWithCards(order: readonly string[], current: string, hands: Readonly<Record<string, readonly string[]>>): string | null {
  const start = order.indexOf(current);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(start + step) % order.length]!;
    if ((hands[candidate] ?? []).length > 0) return candidate;
  }
  return null;
}

function settle(state: JianhongdianState, options: JianhongdianOptions, before: EngineEvent[]): EngineTransition<JianhongdianState> {
  const scores = scoreJianhongdianRound(state.captured, state.order, options);
  const winner = [...state.order].sort((left, right) => scores[right]! - scores[left]!)[0]!;
  return {
    state: { ...state, phase: "ended", active: null, lastRoundScores: scores },
    events: before,
    result: { winnerSeatId: winner, scoreDelta: scores, gameOver: false, text: `第 {round} 局結算，{name} 本局最高（${formatDelta(scores[winner]!)}）。` },
  };
}

function sortByRank(cards: readonly string[]): string[] {
  return [...cards].sort((left, right) => {
    const rankDiff = RANK_ORDER.indexOf(left.slice(1)) - RANK_ORDER.indexOf(right.slice(1));
    return rankDiff !== 0 ? rankDiff : SUIT_ORDER.indexOf(left.slice(0, 1)) - SUIT_ORDER.indexOf(right.slice(0, 1));
  });
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
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
