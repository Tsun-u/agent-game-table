import { bigTwoEngine } from "./big-two-engine.js";
import type { GameEngine } from "./types.js";

const ENGINES: ReadonlyMap<string, GameEngine<unknown, unknown>> = new Map<string, GameEngine<unknown, unknown>>([
  [bigTwoEngine.mode, bigTwoEngine as GameEngine<unknown, unknown>],
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
