import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LightBurnClient } from "../../src/client.js";
import { loadConfig, saveConfig, type Capability, type Config } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import { createToolContext, type ToolContext } from "../../src/tools/context.js";
import { startMockLightBurn, type Fixtures, type MockLightBurn } from "./mock-lightburn.js";

export interface Harness {
  mock: MockLightBurn;
  client: Client;
  ctx: ToolContext;
  configDir: string;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  text(result: CallToolResult): string;
  close(): Promise<void>;
}

export interface HarnessOptions {
  secret?: string;
  /** Capabilities granted by the mock AND stored in the config (default: all four). */
  capabilities?: Capability[];
  /** Capabilities stored in the config only (defaults to `capabilities`). */
  storedCapabilities?: Capability[];
  fixtures?: Partial<Fixtures>;
  /** Start without a stored secret. */
  unpaired?: boolean;
  /** Point the client at a port where nothing listens. */
  unreachable?: boolean;
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const secret = opts.secret ?? "harness-secret";
  const mock = await startMockLightBurn({ secret, capabilities: opts.capabilities, fixtures: opts.fixtures });

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-harness-"));
  process.env.LIGHTBURN_MCP_CONFIG_DIR = configDir;
  delete process.env.LIGHTBURN_SECRET;
  delete process.env.LIGHTBURN_HOST;
  delete process.env.LIGHTBURN_PRODUCT;

  const stored: Config = { product: "lightburn", host: "127.0.0.1" };
  if (!opts.unpaired) {
    stored.secret = secret;
    stored.capabilities = opts.storedCapabilities ?? opts.capabilities ?? ["state", "project", "upload", "project_write"];
    stored.paired_at = "2026-10-22T10:00:00.000Z";
  }
  saveConfig(stored);

  const port = opts.unreachable ? 1 : mock.port;
  const ctx = createToolContext({
    client: () => {
      const cfg = loadConfig();
      return new LightBurnClient({ host: cfg.host, port, secret: cfg.secret });
    },
  });

  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "harness", version: "0.0.0" });
  await client.connect(clientTransport);

  return {
    mock,
    client,
    ctx,
    configDir,
    async callTool(name, args = {}) {
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    },
    text(result) {
      return result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    },
    async close() {
      await client.close();
      await server.close();
      await mock.close();
      fs.rmSync(configDir, { recursive: true, force: true });
    },
  };
}
