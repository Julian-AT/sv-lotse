import { z } from "zod";
import { ProcessError } from "../engine/schema.ts";

export type CaseTransaction = Parameters<
  Parameters<import("@lotse/db").DatabaseClient["transaction"]>[0]
>[0];
export type ObjectStorage = Pick<
  ReturnType<typeof import("@lotse/db/storage/s3").createObjectStorage>,
  "put" | "get" | "delete"
>;

export class CaseFileError extends Error {
  constructor(
    public readonly code:
      | "invalid_input"
      | "access_denied"
      | "not_found"
      | "operation_failed"
      | "case_busy",
  ) {
    super(code);
    this.name = "CaseFileError";
  }
}

export async function caseOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CaseFileError) throw error;
    if (error instanceof ProcessError)
      throw new CaseFileError(error.code === "ACCESS_DENIED" ? "access_denied" : "invalid_input");
    throw new CaseFileError(error instanceof z.ZodError ? "invalid_input" : "operation_failed");
  }
}

export const casePatchSchema = z.strictObject({
  confirmedGoal: z.string().trim().min(1).optional(),
  lifeSituation: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional(),
});

export const stepInputSchema = z.strictObject({
  processStep: z.string().trim().min(1),
  status: z.enum(["pending", "in_progress", "blocked", "completed"]),
  owner: z.enum(["user", "pilot", "office"]),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  linkedArtifacts: z.array(z.json()).default([]),
  initiatedBy: z.enum(["user", "pilot", "office"]).default("user"),
});

export const handoffScopeSchema = z.array(z.enum(["steps", "facts", "documents", "reminders"]));
export type HandoffScope = z.infer<typeof handoffScopeSchema>;

// Zod 4 partial() retains inner defaults. PATCH must preserve omitted persisted fields.
export const stepPatchSchema = stepInputSchema.partial().extend({
  linkedArtifacts: z.array(z.json()).optional(),
  initiatedBy: z.enum(["user", "pilot", "office"]).optional(),
});
