import { displayOptionValue } from "./option-format.js";
import type { GameRules, OptionDescription } from "./types.js";

export type BlackAceScoring = "both" | "spade" | "none";

export interface JianhongdianOptions {
  readonly end_mode: "score" | "rounds";
  readonly end_score: number;
  readonly end_rounds: number;
  readonly black_ace: BlackAceScoring;
  readonly peek_bottom: boolean;
}

export const JIANHONGDIAN_RULES_VERSION = "jianhongdian-tw-1" as const;
export const JIANHONGDIAN_LABEL = "撿紅點";

export const DEFAULT_JIANHONGDIAN_OPTIONS: JianhongdianOptions = Object.freeze({
  end_mode: "rounds", end_score: 100, end_rounds: 4, black_ace: "both", peek_bottom: true,
});

export const JIANHONGDIAN_OPTION_DESCRIPTIONS: readonly OptionDescription[] = [
  { key: "end_mode", type: "choice", label: "結束方式", description: "局數制：打滿指定局數結算；分數制：任一家累積分達到結束分數就整場結束。", default: "rounds", choices: [{ value: "rounds", label: "局數制" }, { value: "score", label: "分數制" }] },
  { key: "end_rounds", type: "number", label: "結束局數", description: "打滿這麼多局就結算。", default: 4, min: 1, max: 99, visibleWhen: { key: "end_mode", value: "rounds" } },
  { key: "end_score", type: "number", label: "結束分數", description: "任一家累積分達到這個數就結束。", default: 100, min: 1, max: 100000, visibleWhen: { key: "end_mode", value: "score" } },
  { key: "black_ace", type: "choice", label: "黑 A 計分", description: "黑桃 A 30 加梅花 A 40（總分 280）、只有黑桃 A 30（總分 240）、黑牌都不計分（總分 210）。", default: "both", choices: [{ value: "both", label: "♠A 30＋♣A 40" }, { value: "spade", label: "只有 ♠A 30" }, { value: "none", label: "黑牌不計" }] },
  { key: "peek_bottom", type: "boolean", label: "叨牌", description: "尾家（每局最後行動的人）可以看牌堆最後一張，因為最後一翻是他的。", default: true },
];

export function normalizeJianhongdianOptions(value: unknown): JianhongdianOptions {
  const defaults = DEFAULT_JIANHONGDIAN_OPTIONS;
  if (value === undefined || value === null) return defaults;
  if (typeof value !== "object") throw new Error("options 必須是物件。");
  const raw = value as Record<string, unknown>;
  const int = (key: "end_score" | "end_rounds", min: number, max: number): number => {
    const field = raw[key];
    if (field === undefined) return defaults[key];
    const parsed = typeof field === "string" ? Number(field) : field;
    if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`options.${key} 必須是 ${min} 到 ${max} 的整數。`);
    return parsed;
  };
  const endMode = raw.end_mode === undefined ? defaults.end_mode : raw.end_mode;
  if (endMode !== "score" && endMode !== "rounds") throw new Error("options.end_mode 必須是 score 或 rounds。");
  const blackAce = raw.black_ace === undefined ? defaults.black_ace : raw.black_ace;
  if (blackAce !== "both" && blackAce !== "spade" && blackAce !== "none") throw new Error("options.black_ace 必須是 both、spade 或 none。");
  const peek = raw.peek_bottom === undefined ? defaults.peek_bottom : raw.peek_bottom;
  if (typeof peek !== "boolean") throw new Error("options.peek_bottom 必須是 true 或 false。");
  return Object.freeze({ end_mode: endMode, end_score: int("end_score", 1, 100000), end_rounds: int("end_rounds", 1, 99), black_ace: blackAce, peek_bottom: peek });
}

// ---------- 分數 ----------

export function cardPoints(card: string, options: Pick<JianhongdianOptions, "black_ace">): number {
  const suit = card.slice(0, 1);
  const rank = card.slice(1);
  if (suit === "♥" || suit === "♦") {
    if (rank === "A") return 20;
    if (rank === "9" || rank === "10" || rank === "J" || rank === "Q" || rank === "K") return 10;
    return Number(rank);
  }
  if (card === "♠A" && options.black_ace !== "none") return 30;
  if (card === "♣A" && options.black_ace === "both") return 40;
  return 0;
}

export function totalPoints(options: Pick<JianhongdianOptions, "black_ace">): number {
  return { both: 280, spade: 240, none: 210 }[options.black_ace];
}

/** 基準分 = 總分 ÷ 人數，不整除時保留一位小數（3 人黑 A 全計是 93.3）。 */
export function baselinePoints(options: Pick<JianhongdianOptions, "black_ace">, playerCount: number): number {
  return roundToTenth(totalPoints(options) / playerCount);
}

export function roundToTenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

// ---------- 規則表 ----------

export interface JianhongdianRules extends GameRules {
  readonly objective: string;
  readonly player_count: { readonly min: 2; readonly max: 4 };
  readonly card_codes: string;
  readonly dealing: readonly string[];
  readonly turn_flow: readonly string[];
  readonly matching: readonly string[];
  readonly point_cards: readonly string[];
  readonly scoring: readonly string[];
  readonly game_end: string;
  readonly table_options: readonly { readonly key: string; readonly label: string; readonly value: string | number; readonly description: string }[];
  readonly agent_protocol: readonly string[];
}

export function buildJianhongdianRules(options: JianhongdianOptions): JianhongdianRules {
  const blackAceLine = { both: "♠A 30 分、♣A 40 分。", spade: "♠A 30 分；♣A 不計分。", none: "黑牌一律不計分。" }[options.black_ace];
  const total = totalPoints(options);
  const gameEnd = options.end_mode === "score"
    ? `分數制：任一家累積分達到 ${options.end_score} 時整場結束，累積分最高者勝。`
    : `局數制：打滿 ${options.end_rounds} 局結算，累積分最高者勝。`;
  return {
    rules_version: JIANHONGDIAN_RULES_VERSION, game: JIANHONGDIAN_LABEL,
    objective: "用手牌與翻出的牌和桌面配對，收走越多紅色分數牌越好；整場結束時累積分最高者勝。",
    player_count: { min: 2, max: 4 },
    card_codes: "牌面使用「花色＋點數」，例如 ♥A、♦9、♠A、♣10。",
    dealing: [
      "52 張牌。桌面先攤 4 張明牌，牌堆固定 24 張，其餘平分：4 人每人 6 張、3 人每人 8 張、2 人每人 12 張。",
      "第一局由入座順序第一位先行動，之後每局首家輪替一位；首家的前一位是尾家（每局最後行動的人）。",
      options.peek_bottom ? "叨牌：尾家看得到牌堆最後一張（最後一翻是他的），其他人看不到。" : "本桌沒開叨牌，牌堆最後一張誰都看不到。",
    ],
    turn_flow: [
      "輪到你時出一張手牌：和桌面某張配得上可以收走兩張（可配可不配、多張可配時自己挑）；不配或配不到就把手牌留在桌上。",
      "接著自動翻牌堆最上面一張：和桌面配得上就收走兩張（多張可配時收分數最高的那張，同分取先攤的），配不到就留在桌上。翻出的牌只跟桌面配，不跟手牌配。",
      "牌堆翻完、手牌出完就結算本局；桌面剩下的牌不歸任何人。",
      "局中有人離桌本局流局不計分，要中離請先邀人代打（invite_substitute）。",
    ],
    matching: [
      "A 到 9 兩張湊十可配：A 配 9、2 配 8、3 配 7、4 配 6、5 配 5。",
      "10、J、Q、K 只能同點配（10 配 10、J 配 J、Q 配 Q、K 配 K）。",
      "花色不限。",
    ],
    point_cards: [
      "♥A、♦A 各 20 分。",
      "紅色 9、10、J、Q、K 各 10 分。",
      "紅色 2 到 8 照牌面數字。",
      blackAceLine,
      `全部分數牌合計 ${total} 分。`,
    ],
    scoring: [
      `每局分數 = 實得分 − 基準分，基準分 = ${total} ÷ 人數（4 人 ${baselinePoints(options, 4)}、3 人 ${baselinePoints(options, 3)}、2 人 ${baselinePoints(options, 2)}），不整除時保留一位小數。`,
      "各家分數加總為 0，逐局累加。",
    ],
    game_end: gameEnd,
    table_options: JIANHONGDIAN_OPTION_DESCRIPTIONS.map((option) => ({ key: option.key, label: option.label, value: displayOptionValue(option, options[option.key as keyof JianhongdianOptions]), description: option.description })),
    agent_protocol: [
      "只使用牌桌回傳的 legal_plays；每一筆 cards 是一張（把手牌放到桌上）或兩張（手牌＋要配對的桌面牌）。",
      "出牌時把所選 legal_plays.cards 原樣傳給 take_action，action 為 play_card；翻牌由伺服器自動完成，board.last_flip 會告訴你翻出什麼、收了什麼。",
      "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key。",
    ],
  };
}

export function formatJianhongdianRules(rules: JianhongdianRules): string {
  const lines = [
    `${rules.game}規則表｜版本 ${rules.rules_version}`,
    `目標：${rules.objective}`,
    `人數：${rules.player_count.min} 到 ${rules.player_count.max} 人。`,
    `牌面：${rules.card_codes}`,
    "發牌與順序：", ...rules.dealing.map((line) => `- ${line}`),
    "一手的流程：", ...rules.turn_flow.map((line) => `- ${line}`),
    "配對：", ...rules.matching.map((line) => `- ${line}`),
    "分數牌：", ...rules.point_cards.map((line) => `- ${line}`),
    "計分：", ...rules.scoring.map((line) => `- ${line}`),
    `整場結束：${rules.game_end}`,
    "本桌選項：", ...rules.table_options.map((option) => `- ${option.label}：${String(option.value)}（${option.description}）`),
    "Agent 協定：", ...rules.agent_protocol.map((line) => `- ${line}`),
  ];
  return lines.join("\n");
}
