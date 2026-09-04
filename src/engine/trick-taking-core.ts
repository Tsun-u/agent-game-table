import { parseCard } from "../cards.js";

/** 吃墩類遊戲的點數順序：2 最小、A 最大（大老二的順序不適用）。 */
export const TRICK_RANK_ORDER = Object.freeze(["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const);

export interface TrickPlay {
  readonly seatId: string;
  readonly card: string;
}

export function suitOf(code: string): string {
  return parseCard(code).suit;
}

export function rankValue(code: string): number {
  const value = TRICK_RANK_ORDER.indexOf(parseCard(code).rank as (typeof TRICK_RANK_ORDER)[number]);
  if (value < 0) throw new Error(`不認得的牌面：${code}`);
  return value;
}

/** 有跟必跟：手上有首出花色就只能出那個花色，沒有才能墊任何牌。 */
export function legalFollows(hand: readonly string[], leadSuit: string): string[] {
  const following = hand.filter((code) => suitOf(code) === leadSuit);
  return following.length ? following : [...hand];
}

/** 同花色比大小；有王牌時王牌壓所有非王牌。回傳贏家席位。 */
export function trickWinner(plays: readonly TrickPlay[], leadSuit: string, trump: string | null = null): string {
  if (!plays.length) throw new Error("這墩還沒有人出牌。");
  let best = plays[0]!;
  for (const play of plays.slice(1)) {
    if (beats(play.card, best.card, leadSuit, trump)) best = play;
  }
  return best.seatId;
}

function beats(candidate: string, current: string, leadSuit: string, trump: string | null): boolean {
  const candidateSuit = suitOf(candidate);
  const currentSuit = suitOf(current);
  if (trump && candidateSuit === trump && currentSuit !== trump) return true;
  if (trump && currentSuit === trump && candidateSuit !== trump) return false;
  if (candidateSuit !== currentSuit) return candidateSuit === leadSuit && currentSuit !== leadSuit;
  return rankValue(candidate) > rankValue(current);
}

/** 依花色（♣ ♦ ♥ ♠）再依點數排序，給手牌顯示用。 */
export function sortTrickCards(cards: readonly string[]): string[] {
  const suits = ["♣", "♦", "♥", "♠"];
  return [...cards].sort((left, right) => suits.indexOf(suitOf(left)) - suits.indexOf(suitOf(right)) || rankValue(left) - rankValue(right));
}
