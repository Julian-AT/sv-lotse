import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  roomAccess: vi.fn(),
  invite: vi.fn(),
  join: vi.fn(),
  database: {},
}));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
  },
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({
    LOTSE_WORKSPACE_URL: "https://lotse.test",
    LIVEKIT_URL: "wss://livekit.test",
    LIVEKIT_API_KEY: "unit-key",
    LIVEKIT_API_SECRET: "unit-secret-for-local-jwt-verification",
  }),
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => mocks.database }));
vi.mock("@lotse/brain/relatives", async (original) => ({
  ...(await original<typeof import("@lotse/brain/relatives")>()),
  createRelativesToken: mocks.token,
  createRelativeService: () => ({
    roomAccess: mocks.roomAccess,
    createInvite: mocks.invite,
    joinInvite: mocks.join,
  }),
}));

import { RelativesError } from "@lotse/brain/relatives";
import { POST } from "../src/app/api/relatives/token/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const caseId = randomUUID();
const identity = { userId: randomUUID(), sessionId: randomUUID(), kind: "anonymous" };
function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://lotse.test/api/relatives/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(identity);
  mocks.token.mockResolvedValue({
    participantToken: "test-only-token",
    serverUrl: "wss://livekit.test",
  });
});

test("FR-R2 the private token route uses only the authenticated identity and validated consent", async () => {
  const response = await POST(request({ caseId, consent: true }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.token).toHaveBeenCalledWith(mocks.database, expect.any(Object), identity, {
    caseId,
    consent: true,
  });
});

test("FR-R2 rejects cross-origin token requests, missing consent and identity injection", async () => {
  for (const body of [
    { caseId },
    { caseId, consent: false },
    { caseId, consent: true, userId: randomUUID() },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect(
    (await POST(request({ caseId, consent: true }, { origin: "https://untrusted.test" }))).status,
  ).toBe(403);
  expect(
    (await POST(request({ caseId, consent: true }, { "sec-fetch-site": "cross-site" }))).status,
  ).toBe(403);
  expect(mocks.token).not.toHaveBeenCalled();
});

test("FR-R2 refuses unauthenticated or unauthorized callers and never exposes provider failures", async () => {
  mocks.session.mockRejectedValueOnce(new SessionUnauthorized());
  expect((await POST(request({ caseId, consent: true }))).status).toBe(401);
  mocks.token.mockRejectedValueOnce(new RelativesError("RELATIVES_FORBIDDEN"));
  expect((await POST(request({ caseId, consent: true }))).status).toBe(403);
  mocks.token.mockRejectedValueOnce(new Error("provider secret and user content"));
  const response = await POST(request({ caseId, consent: true }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "RELATIVES_UNAVAILABLE" });
});

test("FR-R1 browser tokens retain approved-session admission and their response contract", async () => {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000);
  mocks.roomAccess.mockResolvedValueOnce({
    room: `relative-${id}`,
    identity: `subject-${identity.sessionId}`,
    role: "subject",
    peerIdentity: "helper-test",
    expiresAt,
  });
  const response = await POST(request({ id }));
  expect(response.status).toBe(200);
  expect(mocks.roomAccess).toHaveBeenCalledWith(id);
  expect(mocks.token).not.toHaveBeenCalled();
  expect(await response.json()).toMatchObject({
    token: expect.any(String),
    role: "subject",
    peerIdentity: "helper-test",
    expiresAt: expiresAt.toISOString(),
  });
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
});

test("FR-R1 browser requests cannot bypass approval or mix native and browser token inputs", async () => {
  const { RelativeSessionError } = await import("@lotse/brain/relatives");
  mocks.roomAccess.mockRejectedValueOnce(new RelativeSessionError("SESSION_NOT_APPROVED"));
  const response = await POST(request({ id: randomUUID() }));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "SESSION_NOT_APPROVED" });
  mocks.roomAccess.mockClear();
  expect((await POST(request({ id: randomUUID(), caseId, consent: true }))).status).toBe(400);
  expect(mocks.roomAccess).not.toHaveBeenCalled();
  expect(mocks.token).not.toHaveBeenCalled();
});

test("FR-R1/R5 canonical invites validate and forward the chosen scope from the authenticated caller", async () => {
  const { createInviteResponse } = await import("../src/server/relatives.ts");
  const scope = { mode: "restricted", case: true, factTypes: [], factIds: [randomUUID()] };
  mocks.invite.mockResolvedValue({
    id: randomUUID(),
    token: "a".repeat(64),
    expiresAt: new Date(),
  });
  expect((await createInviteResponse(request({ caseId, shareScope: scope }))).status).toBe(200);
  expect(mocks.invite).toHaveBeenCalledWith(caseId, scope);
  for (const body of [
    { caseId, shareScope: { mode: "restricted" } },
    { caseId, userId: randomUUID() },
  ])
    expect((await createInviteResponse(request(body))).status).toBe(400);
  expect(
    (await createInviteResponse(request({ caseId }, { origin: "https://other.test" }))).status,
  ).toBe(403);
  mocks.session.mockRejectedValueOnce(new SessionUnauthorized());
  expect((await createInviteResponse(request({ caseId }))).status).toBe(401);
});
test("FR-R1 canonical join queues a browser-bound request without granting approval", async () => {
  const { joinInviteResponse } = await import("../src/server/relatives.ts");
  const token = "b".repeat(64);
  mocks.join.mockResolvedValue({ id: randomUUID(), state: "pending" });
  const response = await joinInviteResponse(request({ token }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "pending" });
  expect(mocks.join).toHaveBeenCalledWith(token);
  expect((await joinInviteResponse(request({ token, userId: randomUUID() }))).status).toBe(400);
  expect((await joinInviteResponse(request({ token: "bad" }))).status).toBe(400);
  mocks.join.mockRejectedValueOnce(new Error("private content"));
  expect(await (await joinInviteResponse(request({ token }))).json()).toEqual({
    error: "RELATIVES_UNAVAILABLE",
  });
});
