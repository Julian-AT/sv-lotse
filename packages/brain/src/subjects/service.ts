import type { Database } from "@lotse/db";
import { z } from "zod";
import type { ProductEventSink } from "../telemetry/product-events.ts";
import { createHelperSessionService, type HelperSessionService } from "./helper-sessions.ts";
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
  type Subject,
  type SubjectCase,
  subjectSchema,
} from "./schemas.ts";
import { createVisibilityService, type VisibilityService } from "./visibility.ts";

export interface SubjectService
  extends HelperInviteService,
    HelperSessionService,
    VisibilityService {
  createSubject(input: z.infer<typeof createSubjectInput>): Promise<Subject>;
  createCase(
    input: z.infer<typeof createCaseInput>,
  ): Promise<{ case: SubjectCase; actor: CaseActor }>;
  addCaseActor(input: z.infer<typeof addCaseActorInput>): Promise<CaseActor>;
  deleteSubject(subjectId: string): Promise<void>;
}

/** userId must come from the server's authenticated session, never from request input. */
export function createSubjectService(
  database: Database,
  userId: string,
  sessionId?: string,
  options: { onProductEvent?: ProductEventSink } = {},
): SubjectService {
  const identity = z.uuid().safeParse(userId);
  if (!identity.success) throw new SubjectServiceError("invalid_input");
  const authenticatedUserId = identity.data;

  return {
    ...createHelperInviteService(database, authenticatedUserId),
    ...createHelperSessionService(database, authenticatedUserId, sessionId, options.onProductEvent),
    ...createVisibilityService(database, authenticatedUserId, sessionId),
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
  };
}
