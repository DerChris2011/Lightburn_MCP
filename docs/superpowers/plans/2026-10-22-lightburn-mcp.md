# LightBurn MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally running MCP server (`lightburn-mcp`) that exposes the LightBurn REST API as tools, installable from GitHub with one setup command on Windows and macOS.

**Architecture:** A thin REST client (`client.ts`) handles HMAC tokens, errors and the SSE stream. Tool modules register MCP tools on a `McpServer` through a shared `ToolContext`. One CLI entry (`index.ts`) selects stdio or Streamable HTTP transport and the `setup`/`pair`/`status`/`config`/`token` subcommands. Tests run the real server against a mock LightBurn HTTP server using the SDK's in-memory transport.

**Tech Stack:** Node.js 20+, TypeScript 5 (ESM, `module: NodeNext`), `@modelcontextprotocol/sdk` 1.32.x, `zod` 3.x, `express` (already a dependency of the SDK, add explicitly), `vitest` 3.x. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-lightburn-mcp-design.md`

## Global Constraints

- Target LightBurn 2.2.00; ports fixed: LightBurn `19520`, MillMage `19521`.
- Bearer token = `hex(HMAC-SHA256(secret, String(Math.floor(unixSeconds / 60))))`.
- Capabilities: `state`, `project`, `upload`, `project_write`. Check capability from config before calling; unknown when secret came from env (then skip the check).
- The secret never appears in tool results, logs, stdout (except `pair` CLI prints "paired", not the secret) or client config files.
- `--http` always requires a token; token accepted as `Authorization: Bearer <token>` or path `/mcp/<token>`.
- Every `update_cut` / `apply_material_to_cut` result ends with the exact sentence: `Review these settings in LightBurn before running the job.`
- Repo language, code, tool descriptions, README: English. Install command in docs: `npx github:DerChris2011/Lightburn_MCP setup`.
- stdio mode: never write to `process.stdout` except via the transport; diagnostics go to `process.stderr`.
- Config dir: Windows `%APPDATA%\lightburn-mcp`, macOS `~/Library/Application Support/lightburn-mcp`, Linux `$XDG_CONFIG_HOME/lightburn-mcp` or `~/.config/lightburn-mcp`; env `LIGHTBURN_MCP_CONFIG_DIR` overrides.
- Env overrides: `LIGHTBURN_SECRET`, `LIGHTBURN_HOST`, `LIGHTBURN_PRODUCT`.
- MIT license. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. LightBurn not running: every tool and CLI command must say "LightBurn does not appear to be running (nothing is listening on localhost:19520)" instead of a raw `ECONNREFUSED`. Test in Task 4.
2. A 401 after the secret was revoked in LightBurn: retry once with a fresh token, then advise re-pairing; no infinite retry. Test in Task 4.
3. `upload_file` when the import fails (bad SVG): tool returns the `file_imported` error, not a hang; and when the event never arrives, it returns after the 30 s timeout with "no confirmation received". Test in Task 7 (with a shortened timeout parameter).
4. `--http` started without `--token` and no stored token: server must generate one, persist it, print the URL once, and reject requests without it with 401. Test in Task 9.
5. Setup on Windows writing Claude Desktop config while a config already exists with other servers: existing entries must survive and a `.bak` file must be written. Test in Task 10.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `src/index.ts` (placeholder printing version), `test/smoke.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `npm run build` → `dist/`; `npm test` → vitest; `bin` `lightburn-mcp` → `dist/index.js`.

- [ ] **Step 1: `git init`, write `.gitignore`** (`node_modules/`, `dist/`, `*.log`, `.DS_Store`)

- [ ] **Step 2: Write `package.json`**

Pinned values: `"name": "lightburn-mcp"`, `"version": "0.1.0"`, `"type": "module"`, `"bin": {"lightburn-mcp": "dist/index.js"}`, `"files": ["dist", "README.md", "SAFETY.md", "LICENSE"]`, `"engines": {"node": ">=20"}`, scripts `build: tsc`, `prepare: npm run build`, `test: vitest run`, `test:watch: vitest`, `start: node dist/index.js`. Dependencies: `@modelcontextprotocol/sdk@^1.32.1`, `zod@^3.25.0`, `express@^5.1.0`. DevDependencies: `typescript@^5.6`, `vitest@^3.2`, `@types/node@^20`, `@types/express@^5`. Repository URL `https://github.com/DerChris2011/Lightburn_MCP.git`, license `MIT`.

- [ ] **Step 3: Write `tsconfig.json`**

`target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`, `rootDir: src`, `strict: true`, `declaration: false`, `sourceMap: true`, `include: ["src"]`.

- [ ] **Step 4: Write `src/index.ts`** with shebang `#!/usr/bin/env node` and `console.error("lightburn-mcp 0.1.0")` only (replaced in Task 8), and `test/smoke.test.ts` asserting `1 + 1 === 2`.

- [ ] **Step 5: `npm install`, `npm run build`, `npm test`** — Expected: `dist/index.js` exists, 1 test passes.

- [ ] **Step 6: Write `.github/workflows/ci.yml`**: on push/pull_request, matrix `os: [windows-latest, macos-latest]`, Node 20, `npm ci`, `npm run build`, `npm test`.

- [ ] **Step 7: Write `LICENSE` (MIT, holder "DerChris2011")**

- [ ] **Step 8: Commit** `chore: scaffold lightburn-mcp`

---

### Task 2: Token derivation

**Files:**
- Create: `src/auth.ts`, `test/auth.test.ts`

**Interfaces:**
- Produces: `bearerToken(secret: string, nowMs: number = Date.now()): string`

- [ ] **Step 1: Write failing tests**

```ts
test("matches the documented HMAC scheme", () => {
  expect(bearerToken("aB3dE7fG9hJ1kL5m", 1761130000000))
    .toBe("d09b6be314779b5dea94b11a0cd922a963d71cf5ceadc61f6b710d262463b3e5");
});
test("is stable within a minute and changes across the boundary", () => {
  expect(bearerToken("s", 60_000)).toBe(bearerToken("s", 119_999));
  expect(bearerToken("s", 60_000)).not.toBe(bearerToken("s", 120_000));
});
```

- [ ] **Step 2: Run** `npx vitest run test/auth.test.ts` — Expected: FAIL (module not found)
- [ ] **Step 3: Implement `bearerToken` in `src/auth.ts`** with `node:crypto` `createHmac("sha256", secret)`.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: bearer token derivation`

---

### Task 3: Config store

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Product = "lightburn" | "millmage";
  export type Capability = "state" | "project" | "upload" | "project_write";
  export interface Config {
    product: Product;          // default "lightburn"
    host: string;              // default "localhost"
    secret?: string;
    capabilities?: Capability[];
    paired_at?: string;        // ISO
    http_token?: string;
  }
  export const CAPABILITIES: readonly Capability[];
  export function portFor(product: Product): number;   // 19520 / 19521
  export function configDir(env = process.env, platform = process.platform, home = os.homedir()): string;
  export function loadConfig(): Config;                 // file merged with env overrides; missing file → defaults
  export function saveConfig(cfg: Config): void;        // mkdir -p, write JSON, chmod 0600 on non-Windows
  export function secretSource(): "env" | "file" | "none";
  ```

- [ ] **Step 1: Write failing tests** (set `process.env.LIGHTBURN_MCP_CONFIG_DIR` to a temp dir in `beforeEach`)

```ts
test("configDir follows the platform convention", () => {
  expect(configDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32", "C:\\Users\\u"))
    .toBe(path.join("C:\\Users\\u\\AppData\\Roaming", "lightburn-mcp"));
  expect(configDir({}, "darwin", "/Users/u"))
    .toBe("/Users/u/Library/Application Support/lightburn-mcp");
  expect(configDir({ LIGHTBURN_MCP_CONFIG_DIR: "/x" }, "linux", "/home/u")).toBe("/x");
});
test("loadConfig returns defaults when no file exists", () => {
  expect(loadConfig()).toEqual({ product: "lightburn", host: "localhost" });
});
test("saveConfig then loadConfig round-trips", ...);
test("env overrides win over the file", () => {
  saveConfig({ product: "lightburn", host: "localhost", secret: "file" });
  process.env.LIGHTBURN_SECRET = "env";
  expect(loadConfig().secret).toBe("env");
  expect(secretSource()).toBe("env");
});
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement `src/config.ts`**
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: per-user config store`

---

### Task 4: REST client and mock LightBurn

**Files:**
- Create: `src/client.ts`, `test/helpers/mock-lightburn.ts`, `test/client.test.ts`

**Interfaces:**
- Consumes: `bearerToken`, `Config`, `portFor`
- Produces:
  ```ts
  export type ErrorKind = "unreachable" | "unauthorized" | "forbidden" | "bad_request" | "not_found" | "conflict" | "http";
  export class LightBurnError extends Error { kind: ErrorKind; status?: number; detail?: string; }
  export interface ImportResult { success: boolean; error?: string }
  export class LightBurnClient {
    constructor(opts: { host: string; port: number; secret?: string; fetchImpl?: typeof fetch });
    readonly baseUrl: string;
    getJson<T = unknown>(path: string): Promise<T>;
    postJson<T = unknown>(path: string, body: unknown): Promise<T>;
    postRaw<T = unknown>(path: string, body: Uint8Array, headers: Record<string, string>): Promise<T>;
    getBinary(path: string): Promise<{ bytes: Uint8Array; contentType: string }>;
    connect(applicationName: string, capabilities: Capability[]): Promise<string>; // returns secret; no auth header
    waitForImport(opts: { timeoutMs: number; signal?: AbortSignal }): Promise<{ ready: Promise<void>; result: Promise<ImportResult | null> }>;
    // ready resolves once the SSE stream has received ":connected"; result resolves with null on timeout
    isReachable(): Promise<boolean>;  // GET / without auth
  }
  ```
- Mock helper produces: `startMockLightBurn(opts?: { secret?: string; capabilities?: Capability[]; fixtures?: Partial<Fixtures> }): Promise<{ port: number; url: string; calls: Array<{method,path,headers,body}>; emitEvent(name: string, data: unknown): void; close(): Promise<void> }>`. It validates the Bearer header with `bearerToken(secret)` for the current and previous minute, returns `401 {"error":"Unauthorized"}` otherwise, serves fixture JSON for every documented GET endpoint (fixtures modelled on `openapi.yaml` examples; `/api/cuts` with at least one `in_use: true` normal gantry cut at index 2 with one sub-layer, one tool layer, and one image cut), `POST /api/cuts/{index}` merging the body into the fixture and returning it (409 when `fixtures.editorOpen`, 404 when index out of range, 400 when body has `params.galvo` on a gantry entry), `POST /api/file/upload` and `/api/file/open` returning 202 and recording headers, `GET /api/overlay` returning a 1x1 PNG, `GET /api/events` as SSE sending `:connected` then whatever `emitEvent` pushes, `POST /api/connect` returning `{status:"ok", secret}` (or 403 when `fixtures.declinePairing`).

- [ ] **Step 1: Write failing tests**

```ts
test("sends a bearer token and parses JSON", ...);                // getJson("/api/status") → fixture
test("maps connection refused to an 'unreachable' error with a plain-language message", async () => {
  const c = new LightBurnClient({ host: "localhost", port: 1, secret: "s" });
  await expect(c.getJson("/api/status")).rejects.toMatchObject({ kind: "unreachable" });
  await expect(c.getJson("/api/status")).rejects.toThrow(/does not appear to be running/);
});
test("retries once on 401 then gives up with re-pair advice", ...); // mock with secret "other": exactly 2 calls, error.kind "unauthorized", message matches /pair/
test("maps 400/404/409 to kinds and keeps the API error text", ...);
test("connect posts without auth and returns the secret", ...);
test("waitForImport resolves ready after :connected and returns the file_imported payload", ...);
test("waitForImport returns null after timeoutMs", ...);  // timeoutMs: 200
test("getBinary returns bytes and content type", ...);
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement `test/helpers/mock-lightburn.ts`** with `node:http`.
- [ ] **Step 4: Implement `src/client.ts`.** SSE parsing: read `response.body` with a `TextDecoder`, split on blank lines, parse `event:` / `data:` lines; close the stream after the first `file_imported` or on timeout. The `unreachable` message: `LightBurn does not appear to be running (nothing is listening on ${host}:${port}). Start LightBurn and try again.` The unauthorized message: `LightBurn rejected the token. The secret may have been revoked, may lack the required capability, or may belong to another running copy of LightBurn. Run "lightburn-mcp pair" (or the pair tool) to pair again.`
- [ ] **Step 5: Run** — Expected: PASS
- [ ] **Step 6: Commit** `feat: REST client with token, error mapping and SSE import wait`

---

### Task 5: Server core and read-only tools (state + project)

**Files:**
- Create: `src/server.ts`, `src/tools/context.ts`, `src/tools/state.ts`, `src/tools/project.ts`, `test/helpers/harness.ts`, `test/tools-read.test.ts`

**Interfaces:**
- Consumes: `LightBurnClient`, `Config`, `loadConfig`, `saveConfig`, `secretSource`
- Produces:
  ```ts
  // src/tools/context.ts
  export interface ToolContext {
    config: () => Config;
    saveConfig: (c: Config) => void;
    client: () => LightBurnClient;        // built from current config each call
    requireCapability: (cap: Capability) => void;   // throws LightBurnError kind "unauthorized" with message
      // `This tool needs the "${cap}" capability, but the stored pairing only grants ${list}. Pair again with ${cap} included.`
      // No-op when secretSource() === "env". Throws `Not paired yet. Run the "pair" tool or "lightburn-mcp pair".` when no secret.
    textResult: (data: unknown, note?: string) => CallToolResult;   // JSON.stringify(data, null, 2) + optional trailing note line
    errorResult: (err: unknown) => CallToolResult;  // isError: true, text = message of LightBurnError or Error
  }
  export function createToolContext(overrides?: Partial<ToolContext>): ToolContext;
  // src/server.ts
  export function createServer(ctx: ToolContext): McpServer;   // name "lightburn-mcp", version from package.json; registers all tool groups
  // test/helpers/harness.ts
  export async function startHarness(mockOpts?): Promise<{ mock, client: Client /* SDK client over InMemoryTransport */, callTool(name, args?): Promise<CallToolResult>, close() }>;
  // harness sets LIGHTBURN_MCP_CONFIG_DIR to a temp dir, saves a config whose host/port point at the mock (port via a new config field is NOT added: use LIGHTBURN_HOST="localhost" and override ToolContext.client to construct with the mock port)
  ```
- Tools registered in this task (name → endpoint → zod inputSchema):
  - `get_status` → `/api/status`, no args. Result note: `Note: connected=false is the normal resting state on Ruida and similar controllers; it is not a fault.`
  - `get_position` → `/api/position`
  - `get_units` → `/api/units`
  - `get_jog_settings` → `/api/jog/settings`
  - `get_saved_positions` → `/api/goto/saved`
  - `get_state_snapshot` → `/api/events/poll`
  - `get_project` → `/api/project`
  - `get_layers` → `/api/layers`, `{ in_use_only: z.boolean().default(true) }` filters `layers[]`.
  - `get_cuts` → `/api/cuts`, `{ in_use_only: z.boolean().default(true), compact: z.boolean().default(true) }`. Compact LightBurn entry = `{ index, layer_index, name, kind, mode, enabled, in_use, shape_count, profile, speed: params.speed, min_power: params.min_power, max_power: params.max_power, num_passes: params.num_passes, sub_layers: n }`; MillMage entries pass through unchanged.
  - `get_cut` → `/api/cuts/{index}`, `{ index: z.number().int().min(0) }`
  - `get_material_library` → `/api/material-library`
  - `get_camera_overlay_metadata` → `/api/overlay/metadata`
  - `get_camera_overlay` → `/api/overlay` + metadata; content = `[{ type: "image", data: base64, mimeType: "image/png" }, { type: "text", text: JSON metadata }]`
- Every tool description starts with `Requires capability "<cap>".` and every handler wraps in `try { ctx.requireCapability(cap); ... } catch (e) { return ctx.errorResult(e) }`.

- [ ] **Step 1: Write failing tests** (one per tool, via `callTool`), plus:

```ts
test("lists all 13 read tools", ...);                       // listTools names ⊇ set above
test("get_cuts compact+in_use_only returns only used cuts with core fields", ...);  // index 2 present, tool layer absent
test("get_camera_overlay returns an image block", ...);     // content[0].type === "image"
test("a tool refuses with a capability message when pairing lacks it", ...); // config capabilities ["state"] → get_project isError, /capability/
test("a tool reports 'not running' when nothing listens", ...);
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement context, server, state and project tools, and the harness** (`InMemoryTransport.createLinkedPair()`, `Client` from `@modelcontextprotocol/sdk/client/index.js`).
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: MCP server core with state and project tools`

---

### Task 6: Write tools (`update_cut`, `apply_material_to_cut`)

**Files:**
- Create: `src/tools/cuts.ts`, `test/tools-cuts.test.ts`
- Modify: `src/server.ts` (register)

**Interfaces:**
- Consumes: `ToolContext`
- Produces tools:
  - `update_cut`: inputSchema `{ index: z.number().int().min(0), changes: z.record(z.unknown()) }` → `POST /api/cuts/{index}` with `changes` as body. Description lists the editable fields from the spec (name, enabled, mode, params incl. at most one of params.galvo/params.gantry matching profile, negative, pass_through, enable_cleanup, sort_within_layer, tabs, global_passes on galvo, sub_layers by index; image cuts: name, enabled, params.speed/max_power/dither_mode) and the `override_frequency` rule. 409 → message `The cut settings editor is open in LightBurn. Close it and try again.` Result = updated entry + the mandated review sentence.
  - `apply_material_to_cut`: inputSchema `{ index, material: z.string().optional(), thickness: z.number().optional(), entry_guid: z.number().int().optional() }`. Algorithm: fetch library; candidates = `entry_guid` match, else entries whose `material` equals (case-insensitive) `material` and, when `thickness` given, whose `thickness` equals it; 0 candidates → error listing available materials (unique names); >1 → error listing `{guid, material, description, thickness}`; fetch target `GET /api/cuts/{index}`; refuse (error) when `entry.cut.kind !== target.kind`, or when `entry.cut.sub_layers.length > target.sub_layers.length` with message pointing to `update_cut`; build body `{ mode, params }` from `entry.cut` where `params` drops `galvo`/`gantry` unless it matches `target.profile` (record `skipped_machine_block: true` in the result), plus `sub_layers` for indices present in the target; `POST`. Result = updated entry, `applied_entry: {guid, material, thickness}`, skipped notes, review sentence.
- Pure helper exported for tests: `buildMaterialUpdate(entry: LibraryEntry, target: LaserCut): { body: Record<string, unknown>; skippedMachineBlock: boolean }`.

- [ ] **Step 1: Write failing tests**

```ts
test("update_cut posts the partial body and returns the review sentence", ...);   // mock.calls has POST /api/cuts/2 with body; text ends with sentence
test("update_cut translates 409", ...);
test("update_cut surfaces 400 text from the API", ...);
test("apply_material_to_cut refuses on ambiguous material with candidates", ...);
test("apply_material_to_cut refuses when entry has more sub-layers than target", ...);
test("buildMaterialUpdate drops a galvo block for a gantry target", ...);
test("apply_material_to_cut applies by guid", ...);
```

Mock fixture for `/api/material-library` (LightBurn): three entries: `{guid: 1, material: "Plywood", thickness: 3, cut: {kind:"normal", profile:"gantry", mode:"cut", params:{speed:10,max_power:80,gantry:{run_blower:true}}, sub_layers:[]}}`, `{guid: 2, material: "Plywood", thickness: 6, ...}`, `{guid: 3, material: "Acrylic", thickness: 3, cut: {..., profile:"galvo", params:{..., galvo:{wobble_enable:false}}, sub_layers:[{index:1,...},{index:2,...}]}}`.

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement `src/tools/cuts.ts`**, register in `server.ts`.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: update_cut and apply_material_to_cut tools`

---

### Task 7: File tools (`upload_file`, `open_file`)

**Files:**
- Create: `src/tools/files.ts`, `test/tools-files.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `ToolContext`, `LightBurnClient.waitForImport`, `postRaw`
- Produces tools:
  - `upload_file`: inputSchema `{ path: z.string().optional(), content: z.string().optional(), content_base64: z.string().optional(), filename: z.string().optional(), x: z.number().optional(), y: z.number().optional(), origin: z.enum([...9 values]).optional(), group_shapes: z.boolean().optional(), wait_seconds: z.number().min(0).max(120).default(30) }`. Exactly one of `path` / `content` / `content_base64` (else error). `filename` required with `content*`; defaults to `basename(path)`. `x`/`y` must be given together (else error). Headers: `X-Filename`, `X-Position-X/Y`, `X-Origin`, `X-Group-Shapes` ("true"/"false"). Flow: if capabilities include `state` (or source is env) → `waitForImport({timeoutMs})`, await `ready`, then POST, then await `result`; result text: `{ status: "imported" }` / `{ status: "import_failed", error }` / `{ status: "accepted", note: "No confirmation received within N s; check LightBurn." }` / without `state`: `{ status: "accepted", note: "Pair with the state capability to get import confirmation." }`.
  - `open_file`: `{ path?, content?, content_base64?, filename?, wait_seconds }` → `POST /api/file/open`. Same wait; additionally, when the event reports `success:false` and the filename extension is not `.lbrn`/`.lbrn2`/`.mage`, call `GET /api/project` and report `{ status: "opened_unconfirmed", project }` with the spec's explanation.
- Both tool descriptions mention supported formats (`.svg`, `.dxf`, `.lbrn2`, images) and that `open_file` replaces the current project (LightBurn may prompt to save).

- [ ] **Step 1: Write failing tests**

```ts
test("upload_file sends raw bytes with placement headers", ...);      // path to a temp svg; x=10,y=20,origin="top-left" → headers recorded
test("upload_file with inline content uses the given filename", ...);
test("upload_file reports import success from the SSE event", ...);   // mock.emitEvent("file_imported", {success:true}) after call observed
test("upload_file reports import failure", ...);
test("upload_file times out gracefully", ...);                         // wait_seconds: 0.2 → status "accepted", note matches /No confirmation/
test("upload_file rejects x without y", ...);
test("open_file falls back to get_project for non-native formats", ...);
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement `src/tools/files.ts`**, register.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: upload_file and open_file tools with import confirmation`

---

### Task 8: Pairing tools, stdio CLI entry

**Files:**
- Create: `src/tools/pairing.ts`, `src/cli.ts`, `test/tools-pairing.test.ts`, `test/cli-stdio.test.ts`
- Modify: `src/index.ts`, `src/server.ts`

**Interfaces:**
- Produces tools:
  - `pair`: `{ capabilities: z.array(z.enum(CAPABILITIES)).min(1).default([...all four]), application_name: z.string().default("LightBurn MCP") }` → `client.connect`, then `saveConfig({...cfg, secret, capabilities, paired_at})`. Result: `{ status: "paired", capabilities, paired_at }` and the note `Approve the dialog in LightBurn within 30 seconds.` is included in the description. 403 → `Pairing was declined or timed out in LightBurn.` Never include the secret.
  - `connection_info`: no args → `{ product, host, port, paired: boolean, secret_source, capabilities, paired_at, reachable: boolean }`.
- `src/cli.ts`: `export async function main(argv: string[]): Promise<number>` parsing: no subcommand → stdio server; `--http [--port N] [--host H] [--token T]` → Task 9; `setup`, `pair [--capabilities a,b]`, `status`, `config <client> [--write]`, `token [--rotate]` → Task 10 (stubs returning 2 with "not implemented" until then); `--version`, `--help`.
- `src/index.ts`: shebang; `main(process.argv.slice(2)).then(code => process.exitCode = code)`.

- [ ] **Step 1: Write failing tests**

```ts
test("pair stores the secret and capabilities without returning the secret", ...);  // result text lacks the secret string; loadConfig().secret === mock secret
test("pair reports a declined dialog", ...);
test("connection_info never contains the secret", ...);
test("stdio server answers listTools over a child process", async () => {
  // StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: {...process.env, LIGHTBURN_MCP_CONFIG_DIR: tmp} })
  // expect tool names to include "pair" and "get_project"
});
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement**, run `npm run build` before the stdio test.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: pairing tools and stdio CLI`

---

### Task 9: Streamable HTTP transport with token

**Files:**
- Create: `src/http.ts`, `test/http.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Produces: `export async function startHttpServer(opts: { ctx: ToolContext; host: string; port: number; token: string }): Promise<{ url: string; close(): Promise<void> }>`; `export function resolveHttpToken(cfg: Config, cliToken?: string): { token: string; generated: boolean }` (cli token wins; else `cfg.http_token`; else `randomBytes(24).toString("base64url")`, saved to config).
- Express app: routes `/mcp` and `/mcp/:token` for POST/GET/DELETE. Auth check: `Authorization: Bearer <token>` or `req.params.token`; mismatch → `401 {"error":"Unauthorized"}`. One `StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })` per session, keyed by `mcp-session-id` header, cleaned up on transport close (follow the SDK's documented stateful pattern; `isInitializeRequest` from `@modelcontextprotocol/sdk/types.js`). Bind to `opts.host`. On start, print to stderr: `LightBurn MCP listening on http://HOST:PORT/mcp  (token required: header "Authorization: Bearer …" or URL http://HOST:PORT/mcp/<token>)` and, when generated, the token itself once.
- CLI: `--http` requires token resolution; `--host` other than `127.0.0.1`/`localhost` prints a warning line about exposure.

- [ ] **Step 1: Write failing tests** using `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`:

```ts
test("rejects without token", ...);               // fetch POST /mcp → 401
test("accepts the bearer header", ...);           // transport with requestInit headers → listTools works
test("accepts the token in the path", ...);       // new URL(`${url}/${token}`) → listTools works
test("resolveHttpToken generates and persists when none exists", ...);
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement `src/http.ts`**, wire `--http` in `cli.ts`.
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: streamable HTTP transport with access token`

---

### Task 10: Client config writers and `setup` / `pair` / `status` / `config` / `token` commands

**Files:**
- Create: `src/clients.ts`, `src/setup.ts`, `test/clients.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- `src/clients.ts` produces:
  ```ts
  export type ClientId = "claude-desktop" | "claude-code" | "cursor" | "windsurf" | "vscode" | "gemini-cli";
  export interface ServerCommand { command: string; args: string[] }   // default: { command: process.execPath, args: [absolute path of dist/index.js] }
  export function defaultServerCommand(): ServerCommand;
  export function configPath(client: ClientId, platform = process.platform, env = process.env, home = os.homedir()): string | null; // null for claude-code (uses CLI)
  export function renderSnippet(client: ClientId, cmd: ServerCommand): string;   // JSON text to show the user
  export function mergeIntoFile(client: ClientId, existingText: string | null, cmd: ServerCommand): string; // returns new file text; preserves other entries
  export function claudeCodeCommand(cmd: ServerCommand): string;  // `claude mcp add --scope user lightburn -- "<node>" "<index.js>"`
  ```
  Paths: claude-desktop win `%APPDATA%\Claude\claude_desktop_config.json`, mac `~/Library/Application Support/Claude/claude_desktop_config.json`; cursor `~/.cursor/mcp.json`; windsurf `~/.codeium/windsurf/mcp_config.json`; vscode win `%APPDATA%\Code\User\mcp.json`, mac `~/Library/Application Support/Code/User/mcp.json`; gemini-cli `~/.gemini/settings.json`. Formats: `mcpServers.lightburn = {command, args}` for claude-desktop/cursor/windsurf/gemini-cli; `servers.lightburn = {type:"stdio", command, args}` for vscode.
- `src/setup.ts` produces `export async function runSetup(io: { ask(q: string, def?: string): Promise<string>; log(s: string): void }, ctx: ToolContext): Promise<number>`: steps 1) product, 2) capabilities (default all four; print the camera note for `project`), 3) reachability check with "start LightBurn" hint, 4) pair (print "Approve the dialog in LightBurn within 30 seconds."), 5) for each client in a multi-choice, if `configPath` exists → back up to `<file>.bak-<timestamp>` when present, write `mergeIntoFile`; claude-code → run `claude mcp add …` when `claude` is on PATH else print the command; 6) print "Restart <clients> to load the server." Use `node:readline/promises` for `ask`.
- CLI subcommands: `pair` (non-interactive; `--capabilities` default all), `status` (prints product, host, reachable, paired, capabilities, secret source, http token present), `config <client> [--write]` (prints snippet; `--write` merges), `token [--rotate]` (prints the HTTP token or rotates it).

- [ ] **Step 1: Write failing tests**

```ts
test("configPath per client and platform", ...);
test("mergeIntoFile preserves existing servers and adds lightburn", () => {
  const out = mergeIntoFile("claude-desktop", '{"mcpServers":{"other":{"command":"x"}}}', cmd);
  expect(JSON.parse(out).mcpServers.other.command).toBe("x");
  expect(JSON.parse(out).mcpServers.lightburn.args).toEqual(cmd.args);
});
test("mergeIntoFile creates a fresh file from null", ...);
test("vscode uses the servers key with type stdio", ...);
test("runSetup pairs and writes a backup before overwriting", async () => { /* scripted io answers; temp HOME; asserts .bak-* exists and new file has both servers */ });
```

- [ ] **Step 2: Run** — Expected: FAIL
- [ ] **Step 3: Implement `clients.ts`, `setup.ts`, wire subcommands.**
- [ ] **Step 4: Run** — Expected: PASS
- [ ] **Step 5: Commit** `feat: setup command and client config writers`

---

### Task 11: Documentation and release

**Files:**
- Create: `README.md`, `SAFETY.md`, `docs/clients.md`, `examples/nameplate.svg`
- Modify: `package.json` (description, keywords)

- [ ] **Step 1: Write `SAFETY.md`**: condensed from upstream SAFETY.md (operator review of API-modified settings, no remote/unattended operation, not a safety system), link to the originals, and the note that the LightBurn API is governed by LightBurn's API-EULA.

- [ ] **Step 2: Write `README.md`** with these sections in order: title + one-paragraph pitch; "What you can do" (bullets: explain project, check settings, change settings by sentence, apply library materials, import generated SVG, read machine state, view camera overlay); "What it cannot do" (no start/stop/jog/framing, no shape editing, no save); "Requirements" (LightBurn 2.2.00+, Node 20+ with download link); "Install" (`npx github:DerChris2011/Lightburn_MCP setup`, what the dialog looks like, 30 s); "Clients" (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code, Gemini CLI with the exact snippet form and `lightburn-mcp config <client> --write`); "ChatGPT and other URL-based clients" (`lightburn-mcp --http`, token in URL, ngrok/cloudflared one-liner, warning that the URL is a secret and that LightBurn Software does not endorse remote operation); "Example prompts" (6); "Tools" table (name, capability, one line); "Safety" (link); "Troubleshooting" (not running, 401/re-pair, multiple instances, Windows firewall when enabling network access, `npx` first run is slow); "Development" (`npm install`, `npm test`, mock server); "License".

- [ ] **Step 3: Write `docs/clients.md`** with the full JSON for each client on Windows and macOS.

- [ ] **Step 4: Manual verification against the running LightBurn 2.2.00** (record outcomes in the commit message):
  - `node dist/index.js pair --capabilities state,project,upload,project_write` → approve dialog → `status` shows paired.
  - Via the harness client or MCP Inspector (`npx @modelcontextprotocol/inspector node dist/index.js`): `get_project`, `get_cuts`, `update_cut` on an unused layer (then undo in LightBurn), `upload_file` with `examples/nameplate.svg`, `get_camera_overlay_metadata` (404 acceptable if no camera).
  - `node dist/index.js --http` → `curl` without token → 401; with `/mcp/<token>` → initialize succeeds.

- [ ] **Step 5: Commit** `docs: README, SAFETY, client guides` and push: `git remote add origin https://github.com/DerChris2011/Lightburn_MCP.git && git push -u origin main`.

- [ ] **Step 6: Fresh-machine check**: in a temp dir, `npx -y github:DerChris2011/Lightburn_MCP --version` prints `0.1.0` (proves `prepare` builds on git install).
