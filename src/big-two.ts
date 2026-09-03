import type { Card } from "./cards.js";

export type BigTwoHandKind = "single" | "pair" | "triple" | "straight" | "flush" | "full_house" | "four_kind" | "straight_flush";

export interface BigTwoPlay {
  readonly cards: Card[];
  readonly kind: BigTwoHandKind;
  readonly score: number[];
}

const RANK_ORDER = Object.freeze(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"]);
const SUIT_ORDER = Object.freeze(["♦", "♣", "♥", "♠"]);
const FIVE_CARD_KIND_ORDER: Readonly<Record<Extract<BigTwoHandKind, "straight" | "flush" | "full_house" | "four_kind" | "straight_flush">, number>> = Object.freeze({
  straight: 0,
  flush: 1,
  full_house: 2,
  four_kind: 3,
  straight_flush: 4,
});

export function compareBigTwoCards(left: Card, right: Card): number {
  return rankValue(left) - rankValue(right) || suitValue(left) - suitValue(right);
}

export function sortBigTwoCards(cards: readonly Card[]): Card[] {
  return cards.slice().sort(compareBigTwoCards);
}

export function classifyBigTwoPlay(cards: readonly Card[]): BigTwoPlay {
  if (![1, 2, 3, 5].includes(cards.length)) throw new Error("大老二一次只能出 1、2、3 或 5 張牌。");
  if (new Set(cards.map((card) => card.code)).size !== cards.length) throw new Error("同一張牌不能重複選取。");
  const sorted = sortBigTwoCards(cards);
  const ranks = groupByRank(sorted);

  if (cards.length === 1) return freezePlay(sorted, "single", [cardValue(sorted[0]!)]);
  if (cards.length === 2) {
    if (ranks.size !== 1) throw new Error("兩張牌必須同點數才能組成一對。");
    return freezePlay(sorted, "pair", [rankValue(sorted[0]!), Math.max(...sorted.map(suitValue))]);
  }
  if (cards.length === 3) {
    if (ranks.size !== 1) throw new Error("三張牌必須同點數才能組成三條。");
    return freezePlay(sorted, "triple", [rankValue(sorted[0]!)]);
  }

  const straightScore = scoreStraight(sorted);
  const flush = new Set(sorted.map((card) => card.suit)).size === 1;
  const groups = [...ranks.entries()].map(([rank, group]) => ({ rank, count: group.length }));
  const triple = groups.find((group) => group.count === 3);
  const quad = groups.find((group) => group.count === 4);
  let kind: BigTwoPlay["kind"];
  let detail: number[];

  if (straightScore && flush) {
    kind = "straight_flush";
    detail = straightScore;
  } else if (quad) {
    kind = "four_kind";
    detail = [RANK_ORDER.indexOf(quad.rank)];
  } else if (triple && groups.some((group) => group.count === 2)) {
    kind = "full_house";
    detail = [RANK_ORDER.indexOf(triple.rank)];
  } else if (flush) {
    kind = "flush";
    detail = sorted.slice().reverse().map(cardValue);
  } else if (straightScore) {
    kind = "straight";
    detail = straightScore;
  } else {
    throw new Error("這五張牌不是順子、同花、葫蘆、鐵支或同花順。");
  }
  return freezePlay(sorted, kind, [FIVE_CARD_KIND_ORDER[kind as keyof typeof FIVE_CARD_KIND_ORDER], ...detail]);
}

export function bigTwoPlayBeats(candidate: BigTwoPlay, current: BigTwoPlay): boolean {
  if (candidate.cards.length !== current.cards.length) return false;
  if (candidate.cards.length < 5 && candidate.kind !== current.kind) return false;
  return compareScores(candidate.score, current.score) > 0;
}

export function bigTwoHandLabel(kind: BigTwoHandKind): string {
  return ({
    single: "單張",
    pair: "一對",
    triple: "三條",
    straight: "順子",
    flush: "同花",
    full_house: "葫蘆",
    four_kind: "鐵支",
    straight_flush: "同花順",
  } as const)[kind];
}

export function lowestBigTwoCard(cards: readonly Card[]): Card {
  const card = sortBigTwoCards(cards)[0];
  if (!card) throw new Error("找不到本局起手牌。");
  return card;
}

function scoreStraight(cards: readonly Card[]): number[] | null {
  const values = [...new Set(cards.map(rankValue))].sort((a, b) => a - b);
  if (values.length !== 5) return null;
  // A-2-3-4-5 是本規則最低順子；2 不得出現在其他順子。
  if (values.join(",") === "0,1,2,11,12") {
    const five = cards.find((card) => card.rank === "5")!;
    return [-1, suitValue(five)];
  }
  if (values.at(-1)! - values[0]! !== 4 || values.at(-1) === 12) return null;
  const highRank = values.at(-1)!;
  const highCard = cards.filter((card) => rankValue(card) === highRank).sort(compareBigTwoCards).at(-1)!;
  return [highRank, suitValue(highCard)];
}

function groupByRank(cards: readonly Card[]): Map<string, Card[]> {
  const groups = new Map<string, Card[]>();
  for (const card of cards) groups.set(card.rank, [...(groups.get(card.rank) ?? []), card]);
  return groups;
}

function compareScores(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function cardValue(card: Card): number {
  return rankValue(card) * 4 + suitValue(card);
}

function rankValue(card: Card): number {
  return RANK_ORDER.indexOf(card.rank);
}

function suitValue(card: Card): number {
  return SUIT_ORDER.indexOf(card.suit);
}

function freezePlay(cards: Card[], kind: BigTwoHandKind, score: number[]): BigTwoPlay {
  return Object.freeze({ cards: Object.freeze(cards.slice()) as unknown as Card[], kind, score: Object.freeze(score.slice()) as unknown as number[] });
}
