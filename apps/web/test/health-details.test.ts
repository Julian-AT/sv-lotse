import { afterEach, beforeEach, expect, test, vi } from "vitest";

const session = vi.hoisted(() => vi.fn());
vi.mock("../src/server/session.ts", () => ({
  requireSession: session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));

import { GET } from "../src/app/api/health/details/route.ts";
import { SETTINGS_CONFIG } from "../src/config.ts";
import { healthDetailsSchema, serviceIdSchema } from "../src/features/settings/health-schema.ts";
import { checkHealthDetails, type HealthProbes } from "../src/server/health-details.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

// Isolated dependency doubles test reporting; browser/service tests use actual providers and stores.
function healthyProbes(): HealthProbes {
  return {
    brain: async () => undefined,
    database: async () => undefined,
    storage: async () => undefined,
    openai: async () => undefined,
    elevenlabs: async () => undefined,
    livekit: async () => undefined,
  };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

test("connections are verified only after every live probe succeeds", async () => {
  const result = healthDetailsSchema.parse(await checkHealthDetails(healthyProbes()));
  expect(result.connections.map((connection) => connection.id)).toEqual(serviceIdSchema.options);
  expect(
    result.connections.every(
      (connection) => connection.status === "verified" && connection.reason === "ok",
    ),
  ).toBe(true);
});

test("missing configuration and provider failures are distinct and never expose errors", async () => {
  const result = await checkHealthDetails({
    ...healthyProbes(),
    openai: undefined,
    elevenlabs: async () => {
      throw new Error("private-provider-response-and-key");
    },
    storage: () => {
      throw new Error("private-storage-credentials");
    },
  });
  expect(result.connections).toContainEqual({
    id: "openai",
    status: "missing",
    reason: "not_configured",
  });
  expect(result.connections).toContainEqual({
    id: "elevenlabs",
    status: "missing",
    reason: "unreachable",
  });
  expect(result.connections).toContainEqual({
    id: "storage",
    status: "missing",
    reason: "unreachable",
  });
  expect(JSON.stringify(result)).not.toContain("private");
});

test("one unresponsive dependency is bounded and does not hide healthy connections", async () => {
  vi.useFakeTimers();
  const pending = checkHealthDetails({ ...healthyProbes(), livekit: () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(SETTINGS_CONFIG.healthTimeoutMs);
  const result = await pending;
  expect(result.connections).toContainEqual({
    id: "livekit",
    status: "missing",
    reason: "unreachable",
  });
  expect(result.connections.find((connection) => connection.id === "database")?.status).toBe(
    "verified",
  );
  expect(vi.getTimerCount()).toBe(0);
});

test("detailed checks require a session before accessing server configuration or services", async () => {
  session.mockRejectedValue(new SessionUnauthorized());
  const response = await GET(new Request("https://lotse.test/api/health/details"));
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "SESSION_REQUIRED" });
});
