import { afterEach, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { main } from "../src/cli.js";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "dist", "index.js");
let tmp: string;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore", shell: true });
});

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test("stdio server answers listTools over a child process", async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, LIGHTBURN_MCP_CONFIG_DIR: tmp } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  expect(names).toContain("pair");
  expect(names).toContain("get_project");
  expect(names).toContain("upload_file");
  expect(names).toContain("update_cut");
  expect(names).toContain("connection_info");
  await client.close();
});

test("--version prints the package version and exits 0", () => {
  const out = execFileSync(process.execPath, [entry, "--version"], { encoding: "utf8" });
  expect(out.trim()).toBe("0.1.0");
});

test("--help lists the subcommands", () => {
  const out = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8" });
  for (const word of ["setup", "pair", "status", "config", "token", "--http"]) expect(out).toContain(word);
});

test("main returns a usage error for an unknown subcommand", async () => {
  const errors: string[] = [];
  const code = await main(["frobnicate"], { log: () => undefined, error: (s) => errors.push(s) });
  expect(code).toBe(2);
  expect(errors.join("\n")).toMatch(/Unknown command "frobnicate"/);
});
