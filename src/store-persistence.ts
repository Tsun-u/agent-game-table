import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { MultiplayerTablePersistence } from "./multiplayer-store.js";

interface EncryptedStateEnvelope {
  readonly format: "agent-game-table-encrypted-state";
  readonly version: 1;
  readonly algorithm: "aes-256-gcm";
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class EncryptedFileTablePersistence implements MultiplayerTablePersistence {
  readonly #path: string;
  readonly #key: Buffer;

  constructor(path: string, stateKey: string) {
    this.#path = resolve(path);
    this.#key = decodeStateKey(stateKey);
  }

  load(): unknown | null {
    if (!existsSync(this.#path)) return null;
    let envelope: EncryptedStateEnvelope;
    try {
      envelope = JSON.parse(readFileSync(this.#path, "utf8")) as EncryptedStateEnvelope;
    } catch (error) {
      throw new Error(`無法讀取 Agent Game Table 加密狀態檔：${messageFrom(error)}`);
    }
    if (
      envelope.format !== "agent-game-table-encrypted-state" ||
      envelope.version !== 1 ||
      envelope.algorithm !== "aes-256-gcm"
    ) {
      throw new Error("Agent Game Table 加密狀態檔格式無效或版本不支援。");
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(envelope.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString("utf8")) as unknown;
    } catch {
      throw new Error("Agent Game Table 加密狀態檔無法解密；請確認 AGENT_GAME_TABLE_STATE_KEY 與建立檔案時相同。");
    }
  }

  save(snapshot: unknown): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]);
    const envelope: EncryptedStateEnvelope = {
      format: "agent-game-table-encrypted-state",
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#path);
  }
}

export function generateStateKey(): string {
  return randomBytes(32).toString("base64url");
}

function decodeStateKey(value: string): Buffer {
  const normalized = value.trim();
  if (!normalized) throw new Error("AGENT_GAME_TABLE_STATE_KEY 不可為空白。");
  let key: Buffer;
  try {
    key = Buffer.from(normalized, "base64url");
  } catch {
    throw new Error("AGENT_GAME_TABLE_STATE_KEY 必須是 32 bytes 的 Base64URL 字串。");
  }
  if (key.length !== 32) throw new Error("AGENT_GAME_TABLE_STATE_KEY 解碼後必須正好是 32 bytes。");
  return key;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
