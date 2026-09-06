import { highCardPoints } from "./lightbridge-rules.js";
import { BIDS, bidRank, bidLevel, bidStrain } from "./honeymoon-rules.js";

export type BiddingSystemKey = "sayc" | "taiwan_5533" | "taiwan_5542";
export const BIDDING_SYSTEMS: readonly { key: BiddingSystemKey; label: string; summary: string }[] = [
  { key: "sayc", label: "SAYC（5533、1NT 15-17）", summary: "五張高花、低花三張以上、2♣ 強牌、弱二" },
  { key: "taiwan_5533", label: "台灣自然制 5533（1NT 16-18）", summary: "1NT 16-18，其餘同 SAYC" },
  { key: "taiwan_5542", label: "台灣自然制 5542（1NT 15-17）", summary: "1♦ 四張以上、1♣ 可能只有兩張，其餘同 SAYC" },
];
export const DEFAULT_BIDDING_SYSTEM: BiddingSystemKey = "sayc";
export function isBiddingSystemKey(value: unknown): value is BiddingSystemKey {
  return BIDDING_SYSTEMS.some(({ key }) => key === value);
}
export interface AuctionCall { seatId: string; call: string }
export interface BidHint { call: string; reason: string }

const SUITS = ["♠", "♥", "♦", "♣"] as const;
type Suit = typeof SUITS[number];
const NAMES: Record<Suit, string> = { "♠": "黑桃", "♥": "紅心", "♦": "方塊", "♣": "梅花" };
const NUMBERS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三"];
const isSuit = (strain: string): strain is Suit => SUITS.some((s) => s === strain);
const major = (s: Suit): boolean => s === "♠" || s === "♥";
const between = (n: number, low: number, high: number): boolean => n >= low && n <= high;

function evaluate(hand: readonly string[]) {
  const hcp = highCardPoints(hand);
  const lengths = Object.fromEntries(SUITS.map((s) => [s, hand.filter((c) => c.startsWith(s)).length])) as Record<Suit, number>;
  const sorted = [...SUITS].sort((a, b) => lengths[b] - lengths[a]);
  const balanced = SUITS.every((s) => lengths[s] >= 2) && SUITS.filter((s) => lengths[s] === 2).length <= 1;
  const cards = (s: Suit) => `${NUMBERS[lengths[s]]}張${NAMES[s]}`;
  const hint = (call: string, why: string): BidHint => ({ call, reason: `${hcp} 點、${why}，建議 ${call}` });
  return { hcp, lengths, sorted, balanced, cards, hint };
}
type Hand = ReturnType<typeof evaluate>;
const lowest = (s: Suit, above: string): string => BIDS.find((b) => bidStrain(b) === s && bidRank(b) > bidRank(above))!;

function opening(system: BiddingSystemKey, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  if (balanced) {
    if (between(p, 25, 27)) return hint("3NT", "平均牌型");
    if (between(p, 20, 21)) return hint("2NT", "平均牌型");
    const low = system === "taiwan_5533" ? 16 : 15;
    if (between(p, low, low + 2)) return hint("1NT", "平均牌型");
  }
  if (p >= 22) return hint("2♣", "22 點以上強牌");
  if (p >= 13 || (p >= 12 && p + n[sorted[0]!] + n[sorted[1]!] >= 20)) {
    const m = sorted.find((s) => major(s) && n[s] >= 5);
    if (m) return hint(`1${m}`, cards(m));
    if (system === "taiwan_5542") {
      const s = n["♦"] >= 4 ? "♦" : "♣";
      return hint(`1${s}`, `${cards(s)}、低花四二制`);
    }
    const s = n["♦"] > n["♣"] || (n["♦"] === n["♣"] && n["♦"] >= 4) ? "♦" : "♣";
    return hint(`1${s}`, `${cards(s)}、低花三張制`);
  }
  const weak = sorted.find((s) => s !== "♣" && n[s] === 6 && SUITS.every((other) => other === s || !major(other) || n[other] < 4));
  if (between(p, 5, 11) && weak) return hint(`2${weak}`, `${cards(weak)}、弱二開叫`);
  if (p <= 10 && n[sorted[0]!] >= 7) return hint(`3${sorted[0]!}`, `${cards(sorted[0]!) }、阻擊開叫`);
  return hint("PASS", "不夠開叫");
}

function response(open: string, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  const s = bidStrain(open);
  if (open === "1NT") {
    const transfer = sorted.find((s) => major(s) && n[s] >= 5);
    if (transfer) return hint(transfer === "♥" ? "2♦" : "2♥", `${cards(transfer)}、Jacoby 轉換`);
    const four = sorted.find((s) => major(s) && n[s] === 4);
    if (p >= 8 && four) return hint("2♣", `${cards(four)}、Stayman 問高花`);
    if (between(p, 16, 17)) return hint("4NT", "邀請滿貫");
    if (between(p, 10, 15)) return hint("3NT", "無王成局");
    if (between(p, 8, 9)) return hint("2NT", "邀請成局");
    return hint("PASS", "未符合無王應叫條件");
  }
  if (open === "2♣") {
    const long = sorted.find((s) => n[s] >= 5);
    if (p >= 8 && long) return hint(`${major(long) ? 2 : 3}${long}`, `${cards(long)}、自然應叫`);
    if (p >= 8 && balanced) return hint("2NT", "平均牌型");
    return hint("2♦", "等待叫品");
  }
  if (bidLevel(open) !== 1 || !isSuit(s)) return null;
  if (major(s)) {
    if (p >= 13 && n[s] >= 4) return hint("2NT", `${cards(s)}支持、Jacoby 2NT`);
    if (n[s] >= 5 && p < 10 && SUITS.some((t) => n[t] <= 1)) return hint(`4${s}`, `${cards(s)}支持且有單張或缺門`);
    if (n[s] >= 3 && between(p, 10, 11)) return hint(`3${s}`, `${cards(s)}支持、限制性加叫`);
    if (n[s] >= 3 && between(p, 6, 10)) return hint(`2${s}`, `${cards(s)}支持`);
    if (s === "♥" && n["♠"] >= 4 && p >= 6) return hint("1♠", cards("♠"));
    if (p >= 10) {
      if (s === "♠" && n["♥"] >= 5) return hint("2♥", cards("♥"));
      const minor = sorted.find((t) => !major(t) && n[t] >= 4);
      if (minor) return hint(`2${minor}`, cards(minor));
    }
    if (between(p, 15, 17) && balanced && n[s] === 2) return hint("3NT", `平均牌型、${cards(s)}支持`);
    if (between(p, 6, 9)) return hint("1NT", `${cards(s)}、未符合加叫或新花條件`);
  } else {
    if (p >= 6) {
      const m = n["♥"] === 4 && n["♠"] === 4 ? "♥" : sorted.find((t) => major(t) && n[t] >= 4);
      if (m) return hint(`1${m}`, cards(m));
      if (s === "♣" && n["♦"] >= 4) return hint("1♦", cards("♦"));
    }
    if (n[s] >= (s === "♦" ? 4 : 5)) {
      if (between(p, 10, 11)) return hint(`3${s}`, `${cards(s)}支持、限制性加叫`);
      if (between(p, 6, 9)) return hint(`2${s}`, `${cards(s)}支持`);
    }
    if (balanced) {
      if (between(p, 16, 18)) return hint("3NT", "平均牌型");
      if (between(p, 13, 15)) return hint("2NT", "平均牌型");
      if (between(p, 6, 9)) return hint("1NT", "平均牌型");
    }
    if (p >= 10 && !major(sorted[0]!)) return hint(`2${sorted[0]!}`, cards(sorted[0]!));
  }
  return hint("PASS", "未符合應叫條件");
}

function weakTwoResponse(open: string, h: Hand): BidHint {
  const { hcp: p, lengths: n, sorted, cards, hint } = h;
  const w = bidStrain(open) as Suit;
  if (n[w] >= 3 && p >= 14) return hint(`${major(w) ? 4 : 5}${w}`, `${cards(w)}支持、直接叫成局`);
  if (n[w] >= 3 && p < 14) return hint(`3${w}`, `${cards(w)}支持、阻擊性加叫`);
  if (p >= 15) return hint("2NT", `${cards(w)}、問特徵，有成局興趣`);
  const long = sorted.find((s) => s !== w && n[s] >= 5);
  if (p >= 14 && long) return hint(lowest(long, open), `${cards(long)}、RONF 逼叫一輪`);
  return hint("PASS", `${cards(w)}、不夠成局，弱二就讓它打`);
}

function doubledOpeningResponse(open: string, h: Hand): BidHint {
  const { hcp: p, lengths: n, cards, hint } = h;
  const s = bidStrain(open) as Suit;
  if (n[s] >= 3 && p >= 10) return hint("2NT", `${cards(s)}支持、限制性加叫或更好`);
  if (n[s] >= 4 && p < 10) return hint(`3${s}`, `${cards(s)}支持、阻擊性加叫`);
  if (n[s] >= 3 && between(p, 6, 9)) return hint(`2${s}`, `${cards(s)}支持`);
  const m = (["♥", "♠"] as const).find((t) => n[t] >= 4 && bidRank(`1${t}`) > bidRank(open));
  if (p >= 6 && m) return hint(`1${m}`, `${cards(m)}、一線高花往上叫`);
  if (p >= 10) return hint("XX", `${cards(s)}、10 點以上沒有配合，Redouble`);
  if (between(p, 6, 9)) return hint("1NT", `${cards(s)}、沒有配合`);
  return hint("PASS", `${cards(s)}、未符合應叫條件`);
}

function takeoutDoubleResponse(open: string, h: Hand): BidHint {
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  const o = bidStrain(open) as Suit;
  if (p >= 12) return hint(`2${o}`, `${cards(o)}、叫對手花色，逼叫成局`);
  if (balanced && n[o] >= 2) {
    if (between(p, 11, 12)) return hint("2NT", `平均牌型、${cards(o)}`);
    if (between(p, 6, 10)) return hint("1NT", `平均牌型、${cards(o)}`);
  }
  const long = sorted.find((s) => s !== o)!;
  const minimum = lowest(long, open);
  if (between(p, 9, 11)) return hint(`${bidLevel(minimum) + 1}${long}`, `${cards(long)}、未叫花色跳一線`);
  return hint(minimum, `${cards(long)}、搭檔 Double 不能 PASS`);
}

function rebid(open: string, reply: string, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  const s = bidStrain(open), t = bidStrain(reply);
  if (bidLevel(open) !== 1 || !isSuit(s)) return null;
  const own = () => {
    if (n[s] >= 6 && between(p, 13, 18)) return hint(`${p <= 15 ? 2 : 3}${s}`, `${cards(s)}、重叫開叫花色`);
    return null;
  };
  const second = (allowReverse: boolean) => {
    const next = sorted.find((u) => u !== s && u !== t && n[u] >= 4 &&
      (bidRank(`1${u}`) < bidRank(open) || (allowReverse && (bidLevel(lowest(u, reply)) === 1 || p >= 16))));
    return next ? hint(lowest(next, reply), `${cards(next)}、第二門花色`) : null;
  };
  if (reply === `2${s}`) {
    if (between(p, 13, 15)) return hint("PASS", `${cards(s)}、最低開叫點力`);
    if (between(p, 16, 18)) return hint(`3${s}`, `${cards(s)}、邀請成局`);
    if (p >= 19) return hint(!major(s) && balanced ? "3NT" : `4${s}`, `${cards(s)}、成局點力`);
    return null;
  }
  if (reply === `3${s}`) return hint(p >= 14 ? (major(s) ? `4${s}` : "3NT") : "PASS", `${cards(s)}、回應限制性加叫`);
  if (reply === "2NT") return hint(`4${s}`, `${cards(s)}、回應 Jacoby 2NT`);
  if (reply === "1NT") {
    const repeat = own();
    if (repeat) return repeat;
    if (p >= 19 && balanced) return hint("3NT", "平均牌型、成局點力");
    return second(false) ?? hint("PASS", `${cards(s)}、未符合再叫條件`);
  }
  if (!isSuit(t) || t === s) return null;
  if (bidLevel(reply) === 1) {
    if (n[t] >= 4 && p >= 13) return hint(`${p <= 15 ? 2 : p <= 18 ? 3 : 4}${t}`, `${cards(t)}支持`);
    if (balanced) {
      if (between(p, 13, 15)) return hint("1NT", "平均牌型");
      if (p >= 19) return hint("2NT", "平均牌型");
    }
    return second(true) ?? own() ?? hint("1NT", "未符合其他再叫條件");
  }
  if (bidLevel(reply) === 2) {
    if (n[t] >= 4 && p >= 13) return hint(`${p <= 15 ? 3 : 4}${t}`, `${cards(t)}支持`);
    if (balanced && between(p, 13, 15)) return hint("2NT", "平均牌型");
    if (n[s] >= 6) return hint(`${between(p, 16, 18) ? 3 : 2}${s}`, `${cards(s)}、重叫開叫花色`);
    return second(false) ?? hint("2NT", "未符合其他再叫條件");
  }
  return null;
}

function overcall(open: string, highest: string, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  const s = bidStrain(open);
  if (bidLevel(open) !== 1 || !isSuit(s)) return null;
  if (between(p, 15, 18) && balanced && n[s] >= 2) return hint("1NT", `平均牌型、${cards(s)}`);
  const weak = sorted.find((t) => t !== s && n[t] === 6);
  if (between(p, 5, 11) && weak) return hint(`${bidLevel(lowest(weak, highest)) + 1}${weak}`, `${cards(weak)}、弱跳蓋叫`);
  if (p >= 12 && n[s] <= 2 && SUITS.every((t) => t === s || n[t] >= 3)) return hint("X", `${cards(s)}、其餘三門至少三張、技術性 Double`);
  const long = sorted.find((t) => t !== s && n[t] >= 5);
  if (long) {
    const level = bidRank(`1${long}`) > bidRank(open) ? 1 : 2;
    if (p >= (level === 1 ? 8 : 10)) return hint(`${level}${long}`, `${cards(long)}、自然爭叫`);
  }
  return hint("PASS", "未符合爭叫條件");
}

export function suggestCall(system: BiddingSystemKey, hand: readonly string[], auction: readonly AuctionCall[], order: readonly string[], viewerSeatId: string): BidHint | null {
  const partner = order[(order.indexOf(viewerSeatId) + 2) % 4]!;
  const rightOpponent = order[(order.indexOf(viewerSeatId) + 3) % 4]!;
  const opponent = (seat: string) => seat !== viewerSeatId && seat !== partner;
  const bids = auction.filter((a) => bidRank(a.call) >= 0);
  const first = bids[0];
  const mine = auction.filter((a) => a.seatId === viewerSeatId);
  const partners = auction.filter((a) => a.seatId === partner);
  const highest = bids.reduce<AuctionCall | undefined>((best, a) => !best || bidRank(a.call) > bidRank(best.call) ? a : best, undefined);
  const h = evaluate(hand);
  const afterOpening = first ? auction.slice(auction.indexOf(first)) : [];
  const rightPassed = afterOpening.at(-1)?.seatId === rightOpponent && afterOpening.at(-1)?.call === "PASS";
  const oneSuitOpening = first && bidLevel(first.call) === 1 && isSuit(bidStrain(first.call));
  let result: BidHint | null = null;
  if (!first) result = opening(system, h);
  else if (first.seatId === partner && mine.length === 0 && partners.length === 1 && afterOpening.length === 2 && rightPassed && ["2♦", "2♥", "2♠"].includes(first.call)) {
    result = weakTwoResponse(first.call, h);
  } else if (first.seatId === partner && oneSuitOpening && mine.length === 0 && auction.length === 2 && auction[1]!.seatId === rightOpponent && auction[1]!.call === "X") {
    result = doubledOpeningResponse(first.call, h);
  } else if (opponent(first.seatId) && oneSuitOpening && mine.length === 0 && afterOpening.length === 3 && partners.length === 1 && afterOpening[1]!.seatId === partner && afterOpening[1]!.call === "X" && rightPassed) {
    result = takeoutDoubleResponse(first.call, h);
  }
  else if (auction.some((a) => a.call === "X" || a.call === "XX")) return null;
  else if (first.seatId === partner && mine.length === 0 && partners.length === 1) result = response(first.call, h);
  else if (first.seatId === viewerSeatId && mine.length === 1 && partners.length === 1 && bidRank(partners[0]!.call) >= 0 && auction.every((a) => !opponent(a.seatId) || a.call === "PASS")) {
    result = rebid(first.call, partners[0]!.call, h);
  } else if (opponent(first.seatId) && mine.length === 0 && partners.every((a) => a.call === "PASS") && bids.length === 1) {
    result = overcall(first.call, highest!.call, h);
  }
  if (!result || result.call === "PASS") return result;
  if (result.call === "X" || result.call === "XX") {
    if (!highest) return null;
    const doubling = auction.slice(auction.indexOf(highest) + 1).filter((a) => a.call === "X" || a.call === "XX").at(-1);
    if (result.call === "X") return opponent(highest.seatId) && !doubling ? result : null;
    return !opponent(highest.seatId) && doubling?.call === "X" && opponent(doubling.seatId) ? result : null;
  }
  return bidRank(result.call) >= 0 && bidRank(result.call) > (highest ? bidRank(highest.call) : -1) ? result : null;
}
