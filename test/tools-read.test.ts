import { afterEach, expect, test } from "vitest";
import { startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

const READ_TOOLS = [
  "get_status",
  "get_position",
  "get_units",
  "get_jog_settings",
  "get_saved_positions",
  "get_state_snapshot",
  "get_project",
  "get_layers",
  "get_cuts",
  "get_cut",
  "get_material_library",
  "get_camera_overlay_metadata",
  "get_camera_overlay",
];

test("lists all 13 read tools with capability notes", async () => {
  h = await startHarness();
  const { tools } = await h.client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of READ_TOOLS) expect(names).toContain(n);
  const status = tools.find((t) => t.name === "get_status")!;
  expect(status.description).toMatch(/^Requires capability "state"\./);
});

test("get_status returns the status and the Ruida note", async () => {
  h = await startHarness();
  const r = await h.callTool("get_status");
  expect(r.isError).toBeFalsy();
  const text = h.text(r);
  expect(JSON.parse(text.split("\n\nNote:")[0]).device_name).toBe("Mock Laser");
  expect(text).toMatch(/connected=false is the normal resting state/);
});

test("simple state tools return their endpoint JSON", async () => {
  h = await startHarness();
  expect(JSON.parse(h.text(await h.callTool("get_position"))).machine.x).toBe(100);
  expect(JSON.parse(h.text(await h.callTool("get_units"))).distance_units).toBe("mm");
  expect(JSON.parse(h.text(await h.callTool("get_jog_settings"))).xy_distance).toBe(10);
  expect(JSON.parse(h.text(await h.callTool("get_saved_positions"))).positions[0].name).toBe("Park");
  expect(JSON.parse(h.text(await h.callTool("get_state_snapshot"))).job.state).toBe("idle");
});

test("get_project and get_material_library pass through", async () => {
  h = await startHarness();
  expect(JSON.parse(h.text(await h.callTool("get_project"))).filename).toBe("test.lbrn2");
  expect(JSON.parse(h.text(await h.callTool("get_material_library"))).entries).toHaveLength(3);
});

test("get_layers filters to in-use layers by default", async () => {
  h = await startHarness();
  const filtered = JSON.parse(h.text(await h.callTool("get_layers")));
  expect(filtered.layers.map((l: any) => l.index)).toEqual([2, 5, 7]);
  expect(filtered.active_index).toBe(2);
  const all = JSON.parse(h.text(await h.callTool("get_layers", { in_use_only: false })));
  expect(all.layers).toHaveLength(32);
});

test("get_cuts compact+in_use_only returns only used cuts with core fields", async () => {
  h = await startHarness();
  const r = JSON.parse(h.text(await h.callTool("get_cuts")));
  expect(r.product).toBe("lightburn");
  expect(r.cuts.map((c: any) => c.index)).toEqual([2, 5, 40]);
  const cut = r.cuts[0];
  expect(cut).toEqual({
    index: 2,
    layer_index: 2,
    name: "Cut Line",
    kind: "normal",
    mode: "cut",
    enabled: true,
    in_use: true,
    shape_count: 3,
    profile: "gantry",
    speed: 10,
    min_power: 10,
    max_power: 80,
    num_passes: 1,
    sub_layers: 1,
  });
  const full = JSON.parse(h.text(await h.callTool("get_cuts", { compact: false, in_use_only: false })));
  expect(full.cuts).toHaveLength(63);
  expect(full.cuts[2].params.gantry.run_blower).toBe(true);
});

test("get_cut returns the full entry", async () => {
  h = await startHarness();
  const cut = JSON.parse(h.text(await h.callTool("get_cut", { index: 2 })));
  expect(cut.sub_layers[0].name).toBe("Second pass");
  const missing = await h.callTool("get_cut", { index: 999 });
  expect(missing.isError).toBe(true);
  expect(h.text(missing)).toMatch(/out of range/i);
});

test("get_camera_overlay returns an image block plus metadata", async () => {
  h = await startHarness();
  const r = await h.callTool("get_camera_overlay");
  expect(r.isError).toBeFalsy();
  expect(r.content[0].type).toBe("image");
  expect((r.content[0] as any).mimeType).toBe("image/png");
  expect(JSON.parse(h.text(r)).width).toBe(1);
  const meta = JSON.parse(h.text(await h.callTool("get_camera_overlay_metadata")));
  expect(meta.source).toBe("overhead");
});

test("get_camera_overlay reports a missing overlay plainly", async () => {
  h = await startHarness({ fixtures: { overlayPng: null } });
  const r = await h.callTool("get_camera_overlay");
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/Not found/);
});

test("a tool refuses with a capability message when pairing lacks it", async () => {
  h = await startHarness({ capabilities: ["state"] });
  const r = await h.callTool("get_project");
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/needs the "project" capability/);
  expect(h.text(r)).toMatch(/only grants state/);
  expect(h.mock.calls.filter((c) => c.path === "/api/project")).toHaveLength(0);
});

test("a tool explains when not paired yet", async () => {
  h = await startHarness({ unpaired: true });
  const r = await h.callTool("get_status");
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/Not paired yet/);
});

test("a tool reports 'not running' when nothing listens", async () => {
  h = await startHarness({ unreachable: true });
  const r = await h.callTool("get_status");
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/does not appear to be running/);
});
