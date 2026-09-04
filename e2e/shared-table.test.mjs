import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";

import { chromium } from "playwright-core";

import { createDeck } from "../dist/src/cards.js";
import { AgentGameTableHostClient } from "../dist/src/host-client.js";
import { startAgentGameTableHost } from "../dist/src/host-server.js";
import { MultiplayerTableStore } from "../dist/src/multiplayer-store.js";
import { StaticTokenAuthenticator } from "../dist/src/remote-auth.js";
import { RemoteMcpGateway } from "../dist/src/remote-mcp.js";
import { EncryptedFileTablePersistence, generateStateKey } from "../dist/src/store-persistence.js";

test("the real browser UI stays usable when Agents leave or are removed", async (context) => {
  const store = new MultiplayerTableStore(() => createDeck());
  const host = await startAgentGameTableHost({ port: 0, store });
  const profileDir = await mkdtemp(join(tmpdir(), "agent-game-table-e2e-"));
  let browserContext = await chromium.launchPersistentContext(profileDir, browserLaunchOptions());
  let page = browserContext.pages()[0] ?? await browserContext.newPage();
  context.after(async () => {
    await browserContext.close().catch(() => undefined);
    await host.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  await page.goto(host.url);
  await page.getByLabel("你的名字").fill("阿童");
  await page.getByRole("button", { name: "建立共桌牌局" }).click();
  await page.locator("#tablePanel").waitFor({ state: "visible" });
  const joinCode = (await page.locator("#joinCode").innerText()).trim();

  await browserContext.close();
  browserContext = await chromium.launchPersistentContext(profileDir, browserLaunchOptions());
  page = browserContext.pages()[0] ?? await browserContext.newPage();
  await page.goto(host.url);
  await page.locator("#tablePanel").waitFor({ state: "visible" });
  assert.equal((await page.locator("#joinCode").innerText()).trim(), joinCode, "the human resumes after a browser restart");

  await page.getByRole("button", { name: "入座" }).click();
  await waitForSeatCount(page, 1);
  const firstClient = new AgentGameTableHostClient(host.url);
  const secondClient = new AgentGameTableHostClient(host.url);
  const firstEntered = await firstClient.joinAgent(joinCode, "小葵");
  const first = { ...firstEntered, table: await firstClient.takeSeat(firstEntered.agent_token, firstEntered.table.version, "e2e-seat-a") };
  const secondEntered = await secondClient.joinAgent(joinCode, "阿宇");
  const second = { ...secondEntered, table: await secondClient.takeSeat(secondEntered.agent_token, secondEntered.table.version, "e2e-seat-b") };
  await waitForSeatCount(page, 3);

  await page.getByRole("button", { name: "開始牌局" }).click();
  await page.getByText("輪到 阿童", { exact: true }).waitFor();
  await page.locator(".playing-card.dealt").first().waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".playing-card.dealt").first().evaluate((card) => getComputedStyle(card).animationName),
    "deal-card",
    "new cards use the functional deal animation",
  );
  const openingCard = page.locator(".playing-card.selectable").filter({ hasText: "3" }).first();
  await openingCard.click();
  await page.getByRole("button", { name: /出牌/ }).click();
  await page.getByText("輪到 小葵", { exact: true }).waitFor();
  assert.equal(await page.locator('[aria-label="暗牌"]').count() > 0, true, "opponents are rendered as card backs");

  await secondClient.waitForEvents(second.agent_token, 0);
  const departure = await firstClient.leaveAgent(first.agent_token);
  assert.equal(departure.left, true);
  const secondNotice = await secondClient.waitForEvents(second.agent_token, 0);
  assert.equal(secondNotice.events.some((event) => event.kind === "seat_left" && event.actor_name === "小葵"), true);
  assert.equal(secondNotice.table.active_seat_id, second.table.viewer_seat_id);
  await waitForSeatCount(page, 2);
  await page.getByText("輪到 阿宇", { exact: true }).waitFor();

  await secondClient.leaveAgent(second.agent_token);
  await page.getByText("本局結束，可以再開一局", { exact: true }).waitFor();
  await page.locator("#roundCelebration.is-visible").waitFor({ state: "visible" });
  await page.locator("#roundCelebrationAnimation svg").waitFor({ state: "visible" });
  assert.equal(await page.locator("#roundCelebrationAnimation svg").count(), 1, "the local Lottie renderer draws the result flourish");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#roundCelebration").waitFor({ state: "hidden" });

  const returned = await firstClient.joinAgent(joinCode, "小葵");
  assert.notEqual(returned.table.viewer_seat_id, departure.seat_id);
  await firstClient.takeSeat(returned.agent_token, returned.table.version, "e2e-seat-return");
  await waitForSeatCount(page, 2);
  const returnedRow = page.locator(".roster-row").filter({ hasText: "小葵" });
  page.once("dialog", (dialog) => dialog.accept());
  await returnedRow.getByRole("button", { name: "移除" }).click();
  await waitForSeatCount(page, 1);
  await assert.rejects(() => firstClient.getAgentView(returned.agent_token), /憑證無效/);
  assert.equal(await page.locator(".roster-row").filter({ hasText: "小葵" }).count(), 0);
});

test("a stale human resume token is cleared after the in-memory Host restarts", async (context) => {
  let host = await startAgentGameTableHost({ port: 0 });
  const port = host.port;
  const profileDir = await mkdtemp(join(tmpdir(), "agent-game-table-e2e-stale-"));
  const browserContext = await chromium.launchPersistentContext(profileDir, browserLaunchOptions());
  const page = browserContext.pages()[0] ?? await browserContext.newPage();
  context.after(async () => {
    await browserContext.close().catch(() => undefined);
    await host.close().catch(() => undefined);
    await rm(profileDir, { recursive: true, force: true });
  });

  await page.goto(host.url);
  await page.getByRole("button", { name: "建立共桌牌局" }).click();
  await page.locator("#tablePanel").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => Boolean(localStorage.getItem("agent_game_table_human_tokens_v1"))), true);

  await host.close();
  host = await startAgentGameTableHost({ port });
  await page.reload();
  await page.locator("#setupPanel").waitFor({ state: "visible" });
  await page.getByText("原本的牌桌已不存在，請重新開桌。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("agent_game_table_human_tokens_v1")), null);
});

test("one browser profile can create and operate multiple tables in separate tabs", async (context) => {
  const host = await startAgentGameTableHost({ port: 0 });
  const profileDir = await mkdtemp(join(tmpdir(), "agent-game-table-e2e-multi-table-"));
  const browserContext = await chromium.launchPersistentContext(profileDir, browserLaunchOptions());
  const lobby = browserContext.pages()[0] ?? await browserContext.newPage();
  context.after(async () => {
    await browserContext.close().catch(() => undefined);
    await host.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  await lobby.goto(host.url);
  await lobby.getByLabel("你的名字").fill("A 桌人類");
  await lobby.getByRole("button", { name: "建立共桌牌局" }).click();
  await lobby.locator("#tablePanel").waitFor({ state: "visible" });
  const firstCode = (await lobby.locator("#joinCode").innerText()).trim();
  await lobby.getByRole("button", { name: "回大廳" }).click();
  await lobby.locator("#managementPanel").waitFor({ state: "visible" });

  await lobby.getByLabel("你的名字").fill("B 桌人類");
  await lobby.getByRole("button", { name: "建立共桌牌局" }).click();
  await lobby.locator("#tablePanel").waitFor({ state: "visible" });
  const secondCode = (await lobby.locator("#joinCode").innerText()).trim();
  assert.notEqual(secondCode, firstCode);
  await lobby.getByRole("button", { name: "回大廳" }).click();
  await lobby.locator(".management-card").first().waitFor();
  await lobby.locator(".lobby-card").first().waitFor();
  assert.equal(await lobby.locator(".lobby-card").count(), 2, "the lobby lists every table without an admin key");
  assert.equal(await lobby.locator(".lobby-joined").count(), 2, "both tables were created in this browser");
  assert.equal(await lobby.locator(".management-card").count(), 2);
  assert.equal(await lobby.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("agent_game_table_human_tokens_v1") || "{}")).length), 2);

  const firstCard = lobby.locator(".management-card").filter({ hasText: firstCode });
  const firstHref = await firstCard.getByRole("link", { name: "另開牌桌" }).getAttribute("href");
  assert.ok(firstHref);
  const firstTablePage = await browserContext.newPage();
  await firstTablePage.goto(new URL(firstHref, host.url).toString());
  await firstTablePage.locator("#tablePanel").waitFor({ state: "visible" });
  assert.equal((await firstTablePage.locator("#joinCode").innerText()).trim(), firstCode);

  lobby.once("dialog", (dialog) => dialog.accept());
  await firstCard.getByRole("button", { name: "關閉牌桌" }).click();
  await lobby.waitForFunction((code) => ![...document.querySelectorAll(".management-card")].some((card) => card.textContent?.includes(code)), firstCode);
  assert.equal(await lobby.locator(".management-card").count(), 1);
  assert.equal(await lobby.locator(".management-card").filter({ hasText: secondCode }).count(), 1);
  await firstTablePage.getByText("原本的牌桌已不存在，請重新開桌。", { exact: true }).waitFor();
});

test("the remote human resumes after both the browser and encrypted Host restart", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-game-table-e2e-remote-"));
  const profileDir = join(directory, "chrome-profile");
  const statePath = join(directory, "state.enc.json");
  const stateKey = generateStateKey();
  const humanAccessKey = "human-e2e-remote-access-key-000000000001";
  const port = await availablePort();
  const publicUrl = `http://127.0.0.1:${port}`;
  const authenticator = new StaticTokenAuthenticator({ e2e: "agent-e2e-remote-token-0000000000000001" });

  let remote = await startRemoteHost({ port, publicUrl, statePath, stateKey, humanAccessKey, authenticator });
  let browserContext = await chromium.launchPersistentContext(profileDir, browserLaunchOptions());
  let page = browserContext.pages()[0] ?? await browserContext.newPage();
  context.after(async () => {
    await browserContext.close().catch(() => undefined);
    await remote.gateway.close().catch(() => undefined);
    await remote.host.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  await page.goto(publicUrl);
  await page.getByLabel("通關密語").waitFor({ state: "visible" });
  await page.getByLabel("通關密語").fill(humanAccessKey);
  await page.getByRole("button", { name: "建立共桌牌局" }).click();
  await page.locator("#tablePanel").waitFor({ state: "visible" });
  const joinCode = (await page.locator("#joinCode").innerText()).trim();

  await browserContext.close();
  await remote.gateway.close();
  await remote.host.close();
  remote = await startRemoteHost({ port, publicUrl, statePath, stateKey, humanAccessKey, authenticator });
  browserContext = await chromium.launchPersistentContext(profileDir, browserLaunchOptions());
  page = browserContext.pages()[0] ?? await browserContext.newPage();
  await page.goto(publicUrl);
  await page.locator("#tablePanel").waitFor({ state: "visible" });
  assert.equal((await page.locator("#joinCode").innerText()).trim(), joinCode);
  assert.equal(await page.evaluate(() => Boolean(localStorage.getItem("agent_game_table_human_tokens_v1"))), true);
});

function browserLaunchOptions() {
  const executablePath = process.env.AGENT_GAME_TABLE_BROWSER_EXECUTABLE;
  if (executablePath) return { executablePath, headless: true };
  return { channel: process.env.AGENT_GAME_TABLE_BROWSER_CHANNEL || "chrome", headless: true };
}

async function waitForSeatCount(page, expected) {
  await page.waitForFunction(
    (count) => document.querySelector("#seatCount")?.textContent === String(count),
    expected,
  );
}

async function startRemoteHost({ port, publicUrl, statePath, stateKey, humanAccessKey, authenticator }) {
  const store = new MultiplayerTableStore(undefined, {
    persistence: new EncryptedFileTablePersistence(statePath, stateKey),
  });
  const gateway = new RemoteMcpGateway({ store, authenticator, publicUrl, humanAccessKey });
  const host = await startAgentGameTableHost({ hostname: "127.0.0.1", port, store, extension: gateway });
  return { gateway, host };
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a TCP port.");
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}
