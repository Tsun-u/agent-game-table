#!/usr/bin/env node

import { startAgentGameTableHost } from "./host-server.js";

const configuredPort = Number(process.env.AGENT_GAME_TABLE_HOST_PORT ?? "3210");
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error("AGENT_GAME_TABLE_HOST_PORT 必須是 1 到 65535 的整數。");
}

const host = await startAgentGameTableHost({ port: configuredPort });
console.log(`Agent Game Table shared table host: ${host.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void host.close().finally(() => process.exit(0));
  });
}
