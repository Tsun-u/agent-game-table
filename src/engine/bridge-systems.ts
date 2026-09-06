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

// First and second batches: null here means the situation needs a later group.
function existingCall(system: BiddingSystemKey, hand: readonly string[], auction: readonly AuctionCall[], order: readonly string[], viewerSeatId: string): BidHint | null {
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
  return result;
}

// Third batch: fixed responses and rebids.
const nextBid = (strain: string, above: string): string | undefined => BIDS.find((b) => bidStrain(b) === strain && bidRank(b) > bidRank(above));
const suitBid = (call: string): boolean => bidRank(call) >= 0 && isSuit(bidStrain(call));
const weakOpening = (call: string): boolean => ["2♦", "2♥", "2♠"].includes(call);

function highNtResponse(open: string, h: Hand): BidHint {
  const { hcp: p, lengths: n, sorted, cards, hint } = h;
  const level = bidLevel(open) + 1;
  const long = sorted.find((s) => major(s) && n[s] >= 5);
  if (long) return hint(`${level}${long === "♥" ? "♦" : "♥"}`, `${cards(long)}、Jacoby 轉換`);
  const four = sorted.find((s) => major(s) && n[s] === 4);
  if (four && (open === "3NT" || p >= 4)) return hint(`${level}♣`, `${cards(four)}、Stayman 問高花`);
  if (open === "2NT" && p >= 4) return hint("3NT", "有成局點力");
  return hint("PASS", "守住無王合約");
}

function preemptResponse(open: string, h: Hand): BidHint {
  const { hcp: p, lengths: n, balanced, cards, hint } = h;
  const s = bidStrain(open) as Suit;
  if (n[s] >= 2 && p >= 15) return hint(`${major(s) ? 4 : 5}${s}`, `${cards(s)}支持、叫成局`);
  if (p >= 16 && balanced && SUITS.every((t) => t === s || n[t] >= 2)) return hint("3NT", "平均牌型、其餘三門至少兩張");
  return hint("PASS", `${cards(s)}、阻擊開叫，沒有成局點力就讓它打`);
}

function overcallResponse(open: string, over: string, h: Hand): BidHint {
  if (over === "1NT") return response("1NT", h)!;
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  const o = bidStrain(open) as Suit, v = bidStrain(over) as Suit;
  if (n[v] >= 3 && p >= 10) return hint(`2${o}`, `${cards(v)}支持、叫對手花色，問蓋叫品質`);
  if (n[v] >= 3 && between(p, 6, 9)) return hint(lowest(v, over), `${cards(v)}支持、加叫一級`);
  if (between(p, 8, 11) && balanced && n[o] >= 2) return hint(nextBid("NT", over)!, `平均牌型、${cards(o)}`);
  const long = sorted.find((s) => s !== o && s !== v && n[s] >= 5);
  if (p >= 8 && long) return hint(lowest(long, over), `${cards(long)}、叫新花色`);
  return hint("PASS", "未符合蓋叫應叫條件");
}

function ntOvercall(h: Hand): BidHint {
  const { hcp: p, lengths: n, sorted, cards, hint } = h;
  if (p >= 16) return hint("X", "16 點以上、懲罰性 Double");
  const long = sorted.find((s) => n[s] >= 6);
  if (long && p >= 8) return hint(`2${long}`, `${cards(long)}、自然爭叫`);
  const fives = SUITS.filter((s) => n[s] >= 5);
  if (fives.length >= 2 && p >= 10) return hint(`2${fives[0]!}`, `${cards(fives[0]!)}、${cards(fives[1]!)}雙套`);
  return hint("PASS", "未符合對無王爭叫條件");
}

function ntRebid(reply: string, system: BiddingSystemKey, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, cards, hint } = h;
  const maximum = p === (system === "taiwan_5533" ? 18 : 17);
  if (reply === "2♣") {
    if (n["♥"] >= 4) return hint("2♥", `${cards("♥")}、回答 Stayman`);
    if (n["♠"] >= 4) return hint("2♠", `${cards("♠")}、回答 Stayman`);
    return hint("2♦", "沒有四張高花、回答 Stayman");
  }
  if (reply === "2♦" || reply === "2♥") {
    const s = reply === "2♦" ? "♥" : "♠";
    return hint(`${n[s] >= 4 && maximum ? 3 : 2}${s}`, `${cards(s)}、接受轉換`);
  }
  if (["2NT", "3♣", "3♦"].includes(reply)) return hint(maximum ? "3NT" : "PASS", `${maximum ? "最高" : "未達最高"}無王開叫點力、回應邀請`);
  if (["3NT", "4♥", "4♠"].includes(reply)) return hint("PASS", "搭檔已叫成局");
  if (reply === "4NT") return hint(maximum ? "6NT" : "PASS", `${maximum ? "最高" : "未達最高"}無王開叫點力、回應滿貫邀請`);
  return null;
}

function strongClubRebid(reply: string, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, balanced, sorted, cards, hint } = h;
  if (reply === "2♦") {
    if (balanced && between(p, 22, 24)) return hint("2NT", "平均牌型、回應等待叫品");
    if (balanced && between(p, 25, 27)) return hint("3NT", "平均牌型、回應等待叫品");
    const long = sorted.find((s) => n[s] >= 5);
    return long ? hint(lowest(long, reply), `${cards(long)}、自然再叫`) : null;
  }
  if (!suitBid(reply)) return null;
  const t = bidStrain(reply) as Suit;
  if (n[t] >= 3) return hint(lowest(t, reply), `${cards(t)}支持、加叫一級`);
  if (balanced) return hint(nextBid("NT", reply)!, "平均牌型、最低無王再叫");
  return hint(lowest(sorted[0]!, reply), `${cards(sorted[0]!)}、最長花色再叫`);
}

function weakRebid(open: string, reply: string, hand: readonly string[], h: Hand): BidHint | null {
  const { hcp: p, lengths: n, sorted, cards, hint } = h;
  const w = bidStrain(open) as Suit;
  if (reply === "2NT") {
    if (between(p, 5, 8)) return hint(`3${w}`, `${cards(w)}、最低弱二，重叫`);
    if (between(p, 9, 11)) {
      const feature = sorted.find((s) => s !== w && (hand.includes(`${s}A`) || hand.includes(`${s}K`)));
      return feature ? hint(`3${feature}`, `${cards(feature)}帶 A 或 K、示特徵`) : hint("3NT", "沒有其他花色的 A 或 K 特徵");
    }
    return null;
  }
  if (reply === `3${w}` || reply === `4${w}`) return hint("PASS", `${cards(w)}、搭檔已加叫`);
  if (!suitBid(reply) || bidStrain(reply) === w) return null;
  const t = bidStrain(reply) as Suit;
  return n[t] >= 3 ? hint(lowest(t, reply), `${cards(t)}支持、加叫一級`) : hint(`3${w}`, `${cards(w)}、不支持新花，重叫弱二花色`);
}

function responderRebid(open: string, own: string, again: string, h: Hand): BidHint | null {
  const { hcp: p, lengths: n, balanced, cards, hint } = h;
  const s = bidStrain(open) as Suit, t = bidStrain(own);
  if (isSuit(t) && t !== s && again === `2${t}`) {
    if (p >= 10 && (major(t) || balanced)) return hint(major(t) ? `4${t}` : "3NT", `${cards(t)}配合、叫成局`);
    if (between(p, 8, 9)) return hint(`3${t}`, `${cards(t)}配合、邀請成局`);
    // The plan gives no 10+ unbalanced minor-suit game choice.
    return p >= 10 ? null : hint("PASS", `${cards(t)}配合、未達邀請點力`);
  }
  if (again === "1NT") {
    if (isSuit(t) && major(t) && n[t] >= 5 && p >= 10) return hint(`${p >= 12 ? 4 : 3}${t}`, `${cards(t)}、回應無王再叫`);
    if (balanced && between(p, 11, 12)) return hint("2NT", "平均牌型、邀請成局");
    if (balanced && p >= 13) return hint("3NT", "平均牌型、叫成局");
    if (isSuit(t) && between(p, 6, 9) && n[t] >= 6) return hint(`2${t}`, `${cards(t)}、重叫自己的花色`);
    return hint("PASS", "未符合無王再叫後的續叫條件");
  }
  if (again === `2${s}`) {
    if (n[s] >= 2 && p >= 11) return hint(major(s) ? `4${s}` : "3NT", `${cards(s)}支持、叫成局`);
    if (between(p, 9, 10)) return hint(`3${s}`, `${cards(s)}、邀請成局`);
    return hint("PASS", `${cards(s)}、未符合續叫條件`);
  }
  if (isSuit(t) && t !== s && again === `3${t}`) return hint(p >= 8 ? (major(t) ? `4${t}` : "3NT") : "PASS", `${cards(t)}支持、回應跳加叫`);
  return null;
}

function auctionView(auction: readonly AuctionCall[], order: readonly string[], viewer: string) {
  const partner = order[(order.indexOf(viewer) + 2) % 4]!;
  const right = order[(order.indexOf(viewer) + 3) % 4]!;
  const ours = (a: AuctionCall) => a.seatId === viewer || a.seatId === partner;
  const bids = auction.filter((a) => bidRank(a.call) >= 0);
  const first = bids[0];
  const mine = auction.filter((a) => a.seatId === viewer);
  const partners = auction.filter((a) => a.seatId === partner);
  const ourBids = bids.filter(ours), theirBids = bids.filter((a) => !ours(a));
  const highest = bids.at(-1);
  return { auction, viewer, partner, right, ours, bids, first, mine, partners, ourBids, theirBids, highest };
}
type Auction = ReturnType<typeof auctionView>;

function fixedCall(system: BiddingSystemKey, hand: readonly string[], a: Auction, h: Hand): BidHint | null {
  const { auction, first, viewer, partner, right, mine, partners, bids, ours } = a;
  if (!first) return null;
  const tail = auction.slice(auction.indexOf(first));
  const rightPass = tail.at(-1)?.seatId === right && tail.at(-1)?.call === "PASS";
  if (mine.length === 0 && first.seatId === partner && partners.length === 1 && tail.length === 2 && rightPass) {
    if (["2NT", "3NT"].includes(first.call)) return highNtResponse(first.call, h);
    if (suitBid(first.call) && bidLevel(first.call) === 3) return preemptResponse(first.call, h);
  }
  if (mine.length === 0 && !ours(first) && bidLevel(first.call) === 1 && suitBid(first.call) && tail.length === 3 && partners.length === 1 && tail[1]!.seatId === partner && rightPass) {
    const over = tail[1]!.call;
    if (over === "1NT" || (suitBid(over) && bidLevel(over) <= 2)) return overcallResponse(first.call, over, h);
  }
  if (mine.length === 0 && first.seatId === right && first.call === "1NT" && bids.length === 1 && partners.every((c) => c.call === "PASS") && tail.length === 1) return ntOvercall(h);
  if (first.seatId === viewer && mine.length === 1 && partners.length === 1 && tail.length === 4 && tail[2]!.seatId === partner && rightPass) {
    const reply = partners[0]!.call;
    if (first.call === "1NT") return ntRebid(reply, system, h);
    if (first.call === "2♣") return strongClubRebid(reply, h);
    if (weakOpening(first.call)) return weakRebid(first.call, reply, hand, h);
  }
  if (first.seatId === partner && suitBid(first.call) && bidLevel(first.call) === 1 && mine.length === 1 && bidRank(mine[0]!.call) >= 0 && partners.length === 2 && auction.every((c) => ours(c) || c.call === "PASS") && rightPass) {
    return responderRebid(first.call, mine[0]!.call, partners[1]!.call, h);
  }
  return null;
}

// General rounds: infer only the point floors and suit promises in the plan.
function openingMinimum(call: string, system: BiddingSystemKey): number {
  if (suitBid(call) && bidLevel(call) === 1) return 12;
  if (call === "1NT") return system === "taiwan_5533" ? 16 : 15;
  if (call === "2♣") return 22;
  if (call === "2NT") return 20;
  if (call === "3NT") return 25;
  if (weakOpening(call) || (suitBid(call) && bidLevel(call) === 3)) return 5;
  return 0;
}

function partnerMinimum(a: Auction, system: BiddingSystemKey): number {
  const { first, auction, partner, viewer } = a;
  if (!first) return 0;
  let minimum = 0;
  for (const c of a.partners) {
    const before = auction.slice(0, auction.indexOf(c));
    const previous = before.filter((b) => bidRank(b.call) >= 0);
    const ownPrevious = previous.filter((b) => b.seatId === partner);
    const teammate = previous.filter((b) => b.seatId === viewer).at(-1);
    const opponents = previous.filter((b) => !a.ours(b));
    let estimate = 0;
    if (c === first) estimate = openingMinimum(c.call, system);
    else if (c.call === "X" && opponents.some((b) => bidLevel(b.call) === 1 && suitBid(b.call))) estimate = 12;
    else if (bidRank(c.call) >= 0) {
      const strain = bidStrain(c.call), level = bidLevel(c.call);
      const top = previous.at(-1)!;
      const jump = level > bidLevel(nextBid(strain, top.call)!);
      if (ownPrevious.length === 0 && !a.ours(first) && !teammate) {
        if (c.call === "1NT") estimate = 15;
        else if (suitBid(c.call) && level <= 2) estimate = level === 1 ? 8 : 10;
      } else if (ownPrevious.length === 0 && teammate && (
        (/^(1|2|3)NT$/.test(teammate.call) && level === bidLevel(teammate.call) + 1 && ["♣", "♦", "♥"].includes(strain)) ||
        (teammate.call === "2♣" && c.call === "2♦")
      )) estimate = 0; // Asking, transferring and waiting are not natural new-suit responses.
      else if (opponents.some((b) => bidStrain(b.call) === strain) && suitBid(c.call)) estimate = 10;
      else if (teammate && suitBid(c.call) && strain === bidStrain(teammate.call) && level > bidLevel(teammate.call)) {
        if (!a.ours(first) && level === bidLevel(teammate.call) + 1) estimate = 6;
        else if (first.seatId === viewer && ownPrevious.length === 0 && bidLevel(first.call) === 1) estimate = level === 2 ? 6 : level === 3 ? 10 : jump ? 10 : 0;
        else if (jump) estimate = first.seatId === partner ? 16 : 10;
      } else if (first.seatId === viewer && ownPrevious.length === 0) {
        if (first.call === "1NT" && c.call === "2NT") estimate = 8;
        else if (first.call === "1NT" && c.call === "3NT") estimate = 10;
        else if (suitBid(first.call) && bidLevel(first.call) === 1 && major(bidStrain(first.call) as Suit) && c.call === "2NT") estimate = 13;
        else if (jump) estimate = 10;
        else if (suitBid(c.call)) estimate = level === 1 ? 6 : level === 2 ? 10 : 0;
      } else if (jump) estimate = first.seatId === partner ? 16 : 10;
    }
    minimum = Math.max(minimum, estimate);
  }
  return minimum;
}

interface SuitCall { entry: AuctionCall; suit: Suit; promise: number }
function naturalSuitCalls(a: Auction, seat: string): SuitCall[] {
  const result: SuitCall[] = [];
  for (const entry of a.bids.filter((b) => b.seatId === seat)) {
    const raw = bidStrain(entry.call);
    if (!isSuit(raw)) continue;
    const before = a.bids.slice(0, a.bids.indexOf(entry));
    const ownBefore = before.filter((b) => b.seatId === seat);
    const teammate = before.filter((b) => a.ours(b) && b.seatId !== seat).at(-1);
    if (entry === a.first && entry.call === "2♣") continue;
    if (ownBefore.length === 0 && teammate && /^(1|2|3)NT$/.test(teammate.call)) {
      const level = bidLevel(teammate.call) + 1;
      if (entry.call === `${level}♣`) continue;
      if (entry.call === `${level}♦` || entry.call === `${level}♥`) {
        result.push({ entry, suit: raw === "♦" ? "♥" : "♠", promise: 5 });
        continue;
      }
    }
    if (ownBefore.length === 0 && teammate?.call === "2♣" && entry.call === "2♦") continue;
    let promise = 4;
    if (entry === a.first) {
      if (weakOpening(entry.call)) promise = 6;
      else if ((bidLevel(entry.call) === 1 && major(raw)) || bidLevel(entry.call) === 3) promise = 5;
    } else if (ownBefore.length === 0 && !a.ours(a.first!) && !teammate && bidLevel(entry.call) <= 2) promise = 5;
    if (teammate && bidStrain(teammate.call) === raw && bidLevel(entry.call) > bidLevel(teammate.call)) promise = 3;
    result.push({ entry, suit: raw, promise });
  }
  return result;
}

function agreedSuit(a: Auction, h: Hand): Suit | null {
  const mine = naturalSuitCalls(a, a.viewer), partners = naturalSuitCalls(a, a.partner);
  const shared = a.bids.map((b) => [...mine, ...partners].find((s) => s.entry === b)).find((s) => s && mine.some((m) => m.suit === s.suit) && partners.some((p) => p.suit === s.suit));
  if (shared) return shared.suit;
  const first = partners[0];
  if (first && first.promise >= 5 && h.lengths[first.suit] >= 3) return first.suit;
  if (mine[0] && partners.some((p) => p.suit === mine[0]!.suit && p.promise === 3)) return mine[0].suit;
  if (first && first.entry === a.first && bidLevel(first.entry.call) === 1 && !major(first.suit) && h.lengths[first.suit] >= 5) return first.suit;
  return null;
}

function generalRound(a: Auction, system: BiddingSystemKey, h: Hand): BidHint {
  const { lengths: n, balanced, sorted, cards, hint } = h;
  const combined = h.hcp + partnerMinimum(a, system), agreed = agreedSuit(a, h);
  const ourHighest = a.ourBids.at(-1), theirHighest = a.theirBids.at(-1), highest = a.highest;
  const pass = () => hint("PASS", `合計約 ${combined} 點、已足夠，守住目前合約`);
  if (ourHighest) {
    const s = bidStrain(ourHighest.call), level = bidLevel(ourHighest.call);
    if (level >= (s === "NT" ? 3 : s === "♥" || s === "♠" ? 4 : 5)) return hint("PASS", `合計約 ${combined} 點、已經成局，守住`);
  }
  const game = (call: string) => hint(call, `合計約 ${combined} 點、${agreed ? cards(agreed) + "配合" : "平均牌型且對手花色至少兩張"}，叫成局`);
  if (agreed && major(agreed) && combined >= 25) return highest && bidRank(`4${agreed}`) <= bidRank(highest.call) ? pass() : game(`4${agreed}`);
  if (agreed && !major(agreed) && combined >= 28) return game(`5${agreed}`);
  if (agreed && !major(agreed) && combined >= 25 && balanced) return game("3NT");
  if (!agreed && combined >= 25 && balanced && a.theirBids.every((b) => !isSuit(bidStrain(b.call)) || n[bidStrain(b.call) as Suit] >= 2)) return game("3NT");
  if (highest && between(combined, 23, 24) && agreed && major(agreed) && bidRank(`3${agreed}`) > bidRank(highest.call) && !a.mine.some((c) => c.call === `3${agreed}`)) return hint(`3${agreed}`, `合計約 ${combined} 點、${cards(agreed)}配合，邀請成局`);
  const theirs = highest && highest === theirHighest;
  if (theirs && agreed) {
    const partnerSuits = naturalSuitCalls(a, a.partner).filter((s) => s.suit === agreed);
    const promise = partnerSuits.find((s) => s.promise === 3)?.promise ?? partnerSuits[0]?.promise ?? 4;
    const count = n[agreed] + promise, next = nextBid(agreed, highest.call);
    if (next && count >= bidLevel(next) + 6) return hint(next, `${cards(agreed)}、競叫，我方合計約 ${count} 張`);
    return pass();
  }
  if (theirs && !agreed && combined >= 20) {
    const long = sorted.find((s) => n[s] >= 6 && nextBid(s, highest.call) && bidLevel(nextBid(s, highest.call)!) <= 3);
    if (long) return hint(nextBid(long, highest.call)!, `合計約 ${combined} 點、${cards(long)}競叫`);
  }
  return pass();
}

export function suggestCall(system: BiddingSystemKey, hand: readonly string[], auction: readonly AuctionCall[], order: readonly string[], viewerSeatId: string): BidHint | null {
  const a = auctionView(auction, order, viewerSeatId), h = evaluate(hand);
  const result = existingCall(system, hand, auction, order, viewerSeatId) ?? fixedCall(system, hand, a, h) ?? generalRound(a, system, h);
  if (result.call === "PASS") return result;
  const highest = a.highest;
  if (result.call === "X" || result.call === "XX") {
    if (!highest) return null;
    const doubling = auction.slice(auction.indexOf(highest) + 1).filter((c) => c.call === "X" || c.call === "XX").at(-1);
    if (result.call === "X") return !a.ours(highest) && !doubling ? result : null;
    return a.ours(highest) && doubling?.call === "X" && !a.ours(doubling) ? result : null;
  }
  return bidRank(result.call) >= 0 && bidRank(result.call) > (highest ? bidRank(highest.call) : -1) ? result : null;
}
