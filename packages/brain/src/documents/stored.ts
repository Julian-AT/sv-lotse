import { documents } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { type DocumentTransaction, requireDocumentRead, subjectAccess } from "./access.ts";
import type { DocumentExtractionInput } from "./contracts.ts";
import { DocumentError } from "./schema.ts";

export async function authorizedDocument(
  tx: DocumentTransaction,
  userId: string,
  input: DocumentExtractionInput,
  sessionId?: string,
): Promise<typeof documents.$inferSelect> {
  requireDocumentRead(
    await subjectAccess(tx, userId, input.subjectId, input.caseId, sessionId),
    input.documentId,
  );
  const [document] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.subjectId, input.subjectId)))
    .for("share");
  if (!document) throw new DocumentError("access_denied");
  if (document.ocrStatus !== "completed") throw new DocumentError("document_not_ready");
  return document;
}
