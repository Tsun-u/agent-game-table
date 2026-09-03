import { randomBytes } from "node:crypto";

const agentNames = process.argv.slice(2).map((name) => name.trim()).filter(Boolean);
if (!agentNames.length) agentNames.push("agent-1");
if (new Set(agentNames).size !== agentNames.length) throw new Error("Agent 名稱不可重複。");
const stateKey = randomBytes(32).toString("base64url");
const humanAccessKey = randomBytes(32).toString("base64url");
const agentTokens = Object.fromEntries(agentNames.map((name) => [name, randomBytes(32).toString("base64url")]));

console.log(`AGENT_GAME_TABLE_STATE_KEY=${stateKey}`);
console.log(`AGENT_GAME_TABLE_HUMAN_ACCESS_KEY=${humanAccessKey}`);
console.log("remote-keys.json:");
console.log(JSON.stringify(agentTokens, null, 2));
