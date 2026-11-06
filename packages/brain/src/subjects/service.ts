import type { Database } from "@lotse/db";
import { z } from "zod";
import { createHelperInviteService, type HelperInviteService } from "./invites.ts";
import {
  insertActor,
  requireCaseAuthority,
  SubjectServiceError,
  subjectOperation,
} from "./persistence.ts";
import {
  addCaseActorInput,
  type CaseActor,
  caseSchema,
  createCaseInput,
  createSubjectInput,
  factSchema,
  type Subject,
  type SubjectCase,
  type SubjectFact,
  shareScopeSchema,
  subjectSchema,
} from "./schemas.ts";

export interface SubjectService extends HelperInviteService {
  createSubject(input: z.infer<typeof createSubjectInput>): Promise<Subject>;
  createCase(
    input: z.infer<typeof createCaseInput>,
  ): Promise<{ case: SubjectCase; actor: CaseActor }>;
  addCaseActor(input: z.infer<typeof addCaseActorInput>): Promise<CaseActor>;
  factsVisibleTo(actorId: string, subjectId: string): Promise<SubjectFact[]>;
  deleteSubject(subjectId: string): Promise<void>;
}

/** userId must come from the server's authenticated session, never from request input. */
export function createSubjectService(database: Database, userId: string): SubjectService {
  const identity = z.uuid().safeParse(userId);
  if (!identity.success) throw new SubjectServiceError("invalid_input");
  const authenticatedUserId = identity.data;

  return {
    ...createHelperInviteService(database, authenticatedUserId),
    deleteSubject: (subjectId) =>
      subjectOperation(async () => {
        z.uuid().parse(subjectId);
        const rows = await database.sql`
        DELETE FROM subject s WHERE s.id = ${subjectId} AND (
          s.created_by = ${authenticatedUserId} OR EXISTS (
            SELECT 1 FROM "case" c JOIN case_actor a ON a.case_id = c.id
            WHERE c.subject_id = s.id AND a.user_id = ${authenticatedUserId} AND a.role = 'subject'
          )
        ) RETURNING s.id`;
        if (rows.length === 0) throw new SubjectServiceError("forbidden");
      }),
    createSubject: (input) =>
      subjectOperation(async () => {
        const value = createSubjectInput.parse(input);
        const [subject] = await database.sql`
        INSERT INTO subject (display_name, relation_to_user, created_by)
        VALUES (${value.displayName}, ${value.relationToUser}, ${authenticatedUserId})
        RETURNING id, display_name AS "displayName", relation_to_user AS "relationToUser",
          created_by AS "createdBy", created_at AS "createdAt"`;
        return subjectSchema.parse(subject);
      }),

    createCase: (input) =>
      subjectOperation(async () => {
        const value = createCaseInput.parse(input);
        return database.sql.begin(async (sql) => {
          const [subject] = await sql`
          SELECT relation_to_user FROM subject WHERE id = ${value.subjectId}
            AND created_by = ${authenticatedUserId} FOR SHARE`;
          if (!subject) throw new SubjectServiceError("forbidden");
          const [row] = await sql`
          INSERT INTO "case" (subject_id, confirmed_goal)
          VALUES (${value.subjectId}, ${value.confirmedGoal})
          RETURNING id, subject_id AS "subjectId", confirmed_goal AS "confirmedGoal"`;
          const createdCase = caseSchema.parse(row);
          const actor = await insertActor(sql, {
            caseId: createdCase.id,
            userId: authenticatedUserId,
            role: subject.relation_to_user === "self" ? "subject" : "helper",
            shareScope: { mode: "full" },
          });
          return { case: createdCase, actor };
        });
      }),

    addCaseActor: (input) =>
      subjectOperation(async () => {
        const value = addCaseActorInput.parse(input);
        return database.sql.begin(async (sql) => {
          await requireCaseAuthority(sql, value.caseId, authenticatedUserId);
          return insertActor(sql, value);
        });
      }),

    factsVisibleTo: (actorId, subjectId) =>
      subjectOperation(async () => {
        z.uuid().parse(actorId);
        z.uuid().parse(subjectId);
        return database.sql.begin(async (sql) => {
          const [actor] = await sql`
          SELECT a.role, a.share_scope FROM case_actor a JOIN "case" c ON c.id = a.case_id
          WHERE a.id = ${actorId} AND a.user_id = ${authenticatedUserId}
            AND c.subject_id = ${subjectId} FOR SHARE OF a, c`;
          if (!actor) return [];
          const scope = shareScopeSchema.safeParse(actor.share_scope);
          if (!scope.success) return [];
          const restricted = actor.role !== "subject" && scope.data.mode === "restricted";
          const types = scope.data.mode === "restricted" ? scope.data.factTypes : [];
          if (restricted && types.length === 0) return [];
          const rows = await sql`
          SELECT id, subject_id AS "subjectId", type, value, document_id AS "documentId",
            turn_id AS "turnId", source_fact_id AS "sourceFactId", source, confidence,
            confirmed, created_at AS "createdAt"
          FROM fact WHERE subject_id = ${subjectId}
            ${restricted ? sql`AND type IN ${sql(types)}` : sql``}
          ORDER BY created_at, id`;
          return z.array(factSchema).parse(rows);
        });
      }),
  };
}
