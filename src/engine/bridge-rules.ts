import { displayOptionValue } from "./option-format.js";
import { bidLevel, bidStrain } from "./honeymoon-rules.js";
import type { GameRules, OptionDescription } from "./types.js";

export interface BridgeOptions {
  readonly vulnerability: "none" | "chicago";
  readonly doubling: boolean;
  readonly end_mode: "rounds" | "score";
  readonly end_rounds: number;
  readonly end_score: number;
}
export interface BridgeContract { bid: string; doubled: 0 | 1 | 2; declarer: string }
export interface BridgeVulnerability { ns: boolean; ew: boolean }
export const BRIDGE_RULES_VERSION = "bridge-tw-1";
export const BRIDGE_LABEL = "合約橋牌";
export const DEFAULT_BRIDGE_OPTIONS: BridgeOptions = Object.freeze({ vulnerability: "none", doubling: true, end_mode: "rounds", end_rounds: 4, end_score: 1500 });
export const BRIDGE_OPTION_DESCRIPTIONS: readonly OptionDescription[] = [
  { key: "vulnerability", type: "choice", label: "身價", description: "每局無身價，或依四局循環變更身價。", default: "none", choices: [{ value: "none", label: "無身價" }, { value: "chicago", label: "四局制" }] },
  { key: "doubling", type: "boolean", label: "賭倍", description: "可 Double／Redouble；四局制一律開啟。", default: true, visibleWhen: { key: "vulnerability", value: "none" } },
  { key: "end_mode", type: "choice", label: "結束方式", description: "打滿局數或任一隊累積分達標就結束。", default: "rounds", choices: [{ value: "rounds", label: "局數制" }, { value: "score", label: "分數制" }] },
  { key: "end_rounds", type: "number", label: "結束局數", description: "打滿這麼多局就結算；四局制建議填 4 的倍數。", default: 4, min: 1, max: 99, visibleWhen: { key: "end_mode", value: "rounds" } },
  { key: "end_score", type: "number", label: "結束分數", description: "任一隊累積分 ≥ 此分數就結束。", default: 1500, min: 1, max: 100000, visibleWhen: { key: "end_mode", value: "score" } },
];
export function normalizeBridgeOptions(value: unknown): BridgeOptions {
  const defaults = DEFAULT_BRIDGE_OPTIONS;
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const int = (key: "end_rounds" | "end_score", max: number): number => {
    const parsed = typeof raw[key] === "string" ? Number(raw[key]) : raw[key];
    return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : defaults[key];
  };
  const vulnerability = raw.vulnerability === "chicago" ? "chicago" : "none";
  return Object.freeze({ vulnerability, doubling: vulnerability === "chicago" || raw.doubling !== false,
    end_mode: raw.end_mode === "score" ? "score" : "rounds", end_rounds: int("end_rounds", 99), end_score: int("end_score", 100000) });
}
export function vulnerabilityFor(options: BridgeOptions, round: number, dealerIndex: number): BridgeVulnerability {
  if (options.vulnerability === "none") return { ns: false, ew: false };
  const cycle = (round - 1) % 4;
  return { ns: cycle === 3 || ((cycle === 1 || cycle === 2) && dealerIndex % 2 === 0),
    ew: cycle === 3 || ((cycle === 1 || cycle === 2) && dealerIndex % 2 === 1) };
}
export function sideOf(order: readonly string[], seatId: string): "ns" | "ew" { return order.indexOf(seatId) % 2 === 0 ? "ns" : "ew"; }
export function partnerOf(order: readonly string[], seatId: string): string { return order[(order.indexOf(seatId) + 2) % 4]!; }

export function scoreBridgeRound(contract: BridgeContract, tricksWon: Readonly<{ ns: number; ew: number }>, vulnerable: Readonly<BridgeVulnerability>, order: readonly string[]) {
  const side = sideOf(order, contract.declarer);
  const vul = vulnerable[side];
  const level = bidLevel(contract.bid);
  const extra = tricksWon[side] - 6 - level;
  const made = extra >= 0;
  const doubled = contract.doubled;
  const title = `${contract.bid}${"X".repeat(doubled)} ${vul ? "有" : "無"}身價`;
  let points: number;
  let calculation: string;
  if (made) {
    const strain = bidStrain(contract.bid);
    const rate = strain === "♣" || strain === "♦" ? 20 : 30;
    const base = (level * rate + (strain === "NT" ? 10 : 0)) * 2 ** doubled;
    const bonus = base >= 100 ? (vul ? 500 : 300) : 50;
    const slam = level === 6 ? (vul ? 750 : 500) : level === 7 ? (vul ? 1500 : 1000) : 0;
    const over = extra * (doubled ? (vul ? 200 : 100) * 2 ** (doubled - 1) : rate);
    const insult = doubled === 1 ? 50 : doubled === 2 ? 100 : 0;
    points = base + bonus + slam + over + insult;
    calculation = `${title}成約：墩分 ${base} + ${base >= 100 ? "成局" : "部分合約"} ${bonus}${slam ? ` + ${level === 6 ? "小滿貫" : "大滿貫"} ${slam}` : ""}${over ? ` + 超墩 ${over}` : ""}${insult ? ` + 侮辱分 ${insult}` : ""}`;
  } else {
    const down = -extra;
    if (!doubled) {
      const rate = vul ? 100 : 50;
      points = down * rate;
      calculation = `${title}倒 ${down} 墩：${rate} × ${down}`;
    } else {
      const penalties = Array.from({ length: down }, (_, i) => vul ? (i === 0 ? 200 : 300) : i === 0 ? 100 : i < 3 ? 200 : 300);
      points = penalties.reduce((sum, n) => sum + n, 0) * 2 ** (doubled - 1);
      calculation = `${title}倒 ${down} 墩：${doubled === 2 ? "(" : ""}${penalties.join(" + ")}${doubled === 2 ? ") × 2" : ""}`;
    }
  }
  const scoringSide = made ? side : side === "ns" ? "ew" : "ns";
  const scores = Object.fromEntries(order.map((seat) => [seat, sideOf(order, seat) === scoringSide ? points : 0]));
  return { scores, made, detail: `${calculation} = ${points}，${scoringSide === "ns" ? "北南" : "東西"}得分` };
}

export interface BridgeRules extends GameRules {
  readonly objective: string;
  readonly player_count: { readonly min: 4; readonly max: 4 };
  readonly dealing: readonly string[];
  readonly turn_flow: readonly string[];
  readonly scoring: readonly { readonly item: string; readonly none: string; readonly vulnerable: string }[];
  readonly game_end: string;
  readonly table_options: readonly { readonly key: string; readonly label: string; readonly value: string | number; readonly description: string }[];
  readonly agent_protocol: readonly string[];
}
export function buildBridgeRules(options: BridgeOptions): BridgeRules {
  return {
    rules_version: BRIDGE_RULES_VERSION, game: BRIDGE_LABEL, player_count: { min: 4, max: 4 },
    objective: "四人搭檔的正規合約橋牌：北南對東西，叫牌合法性由伺服器管、制度各自宣告，莊家主打、夢家攤牌，複式計分表含身價。",
    dealing: ["固定 4 人，椅子順時針為北、東、南、西，對面是搭檔。52 張牌每人 13 張，A 最大、2 最小。", "第一局北發牌，之後每局順時針輪換，發牌者先叫。無身價每局都無；四局制循環為都無、發牌方有、發牌方有、都有身價。四家全 PASS 同一人重發，身價不變、不計分、不增加局數。"],
    turn_flow: [
      "叫品由 1♣、1♦、1♥、1♠、1NT 到 7NT，共 35 種；必須高於目前最高叫品。伺服器只管合法性，制度各自宣告。",
      "有人叫過後連續三家 PASS 結束叫牌。賭倍預設開，無身價可以關；四局制一律開。最高叫品的對手隊可在未加倍時 Double，被 Double 的隊可 Redouble；更高叫品清除倍數，Double／Redouble 中斷連續 PASS。",
      "莊家是主打方那隊最先叫出合約花色（或 NT）的人，夢家是莊家的搭檔；莊家的下家首攻。首攻出牌後夢家攤牌，所有人都看得到，由莊家替夢家出牌。",
      "有首出花色必須跟，沒有才可出其他牌；合約花色是王牌，NT 無王。王牌優先，否則首出花色最大者贏。贏家收墩並先出下一墩，打滿 13 墩結算；局中離桌一律流局。",
      "主打方那隊取得 6＋合約線位墩才成約；成約主打方隊得分，倒約防守方隊得分，另一隊 0。同隊兩席位各記隊伍分，不做零和換算。",
    ],
    scoring: [
      { item: "合約墩分", none: "♣♦ 每墩 20、♥♠ 每墩 30、NT 第一墩 40 之後 30；Double ×2、Redouble ×4", vulnerable: "同左" },
      { item: "部分合約（墩分 <100）", none: "+50", vulnerable: "+50" },
      { item: "成局（墩分 ≥100）", none: "+300", vulnerable: "+500" },
      { item: "小滿貫（6 線成約）", none: "+500", vulnerable: "+750" },
      { item: "大滿貫（7 線成約）", none: "+1000", vulnerable: "+1500" },
      { item: "超墩（未加倍）", none: "♣♦ 每墩 20、♥♠／NT 每墩 30", vulnerable: "同左" },
      { item: "超墩（Double／Redouble）", none: "每墩 100／200", vulnerable: "每墩 200／400" },
      { item: "侮辱分（成約）", none: "Double +50、Redouble +100", vulnerable: "同左" },
      { item: "倒約（未加倍）", none: "每墩 50", vulnerable: "每墩 100" },
      { item: "倒約（Double）", none: "第 1 墩 100、第 2～3 墩各 200、第 4 墩起各 300", vulnerable: "第 1 墩 200、之後各 300" },
      { item: "倒約（Redouble）", none: "Double 的兩倍", vulnerable: "Double 的兩倍" },
    ],
    game_end: (options.end_mode === "rounds" ? `打滿 ${options.end_rounds} 局結算` : `任一隊累積分 ≥ ${options.end_score} 就結束`) + "，累積分最高的隊勝，同隊兩人並列；四局制建議局數填 4 的倍數。",
    table_options: BRIDGE_OPTION_DESCRIPTIONS.map((option) => ({ key: option.key, label: option.label, value: displayOptionValue(option, options[option.key as keyof BridgeOptions]), description: option.description })),
    agent_protocol: ["從最新 legal_plays 選 bid，cards 為一個叫品（例如 [\"2♥\"]）；play_card 的 cards 為一張牌（例如 [\"♠A\"]），可能是夢家的牌，從 legal_plays 照抄，輪到夢家時由莊家操作。pass／double／redouble 從 legal_actions 選，cards 為 []。", "bid_hint 只是建議，可以無視；叫牌仍以 legal_plays 為準。", "每次寫入使用最新 version 作為 expected_version，並產生新的 idempotency_key；重送同一請求沿用原本的鍵。"],
  };
}
export function formatBridgeRules(rules: BridgeRules): string {
  return [`${rules.game}規則表｜版本 ${rules.rules_version}`, `目標：${rules.objective}`, "人數與椅子、發牌與身價：", ...rules.dealing.map((s) => `- ${s}`),
    "叫牌、莊家與夢家、打牌：", ...rules.turn_flow.map((s) => `- ${s}`), "計分表：", "| 項目 | 無身價 | 有身價 |", "|---|---|---|",
    ...rules.scoring.map((row) => `| ${row.item} | ${row.none} | ${row.vulnerable} |`), `整場結束：${rules.game_end}`, "本桌選項：",
    ...rules.table_options.map((o) => `- ${o.label}：${o.value}（${o.description}）`), "Agent 協定：", ...rules.agent_protocol.map((s) => `- ${s}`)].join("\n");
}
