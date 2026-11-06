import { randomUUID } from "node:crypto";
import { decryptDocument } from "@lotse/brain/documents";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { documents, subjects } from "@lotse/db/schema";
import { createObjectStorage } from "@lotse/db/storage/s3";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { loadLocalEnvironment } from "../scripts/load-env.mjs";
import { parseEnvironment, resourceEnvironment } from "../src/server/env.ts";
import { createSessionService } from "../src/server/session.ts";
import { SESSION_COOKIE } from "../src/server/session-cookie.ts";

// Real services, isolated database and object prefix; only the process-global resource lookup is redirected.
vi.mock("../src/server/resources.ts", () => ({
  getDatabase: () => database,
  getStorage: () => storage,
}));

import { POST } from "../src/app/api/documents/route.ts";

loadLocalEnvironment();
const config = parseEnvironment(process.env);
const admin = createDatabase(resourceEnvironment(config));
const databaseName = `lotse_import_${randomUUID().replaceAll("-", "")}`;
const databaseURL = new URL(config.DATABASE_URL);
databaseURL.pathname = `/${databaseName}`;
const database = createDatabase({
  ...resourceEnvironment(config),
  DATABASE_URL: databaseURL.toString(),
});

const storage = createObjectStorage({
  ...resourceEnvironment(config),
  S3_PREFIX: `test-import/${databaseName}`,
});

const sessions = createSessionService(database.db, config);
let created = false;
const bytes = Buffer.from(
  "%PDF-1.7\n% synthetic upload transport fixture, contains no personal or medical information\n%%EOF",
);

beforeAll(async () => {
  await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
  created = true;
  await migrateDatabase(database);
  await storage.headBucket();
});
afterAll(async () => {
  if (created) {
    const rows = await database.db.select({ key: documents.storageKey }).from(documents);
    await Promise.all(rows.map((row) => storage.delete(row.key)));
  }
  storage.close();
  await database.close();
  if (created) await admin.sql`DROP DATABASE ${admin.sql(databaseName)} WITH (FORCE)`;
  await admin.close();
});

async function authenticated(): Promise<{ cookie: string; userId: string }> {
  const result = await sessions.ensureSession(new NextRequest("http://localhost:3000"));
  if (!result.cookie) throw new Error("Expected initial signed cookie");
  return { cookie: `${SESSION_COOKIE}=${result.cookie}`, userId: result.identity.userId };
}

function request(
  cookie: string,
  uploadId: string,
  body: Uint8Array = bytes,
  extra: Record<string, string> = {},
): Request {
  return new Request("http://localhost:3000/api/documents", {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/pdf",
      "idempotency-key": uploadId,
      ...extra,
    },
    body: new Uint8Array(body),
  });
}

test("FR-D1 authenticated uploads confirm only after real Postgres and encrypted MinIO persistence", async () => {
  const { cookie, userId } = await authenticated();
  const uploadId = randomUUID();
  const response = await POST(request(cookie, uploadId));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const confirmation = await response.json();
  expect(confirmation.uploadId).toBe(uploadId);
  const [document] = await database.db
    .select()
    .from(documents)
    .where(eq(documents.id, confirmation.documentId));
  expect(document?.originClient).toBe("mac");
  if (!document) throw new Error("Expected persisted document");
  const [subject] = await database.db
    .select()
    .from(subjects)
    .where(eq(subjects.id, document.subjectId));
  expect(subject?.createdBy).toBe(userId);
  const stored = await storage.get(document.storageKey);
  expect(stored.toString()).not.toContain("synthetic upload transport fixture");
  expect(decryptDocument(stored, config.SESSION_SECRET, document.storageKey)).toEqual(bytes);
});

test("NFR-3 concurrent retries return one document and reject reused upload IDs with different bytes", async () => {
  const { cookie } = await authenticated();
  const uploadId = randomUUID();
  const responses = await Promise.all([
    POST(request(cookie, uploadId)),
    POST(request(cookie, uploadId)),
  ]);
  expect(responses.map((response) => response.status)).toEqual([201, 201]);
  const confirmations = await Promise.all(responses.map((response) => response.json()));
  expect(confirmations[0]).toEqual(confirmations[1]);
  const rows = await database.db
    .select()
    .from(documents)
    .where(eq(documents.id, confirmations[0].documentId));
  expect(rows).toHaveLength(1);
  const conflict = await POST(request(cookie, uploadId, Buffer.from("%PDF-1.7\nchanged bytes")));
  expect(conflict.status).toBe(409);
});

test("FR-D1 requires a session, rejects cross-origin writes, and isolates the same upload ID between users", async () => {
  const first = await authenticated();
  const second = await authenticated();
  const uploadId = randomUUID();
  expect((await POST(request("", uploadId))).status).toBe(401);
  expect(
    (await POST(request(first.cookie, uploadId, bytes, { origin: "https://untrusted.test" })))
      .status,
  ).toBe(403);
  const a = await POST(
    request(first.cookie, uploadId, bytes, { "x-lotse-user-id": second.userId }),
  );
  const b = await POST(request(second.cookie, uploadId));
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect((await a.json()).documentId).not.toBe((await b.json()).documentId);
  expect((await POST(request(first.cookie, randomUUID(), Buffer.from("<html>")))).status).toBe(415);
});
