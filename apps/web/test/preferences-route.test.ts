import { DEFAULT_PREFERENCES } from "@lotse/brain/preferences/schema";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), update: vi.fn() }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {},
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: {} }) }));
vi.mock("@lotse/brain/preferences", async (original) => ({
  ...(await original<typeof import("@lotse/brain/preferences")>()),
  createPreferencesService: () => ({ read: mocks.read, update: mocks.update }),
}));

import { GET, PATCH } from "../src/app/api/preferences/route.ts";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "owner" });
  mocks.read.mockResolvedValue(DEFAULT_PREFERENCES);
});

for (const consent of [true, false]) {
  test(`saving analytics consent ${consent} updates the server analytics gate`, async () => {
    const preferences = { ...DEFAULT_PREFERENCES, analyticsConsent: consent };
    mocks.update.mockResolvedValue(preferences);
    const response = await PATCH(
      new Request("https://lotse.test/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", origin: "https://lotse.test" },
        body: JSON.stringify({ analyticsConsent: consent }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preferences);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain(`lotse_analytics_enabled=${consent ? "1" : "0"}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=strict");
  });
}

test("reading preferences or saving unrelated settings does not grant cookie consent", async () => {
  const preferences = { ...DEFAULT_PREFERENCES, analyticsConsent: true };
  mocks.read.mockResolvedValue(preferences);
  mocks.update.mockResolvedValue(preferences);
  const read = await GET(new Request("https://lotse.test/api/preferences"));
  expect(read.headers.get("set-cookie")).toBeNull();
  const saved = await PATCH(
    new Request("https://lotse.test/api/preferences", {
      method: "PATCH",
      body: JSON.stringify({ language: "en" }),
    }),
  );
  expect(saved.status).toBe(200);
  expect(saved.headers.get("set-cookie")).not.toContain("lotse_analytics_enabled");
});

test("failed preference saves never change the consent cookie", async () => {
  mocks.update.mockRejectedValue(new Error("database unavailable"));
  const response = await PATCH(
    new Request("https://lotse.test/api/preferences", {
      method: "PATCH",
      body: JSON.stringify({ analyticsConsent: true }),
    }),
  );
  expect(response.status).toBe(500);
  expect(response.headers.get("set-cookie")).toBeNull();
});
