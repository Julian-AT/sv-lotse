import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { jobs } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { resolveContext, type SessionIdentity } from "../conversation/store.ts";
import { contracts } from "../tools/contracts/index.ts";
import { type JobProgressPart, jobProgress } from "./progress.ts";
import { enqueueJobSchema, JobError, type JobState } from "./schema.ts";

export async function enqueueJob(
  db: DatabaseClient,
  raw: unknown,
  identity: SessionIdentity,
): Promise<JobProgressPart> {
  const parsed = enqueueJobSchema.safeParse(raw);
  if (!parsed.success) throw new JobError("INVALID_JOB", 400);
  for (const task of parsed.data.tasks)
    if (!contracts[task.toolName].input.safeParse(task.input).success)
      throw new JobError("INVALID_JOB", 400);
  return db.transaction(async (tx) => {
    const context = await resolveContext(
      tx,
      { caseId: parsed.data.caseId, inputKind: "text", capsule: {}, actionResults: [] },
      identity,
    );
    if (context.actorRole !== "subject") throw new JobError("INVALID_JOB", 403);
    for (const task of parsed.data.tasks) {
      if (
        ("caseId" in task.input && task.input.caseId !== context.caseId) ||
        ("subjectId" in task.input && task.input.subjectId !== context.subjectId)
      )
        throw new JobError("INVALID_JOB", 403);
    }
    const state: JobState = {
      version: 1,
      identity,
      tasks: parsed.data.tasks,
      results: [],
      nextStep: 0,
      leaseId: null,
      leaseUntil: 0,
      retryAt: 0,
      error: null,
      failures: 0,
    };
    const [job] = await tx
      .insert(jobs)
      .values({ id: randomUUID(), caseId: context.caseId, type: "tool-bundle", stepState: state })
      .returning();
    if (!job) throw new JobError("INVALID_JOB", 500);
    return { type: "data-job-progress" as const, id: job.id, data: jobProgress(job) };
  });
}

export type JobDetails = {
  id: string;
  caseId: string;
  status: typeof jobs.$inferSelect.status;
  attempts: number;
  results: JobState["results"];
  part: JobProgressPart;
};
export async function getJob(
  db: DatabaseClient,
  id: string,
  identity: SessionIdentity,
  language: "de" | "en" = "de",
): Promise<JobDetails> {
  if (!z.uuid().safeParse(id).success) throw new JobError("INVALID_JOB", 400);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id));
    if (!job) throw new JobError("JOB_NOT_FOUND", 404);
    const context = await resolveContext(
      tx,
      { caseId: job.caseId, inputKind: "text", capsule: {}, actionResults: [] },
      identity,
    );
    if (context.actorRole !== "subject") throw new JobError("JOB_NOT_FOUND", 404);
    // Identity and lease internals are never returned to clients.
    return {
      id: job.id,
      caseId: job.caseId,
      status: job.status,
      attempts: job.attempts,
      results: z.array(z.json()).parse(job.stepState.results ?? []),
      part: { type: "data-job-progress" as const, id: job.id, data: jobProgress(job, language) },
    };
  });
}

export type { JobProgressPart } from "./progress.ts";
export { runJobs } from "./runner.ts";
export { JobError } from "./schema.ts";
