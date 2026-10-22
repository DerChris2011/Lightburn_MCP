import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import type { CliIo, ParsedArgs } from "./cli.js";
import { CLIENT_IDS, CLIENT_LABELS, claudeCodeCommand, configPath, defaultServerCommand, mergeIntoFile, renderSnippet, type ClientId, type ServerCommand } from "./clients.js";
import { CAPABILITIES, PRODUCTS, portFor, secretSource, type Capability, type Product } from "./config.js";
import { resolveHttpToken } from "./http.js";
import { connectionInfo, pairAndStore } from "./tools/pairing.js";
import type { ToolContext } from "./tools/context.js";

export interface SetupIo extends CliIo {
  ask: (question: string, def?: string) => Promise<string>;
}

export interface SetupEnv {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  serverCommand: ServerCommand;
  hasClaudeCli: boolean;
}

export function defaultSetupEnv(): SetupEnv {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    serverCommand: defaultServerCommand(),
    hasClaudeCli: hasCommand("claude"),
  };
}

function hasCommand(name: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [name], { stdio: "ignore", shell: process.platform === "win32" });
  return r.status === 0;
}

export function parseCapabilities(text: string): Capability[] {
  const parts = text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Capability[] = [];
  for (const p of parts) {
    if (!(CAPABILITIES as readonly string[]).includes(p)) throw new Error(`Unknown capability "${p}". Valid: ${CAPABILITIES.join(", ")}.`);
    if (!out.includes(p as Capability)) out.push(p as Capability);
  }
  if (!out.length) throw new Error("At least one capability is required.");
  return out;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Writes the client config, backing up an existing file first. Returns the path written and the backup path. */
export function writeClientConfig(client: ClientId, cmd: ServerCommand, env: SetupEnv): { file: string; backup: string | null } {
  const file = configPath(client, env.platform, env.env, env.home);
  if (!file) throw new Error(`${CLIENT_LABELS[client]} is configured through its CLI, not a file.`);
  let existing: string | null = null;
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    existing = fs.readFileSync(file, "utf8");
    backup = `${file}.bak-${timestamp()}`;
    fs.copyFileSync(file, backup);
  }
  const text = mergeIntoFile(client, existing, cmd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return { file, backup };
}

async function ensureReachable(ctx: ToolContext, io: CliIo): Promise<boolean> {
  const cfg = ctx.config();
  if (await ctx.client().isReachable()) return true;
  io.error(`LightBurn is not answering on ${cfg.host}:${portFor(cfg.product)}. Start LightBurn (version 2.2.00 or newer) and run this again.`);
  return false;
}

export async function runSetup(io: SetupIo, ctx: ToolContext, env: SetupEnv = defaultSetupEnv()): Promise<number> {
  io.log("LightBurn MCP setup\n");

  // 1. product
  const productAnswer = (await io.ask(`Which application? (${PRODUCTS.join(" / ")})`, ctx.config().product)).trim().toLowerCase();
  if (!(PRODUCTS as readonly string[]).includes(productAnswer)) {
    io.error(`Unknown product "${productAnswer}".`);
    return 2;
  }
  const product = productAnswer as Product;
  ctx.saveConfig({ ...ctx.config(), product });

  // 2. capabilities
  io.log(
    "\nCapabilities: state (machine/job state), project (read project data; includes the camera overlay image), upload (import files), project_write (change cut settings).",
  );
  let capabilities: Capability[];
  try {
    capabilities = parseCapabilities(await io.ask("Capabilities to request (comma-separated)", CAPABILITIES.join(",")));
  } catch (e) {
    io.error((e as Error).message);
    return 2;
  }

  // 3. reachability
  if (!(await ensureReachable(ctx, io))) return 1;

  // 4. pair
  io.log("\nApprove the dialog in LightBurn within 30 seconds...");
  try {
    const r = await pairAndStore(ctx, capabilities);
    io.log(`Paired with ${product} (capabilities: ${r.capabilities.join(", ")}).`);
  } catch (e) {
    io.error((e as Error).message);
    return 1;
  }

  // 5. clients
  io.log(`\nMCP clients: ${CLIENT_IDS.join(", ")}`);
  const chosen = (await io.ask("Which clients should be configured? (comma-separated, empty for none)", ""))
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const configured: string[] = [];
  for (const c of chosen) {
    if (!(CLIENT_IDS as readonly string[]).includes(c)) {
      io.error(`Unknown client "${c}", skipped.`);
      continue;
    }
    const client = c as ClientId;
    if (client === "claude-code") {
      const command = claudeCodeCommand(env.serverCommand);
      if (env.hasClaudeCli) {
        try {
          execFileSync(command, { stdio: "inherit", shell: true });
          configured.push(CLIENT_LABELS[client]);
        } catch {
          io.error(`Could not run the Claude Code CLI. Run this yourself:\n  ${command}`);
        }
      } else {
        io.log(`Claude Code: run this command once the "claude" CLI is installed:\n  ${command}`);
      }
      continue;
    }
    try {
      const { file, backup } = writeClientConfig(client, env.serverCommand, env);
      io.log(`${CLIENT_LABELS[client]}: wrote ${file}${backup ? ` (backup: ${backup})` : ""}`);
      configured.push(CLIENT_LABELS[client]);
    } catch (e) {
      io.error(`${CLIENT_LABELS[client]}: ${(e as Error).message}`);
    }
  }
  if (configured.length) io.log(`\nRestart ${configured.join(", ")} to load the server.`);
  io.log('\nDone. Check anytime with "lightburn-mcp status".');
  return 0;
}

function makeIo(io: CliIo): SetupIo {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return {
    ...io,
    ask: async (q, def) => {
      const a = (await rl.question(def !== undefined && def !== "" ? `${q} [${def}]: ` : `${q}: `)).trim();
      return a === "" ? (def ?? "") : a;
    },
  };
}

export async function runCommand(args: ParsedArgs, ctx: ToolContext, io: CliIo, env?: SetupEnv): Promise<number> {
  switch (args.command) {
    case "setup": {
      const sio = makeIo(io);
      try {
        return await runSetup(sio, ctx, env);
      } finally {
        process.stdin.destroy?.();
      }
    }
    case "pair": {
      let caps: Capability[];
      try {
        caps = typeof args.flags.capabilities === "string" ? parseCapabilities(args.flags.capabilities) : [...CAPABILITIES];
      } catch (e) {
        io.error((e as Error).message);
        return 2;
      }
      if (!(await ensureReachable(ctx, io))) return 1;
      io.log("Approve the dialog in LightBurn within 30 seconds...");
      try {
        const r = await pairAndStore(ctx, caps);
        io.log(`Paired. Capabilities: ${r.capabilities.join(", ")}.`);
        return 0;
      } catch (e) {
        io.error((e as Error).message);
        return 1;
      }
    }
    case "status": {
      const info = await connectionInfo(ctx);
      const cfg = ctx.config();
      io.log(`Product:      ${info.product}`);
      io.log(`Host:         ${info.host}:${info.port}`);
      io.log(`Reachable:    ${info.reachable ? "yes" : "no (is LightBurn running?)"}`);
      io.log(`Paired:       ${info.paired ? "yes" : "no"} (secret source: ${info.secret_source})`);
      io.log(`Capabilities: ${Array.isArray(info.capabilities) ? info.capabilities.join(", ") || "none" : info.capabilities}`);
      io.log(`Paired at:    ${info.paired_at ?? "-"}`);
      io.log(`HTTP token:   ${cfg.http_token ? "set" : "not generated yet"}`);
      return 0;
    }
    case "config": {
      const target = args.positional[0];
      if (!target || !(CLIENT_IDS as readonly string[]).includes(target)) {
        io.error(`Unknown client "${target ?? ""}". Choose one of: ${CLIENT_IDS.join(", ")}.`);
        return 2;
      }
      const client = target as ClientId;
      const e = env ?? defaultSetupEnv();
      if (client === "claude-code") {
        io.log(claudeCodeCommand(e.serverCommand));
        return 0;
      }
      if (args.flags.write) {
        try {
          const { file, backup } = writeClientConfig(client, e.serverCommand, e);
          io.log(`Wrote ${file}${backup ? ` (backup: ${backup})` : ""}. Restart ${CLIENT_LABELS[client]}.`);
          return 0;
        } catch (err) {
          io.error((err as Error).message);
          return 1;
        }
      }
      io.log(`# ${CLIENT_LABELS[client]}: ${configPath(client, e.platform, e.env, e.home)}`);
      io.log(renderSnippet(client, e.serverCommand));
      return 0;
    }
    case "token": {
      const cfg = ctx.config();
      if (args.flags.rotate || !cfg.http_token) {
        const { token } = resolveHttpToken({ ...cfg, http_token: undefined });
        io.log(token);
        return 0;
      }
      io.log(cfg.http_token);
      return 0;
    }
    default:
      io.error(`Unknown command "${args.command}".`);
      return 2;
  }
}

export { secretSource };
