import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { API_RULES } from "./api-rules.js";
import { CUT_SETTINGS } from "./cut-settings.js";
import { GALVO } from "./galvo.js";
import { GANTRY } from "./gantry.js";
import { LASER_TYPES } from "./laser-types.js";
import { WORKFLOWS } from "./workflows.js";

export interface KnowledgeDoc {
  uri: string;
  name: string;
  title: string;
  description: string;
  text: string;
}

export const KNOWLEDGE: readonly KnowledgeDoc[] = [
  {
    uri: "lightburn://knowledge/api-rules",
    name: "api-rules",
    title: "LightBurn API rules and pitfalls",
    description: "Units, index vs layer_index, in_use, profile/galvo/gantry blocks, override_frequency, Ruida quirks, write semantics, import confirmation. Read before interpreting or changing values.",
    text: API_RULES,
  },
  {
    uri: "lightburn://knowledge/cut-settings",
    name: "cut-settings",
    title: "Cut settings explained",
    description: "What every cut field means: modes, sub-layers, min/max power, speed, passes, kerf, interval/DPI, scan options, tabs, perforation, image dither modes, frequency.",
    text: CUT_SETTINGS,
  },
  {
    uri: "lightburn://knowledge/laser-types",
    name: "laser-types",
    title: "Laser types: diode, CO2, fiber, MOPA fiber, UV",
    description: "How to identify the machine from get_project, which fields apply to each laser type, what the numbers roughly mean, and what each type can and cannot do. Orders of magnitude only.",
    text: LASER_TYPES,
  },
  {
    uri: "lightburn://knowledge/galvo",
    name: "galvo",
    title: "Galvo lasers (fiber, MOPA, UV, galvo CO2)",
    description: "Frequency, pulse width, line interval, the params.galvo block (timing constants, jump settings, wobble), global_passes, deep engraving, annealing, colour marking.",
    text: GALVO,
  },
  {
    uri: "lightburn://knowledge/gantry",
    name: "gantry",
    title: "Gantry lasers (CO2, diode)",
    description: "Min/max power ramping, the params.gantry block (air assist, PPI, cut-through, lead in/out, dot mode, overcut), CO2 and diode specifics, typical layer shapes.",
    text: GANTRY,
  },
  {
    uri: "lightburn://knowledge/workflows",
    name: "workflows",
    title: "Workflows for assistants",
    description: "Step sequences for summarising a project, reviewing settings, changing settings, applying library materials, importing SVGs (units, colour→layer mapping, placement), and handling errors.",
    text: WORKFLOWS,
  },
];

export const INSTRUCTIONS = `Tools for the LightBurn / MillMage REST API. The API cannot start, stop or move the machine; it reads state, reads project data, changes cut settings and imports files.

Rules that avoid the usual mistakes:
- Call get_units before quoting or writing any value; speed and distance units are independent and vary by machine (diodes often mm/min, CO2 and galvos mm/s). Positions and the workspace are always mm.
- Use the cuts' in_use / shape_count (get_cuts) to find the layers that matter; the index field is what get_cut/update_cut take, layer_index is the desktop slot.
- Read a cut with get_cut before changing it: its profile (galvo/gantry) decides which params block is accepted. Set override_frequency together with frequency. Send partial bodies only.
- Identify the laser from get_project device.laser (galvo, controller, mopa_source, sources) and read the resource lightburn://knowledge/laser-types before judging values. Never present speed/power numbers as correct for the user's machine; use their material library and existing layers as reference.
- connected=false is normal on Ruida; job progress is not reported there. Do not call it a fault.
- Every cut setting changed through this server must be reviewed by the operator in LightBurn before running the job; repeat this after each change ("Review these settings in LightBurn before running the job.").

Resources under lightburn://knowledge/ explain the API rules, cut settings, laser types, galvo and gantry specifics, and recommended workflows. Prompts summarize_project, review_cut_settings and prepare_import follow those workflows.`;

export function registerKnowledge(server: McpServer): void {
  for (const doc of KNOWLEDGE) {
    server.registerResource(
      doc.name,
      doc.uri,
      { title: doc.title, description: doc.description, mimeType: "text/markdown" },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: doc.text }] }),
    );
  }

  server.registerPrompt(
    "summarize_project",
    {
      title: "Summarize the open LightBurn project",
      description: "Machine, project size and every layer in use with its settings, in the user's units.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Summarise the LightBurn project that is currently open. Steps: call get_project (note device.laser: galvo?, controller, mopa_source, sources), then get_units, then get_cuts with defaults (compact, in-use only). " +
              "Report the machine type, project filename and size, workspace, and a table of the used layers: index, name, mode, speed with unit, min/max power, passes, enabled, sub-layers. List disabled or tool layers separately. " +
              "Keep it short and concrete; quote values with units. Do not change anything.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_cut_settings",
    {
      title: "Review cut settings for plausibility",
      description: "Checks every used layer against the laser type and (optionally) the stated material; suggests changes but does not apply them.",
      argsSchema: {
        material: z.string().optional().describe("Material and thickness the user is working with, e.g. '3 mm birch plywood' or 'anodised aluminium'."),
        goal: z.string().optional().describe("What the job should achieve, e.g. 'cut through', 'light engrave', 'black mark'."),
      },
    },
    ({ material, goal }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Review the cut settings of the open LightBurn project for plausibility${material ? ` for ${material}` : ""}${goal ? ` (goal: ${goal})` : ""}. ` +
              "Steps: 1) get_project and get_units; identify the laser type from device.laser and read the resource lightburn://knowledge/laser-types (and lightburn://knowledge/galvo or lightburn://knowledge/gantry as appropriate). " +
              "2) get_cuts (in-use only), then get_cut for each used layer so you see frequency/override_frequency, interval, air assist, passes and image dither. " +
              "3) get_material_library; if an entry matches the material, compare the layer with it. " +
              "4) For each layer, say whether speed, power, passes, interval, frequency and mode fit the machine class and the material/goal, with units, and flag combinations that rarely make sense (frequency stored but override off, min_power 0 on a glass CO2, scan layer at cutting speed, cut layer with many passes 'to be safe'). " +
              "5) Propose concrete changes as ranges with units, mark them as starting points to be tested on scrap, and ask before applying any. If the user agrees, use update_cut with partial bodies and finish with: Review these settings in LightBurn before running the job.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "prepare_import",
    {
      title: "Create artwork and import it",
      description: "Builds an SVG in millimetres from a description and imports it into the open project at a position.",
      argsSchema: {
        description: z.string().describe("What to draw, e.g. '60 mm circle with the text Workshop inside'."),
        x: z.string().optional().describe("Anchor X in workspace mm (optional)."),
        y: z.string().optional().describe("Anchor Y in workspace mm (optional)."),
        origin: z.string().optional().describe("Which point of the artwork sits at x/y: top-left, center, bottom-right, ... (default center)."),
      },
    },
    ({ description, x, y, origin }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Create this artwork and import it into the open LightBurn project: ${description}. ` +
              "Read the resource lightburn://knowledge/workflows (section 'Import generated artwork'). Build an SVG with millimetre units (width/height in mm and a matching viewBox so 1 unit = 1 mm). " +
              "Use stroke colours from LightBurn's palette on purpose: black #000000 → layer C00, blue #0000FF → C01, red #FF0000 → C02, green #00E000 → C03; use one colour for cut lines and another for engraved fills, and convert text to paths if exact fonts matter. " +
              `Then call upload_file with content and a filename ending in .svg, group_shapes true${x !== undefined && y !== undefined ? `, x ${x}, y ${y}${origin ? `, origin ${origin}` : ""}` : ""}. ` +
              "Report the import result, which layers the shapes landed on (get_layers / get_cuts), and whether those layers' settings suit the intended cut/engrave; offer to set them. Do not change cut settings without being asked.",
          },
        },
      ],
    }),
  );
}
