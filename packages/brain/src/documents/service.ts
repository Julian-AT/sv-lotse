import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { documents, facts } from "@lotse/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireContextWrite, subjectAccess } from "./access.ts";
import {
  type DocumentExtraction,
  type DocumentExtractionInput,
  type DocumentProposal,
  type DocumentService,
  type DocumentServiceOptions,
  type DocumentUpload,
  extractionInput,
  uploadSchema,
} from "./contracts.ts";
import { decryptOriginal, encryptOriginal } from "./encryption.ts";
import { extractDocumentStatements } from "./extraction.ts";
import { createFactService } from "./facts.ts";
import { fileMediaType, readDocumentPages } from "./pages.ts";
import { signProposal } from "./proposals.ts";
import { DocumentError, documentOperation, documentPagesSchema } from "./schema.ts";
import { authorizedDocument } from "./stored.ts";

export type {
  DocumentExtractionInput,
  DocumentProposal,
  DocumentService,
  DocumentStorage,
  DocumentUpload,
} from "./contracts.ts";

/** Authenticated identity is bound once by the HTTP adapter or the tool runtime. */
export function createDocumentService(
  db: DatabaseClient,
  userId: string,
  options: DocumentServiceOptions = {},
): DocumentService {
  z.uuid().parse(userId);
  async function extract(
    raw: DocumentExtractionInput,
    signal?: AbortSignal,
  ): Promise<DocumentExtraction> {
    return documentOperation(async () => {
      const input = extractionInput.parse(raw);
      const document = await db.transaction((tx) =>
        authorizedDocument(tx, userId, input, options.sessionId),
      );
      const pages = documentPagesSchema.parse(document.pages);
      const range = input.pageRange;
      if (range && (range.from > range.to || range.to > pages.length))
        throw new DocumentError("invalid_input");
      const statements = await extractDocumentStatements(pages, signal, input.pageRange);
      // Recheck access and document identity after the slow provider boundary.
      const confirmedSources = await db.transaction(async (tx) => {
        const current = await authorizedDocument(tx, userId, input, options.sessionId);
        if (
          current.hash !== document.hash ||
          JSON.stringify(current.pages) !== JSON.stringify(document.pages)
        )
          throw new DocumentError("document_not_ready");
        return tx
          .select({ type: facts.type, source: facts.source })
          .from(facts)
          .where(and(eq(facts.documentId, document.id), eq(facts.confirmed, true)));
      });
      const proposals = options.proposalSecret
        ? statements
            .filter(
              (statement) =>
                !confirmedSources.some(
                  (fact) =>
                    fact.type === statement.type &&
                    fact.source.page === statement.page &&
                    fact.source.quote === statement.quote,
                ),
            )
            .map((statement): DocumentProposal => {
              const signed = signProposal(
                {
                  userId,
                  subjectId: input.subjectId,
                  documentId: document.id,
                  documentHash: document.hash,
                  statement,
                },
                options.proposalSecret ?? "",
              );
              return {
                id: signed.proposal.id,
                subjectId: input.subjectId,
                type: statement.type,
                value: statement.quote,
                source: {
                  kind: "document",
                  documentId: document.id,
                  page: statement.page,
                  bbox: statement.bbox,
                  quote: statement.quote,
                },
                confirmed: false,
                proposalToken: signed.proposalToken,
              };
            })
        : [];
      return { statements, proposals };
    });
  }
  return {
    ...createFactService(db, userId, options),
    extract,
    upload: (bytes: Uint8Array, raw: DocumentUpload, signal?: AbortSignal) =>
      documentOperation(async () => {
        const input = uploadSchema.parse(raw);
        const mediaType = fileMediaType(bytes);
        await db.transaction(async (tx) =>
          requireContextWrite(await subjectAccess(tx, userId, input.subjectId)),
        );
        const storage = options.storage;
        const secret = options.encryptionSecret;
        if (!storage || !secret) throw new DocumentError("storage_failed");
        const pages = input.pages ?? (await readDocumentPages(bytes, signal));
        const id = randomUUID();
        const storageKey = `documents/${input.subjectId}/${id}.envelope`;
        const hash = createHash("sha256").update(bytes).digest("hex");
        try {
          await storage.put(
            storageKey,
            encryptOriginal(bytes, secret, storageKey),
            "application/json",
          );
        } catch {
          throw new DocumentError("storage_failed");
        }
        try {
          await db.transaction(async (tx) => {
            requireContextWrite(await subjectAccess(tx, userId, input.subjectId));
            signal?.throwIfAborted();
            await tx.insert(documents).values({
              id,
              subjectId: input.subjectId,
              type: input.type,
              storageKey,
              hash,
              pages,
              ocrStatus: "completed",
              originClient: input.originClient,
            });
          });
        } catch (error) {
          await storage.delete(storageKey).catch(() => {
            throw new DocumentError("storage_failed");
          });
          throw error;
        }
        return {
          documentId: id,
          subjectId: input.subjectId,
          ocrStatus: "completed" as const,
          pageCount: pages.length,
          mediaType,
        };
      }),
    read: (raw: DocumentExtractionInput) =>
      documentOperation(async () => {
        const input = extractionInput.parse(raw);
        const document = await db.transaction((tx) =>
          authorizedDocument(tx, userId, input, options.sessionId),
        );
        if (!options.storage || !options.encryptionSecret)
          throw new DocumentError("storage_failed");
        const bytes = decryptOriginal(
          await options.storage.get(document.storageKey),
          options.encryptionSecret,
          document.storageKey,
        );
        await db.transaction((tx) => authorizedDocument(tx, userId, input, options.sessionId));
        return {
          bytes,
          mediaType: fileMediaType(bytes),
          pages: documentPagesSchema.parse(document.pages),
        };
      }),
    deleteDocument: (raw: DocumentExtractionInput) =>
      documentOperation(async () => {
        const input = extractionInput.parse(raw);
        const storage = options.storage;
        if (!storage) throw new DocumentError("storage_failed");
        await db.transaction(async (tx) => {
          requireContextWrite(await subjectAccess(tx, userId, input.subjectId, input.caseId));
          const [row] = await tx
            .select()
            .from(documents)
            .where(
              and(eq(documents.id, input.documentId), eq(documents.subjectId, input.subjectId)),
            )
            .for("update");
          if (!row) throw new DocumentError("access_denied");
          await storage.delete(row.storageKey);
          await tx.delete(documents).where(eq(documents.id, row.id));
        });
        return { deleted: true as const };
      }),
  };
}
