import { displayOptionValue } from "./option-format.js";
import type { GameRules, OptionDescription } from "./types.js";

export interface PaiqiOptions {
  readonly end_mode: "rounds" | "score";
  readonly end_rounds: number;
  readonly end_score: number;
  readonly leftover_mode: "deal_after_seven" | "open_pool";
}

export const PAIQI_RULES_VERSION = "paiqi-tw-1";
export const PAIQI_LABEL = "排七";
export const DEFAULT_PAIQI_OPTIONS: PaiqiOptions = Object.freeze({ end_mode: "rounds", end_rounds: 4, end_score: 100, leftover_mode: "deal_after_seven" });
export const PAIQI_OPTION_DESCRIPTIONS: readonly OptionDescription[] = [
  { key: "end_mode", type: "choice", label: "結束方式", description: "打滿局數或任一家輸到指定分數就結束。", default: "rounds", choices: [{ value: "rounds", label: "局數制" }, { value: "score", label: "分數制" }] },
  { key: "end_rounds", type: "number", label: "結束局數", description: "打滿這麼多局就結算。", default: 4, min: 1, max: 99, visibleWhen: { key: "end_mode", value: "rounds" } },
  { key: "end_score", type: "number", label: "結束分數", description: "任一家輸到這個分數（累積分 ≤ −N）就整場結束。", default: 100, min: 1, max: 100000, visibleWhen: { key: "end_mode", value: "score" } },
  { key: "leftover_mode", type: "choice", label: "多的牌", description: "只影響 3 人與 5 人局。", default: "deal_after_seven", choices: [{ value: "deal_after_seven", label: "♠7 後補發" }, { value: "open_pool", label: "公共區自動接牌" }] },
];

export function normalizePaiqiOptions(value: unknown): PaiqiOptions {
  const defaults = DEFAULT_PAIQI_OPTIONS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const int = (key: "end_rounds" | "end_score", max: number): number => {
    const parsed = typeof raw[key] === "string" ? Number(raw[key]) : raw[key];
    return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : defaults[key];
  };
  return Object.freeze({
    end_mode: raw.end_mode === "score" ? "score" : "rounds",
    end_rounds: int("end_rounds", 99), end_score: int("end_score", 100000),
    leftover_mode: raw.leftover_mode === "open_pool" ? "open_pool" : "deal_after_seven",
  });
}

export const PAIQI_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const PAIQI_JOKERS = ["🃏1", "🃏2"] as const;

export function coverPoints(card: string): number {
  if (PAIQI_JOKERS.some((joker) => joker === card)) return 0;
  const rank = PAIQI_RANKS.indexOf(card.slice(1) as typeof PAIQI_RANKS[number]);
  if (!["♣", "♦", "♥", "♠"].includes(card.slice(0, 1)) || rank < 0) throw new Error(`無效的牌：${card}。`);
  return rank + 1;
}

export function scorePaiqiRound(covered: Readonly<Record<string, readonly string[]>>, order: readonly string[]) {
  const points = Object.fromEntries(order.map((seat) => [seat, (covered[seat] ?? []).reduce((sum, card) => sum + coverPoints(card), 0)]));
  const average = order.reduce((sum, seat) => sum + points[seat]!, 0) / order.length;
  const scores = Object.fromEntries(order.map((seat) => {
    const rounded = Math.round((average - points[seat]!) * 10) / 10;
    return [seat, rounded === 0 ? 0 : rounded];
  }));
  const winnerSeatId = [...order].sort((a, b) => points[a]! - points[b]!)[0] ?? null;
  return { points, average, scores, winnerSeatId };
}

export interface PaiqiRules extends GameRules {
  readonly objective: string;
  readonly player_count: { readonly min: 2; readonly max: 6 };
  readonly dealing: readonly string[];
  readonly turn_flow: readonly string[];
  readonly scoring: readonly string[];
  readonly game_end: string;
  readonly table_options: readonly { readonly key: string; readonly label: string; readonly value: string | number; readonly description: string }[];
  readonly agent_protocol: readonly string[];
}

export function buildPaiqiRules(options: PaiqiOptions): PaiqiRules {
  return {
    rules_version: PAIQI_RULES_VERSION, game: PAIQI_LABEL,
    objective: "依花色從 7 往 A、K 接牌，蓋牌點數越少越好；整場累積分最高者勝。",
    player_count: { min: 2, max: 6 },
    dealing: [
      "52 張牌；6 人加 🃏1、🃏2 共 54 張。2 人每人 26 張；3 人 17 張、多 1 張；4 人 13 張；5 人 10 張、多 2 張；6 人 9 張。",
      "♠7 不會放在多的牌裡。拿到 ♠7 的人先出，第一手一定出 ♠7，之後依席位順序輪流，跳過沒有手牌的人。",
      options.leftover_mode === "deal_after_seven" ? "多的牌在 ♠7 出完後，從首家起一人一張補發。" : "多的牌攤在公共區，每手後自動把可接的牌接上，連鎖到沒有為止，不佔玩家的一手。",
    ],
    turn_flow: [
      "一手出一張牌。任一未開的 7 可開新列，其餘須接在同花色已出的牌旁，往下到 A、往上到 K。",
      "有牌可出就不能蓋牌，鬼牌也算可出；完全無牌可接時自己選一張蓋下，永遠不再出，局中只公開張數。",
      "鬼牌指定一個當下可接的空格（含未開的 7）；正牌出來直接替換鬼牌，鬼牌離桌，不回手牌，雙方都不受罰。",
      "所有人的手牌都出完或蓋完才結算。局中有人離桌本局流局，要中離可先邀人代打。",
    ],
    scoring: [
      "結算才攤開蓋牌：A 1 點、2 到 10 照牌面、J 11、Q 12、K 13、鬼牌 0，張數不另外計分。",
      "每局分數＝全桌平均蓋牌點數－自己的點數，各家四捨五入到一位小數，合計可能有些微尾差，不另行調整。蓋牌點數最少者為本局贏家，同分取行動順序較前者。",
      "分數逐局累加；last_round_points 顯示原始蓋牌點數，last_round_scores 顯示本局分數。",
    ],
    game_end: options.end_mode === "rounds" ? `打滿 ${options.end_rounds} 局結算，累積分最高者勝。` : `任一家累積分 ≤ −${options.end_score} 就結束，累積分最高者勝。`,
    table_options: PAIQI_OPTION_DESCRIPTIONS.map((option) => ({ key: option.key, label: option.label, value: displayOptionValue(option, options[option.key as keyof PaiqiOptions]), description: option.description })),
    agent_protocol: [
      "只從最新 legal_plays 挑選，將 action 與 cards 原樣送給 take_action。play_card 的 [牌] 是出牌，[鬼牌, 目標牌碼] 是鬼牌指定位置；cover_card 的 [牌] 是蓋牌。",
      "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key；重送同一請求沿用原本的鍵。",
    ],
  };
}

export function formatPaiqiRules(rules: PaiqiRules): string {
  return [
    `${rules.game}規則表｜版本 ${rules.rules_version}`, `目標：${rules.objective}`, `人數：${rules.player_count.min} 到 ${rules.player_count.max} 人。`,
    "發牌與順序：", ...rules.dealing.map((line) => `- ${line}`),
    "一手的流程：", ...rules.turn_flow.map((line) => `- ${line}`),
    "計分：", ...rules.scoring.map((line) => `- ${line}`), `整場結束：${rules.game_end}`,
    "本桌選項：", ...rules.table_options.map((option) => `- ${option.label}：${option.value}（${option.description}）`),
    "Agent 協定：", ...rules.agent_protocol.map((line) => `- ${line}`),
  ].join("\n");
}
