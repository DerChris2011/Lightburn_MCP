import { afterEach, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";
import { startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;

afterEach(async () => {
  await h?.close();
});

test("pair stores the secret and capabilities without returning the secret", async () => {
  h = await startHarness({ unpaired: true, secret: "fresh-secret-xyz" });
  const r = await h.callTool("pair", { capabilities: ["state", "project"], application_name: "My Client" });
  expect(r.isError).toBeFalsy();
  const text = h.text(r);
  expect(text).not.toContain("fresh-secret-xyz");
  const body = JSON.parse(text);
  expect(body.status).toBe("paired");
  expect(body.capabilities).toEqual(["state", "project"]);
  expect(body.paired_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  const cfg = loadConfig();
  expect(cfg.secret).toBe("fresh-secret-xyz");
  expect(cfg.capabilities).toEqual(["state", "project"]);
  const call = h.mock.calls.find((c) => c.path === "/api/connect")!;
  expect(JSON.parse(call.body.toString())).toEqual({ application_name: "My Client", capabilities: ["state", "project"] });
});

test("pair defaults to all four capabilities and the default app name", async () => {
  h = await startHarness({ unpaired: true });
  await h.callTool("pair");
  const call = h.mock.calls.find((c) => c.path === "/api/connect")!;
  expect(JSON.parse(call.body.toString())).toEqual({
    application_name: "LightBurn MCP",
    capabilities: ["state", "project", "upload", "project_write"],
  });
});

test("pair reports a declined dialog", async () => {
  h = await startHarness({ unpaired: true, fixtures: { declinePairing: true } });
  const r = await h.callTool("pair");
  expect(r.isError).toBe(true);
  expect(h.text(r)).toBe("Pairing was declined or timed out in LightBurn.");
  expect(loadConfig().secret).toBeUndefined();
});

test("pair reports LightBurn not running", async () => {
  h = await startHarness({ unpaired: true, unreachable: true });
  const r = await h.callTool("pair");
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/does not appear to be running/);
});

test("connection_info never contains the secret", async () => {
  h = await startHarness({ secret: "another-secret-abc", capabilities: ["state", "upload"] });
  const r = await h.callTool("connection_info");
  const text = h.text(r);
  expect(text).not.toContain("another-secret-abc");
  const info = JSON.parse(text);
  expect(info).toMatchObject({
    product: "lightburn",
    host: "127.0.0.1",
    paired: true,
    secret_source: "file",
    capabilities: ["state", "upload"],
    paired_at: "2026-10-22T10:00:00.000Z",
    reachable: true,
  });
  expect(info.port).toBe(h.mock.port);
});

test("connection_info reports unpaired and unreachable", async () => {
  h = await startHarness({ unpaired: true, unreachable: true });
  const info = JSON.parse(h.text(await h.callTool("connection_info")));
  expect(info.paired).toBe(false);
  expect(info.secret_source).toBe("none");
  expect(info.reachable).toBe(false);
});
