import { randomUUID } from "node:crypto";
import { CaseFileError } from "@lotse/brain/case-file";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  history: vi.fn(),
  update: vi.fn(),
  saveStep: vi.fn(),
  compose: vi.fn(),
  download: vi.fn(),
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
vi.mock("../src/server/resources.ts", () => ({
  getDatabase: () => ({ db: {} }),
  getStorage: () => ({}),
}));
vi.mock("../src/server/env.ts", () => ({
  getEnvironment: () => ({ LOTSE_WORKSPACE_URL: "https://lotse.test" }),
}));
vi.mock("@lotse/brain/case-file", async (original) => ({
  ...(await original<typeof import("@lotse/brain/case-file")>()),
  createCaseFileService: () => ({
    list: mocks.list,
    get: mocks.get,
    history: mocks.history,
    update: mocks.update,
    saveStep: mocks.saveStep,
  }),
  createHandoffService: () => ({ compose: mocks.compose, download: mocks.download }),
  createPortabilityService: () => ({ export: mocks.export, delete: mocks.delete }),
}));

import {
  caseResponse,
  casesResponse,
  handoffResponse,
  portabilityResponse,
  stepResponse,
} from "../src/server/case-file.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const caseId = randomUUID();
const documentKey = randomUUID();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    userId: randomUUID(),
    sessionId: randomUUID(),
    kind: "anonymous",
  });
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue({ id: caseId, steps: [] });
  mocks.history.mockResolvedValue({
    messages: [{ uiMessage: { id: "recorded", role: "assistant", parts: [] } }],
    entries: [{ kind: "approval.approved" }],
  });
  mocks.compose.mockResolvedValue({ documentKey });
  mocks.download.mockResolvedValue(Buffer.from("%PDF-1.7"));
  mocks.export.mockResolvedValue(Buffer.from("PK"));
  mocks.delete.mockResolvedValue({ deletedSubjects: [], retainedAudit: true });
});

const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`https://lotse.test${path}`, {
    method,
    headers: { origin: "https://lotse.test" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("FR-K1 serves private journey data and lists cases for the session identity", async () => {
  const response = await caseResponse(request(`/api/cases/${caseId}`), caseId);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ id: caseId, steps: [] });
  expect((await casesResponse(request("/api/cases"))).status).toBe(200);
});
test("FR-K4 replay returns recorded messages without calling mutation services", async () => {
  const response = await caseResponse(request(`/api/cases/${caseId}/replay`), caseId, "replay");
  expect(await response.json()).toMatchObject({
    replay: true,
    messages: [{ id: "recorded" }],
    events: [{ kind: "approval.approved" }],
  });
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.compose).not.toHaveBeenCalled();
});
test("FR-K3 one action without a body builds a stored PDF and returns a download route", async () => {
  const response = await handoffResponse(request(`/api/cases/${caseId}/handoff`, "POST"), caseId);
  expect(response.status).toBe(201);
  expect(mocks.compose).toHaveBeenCalledWith(caseId, undefined);
  expect(await response.json()).toEqual({
    documentKey,
    downloadUrl: `/api/cases/${caseId}/handoff?documentKey=${documentKey}`,
  });
  const download = await handoffResponse(
    request(`/api/cases/${caseId}/handoff?documentKey=${documentKey}`),
    caseId,
  );
  expect(download.headers.get("content-type")).toBe("application/pdf");
  expect(await download.text()).toBe("%PDF-1.7");
});
test("FR-P5 returns a ZIP download and accepts a subject-specific deletion", async () => {
  const response = await portabilityResponse(request("/api/export"), "export");
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  const subjectId = randomUUID();
  expect(
    (await portabilityResponse(request(`/api/account?subjectId=${subjectId}`, "DELETE"), "delete"))
      .status,
  ).toBe(200);
  expect(mocks.delete).toHaveBeenCalledWith(subjectId);
  expect(
    (await portabilityResponse(request("/api/account", "DELETE", { subjectId }), "delete")).status,
  ).toBe(200);
  expect(mocks.delete).toHaveBeenLastCalledWith(subjectId);
  expect(
    (
      await portabilityResponse(
        request(`/api/account?subjectId=${subjectId}`, "DELETE", { subjectId: randomUUID() }),
        "delete",
      )
    ).status,
  ).toBe(400);
});
test("protects subject deletion and PDF generation against cross-origin browser requests", async () => {
  const bad = (path: string, method: string) =>
    new Request(`https://lotse.test${path}`, { method, headers: { origin: "https://other.test" } });
  expect((await portabilityResponse(bad("/api/account", "DELETE"), "delete")).status).toBe(403);
  expect((await handoffResponse(bad(`/api/cases/${caseId}/handoff`, "POST"), caseId)).status).toBe(
    403,
  );
  expect(mocks.delete).not.toHaveBeenCalled();
  expect(mocks.compose).not.toHaveBeenCalled();
});
test("requires a session before returning case history or exports", async () => {
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect(
    (await caseResponse(request(`/api/cases/${caseId}/history`), caseId, "history")).status,
  ).toBe(401);
  expect((await portabilityResponse(request("/api/export"), "export")).status).toBe(401);
  expect(mocks.history).not.toHaveBeenCalled();
  expect(mocks.export).not.toHaveBeenCalled();
});
test("rejects malformed queries and JSON and maps typed access errors without leaking user content", async () => {
  expect(
    (await portabilityResponse(request("/api/export?subjectId=invalid"), "export")).status,
  ).toBe(400);
  expect(mocks.export).not.toHaveBeenCalled();
  const malformed = new Request(`https://lotse.test/api/cases/${caseId}/steps`, {
    method: "POST",
    body: "{",
  });
  expect((await stepResponse(malformed, caseId)).status).toBe(400);
  mocks.history.mockRejectedValue(new CaseFileError("access_denied"));
  expect(
    (await caseResponse(request(`/api/cases/${caseId}/history`), caseId, "history")).status,
  ).toBe(403);
  mocks.export.mockRejectedValue(new Error("private user content"));
  const response = await portabilityResponse(request("/api/export"), "export");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "CASE_OPERATION_FAILED" });
});

test("FR-K5 POST complete accepts a bodyless user report and enforces session and origin protection", async () => {
  const { POST } = await import("../src/app/api/cases/[id]/steps/[stepId]/complete/route.ts");
  const stepId = randomUUID();
  const params = { params: Promise.resolve({ id: caseId, stepId }) };
  mocks.saveStep.mockResolvedValue({ step: { id: stepId, status: "completed" } });
  const response = await POST(
    request(`/api/cases/${caseId}/steps/${stepId}/complete`, "POST"),
    params,
  );
  expect(response.status).toBe(200);
  expect(mocks.saveStep).toHaveBeenCalledWith(caseId, { status: "completed" }, stepId, undefined);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  mocks.saveStep.mockClear();
  const denied = await POST(
    new Request(`https://lotse.test/api/cases/${caseId}/steps/${stepId}/complete`, {
      method: "POST",
      headers: { origin: "https://other.test" },
    }),
    params,
  );
  expect(denied.status).toBe(403);
  expect(mocks.saveStep).not.toHaveBeenCalled();
  expect((await POST(request("/", "POST", { status: "pending" }), params)).status).toBe(400);
  mocks.session.mockRejectedValue(new SessionUnauthorized());
  expect((await POST(request("/", "POST"), params)).status).toBe(401);
});
