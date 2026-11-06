import type { DatabaseClient } from "@lotse/db";
import { caseActors, cases, subjects } from "@lotse/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { effectiveShareScope } from "../subjects/access.ts";
import { helperSessionAccess } from "../subjects/session-access.ts";
import { DocumentError } from "./schema.ts";

export type DocumentTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
export type AccessScope = {
  types: string[] | null;
  canWrite: boolean;
  factIds?: string[];
  documents?: boolean | string[];
};

/** Both currently deployed scope formats fail closed on malformed or absent grants. */
export function scopedFactTypes(role: string, raw: unknown): string[] | null {
  if (role === "subject") return null;
  // Retain legacy type-only grants for isolated, unmanaged actors.
  const legacy = z.object({ facts: z.array(z.string().min(1)) }).safeParse(raw);
  const parsed = z
    .object({ mode: z.string().optional(), case: z.boolean().optional() })
    .safeParse(raw);
  if (
    legacy.success &&
    parsed.success &&
    parsed.data.mode === undefined &&
    parsed.data.case === undefined
  )
    return legacy.data.facts;
  const scope = effectiveShareScope(raw);
  return scope.facts === true ? null : scope.facts === false ? [] : scope.facts;
}
/** An explicit case selects exactly one persisted grant; never union grants from several cases. */
export async function subjectAccess(
  tx: DocumentTransaction,
  userId: string,
  subjectId: string,
  caseId?: string,
  sessionId?: string,
): Promise<AccessScope> {
  const [subject] = await tx.select().from(subjects).where(eq(subjects.id, subjectId)).for("share");
  if (!subject) throw new DocumentError("access_denied");
  if (!caseId) {
    if (subject.createdBy !== userId) throw new DocumentError("access_denied");
    return { types: null, canWrite: true, documents: true };
  }
  const [actor] = await tx
    .select({ role: caseActors.role, scope: caseActors.shareScope })
    .from(caseActors)
    .innerJoin(cases, eq(cases.id, caseActors.caseId))
    .where(
      and(
        eq(caseActors.userId, userId),
        eq(caseActors.caseId, caseId),
        eq(cases.subjectId, subjectId),
      ),
    )
    .for("share", { of: [caseActors, cases] });
  if (!actor) throw new DocumentError("access_denied");
  const scope = effectiveShareScope(actor.scope);
  if (actor.role === "helper" && subject.createdBy !== userId) {
    if (!scope.case) throw new DocumentError("access_denied");
    const result = await tx.execute(
      sql`SELECT 1 WHERE ${helperSessionAccess(caseId, userId, sessionId)}`,
    );
    if (!result.length) throw new DocumentError("access_denied");
  }
  return {
    factIds: actor.role === "subject" ? [] : (scope.factIds ?? []),
    documents: actor.role === "subject" ? true : scope.documents,
    types: scopedFactTypes(actor.role, actor.scope),
    canWrite: actor.role === "subject" || subject.createdBy === userId,
  };
}
export function requireDocumentRead(scope: AccessScope, documentId?: string): void {
  if (
    scope.documents === true ||
    (documentId && Array.isArray(scope.documents) && scope.documents.includes(documentId))
  )
    return;
  throw new DocumentError("access_denied");
}
export function requireContextWrite(scope: AccessScope): void {
  if (!scope.canWrite) throw new DocumentError("access_denied");
}
