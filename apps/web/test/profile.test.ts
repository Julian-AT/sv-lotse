import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  database: {},
}));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: mocks.database }) }));
vi.mock("@lotse/brain/language", async (original) => ({
  ...(await original<typeof import("@lotse/brain/language")>()),
  readProfileSettings: mocks.read,
  updateProfileSettings: mocks.update,
}));

import { GET, PATCH } from "../src/app/api/profile/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const userId = randomUUID();
const settings = {
  language: "en",
  simpleLanguage: true,
  register: "informal",
  detailLevel: "brief",
};

const request = (body: unknown, headers?: HeadersInit): Request =>
  new Request("https://lotse.test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId: randomUUID(), kind: "anonymous" });
  mocks.read.mockResolvedValue(settings);
  mocks.update.mockResolvedValue(settings);
});

test("FR-L3 reads and patches only the authenticated caller's private profile", async () => {
  const response = await GET(new Request("https://lotse.test/api/profile"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(settings);
  expect(mocks.read).toHaveBeenCalledWith(mocks.database, userId);
  const saved = await PATCH(request({ simpleLanguage: false }));
  expect(saved.status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith(mocks.database, userId, { simpleLanguage: false });
});
test("rejects anonymous requests, malformed bodies and identity or autonomy injection", async () => {
  for (const body of [
    {},
    { userId: randomUUID() },
    { autonomyLevel: "L3" },
    { language: "fr" },
    { detailLevel: "unlimited" },
  ])
    expect((await PATCH(request(body))).status).toBe(400);
  expect(
    (await PATCH(new Request("https://lotse.test/api/profile", { method: "PATCH", body: "{" })))
      .status,
  ).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await GET(new Request("https://lotse.test/api/profile"))).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});
test("rejects cross-origin profile writes and hides provider/database errors", async () => {
  expect((await PATCH(request(settings, { origin: "https://untrusted.test" }))).status).toBe(403);
  expect((await PATCH(request(settings, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
  mocks.update.mockRejectedValue(new Error("private profile and connection details"));
  const failed = await PATCH(request(settings));
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "PROFILE_SETTINGS_FAILED" });
});
