import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDeck } from "../src/cards.js";
import { MultiplayerTableStore } from "../src/multiplayer-store.js";
import { EncryptedFileTablePersistence, generateStateKey } from "../src/store-persistence.js";
import { seatAgent, seatHuman, tableVersion } from "./helpers.js";

test("encrypted persistence restores the human and principal-bound Agent seats without leaking tokens or cards", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-game-table-persistence-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "tables.enc.json");
  const stateKey = generateStateKey();
  const persistence = new EncryptedFileTablePersistence(path, stateKey);
  const store = new MultiplayerTableStore(() => createDeck(), { persistence });

  const created = store.createTable("阿童", { bombs_beat_anything: true, five_card_same_kind_only: true });
  seatHuman(store, created.human_token);
  const joined = store.joinAgentForPrincipal(created.table.join_code, "小葵", "static:xiaokui");
  seatAgent(store, joined.agent_token);
  const opened = store.startRound(created.human_token, tableVersion(store, created.human_token), "persist-start-0001");
  store.humanAction(created.human_token, "play_cards", opened.version, "persist-human-play-1", ["♣3"]);

  const ciphertext = await readFile(path, "utf8");
  assert.doesNotMatch(ciphertext, new RegExp(created.human_token));
  assert.doesNotMatch(ciphertext, new RegExp(joined.agent_token));
  assert.equal(ciphertext.includes("♣4"), false, "private cards must not appear in the encrypted envelope");
  assert.equal(ciphertext.includes("小葵"), false, "player names must not appear in the encrypted envelope");

  const restored = new MultiplayerTableStore(() => createDeck(), {
    persistence: new EncryptedFileTablePersistence(path, stateKey),
  });
  const humanView = restored.getHumanView(created.human_token);
  assert.equal(humanView.table_id, created.table.table_id);
  assert.deepEqual(humanView.rule_options, { bombs_beat_anything: true, five_card_same_kind_only: true }, "host options survive a restart");
  assert.equal(humanView.active_seat_id, joined.table.viewer_seat_id);

  const resumed = restored.joinAgentForPrincipal(created.table.join_code, "小葵", "static:xiaokui");
  assert.equal(resumed.table.viewer_seat_id, joined.table.viewer_seat_id);
  assert.equal(resumed.table.legal_actions.includes("play_cards"), true);
  assert.throws(() => restored.getAgentView(joined.agent_token), /憑證無效/);
  assert.throws(
    () => restored.joinAgentForPrincipal(created.table.join_code, "冒牌小葵", "static:xiaokui"),
    /名稱不符/,
  );
});

test("an encrypted state file rejects the wrong key", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-game-table-wrong-key-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "tables.enc.json");
  const persistence = new EncryptedFileTablePersistence(path, generateStateKey());
  new MultiplayerTableStore(undefined, { persistence }).createTable("阿童");

  assert.throws(
    () => new MultiplayerTableStore(undefined, { persistence: new EncryptedFileTablePersistence(path, generateStateKey()) }),
    /無法解密/,
  );
});
