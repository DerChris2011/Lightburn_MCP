import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Server as NodeServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { CliIo } from "./cli.js";
import { updateConfigFile, type Config } from "./config.js";
import { createServer } from "./server.js";
import type { ToolContext } from "./tools/context.js";

export const DEFAULT_HTTP_PORT = 3917;

export function resolveHttpToken(cfg: Config, cliToken?: string): { token: string; generated: boolean } {
  if (cliToken) return { token: cliToken, generated: false };
  if (cfg.http_token) return { token: cfg.http_token, generated: false };
  const token = randomBytes(24).toString("base64url");
  updateConfigFile({ http_token: token });
  return { token, generated: true };
}

function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startHttpServer(opts: { ctx: ToolContext; host: string; port: number; token: string }): Promise<{ url: string; close(): Promise<void> }> {
  const app = express();
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const authorized = (req: Request): boolean => {
    const header = req.headers.authorization;
    const bearer = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
    const pathToken = typeof req.params.token === "string" ? req.params.token : undefined;
    return tokenMatches(bearer, opts.token) || tokenMatches(pathToken, opts.token);
  };

  // Auth runs before any body parsing so unauthenticated callers get nothing but a 401.
  const requireToken = (req: Request, res: Response, next: () => void): void => {
    if (!authorized(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
  const parseJson = express.json({ limit: "32mb" });
  const jsonErrors = (err: unknown, _req: Request, res: Response, next: (e?: unknown) => void): void => {
    if (err) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error: invalid JSON body" }, id: null });
      return;
    }
    next();
  };

  const handle = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (existing) {
      await existing.handleRequest(req, res, req.body);
      return;
    }
    if (req.method === "POST" && !sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      const server = createServer(opts.ctx);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: no valid session. Send an initialize request first." }, id: null });
  };

  app.all("/mcp", requireToken, parseJson, jsonErrors, handle);
  app.all("/mcp/:token", requireToken, parseJson, jsonErrors, handle);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found. The MCP endpoint is /mcp" });
  });

  const httpServer: NodeServer = await new Promise((resolve, reject) => {
    const s = app.listen(opts.port, opts.host);
    s.once("listening", () => resolve(s));
    s.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") reject(new Error(`Port ${opts.port} is already in use on ${opts.host}. Pass --port <N> to use another port.`));
      else reject(err);
    });
  });
  const { port } = httpServer.address() as AddressInfo;
  const hostForUrl = opts.host === "0.0.0.0" || opts.host === "::" ? "localhost" : opts.host;

  return {
    url: `http://${hostForUrl}:${port}/mcp`,
    async close() {
      for (const t of transports.values()) await t.close().catch(() => undefined);
      transports.clear();
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export async function runHttpCommand(ctx: ToolContext, flags: Record<string, string | boolean>, io: CliIo): Promise<number> {
  const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
  const port = typeof flags.port === "string" ? Number(flags.port) : DEFAULT_HTTP_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.error(`Invalid --port "${flags.port}".`);
    return 2;
  }
  const { token, generated } = resolveHttpToken(ctx.config(), typeof flags.token === "string" ? flags.token : undefined);
  let running: Awaited<ReturnType<typeof startHttpServer>>;
  try {
    running = await startHttpServer({ ctx, host, port, token });
  } catch (e) {
    io.error((e as Error).message);
    return 1;
  }
  io.error(`LightBurn MCP listening on ${running.url}`);
  io.error(`Token required: header "Authorization: Bearer <token>" or URL ${running.url}/<token>`);
  if (generated) {
    io.error(`Generated access token (stored in your config; show again with "lightburn-mcp token"):\n  ${token}`);
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    io.error("Warning: the server is reachable from other machines. Anyone with the token can read your project and change cut settings. LightBurn Software does not endorse remote machine operation.");
  }
  await new Promise<void>((resolve) => {
    const stop = () => {
      running.close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}
