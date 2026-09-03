import { DEFAULT_BIG_TWO_RULE_OPTIONS, type BigTwoRuleOptions } from "./big-two.js";

export const BIG_TWO_RULES_VERSION = "bigtwo-tw-4" as const;

export interface BigTwoRuleOptionDescription {
  readonly key: keyof BigTwoRuleOptions;
  readonly label: string;
  readonly enabled: boolean;
  readonly description: string;
}

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
    readonly card_count: 1 | 2 | 5;
    readonly name: string;
    readonly requirement: string;
  }[];
  readonly five_card_order_low_to_high: readonly string[];
  readonly comparison: readonly string[];
  readonly table_options: readonly BigTwoRuleOptionDescription[];
  readonly trick_flow: readonly string[];
  readonly scoring: readonly string[];
  readonly agent_protocol: readonly string[];
}

export function buildBigTwoRules(options: BigTwoRuleOptions = DEFAULT_BIG_TWO_RULE_OPTIONS): BigTwoRules {
  return Object.freeze({
  rules_version: BIG_TWO_RULES_VERSION,
  game: "大老二",
  objective: "最先出完全部手牌者贏得本局。",
  player_count: Object.freeze({ min: 2, max: 4 }),
  card_codes: "牌面使用「花色＋點數」，例如 ♦3、♣10、♥J、♠2。",
  rank_order_low_to_high: Object.freeze(["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"]),
  suit_order_low_to_high: Object.freeze(["♣ 梅花", "♦ 方塊", "♥ 紅心", "♠ 黑桃"]),
  dealing: Object.freeze([
    "四人局每人 13 張，使用全部 52 張牌。",
    "三人局每人 17 張，剩餘 1 張成為公開留牌，不屬於任何玩家。",
    "兩人局每人 13 張，其餘 26 張不使用。",
  ]),
  opening: Object.freeze([
    "第一局由持有本局已發出最低牌的玩家先攻，而且第一手必須包含該牌；三、四人局通常是 ♣3。",
    "第二局起由上一局贏家先攻，可領出任一合法牌型。",
  ]),
  legal_play_types: Object.freeze([
    Object.freeze({ card_count: 1, name: "單張", requirement: "任一張牌。" }),
    Object.freeze({ card_count: 2, name: "一對", requirement: "兩張相同點數。" }),
    Object.freeze({ card_count: 5, name: "順子", requirement: "五個連續點數；A-2-3-4-5 是最小順子，2-3-4-5-6 是最大順子，2 不得出現在其他順子（例如 J-Q-K-A-2 不算）。" }),
    Object.freeze({ card_count: 5, name: "葫蘆", requirement: "一組三條加一對。" }),
    Object.freeze({ card_count: 5, name: "鐵支", requirement: "四張相同點數加任一張牌。" }),
    Object.freeze({ card_count: 5, name: "同花順", requirement: "同時是順子與同花。" }),
  ]),
  five_card_order_low_to_high: Object.freeze(["順子", "葫蘆", "鐵支", "同花順"]),
  comparison: Object.freeze([
    options.bombs_beat_anything
      ? "跟牌必須和桌面張數相同，唯一例外是鐵支與同花順：本桌開啟「鐵支同花順全壓」，它們可以壓桌上任何非鐵支／同花順的牌組，不受張數限制；鐵支與同花順之間照五張牌規則比較，同花順較大。"
      : "跟牌必須和桌面張數相同；五張牌只能被五張牌壓過，鐵支與同花順也不能跨張數壓牌。",
    options.five_card_same_kind_only
      ? "本桌開啟「五張同牌型互壓」：順子只能被更大的順子壓、葫蘆只能被更大的葫蘆壓，不同牌型之間不互壓（鐵支與同花順之間仍可互壓）。"
      : "五張牌不同牌型時，高階牌型壓低階牌型（葫蘆可壓順子）。",
    "單張依點數比較，同點數時依花色比較。",
    "一對依點數比較，同點數時比較該對中最大的花色。",
    "五張牌先比較牌型；同牌型時，順子／同花順比較最高牌（同點數再比花色），葫蘆比較三條，鐵支比較四張同點數的部分。",
  ]),
  table_options: Object.freeze([
    Object.freeze({
      key: "bombs_beat_anything" as const,
      label: "鐵支同花順全壓",
      enabled: options.bombs_beat_anything,
      description: "開啟時鐵支與同花順可以壓任何非鐵支／同花順的牌組，不受張數限制。",
    }),
    Object.freeze({
      key: "five_card_same_kind_only" as const,
      label: "五張同牌型互壓",
      enabled: options.five_card_same_kind_only,
      description: "開啟時順子只能被順子壓、葫蘆只能被葫蘆壓；關閉時高階牌型可壓低階牌型。",
    }),
  ]),
  trick_flow: Object.freeze([
    "領出新墩時不能 PASS，可出任一合法牌型。",
    "跟牌時可出能壓過桌面的同張數牌組，或選擇 PASS。",
    "PASS 後本墩不再行動；當回合回到最後成功出牌者時，由該玩家收墩並重新自由領牌。",
  ]),
  scoring: Object.freeze([
    "贏家得到其他玩家本局扣分的總和，總分維持零和。",
    "輸家以剩牌張數計分，每張 1 分；手上每留一張 2，分數就加倍一次（例如剩 5 張含兩張 2 為 5 × 2 × 2 = 20 分）。",
  ]),
  agent_protocol: Object.freeze([
    "只使用牌桌回傳的 legal_plays；其中每一組 cards 都已由伺服器判定可合法出牌。",
    "出牌時把所選 legal_plays.cards 原樣傳給 take_action；若選 PASS，cards 必須是空陣列。",
    "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key。",
    "不得推測或宣稱知道其他玩家手牌、未發牌牌堆或任何隱藏狀態。",
    "table_options 是這一桌房主的設定；legal_plays 已依照它們計算，以 legal_plays 為準。",
  ]),
  });
}

export const BIG_TWO_RULES: BigTwoRules = buildBigTwoRules();

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
    "本桌房主選項：",
    ...rules.table_options.map((option) => `- ${option.label}：${option.enabled ? "開" : "關"}（${option.description}）`),
    "墩的流程：",
    ...rules.trick_flow.map((line) => `- ${line}`),
    "計分：",
    ...rules.scoring.map((line) => `- ${line}`),
    "Agent 操作：",
    ...rules.agent_protocol.map((line) => `- ${line}`),
  ].join("\n");
}
