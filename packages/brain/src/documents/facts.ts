import type { DatabaseClient } from "@lotse/db";
import { facts } from "@lotse/db/schema";
import { type Fact, FactSchema } from "@lotse/protocol";
import { and, eq, inArray, or } from "drizzle-orm";
import type { z } from "zod";
import { requireContextWrite, subjectAccess } from "./access.ts";
import type { DocumentServiceOptions } from "./contracts.ts";
import { locateQuote } from "./grounding.ts";
import { verifyProposal } from "./proposals.ts";
import {
  confirmFactSchema,
  DocumentError,
  documentOperation,
  documentPagesSchema,
  factEditSchema,
  factMutationSchema,
  factQuerySchema,
} from "./schema.ts";
import { authorizedDocument } from "./stored.ts";

export interface FactService {
  listFacts(raw: z.input<typeof factQuerySchema>): Promise<Fact[]>;
  confirmFact(raw: z.input<typeof confirmFactSchema>): Promise<Fact>;
  editFact(raw: z.input<typeof factEditSchema>): Promise<Fact>;
  deleteFact(raw: z.input<typeof factMutationSchema>): Promise<{ deleted: true }>;
}

function asFact(row: typeof facts.$inferSelect): Fact {
  return FactSchema.parse({
    id: row.id,
    subjectId: row.subjectId,
    type: row.type,
    value: row.value,
    source: row.source,
    confidence: row.confidence,
    confirmed: row.confirmed,
  });
}

export function createFactService(
  db: DatabaseClient,
  userId: string,
  options: DocumentServiceOptions,
): FactService {
  return {
    listFacts: (raw: z.input<typeof factQuerySchema>) =>
      documentOperation(async () => {
        const input = factQuerySchema.parse(raw);
        return db.transaction(async (tx) => {
          const scope = await subjectAccess(
            tx,
            userId,
            input.subjectId,
            input.caseId,
            options.sessionId,
          );
          const types = input.factTypes
            ? input.factTypes.filter((type) => scope.types === null || scope.types.includes(type))
            : scope.types;
          if (types?.length === 0 && !scope.factIds?.length) return [];
          const rows = await tx
            .select()
            .from(facts)
            .where(
              and(
                eq(facts.subjectId, input.subjectId),
                eq(facts.confirmed, true),
                types === null
                  ? undefined
                  : or(
                      types.length ? inArray(facts.type, types) : undefined,
                      scope.factIds?.length ? inArray(facts.id, scope.factIds) : undefined,
                    ),
                input.factTypes ? inArray(facts.type, input.factTypes) : undefined,
              ),
            );
          return rows.map(asFact);
        });
      }),
    confirmFact: (raw: z.input<typeof confirmFactSchema>) =>
      documentOperation(async () => {
        const input = confirmFactSchema.parse(raw);
        if (!options.proposalSecret) throw new DocumentError("invalid_proposal");
        const proposal = verifyProposal(input.proposalToken, options.proposalSecret, userId);
        return db.transaction(async (tx) => {
          requireContextWrite(await subjectAccess(tx, userId, proposal.subjectId));
          const document = await authorizedDocument(tx, userId, {
            subjectId: proposal.subjectId,
            documentId: proposal.documentId,
          });
          if (document.hash !== proposal.documentHash) throw new DocumentError("invalid_proposal");
          const page = documentPagesSchema
            .parse(document.pages)
            .find((candidate) => candidate.page === proposal.statement.page);
          if (!page) throw new DocumentError("invalid_proposal");
          const bbox = locateQuote(page, proposal.statement.quote);
          // Medical recommendations remain verbatim even when the user edits a card.
          const value = input.value ?? proposal.statement.quote;
          if (
            proposal.statement.type === "documented_recommendation" &&
            value !== proposal.statement.quote
          )
            throw new DocumentError("invalid_input");
          const source = {
            kind: "document",
            documentId: document.id,
            page: page.page,
            bbox,
            quote: proposal.statement.quote,
          };
          const [row] = await tx
            .insert(facts)
            .values({
              id: proposal.id,
              subjectId: proposal.subjectId,
              type: proposal.statement.type,
              value,
              documentId: document.id,
              source,
              confidence: 1,
              confirmed: true,
            })
            .onConflictDoNothing({ target: facts.id })
            .returning();
          if (row) return asFact(row);
          const [existing] = await tx
            .select()
            .from(facts)
            .where(and(eq(facts.id, proposal.id), eq(facts.subjectId, proposal.subjectId)));
          if (!existing) throw new DocumentError("invalid_proposal");
          return asFact(existing);
        });
      }),
    editFact: (raw: z.input<typeof factEditSchema>) =>
      documentOperation(async () => {
        const input = factEditSchema.parse(raw);
        return db.transaction(async (tx) => {
          requireContextWrite(await subjectAccess(tx, userId, input.subjectId));
          const [fact] = await tx
            .select()
            .from(facts)
            .where(and(eq(facts.id, input.factId), eq(facts.subjectId, input.subjectId)))
            .for("update");
          if (!fact) throw new DocumentError("access_denied");
          if (fact.type === "documented_recommendation" && input.value !== fact.source.quote)
            throw new DocumentError("invalid_input");
          const [updated] = await tx
            .update(facts)
            .set({ value: input.value, confirmed: true })
            .where(eq(facts.id, fact.id))
            .returning();
          if (!updated) throw new DocumentError("persistence_failed");
          return asFact(updated);
        });
      }),
    deleteFact: (raw: z.input<typeof factMutationSchema>) =>
      documentOperation(async () => {
        const input = factMutationSchema.parse(raw);
        return db.transaction(async (tx) => {
          requireContextWrite(await subjectAccess(tx, userId, input.subjectId));
          const result = await tx
            .delete(facts)
            .where(and(eq(facts.id, input.factId), eq(facts.subjectId, input.subjectId)))
            .returning({ id: facts.id });
          if (!result.length) throw new DocumentError("access_denied");
          return { deleted: true as const };
        });
      }),
  };
}
