import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, SERVER_VERSION } from "./server.js";
import { createToolContext, type ToolContext } from "./tools/context.js";

export interface CliIo {
  log: (s: string) => void;
  error: (s: string) => void;
}

export interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean>;
  positional: string[];
}

const COMMANDS = new Set(["setup", "pair", "status", "config", "token"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--") && ["port", "host", "token", "capabilities"].includes(a.slice(2))) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else if (command === null && !positional.length) {
      command = a;
    } else {
      positional.push(a);
    }
  }
  return { command, flags, positional };
}

export const HELP = `lightburn-mcp ${SERVER_VERSION} — MCP server for the LightBurn / MillMage REST API

Usage:
  lightburn-mcp                      Start the MCP server on stdio (for Claude Desktop, Cursor, ...)
  lightburn-mcp --http [--port N] [--host H] [--token T]
                                     Start the MCP server over Streamable HTTP (token required)
  lightburn-mcp setup                Interactive: pair with LightBurn and configure MCP clients
  lightburn-mcp pair [--capabilities state,project,upload,project_write]
                                     Pair with the running LightBurn (shows a consent dialog)
  lightburn-mcp status               Show pairing state and whether LightBurn is reachable
  lightburn-mcp config <client> [--write]
                                     Print (or write) the MCP config for a client:
                                     claude-desktop, claude-code, cursor, windsurf, vscode, gemini-cli
  lightburn-mcp token [--rotate]     Show or rotate the HTTP access token
  lightburn-mcp --version | --help

Environment: LIGHTBURN_SECRET, LIGHTBURN_HOST, LIGHTBURN_PRODUCT (lightburn|millmage), LIGHTBURN_MCP_CONFIG_DIR
`;

export async function runStdio(ctx: ToolContext): Promise<number> {
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
  return 0;
}

export async function main(argv: string[], io: CliIo = { log: (s) => console.log(s), error: (s) => console.error(s) }): Promise<number> {
  const args = parseArgs(argv);
  if (args.flags.version) {
    io.log(SERVER_VERSION);
    return 0;
  }
  if (args.flags.help || args.command === "help") {
    io.log(HELP);
    return 0;
  }
  const ctx = createToolContext();

  if (args.command === null) {
    if (args.flags.http) {
      const { runHttpCommand } = await import("./http.js");
      return runHttpCommand(ctx, args.flags, io);
    }
    return runStdio(ctx);
  }
  if (!COMMANDS.has(args.command)) {
    io.error(`Unknown command "${args.command}".\n\n${HELP}`);
    return 2;
  }
  const { runCommand } = await import("./setup.js");
  return runCommand(args, ctx, io);
}
