import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { caseSteps, documents, facts, reminders } from "@lotse/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { CASE_FILE_CONFIG } from "../config/index.ts";
import { authorizeCase, requireIdleCase } from "./access.ts";
import { appendCaseEvent } from "./events.ts";
import { renderHandoffPdf } from "./pdf.ts";
import { CaseFileError, caseOperation, handoffScopeSchema, type ObjectStorage } from "./schema.ts";

export interface HandoffService {
  compose(
    caseId: string,
    rawScope?: unknown,
    recordEvent?: boolean,
  ): Promise<{ documentKey: string }>;
  download(caseId: string, documentId: string): Promise<Buffer>;
}

export function createHandoffService(
  db: DatabaseClient,
  storage: ObjectStorage,
  userId: string,
): HandoffService {
  z.uuid().parse(userId);
  return {
    compose: (
      caseId: string,
      rawScope: unknown = CASE_FILE_CONFIG.defaultHandoffScope,
      recordEvent = true,
    ) =>
      caseOperation(async () => {
        z.uuid().parse(caseId);
        const scope = handoffScopeSchema.parse(rawScope);
        const id = randomUUID();
        let uploadedKey: string | undefined;
        try {
          return await db.transaction(async (tx) => {
            // A generated document belongs to the subject; only an owner can create it.
            const record = await authorizeCase(tx, caseId, userId, true);
            if (recordEvent) await requireIdleCase(tx, caseId);
            const subjectId = record.subject.id;
            const steps = scope.includes("steps")
              ? await tx
                  .select()
                  .from(caseSteps)
                  .where(eq(caseSteps.caseId, caseId))
                  .orderBy(asc(caseSteps.createdAt), asc(caseSteps.id))
              : [];
            const confirmed = scope.includes("facts")
              ? await tx
                  .select()
                  .from(facts)
                  .where(and(eq(facts.subjectId, subjectId), eq(facts.confirmed, true)))
                  .orderBy(asc(facts.createdAt), asc(facts.id))
              : [];
            const storedDocuments = scope.includes("documents")
              ? await tx
                  .select()
                  .from(documents)
                  .where(eq(documents.subjectId, subjectId))
                  .orderBy(asc(documents.createdAt), asc(documents.id))
              : [];
            const deadlines = scope.includes("reminders")
              ? await tx
                  .select()
                  .from(reminders)
                  .where(eq(reminders.caseId, caseId))
                  .orderBy(asc(reminders.dueAt), asc(reminders.id))
              : [];
            const bytes = await renderHandoffPdf(
              {
                ...record,
                steps,
                facts: confirmed,
                documents: storedDocuments,
                reminders: deadlines,
              },
              scope,
              new Date(),
            );
            const storageKey = `subjects/${subjectId}/handoffs/${caseId}/${id}.pdf`;
            // Keep the record and event atomic; compensate an object upload if the DB write fails.
            uploadedKey = storageKey;
            await storage.put(storageKey, bytes, "application/pdf");
            await tx.insert(documents).values({
              id,
              subjectId,
              type: "case_handoff",
              storageKey,
              hash: createHash("sha256").update(bytes).digest("hex"),
              originClient: "web",
              ocrStatus: "completed",
              pages: [],
            });
            if (recordEvent)
              await appendCaseEvent(tx, {
                caseId,
                kind: "artefact_ready",
                payload: { documentKey: id, documentId: id, scope },
              });
            return { documentKey: id };
          });
        } catch (error) {
          if (uploadedKey) await storage.delete(uploadedKey);
          throw error;
        }
      }),
    download: (caseId: string, documentId: string) =>
      caseOperation(() =>
        db.transaction(async (tx) => {
          z.uuid().parse(caseId);
          z.uuid().parse(documentId);
          // All handoff scopes are subject data. Restricted helpers cannot download another scope's PDF.
          const record = await authorizeCase(tx, caseId, userId);
          const [document] = await tx
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.id, documentId),
                eq(documents.subjectId, record.subject.id),
                eq(documents.type, "case_handoff"),
              ),
            );
          if (!document) throw new CaseFileError("not_found");
          if (
            document.storageKey !==
            `subjects/${record.subject.id}/handoffs/${caseId}/${documentId}.pdf`
          )
            throw new CaseFileError("not_found");
          return storage.get(document.storageKey);
        }),
      ),
  };
}
