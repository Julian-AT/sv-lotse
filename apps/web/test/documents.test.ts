import { randomUUID } from "node:crypto";
import { DocumentError } from "@lotse/brain/documents";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  upload: vi.fn(),
  storeUpload: vi.fn(),
  extract: vi.fn(),
  confirmFact: vi.fn(),
  listFacts: vi.fn(),
  editFact: vi.fn(),
  deleteFact: vi.fn(),
  read: vi.fn(),
  deleteDocument: vi.fn(),
  create: vi.fn(),
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
  getEnvironment: () => ({
    SESSION_SECRET: "test-document-session-secret-with-32-characters",
    LOTSE_WORKSPACE_URL: "https://lotse.test",
  }),
}));
vi.mock("@lotse/brain/documents", async (original) => ({
  ...(await original<typeof import("@lotse/brain/documents")>()),
  storeDocumentUpload: mocks.storeUpload,
  createDocumentService: (...args: unknown[]) => {
    mocks.create(...args);
    return mocks;
  },
}));

import { POST as extract } from "../src/app/api/documents/[id]/extract/route.ts";
import { POST as upload } from "../src/app/api/documents/route.ts";
import { DELETE, GET, PATCH, POST } from "../src/app/api/facts/route.ts";
import { SessionUnauthorized } from "../src/server/session.ts";

const subjectId = randomUUID();
const userId = randomUUID();
const documentId = randomUUID();
function multipart(): FormData {
  const form = new FormData();
  form.set("file", new File(["%PDF-content"], "document.pdf", { type: "application/pdf" }));
  form.set("subjectId", subjectId);
  return form;
}

function json(body: unknown, method = "POST"): Request {
  return new Request("https://lotse.test/api/facts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId, sessionId: randomUUID(), kind: "anonymous" });
  mocks.upload.mockResolvedValue({
    documentId,
    ocrStatus: "completed",
    pageCount: 7,
    mediaType: "application/pdf",
  });
  mocks.extract.mockResolvedValue({ statements: [], proposals: [] });
  mocks.listFacts.mockResolvedValue([]);
  mocks.confirmFact.mockResolvedValue({ id: randomUUID(), confirmed: true });
  mocks.editFact.mockResolvedValue({ confirmed: true });
  mocks.deleteFact.mockResolvedValue({ deleted: true });
});

test("FR-D1 multipart upload binds the authenticated identity and responds with OCR status", async () => {
  const response = await upload(
    new Request("https://lotse.test/api/documents", { method: "POST", body: multipart() }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ documentId, ocrStatus: "completed" });
  expect(mocks.create.mock.calls[0]?.[1]).toBe(userId);
  expect(mocks.upload.mock.calls[0]?.[1]).toEqual({
    subjectId,
    type: "uploaded_document",
    originClient: "web",
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("FR-D1 rejects missing sessions, foreign origins and oversized uploads before import", async () => {
  mocks.session.mockRejectedValueOnce(new SessionUnauthorized());
  expect(
    (
      await upload(
        new Request("https://lotse.test/api/documents", { method: "POST", body: multipart() }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await upload(
        new Request("https://lotse.test/api/documents", {
          method: "POST",
          headers: { origin: "https://foreign.test" },
          body: multipart(),
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await upload(
        new Request("https://lotse.test/api/documents", {
          method: "POST",
          headers: { "content-length": "100000000" },
          body: multipart(),
        }),
      )
    ).status,
  ).toBe(413);
  expect(mocks.upload).not.toHaveBeenCalled();
});

test("FR-P3 extraction returns proposals without invoking confirmation", async () => {
  const response = await extract(json({ subjectId }), {
    params: Promise.resolve({ id: documentId }),
  });
  expect(response.status).toBe(200);
  expect(mocks.extract).toHaveBeenCalledWith({ subjectId, documentId }, expect.any(AbortSignal));
  expect(mocks.confirmFact).not.toHaveBeenCalled();
});

test("FR-P3 facts POST requires a signed proposal and explicit confirmation rather than arbitrary extracted values", async () => {
  expect((await POST(json({ subjectId, value: "unconfirmed", confirmed: false }))).status).toBe(
    400,
  );
  expect(mocks.confirmFact).not.toHaveBeenCalled();
  expect((await POST(json({ proposalToken: "signed-proposal", confirmed: true }))).status).toBe(
    201,
  );
  expect(mocks.confirmFact).toHaveBeenCalledWith({
    proposalToken: "signed-proposal",
    confirmed: true,
  });
});

test("FR-P1 facts API reads by subject and accepts explicitly confirmed edits and deletion", async () => {
  expect(
    (await GET(new Request(`https://lotse.test/api/facts?subjectId=${subjectId}`))).status,
  ).toBe(200);
  expect(mocks.listFacts).toHaveBeenCalledWith({ subjectId });
  const factId = randomUUID();
  expect(
    (await PATCH(json({ subjectId, factId, value: "Corrected date", confirmed: true }, "PATCH")))
      .status,
  ).toBe(200);
  expect((await DELETE(json({ subjectId, factId }, "DELETE"))).status).toBe(200);
});

test("FR-P1 never returns provider or persistence content in API errors", async () => {
  mocks.extract.mockRejectedValueOnce(new Error("private original content"));
  const response = await extract(json({ subjectId }), {
    params: Promise.resolve({ id: documentId }),
  });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "DOCUMENT_REQUEST_FAILED" });
  mocks.listFacts.mockRejectedValueOnce(new DocumentError("access_denied"));
  expect(
    (await GET(new Request(`https://lotse.test/api/facts?subjectId=${subjectId}`))).status,
  ).toBe(403);
});

test("FR-D1 raw native uploads keep retry acknowledgements alongside multipart uploads", async () => {
  const uploadId = randomUUID();
  const bytes = new TextEncoder().encode("%PDF-1.7\nnative fixture");
  mocks.storeUpload.mockResolvedValueOnce({ documentId, uploadId });
  const response = await upload(
    new Request("https://lotse.test/api/documents", {
      method: "POST",
      headers: { "content-type": "application/pdf", "idempotency-key": uploadId },
      body: bytes,
    }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ documentId, uploadId });
  expect(mocks.storeUpload).toHaveBeenCalledWith(expect.anything(), {
    userId,
    uploadId,
    contentType: "application/pdf",
    bytes: Buffer.from(bytes),
  });
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
