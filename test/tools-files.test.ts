import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, type Harness } from "./helpers/harness.js";

let h: Harness;
let tmpFile: string | undefined;

afterEach(async () => {
  await h?.close();
  if (tmpFile) fs.rmSync(tmpFile, { force: true });
  tmpFile = undefined;
});

function svgFile(): string {
  tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-svg-")), "design.svg");
  fs.writeFileSync(tmpFile, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  return tmpFile;
}

/** Resolves once the mock has seen a request for `path` (or the tool call already finished). */
function whenCalled(h: Harness, p: string, pending?: Promise<unknown>): Promise<void> {
  const poll = new Promise<void>((resolve) => {
    const tick = () => (h.mock.calls.some((c) => c.path === p) ? resolve() : setTimeout(tick, 5));
    tick();
  });
  return pending ? Promise.race([poll, pending.then(() => undefined)]) : poll;
}

test("upload_file sends raw bytes with placement headers", async () => {
  h = await startHarness();
  const file = svgFile();
  const pending = h.callTool("upload_file", { path: file, x: 10, y: 20, origin: "top-left", group_shapes: true, wait_seconds: 5 });
  await whenCalled(h, "/api/file/upload", pending);
  h.mock.emitEvent("file_imported", { success: true });
  const r = await pending;
  expect(r.isError).toBeFalsy();
  const call = h.mock.calls.find((c) => c.path === "/api/file/upload")!;
  expect(call.headers["content-type"]).toBe("application/octet-stream");
  expect(call.headers["x-filename"]).toBe("design.svg");
  expect(call.headers["x-position-x"]).toBe("10");
  expect(call.headers["x-position-y"]).toBe("20");
  expect(call.headers["x-origin"]).toBe("top-left");
  expect(call.headers["x-group-shapes"]).toBe("true");
  expect(call.body.toString()).toMatch(/^<svg/);
  expect(JSON.parse(h.text(r)).status).toBe("imported");
});

test("upload_file with inline content uses the given filename and omits placement headers", async () => {
  h = await startHarness();
  const pending = h.callTool("upload_file", { content: "<svg/>", filename: "inline.svg", wait_seconds: 5 });
  await whenCalled(h, "/api/file/upload", pending);
  h.mock.emitEvent("file_imported", { success: true });
  await pending;
  const call = h.mock.calls.find((c) => c.path === "/api/file/upload")!;
  expect(call.headers["x-filename"]).toBe("inline.svg");
  expect(call.headers["x-position-x"]).toBeUndefined();
  expect(call.headers["x-group-shapes"]).toBeUndefined();
  expect(call.body.toString()).toBe("<svg/>");
});

test("upload_file accepts base64 content", async () => {
  h = await startHarness();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const pending = h.callTool("upload_file", { content_base64: bytes.toString("base64"), filename: "a.png", wait_seconds: 5 });
  await whenCalled(h, "/api/file/upload", pending);
  h.mock.emitEvent("file_imported", { success: true });
  await pending;
  const call = h.mock.calls.find((c) => c.path === "/api/file/upload")!;
  expect(Array.from(call.body)).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("upload_file opens the event stream before posting", async () => {
  h = await startHarness();
  const pending = h.callTool("upload_file", { content: "<svg/>", filename: "a.svg", wait_seconds: 5 });
  await whenCalled(h, "/api/file/upload", pending);
  h.mock.emitEvent("file_imported", { success: true });
  await pending;
  const paths = h.mock.calls.map((c) => c.path);
  expect(paths.indexOf("/api/events")).toBeLessThan(paths.indexOf("/api/file/upload"));
});

test("upload_file reports import failure", async () => {
  h = await startHarness();
  const pending = h.callTool("upload_file", { content: "garbage", filename: "a.svg", wait_seconds: 5 });
  await whenCalled(h, "/api/file/upload", pending);
  h.mock.emitEvent("file_imported", { success: false, error: "Could not parse SVG" });
  const r = await pending;
  expect(r.isError).toBe(true);
  const body = JSON.parse(h.text(r));
  expect(body.status).toBe("import_failed");
  expect(body.error).toBe("Could not parse SVG");
});

test("upload_file times out gracefully", async () => {
  h = await startHarness();
  const r = await h.callTool("upload_file", { content: "<svg/>", filename: "a.svg", wait_seconds: 0.2 });
  expect(r.isError).toBeFalsy();
  const body = JSON.parse(h.text(r));
  expect(body.status).toBe("accepted");
  expect(body.note).toMatch(/No confirmation received within 0.2 s/);
});

test("upload_file without the state capability returns accepted with a hint", async () => {
  h = await startHarness({ capabilities: ["upload"] });
  const r = await h.callTool("upload_file", { content: "<svg/>", filename: "a.svg" });
  expect(r.isError).toBeFalsy();
  const body = JSON.parse(h.text(r));
  expect(body.status).toBe("accepted");
  expect(body.note).toMatch(/state capability/);
  expect(h.mock.calls.some((c) => c.path === "/api/events")).toBe(false);
});

test("upload_file rejects x without y and missing sources", async () => {
  h = await startHarness();
  const r1 = await h.callTool("upload_file", { content: "<svg/>", filename: "a.svg", x: 5 });
  expect(r1.isError).toBe(true);
  expect(h.text(r1)).toMatch(/x and y must be given together/);
  const r2 = await h.callTool("upload_file", { filename: "a.svg" });
  expect(r2.isError).toBe(true);
  expect(h.text(r2)).toMatch(/exactly one of path, content or content_base64/);
  const r3 = await h.callTool("upload_file", { content: "<svg/>" });
  expect(r3.isError).toBe(true);
  expect(h.text(r3)).toMatch(/filename is required/);
  expect(h.mock.calls.some((c) => c.path === "/api/file/upload")).toBe(false);
});

test("upload_file reports a missing local file", async () => {
  h = await startHarness();
  const r = await h.callTool("upload_file", { path: path.join(os.tmpdir(), "does-not-exist-12345.svg") });
  expect(r.isError).toBe(true);
  expect(h.text(r)).toMatch(/Cannot read file/);
});

test("open_file posts to /api/file/open without placement headers", async () => {
  h = await startHarness();
  const pending = h.callTool("open_file", { content: "<lbrn2/>", filename: "p.lbrn2", wait_seconds: 5 });
  await whenCalled(h, "/api/file/open", pending);
  h.mock.emitEvent("file_imported", { success: true });
  const r = await pending;
  expect(JSON.parse(h.text(r)).status).toBe("opened");
  const call = h.mock.calls.find((c) => c.path === "/api/file/open")!;
  expect(call.headers["x-filename"]).toBe("p.lbrn2");
});

test("open_file falls back to get_project for non-native formats", async () => {
  h = await startHarness();
  const pending = h.callTool("open_file", { content: "<svg/>", filename: "a.svg", wait_seconds: 5 });
  await whenCalled(h, "/api/file/open", pending);
  h.mock.emitEvent("file_imported", { success: false, error: "translated text" });
  const r = await pending;
  expect(r.isError).toBeFalsy();
  const body = JSON.parse(h.text(r));
  expect(body.status).toBe("opened_unconfirmed");
  expect(body.project.shape_count).toBe(5);
  expect(body.note).toMatch(/non-native/);
});

test("open_file reports a failed native open", async () => {
  h = await startHarness();
  const pending = h.callTool("open_file", { content: "x", filename: "p.lbrn2", wait_seconds: 5 });
  await whenCalled(h, "/api/file/open", pending);
  h.mock.emitEvent("file_imported", { success: false, error: "Corrupt" });
  const r = await pending;
  expect(r.isError).toBe(true);
  expect(JSON.parse(h.text(r)).status).toBe("open_failed");
});
