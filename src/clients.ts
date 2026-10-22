import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ClientId = "claude-desktop" | "claude-code" | "cursor" | "windsurf" | "vscode" | "gemini-cli";

export const CLIENT_IDS: readonly ClientId[] = ["claude-desktop", "claude-code", "cursor", "windsurf", "vscode", "gemini-cli"];

export const CLIENT_LABELS: Record<ClientId, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  windsurf: "Windsurf",
  vscode: "VS Code",
  "gemini-cli": "Gemini CLI",
};

export interface ServerCommand {
  command: string;
  args: string[];
}

export const SERVER_KEY = "lightburn";

/** The current Node binary plus this package's dist/index.js. */
export function defaultServerCommand(): ServerCommand {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Works both from dist/ (built) and src/ (tests via tsx/vitest).
  const root = path.basename(here) === "dist" || path.basename(here) === "src" ? path.dirname(here) : here;
  return { command: process.execPath, args: [path.join(root, "dist", "index.js")] };
}

export function configPath(
  client: ClientId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string | null {
  const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
  const appSupport = path.join(home, "Library", "Application Support");
  switch (client) {
    case "claude-desktop":
      return platform === "win32" ? path.join(appData, "Claude", "claude_desktop_config.json") : path.join(appSupport, "Claude", "claude_desktop_config.json");
    case "claude-code":
      return null;
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "windsurf":
      return path.join(home, ".codeium", "windsurf", "mcp_config.json");
    case "vscode":
      if (platform === "win32") return path.join(appData, "Code", "User", "mcp.json");
      if (platform === "darwin") return path.join(appSupport, "Code", "User", "mcp.json");
      return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Code", "User", "mcp.json");
    case "gemini-cli":
      return path.join(home, ".gemini", "settings.json");
  }
}

function entryFor(client: ClientId, cmd: ServerCommand): Record<string, unknown> {
  return client === "vscode" ? { type: "stdio", command: cmd.command, args: cmd.args } : { command: cmd.command, args: cmd.args };
}

function rootKey(client: ClientId): "servers" | "mcpServers" {
  return client === "vscode" ? "servers" : "mcpServers";
}

export function renderSnippet(client: ClientId, cmd: ServerCommand): string {
  return JSON.stringify({ [rootKey(client)]: { [SERVER_KEY]: entryFor(client, cmd) } }, null, 2);
}

/** Returns the new file text with the lightburn entry added or replaced; other content is preserved. */
export function mergeIntoFile(client: ClientId, existingText: string | null, cmd: ServerCommand): string {
  let doc: Record<string, unknown> = {};
  if (existingText && existingText.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existingText);
    } catch {
      throw new Error("The existing config file is not valid JSON. Fix or remove it, then run again.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The existing config file does not contain a JSON object.");
    }
    doc = parsed as Record<string, unknown>;
  }
  const key = rootKey(client);
  const servers = doc[key] && typeof doc[key] === "object" && !Array.isArray(doc[key]) ? (doc[key] as Record<string, unknown>) : {};
  doc[key] = { ...servers, [SERVER_KEY]: entryFor(client, cmd) };
  return JSON.stringify(doc, null, 2) + "\n";
}

export function claudeCodeCommand(cmd: ServerCommand): string {
  const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  return `claude mcp add --scope user ${SERVER_KEY} -- ${[cmd.command, ...cmd.args].map(q).join(" ")}`;
}
