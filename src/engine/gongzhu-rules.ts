import type { GameRules, OptionDescription } from "./types.js";

export type GongzhuVariant = "gongzhu" | "hearts";

export interface GongzhuOptions {
  readonly end_mode: "score" | "rounds";
  readonly end_score: number;
  readonly end_rounds: number;
  readonly grand_slam: boolean;
  readonly hearts_low_zero: boolean;
  readonly transformer_alone_bonus: boolean;
  readonly heart_break_lead: boolean;
  readonly partnership: boolean;
}

export const GONGZHU_RULES_VERSION = "gongzhu-tw-1" as const;
export const HEARTS_RULES_VERSION = "hearts-tw-1" as const;

export const DEFAULT_GONGZHU_OPTIONS: GongzhuOptions = Object.freeze({
  end_mode: "score", end_score: -1000, end_rounds: 4,
  grand_slam: false, hearts_low_zero: false, transformer_alone_bonus: true, heart_break_lead: false, partnership: false,
});

/** 傷心小棧只開放結束條件；其餘規則固定（紅心破牌後才能首出紅心）。 */
export const DEFAULT_HEARTS_OPTIONS: GongzhuOptions = Object.freeze({
  end_mode: "score", end_score: -100, end_rounds: 4,
  grand_slam: false, hearts_low_zero: false, transformer_alone_bonus: false, heart_break_lead: true, partnership: false,
});

const END_OPTIONS = (defaultScore: number): OptionDescription[] => [
  { key: "end_mode", type: "choice", label: "結束方式", description: "分數制：任一家累積到結束分數就整場結束；局數制：打滿指定局數結算。", default: "score", choices: [{ value: "score", label: "分數制" }, { value: "rounds", label: "局數制" }] },
  { key: "end_score", type: "number", label: "結束分數", description: "任一家累積分低於或等於這個數就結束。", default: defaultScore, min: -100000, max: 0, visibleWhen: { key: "end_mode", value: "score" } },
  { key: "end_rounds", type: "number", label: "結束局數", description: "打滿這麼多局就結算。", default: 4, min: 1, max: 99, visibleWhen: { key: "end_mode", value: "rounds" } },
];

export const GONGZHU_OPTION_DESCRIPTIONS: readonly OptionDescription[] = [
  ...END_OPTIONS(-1000),
  { key: "grand_slam", type: "boolean", label: "大滿貫", description: "一家收齊所有分數牌（13 紅心＋豬＋羊＋變壓器）時全部變正分，總計 +800。", default: false },
  { key: "hearts_low_zero", type: "boolean", label: "小紅心不計分", description: "改用另一套紅心計分：♥2 到 ♥4 為 0 分、♥5 到 ♥10 各 -10。關閉時 ♥2 到 ♥10 是牌面數字的負值、♥4 例外 -10。", default: false },
  { key: "transformer_alone_bonus", type: "boolean", label: "變壓器獨得 +50", description: "只收到 ♣10、沒有其他分數牌時 +50；關閉時算 0 分。", default: true },
  { key: "heart_break_lead", type: "boolean", label: "紅心破牌後才能首出紅心", description: "還沒有人在墩裡出過紅心之前，不能用紅心首出（手上只剩紅心除外）。", default: false },
  { key: "partnership", type: "boolean", label: "對家配合", description: "對家兩人分數合計，勝負以隊為單位。", default: false },
];

export const HEARTS_OPTION_DESCRIPTIONS: readonly OptionDescription[] = END_OPTIONS(-100);

export function normalizeGongzhuOptions(value: unknown, variant: GongzhuVariant): GongzhuOptions {
  const defaults = variant === "hearts" ? DEFAULT_HEARTS_OPTIONS : DEFAULT_GONGZHU_OPTIONS;
  if (value === undefined || value === null) return defaults;
  if (typeof value !== "object") throw new Error("options 必須是物件。");
  const raw = value as Record<string, unknown>;
  const bool = (key: keyof GongzhuOptions): boolean => {
    const field = raw[key];
    if (field === undefined) return defaults[key] as boolean;
    if (typeof field !== "boolean") throw new Error(`options.${key} 必須是 true 或 false。`);
    return field;
  };
  const int = (key: "end_score" | "end_rounds", min: number, max: number): number => {
    const field = raw[key];
    if (field === undefined) return defaults[key];
    const parsed = typeof field === "string" ? Number(field) : field;
    if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`options.${key} 必須是 ${min} 到 ${max} 的整數。`);
    return parsed;
  };
  const endMode = raw.end_mode === undefined ? defaults.end_mode : raw.end_mode;
  if (endMode !== "score" && endMode !== "rounds") throw new Error("options.end_mode 必須是 score 或 rounds。");
  const shared: Pick<GongzhuOptions, "end_mode" | "end_score" | "end_rounds"> = { end_mode: endMode, end_score: int("end_score", -100000, 0), end_rounds: int("end_rounds", 1, 99) };
  if (variant === "hearts") return Object.freeze({ ...defaults, ...shared });
  return Object.freeze({
    ...shared,
    grand_slam: bool("grand_slam"), hearts_low_zero: bool("hearts_low_zero"), transformer_alone_bonus: bool("transformer_alone_bonus"),
    heart_break_lead: bool("heart_break_lead"), partnership: bool("partnership"),
  });
}

export interface GongzhuRules extends GameRules {
  readonly objective: string;
  readonly player_count: { readonly min: 4; readonly max: 4 };
  readonly card_codes: string;
  readonly rank_order_low_to_high: readonly string[];
  readonly dealing: readonly string[];
  readonly trick_flow: readonly string[];
  readonly point_cards: readonly string[];
  readonly scoring: readonly string[];
  readonly table_options: readonly { readonly key: string; readonly label: string; readonly value: string | number | boolean; readonly description: string }[];
  readonly game_end: string;
  readonly agent_protocol: readonly string[];
}

const SHARED_TRICK_FLOW = [
  "四人固定，52 張全發，每人 13 張。",
  "每墩由首出者出一張，其餘依序各出一張；手上有首出花色就必須跟，沒有才能墊任何牌。",
  "同花色比點數，A 最大、2 最小；首出花色中最大的牌贏得這墩，收下四張並首出下一墩。",
  "13 墩打完結算本局；局中有人離桌本局流局不計分，要中離請先邀人代打（invite_substitute）。",
];

export function buildGongzhuRules(options: GongzhuOptions, variant: GongzhuVariant): GongzhuRules {
  const descriptions = variant === "hearts" ? HEARTS_OPTION_DESCRIPTIONS : GONGZHU_OPTION_DESCRIPTIONS;
  const tableOptions = descriptions.map((option) => ({ key: option.key, label: option.label, value: options[option.key as keyof GongzhuOptions], description: option.description }));
  const gameEnd = options.end_mode === "score"
    ? `分數制：任一家累積分低於或等於 ${options.end_score} 時整場結束，分數最高者勝。`
    : `局數制：打滿 ${options.end_rounds} 局結算，分數最高者勝。`;
  if (variant === "hearts") {
    return {
      rules_version: HEARTS_RULES_VERSION, game: "傷心小棧",
      objective: "盡量不要收到紅心與 ♠Q；整場結束時分數最高（負得最少）者勝。",
      player_count: { min: 4, max: 4 },
      card_codes: "牌面使用「花色＋點數」，例如 ♥A、♠Q、♣2。",
      rank_order_low_to_high: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"],
      dealing: [
        "發牌後先傳牌：每人選 3 張傳給指定方向，方向依局數輪替：第 1 局傳左家、第 2 局傳右家、第 3 局傳對家、第 4 局不傳，之後重複。",
        "傳牌是四人同時進行的階段：pending_seat_ids 會列出還沒傳的人；用 take_action、action 為 pass_cards、cards 放三張。",
        "傳牌完成後由持 ♣2 者首出，第一墩必須出 ♣2。",
      ],
      trick_flow: [
        ...SHARED_TRICK_FLOW,
        "第一墩不能出分數牌（紅心或 ♠Q），除非手上全是分數牌。",
        "還沒有人在墩裡出過紅心之前，不能用紅心首出（手上只剩紅心除外）。",
      ],
      point_cards: ["每張紅心 -1（13 張共 -13）。", "♠Q -13。"],
      scoring: ["本局各家把收到的分數牌加總。", "射月：一家收齊 13 張紅心加 ♠Q 時，自己 0 分、其他三家各 -26。"],
      table_options: tableOptions, game_end: gameEnd,
      agent_protocol: [
        "出牌階段 legal_plays 列出你這一手可以出的每一張（action 為 play_card），從中挑一組原樣傳給 take_action。",
        "傳牌階段 legal_plays 列出手牌（action 為 pass_cards），自己挑三張一起送出。",
        "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key；傳牌階段其他人也在動，版本衝突就重讀再送。",
        "不得推測其他玩家手牌；board.captured_points 只列各家已收到的分數牌。",
      ],
    };
  }
  return {
    rules_version: GONGZHU_RULES_VERSION, game: "拱豬",
    objective: "避開豬（♠Q）與紅心、爭取羊（♦J），善用變壓器（♣10）；整場結束時分數最高者勝。",
    player_count: { min: 4, max: 4 },
    card_codes: "牌面使用「花色＋點數」，例如 ♥A、♠Q、♦J、♣10。",
    rank_order_low_to_high: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"],
    dealing: ["發牌後由持 ♣2 者首出，第一墩必須出 ♣2。"],
    trick_flow: [
      ...SHARED_TRICK_FLOW,
      options.heart_break_lead ? "紅心破牌後才能首出紅心（本桌開啟）。" : "首出不限花色（本桌未開啟紅心破牌規則）。",
    ],
    point_cards: [
      options.hearts_low_zero
        ? "紅心：♥A -50、♥K -40、♥Q -30、♥J -20、♥10 到 ♥5 各 -10、♥4 到 ♥2 為 0 分（本桌採小紅心不計分）。"
        : "紅心：♥A -50、♥K -40、♥Q -30、♥J -20、♥10 到 ♥5 是牌面數字的負值、♥4 例外 -10、♥3 -3、♥2 -2；13 張合計 -200。",
      "♠Q（豬）-100。",
      "♦J（羊）+100。",
      options.transformer_alone_bonus
        ? "♣10（變壓器）：只收到它、沒有其他分數牌時 +50；否則把其他分數牌的合計乘二。"
        : "♣10（變壓器）：單獨收到算 0 分；否則把其他分數牌的合計乘二。",
    ],
    scoring: [
      "本局先算紅心（含全紅翻正）加豬加羊，再套變壓器。",
      "全紅：收齊 13 張紅心時紅心全部變正分，合計 +200。",
      ...(options.grand_slam ? ["大滿貫：一家收齊所有分數牌時全部變正分，總計 +800（本桌開啟）。"] : []),
      ...(options.partnership ? ["對家配合：對家兩人分數合計，兩人各記隊伍總分（本桌開啟）。"] : []),
    ],
    table_options: tableOptions, game_end: gameEnd,
    agent_protocol: [
      "legal_plays 列出你這一手可以出的每一張（action 為 play_card），從中挑一組原樣傳給 take_action。",
      "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key。",
      "不得推測其他玩家手牌；board.captured_points 只列各家已收到的分數牌。",
    ],
  };
}

export function formatGongzhuRules(rules: GongzhuRules): string {
  const lines = [
    `${rules.game}規則表｜版本 ${rules.rules_version}`,
    `目標：${rules.objective}`,
    `人數：${rules.player_count.min} 人固定。`,
    `牌面：${rules.card_codes}`,
    "發牌與首出：", ...rules.dealing.map((line) => `- ${line}`),
    "出牌與收墩：", ...rules.trick_flow.map((line) => `- ${line}`),
    "分數牌：", ...rules.point_cards.map((line) => `- ${line}`),
    "計分：", ...rules.scoring.map((line) => `- ${line}`),
    `整場結束：${rules.game_end}`,
    "本桌選項：", ...rules.table_options.map((option) => `- ${option.label}：${String(option.value)}（${option.description}）`),
    "Agent 協定：", ...rules.agent_protocol.map((line) => `- ${line}`),
  ];
  return lines.join("\n");
}
