import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  invite: vi.fn(),
  join: vi.fn(),
  approve: vi.fn(),
  list: vi.fn(),
  control: vi.fn(),
  status: vi.fn(),
  facts: vi.fn(),
  documents: vi.fn(),
  get: vi.fn(),
  bind: vi.fn(),
}));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({
  getDatabase: () => ({}),
  getStorage: () => ({ get: mocks.get }),
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("@lotse/brain/subjects", async (original) => ({
  ...(await original<typeof import("@lotse/brain/subjects")>()),
  createSubjectService: (...args: unknown[]) => {
    mocks.bind(...args);
    return {
      inviteHelper: mocks.invite,
      requestHelperJoin: mocks.join,
      approveHelperJoin: mocks.approve,
      listHelperSessions: mocks.list,
      controlHelperSession: mocks.control,
      getHelperJoin: mocks.status,
      factsVisibleTo: mocks.facts,
      documentsVisibleTo: mocks.documents,
    };
  },
}));

import { GET as documents } from "../src/app/api/documents/route.ts";
import { GET as facts } from "../src/app/api/facts/route.ts";
import { POST as accept, GET as status } from "../src/app/api/invites/accept/route.ts";
import { POST as approve } from "../src/app/api/invites/approve/route.ts";
import { POST as create } from "../src/app/api/invites/route.ts";
import { PATCH as control, GET as list } from "../src/app/api/invites/sessions/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const userId = randomUUID();
const sessionId = randomUUID();
const caseId = randomUUID();
const joinId = randomUUID();
const token = "a".repeat(64);
function request(path: string, body: unknown, origin = "https://lotse.test"): Request {
  return new Request(`https://lotse.test/api/${path}`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId, kind: "anonymous" });
  mocks.invite.mockResolvedValue({ token, expiresAt: new Date("2026-11-07T12:00:00Z") });
  mocks.join.mockResolvedValue({ id: joinId, caseId, status: "pending" });
  mocks.list.mockResolvedValue([]);
  mocks.facts.mockResolvedValue([]);
  mocks.documents.mockResolvedValue([]);
});

test("FR-R1 legacy create redirects to the only invite backend without issuing a parallel invite", async () => {
  const response = await create(request("invites", { caseId }));
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("location")).toBe("https://lotse.test/api/relatives/invites");
  expect(mocks.invite).not.toHaveBeenCalled();
});
test("FR-R1 legacy redemption and approval redirect without granting access", async () => {
  const response = await accept(request("invites/accept", { token }));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("https://lotse.test/api/relatives/join");
  const approval = await approve(request("invites/approve", { joinId }));
  expect(approval.headers.get("location")).toBe("https://lotse.test/api/relatives/session");
  expect(mocks.join).not.toHaveBeenCalled();
  expect(mocks.approve).not.toHaveBeenCalled();
});
test("FR-R4 legacy session URLs redirect status queries and controls to relatives", async () => {
  const sessions = await list(
    new Request(`https://lotse.test/api/invites/sessions?caseId=${caseId}`),
  );
  expect(sessions.status).toBe(307);
  expect(sessions.headers.get("location")).toBe(
    `https://lotse.test/api/relatives/sessions?caseId=${caseId}`,
  );
  const result = await status(
    new Request(`https://lotse.test/api/invites/accept?joinId=${joinId}`),
  );
  expect(result.headers.get("location")).toBe(
    `https://lotse.test/api/relatives/session?id=${joinId}`,
  );
  expect((await control(request("invites/sessions", { joinId, action: "pause" }))).status).toBe(
    307,
  );
  expect(mocks.control).not.toHaveBeenCalled();
});
test("FR-R1 legacy redirects never redeem missing-session, foreign-origin or injected requests", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  for (const body of [{ token }, { token, userId }, { token: "bad" }]) {
    const response = await accept(request("invites/accept", body, "https://other.test"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://lotse.test/api/relatives/join");
  }
  expect(mocks.join).not.toHaveBeenCalled();
});
test("legacy redirects never expose invite tokens or private backend errors", async () => {
  mocks.join.mockRejectedValue(new Error("private content"));
  const response = await accept(request("invites/accept", { token }));
  expect(await response.text()).toBe("");
  expect(response.headers.get("location")).not.toContain(token);
  expect(mocks.join).not.toHaveBeenCalled();
});
test("FR-R5 document downloads require explicit persisted actor visibility before storage reads", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const documentId = randomUUID();
  const query = `actorId=${actorId}&subjectId=${subjectId}&documentId=${documentId}`;
  expect((await documents(new Request(`https://lotse.test/api/documents?${query}`))).status).toBe(
    404,
  );
  expect(mocks.get).not.toHaveBeenCalled();
  mocks.documents.mockResolvedValue([{ id: documentId, storageKey: "private/opaque", pages: [] }]);
  mocks.get.mockResolvedValue(Buffer.from("source document"));
  const response = await documents(new Request(`https://lotse.test/api/documents?${query}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(mocks.get).toHaveBeenCalledWith("private/opaque");
  const metadata = await documents(
    new Request(`https://lotse.test/api/documents?actorId=${actorId}&subjectId=${subjectId}`),
  );
  expect(await metadata.text()).not.toContain("private/opaque");
  expect(
    (
      await facts(
        new Request(`https://lotse.test/api/facts?actorId=${actorId}&subjectId=${subjectId}`),
      )
    ).status,
  ).toBe(200);
  expect(mocks.facts).toHaveBeenCalledWith(actorId, subjectId);
});
