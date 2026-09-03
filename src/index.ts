#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createAgentGameTableMcpServer } from "./mcp-server.js";

const server = createAgentGameTableMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
