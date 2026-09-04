import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createDeck } from "../src/cards.js";
import { MultiplayerTableStore, type MultiplayerTablePersistence } from "../src/multiplayer-store.js";

/** test/fixtures/snapshot-v1.json 是引擎抽出前的程式產生的：一桌三人局中（阿童已出 ♣3、留牌 ♠2、一位觀戰者）、一桌大廳。 */
async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(new URL("../../test/fixtures/snapshot-v1.json", import.meta.url), "utf8"));
}

test("a version 1 snapshot is migrated into engine state and re-saved as version 2", async () => {
  const fixture = await loadFixture();
  let saved: Record<string, unknown> | null = null;
  const persistence: MultiplayerTablePersistence = { load: () => fixture, save: (snapshot) => { saved = snapshot as Record<string, unknown>; } };
  const store = new MultiplayerTableStore(() => createDeck(), { persistence });

  const tables = store.listTables();
  assert.equal(tables.length, 2);
  const live = tables.find((table) => table.round === 1)!;
  assert.equal(live.phase, "in_round", "player_turns becomes in_round");
  assert.equal(live.mode, "bigtwo");
  assert.equal(live.rule_label, "大老二");
  assert.equal(live.player_count, 3);
  assert.equal(live.spectator_count, 1);
  assert.equal(live.active_player_name, "小光", "the turn order survives the migration");
  const idle = tables.find((table) => table.round === 0)!;
  assert.equal(idle.phase, "lobby");

  // 遷移後的第一次寫入就是 v2：局狀態收進 game，座位不再帶手牌。
  store.closeTable(idle.table_id);
  assert.ok(saved);
  const snapshot = saved as { version: number; tables: Array<{ game: { hands: Record<string, string[]>; setAside: string[]; currentPlay: string[] } | null; seats: Array<Record<string, unknown>>; phase: string }> };
  assert.equal(snapshot.version, 2);
  const migrated = snapshot.tables[0]!;
  assert.equal(migrated.phase, "in_round");
  assert.ok(migrated.game);
  assert.deepEqual(Object.values(migrated.game!.hands).map((hand) => hand.length).sort(), [16, 17, 17]);
  assert.deepEqual(migrated.game!.setAside, ["♠2"]);
  assert.deepEqual(migrated.game!.currentPlay, ["♣3"]);
  assert.equal(migrated.seats.every((seat) => !("cards" in seat) && !("status" in seat)), true);

  // 再載入一次 v2，仍然是同一桌同一局。
  const reloaded = new MultiplayerTableStore(() => createDeck(), { persistence: { load: () => saved, save: () => undefined } });
  const again = reloaded.listTables();
  assert.equal(again.length, 1);
  assert.equal(again[0]!.active_player_name, "小光");
});
