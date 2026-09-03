export const BIG_TWO_RULES_VERSION = "bigtwo-tw-1" as const;

export interface BigTwoRules {
  readonly rules_version: typeof BIG_TWO_RULES_VERSION;
  readonly game: "大老二";
  readonly objective: string;
  readonly player_count: { readonly min: 2; readonly max: 4 };
  readonly card_codes: string;
  readonly rank_order_low_to_high: readonly string[];
  readonly suit_order_low_to_high: readonly string[];
  readonly dealing: readonly string[];
  readonly opening: readonly string[];
  readonly legal_play_types: readonly {
    readonly card_count: 1 | 2 | 3 | 5;
    readonly name: string;
    readonly requirement: string;
  }[];
  readonly five_card_order_low_to_high: readonly string[];
  readonly comparison: readonly string[];
  readonly trick_flow: readonly string[];
  readonly scoring: readonly string[];
  readonly agent_protocol: readonly string[];
}

export const BIG_TWO_RULES: BigTwoRules = Object.freeze({
  rules_version: BIG_TWO_RULES_VERSION,
  game: "大老二",
  objective: "最先出完全部手牌者贏得本局。",
  player_count: Object.freeze({ min: 2, max: 4 }),
  card_codes: "牌面使用「花色＋點數」，例如 ♦3、♣10、♥J、♠2。",
  rank_order_low_to_high: Object.freeze(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"]),
  suit_order_low_to_high: Object.freeze(["♦ 方塊", "♣ 梅花", "♥ 紅心", "♠ 黑桃"]),
  dealing: Object.freeze([
    "四人局每人 13 張，使用全部 52 張牌。",
    "三人局每人 17 張，剩餘 1 張成為公開留牌，不屬於任何玩家。",
    "兩人局每人先拿 13 張，其餘留在牌堆；有人 PASS 時，該玩家從牌堆補 1 張（牌堆尚有牌時）。",
  ]),
  opening: Object.freeze([
    "第一局由持有本局已發出最低牌的玩家先攻，而且第一手必須包含該牌；三、四人局通常是 ♦3。",
    "第二局起由上一局贏家先攻，可領出任一合法牌型。",
  ]),
  legal_play_types: Object.freeze([
    Object.freeze({ card_count: 1, name: "單張", requirement: "任一張牌。" }),
    Object.freeze({ card_count: 2, name: "一對", requirement: "兩張相同點數。" }),
    Object.freeze({ card_count: 3, name: "三條", requirement: "三張相同點數。" }),
    Object.freeze({ card_count: 5, name: "順子", requirement: "五個連續點數；A-2-3-4-5 是最低順子，2 不得出現在其他順子。" }),
    Object.freeze({ card_count: 5, name: "同花", requirement: "五張相同花色，但不是同花順。" }),
    Object.freeze({ card_count: 5, name: "葫蘆", requirement: "一組三條加一對。" }),
    Object.freeze({ card_count: 5, name: "鐵支", requirement: "四張相同點數加任一張牌。" }),
    Object.freeze({ card_count: 5, name: "同花順", requirement: "同時是順子與同花。" }),
  ]),
  five_card_order_low_to_high: Object.freeze(["順子", "同花", "葫蘆", "鐵支", "同花順"]),
  comparison: Object.freeze([
    "跟牌必須和桌面張數相同；一、二、三張牌也必須是相同牌型。",
    "單張依點數比較，同點數時依花色比較。",
    "一對依點數比較，同點數時比較該對中最大的花色。",
    "三條依點數比較。",
    "五張牌先比較牌型；同牌型時，順子／同花順比較最高牌，同花逐張比較最高牌，葫蘆比較三條，鐵支比較四張同點數的部分。",
  ]),
  trick_flow: Object.freeze([
    "領出新墩時不能 PASS，可出任一合法牌型。",
    "跟牌時可出能壓過桌面的同張數牌組，或選擇 PASS。",
    "PASS 後本墩不再行動；當回合回到最後成功出牌者時，由該玩家收墩並重新自由領牌。",
  ]),
  scoring: Object.freeze([
    "贏家得到其他玩家本局扣分的總和，總分維持零和。",
    "四人局：剩 1～7 張每張 1 分；8～10 張每張 2 分；11～12 張每張 3 分；13 張每張 4 分。",
    "二、三人局：剩 1～9 張每張 1 分；10～12 張每張 2 分；13～16 張每張 3 分；17 張以上每張 4 分。",
  ]),
  agent_protocol: Object.freeze([
    "只使用牌桌回傳的 legal_plays；其中每一組 cards 都已由伺服器判定可合法出牌。",
    "出牌時把所選 legal_plays.cards 原樣傳給 take_action；若選 PASS，cards 必須是空陣列。",
    "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key。",
    "不得推測或宣稱知道其他玩家手牌、未發牌牌堆或任何隱藏狀態。",
  ]),
});

export function formatBigTwoRules(rules: BigTwoRules = BIG_TWO_RULES): string {
  const playTypes = rules.legal_play_types
    .map((play) => `${play.name}（${play.card_count} 張）：${play.requirement}`)
    .join("\n");
  return [
    `${rules.game}規則表｜版本 ${rules.rules_version}`,
    `目標：${rules.objective}`,
    `牌碼：${rules.card_codes}`,
    `點數由小到大：${rules.rank_order_low_to_high.join(" < ")}`,
    `花色由小到大：${rules.suit_order_low_to_high.join(" < ")}`,
    "發牌：",
    ...rules.dealing.map((line) => `- ${line}`),
    "開局：",
    ...rules.opening.map((line) => `- ${line}`),
    "合法牌型：",
    playTypes,
    `五張牌型由小到大：${rules.five_card_order_low_to_high.join(" < ")}`,
    "比較方式：",
    ...rules.comparison.map((line) => `- ${line}`),
    "墩的流程：",
    ...rules.trick_flow.map((line) => `- ${line}`),
    "計分：",
    ...rules.scoring.map((line) => `- ${line}`),
    "Agent 操作：",
    ...rules.agent_protocol.map((line) => `- ${line}`),
  ].join("\n");
}
