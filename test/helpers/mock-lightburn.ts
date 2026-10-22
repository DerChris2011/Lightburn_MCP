/**
 * A small in-process stand-in for the LightBurn REST API, modelled on
 * docs/openapi.yaml of LightBurnSoftware/LightBurn-REST. Used by the
 * client and tool tests; never shipped.
 */
import http from "node:http";
import { AddressInfo } from "node:net";
import { bearerToken } from "../../src/auth.js";
import type { Capability } from "../../src/config.js";

export interface RecordedCall {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface Fixtures {
  editorOpen: boolean;
  /** Frame SSE with CRLF line endings. */
  crlf: boolean;
  declinePairing: boolean;
  product: "lightburn" | "millmage";
  status: Record<string, unknown>;
  position: Record<string, unknown>;
  units: Record<string, unknown>;
  jogSettings: Record<string, unknown>;
  savedPositions: Record<string, unknown>;
  poll: Record<string, unknown>;
  project: Record<string, unknown>;
  layers: Record<string, unknown>;
  cuts: Array<Record<string, any>>;
  materialLibrary: Record<string, unknown>;
  overlayMetadata: Record<string, unknown>;
  overlayPng: Buffer | null;
}

export interface MockLightBurn {
  port: number;
  url: string;
  secret: string;
  calls: RecordedCall[];
  fixtures: Fixtures;
  emitEvent(name: string, data: unknown): void;
  close(): Promise<void>;
}

// 1x1 transparent PNG
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function gantryParams(speed: number, maxPower: number, extra: Record<string, unknown> = {}) {
  return {
    speed,
    min_power: 10,
    max_power: maxPower,
    min_power_2: 0,
    max_power_2: 0,
    num_passes: 1,
    z_offset: 0,
    kerf: 0,
    frequency: 20000,
    override_frequency: false,
    bi_directional: true,
    scan_opt: "individual",
    angle: 0,
    interval: 0.1,
    gantry: { run_blower: true, auto_blower: false, enable_ppi: false, ppi: 0, dot_mode: false, ...extra },
  };
}

function cutEntry(index: number, overrides: Record<string, any>): Record<string, any> {
  return {
    index,
    name: `C${String(index).padStart(2, "0")}`,
    kind: "normal",
    layer_index: index,
    enabled: true,
    priority: index,
    in_use: false,
    shape_count: 0,
    profile: "gantry",
    negative: false,
    pass_through: false,
    enable_cleanup: false,
    sort_within_layer: false,
    tabs: { enabled: false, count: -1 },
    mode: "cut",
    params: gantryParams(100, 50),
    sub_layers: [],
    ...overrides,
  };
}

export function defaultFixtures(): Fixtures {
  const cuts: Array<Record<string, any>> = [];
  for (let i = 0; i < 30; i++) cuts.push(cutEntry(i, {}));
  cuts[2] = cutEntry(2, {
    name: "Cut Line",
    in_use: true,
    shape_count: 3,
    params: gantryParams(10, 80),
    sub_layers: [{ index: 1, name: "Second pass", enabled: true, mode: "cut", params: gantryParams(12, 70) }],
  });
  cuts[5] = cutEntry(5, { name: "Engrave", mode: "scan", in_use: true, shape_count: 1, params: gantryParams(300, 20) });
  cuts.push(cutEntry(30, { name: "T1", layer_index: 30, mode: "tool", in_use: false }));
  cuts.push(cutEntry(31, { name: "T2", layer_index: 31, mode: "tool", in_use: false }));
  cuts.push(cutEntry(32, { name: "VirtualArray", layer_index: -1, in_use: false }));
  for (let i = 0; i < 30; i++) {
    cuts.push({
      index: 33 + i,
      name: `Image C${String(i).padStart(2, "0")}`,
      kind: "image",
      layer_index: i,
      enabled: true,
      priority: i,
      in_use: i === 7,
      shape_count: i === 7 ? 1 : 0,
      profile: "gantry",
      params: { speed: 200, max_power: 30, dpi: 254, dither_mode: "Stucki" },
    });
  }
  const layers = [];
  for (let i = 0; i < 32; i++) {
    layers.push({
      index: i,
      name: i === 2 ? "Cut Line" : i === 5 ? "Engrave" : `C${String(i).padStart(2, "0")}`,
      color: i === 2 ? "#ff0000" : "#000000",
      type: i >= 30 ? "tool" : "normal",
      hidden: false,
      in_use: i === 2 || i === 5 || i === 7,
      shape_count: i === 2 ? 3 : i === 5 || i === 7 ? 1 : 0,
    });
  }
  return {
    editorOpen: false,
    crlf: false,
    declinePairing: false,
    product: "lightburn",
    status: { connected: false, device_name: "Mock Laser", supports_z: false, supports_overrides: true },
    position: { machine: { x: 100, y: 50 }, workpiece: { x: 0, y: 0 } },
    units: { units: "mm/s", distance_units: "mm" },
    jogSettings: { xy_distance: 10, z_distance: 1, xy_speed: 1500, z_speed: 250, units: "mm/min", distance_units: "mm" },
    savedPositions: { positions: [{ index: 0, name: "Park", x: 0, y: 0, z: 0, include_z: false, workpiece: false }] },
    poll: {
      position: { machine: { x: 100, y: 50 }, workpiece: { x: 0, y: 0 } },
      job: { state: "idle" },
      overrides: { speed_percent: 100, power_percent: 100 },
      connection: { connected: false, device_name: "Mock Laser" },
    },
    project: {
      filename: "test.lbrn2",
      modified: false,
      shape_count: 5,
      units: { distance: "mm", speed: "mm/s" },
      workspace: {
        machine_size: { x: 400, y: 400 },
        workpiece_size: { x: 400, y: 400 },
        workpiece_offset: { x: 0, y: 0 },
        machine_view: false,
      },
      device: { name: "Mock Laser", supports_z: false, laser: { controller: "GRBL", galvo: false, sources: 1, sources_enabled: 1, mopa_source: 0 } },
    },
    layers: { active_index: 2, layers },
    cuts,
    materialLibrary: {
      product: "lightburn",
      name: "Test Library",
      filename: "test.clb",
      entries: [
        {
          guid: 1,
          material: "Plywood",
          description: "Cut",
          thickness: 3,
          locked: false,
          cut: { ...cutEntry(-1, { layer_index: -1, name: "Plywood 3mm", params: gantryParams(10, 80, { run_blower: true }) }) },
        },
        {
          guid: 2,
          material: "Plywood",
          description: "Cut",
          thickness: 6,
          locked: false,
          cut: { ...cutEntry(-1, { layer_index: -1, name: "Plywood 6mm", params: gantryParams(6, 90) }) },
        },
        {
          guid: 3,
          material: "Acrylic",
          description: "Cut",
          thickness: 3,
          locked: false,
          cut: {
            ...cutEntry(-1, {
              layer_index: -1,
              name: "Acrylic 3mm",
              profile: "galvo",
              params: { speed: 500, min_power: 50, max_power: 90, num_passes: 2, galvo: { wobble_enable: false, jump_speed: 4000 } },
              sub_layers: [
                { index: 1, name: "L1", enabled: true, mode: "cut", params: { speed: 400, max_power: 80 } },
                { index: 2, name: "L2", enabled: true, mode: "cut", params: { speed: 300, max_power: 70 } },
              ],
            }),
          },
        },
      ],
    },
    overlayMetadata: { source: "overhead", width: 1, height: 1, bounds: { x: 0, y: 0, width: 400, height: 400 }, revision: "1" },
    overlayPng: PNG_1X1,
  };
}

function deepMerge(target: any, patch: any): any {
  if (Array.isArray(patch) || typeof patch !== "object" || patch === null) return patch;
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? deepMerge(target?.[k] ?? {}, v) : v;
  }
  return out;
}

export async function startMockLightBurn(opts: {
  secret?: string;
  capabilities?: Capability[];
  fixtures?: Partial<Fixtures>;
} = {}): Promise<MockLightBurn> {
  const secret = opts.secret ?? "mock-secret";
  const capabilities = opts.capabilities ?? ["state", "project", "upload", "project_write"];
  const fixtures: Fixtures = { ...defaultFixtures(), ...opts.fixtures };
  const calls: RecordedCall[] = [];
  const sseClients = new Set<http.ServerResponse>();

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const authorized = (req: http.IncomingMessage): boolean => {
    const h = req.headers.authorization ?? "";
    const token = h.replace(/^Bearer /, "");
    const now = Date.now();
    return token === bearerToken(secret, now) || token === bearerToken(secret, now - 60_000);
  };

  const capFor = (method: string, path: string): Capability | null => {
    if (path.startsWith("/api/events") || ["/api/status", "/api/position", "/api/jog/settings", "/api/goto/saved", "/api/units"].includes(path)) return "state";
    if (path.startsWith("/api/file/")) return "upload";
    if (/^\/api\/cuts\/\d+$/.test(path) && method === "POST") return "project_write";
    if (["/api/project", "/api/layers", "/api/cuts", "/api/material-library", "/api/overlay", "/api/overlay/metadata"].includes(path) || /^\/api\/cuts\/\d+$/.test(path)) return "project";
    return null;
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "/").split("?")[0];
      const method = req.method ?? "GET";
      calls.push({ method, path, headers: req.headers, body });

      if (path === "/" && method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<html><body>LightBurn</body></html>");
      }
      if (path === "/api/connect" && method === "POST") {
        let parsed: any;
        try {
          parsed = JSON.parse(body.toString() || "{}");
        } catch {
          return json(res, 400, { error: "Invalid JSON" });
        }
        const caps: unknown = parsed.capabilities;
        if (!Array.isArray(caps) || caps.length === 0) return json(res, 400, { error: "Missing capabilities" });
        for (const c of caps) {
          if (!["state", "project", "upload", "project_write"].includes(c)) return json(res, 400, { error: `Unknown capability: ${c}` });
        }
        if (fixtures.declinePairing) return json(res, 403, { error: "Connection rejected by user" });
        return json(res, 200, { status: "ok", secret });
      }

      const cap = capFor(method, path);
      if (!authorized(req) || (cap && !capabilities.includes(cap))) {
        return json(res, 401, { error: "Unauthorized" });
      }

      if (method === "GET") {
        switch (path) {
          case "/api/status": return json(res, 200, fixtures.status);
          case "/api/position": return json(res, 200, fixtures.position);
          case "/api/units": return json(res, 200, fixtures.units);
          case "/api/jog/settings": return json(res, 200, fixtures.jogSettings);
          case "/api/goto/saved": return json(res, 200, fixtures.savedPositions);
          case "/api/events/poll": return json(res, 200, fixtures.poll);
          case "/api/project": return json(res, 200, fixtures.project);
          case "/api/layers": return json(res, 200, fixtures.layers);
          case "/api/cuts": return json(res, 200, { product: fixtures.product, cuts: fixtures.cuts });
          case "/api/material-library": return json(res, 200, fixtures.materialLibrary);
          case "/api/overlay/metadata":
            return fixtures.overlayPng ? json(res, 200, fixtures.overlayMetadata) : json(res, 404, { error: "No overlay" });
          case "/api/overlay":
            if (!fixtures.overlayPng) return json(res, 404, { error: "No overlay" });
            res.writeHead(200, { "Content-Type": "image/png" });
            return res.end(fixtures.overlayPng);
          case "/api/events":
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
            res.write(fixtures.crlf ? ":connected\r\n\r\n" : ":connected\n\n");
            sseClients.add(res);
            res.on("close", () => sseClients.delete(res));
            return;
        }
        const m = /^\/api\/cuts\/(\d+)$/.exec(path);
        if (m) {
          const entry = fixtures.cuts[Number(m[1])];
          return entry ? json(res, 200, entry) : json(res, 404, { error: "Cut index out of range" });
        }
      }

      if (method === "POST") {
        const m = /^\/api\/cuts\/(\d+)$/.exec(path);
        if (m) {
          const idx = Number(m[1]);
          const entry = fixtures.cuts[idx];
          if (!entry) return json(res, 404, { error: "Cut index out of range" });
          if (fixtures.editorOpen) return json(res, 409, { error: "Cut settings editor is open" });
          let patch: any;
          try {
            patch = JSON.parse(body.toString() || "{}");
          } catch {
            return json(res, 400, { error: "Invalid JSON" });
          }
          if (entry.mode === "tool" || entry.layer_index === -1) return json(res, 400, { error: "Entry is not editable" });
          if (patch.params?.galvo && entry.profile !== "galvo") return json(res, 400, { error: "params.galvo does not match profile gantry" });
          if (patch.params?.gantry && entry.profile !== "gantry") return json(res, 400, { error: "params.gantry does not match profile galvo" });
          const { sub_layers, ...rest } = patch;
          let updated = deepMerge(entry, rest);
          if (Array.isArray(sub_layers)) {
            updated.sub_layers = (entry.sub_layers ?? []).map((sl: any) => {
              const p = sub_layers.find((x: any) => x.index === sl.index);
              return p ? deepMerge(sl, p) : sl;
            });
          }
          fixtures.cuts[idx] = updated;
          return json(res, 200, updated);
        }
        if (path === "/api/file/upload" || path === "/api/file/open") {
          const filename = (req.headers["x-filename"] as string) ?? "upload.lbrn2";
          return json(res, 202, { status: "accepted", filename });
        }
      }
      json(res, 404, { error: "Not found" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    secret,
    calls,
    fixtures,
    emitEvent(name, data) {
      const nl = fixtures.crlf ? "\r\n" : "\n";
      for (const res of sseClients) res.write(`event: ${name}${nl}data: ${JSON.stringify(data)}${nl}${nl}`);
    },
    async close() {
      for (const res of sseClients) res.end();
      sseClients.clear();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
