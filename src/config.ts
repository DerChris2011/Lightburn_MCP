import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Product = "lightburn" | "millmage";
export type Capability = "state" | "project" | "upload" | "project_write";

export const CAPABILITIES: readonly Capability[] = ["state", "project", "upload", "project_write"];
export const PRODUCTS: readonly Product[] = ["lightburn", "millmage"];

export interface Config {
  product: Product;
  host: string;
  secret?: string;
  capabilities?: Capability[];
  paired_at?: string;
  http_token?: string;
}

const APP_DIR = "lightburn-mcp";
const FILE = "config.json";

export function portFor(product: Product): number {
  return product === "millmage" ? 19521 : 19520;
}

export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.LIGHTBURN_MCP_CONFIG_DIR) return env.LIGHTBURN_MCP_CONFIG_DIR;
  if (platform === "win32") {
    const base = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(base, APP_DIR);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_DIR);
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(base, APP_DIR);
}

export function configFile(): string {
  return path.join(configDir(), FILE);
}

function readFile(): Partial<Config> {
  try {
    const text = fs.readFileSync(configFile(), "utf8");
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Partial<Config>) : {};
  } catch {
    return {};
  }
}

function isProduct(v: unknown): v is Product {
  return typeof v === "string" && (PRODUCTS as readonly string[]).includes(v);
}

/** File contents merged with env overrides; defaults when nothing is stored. */
export function loadConfig(): Config {
  const file = readFile();
  const env = process.env;
  const cfg: Config = {
    product: isProduct(file.product) ? file.product : "lightburn",
    host: typeof file.host === "string" && file.host ? file.host : "localhost",
  };
  if (typeof file.secret === "string" && file.secret) cfg.secret = file.secret;
  if (Array.isArray(file.capabilities)) {
    cfg.capabilities = file.capabilities.filter((c): c is Capability =>
      (CAPABILITIES as readonly string[]).includes(c),
    );
  }
  if (typeof file.paired_at === "string") cfg.paired_at = file.paired_at;
  if (typeof file.http_token === "string" && file.http_token) cfg.http_token = file.http_token;

  if (env.LIGHTBURN_PRODUCT && isProduct(env.LIGHTBURN_PRODUCT)) cfg.product = env.LIGHTBURN_PRODUCT;
  if (env.LIGHTBURN_HOST) cfg.host = env.LIGHTBURN_HOST;
  if (env.LIGHTBURN_SECRET) {
    cfg.secret = env.LIGHTBURN_SECRET;
    delete cfg.capabilities; // unknown for an externally supplied secret
  }
  return cfg;
}

export function saveConfig(cfg: Config): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = configFile();
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
  }
}

export function secretSource(): "env" | "file" | "none" {
  if (process.env.LIGHTBURN_SECRET) return "env";
  const file = readFile();
  return typeof file.secret === "string" && file.secret ? "file" : "none";
}
