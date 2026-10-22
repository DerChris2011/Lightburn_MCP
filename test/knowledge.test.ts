import { afterEach, expect, test } from "vitest";
import { KNOWLEDGE } from "../src/knowledge/index.js";
import { startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

const EXPECTED_URIS = [
  "lightburn://knowledge/api-rules",
  "lightburn://knowledge/cut-settings",
  "lightburn://knowledge/laser-types",
  "lightburn://knowledge/galvo",
  "lightburn://knowledge/gantry",
  "lightburn://knowledge/workflows",
];

test("server instructions carry the key API rules", async () => {
  h = await startHarness();
  const instructions = h.client.getInstructions() ?? "";
  for (const term of ["get_units", "in_use", "override_frequency", "Ruida", "profile", "Review"]) {
    expect(instructions).toContain(term);
  }
});

test("lists the six knowledge resources with titles and markdown mime type", async () => {
  h = await startHarness();
  const { resources } = await h.client.listResources();
  const uris = resources.map((r) => r.uri).sort();
  expect(uris).toEqual([...EXPECTED_URIS].sort());
  for (const r of resources) {
    expect(r.mimeType).toBe("text/markdown");
    expect(r.title ?? r.name).toBeTruthy();
    expect(r.description).toBeTruthy();
  }
});

test("each resource reads back as substantial markdown", async () => {
  h = await startHarness();
  for (const uri of EXPECTED_URIS) {
    const { contents } = await h.client.readResource({ uri });
    expect(contents).toHaveLength(1);
    const text = (contents[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(1500);
    expect(text.startsWith("# ")).toBe(true);
  }
});

test("knowledge covers every laser type and the MOPA-specific field", () => {
  const all = KNOWLEDGE.map((k) => k.text).join("\n");
  for (const term of ["diode", "CO2", "fiber", "MOPA", "q_pulse_width", "fiber_pulse_width", "laser_on_tc", "polygon_tc", "wobble", "PPI", "dither", "kerf", "interval", "DPI", "global_passes"]) {
    expect(all).toContain(term);
  }
});

test("knowledge never states material parameters as authoritative", () => {
  const all = KNOWLEDGE.map((k) => k.text).join("\n");
  expect(all).toMatch(/not a recipe|orders of magnitude|starting points? only|must be tested/i);
  expect(all).toContain("material library");
});

test("lists three prompts and renders them with arguments", async () => {
  h = await startHarness();
  const { prompts } = await h.client.listPrompts();
  expect(prompts.map((p) => p.name).sort()).toEqual(["prepare_import", "review_cut_settings", "summarize_project"]);

  const review = await h.client.getPrompt({ name: "review_cut_settings", arguments: { material: "3 mm birch plywood" } });
  const text = review.messages.map((m) => (m.content as { text: string }).text).join("\n");
  expect(text).toContain("3 mm birch plywood");
  expect(text).toContain("get_units");
  expect(text).toContain("lightburn://knowledge/laser-types");
  expect(text).toMatch(/Review these settings in LightBurn/);

  const summary = await h.client.getPrompt({ name: "summarize_project", arguments: {} });
  expect(summary.messages.length).toBeGreaterThan(0);

  const imp = await h.client.getPrompt({ name: "prepare_import", arguments: { description: "60 mm circle with text", x: "50", y: "50" } });
  const impText = imp.messages.map((m) => (m.content as { text: string }).text).join("\n");
  expect(impText).toContain("60 mm circle with text");
  expect(impText).toContain("upload_file");
  expect(impText).toContain("50");
});
