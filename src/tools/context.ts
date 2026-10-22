import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { LightBurnClient, LightBurnError } from "../client.js";
import { loadConfig, portFor, saveConfig, secretSource, type Capability, type Config } from "../config.js";

export interface ToolContext {
  config: () => Config;
  saveConfig: (c: Config) => void;
  /** A client built from the current config. */
  client: () => LightBurnClient;
  /** Throws a LightBurnError when the stored pairing cannot cover `cap`. */
  requireCapability: (cap: Capability) => void;
  textResult: (data: unknown, note?: string) => CallToolResult;
  errorResult: (err: unknown) => CallToolResult;
}

export function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const base: ToolContext = {
    config: () => loadConfig(),
    saveConfig: (c) => saveConfig(c),
    client: () => {
      const cfg = loadConfig();
      return new LightBurnClient({ host: cfg.host, port: portFor(cfg.product), secret: cfg.secret });
    },
    requireCapability: (cap) => {
      const cfg = (overrides.config ?? base.config)();
      if (!cfg.secret) {
        throw new LightBurnError("unauthorized", 'Not paired yet. Run the "pair" tool or "lightburn-mcp pair".');
      }
      if (secretSource() === "env" || !cfg.capabilities) return;
      if (!cfg.capabilities.includes(cap)) {
        const list = cfg.capabilities.length ? cfg.capabilities.join(", ") : "nothing";
        throw new LightBurnError(
          "unauthorized",
          `This tool needs the "${cap}" capability, but the stored pairing only grants ${list}. Pair again with ${cap} included.`,
        );
      }
    },
    textResult: (data, note) => {
      const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      return { content: [{ type: "text", text: note ? `${text}\n\n${note}` : text }] };
    },
    errorResult: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: message }] };
    },
  };
  return { ...base, ...overrides };
}
