import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./context.js";

const CAP = "project" as const;

interface LayerList {
  active_index?: number;
  layers?: Array<{ in_use?: boolean }>;
}

interface CutList {
  product?: string;
  cuts?: Array<Record<string, any>>;
}

export function compactCut(cut: Record<string, any>): Record<string, unknown> {
  const params = cut.params ?? {};
  return {
    index: cut.index,
    layer_index: cut.layer_index,
    name: cut.name,
    kind: cut.kind,
    mode: cut.mode,
    enabled: cut.enabled,
    in_use: cut.in_use,
    shape_count: cut.shape_count,
    profile: cut.profile,
    speed: params.speed,
    min_power: params.min_power,
    max_power: params.max_power,
    num_passes: params.num_passes,
    sub_layers: Array.isArray(cut.sub_layers) ? cut.sub_layers.length : 0,
  };
}

export function registerProjectTools(server: McpServer, ctx: ToolContext): void {
  const guard = async (fn: () => Promise<ReturnType<ToolContext["textResult"]>>) => {
    try {
      ctx.requireCapability(CAP);
      return await fn();
    } catch (e) {
      return ctx.errorResult(e);
    }
  };

  server.registerTool(
    "get_project",
    {
      description:
        `Requires capability "${CAP}". Metadata of the open project: filename, modified flag, shape count, display units, workspace size in mm and the selected device including laser source capabilities (device.laser.controller tells which controller is attached).`,
    },
    async () => guard(async () => ctx.textResult(await ctx.client().getJson("/api/project"))),
  );

  server.registerTool(
    "get_layers",
    {
      description: `Requires capability "${CAP}". All 32 layer definitions (index, name, color as #RRGGBB, type, hidden, in_use, shape_count) and the active layer index. By default only layers in use are returned.`,
      inputSchema: { in_use_only: z.boolean().default(true).describe("Return only layers that have shapes (default true).") },
    },
    async ({ in_use_only }) =>
      guard(async () => {
        const data = await ctx.client().getJson<LayerList>("/api/layers");
        if (in_use_only && Array.isArray(data.layers)) {
          return ctx.textResult({ ...data, layers: data.layers.filter((l) => l.in_use) });
        }
        return ctx.textResult(data);
      }),
  );

  server.registerTool(
    "get_cuts",
    {
      description:
        `Requires capability "${CAP}". Cut settings of the project. LightBurn returns a fixed list: 30 cut layers, 2 tool layers, 1 internal entry, then 30 image cuts; MillMage returns its operation list. ` +
        "Each entry's `index` is the value to pass to get_cut / update_cut. Compact mode returns the core fields only (speed, min/max power, passes, mode, profile); use compact=false or get_cut for every field. Values use the user's display units (see get_units).",
      inputSchema: {
        in_use_only: z.boolean().default(true).describe("Only entries that shapes actually use (default true)."),
        compact: z.boolean().default(true).describe("Core fields only (default true). LightBurn only; MillMage entries are always returned in full."),
      },
    },
    async ({ in_use_only, compact }) =>
      guard(async () => {
        const data = await ctx.client().getJson<CutList>("/api/cuts");
        let cuts = Array.isArray(data.cuts) ? data.cuts : [];
        if (in_use_only) cuts = cuts.filter((c) => c.in_use === true || (c.in_use === undefined && (c.shape_count ?? 0) > 0));
        if (compact && data.product === "lightburn") cuts = cuts.map(compactCut);
        return ctx.textResult({ ...data, cuts });
      }),
  );

  server.registerTool(
    "get_cut",
    {
      description: `Requires capability "${CAP}". One cut entry with every field, by the flat index from get_cuts. For LightBurn normal cuts, params contains exactly one machine block (params.galvo or params.gantry) matching the entry's profile.`,
      inputSchema: { index: z.number().int().min(0).describe("Flat index from get_cuts.") },
    },
    async ({ index }) => guard(async () => ctx.textResult(await ctx.client().getJson(`/api/cuts/${index}`))),
  );

  server.registerTool(
    "get_material_library",
    {
      description: `Requires capability "${CAP}". The currently loaded material library (LightBurn: flat entries with material, thickness, description, guid and a full cut setting; MillMage: operations library trees).`,
    },
    async () => guard(async () => ctx.textResult(await ctx.client().getJson("/api/material-library"))),
  );

  server.registerTool(
    "get_camera_overlay_metadata",
    {
      description: `Requires capability "${CAP}". Size, workspace placement (mm) and a revision token of the camera overlay, without transferring the image. LightBurn only; 404 when no overlay is loaded.`,
    },
    async () => guard(async () => ctx.textResult(await ctx.client().getJson("/api/overlay/metadata"))),
  );

  server.registerTool(
    "get_camera_overlay",
    {
      description: `Requires capability "${CAP}". The camera overlay currently drawn on the workspace as a PNG image, plus its metadata. Returns what LightBurn already has in memory; it never triggers a new capture. LightBurn only.`,
    },
    async () =>
      guard(async () => {
        const client = ctx.client();
        const { bytes } = await client.getBinary("/api/overlay");
        const metadata = await client.getJson("/api/overlay/metadata").catch(() => null);
        return {
          content: [
            { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: "image/png" },
            { type: "text", text: JSON.stringify(metadata, null, 2) },
          ],
        };
      }),
  );
}
