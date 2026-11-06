import type { DatabaseClient } from "@lotse/db";
import { documents } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DeadlineError } from "./schema.ts";

type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
export type StoredLetter = typeof documents.$inferSelect;

/** The caller authorizes the case and supplies its persisted subject id. */
export async function readStoredLetter(
  tx: Transaction,
  subjectId: string,
  documentId: string,
): Promise<StoredLetter> {
  z.uuid().parse(documentId);
  const [document] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.subjectId, subjectId)));
  if (!document) throw new DeadlineError("access_denied");
  if (document.ocrStatus !== "completed") throw new DeadlineError("document_not_ready");
  return document;
}

/** Hold the source stable until explanation validation or reminder persistence commits.
 * A file hash alone cannot detect corrected OCR for the same original document.
 */
export async function assertCurrentLetter(
  tx: Transaction,
  subjectId: string,
  analyzed: StoredLetter,
): Promise<void> {
  const [current] = await tx
    .select({ hash: documents.hash, pages: documents.pages, ocrStatus: documents.ocrStatus })
    .from(documents)
    .where(and(eq(documents.id, analyzed.id), eq(documents.subjectId, subjectId)))
    .for("update");
  if (!current) throw new DeadlineError("access_denied");
  if (
    current.ocrStatus !== "completed" ||
    current.hash !== analyzed.hash ||
    JSON.stringify(current.pages) !== JSON.stringify(analyzed.pages)
  )
    throw new DeadlineError("document_not_ready");
}
