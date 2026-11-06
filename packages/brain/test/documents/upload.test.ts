import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { DOCUMENT_UPLOAD_MAX_BYTES as DOCUMENT_MAX_BYTES } from "../../src/documents/config.ts";
import {
  decryptDocument,
  decryptOriginal,
  encryptDocument,
} from "../../src/documents/encryption.ts";
import { readDocumentBody, validateDocument } from "../../src/documents/input.ts";

test("FR-D1 envelope encryption round-trips bytes and authenticates both the document key and context", () => {
  const bytes = Buffer.from("%PDF-1.7\nprivate fixture document");
  const secret = randomUUID();
  const envelope = encryptDocument(bytes, secret, "documents/owner/document");
  expect(envelope.toString()).not.toContain("private fixture document");
  expect(decryptDocument(envelope, secret, "documents/owner/document")).toEqual(bytes);
  expect(() => decryptDocument(envelope, randomUUID(), "documents/owner/document")).toThrow();
  expect(() => decryptDocument(envelope, secret, "documents/other/document")).toThrow();
});

test("FR-D1 validates the uploaded file signature instead of trusting its declared MIME type", () => {
  expect(() => validateDocument(Buffer.from("<script>"), "application/pdf")).toThrow();
  expect(() => validateDocument(Buffer.from("%PDF-1.7"), "image/png")).toThrow();
  expect(() => validateDocument(Buffer.from("%PDF-1.7"), "application/pdf")).not.toThrow();
});

test("FR-D1 rejects empty bodies and oversized uploads before buffering them", async () => {
  const empty = new Request("https://lotse.test/api/documents", { method: "POST", body: "" });
  await expect(readDocumentBody(empty)).rejects.toMatchObject({
    code: "EMPTY_DOCUMENT",
    status: 400,
  });
  const large = new Request("https://lotse.test/api/documents", {
    method: "POST",
    headers: { "Content-Length": String(DOCUMENT_MAX_BYTES + 1) },
    body: "small",
  });
  await expect(readDocumentBody(large)).rejects.toMatchObject({
    code: "DOCUMENT_TOO_LARGE",
    status: 413,
  });
  const lying = new Request("https://lotse.test/api/documents", {
    method: "POST",
    headers: { "Content-Length": "1" },
    body: new Uint8Array(DOCUMENT_MAX_BYTES + 1),
  });
  await expect(readDocumentBody(lying)).rejects.toMatchObject({
    code: "DOCUMENT_TOO_LARGE",
    status: 413,
  });
});

test("FR-D1 the document service decrypts native imports with their authenticated storage path", () => {
  const bytes = Buffer.from("%PDF-1.7\nnative import fixture");
  const secret = randomUUID();
  const context = "documents/owner/native-import.envelope";
  const envelope = encryptDocument(bytes, secret, context);
  expect(decryptOriginal(envelope, secret, context)).toEqual(bytes);
  expect(() => decryptOriginal(envelope, secret, "documents/other")).toThrow("storage_failed");
  expect(() => decryptOriginal(envelope, randomUUID(), context)).toThrow("storage_failed");
});
