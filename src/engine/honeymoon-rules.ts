import { displayOptionValue } from "./option-format.js";
import type { GameRules, OptionDescription } from "./types.js";

export interface HoneymoonOptions {
  readonly scoring: "bridge" | "trick_diff";
  readonly doubling: boolean;
  readonly end_mode: "rounds" | "score";
  readonly end_rounds: number;
  readonly end_score: number;
}
export interface HoneymoonContract { seatId: string; bid: string; doubled: 0 | 1 | 2 }
export const HONEYMOON_RULES_VERSION = "honeymoon-tw-1";
export const HONEYMOON_LABEL = "雙人橋牌";
export const DEFAULT_HONEYMOON_OPTIONS: HoneymoonOptions = Object.freeze({ scoring: "bridge", doubling: false, end_mode: "rounds", end_rounds: 4, end_score: 500 });
export const HONEYMOON_OPTION_DESCRIPTIONS: readonly OptionDescription[] = [
  { key: "scoring", type: "choice", label: "計分方式", description: "橋牌分或墩數差 ×10。", default: "bridge", choices: [{ value: "bridge", label: "橋牌分" }, { value: "trick_diff", label: "墩數差 ×10" }] },
  { key: "doubling", type: "boolean", label: "賭倍", description: "可 Double／Redouble，只影響橋牌分。", default: false },
  { key: "end_mode", type: "choice", label: "結束方式", description: "打滿局數或任一家累積分達標就結束。", default: "rounds", choices: [{ value: "rounds", label: "局數制" }, { value: "score", label: "分數制" }] },
  { key: "end_rounds", type: "number", label: "結束局數", description: "打滿這麼多局就結算。", default: 4, min: 1, max: 99, visibleWhen: { key: "end_mode", value: "rounds" } },
  { key: "end_score", type: "number", label: "結束分數", description: "任一家累積分 ≥ 此分數就結束。", default: 500, min: 1, max: 100000, visibleWhen: { key: "end_mode", value: "score" } },
];
export function normalizeHoneymoonOptions(value: unknown): HoneymoonOptions {
  const defaults = DEFAULT_HONEYMOON_OPTIONS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const int = (key: "end_rounds" | "end_score", max: number): number => {
    const parsed = typeof raw[key] === "string" ? Number(raw[key]) : raw[key];
    return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : defaults[key];
  };
  return Object.freeze({ scoring: raw.scoring === "trick_diff" ? "trick_diff" : "bridge", doubling: raw.doubling === true,
    end_mode: raw.end_mode === "score" ? "score" : "rounds", end_rounds: int("end_rounds", 99), end_score: int("end_score", 100000) });
}
export const BIDS: readonly string[] = Object.freeze(Array.from({ length: 7 }, (_, i) => ["♣", "♦", "♥", "♠", "NT"].map((suit) => `${i + 1}${suit}`)).flat());
export const bidRank = (bid: string): number => BIDS.indexOf(bid);
export const bidLevel = (bid: string): number => Number(bid[0]);
export const bidStrain = (bid: string): string => bid.slice(1);

export function scoreHoneymoonRound(contract: HoneymoonContract, tricksWon: Readonly<Record<string, number>>, order: readonly string[], options: HoneymoonOptions) {
  const declarerTricks = tricksWon[contract.seatId]!;
  const level = bidLevel(contract.bid);
  const made = declarerTricks >= 6 + level;
  const defender = order.find((seat) => seat !== contract.seatId)!;
  const scores = Object.fromEntries(order.map((seat) => [seat, 0]));
  if (options.scoring === "trick_diff") {
    const winner = tricksWon[order[0]!]! > tricksWon[order[1]!]! ? order[0]! : order[1]!;
    const loser = order.find((seat) => seat !== winner)!;
    scores[winner] = (tricksWon[winner]! - tricksWon[loser]!) * 10;
    return { scores, declarerTricks, made, detail: `墩數差：（${tricksWon[winner]} − ${tricksWon[loser]}）× 10 = ${scores[winner]}` };
  }
  const doubled = options.doubling ? contract.doubled : 0;
  const suffix = doubled === 1 ? "（Double）" : doubled === 2 ? "（Redouble）" : "";
  if (!made) {
    const down = 6 + level - declarerTricks;
    const penalty = doubled ? (100 + (down - 1) * 200) * (doubled === 2 ? 2 : 1) : down * 50;
    scores[defender] = penalty;
    const formula = doubled ? `(100 + ${down - 1} × 200) × ${doubled === 2 ? 2 : 1}` : `${down} × 50`;
    return { scores, declarerTricks, made, detail: `${contract.bid}${suffix} 倒約 ${down} 墩：${formula} = ${penalty}，防守方得分` };
  }
  const strain = bidStrain(contract.bid);
  const rate = strain === "♣" || strain === "♦" ? 20 : 30;
  const base = (level * rate + (strain === "NT" ? 10 : 0)) * 2 ** doubled;
  const bonus = base >= 100 ? 300 : 50;
  const slam = level === 6 ? 500 : level === 7 ? 1000 : 0;
  const insult = doubled === 1 ? 50 : doubled === 2 ? 100 : 0;
  const over = declarerTricks - 6 - level;
  const overPoints = over * (doubled ? 100 * (doubled === 2 ? 2 : 1) : rate);
  const parts = [base, bonus, slam, insult, overPoints].filter((n) => n > 0);
  scores[contract.seatId] = parts.reduce((sum, n) => sum + n, 0);
  return { scores, declarerTricks, made, detail: `${contract.bid}${suffix} 成約${over ? ` +${over} 超墩` : ""}：${parts.join(" + ")} = ${scores[contract.seatId]}` };
}

export interface HoneymoonRules extends GameRules {
  readonly objective: string;
  readonly player_count: { readonly min: 2; readonly max: 2 };
  readonly dealing: readonly string[];
  readonly turn_flow: readonly string[];
  readonly scoring: readonly string[];
  readonly game_end: string;
  readonly table_options: readonly { readonly key: string; readonly label: string; readonly value: string | number; readonly description: string }[];
  readonly agent_protocol: readonly string[];
}
export function buildHoneymoonRules(options: HoneymoonOptions): HoneymoonRules {
  return {
    rules_version: HONEYMOON_RULES_VERSION, game: HONEYMOON_LABEL, player_count: { min: 2, max: 2 },
    objective: "主打方取得 6＋合約線位墩以成約；分數逐局累加，整場累積分最高者勝。",
    dealing: ["52 張牌，每人 13 張，剩下 26 張為換牌池。A 最大、2 最小。", "第一局席位第一位發牌，之後每局輪換；發牌者先叫牌。"],
    turn_flow: [
      "叫品由 1♣、1♦、1♥、1♠、1NT 到 7NT，共 35 種；輪流叫牌，必須高於上一叫品，沒有點力限制。",
      "有人叫過後一方 PASS 即結束叫牌，最後叫牌者主打，合約花色為王牌，NT 無王。雙方未叫牌就 PASS，重洗重發並交換發牌者，不計分、不增加局數。",
      "賭倍開啟時可對對手叫品 Double，被 Double 者可 Redouble；更高叫品清除倍數，Double／Redouble 後對方 PASS 即結束叫牌。",
      "換牌由主打方先出，每輪各出一張，有首出花色必須跟；無該花色才可出其他牌。王牌優先，否則首出花色最大者贏。",
      "贏家拿換牌池明牌，輸家拿下一張暗牌（只有自己知道），再翻下一張。贏家先出下一輪；換牌不算墩數，共 13 輪後各持 13 張。",
      "打牌由換牌末輪輸家先出，跟花色與比牌同換牌，贏家收墩並先出下一墩。打滿 13 墩才結算，局中離桌一律流局。",
    ],
    scoring: [
      "橋牌分：無身價。合約基本分 ♣♦ 每墩 20、♥♠ 每墩 30、NT 第一墩 40 其餘 30；成約基本分 <100 加 50，≥100 加 300。",
      "成約 6 線另加 500，7 線另加 1000；超墩 ♣♦ 每墩 20、♥♠／NT 每墩 30。倒約每墩 50 給防守方。",
      "Double／Redouble 基本分 ×2／×4，以加倍後基本分判斷成局；成約侮辱分 +50／+100，超墩每墩 100／200。Double 倒約第一墩 100、之後每墩 200；Redouble 罰分再 ×2。",
      "墩數差 ×10：不看合約與賭倍，墩數多者得（自己的墩數−對手墩數）×10。兩種模式皆只有一方得正分，另一方 0。",
    ],
    game_end: options.end_mode === "rounds" ? `打滿 ${options.end_rounds} 局結算，累積分最高者勝。` : `任一家累積分 ≥ ${options.end_score} 就結束，累積分最高者勝。`,
    table_options: HONEYMOON_OPTION_DESCRIPTIONS.map((option) => ({ key: option.key, label: option.label, value: displayOptionValue(option, options[option.key as keyof HoneymoonOptions]), description: option.description })),
    agent_protocol: ["從最新 legal_plays 選 bid，cards 為一個叫品（例如 [\"2♥\"]）；play_card 的 cards 為一張牌（例如 [\"♠A\"]）。pass／double／redouble 從 legal_actions 選，cards 為 []。", "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key；重送同一請求沿用原本的鍵。"],
  };
}
export function formatHoneymoonRules(rules: HoneymoonRules): string {
  return [`${rules.game}規則表｜版本 ${rules.rules_version}`, `目標：${rules.objective}`, "人數：固定 2 人。",
    "發牌與順序：", ...rules.dealing.map((s) => `- ${s}`), "流程：", ...rules.turn_flow.map((s) => `- ${s}`),
    "計分：", ...rules.scoring.map((s) => `- ${s}`), `整場結束：${rules.game_end}`, "本桌選項：",
    ...rules.table_options.map((o) => `- ${o.label}：${o.value}（${o.description}）`), "Agent 協定：", ...rules.agent_protocol.map((s) => `- ${s}`)].join("\n");
}
