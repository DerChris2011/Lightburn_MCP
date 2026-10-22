import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LightBurnClient } from "../src/client.js";
import { claudeCodeCommand, configPath, defaultServerCommand, mergeIntoFile, renderSnippet, type ServerCommand } from "../src/clients.js";
import { loadConfig, saveConfig } from "../src/config.js";
import { runCommand, runSetup } from "../src/setup.js";
import { createToolContext } from "../src/tools/context.js";
import { startMockLightBurn, type MockLightBurn } from "./helpers/mock-lightburn.js";

const cmd: ServerCommand = { command: "C:\\node\\node.exe", args: ["C:\\pkg\\dist\\index.js"] };

test("configPath per client and platform", () => {
  const winEnv = { APPDATA: "C:\\Users\\u\\AppData\\Roaming" };
  expect(configPath("claude-desktop", "win32", winEnv, "C:\\Users\\u")).toBe(path.join("C:\\Users\\u\\AppData\\Roaming", "Claude", "claude_desktop_config.json"));
  expect(configPath("claude-desktop", "darwin", {}, "/Users/u")).toBe(path.join("/Users/u", "Library", "Application Support", "Claude", "claude_desktop_config.json"));
  expect(configPath("cursor", "darwin", {}, "/Users/u")).toBe(path.join("/Users/u", ".cursor", "mcp.json"));
  expect(configPath("windsurf", "win32", winEnv, "C:\\Users\\u")).toBe(path.join("C:\\Users\\u", ".codeium", "windsurf", "mcp_config.json"));
  expect(configPath("vscode", "win32", winEnv, "C:\\Users\\u")).toBe(path.join("C:\\Users\\u\\AppData\\Roaming", "Code", "User", "mcp.json"));
  expect(configPath("vscode", "darwin", {}, "/Users/u")).toBe(path.join("/Users/u", "Library", "Application Support", "Code", "User", "mcp.json"));
  expect(configPath("gemini-cli", "darwin", {}, "/Users/u")).toBe(path.join("/Users/u", ".gemini", "settings.json"));
  expect(configPath("claude-code", "darwin", {}, "/Users/u")).toBeNull();
});

test("mergeIntoFile preserves existing servers and adds lightburn", () => {
  const out = mergeIntoFile("claude-desktop", '{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}', cmd);
  const parsed = JSON.parse(out);
  expect(parsed.mcpServers.other.command).toBe("x");
  expect(parsed.theme).toBe("dark");
  expect(parsed.mcpServers.lightburn).toEqual({ command: cmd.command, args: cmd.args });
});

test("mergeIntoFile creates a fresh file from null and replaces an old lightburn entry", () => {
  expect(JSON.parse(mergeIntoFile("cursor", null, cmd))).toEqual({ mcpServers: { lightburn: { command: cmd.command, args: cmd.args } } });
  const replaced = JSON.parse(mergeIntoFile("cursor", '{"mcpServers":{"lightburn":{"command":"old","args":[]}}}', cmd));
  expect(replaced.mcpServers.lightburn.command).toBe(cmd.command);
});

test("mergeIntoFile rejects a file that is not valid JSON", () => {
  expect(() => mergeIntoFile("cursor", "{not json", cmd)).toThrow(/not valid JSON/);
});

test("vscode uses the servers key with type stdio", () => {
  const parsed = JSON.parse(mergeIntoFile("vscode", '{"servers":{"foo":{"type":"http","url":"u"}}}', cmd));
  expect(parsed.servers.foo.url).toBe("u");
  expect(parsed.servers.lightburn).toEqual({ type: "stdio", command: cmd.command, args: cmd.args });
  expect(parsed.mcpServers).toBeUndefined();
});

test("renderSnippet is the JSON a user can paste", () => {
  const snippet = JSON.parse(renderSnippet("gemini-cli", cmd));
  expect(snippet.mcpServers.lightburn.args).toEqual(cmd.args);
  expect(JSON.parse(renderSnippet("vscode", cmd)).servers.lightburn.type).toBe("stdio");
});

test("claudeCodeCommand quotes the executable and script", () => {
  expect(claudeCodeCommand(cmd)).toBe('claude mcp add --scope user lightburn -- "C:\\node\\node.exe" "C:\\pkg\\dist\\index.js"');
});

test("defaultServerCommand points at this package's dist/index.js with the current node", () => {
  const d = defaultServerCommand();
  expect(d.command).toBe(process.execPath);
  expect(d.args).toHaveLength(1);
  expect(d.args[0]).toMatch(/dist[\\/]index\.js$/);
  expect(path.isAbsolute(d.args[0])).toBe(true);
});

// ---- setup / subcommands against the mock ----

let tmpCfg: string;
let tmpHome: string;
let mock: MockLightBurn;
const savedEnv = { ...process.env };

beforeEach(async () => {
  tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-setup-cfg-"));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-setup-home-"));
  process.env.LIGHTBURN_MCP_CONFIG_DIR = tmpCfg;
  delete process.env.LIGHTBURN_SECRET;
  mock = await startMockLightBurn({ secret: "setup-secret" });
});

afterEach(async () => {
  await mock.close();
  process.env = { ...savedEnv };
  fs.rmSync(tmpCfg, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function ctxForMock() {
  return createToolContext({
    client: () => {
      const cfg = loadConfig();
      return new LightBurnClient({ host: "127.0.0.1", port: mock.port, secret: cfg.secret });
    },
  });
}

function scriptedIo(answers: string[]) {
  const log: string[] = [];
  return {
    io: {
      ask: async (_q: string, def?: string) => {
        const a = answers.shift();
        return a === undefined || a === "" ? (def ?? "") : a;
      },
      log: (s: string) => log.push(s),
      error: (s: string) => log.push(s),
    },
    log,
  };
}

test("runSetup pairs and writes a backup before overwriting an existing client config", async () => {
  const cursorFile = path.join(tmpHome, ".cursor", "mcp.json");
  fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
  fs.writeFileSync(cursorFile, '{"mcpServers":{"other":{"command":"x"}}}');

  const { io, log } = scriptedIo(["", "", "cursor"]); // product default, capabilities default, clients: cursor
  const code = await runSetup(io, ctxForMock(), { platform: "darwin", env: {}, home: tmpHome, serverCommand: cmd, hasClaudeCli: false });
  expect(code).toBe(0);

  expect(loadConfig().secret).toBe("setup-secret");
  expect(loadConfig().capabilities).toEqual(["state", "project", "upload", "project_write"]);
  const written = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
  expect(written.mcpServers.other.command).toBe("x");
  expect(written.mcpServers.lightburn.args).toEqual(cmd.args);
  const backups = fs.readdirSync(path.dirname(cursorFile)).filter((f) => f.startsWith("mcp.json.bak-"));
  expect(backups).toHaveLength(1);
  expect(log.join("\n")).toMatch(/Approve the dialog in LightBurn within 30 seconds/);
  expect(log.join("\n")).toMatch(/Restart Cursor/);
  expect(log.join("\n")).not.toContain("setup-secret");
});

test("runSetup prints the claude-code command when the claude CLI is missing", async () => {
  const { io, log } = scriptedIo(["", "state,project", "claude-code"]);
  const code = await runSetup(io, ctxForMock(), { platform: "darwin", env: {}, home: tmpHome, serverCommand: cmd, hasClaudeCli: false });
  expect(code).toBe(0);
  expect(loadConfig().capabilities).toEqual(["state", "project"]);
  expect(log.join("\n")).toContain("claude mcp add --scope user lightburn --");
});

test("runSetup stops with a hint when LightBurn is not reachable", async () => {
  const unreachable = createToolContext({ client: () => new LightBurnClient({ host: "127.0.0.1", port: 1 }) });
  const { io, log } = scriptedIo(["", ""]);
  const code = await runSetup(io, unreachable, { platform: "darwin", env: {}, home: tmpHome, serverCommand: cmd, hasClaudeCli: false });
  expect(code).toBe(1);
  expect(log.join("\n")).toMatch(/Start LightBurn/);
});

test("pair subcommand pairs with the given capabilities without printing the secret", async () => {
  const { io, log } = scriptedIo([]);
  const code = await runCommand({ command: "pair", flags: { capabilities: "state,upload" }, positional: [] }, ctxForMock(), io);
  expect(code).toBe(0);
  expect(loadConfig().capabilities).toEqual(["state", "upload"]);
  expect(log.join("\n")).toMatch(/Paired/);
  expect(log.join("\n")).not.toContain("setup-secret");
});

test("pair subcommand rejects an unknown capability", async () => {
  const { io, log } = scriptedIo([]);
  const code = await runCommand({ command: "pair", flags: { capabilities: "state,bogus" }, positional: [] }, ctxForMock(), io);
  expect(code).toBe(2);
  expect(log.join("\n")).toMatch(/Unknown capability "bogus"/);
});

test("status subcommand reports pairing and reachability", async () => {
  saveConfig({ product: "lightburn", host: "127.0.0.1", secret: "setup-secret", capabilities: ["state"], paired_at: "2026-10-22T10:00:00.000Z" });
  const { io, log } = scriptedIo([]);
  const code = await runCommand({ command: "status", flags: {}, positional: [] }, ctxForMock(), io);
  expect(code).toBe(0);
  const text = log.join("\n");
  expect(text).toMatch(/Paired:\s+yes/);
  expect(text).toMatch(/Reachable:\s+yes/);
  expect(text).toMatch(/Capabilities:\s+state/);
  expect(text).not.toContain("setup-secret");
});

test("config subcommand prints a snippet and writes with --write", async () => {
  const { io, log } = scriptedIo([]);
  expect(await runCommand({ command: "config", flags: {}, positional: ["cursor"] }, ctxForMock(), io)).toBe(0);
  expect(log.join("\n")).toContain('"lightburn"');

  const code = await runCommand({ command: "config", flags: { write: true }, positional: ["cursor"] }, ctxForMock(), io, {
    platform: "darwin",
    env: {},
    home: tmpHome,
    serverCommand: cmd,
    hasClaudeCli: false,
  });
  expect(code).toBe(0);
  const file = path.join(tmpHome, ".cursor", "mcp.json");
  expect(JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.lightburn.command).toBe(cmd.command);
});

test("config subcommand rejects an unknown client", async () => {
  const { io, log } = scriptedIo([]);
  expect(await runCommand({ command: "config", flags: {}, positional: ["emacs"] }, ctxForMock(), io)).toBe(2);
  expect(log.join("\n")).toMatch(/Unknown client "emacs"/);
});

test("token subcommand shows and rotates the HTTP token", async () => {
  const { io, log } = scriptedIo([]);
  expect(await runCommand({ command: "token", flags: {}, positional: [] }, ctxForMock(), io)).toBe(0);
  const first = loadConfig().http_token!;
  expect(first).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(log.join("\n")).toContain(first);
  expect(await runCommand({ command: "token", flags: { rotate: true }, positional: [] }, ctxForMock(), io)).toBe(0);
  const second = loadConfig().http_token!;
  expect(second).not.toBe(first);
  expect(log.join("\n")).toContain(second);
});
