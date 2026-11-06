import type { DatabaseClient } from "@lotse/db";
import { type JobProgress, JsonValueSchema } from "@lotse/protocol";
import {
  JOB_BATCH_SIZE,
  JOB_LEASE_MS,
  JOB_MAX_ATTEMPTS,
  JOB_RETRY_DELAY_MS,
  JOB_RUN_BUDGET_MS,
  JOB_STEP_TIMEOUT_MS,
} from "../config/index.ts";
import { createJobExecutor, type JobExecutor } from "./execute.ts";
import { type JobProgressPart, jobProgress } from "./progress.ts";
import { JobError, type JobState } from "./schema.ts";
import { claimJob, type JobClaim, saveJobClaim } from "./store.ts";

async function executeWithTimeout(
  execute: JobExecutor,
  claim: JobClaim,
  state: JobState,
): Promise<unknown> {
  const task = state.tasks[state.nextStep];
  if (!task) throw new JobError("INVALID_JOB", 400);
  const signal = AbortSignal.timeout(JOB_STEP_TIMEOUT_MS);
  let onAbort = () => {};
  const timeout = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("JOB_STEP_TIMEOUT"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      execute({
        jobId: claim.row.id,
        caseId: claim.row.caseId,
        index: state.nextStep,
        task,
        identity: state.identity,
        signal,
      }),
      timeout,
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function runClaim(
  db: DatabaseClient,
  claim: JobClaim,
  execute: JobExecutor,
  deadline: number,
): Promise<JobProgress> {
  let state = claim.state;
  try {
    while (state.nextStep < state.tasks.length) {
      const result = JsonValueSchema.parse(await executeWithTimeout(execute, claim, state));
      state = {
        ...state,
        results: [...state.results, result],
        nextStep: state.nextStep + 1,
        leaseUntil: Date.now() + JOB_LEASE_MS,
      };
      // A completed step is committed before the next external operation starts.
      await saveJobClaim(db, claim, state, "running");
      if (state.nextStep < state.tasks.length && Date.now() >= deadline) {
        state = { ...state, leaseId: null, leaseUntil: 0 };
        await saveJobClaim(db, claim, state, "pending");
        return jobProgress({ ...claim.row, stepState: state, status: "pending" });
      }
    }
    state = { ...state, leaseId: null, leaseUntil: 0, retryAt: 0 };
    await saveJobClaim(db, claim, state, "completed");
    return jobProgress({ ...claim.row, stepState: state, status: "completed" });
  } catch (error) {
    if (error instanceof JobError && error.code === "JOB_LEASE_LOST") throw error;
    state = {
      ...state,
      leaseId: null,
      leaseUntil: 0,
      retryAt: Date.now() + JOB_RETRY_DELAY_MS,
      error: "JOB_STEP_FAILED",
      failures: state.failures + 1,
    };
    const status = state.failures >= JOB_MAX_ATTEMPTS ? "failed" : "pending";
    await saveJobClaim(db, claim, state, status);
    return jobProgress({ ...claim.row, stepState: state, status });
  }
}

/** Runs only persisted jobs. Call repeatedly from cron; no detached request-local promises. */
export async function runJobs(
  db: DatabaseClient,
  execute: JobExecutor = createJobExecutor(db),
): Promise<JobProgressPart[]> {
  const progress = [];
  const deadline = Date.now() + JOB_RUN_BUDGET_MS;
  for (let count = 0; count < JOB_BATCH_SIZE && Date.now() < deadline; count++) {
    const claim = await claimJob(db);
    if (!claim) break;
    if (claim.failed) {
      progress.push(jobProgress(claim.row));
      continue;
    }
    progress.push(await runClaim(db, claim, execute, deadline));
  }
  return progress.map((data) => ({ type: "data-job-progress" as const, id: data.jobId, data }));
}
