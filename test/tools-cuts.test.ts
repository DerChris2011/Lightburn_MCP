import { afterEach, expect, test } from "vitest";
import { buildMaterialUpdate } from "../src/tools/cuts.js";
import { startHarness, type Harness } from "./helpers/harness.js";

const REVIEW = "Review these settings in LightBurn before running the job.";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

test("update_cut posts the partial body and returns the review sentence", async () => {
  h = await startHarness();
  const r = await h.callTool("update_cut", { index: 2, changes: { params: { speed: 150, max_power: 65 } } });
  expect(r.isError).toBeFalsy();
  const call = h.mock.calls.find((c) => c.method === "POST" && c.path === "/api/cuts/2");
  expect(JSON.parse(call!.body.toString())).toEqual({ params: { speed: 150, max_power: 65 } });
  const text = h.text(r);
  expect(text.trim().endsWith(REVIEW)).toBe(true);
  const updated = JSON.parse(text.slice(0, text.lastIndexOf(REVIEW)));
  expect(updated.params.speed).toBe(150);
  expect(updated.params.max_power).toBe(65);
  expect(updated.params.gantry.run_blower).toBe(true);
});

test("update_cut translates 409", async () => {
  h = await startHarness({ fixtures: { editorOpen: true } });
  const r = await h.callTool("update_cut", { index: 2, changes: { enabled: false } });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toBe("The cut settings editor is open in LightBurn. Close it and try again.");
});

test("update_cut surfaces 400 text from the API", async () => {
  h = await startHarness();
  const r = await h.callTool("update_cut", { index: 2, changes: { params: { galvo: { wobble_enable: true } } } });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/params\.galvo does not match profile gantry/);
});

test("update_cut needs the project_write capability", async () => {
  h = await startHarness({ capabilities: ["project"] });
  const r = await h.callTool("update_cut", { index: 2, changes: { enabled: false } });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/needs the "project_write" capability/);
});

test("apply_material_to_cut refuses on ambiguous material with candidates", async () => {
  h = await startHarness();
  const r = await h.callTool("apply_material_to_cut", { index: 2, material: "plywood" });
  expect(r.isError).toBe(true);
  const text = h.text(r);
  expect(text).toMatch(/matches 2 entries/);
  expect(text).toMatch(/"guid": 1/);
  expect(text).toMatch(/"guid": 2/);
  expect(h.mock.calls.filter((c) => c.method === "POST")).toHaveLength(0);
});

test("apply_material_to_cut lists available materials when nothing matches", async () => {
  h = await startHarness();
  const r = await h.callTool("apply_material_to_cut", { index: 2, material: "Leather" });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/Available materials: Acrylic, Plywood/);
});

test("apply_material_to_cut applies by material and thickness", async () => {
  h = await startHarness();
  const r = await h.callTool("apply_material_to_cut", { index: 5, material: "Plywood", thickness: 6 });
  expect(r.isError).toBeFalsy();
  const call = h.mock.calls.find((c) => c.method === "POST" && c.path === "/api/cuts/5");
  const body = JSON.parse(call!.body.toString());
  expect(body.mode).toBe("cut");
  expect(body.params.speed).toBe(6);
  expect(body.params.max_power).toBe(90);
  expect(body.params.gantry).toBeDefined();
  expect(body.sub_layers).toBeUndefined();
  const text = h.text(r);
  expect(text.trim().endsWith(REVIEW)).toBe(true);
  const result = JSON.parse(text.slice(0, text.lastIndexOf(REVIEW)));
  expect(result.applied_entry).toEqual({ guid: 2, material: "Plywood", thickness: 6 });
  expect(result.cut.params.speed).toBe(6);
});

test("apply_material_to_cut refuses when entry has more sub-layers than target", async () => {
  h = await startHarness();
  const r = await h.callTool("apply_material_to_cut", { index: 5, entry_guid: 3 });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/2 sub-layers.*target cut has 0/);
  expect(h.text(r)).toMatch(/update_cut/);
});

test("apply_material_to_cut refuses a kind mismatch", async () => {
  h = await startHarness();
  const r = await h.callTool("apply_material_to_cut", { index: 40, entry_guid: 1 });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/kind "normal".*kind "image"/);
});

test("buildMaterialUpdate drops a galvo block for a gantry target and copies matching sub-layers", () => {
  const entry = {
    guid: 3,
    material: "Acrylic",
    thickness: 3,
    cut: {
      kind: "normal",
      profile: "galvo",
      mode: "scan",
      params: { speed: 500, max_power: 90, galvo: { wobble_enable: false } },
      sub_layers: [{ index: 1, name: "L1", enabled: true, mode: "cut", params: { speed: 400, galvo: { jump_speed: 1 } } }],
    },
  };
  const target = { kind: "normal", profile: "gantry", sub_layers: [{ index: 1 }, { index: 2 }] };
  const { body, skippedMachineBlock } = buildMaterialUpdate(entry as any, target as any);
  expect(skippedMachineBlock).toBe(true);
  expect(body).toEqual({
    mode: "scan",
    params: { speed: 500, max_power: 90 },
    sub_layers: [{ index: 1, name: "L1", enabled: true, mode: "cut", params: { speed: 400 } }],
  });
});
