import { bearerToken } from "./auth.js";
import type { Capability } from "./config.js";

export type ErrorKind = "unreachable" | "unauthorized" | "forbidden" | "bad_request" | "not_found" | "conflict" | "http";

export class LightBurnError extends Error {
  kind: ErrorKind;
  status?: number;
  detail?: string;
  constructor(kind: ErrorKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = "LightBurnError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export interface ImportResult {
  success: boolean;
  error?: string;
}

export interface ClientOptions {
  host: string;
  port: number;
  secret?: string;
  fetchImpl?: typeof fetch;
}

function unreachableMessage(host: string, port: number): string {
  return `LightBurn does not appear to be running (nothing is listening on ${host}:${port}). Start LightBurn and try again.`;
}

const UNAUTHORIZED_MESSAGE =
  'LightBurn rejected the token. The secret may have been revoked, may lack the required capability, or may belong to another running copy of LightBurn. Run "lightburn-mcp pair" (or the pair tool) to pair again.';

async function errorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (parsed && typeof parsed.error === "string") return parsed.error;
    } catch {
      /* not JSON */
    }
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

export class LightBurnClient {
  readonly baseUrl: string;
  private readonly host: string;
  private readonly port: number;
  private readonly secret?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.host = opts.host;
    this.port = opts.port;
    this.secret = opts.secret;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = `http://${opts.host}:${opts.port}`;
  }

  private authHeader(): Record<string, string> {
    return this.secret ? { Authorization: `Bearer ${bearerToken(this.secret)}` } : {};
  }

  private async doFetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(this.baseUrl + path, init);
    } catch (e) {
      throw new LightBurnError("unreachable", unreachableMessage(this.host, this.port), undefined, (e as Error)?.message);
    }
  }

  /** Authenticated request with a single retry on 401 (fresh token). */
  private async request(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.doFetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...this.authHeader() } });
      if (res.status === 401 && attempt === 0) {
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      if (res.ok) return res;
      const detail = await errorDetail(res);
      throw LightBurnClient.toError(res.status, detail);
    }
  }

  static toError(status: number, detail: string): LightBurnError {
    switch (status) {
      case 401:
        return new LightBurnError("unauthorized", UNAUTHORIZED_MESSAGE, status, detail);
      case 403:
        return new LightBurnError("forbidden", detail || "Forbidden", status, detail);
      case 400:
        return new LightBurnError("bad_request", `LightBurn rejected the request: ${detail || "bad request"}`, status, detail);
      case 404:
        return new LightBurnError("not_found", `Not found: ${detail || "the endpoint or index does not exist"}`, status, detail);
      case 409:
        return new LightBurnError("conflict", `Conflict: ${detail || "the operation is blocked right now"}`, status, detail);
      default:
        return new LightBurnError("http", `LightBurn answered HTTP ${status}${detail ? `: ${detail}` : ""}`, status, detail);
    }
  }

  async getJson<T = unknown>(path: string): Promise<T> {
    const res = await this.request(path, { method: "GET" });
    return (await res.json()) as T;
  }

  async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  async postRaw<T = unknown>(path: string, body: Uint8Array, headers: Record<string, string>): Promise<T> {
    const res = await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...headers },
      body: new Blob([body as BlobPart]),
    });
    return (await res.json()) as T;
  }

  async getBinary(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.request(path, { method: "GET" });
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  }

  /** Pair with the running application. Localhost only; shows a consent dialog. */
  async connect(applicationName: string, capabilities: Capability[]): Promise<string> {
    const res = await this.doFetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_name: applicationName, capabilities }),
    });
    if (!res.ok) {
      const detail = await errorDetail(res);
      if (res.status === 403) {
        throw new LightBurnError("forbidden", "Pairing was declined or timed out in LightBurn.", 403, detail);
      }
      throw LightBurnClient.toError(res.status, detail);
    }
    const data = (await res.json()) as { secret?: unknown };
    if (typeof data.secret !== "string" || !data.secret) {
      throw new LightBurnError("http", "LightBurn did not return a secret.", res.status);
    }
    return data.secret;
  }

  /** GET / without auth. */
  async isReachable(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(this.baseUrl + "/", { method: "GET" });
      await res.arrayBuffer().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Opens the SSE stream and waits for the next `file_imported` event.
   * `ready` resolves once the stream is open; `result` resolves with the
   * event payload, or null when `timeoutMs` elapses first.
   */
  async waitForImport(opts: { timeoutMs: number; signal?: AbortSignal }): Promise<{ ready: Promise<void>; result: Promise<ImportResult | null> }> {
    const controller = new AbortController();
    opts.signal?.addEventListener("abort", () => controller.abort());

    let resolveReady!: () => void;
    let rejectReady!: (e: unknown) => void;
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    const result = (async (): Promise<ImportResult | null> => {
      let res: Response;
      try {
        res = await this.doFetch("/api/events", { method: "GET", headers: this.authHeader(), signal: controller.signal });
      } catch (e) {
        rejectReady(e);
        throw e;
      }
      if (!res.ok || !res.body) {
        const err = LightBurnClient.toError(res.status, await errorDetail(res));
        rejectReady(err);
        throw err;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let readyFired = false;
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return null;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (!readyFired && block.startsWith(":")) {
              readyFired = true;
              resolveReady();
            }
            let event = "message";
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (event === "file_imported") {
              try {
                const parsed = JSON.parse(dataLines.join("\n")) as ImportResult;
                return { success: Boolean(parsed.success), ...(parsed.error ? { error: String(parsed.error) } : {}) };
              } catch {
                return { success: false, error: "Unparseable file_imported event" };
              }
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted) return null;
        throw e;
      } finally {
        clearTimeout(timer);
        if (!readyFired) resolveReady();
        controller.abort();
        reader.releaseLock?.();
      }
    })();

    result.catch(() => undefined);
    return { ready, result };
  }
}
