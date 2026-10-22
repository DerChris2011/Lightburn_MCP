import { afterEach, beforeEach, expect, test } from "vitest";
import { LightBurnClient, LightBurnError } from "../src/client.js";
import { startMockLightBurn, type MockLightBurn } from "./helpers/mock-lightburn.js";

let mock: MockLightBurn;

beforeEach(async () => {
  mock = await startMockLightBurn({ secret: "topsecret" });
});

afterEach(async () => {
  await mock.close();
});

function client(secret = "topsecret"): LightBurnClient {
  return new LightBurnClient({ host: "127.0.0.1", port: mock.port, secret });
}

test("sends a bearer token and parses JSON", async () => {
  const status = await client().getJson<{ device_name: string }>("/api/status");
  expect(status.device_name).toBe("Mock Laser");
  expect(mock.calls[0]?.headers.authorization).toMatch(/^Bearer [0-9a-f]{64}$/);
});

test("maps connection refused to an 'unreachable' error with a plain-language message", async () => {
  const c = new LightBurnClient({ host: "127.0.0.1", port: 1, secret: "s" });
  await expect(c.getJson("/api/status")).rejects.toMatchObject({ kind: "unreachable" });
  await expect(c.getJson("/api/status")).rejects.toThrow(/does not appear to be running/);
});

test("retries once on 401 then gives up with re-pair advice", async () => {
  const c = client("wrong");
  const err = await c.getJson("/api/status").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(LightBurnError);
  expect((err as LightBurnError).kind).toBe("unauthorized");
  expect((err as LightBurnError).message).toMatch(/pair/);
  expect(mock.calls.filter((x) => x.path === "/api/status")).toHaveLength(2);
});

test("maps 400/404/409 to kinds and keeps the API error text", async () => {
  const c = client();
  const notFound = await c.getJson("/api/cuts/999").catch((e: unknown) => e as LightBurnError);
  expect(notFound).toMatchObject({ kind: "not_found", status: 404 });

  const bad = await c
    .postJson("/api/cuts/2", { params: { galvo: { wobble_enable: true } } })
    .catch((e: unknown) => e as LightBurnError);
  expect(bad).toMatchObject({ kind: "bad_request", status: 400 });
  expect((bad as LightBurnError).message).toMatch(/galvo/i);

  mock.fixtures.editorOpen = true;
  const conflict = await c.postJson("/api/cuts/2", { enabled: true }).catch((e: unknown) => e as LightBurnError);
  expect(conflict).toMatchObject({ kind: "conflict", status: 409 });
});

test("connect posts without auth and returns the secret", async () => {
  const c = new LightBurnClient({ host: "127.0.0.1", port: mock.port });
  const secret = await c.connect("Test App", ["state", "project"]);
  expect(secret).toBe("topsecret");
  const call = mock.calls.find((x) => x.path === "/api/connect");
  expect(call?.headers.authorization).toBeUndefined();
  expect(JSON.parse(call!.body.toString())).toEqual({ application_name: "Test App", capabilities: ["state", "project"] });
});

test("connect reports a declined dialog as forbidden", async () => {
  mock.fixtures.declinePairing = true;
  const c = new LightBurnClient({ host: "127.0.0.1", port: mock.port });
  await expect(c.connect("Test App", ["state"])).rejects.toMatchObject({ kind: "forbidden" });
});

test("waitForImport resolves ready after :connected and returns the file_imported payload", async () => {
  const c = client();
  const wait = await c.waitForImport({ timeoutMs: 5000 });
  await wait.ready;
  mock.emitEvent("file_imported", { success: false, error: "bad svg" });
  await expect(wait.result).resolves.toEqual({ success: false, error: "bad svg" });
});

test("waitForImport returns null after timeoutMs", async () => {
  const c = client();
  const wait = await c.waitForImport({ timeoutMs: 200 });
  await wait.ready;
  await expect(wait.result).resolves.toBeNull();
});

test("getBinary returns bytes and content type", async () => {
  const { bytes, contentType } = await client().getBinary("/api/overlay");
  expect(contentType).toBe("image/png");
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("postRaw sends the body and custom headers", async () => {
  const res = await client().postRaw<{ status: string }>("/api/file/upload", new TextEncoder().encode("<svg/>"), {
    "X-Filename": "a.svg",
    "X-Position-X": "10",
  });
  expect(res.status).toBe("accepted");
  const call = mock.calls.find((x) => x.path === "/api/file/upload");
  expect(call?.headers["x-filename"]).toBe("a.svg");
  expect(call?.headers["x-position-x"]).toBe("10");
  expect(call?.body.toString()).toBe("<svg/>");
});

test("isReachable is true for the mock and false for a closed port", async () => {
  expect(await client().isReachable()).toBe(true);
  expect(await new LightBurnClient({ host: "127.0.0.1", port: 1 }).isReachable()).toBe(false);
});
