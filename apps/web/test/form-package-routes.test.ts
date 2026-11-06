import { randomUUID } from "node:crypto";
import { FormError } from "@lotse/brain/forms";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  build: vi.fn(),
  find: vi.fn(),
  acquire: vi.fn(),
  db: {},
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: mocks.db }) }));
vi.mock("@lotse/brain/forms", async (original) => ({
  ...(await original<typeof import("@lotse/brain/forms")>()),
  buildFormPackageForSession: mocks.build,
  findForms: mocks.find,
  acquireForm: mocks.acquire,
}));

import { POST as build } from "../src/app/api/forms/instances/[id]/package/route.ts";
import { GET, POST } from "../src/app/api/forms/templates/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const id = randomUUID();
const identity = { userId: randomUUID(), sessionId: randomUUID(), kind: "anonymous" };
const url = "https://example.org/application.pdf";
const params = { params: Promise.resolve({ id }) };
const post = (body: unknown, origin = "https://lotse.test") =>
  new Request("https://lotse.test/api/forms/templates", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(identity);
  mocks.build.mockResolvedValue({
    pdfKey: "private-storage-key",
    attachmentChecklist: ["Nachweis"],
    coverLetter: "Ada Beispiel",
  });
  mocks.find.mockResolvedValue([
    { title: "Antrag", publisher: "Test", url, versionDate: null, format: "flat" },
  ]);
  mocks.acquire.mockResolvedValue({
    id,
    source: url,
    publisher: "Test",
    title: "Antrag",
    retrievedAt: new Date(),
    storageKey: "private-original-key",
    hash: "0".repeat(64),
    format: "flat",
    pages: 1,
    status: "auto",
    versionDate: null,
  });
});

test("FR-D6 package POST binds authenticated identity and returns a private download URL without storage keys", async () => {
  const response = await build(
    new Request(`https://lotse.test/api/forms/instances/${id}/package`, { method: "POST" }),
    params,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    attachmentChecklist: ["Nachweis"],
    coverLetter: "Ada Beispiel",
    pdfUrl: `/api/forms/instances/${id}/pdf`,
  });
  expect(mocks.build).toHaveBeenCalledExactlyOnceWith(mocks.db, identity, id, expect.any(Function));
});

test("FR-D6 package POST rejects cross-origin writes, invalid ids and unauthenticated callers", async () => {
  expect((await build(post({}, "https://other.test"), params)).status).toBe(403);
  expect((await build(post({}), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await build(post({}), params)).status).toBe(401);
  expect(mocks.build).not.toHaveBeenCalled();
});

test.each([
  ["access_denied", 403],
  ["not_found", 404],
  ["invalid_fields", 409],
] as const)("FR-D6 package maps %s", async (code, status) => {
  mocks.build.mockRejectedValue(new FormError(code));
  expect((await build(post({}), params)).status).toBe(status);
});

test("FR-D10 GET searches through findForms and validates the boundary", async () => {
  const response = await GET(
    new Request("https://lotse.test/api/forms/templates?need=Antrag&region=AT"),
  );
  expect(response.status).toBe(200);
  expect(mocks.find).toHaveBeenCalledWith(
    mocks.db,
    { need: "Antrag", region: "AT" },
    expect.any(AbortSignal),
  );
  expect((await GET(new Request("https://lotse.test/api/forms/templates?need="))).status).toBe(400);
});

test("FR-D10 registration requires an explicit positive decision and refusal performs no acquisition", async () => {
  expect(await (await POST(post({ url, approved: false }))).json()).toEqual({ registered: false });
  expect((await POST(post({ url }))).status).toBe(400);
  expect((await POST(post({ url, approved: "true" }))).status).toBe(400);
  expect(mocks.acquire).not.toHaveBeenCalled();
  const response = await POST(post({ url, approved: true }));
  expect(response.status).toBe(201);
  expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith(mocks.db, url, expect.any(AbortSignal));
  expect(JSON.stringify(await response.json())).not.toContain("private-original-key");
});

test("FR-D10 templates require a session, protect writes and retain the acquisition allowlist", async () => {
  expect((await POST(post({ url, approved: true }, "https://other.test"))).status).toBe(403);
  mocks.acquire.mockRejectedValue(new FormError("origin_denied"));
  expect((await POST(post({ url, approved: true }))).status).toBe(403);
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect(
    (await GET(new Request("https://lotse.test/api/forms/templates?need=Antrag"))).status,
  ).toBe(401);
  expect((await POST(post({ url, approved: true }))).status).toBe(401);
});
