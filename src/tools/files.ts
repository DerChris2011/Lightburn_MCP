import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ImportResult, LightBurnClient } from "../client.js";
import { secretSource } from "../config.js";
import type { ToolContext } from "./context.js";

const ORIGINS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

const NATIVE_EXT = new Set([".lbrn", ".lbrn2", ".mage"]);

const sourceSchema = {
  path: z.string().optional().describe("Absolute path of a local file to send."),
  content: z.string().optional().describe("Text content to send instead of a file, e.g. SVG markup."),
  content_base64: z.string().optional().describe("Binary content as base64 (images, DXF binaries)."),
  filename: z.string().optional().describe("Filename with extension; selects the importer (.svg, .dxf, .lbrn2, .png, ...). Required with content/content_base64; defaults to the basename of path."),
  wait_seconds: z.number().min(0).max(120).default(30).describe("How long to wait for LightBurn's import confirmation (default 30)."),
};

interface Source {
  bytes: Uint8Array;
  filename: string;
}

function resolveSource(args: { path?: string; content?: string; content_base64?: string; filename?: string }): Source {
  const given = [args.path, args.content, args.content_base64].filter((v) => v !== undefined && v !== "").length;
  if (given !== 1) throw new Error("Give exactly one of path, content or content_base64.");
  if (args.path) {
    let bytes: Uint8Array;
    try {
      bytes = fs.readFileSync(args.path);
    } catch (e) {
      throw new Error(`Cannot read file "${args.path}": ${(e as Error).message}`);
    }
    return { bytes, filename: args.filename || path.basename(args.path) };
  }
  if (!args.filename) throw new Error("filename is required when sending content or content_base64.");
  const bytes = args.content !== undefined ? new TextEncoder().encode(args.content) : Buffer.from(args.content_base64!, "base64");
  return { bytes, filename: args.filename };
}

function canConfirm(ctx: ToolContext): boolean {
  const cfg = ctx.config();
  return secretSource() === "env" || !cfg.capabilities || cfg.capabilities.includes("state");
}

async function send(
  ctx: ToolContext,
  client: LightBurnClient,
  endpoint: string,
  source: Source,
  headers: Record<string, string>,
  waitSeconds: number,
): Promise<{ accepted: unknown; result: ImportResult | null | "unavailable" }> {
  const allHeaders = { "X-Filename": source.filename, ...headers };
  if (!canConfirm(ctx) || waitSeconds <= 0) {
    const accepted = await client.postRaw(endpoint, source.bytes, allHeaders);
    return { accepted, result: "unavailable" };
  }
  const wait = await client.waitForImport({ timeoutMs: Math.round(waitSeconds * 1000) });
  await wait.ready;
  const accepted = await client.postRaw(endpoint, source.bytes, allHeaders);
  const result = await wait.result;
  return { accepted, result };
}

export function registerFileTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "upload_file",
    {
      description:
        'Requires capability "upload" (plus "state" for import confirmation). Imports a file into the CURRENT project (merge), like File > Import. Supported: .svg, .dxf, .ai, .pdf, .lbrn/.lbrn2, .png/.jpg/.bmp and other formats LightBurn can import. ' +
        "Send a local file via path, or generated content via content (text such as SVG) or content_base64. Optionally anchor the import at workspace coordinates x/y in mm (workpiece origin) with origin naming which point of the bounding box sits at the anchor (default center); without x/y it lands at the current view center. " +
        "Waits up to wait_seconds for LightBurn's file_imported event and reports the outcome.",
      inputSchema: {
        ...sourceSchema,
        x: z.number().optional().describe("Anchor X in workspace mm. Must be given together with y."),
        y: z.number().optional().describe("Anchor Y in workspace mm. Must be given together with x."),
        origin: z.enum(ORIGINS).optional().describe("Which point of the import's bounding box sits at (x, y). Default center."),
        group_shapes: z.boolean().optional().describe("true keeps the imported shapes grouped; false uses LightBurn's global preference."),
      },
    },
    async (args) => {
      try {
        ctx.requireCapability("upload");
        if ((args.x === undefined) !== (args.y === undefined)) throw new Error("x and y must be given together.");
        const source = resolveSource(args);
        const headers: Record<string, string> = {};
        if (args.x !== undefined && args.y !== undefined) {
          headers["X-Position-X"] = String(args.x);
          headers["X-Position-Y"] = String(args.y);
          if (args.origin) headers["X-Origin"] = args.origin;
        }
        if (args.group_shapes !== undefined) headers["X-Group-Shapes"] = args.group_shapes ? "true" : "false";

        const { accepted, result } = await send(ctx, ctx.client(), "/api/file/upload", source, headers, args.wait_seconds);
        if (result === "unavailable") {
          return ctx.textResult({ status: "accepted", filename: source.filename, note: "Pair with the state capability to get import confirmation.", response: accepted });
        }
        if (result === null) {
          return ctx.textResult({ status: "accepted", filename: source.filename, note: `No confirmation received within ${args.wait_seconds} s; check LightBurn.` });
        }
        if (!result.success) {
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ status: "import_failed", filename: source.filename, error: result.error ?? "unknown" }, null, 2) }] };
        }
        return ctx.textResult({ status: "imported", filename: source.filename });
      } catch (e) {
        return ctx.errorResult(e);
      }
    },
  );

  server.registerTool(
    "open_file",
    {
      description:
        'Requires capability "upload" (plus "state" for confirmation). REPLACES the current project with the file, like File > Open; LightBurn prompts the user to save unsaved changes first. ' +
        "Send a local file via path, or content / content_base64 with a filename. LightBurn confirms success reliably only for native projects (.lbrn, .lbrn2, .mage); for other formats this tool reads the project afterwards and reports it as opened_unconfirmed.",
      inputSchema: { ...sourceSchema },
    },
    async (args) => {
      try {
        ctx.requireCapability("upload");
        const source = resolveSource(args);
        const client = ctx.client();
        const { accepted, result } = await send(ctx, client, "/api/file/open", source, {}, args.wait_seconds);
        if (result === "unavailable") {
          return ctx.textResult({ status: "accepted", filename: source.filename, note: "Pair with the state capability to get confirmation.", response: accepted });
        }
        if (result === null) {
          return ctx.textResult({ status: "accepted", filename: source.filename, note: `No confirmation received within ${args.wait_seconds} s; check LightBurn.` });
        }
        if (result.success) return ctx.textResult({ status: "opened", filename: source.filename });
        const ext = path.extname(source.filename).toLowerCase();
        if (!NATIVE_EXT.has(ext)) {
          const project = await client.getJson("/api/project").catch(() => null);
          return ctx.textResult({
            status: "opened_unconfirmed",
            filename: source.filename,
            note: "LightBurn reports success=false for non-native formats even when the open worked. Check the project below: a successful open leaves filename empty and shape_count > 0.",
            project,
          });
        }
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ status: "open_failed", filename: source.filename, error: result.error ?? "unknown" }, null, 2) }] };
      } catch (e) {
        return ctx.errorResult(e);
      }
    },
  );
}
