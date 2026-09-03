import { randomInt } from "node:crypto";

export const CARD_SUITS = Object.freeze(["♣", "♦", "♥", "♠"] as const);
export const CARD_RANKS = Object.freeze(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const);

export interface Card {
  readonly suit: (typeof CARD_SUITS)[number];
  readonly rank: (typeof CARD_RANKS)[number];
  readonly code: string;
}

export function parseCard(value: string): Card {
  const text = String(value).trim();
  const suit = text.slice(0, 1) as Card["suit"];
  const rank = text.slice(1).toUpperCase() as Card["rank"];
  if (!CARD_SUITS.includes(suit) || !CARD_RANKS.includes(rank)) throw new Error(`無效的牌：${text}`);
  return Object.freeze({ suit, rank, code: `${suit}${rank}` });
}

export function createDeck(): Card[] {
  return CARD_SUITS.flatMap((suit) => CARD_RANKS.map((rank) => Object.freeze({ suit, rank, code: `${suit}${rank}` })));
}

export function shuffledDeck(): Card[] {
  const deck = createDeck();
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [deck[index], deck[target]] = [deck[target]!, deck[index]!];
  }
  return deck;
}
