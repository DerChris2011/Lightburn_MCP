import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig, saveConfig } from "../src/config.js";
import { resolveHttpToken, startHttpServer } from "../src/http.js";
import { createToolContext } from "../src/tools/context.js";

let tmp: string;
let running: { url: string; close(): Promise<void> } | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-http-"));
  process.env.LIGHTBURN_MCP_CONFIG_DIR = tmp;
  delete process.env.LIGHTBURN_SECRET;
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function start(token = "test-token-123") {
  running = await startHttpServer({ ctx: createToolContext(), host: "127.0.0.1", port: 0, token });
  return running.url;
}

async function listToolNames(transport: StreamableHTTPClientTransport): Promise<string[]> {
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name);
}

test("rejects without token", async () => {
  const url = await start();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "0" } } }),
  });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("rejects a wrong token in the path", async () => {
  const url = await start();
  const res = await fetch(`${url}/wrong`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(res.status).toBe(401);
});

test("accepts the bearer header", async () => {
  const url = await start();
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: "Bearer test-token-123" } },
  });
  const names = await listToolNames(transport);
  expect(names).toContain("get_project");
});

test("accepts the token in the path", async () => {
  const url = await start();
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/test-token-123`));
  const names = await listToolNames(transport);
  expect(names).toContain("pair");
});

test("url ends with /mcp", async () => {
  const url = await start();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
});

test("resolveHttpToken prefers the CLI token, then the stored one, else generates and persists", () => {
  expect(resolveHttpToken({ product: "lightburn", host: "localhost", http_token: "stored" }, "cli")).toEqual({ token: "cli", generated: false });
  expect(resolveHttpToken({ product: "lightburn", host: "localhost", http_token: "stored" })).toEqual({ token: "stored", generated: false });
  const r = resolveHttpToken({ product: "lightburn", host: "localhost" });
  expect(r.generated).toBe(true);
  expect(r.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(loadConfig().http_token).toBe(r.token);
});

test("resolveHttpToken keeps other config fields when persisting", () => {
  saveConfig({ product: "millmage", host: "localhost", secret: "s", capabilities: ["state"] });
  const r = resolveHttpToken(loadConfig());
  const cfg = loadConfig();
  expect(cfg.http_token).toBe(r.token);
  expect(cfg.secret).toBe("s");
  expect(cfg.product).toBe("millmage");
});

test("rejects malformed JSON without a token with a plain 401, not a stack trace", async () => {
  const url = await start();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  expect(res.status).toBe(401);
  expect(await res.text()).not.toMatch(/at .*\.js:\d+/);
});

test("startHttpServer rejects with a clear message when the port is in use", async () => {
  const url = await start();
  const port = Number(new URL(url).port);
  await expect(startHttpServer({ ctx: createToolContext(), host: "127.0.0.1", port, token: "t" })).rejects.toThrow(/Port \d+ is already in use/);
});
