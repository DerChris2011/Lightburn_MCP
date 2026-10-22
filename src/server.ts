import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";
import type { ToolContext } from "./tools/context.js";
import { registerProjectTools } from "./tools/project.js";
import { registerStateTools } from "./tools/state.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const SERVER_VERSION: string = pkg.version;

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "lightburn-mcp", version: SERVER_VERSION },
    {
      instructions:
        "Tools for the LightBurn / MillMage REST API. The API cannot start, stop or move the machine. " +
        "Any cut setting changed through this server must be reviewed by the operator in LightBurn before running a job.",
    },
  );
  registerStateTools(server, ctx);
  registerProjectTools(server, ctx);
  return server;
}
