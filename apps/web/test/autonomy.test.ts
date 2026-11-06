import { randomUUID } from "node:crypto";
import { AutonomyError } from "@lotse/brain/autonomy";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  change: vi.fn(),
  service: vi.fn(),
  pages: vi.fn(),
}));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: {} }) }));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("@lotse/brain/autonomy", async (original) => ({
  ...(await original<typeof import("@lotse/brain/autonomy")>()),
  createAutonomyService: mocks.service,
  autonomyFillPages: mocks.pages,
}));

import { GET, PATCH } from "../src/app/api/settings/autonomy/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const userId = randomUUID();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId: randomUUID(), kind: "anonymous" });
  mocks.read.mockResolvedValue({ autonomyLevel: "L1" });
  mocks.change.mockResolvedValue({ autonomyLevel: "L3" });
  mocks.service.mockReturnValue({ read: mocks.read, change: mocks.change });
  mocks.pages.mockResolvedValue([]);
});

const url = "https://lotse.test/api/settings/autonomy";
function patch(body: unknown, origin = "https://lotse.test"): Request {
  return new Request(url, {
    method: "PATCH",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("FR-A1 reads only the authenticated user's stored level without caching", async () => {
  const response = await GET(new Request(`${url}?userId=attacker`));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ autonomyLevel: "L1" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.service.mock.calls[0]?.[1]).toBe(userId);
});
test("FR-A1 forwards an explicit settings confirmation to the bound profile service", async () => {
  const response = await PATCH(patch({ autonomyLevel: "L3", confirmed: true }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ autonomyLevel: "L3" });
  expect(mocks.change).toHaveBeenCalledWith({ autonomyLevel: "L3", confirmed: true });
});
test("FR-A1 returns allowed fill pages from the authenticated profile policy when requested", async () => {
  mocks.read.mockResolvedValue({ autonomyLevel: "L3" });
  mocks.pages.mockResolvedValue(["https://example.org/reviewed-booking"]);
  const response = await GET(new Request(`${url}?include=fill-pages&userId=attacker`));
  expect(await response.json()).toEqual({
    autonomyLevel: "L3",
    allowedFillPages: ["https://example.org/reviewed-booking"],
  });
  expect(mocks.pages).toHaveBeenCalledWith(expect.anything(), userId);
});
test("rejects sibling and cross-site origins before profile mutation", async () => {
  expect(
    (await PATCH(patch({ autonomyLevel: "L3", confirmed: true }, "https://sibling.lotse.test")))
      .status,
  ).toBe(403);
  const request = patch({ autonomyLevel: "L3", confirmed: true });
  request.headers.set("sec-fetch-site", "cross-site");
  expect((await PATCH(request)).status).toBe(403);
  expect(mocks.change).not.toHaveBeenCalled();
});
test("requires a valid session and reports validation failures without user content", async () => {
  mocks.session.mockRejectedValueOnce(new SessionUnauthorized());
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.service).not.toHaveBeenCalled();
  mocks.change.mockRejectedValueOnce(new AutonomyError("INVALID_AUTONOMY"));
  expect((await PATCH(patch({ autonomyLevel: "L3" }))).status).toBe(400);
  mocks.change.mockRejectedValueOnce(new Error("private details"));
  const response = await PATCH(patch({ autonomyLevel: "L3", confirmed: true }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "AUTONOMY_FAILED" });
});
