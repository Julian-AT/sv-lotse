import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  shared: vi.fn(),
  facts: vi.fn(),
  upload: vi.fn(),
  documentUpload: vi.fn(),
}));

vi.mock("../src/server/shared-context.ts", () => ({ sharedContextResponse: handlers.shared }));
vi.mock("../src/server/documents.ts", () => ({
  factsResponse: handlers.facts,
  uploadDocumentResponse: handlers.upload,
  documentUploadResponse: handlers.documentUpload,
}));

import { GET as documents, POST as upload } from "../src/app/api/documents/route.ts";
import { PATCH as changeFact, GET as facts } from "../src/app/api/facts/route.ts";

beforeEach(() => {
  vi.resetAllMocks();
});

test("facts GET preserves actor-scoped reads for helpers", async () => {
  const request = new Request(
    `https://lotse.test/api/facts?actorId=${randomUUID()}&subjectId=${randomUUID()}`,
  );
  const response = Response.json({ facts: [] });
  handlers.shared.mockResolvedValue(response);

  expect(await facts(request)).toBe(response);
  expect(handlers.shared).toHaveBeenCalledWith(request, "facts");
  expect(handlers.facts).not.toHaveBeenCalled();
});

test("facts GET supports subject-scoped conversation reads", async () => {
  const request = new Request(
    `https://lotse.test/api/facts?subjectId=${randomUUID()}&caseId=${randomUUID()}`,
  );
  const response = Response.json({ facts: [] });
  handlers.facts.mockResolvedValue(response);

  expect(await facts(request)).toBe(response);
  expect(handlers.facts).toHaveBeenCalledWith(request);
  expect(handlers.shared).not.toHaveBeenCalled();
});

test("mixed fact scopes cannot fall back to the conversation's subject access", async () => {
  const request = new Request(
    `https://lotse.test/api/facts?caseId=${randomUUID()}&actorId=${randomUUID()}&subjectId=${randomUUID()}`,
  );
  const response = Response.json({ error: "INVALID_CONTEXT_QUERY" }, { status: 400 });
  handlers.shared.mockResolvedValue(response);

  expect(await facts(request)).toBe(response);
  expect(handlers.shared).toHaveBeenCalledWith(request, "facts");
  expect(handlers.facts).not.toHaveBeenCalled();
});

test("facts PATCH keeps conversation fact review available", async () => {
  const request = new Request("https://lotse.test/api/facts", { method: "PATCH" });
  const response = Response.json({ saved: true });
  handlers.facts.mockResolvedValue(response);

  expect(await changeFact(request)).toBe(response);
  expect(handlers.facts).toHaveBeenCalledWith(request);
});

test("documents GET preserves visibility checks while POST accepts conversation uploads", async () => {
  const read = new Request(
    `https://lotse.test/api/documents?actorId=${randomUUID()}&subjectId=${randomUUID()}`,
  );
  const form = new FormData();
  form.set("subjectId", randomUUID());
  form.set(
    "file",
    new File(["administrative fixture"], "document.pdf", { type: "application/pdf" }),
  );
  const write = new Request("https://lotse.test/api/documents", { method: "POST", body: form });
  const readResponse = Response.json({ documents: [] });
  const writeResponse = Response.json({ id: randomUUID() });
  handlers.shared.mockResolvedValue(readResponse);
  handlers.upload.mockResolvedValue(writeResponse);

  expect(await documents(read)).toBe(readResponse);
  expect(handlers.shared).toHaveBeenCalledWith(read, "documents");
  expect(await upload(write)).toBe(writeResponse);
  expect(handlers.upload).toHaveBeenCalledWith(write);
  expect(handlers.upload).toHaveBeenCalledTimes(1);
  expect(handlers.documentUpload).not.toHaveBeenCalled();
  expect(handlers.shared).toHaveBeenCalledTimes(1);
});

test("documents POST routes JSON bodies to the non-multipart upload handler", async () => {
  const request = new Request("https://lotse.test/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subjectId: randomUUID() }),
  });
  const response = Response.json({ error: "INVALID_UPLOAD_HEADERS" }, { status: 400 });
  handlers.documentUpload.mockResolvedValue(response);

  expect(await upload(request)).toBe(response);
  expect(handlers.documentUpload).toHaveBeenCalledExactlyOnceWith(request);
  expect(handlers.upload).not.toHaveBeenCalled();
  expect(handlers.shared).not.toHaveBeenCalled();
});

test("document byte uploads keep the existing binary adapter", async () => {
  const request = new Request("https://lotse.test/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: "%PDF-fixture",
  });
  const response = Response.json({ documentId: randomUUID() });
  handlers.documentUpload.mockResolvedValue(response);
  expect(await upload(request)).toBe(response);
  expect(handlers.documentUpload).toHaveBeenCalledWith(request);
  expect(handlers.upload).not.toHaveBeenCalled();
});
