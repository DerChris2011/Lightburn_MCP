import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CAPABILITIES, portFor, secretSource, type Capability } from "../config.js";
import type { ToolContext } from "./context.js";

export const DEFAULT_APP_NAME = "LightBurn MCP";

/** Pairs with the running application and stores the secret. Returns what the tool/CLI may show. */
export async function pairAndStore(
  ctx: ToolContext,
  capabilities: Capability[],
  applicationName: string = DEFAULT_APP_NAME,
): Promise<{ status: "paired"; capabilities: Capability[]; paired_at: string }> {
  const secret = await ctx.client().connect(applicationName, capabilities);
  const paired_at = new Date().toISOString();
  ctx.updateConfigFile({ secret, capabilities, paired_at });
  return { status: "paired", capabilities, paired_at };
}

export async function connectionInfo(ctx: ToolContext): Promise<Record<string, unknown>> {
  const cfg = ctx.config();
  const client = ctx.client();
  const reachable = await client.isReachable();
  const port = Number(new URL(client.baseUrl).port) || portFor(cfg.product);
  return {
    product: cfg.product,
    host: cfg.host,
    port,
    paired: Boolean(cfg.secret),
    secret_source: secretSource(),
    capabilities: cfg.capabilities ?? (cfg.secret ? "unknown (secret supplied via environment)" : []),
    paired_at: cfg.paired_at ?? null,
    reachable,
  };
}

export function registerPairingTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "pair",
    {
      description:
        "Pairs this server with the running LightBurn / MillMage on this machine. LightBurn shows a consent dialog naming the application and the requested capabilities; the user must approve it within 30 seconds. " +
        "The secret is stored in the per-user config and never returned. Capabilities are fixed for the life of the pairing; call pair again to change them. Note that \"project\" includes the camera overlay image.",
      inputSchema: {
        capabilities: z
          .array(z.enum(CAPABILITIES as [Capability, ...Capability[]]))
          .min(1)
          .default([...CAPABILITIES])
          .describe("state (machine/job state), project (read project data incl. camera overlay), upload (import files), project_write (change cut settings)."),
        application_name: z.string().min(1).default(DEFAULT_APP_NAME).describe("Name shown in LightBurn's consent dialog."),
      },
    },
    async ({ capabilities, application_name }) => {
      try {
        return ctx.textResult(await pairAndStore(ctx, capabilities, application_name));
      } catch (e) {
        return ctx.errorResult(e);
      }
    },
  );

  server.registerTool(
    "connection_info",
    {
      description: "Shows how this server is configured: product, host, port, whether it is paired, granted capabilities, and whether LightBurn is reachable right now. Never reveals the secret.",
    },
    async () => {
      try {
        return ctx.textResult(await connectionInfo(ctx));
      } catch (e) {
        return ctx.errorResult(e);
      }
    },
  );
}
