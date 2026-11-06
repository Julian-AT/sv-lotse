import { createHash } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { auditEvents, documents, subjects, users } from "@lotse/db/schema";
import type { createObjectStorage } from "@lotse/db/storage/s3";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { documentCopy } from "./copy.ts";
import { encryptDocument } from "./encryption.ts";
import {
  DocumentUploadError,
  documentMediaType,
  documentUploadId,
  validateDocument,
} from "./input.ts";

type Storage = Pick<ReturnType<typeof createObjectStorage>, "put">;
export interface DocumentUploadConfirmation {
  documentId: string;
  uploadId: string;
}

function documentIdentity(userId: string, uploadId: string): string {
  const hash = createHash("sha256").update(`document-upload:${userId}:${uploadId}`).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x40;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Authenticated userId comes only from the host's session service. Imports target the caller's own context. */
export async function storeDocumentUpload(
  dependencies: { db: DatabaseClient; storage: Storage; encryptionSecret: string },
  input: { userId: string; uploadId: string; contentType: string; bytes: Uint8Array },
): Promise<DocumentUploadConfirmation> {
  const userId = z.uuid().parse(input.userId);
  const uploadId = documentUploadId.parse(input.uploadId).toLowerCase();
  const type = documentMediaType.parse(input.contentType);
  validateDocument(input.bytes, type);
  const documentId = documentIdentity(userId, uploadId);
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  return dependencies.db.transaction(async (tx) => {
    // Same owner lock as conversation self-subject creation; retries serialize before writing objects.
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!owner) throw new DocumentUploadError("SESSION_REQUIRED", 401);
    const [existing] = await tx.select().from(documents).where(eq(documents.id, documentId));
    if (existing) {
      if (existing.hash !== hash || existing.type !== type)
        throw new DocumentUploadError("UPLOAD_ID_CONFLICT", 409);
      return { documentId, uploadId };
    }
    let [subject] = await tx
      .select()
      .from(subjects)
      .where(and(eq(subjects.createdBy, userId), eq(subjects.relationToUser, "self")))
      .orderBy(asc(subjects.createdAt), asc(subjects.id))
      .limit(1);
    if (!subject)
      [subject] = await tx
        .insert(subjects)
        .values({
          createdBy: userId,
          relationToUser: "self",
          displayName: documentCopy.de.selfName,
        })
        .returning();
    if (!subject) throw new DocumentUploadError("DOCUMENT_STORE_FAILED", 500);
    const storageKey = `documents/${userId}/${documentId}.envelope`;
    const encrypted = encryptDocument(input.bytes, dependencies.encryptionSecret, storageKey);
    await dependencies.storage.put(storageKey, encrypted, "application/octet-stream");
    await tx.insert(documents).values({
      id: documentId,
      subjectId: subject.id,
      type,
      storageKey,
      hash,
      pages: [],
      ocrStatus: "pending",
      originClient: "mac",
    });
    await tx
      .insert(auditEvents)
      .values({ actorId: userId, action: "document.uploaded", target: { documentId } });
    return { documentId, uploadId };
  });
}
