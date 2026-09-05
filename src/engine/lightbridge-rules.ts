import { displayOptionValue } from "./option-format.js";
import { bidLevel, bidStrain, type HoneymoonContract } from "./honeymoon-rules.js";
import type { GameRules, OptionDescription } from "./types.js";

export interface LightbridgeOptions {
  readonly scoring: "contract" | "tricks";
  readonly pair_scoring: boolean;
  readonly doubling: boolean;
  readonly end_mode: "rounds" | "score";
  readonly end_rounds: number;
  readonly end_score: number;
}
export type LightbridgeContract = HoneymoonContract;
export const LIGHTBRIDGE_RULES_VERSION = "lightbridge-tw-1";
export const LIGHTBRIDGE_LABEL = "台灣輕橋牌";
export const DEFAULT_LIGHTBRIDGE_OPTIONS: LightbridgeOptions = Object.freeze({ scoring: "contract", pair_scoring: false, doubling: false, end_mode: "rounds", end_rounds: 4, end_score: 500 });
export const LIGHTBRIDGE_OPTION_DESCRIPTIONS: readonly OptionDescription[] = [
  { key: "scoring", type: "choice", label: "計分方式", description: "合約制或純墩數。", default: "contract", choices: [{ value: "contract", label: "合約制" }, { value: "tricks", label: "純墩數" }] },
  { key: "pair_scoring", type: "boolean", label: "對家分數合計", description: "結算時對面兩家的本局分數相加，兩人各記合計分。", default: false },
  { key: "doubling", type: "boolean", label: "賭倍", description: "可 Double／Redouble，只影響合約制。", default: false },
  { key: "end_mode", type: "choice", label: "結束方式", description: "打滿局數或任一家累積分達標就結束。", default: "rounds", choices: [{ value: "rounds", label: "局數制" }, { value: "score", label: "分數制" }] },
  { key: "end_rounds", type: "number", label: "結束局數", description: "打滿這麼多局就結算。", default: 4, min: 1, max: 99, visibleWhen: { key: "end_mode", value: "rounds" } },
  { key: "end_score", type: "number", label: "結束分數", description: "任一家累積分 ≥ 此分數就結束。", default: 500, min: 1, max: 100000, visibleWhen: { key: "end_mode", value: "score" } },
];
export function normalizeLightbridgeOptions(value: unknown): LightbridgeOptions {
  const defaults = DEFAULT_LIGHTBRIDGE_OPTIONS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const int = (key: "end_rounds" | "end_score", max: number): number => {
    const parsed = typeof raw[key] === "string" ? Number(raw[key]) : raw[key];
    return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : defaults[key];
  };
  return Object.freeze({ scoring: raw.scoring === "tricks" ? "tricks" : "contract", pair_scoring: raw.pair_scoring === true, doubling: raw.doubling === true,
    end_mode: raw.end_mode === "score" ? "score" : "rounds", end_rounds: int("end_rounds", 99), end_score: int("end_score", 100000) });
}
export const REDEAL_THRESHOLD = 4;
export function highCardPoints(hand: readonly string[]): number {
  const points: Record<string, number> = { A: 4, K: 3, Q: 2, J: 1 };
  return hand.reduce((sum, card) => sum + (points[card.slice(1)] ?? 0), 0);
}

export function scoreLightbridgeRound(contract: LightbridgeContract, tricksWon: Readonly<Record<string, number>>, order: readonly string[], options: LightbridgeOptions) {
  const declarerTricks = tricksWon[contract.seatId]!;
  const level = bidLevel(contract.bid);
  const made = declarerTricks >= 6 + level;
  const scores = Object.fromEntries(order.map((seat) => [seat, tricksWon[seat]! * 10]));
  let detail = `純墩數：各家墩數 × 10 = ${order.map((seat) => scores[seat]).join("／")}`;
  if (options.scoring === "contract") {
    const doubled = options.doubling ? contract.doubled : 0;
    const suffix = doubled === 1 ? "（Double）" : doubled === 2 ? "（Redouble）" : "";
    const trickPoints = scores[contract.seatId]!;
    if (!made) {
      const down = 6 + level - declarerTricks;
      const rate = 50 * 2 ** doubled;
      scores[contract.seatId] = trickPoints - down * rate;
      detail = `${contract.bid}${suffix} 倒約 ${down} 墩：主打方 ${declarerTricks} 墩 ${trickPoints} − ${down} × ${rate} = ${scores[contract.seatId]}；其餘各家每墩 10`;
    } else {
      const strain = bidStrain(contract.bid);
      const rate = strain === "♣" || strain === "♦" ? 20 : 30;
      const base = (level * rate + (strain === "NT" ? 10 : 0)) * 2 ** doubled;
      const bonus = base >= 100 ? 300 : 50;
      const slam = level === 6 ? 500 : level === 7 ? 1000 : 0;
      const insult = doubled === 1 ? 50 : doubled === 2 ? 100 : 0;
      scores[contract.seatId] = trickPoints + bonus + slam + insult;
      detail = `${contract.bid}${suffix} 成約：主打方 ${declarerTricks} 墩 ${trickPoints} + ${base >= 100 ? "成局" : "部分合約"} ${bonus}${slam ? ` + ${level === 6 ? "小滿貫" : "大滿貫"} ${slam}` : ""}${insult ? ` + 侮辱分 ${insult}` : ""} = ${scores[contract.seatId]}；其餘各家每墩 10`;
    }
  }
  if (options.pair_scoring) {
    const individual = { ...scores };
    for (let i = 0; i < 4; i++) scores[order[i]!] = individual[order[i]!]! + individual[order[(i + 2) % 4]!]!;
    detail += `；對家合計：${individual[order[0]!]} + ${individual[order[2]!]} = ${scores[order[0]!]}、${individual[order[1]!]} + ${individual[order[3]!]} = ${scores[order[1]!]}，兩人各記合計分`;
  }
  return { scores, made, detail };
}

export interface LightbridgeRules extends GameRules {
  readonly objective: string;
  readonly player_count: { readonly min: 4; readonly max: 4 };
  readonly dealing: readonly string[];
  readonly turn_flow: readonly string[];
  readonly scoring: readonly string[];
  readonly game_end: string;
  readonly table_options: readonly { readonly key: string; readonly label: string; readonly value: string | number; readonly description: string }[];
  readonly agent_protocol: readonly string[];
}
export function buildLightbridgeRules(options: LightbridgeOptions): LightbridgeRules {
  return {
    rules_version: LIGHTBRIDGE_RULES_VERSION, game: LIGHTBRIDGE_LABEL, player_count: { min: 4, max: 4 },
    objective: "2000～2020 年間流行於台灣各大校園的版本：叫牌憑默契、沒有夢家、點力太差可倒牌。主打方自己取得 6＋合約線位墩以成約；整場累積分最高者勝。",
    dealing: ["52 張牌，每人依序 13 張，A 最大、2 最小；沒有搭檔、沒有夢家，四家各打各的手牌。", "席位順序固定，第一局第一位發牌，之後每局輪換；發牌者先叫，依席位順序輪流。倒牌或全 PASS 重發時發牌者換下一位。"],
    turn_flow: [
      "叫品由 1♣、1♦、1♥、1♠、1NT 到 7NT，共 35 種；必須高於目前最高叫品，沒有點力限制、沒有制度。",
      "有人叫過後連續三家 PASS 結束叫牌，最後叫牌者主打，合約花色為王牌，NT 無王。四家全 PASS 就重洗重發，不計分、不增加局數。",
      "輪到自己第一次開口，手牌大牌點小於 4 可倒牌（A 4、K 3、Q 2、J 1）；叫過或 PASS 過就不能倒牌。不用其他人同意，次數不限；重洗重發不計分、不增加局數。",
      "賭倍開啟時，非主打方可對尚未加倍的叫品 Double，被 Double 的主打方可 Redouble；更高叫品清除倍數，Double／Redouble 中斷連續 PASS。對家分數合計開啟時，主打方對家不能 Double。",
      "主打方的下家首攻。有首出花色必須跟，沒有才可出其他牌；王牌優先，否則首出花色最大者贏。贏家收墩並先出下一墩，打滿 13 墩結算；局中離桌一律流局。",
    ],
    scoring: [
      "每墩誰贏誰得 10 分，四家各算各的；合約制主打方自己拿到 6＋線位墩才成約。",
      "成約獎分：合約墩分 ♣♦ 每墩 20、♥♠ 每墩 30、NT 第一墩 40 之後 30，Double／Redouble ×2／×4；墩分 <100 部分合約 +50，≥100 成局 +300。合約墩分只判斷獎分，不另外加進得分。",
      "成約 6 線再 +500、7 線再 +1000；Double／Redouble 成約侮辱分 +50／+100。倒約每墩 −50（Double −100／Redouble −200），防守方不另外得分。",
      "純墩數：只有每墩 10 分，不看合約、不算賭倍。對家分數合計開啟時，本局對面兩家分數相加，兩人各記合計分；成約仍只看主打方自己的墩數，整場同一對兩人並列。",
    ],
    game_end: options.end_mode === "rounds" ? `打滿 ${options.end_rounds} 局結算，累積分最高者勝。` : `任一家累積分 ≥ ${options.end_score} 就結束，累積分最高者勝。`,
    table_options: LIGHTBRIDGE_OPTION_DESCRIPTIONS.map((option) => ({ key: option.key, label: option.label, value: displayOptionValue(option, options[option.key as keyof LightbridgeOptions]), description: option.description })),
    agent_protocol: ["從最新 legal_plays 選 bid，cards 為一個叫品（例如 [\"2♥\"]）；play_card 的 cards 為一張牌（例如 [\"♠A\"]）。pass／redeal／double／redouble 從 legal_actions 選，cards 為 []；redeal 是倒牌。", "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key；重送同一請求沿用原本的鍵。"],
  };
}
export function formatLightbridgeRules(rules: LightbridgeRules): string {
  return [`${rules.game}規則表｜版本 ${rules.rules_version}`, `目標：${rules.objective}`, "人數：固定 4 人。",
    "發牌與順序：", ...rules.dealing.map((s) => `- ${s}`), "流程：", ...rules.turn_flow.map((s) => `- ${s}`),
    "計分：", ...rules.scoring.map((s) => `- ${s}`), `整場結束：${rules.game_end}`, "本桌選項：",
    ...rules.table_options.map((o) => `- ${o.label}：${o.value}（${o.description}）`), "Agent 協定：", ...rules.agent_protocol.map((s) => `- ${s}`)].join("\n");
}
