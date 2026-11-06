import type { Database } from "@lotse/db";
import { z } from "zod";
import { effectiveShareScope } from "./access.ts";
import { subjectOperation } from "./persistence.ts";
import { factSchema, type SubjectFact } from "./schemas.ts";

const documentSchema = z.object({
  id: z.uuid(),
  subjectId: z.uuid(),
  type: z.string(),
  storageKey: z.string(),
  hash: z.string(),
  pages: z.array(z.json()),
  ocrStatus: z.string(),
  originClient: z.string(),
  createdAt: z.coerce.date(),
});
export type SubjectDocument = z.infer<typeof documentSchema>;
export interface VisibilityService {
  documentsVisibleInCase(caseId: string): Promise<SubjectDocument[]>;
  factsVisibleTo(actorId: string, subjectId: string): Promise<SubjectFact[]>;
  documentsVisibleTo(actorId: string, subjectId: string): Promise<SubjectDocument[]>;
}

export function createVisibilityService(
  database: Database,
  userId: string,
  sessionId?: string,
): VisibilityService {
  async function visible(
    actorId: string,
    subjectId: string,
    kind: "facts" | "documents",
  ): Promise<SubjectFact[] | SubjectDocument[]> {
    return subjectOperation(async () => {
      z.uuid().parse(actorId);
      z.uuid().parse(subjectId);
      return database.sql.begin(async (sql) => {
        const [actor] =
          await sql`SELECT a.role, a.share_scope FROM case_actor a JOIN "case" c ON c.id = a.case_id
          WHERE a.id = ${actorId} AND a.user_id = ${userId} AND c.subject_id = ${subjectId}
          AND (a.role = 'subject' OR NOT EXISTS (
            SELECT 1 FROM helper_session h WHERE h.case_id = c.id AND h.helper_id = a.user_id
          ) OR EXISTS (
            SELECT 1 FROM helper_session h JOIN session s ON s.id::text = h.scope->>'sessionId'
            WHERE h.case_id = c.id AND h.helper_id = a.user_id AND h.ended_at IS NULL
              AND h.scope->>'status' = 'active' AND s.user_id = a.user_id
              AND s.expires_at > clock_timestamp()
              AND NULLIF(h.scope->>'expiresAt', '')::timestamptz > clock_timestamp()
              ${sessionId ? sql`AND s.id = ${sessionId}` : sql``}
              AND (NOT EXISTS (SELECT 1 FROM relative_session r WHERE r.id = h.id) OR EXISTS (
                SELECT 1 FROM relative_session r JOIN session os ON os.id = r.owner_session_id
                WHERE r.id = h.id AND r.state = 'approved' AND r.expires_at > clock_timestamp()
                  AND os.expires_at > clock_timestamp()
              ))
          )) FOR SHARE OF a, c`;
        if (!actor) return [];
        const scope = effectiveShareScope(actor.share_scope);
        if (actor.role === "helper" && !scope.case) return [];
        const permission = actor.role === "subject" ? true : scope[kind];
        const factIds = kind === "facts" ? (scope.factIds ?? []) : [];
        if (
          permission === false ||
          (Array.isArray(permission) && permission.length === 0 && factIds.length === 0)
        )
          return [];
        if (kind === "facts") {
          const rows = await sql`SELECT id, subject_id AS "subjectId", type, value,
            document_id AS "documentId", turn_id AS "turnId", source_fact_id AS "sourceFactId",
            source, confidence, confirmed, created_at AS "createdAt" FROM fact WHERE subject_id = ${subjectId}
            ${
              Array.isArray(permission)
                ? sql`AND (
              ${permission.length ? sql`type IN ${sql(permission)}` : sql`false`}
              OR ${factIds.length ? sql`id IN ${sql(factIds)}` : sql`false`}
            )`
                : sql``
            } ORDER BY created_at, id`;
          return z.array(factSchema).parse(rows);
        }
        // A shared fact quote never implicitly exposes its complete source document.
        const rows =
          await sql`SELECT id, subject_id AS "subjectId", type, storage_key AS "storageKey",
          hash, pages, ocr_status AS "ocrStatus", origin_client AS "originClient", created_at AS "createdAt"
          FROM document WHERE subject_id = ${subjectId}
          ${Array.isArray(permission) ? sql`AND id IN ${sql(permission)}` : sql``} ORDER BY created_at, id`;
        return z.array(documentSchema).parse(rows);
      });
    });
  }
  return {
    documentsVisibleInCase: async (caseId) =>
      subjectOperation(async () => {
        z.uuid().parse(caseId);
        const [context] = await database.sql`SELECT a.id, c.subject_id AS "subjectId"
        FROM case_actor a JOIN "case" c ON c.id = a.case_id
        WHERE c.id = ${caseId} AND a.user_id = ${userId} LIMIT 1`;
        if (!context) return [];
        return z
          .array(documentSchema)
          .parse(await visible(context.id, context.subjectId, "documents"));
      }),
    factsVisibleTo: async (actorId, subjectId) =>
      z.array(factSchema).parse(await visible(actorId, subjectId, "facts")),
    documentsVisibleTo: async (actorId, subjectId) =>
      z.array(documentSchema).parse(await visible(actorId, subjectId, "documents")),
  };
}
