import { randomUUID } from "node:crypto";
import { DeadlineError, type Reminder } from "@lotse/brain/deadlines";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), database: {} }));
vi.mock("../src/server/session.ts", () => ({
  requireSession: mocks.session,
  SessionUnauthorized: class extends Error {
    code = "SESSION_REQUIRED";
    status = 401;
  },
}));
vi.mock("../src/server/resources.ts", () => ({ getDatabase: () => ({ db: mocks.database }) }));
vi.mock("@lotse/brain/deadlines", async (original) => ({
  ...(await original<typeof import("@lotse/brain/deadlines")>()),
  createDeadlineService: () => ({ list: mocks.list }),
}));

import { GET } from "../src/app/api/reminders/ics/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const caseId = randomUUID();
const reminder: Reminder = {
  id: randomUUID(),
  caseId,
  dueAt: new Date("2027-03-07T22:59:59.999Z"),
  createdAt: new Date("2026-11-06T08:00:00Z"),
  source: {
    kind: "letter",
    key: "letter:source",
    title: "Unterlagen einreichen",
    sourceQuote: "Bitte bis 07.03.2027 einreichen.",
    date: "2027-03-07",
    provenance: { documentId: randomUUID(), page: 1 },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    userId: randomUUID(),
    sessionId: randomUUID(),
    kind: "anonymous",
  });
  mocks.list.mockResolvedValue([reminder]);
});

test("FR-K2 downloads a private standards-compliant calendar with the original source quote", async () => {
  const response = await GET(new Request(`https://lotse.test/api/reminders/ics?caseId=${caseId}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(mocks.list).toHaveBeenCalledWith(caseId);
  const calendar = await response.text();
  expect(calendar).toContain("DTSTART;VALUE=DATE:20270307");
  expect(calendar).toContain("DESCRIPTION:Bitte bis 07.03.2027 einreichen.");
  expect(calendar).toContain(`UID:${reminder.id}@sv-ki-lotse`);
});
test("requires a session before accessing case reminders", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  const response = await GET(new Request(`https://lotse.test/api/reminders/ics?caseId=${caseId}`));
  expect(response.status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled();
});
test("rejects invalid input and unshared cases without exposing source content", async () => {
  expect(
    (await GET(new Request("https://lotse.test/api/reminders/ics?caseId=invalid"))).status,
  ).toBe(400);
  mocks.list.mockRejectedValue(new DeadlineError("access_denied"));
  const response = await GET(new Request(`https://lotse.test/api/reminders/ics?caseId=${caseId}`));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "CASE_ACCESS_DENIED" });
});
test("maps unexpected errors to a content-free export error", async () => {
  mocks.list.mockRejectedValue(new Error("private document text"));
  const response = await GET(new Request(`https://lotse.test/api/reminders/ics?caseId=${caseId}`));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "REMINDER_EXPORT_FAILED" });
});

test("FR-K2 lists only service-authorized reminders as private JSON", async () => {
  const { GET: list } = await import("../src/app/api/reminders/route.ts");
  const response = await list(new Request(`https://lotse.test/api/reminders?caseId=${caseId}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    reminders: [{ id: reminder.id, source: { sourceQuote: reminder.source.sourceQuote } }],
  });
  expect(mocks.list).toHaveBeenCalledWith(caseId);
  mocks.list.mockRejectedValue(new DeadlineError("access_denied"));
  const denied = await list(new Request(`https://lotse.test/api/reminders?caseId=${caseId}`));
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({ error: "CASE_ACCESS_DENIED" });
});
