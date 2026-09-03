import { randomUUID } from "node:crypto";

import type { MultiplayerTableStore, PublicTableView } from "../src/multiplayer-store.js";

/** 測試用：人類成員入座（新模型裡加入牌桌只是觀戰）。 */
export function seatHuman(store: MultiplayerTableStore, humanToken: string): PublicTableView {
  return store.humanTakeSeat(humanToken, store.getHumanView(humanToken).version, `seat-${randomUUID()}`);
}

export function seatAgent(store: MultiplayerTableStore, agentToken: string): PublicTableView {
  return store.agentTakeSeat(agentToken, store.getAgentView(agentToken).version, `seat-${randomUUID()}`);
}

export function tableVersion(store: MultiplayerTableStore, humanToken: string): number {
  return store.getHumanView(humanToken).version;
}
