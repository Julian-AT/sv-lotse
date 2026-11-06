import type { Database } from "@lotse/db";
import { z } from "zod";
import { actorSchema, type CaseActor, type ShareScope } from "./schemas.ts";

// Reuse the public db client's transaction type without adding a driver dependency.
export type SubjectTransaction = Parameters<Parameters<Database["sql"]["begin"]>[1]>[0];

export type SubjectErrorCode =
  | "invalid_input"
  | "forbidden"
  | "actor_exists"
  | "invalid_invite"
  | "invalid_expiry"
  | "persistence_failed";

export class SubjectServiceError extends Error {
  constructor(public readonly code: SubjectErrorCode) {
    super(code);
    this.name = "SubjectServiceError";
  }
}

/** Driver and validation errors can contain user content; never propagate their details. */
export async function subjectOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SubjectServiceError) throw error;
    throw new SubjectServiceError(
      error instanceof z.ZodError ? "invalid_input" : "persistence_failed",
    );
  }
}

/** Only the subject's creator (case owner) or a persisted subject actor may grant access. */
export async function requireCaseAuthority(
  sql: SubjectTransaction,
  caseId: string,
  userId: string,
): Promise<void> {
  const [owner] = await sql`
    SELECT s.created_by FROM "case" c JOIN subject s ON s.id = c.subject_id
    WHERE c.id = ${caseId} FOR SHARE OF c, s`;
  if (!owner) throw new SubjectServiceError("forbidden");
  if (owner.created_by === userId) return;
  const [actor] = await sql`
    SELECT id FROM case_actor WHERE case_id = ${caseId} AND user_id = ${userId}
      AND role = 'subject' FOR SHARE`;
  if (!actor) throw new SubjectServiceError("forbidden");
}

export async function insertActor(
  sql: SubjectTransaction,
  input: { caseId: string; userId: string; role: "subject" | "helper"; shareScope: ShareScope },
): Promise<CaseActor> {
  // The shared Drizzle client disables automatic JSON serialization on its SQL connection.
  const [actor] = await sql`
    INSERT INTO case_actor (case_id, user_id, role, share_scope)
    VALUES (${input.caseId}, ${input.userId}, ${input.role}, ${JSON.stringify(input.shareScope)}::jsonb)
    ON CONFLICT (case_id, user_id) DO NOTHING
    RETURNING id, case_id AS "caseId", user_id AS "userId", role,
      share_scope AS "shareScope", created_at AS "createdAt"`;
  if (!actor) throw new SubjectServiceError("actor_exists");
  return actorSchema.parse(actor);
}
