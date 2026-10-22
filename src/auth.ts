import { createHmac } from "node:crypto";

/**
 * Bearer token for the LightBurn REST API:
 * hex(HMAC-SHA256(secret, floor(unix_time / 60))).
 * The server accepts the current and the previous minute.
 */
export function bearerToken(secret: string, nowMs: number = Date.now()): string {
  const minute = String(Math.floor(nowMs / 1000 / 60));
  return createHmac("sha256", secret).update(minute).digest("hex");
}
