import { bigTwoEngine } from "./big-two-engine.js";
import { gongzhuEngine, heartsEngine } from "./gongzhu-engine.js";
import { jianhongdianEngine } from "./jianhongdian-engine.js";
import { paiqiEngine } from "./paiqi-engine.js";
import { honeymoonEngine } from "./honeymoon-engine.js";
import { lightbridgeEngine } from "./lightbridge-engine.js";
import type { GameEngine } from "./types.js";

const ENGINES: ReadonlyMap<string, GameEngine<unknown, unknown>> = new Map<string, GameEngine<unknown, unknown>>([
  [bigTwoEngine.mode, bigTwoEngine as GameEngine<unknown, unknown>],
  [gongzhuEngine.mode, gongzhuEngine as GameEngine<unknown, unknown>],
  [heartsEngine.mode, heartsEngine as GameEngine<unknown, unknown>],
  [jianhongdianEngine.mode, jianhongdianEngine as GameEngine<unknown, unknown>],
  [paiqiEngine.mode, paiqiEngine as GameEngine<unknown, unknown>],
  [honeymoonEngine.mode, honeymoonEngine as GameEngine<unknown, unknown>],
  [lightbridgeEngine.mode, lightbridgeEngine as GameEngine<unknown, unknown>],
]);

export const DEFAULT_GAME_MODE = bigTwoEngine.mode;

export function engineFor(mode: string): GameEngine<unknown, unknown> {
  const engine = ENGINES.get(mode);
  if (!engine) throw new Error(`不支援的遊戲：${mode}。`);
  return engine;
}

export function listEngines(): readonly GameEngine<unknown, unknown>[] {
  return [...ENGINES.values()];
}
