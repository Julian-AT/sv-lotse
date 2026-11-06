import { JsonValueSchema } from "@lotse/protocol";
import { z } from "zod";
import { BACKGROUND_TOOL_NAMES, JOB_MAX_STEPS } from "../config/index.ts";

export const jobTaskSchema = z.strictObject({
  toolName: z.enum(BACKGROUND_TOOL_NAMES),
  input: z.record(z.string(), JsonValueSchema),
});
export const enqueueJobSchema = z.strictObject({
  caseId: z.uuid(),
  tasks: z.array(jobTaskSchema).min(1).max(JOB_MAX_STEPS),
});
export const jobStateSchema = z
  .strictObject({
    version: z.literal(1),
    identity: z.strictObject({
      userId: z.uuid(),
      sessionId: z.uuid(),
      kind: z.literal("anonymous"),
    }),
    tasks: z.array(jobTaskSchema).min(1).max(JOB_MAX_STEPS),
    results: z.array(JsonValueSchema),
    nextStep: z.int().nonnegative(),
    leaseId: z.uuid().nullable(),
    leaseUntil: z.number().nonnegative(),
    retryAt: z.number().nonnegative(),
    error: z.enum(["JOB_STEP_FAILED", "JOB_STATE_INVALID"]).nullable(),
    failures: z.int().nonnegative().default(0),
  })
  .refine(
    (state) => state.nextStep === state.results.length && state.nextStep <= state.tasks.length,
  );
export type JobTask = z.infer<typeof jobTaskSchema>;
export type JobState = z.infer<typeof jobStateSchema>;
export class JobError extends Error {
  constructor(
    readonly code: "INVALID_JOB" | "JOB_NOT_FOUND" | "JOB_LEASE_LOST",
    readonly status: number,
  ) {
    super(code);
    this.name = "JobError";
  }
}
