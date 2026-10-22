import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LightBurnError } from "../client.js";
import type { ToolContext } from "./context.js";

export const REVIEW_SENTENCE = "Review these settings in LightBurn before running the job.";

const EDITOR_OPEN = "The cut settings editor is open in LightBurn. Close it and try again.";

export interface LibraryEntry {
  guid?: number;
  material?: string;
  description?: string;
  thickness?: number;
  cut?: Record<string, any>;
}

interface MaterialLibrary {
  product?: string;
  entries?: LibraryEntry[];
}

type Cut = Record<string, any>;

function stripMachineBlocks(params: Record<string, any> | undefined, keep: string | undefined): { params: Record<string, any>; skipped: boolean } {
  const out: Record<string, any> = {};
  let skipped = false;
  for (const [k, v] of Object.entries(params ?? {})) {
    if (k === "galvo" || k === "gantry") {
      if (k === keep) out[k] = v;
      else skipped = true;
      continue;
    }
    out[k] = v;
  }
  return { params: out, skipped };
}

/**
 * Builds the partial update that copies a library entry's base layer (and
 * the sub-layers the target already has) onto a target cut. Machine blocks
 * are only kept when they match the target's profile.
 */
export function buildMaterialUpdate(entry: LibraryEntry, target: Cut): { body: Record<string, unknown>; skippedMachineBlock: boolean } {
  const src = entry.cut ?? {};
  const keep = target.profile === "galvo" || target.profile === "gantry" ? (target.profile as string) : undefined;
  const base = stripMachineBlocks(src.params, keep);
  const body: Record<string, unknown> = {};
  if (typeof src.mode === "string" && src.mode !== "tool" && src.mode !== "image") body.mode = src.mode;
  body.params = base.params;
  let skipped = base.skipped;

  const targetSubs = Array.isArray(target.sub_layers) ? target.sub_layers : [];
  const srcSubs: Cut[] = Array.isArray(src.sub_layers) ? src.sub_layers : [];
  if (targetSubs.length && srcSubs.length) {
    const targetIdx = new Set(targetSubs.map((s: Cut) => s.index));
    const subs = srcSubs
      .filter((s) => targetIdx.has(s.index))
      .map((s) => {
        const p = stripMachineBlocks(s.params, keep);
        skipped = skipped || p.skipped;
        const out: Record<string, unknown> = { index: s.index };
        if (typeof s.name === "string") out.name = s.name;
        if (typeof s.enabled === "boolean") out.enabled = s.enabled;
        if (typeof s.mode === "string") out.mode = s.mode;
        out.params = p.params;
        return out;
      });
    if (subs.length) body.sub_layers = subs;
  }
  return { body, skippedMachineBlock: skipped };
}

function withReview(ctx: ToolContext, data: unknown) {
  return ctx.textResult(data, REVIEW_SENTENCE);
}

export function registerCutTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "update_cut",
    {
      description:
        'Requires capability "project_write". Partial update of one cut entry (LightBurn layer or MillMage operation) by its flat index from get_cuts. Only the fields in `changes` are modified; LightBurn validates the whole body first and changes nothing on error. ' +
        "Editable on LightBurn normal cuts: name, enabled, mode (cut|scan|offset), params (any LaserCutParams field such as speed, min_power, max_power, num_passes, frequency, interval, kerf, z_offset), params.galvo or params.gantry (must match the entry's profile), negative, pass_through, enable_cleanup, sort_within_layer, tabs, global_passes (galvo only), and existing sub_layers addressed by index. " +
        "Image cuts: name, enabled, params.speed, params.max_power, params.dither_mode. MillMage: name, enabled, any settings key. " +
        "Set params.override_frequency=true together with params.frequency, otherwise the frequency has no effect. Powers are 0-100. Values use the user's display units (see get_units). The change is one undo step in LightBurn; the operator must review before running.",
      inputSchema: {
        index: z.number().int().min(0).describe("Flat index from get_cuts."),
        changes: z.record(z.unknown()).describe("Partial cut entry, e.g. { params: { speed: 150, max_power: 65 } }."),
      },
    },
    async ({ index, changes }) => {
      try {
        ctx.requireCapability("project_write");
        const updated = await ctx.client().postJson(`/api/cuts/${index}`, changes);
        return withReview(ctx, updated);
      } catch (e) {
        if (e instanceof LightBurnError && e.kind === "conflict") return ctx.errorResult(new Error(EDITOR_OPEN));
        return ctx.errorResult(e);
      }
    },
  );

  server.registerTool(
    "apply_material_to_cut",
    {
      description:
        'Requires capabilities "project" and "project_write". Copies a material library entry (mode and base-layer params, plus sub-layer values for sub-layers the target cut already has) onto a cut entry. ' +
        "Select the entry by entry_guid, or by material name (case-insensitive) and optional thickness. Refuses when several entries match, when the entry has more sub-layers than the target, or when kinds differ. A machine block (galvo/gantry) that does not match the target profile is skipped and reported.",
      inputSchema: {
        index: z.number().int().min(0).describe("Flat index of the target cut from get_cuts."),
        material: z.string().optional().describe("Material name as shown in the library."),
        thickness: z.number().optional().describe("Material thickness to disambiguate."),
        entry_guid: z.number().int().optional().describe("Library entry guid from get_material_library."),
      },
    },
    async ({ index, material, thickness, entry_guid }) => {
      try {
        ctx.requireCapability("project");
        ctx.requireCapability("project_write");
        if (entry_guid === undefined && !material) {
          return ctx.errorResult(new Error("Give either entry_guid or material (optionally with thickness)."));
        }
        const client = ctx.client();
        const lib = await client.getJson<MaterialLibrary>("/api/material-library");
        if (lib.product && lib.product !== "lightburn") {
          return ctx.errorResult(new Error("apply_material_to_cut supports LightBurn material libraries only."));
        }
        const entries = Array.isArray(lib.entries) ? lib.entries : [];
        let candidates: LibraryEntry[];
        if (entry_guid !== undefined) {
          candidates = entries.filter((e) => e.guid === entry_guid);
          if (!candidates.length) return ctx.errorResult(new Error(`No library entry has guid ${entry_guid}.`));
        } else {
          const wanted = material!.trim().toLowerCase();
          candidates = entries.filter((e) => (e.material ?? "").trim().toLowerCase() === wanted);
          if (thickness !== undefined) candidates = candidates.filter((e) => e.thickness === thickness);
          if (!candidates.length) {
            const names = [...new Set(entries.map((e) => e.material).filter((m): m is string => typeof m === "string"))].sort();
            return ctx.errorResult(
              new Error(`No library entry matches material "${material}"${thickness !== undefined ? ` at ${thickness}` : ""}. Available materials: ${names.join(", ") || "none"}.`),
            );
          }
        }
        if (candidates.length > 1) {
          const list = candidates.map((e) => ({ guid: e.guid, material: e.material, description: e.description, thickness: e.thickness }));
          return ctx.errorResult(
            new Error(`"${material}" matches ${candidates.length} entries. Pick one by entry_guid or add thickness:\n${JSON.stringify(list, null, 2)}`),
          );
        }
        const entry = candidates[0];
        const target = await client.getJson<Cut>(`/api/cuts/${index}`);
        const srcKind = entry.cut?.kind;
        if (srcKind && target.kind && srcKind !== target.kind) {
          return ctx.errorResult(new Error(`Library entry is kind "${srcKind}" but the target cut is kind "${target.kind}". Pick a matching cut.`));
        }
        const srcSubs = Array.isArray(entry.cut?.sub_layers) ? entry.cut!.sub_layers.length : 0;
        const dstSubs = Array.isArray(target.sub_layers) ? target.sub_layers.length : 0;
        if (srcSubs > dstSubs) {
          return ctx.errorResult(
            new Error(
              `The library entry has ${srcSubs} sub-layers but the target cut has ${dstSubs}. The API cannot add sub-layers. Create them in LightBurn first, or use update_cut to apply only the base-layer params.`,
            ),
          );
        }
        const { body, skippedMachineBlock } = buildMaterialUpdate(entry, target);
        const updated = await client.postJson(`/api/cuts/${index}`, body);
        return withReview(ctx, {
          applied_entry: { guid: entry.guid, material: entry.material, thickness: entry.thickness },
          skipped_machine_block: skippedMachineBlock,
          cut: updated,
        });
      } catch (e) {
        if (e instanceof LightBurnError && e.kind === "conflict") return ctx.errorResult(new Error(EDITOR_OPEN));
        return ctx.errorResult(e);
      }
    },
  );
}
