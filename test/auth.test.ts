import { expect, test } from "vitest";
import { bearerToken } from "../src/auth.js";

test("matches the documented HMAC scheme", () => {
  expect(bearerToken("aB3dE7fG9hJ1kL5m", 1761130000000)).toBe(
    "d09b6be314779b5dea94b11a0cd922a963d71cf5ceadc61f6b710d262463b3e5",
  );
});

test("is stable within a minute and changes across the boundary", () => {
  expect(bearerToken("s", 60_000)).toBe(bearerToken("s", 119_999));
  expect(bearerToken("s", 60_000)).not.toBe(bearerToken("s", 120_000));
});
