import type { Card } from "../cards.js";

/** 席位對引擎送出的一個動作；hand_seat_id 留給橋牌莊家替夢家出牌，目前沒有引擎使用。 */
export interface SeatAction {
  readonly action: string;
  readonly cards: readonly string[];
  readonly hand_seat_id?: string;
}

export interface LegalAction {
  readonly action: string;
  readonly label: string;
}

/** 伺服器算好的一組可出牌；action 預設 play_cards，亮牌、傳牌等也走這個形狀。 */
export interface LegalPlay {
  readonly action: string;
  readonly cards: readonly string[];
  readonly label: string;
}

export interface RoundResult {
  readonly winnerSeatId: string | null;
  /** seatId → 本局分數增減；沒列的席位視為 0。 */
  readonly scoreDelta: Readonly<Record<string, number>>;
  /** 整場結束（例如拱豬有人到 -1000）；大老二永遠 false。 */
  readonly gameOver: boolean;
  /** 局結束的公告，同樣支援 {name}（贏家）與 {round}。 */
  readonly text: string;
}

/** 事件文字裡的 {name} 由牌桌層換成該席位的名字、{round} 換成局數；沒有席位時 {name} 會被拿掉。 */
export interface EngineEvent {
  readonly kind: string;
  readonly seatId: string | null;
  readonly text: string;
}

export interface EngineTransition<State> {
  readonly state: State;
  readonly events: readonly EngineEvent[];
  readonly result: RoundResult | null;
}

export interface OptionDescription {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly default: boolean;
}

/** 各引擎的規則物件只保證這兩個欄位，其餘欄位由引擎自訂。 */
export interface GameRules {
  readonly rules_version: string;
  readonly game: string;
}

/** 引擎回給視圖的桌面；每款遊戲形狀不同，牌桌層只負責轉交。 */
export interface GameBoardView {
  readonly phase: string;
  readonly [key: string]: unknown;
}

export interface DealInput {
  readonly deck: readonly Card[];
  readonly seatIds: readonly string[];
  readonly round: number;
}

/**
 * 遊戲引擎：從發牌到結算的一切都在這裡，狀態是可序列化的普通物件。
 * 牌桌層負責成員、席位、憑證、版本、冪等、等待喚醒、事件信封、聊天與持久化。
 */
export interface GameEngine<State = unknown, Options = unknown> {
  readonly mode: string;
  readonly label: string;
  readonly rulesVersion: string;
  readonly seats: { readonly min: number; readonly max: number; readonly fixed: boolean };
  readonly optionDescriptions: readonly OptionDescription[];
  normalizeOptions(value: unknown): Options;
  buildRules(options: Options): GameRules;
  formatRules(rules: GameRules): string;

  deal(input: DealInput, options: Options): EngineTransition<State>;
  /** 現在可以行動的席位；大老二永遠 0 或 1 個，傳牌、叫牌類階段可以多個。 */
  pendingSeatIds(state: State): readonly string[];
  legalActions(state: State, seatId: string, options: Options): readonly LegalAction[];
  legalPlays(state: State, seatId: string, options: Options): readonly LegalPlay[];
  apply(state: State, seatId: string, action: SeatAction, options: Options): EngineTransition<State>;
  /** 局中有人離桌：回傳接續後的狀態，或 "abort" 表示本局流局。 */
  onSeatRemoved(state: State, seatId: string, options: Options): EngineTransition<State> | "abort";
  view(state: State, viewerSeatId: string | null, options: Options): GameBoardView;
  hand(state: State, seatId: string): readonly string[];
  serialize(state: State): unknown;
  restore(saved: unknown): State;
}
