import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";
import { INSTRUCTIONS, registerKnowledge } from "./knowledge/index.js";
import type { ToolContext } from "./tools/context.js";
import { registerCutTools } from "./tools/cuts.js";
import { registerFileTools } from "./tools/files.js";
import { registerPairingTools } from "./tools/pairing.js";
import { registerProjectTools } from "./tools/project.js";
import { registerStateTools } from "./tools/state.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const SERVER_VERSION: string = pkg.version;

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "lightburn-mcp", version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerKnowledge(server);
  registerPairingTools(server, ctx);
  registerStateTools(server, ctx);
  registerProjectTools(server, ctx);
  registerCutTools(server, ctx);
  registerFileTools(server, ctx);
  return server;
}
