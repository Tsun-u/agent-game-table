import type { Card } from "../cards.js";
import {
  buildGongzhuRules,
  DEFAULT_GONGZHU_OPTIONS,
  DEFAULT_HEARTS_OPTIONS,
  formatGongzhuRules,
  GONGZHU_OPTION_DESCRIPTIONS,
  GONGZHU_RULES_VERSION,
  HEARTS_OPTION_DESCRIPTIONS,
  HEARTS_RULES_VERSION,
  normalizeGongzhuOptions,
  type GongzhuOptions,
  type GongzhuRules,
  type GongzhuVariant,
} from "./gongzhu-rules.js";
import { legalFollows, sortTrickCards, suitOf, trickWinner, type TrickPlay } from "./trick-taking-core.js";
import type { DealInput, EngineEvent, EngineTransition, GameBoardView, GameEngine, GameRules, GameSummary, LegalAction, LegalPlay, SeatAction } from "./types.js";

export type PassDirection = "left" | "right" | "across" | "none";
export type GongzhuSeatStatus = "waiting" | "active" | "sent";

export interface GongzhuState {
  readonly phase: "passing" | "trick" | "ended";
  readonly variant: GongzhuVariant;
  readonly order: readonly string[];
  readonly hands: Readonly<Record<string, readonly string[]>>;
  readonly captured: Readonly<Record<string, readonly string[]>>;
  readonly trick: { readonly leader: string | null; readonly plays: readonly TrickPlay[] };
  readonly tricksPlayed: number;
  readonly heartsBroken: boolean;
  readonly passDirection: PassDirection;
  readonly pendingPasses: Readonly<Record<string, readonly string[]>>;
  readonly active: string | null;
  /** 上一局各家的分數變化，給桌面顯示。 */
  readonly lastRoundScores: Readonly<Record<string, number>> | null;
}

export interface GongzhuBoard extends GameBoardView {
  readonly phase: GongzhuState["phase"];
  readonly variant: GongzhuVariant;
  readonly trick: { readonly leader: string | null; readonly plays: readonly TrickPlay[] };
  readonly captured_points: Readonly<Record<string, readonly string[]>>;
  readonly hearts_broken: boolean;
  readonly pass_direction: PassDirection;
  /** 傳牌階段每一席要傳給誰（席位 id）；不傳的局是空物件。 */
  readonly pass_targets: Readonly<Record<string, string>>;
  readonly passed: Readonly<Record<string, boolean>>;
  readonly tricks_played: number;
  readonly seat_status: Readonly<Record<string, GongzhuSeatStatus>>;
  readonly last_round_scores: Readonly<Record<string, number>> | null;
}

const SEATS = 4;
const PIG = "♠Q";
const SHEEP = "♦J";
const TRANSFORMER = "♣10";
const OPENING_CARD = "♣2";
const PASS_ROTATION: readonly PassDirection[] = ["left", "right", "across", "none"];

export function createGongzhuEngine(variant: GongzhuVariant): GameEngine<GongzhuState, GongzhuOptions> {
  const isHearts = variant === "hearts";
  return {
    mode: variant,
    label: isHearts ? "傷心小棧" : "拱豬",
    rulesVersion: isHearts ? HEARTS_RULES_VERSION : GONGZHU_RULES_VERSION,
    seats: { min: SEATS, max: SEATS, fixed: true },
    optionDescriptions: isHearts ? HEARTS_OPTION_DESCRIPTIONS : GONGZHU_OPTION_DESCRIPTIONS,

    normalizeOptions(value: unknown): GongzhuOptions {
      return normalizeGongzhuOptions(value, variant);
    },

    buildRules(options: GongzhuOptions): GameRules {
      return buildGongzhuRules(options, variant);
    },

    formatRules(rules: GameRules): string {
      return formatGongzhuRules(rules as GongzhuRules);
    },

    deal(input: DealInput): EngineTransition<GongzhuState> {
      const deck = [...input.deck];
      if (deck.length !== 52 || new Set(deck.map((card) => card.code)).size !== 52) throw new Error(`${isHearts ? "傷心小棧" : "拱豬"}需要一副完整且不重複的 52 張牌。`);
      const seatIds = [...input.seatIds];
      if (seatIds.length !== SEATS) throw new Error(`${isHearts ? "傷心小棧" : "拱豬"}需要剛好 4 位入座的玩家才能開始。`);
      const hands: Record<string, string[]> = Object.fromEntries(seatIds.map((seatId) => [seatId, []]));
      for (let index = 0; index < 13; index += 1) for (const seatId of seatIds) hands[seatId]!.push(draw(deck).code);
      for (const seatId of seatIds) hands[seatId] = sortTrickCards(hands[seatId]!);
      const captured = Object.fromEntries(seatIds.map((seatId) => [seatId, [] as string[]]));
      const passDirection = isHearts ? PASS_ROTATION[(input.round - 1) % PASS_ROTATION.length]! : "none";
      const base: GongzhuState = {
        phase: "passing", variant, order: seatIds, hands, captured,
        trick: { leader: null, plays: [] }, tricksPlayed: 0, heartsBroken: false,
        passDirection, pendingPasses: {}, active: null, lastRoundScores: null,
      };
      if (passDirection === "none") return startTricks(base, []);
      return { state: base, events: [{ kind: "passing_started", seatId: null, text: `第 ${input.round} 局先傳牌：每人選 3 張傳給${directionLabel(passDirection)}。` }], result: null };
    },

    pendingSeatIds(state: GongzhuState): readonly string[] {
      if (state.phase === "passing") return state.order.filter((seatId) => !(seatId in state.pendingPasses));
      return state.active ? [state.active] : [];
    },

    legalActions(state: GongzhuState, seatId: string): readonly LegalAction[] {
      if (state.phase === "passing") return seatId in state.pendingPasses || !state.order.includes(seatId) ? [] : [{ action: "pass_cards", label: "傳 3 張" }];
      if (state.phase === "trick" && state.active === seatId) return [{ action: "play_card", label: "出牌" }];
      return [];
    },

    legalPlays(state: GongzhuState, seatId: string, options: GongzhuOptions): readonly LegalPlay[] {
      if (state.phase === "passing") {
        if (seatId in state.pendingPasses || !state.order.includes(seatId)) return [];
        return (state.hands[seatId] ?? []).map((card) => ({ action: "pass_cards", cards: [card], label: "可傳" }));
      }
      if (state.phase !== "trick" || state.active !== seatId) return [];
      return legalCards(state, seatId, options).map((card) => ({ action: "play_card", cards: [card], label: "可出" }));
    },

    apply(state: GongzhuState, seatId: string, action: SeatAction, options: GongzhuOptions): EngineTransition<GongzhuState> {
      if (!state.order.includes(seatId)) throw new Error("你不在這局裡。");
      if (action.action === "pass_cards") return applyPass(state, seatId, action.cards);
      if (action.action === "play_card") return applyPlay(state, seatId, action.cards, options);
      throw new Error(`${isHearts ? "傷心小棧" : "拱豬"}沒有「${action.action}」這個動作。`);
    },

    /** 四人固定，局中有人離桌一律流局；局已結束就從狀態拿掉。 */
    onSeatRemoved(state: GongzhuState, seatId: string): EngineTransition<GongzhuState> | "abort" {
      if (!state.order.includes(seatId)) return { state, events: [], result: null };
      if (state.phase !== "ended") return "abort";
      return { state: { ...state, order: state.order.filter((candidate) => candidate !== seatId), hands: omit(state.hands, seatId), captured: omit(state.captured, seatId) }, events: [], result: null };
    },

    transferSeat(state: GongzhuState, fromSeatId: string, toSeatId: string): GongzhuState {
      if (!state.order.includes(fromSeatId)) return state;
      const rekey = (seatId: string | null): string | null => (seatId === fromSeatId ? toSeatId : seatId);
      const rekeyRecord = <T>(record: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(record).map(([seatId, value]) => [rekey(seatId)!, value]));
      return {
        ...state,
        order: state.order.map((seatId) => rekey(seatId)!),
        hands: rekeyRecord(state.hands), captured: rekeyRecord(state.captured), pendingPasses: rekeyRecord(state.pendingPasses),
        trick: { leader: rekey(state.trick.leader), plays: state.trick.plays.map((play) => ({ ...play, seatId: rekey(play.seatId)! })) },
        active: rekey(state.active),
        lastRoundScores: state.lastRoundScores ? rekeyRecord(state.lastRoundScores) : null,
      };
    },

    isGameOver(options: GongzhuOptions, summary: GameSummary): boolean {
      if (options.end_mode === "rounds") return summary.round >= options.end_rounds;
      return Object.values(summary.scores).some((score) => score <= options.end_score);
    },

    view(state: GongzhuState): GongzhuBoard {
      const status: Record<string, GongzhuSeatStatus> = {};
      const passed: Record<string, boolean> = {};
      const capturedPoints: Record<string, readonly string[]> = {};
      for (const seatId of state.order) {
        passed[seatId] = seatId in state.pendingPasses;
        status[seatId] = state.phase === "passing" ? (passed[seatId] ? "sent" : "active") : state.active === seatId ? "active" : "waiting";
        capturedPoints[seatId] = (state.captured[seatId] ?? []).filter((card) => isPointCard(card, state.variant));
      }
      const passTargets: Record<string, string> = {};
      if (state.passDirection !== "none") {
        for (const [index, seatId] of state.order.entries()) passTargets[seatId] = state.order[(index + passOffset(state.passDirection)) % state.order.length]!;
      }
      return {
        phase: state.phase, variant: state.variant, trick: state.trick, captured_points: capturedPoints,
        hearts_broken: state.heartsBroken, pass_direction: state.passDirection, pass_targets: passTargets, passed, tricks_played: state.tricksPlayed,
        seat_status: status, last_round_scores: state.lastRoundScores,
      };
    },

    hand(state: GongzhuState, seatId: string): readonly string[] {
      return state.hands[seatId] ?? [];
    },

    serialize(state: GongzhuState): unknown {
      return state;
    },

    restore(saved: unknown): GongzhuState {
      const raw = saved as Partial<GongzhuState>;
      if (!raw || !Array.isArray(raw.order) || typeof raw.hands !== "object") throw new Error("拱豬局狀態格式無效。");
      return {
        phase: raw.phase === "passing" || raw.phase === "trick" || raw.phase === "ended" ? raw.phase : "trick",
        variant: raw.variant === "hearts" ? "hearts" : "gongzhu",
        order: raw.order.map(String),
        hands: raw.hands as Record<string, readonly string[]>,
        captured: (raw.captured ?? {}) as Record<string, readonly string[]>,
        trick: raw.trick ? { leader: raw.trick.leader ?? null, plays: [...(raw.trick.plays ?? [])] } : { leader: null, plays: [] },
        tricksPlayed: Number(raw.tricksPlayed ?? 0), heartsBroken: Boolean(raw.heartsBroken),
        passDirection: raw.passDirection ?? "none", pendingPasses: (raw.pendingPasses ?? {}) as Record<string, readonly string[]>,
        active: typeof raw.active === "string" ? raw.active : null,
        lastRoundScores: (raw.lastRoundScores ?? null) as Record<string, number> | null,
      };
    },
  };
}

export const gongzhuEngine = createGongzhuEngine("gongzhu");
export const heartsEngine = createGongzhuEngine("hearts");

// ---------- 計分（純函式，獨立匯出方便測） ----------

export function heartValue(card: string, options: Pick<GongzhuOptions, "hearts_low_zero">): number {
  if (suitOf(card) !== "♥") return 0;
  const rank = card.slice(1);
  const face: Record<string, number> = { A: 50, K: 40, Q: 30, J: 20 };
  if (rank in face) return -face[rank]!;
  const number = Number(rank);
  if (options.hearts_low_zero) return number >= 5 ? -10 : 0;
  return rank === "4" ? -10 : -number;
}

/** 拱豬一局的各家分數：先紅心（含全紅）＋豬＋羊，再套變壓器，最後大滿貫與對家合併。 */
export function scoreGongzhuRound(captured: Readonly<Record<string, readonly string[]>>, order: readonly string[], options: GongzhuOptions): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const seatId of order) {
    const cards = captured[seatId] ?? [];
    const hearts = cards.filter((card) => suitOf(card) === "♥");
    const allHearts = hearts.length === 13;
    const heartTotal = hearts.reduce((sum, card) => sum + heartValue(card, options), 0);
    const heartScore = allHearts ? Math.abs(heartTotal) : heartTotal;
    const hasPig = cards.includes(PIG);
    const hasSheep = cards.includes(SHEEP);
    const hasTransformer = cards.includes(TRANSFORMER);
    const pointCards = cards.filter((card) => isPointCard(card, "gongzhu"));
    if (options.grand_slam && pointCards.length === 16) {
      scores[seatId] = 800;
      continue;
    }
    let base = heartScore + (hasPig ? -100 : 0) + (hasSheep ? 100 : 0);
    if (hasTransformer) {
      const others = pointCards.length - 1;
      base = others === 0 ? (options.transformer_alone_bonus ? 50 : 0) : base * 2;
    }
    scores[seatId] = base;
  }
  if (options.partnership && order.length === 4) {
    for (const pair of [[order[0]!, order[2]!], [order[1]!, order[3]!]]) {
      const total = scores[pair[0]!]! + scores[pair[1]!]!;
      scores[pair[0]!] = total;
      scores[pair[1]!] = total;
    }
  }
  return scores;
}

/** 傷心小棧：每張紅心 -1、♠Q -13；射月者 0 分、其他三家各 -26。 */
export function scoreHeartsRound(captured: Readonly<Record<string, readonly string[]>>, order: readonly string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const seatId of order) {
    const cards = captured[seatId] ?? [];
    const hearts = cards.filter((card) => suitOf(card) === "♥").length;
    const pig = cards.includes(PIG) ? 13 : 0;
    if (hearts === 13 && pig) {
      for (const other of order) scores[other] = other === seatId ? 0 : -26;
      return scores;
    }
    scores[seatId] = hearts + pig === 0 ? 0 : -(hearts + pig);
  }
  return scores;
}

export function isPointCard(card: string, variant: GongzhuVariant): boolean {
  if (suitOf(card) === "♥") return true;
  if (card === PIG) return true;
  return variant === "gongzhu" && (card === SHEEP || card === TRANSFORMER);
}

// ---------- 流程 ----------

function legalCards(state: GongzhuState, seatId: string, options: GongzhuOptions): string[] {
  const hand = state.hands[seatId] ?? [];
  const firstTrick = state.tricksPlayed === 0;
  if (!state.trick.plays.length) {
    if (firstTrick && hand.includes(OPENING_CARD)) return [OPENING_CARD];
    const breakRule = state.variant === "hearts" || options.heart_break_lead;
    if (breakRule && !state.heartsBroken) {
      const nonHearts = hand.filter((card) => suitOf(card) !== "♥");
      if (nonHearts.length) return nonHearts;
    }
    return [...hand];
  }
  const leadSuit = suitOf(state.trick.plays[0]!.card);
  let candidates = legalFollows(hand, leadSuit);
  if (firstTrick && state.variant === "hearts") {
    const safe = candidates.filter((card) => !isPointCard(card, "hearts"));
    if (safe.length) candidates = safe;
  }
  return candidates;
}

function applyPass(state: GongzhuState, seatId: string, cards: readonly string[]): EngineTransition<GongzhuState> {
  if (state.phase !== "passing") throw new Error("現在不是傳牌階段。");
  if (seatId in state.pendingPasses) throw new Error("你已經傳過牌了。");
  if (cards.length !== 3 || new Set(cards).size !== 3) throw new Error("傳牌要剛好選 3 張不同的牌。");
  const hand = state.hands[seatId] ?? [];
  for (const card of cards) if (!hand.includes(card)) throw new Error(`你的手牌裡沒有 ${card}。`);
  const pendingPasses = { ...state.pendingPasses, [seatId]: [...cards] };
  const passed: EngineEvent = { kind: "cards_passed", seatId, text: "{name} 傳了三張牌。" };
  if (Object.keys(pendingPasses).length < state.order.length) return { state: { ...state, pendingPasses }, events: [passed], result: null };
  const hands: Record<string, string[]> = {};
  for (const owner of state.order) hands[owner] = (state.hands[owner] ?? []).filter((card) => !pendingPasses[owner]!.includes(card));
  for (const [index, giver] of state.order.entries()) {
    const receiver = state.order[(index + passOffset(state.passDirection)) % state.order.length]!;
    hands[receiver]!.push(...pendingPasses[giver]!);
  }
  for (const owner of state.order) hands[owner] = sortTrickCards(hands[owner]!);
  return startTricks({ ...state, hands, pendingPasses }, [passed, { kind: "passing_finished", seatId: null, text: "傳牌完成。" }]);
}

function startTricks(state: GongzhuState, before: EngineEvent[]): EngineTransition<GongzhuState> {
  const leader = state.order.find((seatId) => state.hands[seatId]?.includes(OPENING_CARD));
  if (!leader) throw new Error("找不到持 ♣2 的玩家。");
  return {
    state: { ...state, phase: "trick", trick: { leader, plays: [] }, active: leader },
    events: [...before, { kind: "turn_started", seatId: leader, text: `輪到 {name}；第一墩必須出 ${OPENING_CARD}。` }],
    result: null,
  };
}

function applyPlay(state: GongzhuState, seatId: string, cards: readonly string[], options: GongzhuOptions): EngineTransition<GongzhuState> {
  if (state.phase !== "trick" || state.active !== seatId) throw new Error("現在不是你的回合。");
  if (cards.length !== 1) throw new Error("一次只能出一張牌。");
  const card = cards[0]!;
  if (!(state.hands[seatId] ?? []).includes(card)) throw new Error(`你的手牌裡沒有 ${card}。`);
  const legal = legalCards(state, seatId, options);
  if (!legal.includes(card)) throw new Error(`現在不能出 ${card}：${explainIllegal(state, card)}`);
  const hands = { ...state.hands, [seatId]: (state.hands[seatId] ?? []).filter((held) => held !== card) };
  const plays = [...state.trick.plays, { seatId, card }];
  const heartsBroken = state.heartsBroken || suitOf(card) === "♥";
  const played: EngineEvent = { kind: "card_played", seatId, text: `{name} 出 ${card}。` };
  if (plays.length < state.order.length) {
    const next = state.order[(state.order.indexOf(seatId) + 1) % state.order.length]!;
    return {
      state: { ...state, hands, heartsBroken, trick: { ...state.trick, plays }, active: next },
      events: [played, { kind: "turn_started", seatId: next, text: "輪到 {name}。" }], result: null,
    };
  }
  const leadSuit = suitOf(plays[0]!.card);
  const winner = trickWinner(plays, leadSuit);
  const captured = { ...state.captured, [winner]: [...(state.captured[winner] ?? []), ...plays.map((play) => play.card)] };
  const tricksPlayed = state.tricksPlayed + 1;
  const won: EngineEvent = { kind: "trick_won", seatId: winner, text: `{name} 收下這墩（${plays.map((play) => play.card).join(" ")}）。` };
  if (tricksPlayed === 13) return settle({ ...state, hands, heartsBroken, captured, tricksPlayed, trick: { leader: winner, plays }, active: null }, options, [played, won]);
  return {
    state: { ...state, hands, heartsBroken, captured, tricksPlayed, trick: { leader: winner, plays: [] }, active: winner },
    events: [played, won, { kind: "turn_started", seatId: winner, text: "輪到 {name} 首出。" }], result: null,
  };
}

function settle(state: GongzhuState, options: GongzhuOptions, before: EngineEvent[]): EngineTransition<GongzhuState> {
  const scores = state.variant === "hearts" ? scoreHeartsRound(state.captured, state.order) : scoreGongzhuRound(state.captured, state.order, options);
  const winner = [...state.order].sort((left, right) => scores[right]! - scores[left]!)[0]!;
  return {
    state: { ...state, phase: "ended", active: null, lastRoundScores: scores },
    events: before,
    result: { winnerSeatId: winner, scoreDelta: scores, gameOver: false, text: `第 {round} 局結算，{name} 本局最高（${formatDelta(scores[winner]!)}）。` },
  };
}

function explainIllegal(state: GongzhuState, card: string): string {
  if (!state.trick.plays.length) {
    if (state.tricksPlayed === 0) return `第一墩必須出 ${OPENING_CARD}。`;
    return "紅心還沒破牌，不能用紅心首出。";
  }
  const leadSuit = suitOf(state.trick.plays[0]!.card);
  if (suitOf(card) !== leadSuit) return `手上還有 ${leadSuit}，必須跟花色。`;
  return "第一墩不能出分數牌。";
}

function passOffset(direction: PassDirection): number {
  return { left: 1, right: 3, across: 2, none: 0 }[direction];
}

function directionLabel(direction: PassDirection): string {
  return { left: "左家", right: "右家", across: "對家", none: "不傳" }[direction];
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
