import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  createInvite: vi.fn(),
  export: vi.fn(),
  delete: vi.fn(),
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
vi.mock("../src/server/resources.ts", () => ({
  getDatabase: () => ({ db: {} }),
  getStorage: () => ({}),
}));
vi.mock("@lotse/brain/relatives", async (original) => ({
  ...(await original<typeof import("@lotse/brain/relatives")>()),
  createRelativeService: () => ({ createInvite: mocks.createInvite }),
}));
vi.mock("@lotse/brain/case-file", async (original) => ({
  ...(await original<typeof import("@lotse/brain/case-file")>()),
  createPortabilityService: () => ({ export: mocks.export, delete: mocks.delete }),
}));

import { DELETE as deleteAccount } from "../src/app/api/account/route.ts";
import { POST as exportData } from "../src/app/api/export/route.ts";
import { POST as invite } from "../src/app/api/relatives/invite/route.ts";
import { POST as invites } from "../src/app/api/relatives/invites/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const caseId = randomUUID();
const created = { id: randomUUID(), token: "a".repeat(64), expiresAt: "2026-11-06T12:00:00.000Z" };
function request(path: string, method: string, body?: unknown): Request {
  return new Request(`https://lotse.test${path}`, {
    method,
    headers: { "Content-Type": "application/json", origin: "https://lotse.test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    userId: randomUUID(),
    sessionId: randomUUID(),
    kind: "anonymous",
  });
  mocks.createInvite.mockResolvedValue(created);
  mocks.export.mockResolvedValue(new Uint8Array([0x50, 0x4b]));
  mocks.delete.mockResolvedValue({ deleted: true });
});

test("PRD 7 /api/relatives/invite creates an invite with the same handler as /api/relatives/invites", async () => {
  for (const [handler, path] of [
    [invite, "/api/relatives/invite"],
    [invites, "/api/relatives/invites"],
  ] as const) {
    const response = await handler(request(path, "POST", { caseId }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(created);
  }
  expect(mocks.createInvite).toHaveBeenCalledTimes(2);
  expect(mocks.createInvite).toHaveBeenCalledWith(caseId, {
    case: false,
    factTypes: [],
    mode: "restricted",
  });
});

test("PRD 7 /api/relatives/invite requires a session", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  const response = await invite(request("/api/relatives/invite", "POST", { caseId }));
  expect(response.status).toBe(401);
  expect(mocks.createInvite).not.toHaveBeenCalled();
});

test("FR-P5 /api/export returns the data archive to a session", async () => {
  const response = await exportData(request("/api/export", "POST"));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(mocks.export).toHaveBeenCalledWith(undefined);
});

test("FR-P5 /api/account deletes the caller's data for a session", async () => {
  const response = await deleteAccount(request("/api/account", "DELETE"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ deleted: true });
  expect(mocks.delete).toHaveBeenCalledWith(undefined);
});

test("FR-P5 /api/export and /api/account require a session", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await exportData(request("/api/export", "POST"))).status).toBe(401);
  expect((await deleteAccount(request("/api/account", "DELETE"))).status).toBe(401);
  expect(mocks.export).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
});
