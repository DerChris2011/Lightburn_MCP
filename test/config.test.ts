import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configDir, loadConfig, portFor, saveConfig, secretSource } from "../src/config.js";

let tmp: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lbmcp-cfg-"));
  process.env.LIGHTBURN_MCP_CONFIG_DIR = tmp;
  delete process.env.LIGHTBURN_SECRET;
  delete process.env.LIGHTBURN_HOST;
  delete process.env.LIGHTBURN_PRODUCT;
});

afterEach(() => {
  process.env = { ...savedEnv };
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("configDir follows the platform convention", () => {
  expect(configDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32", "C:\\Users\\u")).toBe(
    path.join("C:\\Users\\u\\AppData\\Roaming", "lightburn-mcp"),
  );
  expect(configDir({}, "darwin", "/Users/u")).toBe(
    path.join("/Users/u", "Library", "Application Support", "lightburn-mcp"),
  );
  expect(configDir({}, "linux", "/home/u")).toBe(path.join("/home/u", ".config", "lightburn-mcp"));
  expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/u")).toBe(path.join("/xdg", "lightburn-mcp"));
  expect(configDir({ LIGHTBURN_MCP_CONFIG_DIR: "/x" }, "linux", "/home/u")).toBe("/x");
});

test("portFor maps products to their fixed ports", () => {
  expect(portFor("lightburn")).toBe(19520);
  expect(portFor("millmage")).toBe(19521);
});

test("loadConfig returns defaults when no file exists", () => {
  expect(loadConfig()).toEqual({ product: "lightburn", host: "localhost" });
  expect(secretSource()).toBe("none");
});

test("saveConfig then loadConfig round-trips", () => {
  saveConfig({
    product: "millmage",
    host: "10.0.0.5",
    secret: "abc",
    capabilities: ["state", "upload"],
    paired_at: "2026-10-22T10:00:00.000Z",
  });
  expect(loadConfig()).toEqual({
    product: "millmage",
    host: "10.0.0.5",
    secret: "abc",
    capabilities: ["state", "upload"],
    paired_at: "2026-10-22T10:00:00.000Z",
  });
  expect(secretSource()).toBe("file");
  expect(fs.existsSync(path.join(tmp, "config.json"))).toBe(true);
});

test("env overrides win over the file", () => {
  saveConfig({ product: "lightburn", host: "localhost", secret: "file" });
  process.env.LIGHTBURN_SECRET = "env";
  process.env.LIGHTBURN_HOST = "laser.local";
  process.env.LIGHTBURN_PRODUCT = "millmage";
  const cfg = loadConfig();
  expect(cfg.secret).toBe("env");
  expect(cfg.host).toBe("laser.local");
  expect(cfg.product).toBe("millmage");
  expect(secretSource()).toBe("env");
});
